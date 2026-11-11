//! llama.cpp `llama-server` sidecar lifecycle for the Translate node.
//!
//! - Started lazily (first translation) on a free 127.0.0.1 port.
//! - Ready once `GET /health` returns 200 (503 while the model is loading).
//! - Restarted when a different model is requested.
//! - Killed on app exit (`shutdown()` from `RunEvent::Exit`). A pid file in the
//!   app data dir lets the next launch clean up a server orphaned by a crash.
//!
//! The only network traffic here is to 127.0.0.1 (proxies disabled).

use std::collections::VecDeque;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::commands::agent::emit_agent_log;

const SIDECAR_NAME: &str = "llama-server";
const PID_FILE: &str = "llama-server.pid";
const LOG_SOURCE: &str = "translate";
/// Max input + output tokens (model card recommends `-c 16384`).
pub const CONTEXT_SIZE: u32 = 16384;
/// How long a (large) model may take to load before we give up.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(180);
const LOG_TAIL_LINES: usize = 40;

#[derive(Debug, Clone, Serialize)]
pub struct ServerStatus {
    pub port: u16,
    pub pid: u32,
    pub model_path: String,
}

struct Running {
    child: CommandChild,
    port: u16,
    pid: u32,
    model_path: PathBuf,
    generation: u64,
}

/// Managed Tauri state.
pub struct LlamaServerState {
    /// Serializes start/stop so two first-translations don't spawn two servers.
    start_lock: tokio::sync::Mutex<()>,
    running: Mutex<Option<Running>>,
    generation: AtomicU64,
    /// Last stderr/stdout lines of the current process (for error messages).
    log_tail: Arc<Mutex<VecDeque<String>>>,
}

impl Default for LlamaServerState {
    fn default() -> Self {
        Self {
            start_lock: tokio::sync::Mutex::new(()),
            running: Mutex::new(None),
            generation: AtomicU64::new(0),
            log_tail: Arc::new(Mutex::new(VecDeque::new())),
        }
    }
}

impl LlamaServerState {
    pub fn status(&self) -> Option<ServerStatus> {
        self.running.lock().unwrap().as_ref().map(|r| ServerStatus {
            port: r.port,
            pid: r.pid,
            model_path: r.model_path.to_string_lossy().into_owned(),
        })
    }

    /// Ensure a server for `model_path` is running and healthy; returns its status.
    pub async fn ensure_running(&self, app: &AppHandle, model_path: &Path) -> Result<ServerStatus, String> {
        let _guard = self.start_lock.lock().await;

        let model_path = model_path
            .canonicalize()
            .map_err(|e| format!("Model file not found: {} ({e})", model_path.display()))?;
        if model_path.extension().and_then(|e| e.to_str()) != Some("gguf") {
            return Err(format!("Not a .gguf file: {}", model_path.display()));
        }

        if let Some(status) = self.status() {
            if Path::new(&status.model_path) == model_path {
                return Ok(status);
            }
            emit_agent_log(app, "info", LOG_SOURCE, "Model changed — restarting llama-server", Some(&model_path.to_string_lossy()));
            self.kill_current(app);
        }

        self.spawn(app, &model_path).await
    }

    /// Stop the server if running (no-op otherwise).
    pub async fn stop(&self, app: &AppHandle) {
        let _guard = self.start_lock.lock().await;
        self.kill_current(app);
    }

    /// Synchronous kill for `RunEvent::Exit` (must not await).
    pub fn shutdown(&self, app: &AppHandle) {
        self.kill_current(app);
    }

    fn kill_current(&self, app: &AppHandle) {
        if let Some(r) = self.running.lock().unwrap().take() {
            let pid = r.pid;
            let _ = r.child.kill();
            remove_pid_file(app);
            emit_agent_log(app, "info", LOG_SOURCE, &format!("llama-server stopped (pid {pid})"), None);
        }
    }

    async fn spawn(&self, app: &AppHandle, model_path: &Path) -> Result<ServerStatus, String> {
        let port = free_local_port()?;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.log_tail.lock().unwrap().clear();

        let args = server_args(model_path, port);
        let (mut rx, child) = app
            .shell()
            .sidecar(SIDECAR_NAME)
            .map_err(|e| format!("llama-server sidecar is not available on this platform: {e}"))?
            .args(&args)
            .spawn()
            .map_err(|e| format!("Failed to start llama-server: {e}"))?;
        let pid = child.pid();
        write_pid_file(app, pid);
        emit_agent_log(app, "info", LOG_SOURCE, &format!("llama-server starting (pid {pid}, port {port})"), Some(&args.join(" ")));

        *self.running.lock().unwrap() = Some(Running {
            child,
            port,
            pid,
            model_path: model_path.to_path_buf(),
            generation,
        });

        // Drain process output; clear state if the process dies on its own.
        {
            let app = app.clone();
            let log_tail = self.log_tail.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                            let text = String::from_utf8_lossy(&bytes);
                            let mut tail = log_tail.lock().unwrap();
                            for line in text.lines().filter(|l| !l.trim().is_empty()) {
                                if tail.len() >= LOG_TAIL_LINES {
                                    tail.pop_front();
                                }
                                tail.push_back(line.to_string());
                            }
                        }
                        CommandEvent::Error(err) => {
                            emit_agent_log(&app, "error", LOG_SOURCE, "llama-server error", Some(&err));
                        }
                        CommandEvent::Terminated(payload) => {
                            let state = app.state::<LlamaServerState>();
                            let mut running = state.running.lock().unwrap();
                            if running.as_ref().map(|r| r.generation) == Some(generation) {
                                *running = None;
                                remove_pid_file(&app);
                                emit_agent_log(
                                    &app,
                                    "warn",
                                    LOG_SOURCE,
                                    &format!("llama-server exited unexpectedly (code {:?}, signal {:?})", payload.code, payload.signal),
                                    None,
                                );
                            }
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }

        match self.wait_healthy(port, generation).await {
            Ok(()) => {
                emit_agent_log(app, "info", LOG_SOURCE, &format!("llama-server ready on 127.0.0.1:{port}"), None);
                Ok(ServerStatus {
                    port,
                    pid,
                    model_path: model_path.to_string_lossy().into_owned(),
                })
            }
            Err(e) => {
                self.kill_current(app);
                let tail = self.log_tail.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n");
                emit_agent_log(app, "error", LOG_SOURCE, &e, Some(&tail));
                Err(if tail.is_empty() { e } else { format!("{e}\n\n{tail}") })
            }
        }
    }

    async fn wait_healthy(&self, port: u16, generation: u64) -> Result<(), String> {
        let client = local_http_client()?;
        let url = format!("http://127.0.0.1:{port}/health");
        let started = Instant::now();
        loop {
            let alive = self.running.lock().unwrap().as_ref().map(|r| r.generation) == Some(generation);
            if !alive {
                return Err("llama-server exited while loading the model".into());
            }
            if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(2)).send().await {
                if resp.status().is_success() {
                    return Ok(());
                }
            }
            if started.elapsed() > HEALTH_TIMEOUT {
                return Err(format!("llama-server did not become healthy within {}s", HEALTH_TIMEOUT.as_secs()));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
}

/// Command-line arguments for llama-server. Bound to loopback only; the web UI
/// is disabled; the binary itself is built without networking (LLAMA_CURL=OFF).
pub fn server_args(model_path: &Path, port: u16) -> Vec<String> {
    vec![
        "-m".into(),
        model_path.to_string_lossy().into_owned(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "-c".into(),
        CONTEXT_SIZE.to_string(),
        "-ngl".into(),
        "99".into(),
        "--parallel".into(),
        "1".into(),
        "--no-webui".into(),
        "--offline".into(),
        "--alias".into(),
        "plamo-3-translate".into(),
    ]
}

/// HTTP client for talking to the local server only (never uses a proxy).
pub fn local_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

fn free_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("No free local port: {e}"))?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

// ─── Paths / pid file ───

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("Cannot resolve app data dir: {e}"))
}

/// `app_data_dir/models/` (created if missing).
pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn pid_file(app: &AppHandle) -> Option<PathBuf> {
    app_data_dir(app).ok().map(|d| d.join(PID_FILE))
}

fn write_pid_file(app: &AppHandle, pid: u32) {
    if let Some(path) = pid_file(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, pid.to_string());
    }
}

fn remove_pid_file(app: &AppHandle) {
    if let Some(path) = pid_file(app) {
        let _ = std::fs::remove_file(path);
    }
}

/// Kill a llama-server left behind by a previous crash (called once at startup).
/// Only kills the pid if it still belongs to a `llama-server` process.
pub fn kill_stale_server(app: &AppHandle) {
    let Some(path) = pid_file(app) else { return };
    let Ok(text) = std::fs::read_to_string(&path) else { return };
    let _ = std::fs::remove_file(&path);
    let Some(pid) = parse_pid(&text) else { return };

    #[cfg(unix)]
    {
        let comm = std::process::Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "comm="])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        if is_llama_server_comm(&comm) {
            let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
            emit_agent_log(app, "warn", LOG_SOURCE, &format!("Killed stale llama-server (pid {pid})"), None);
        }
    }
}

fn parse_pid(text: &str) -> Option<u32> {
    text.trim().parse::<u32>().ok().filter(|&p| p > 1)
}

fn is_llama_server_comm(comm: &str) -> bool {
    Path::new(comm)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with(SIDECAR_NAME))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_bind_loopback_only() {
        let args = server_args(Path::new("/m/x.gguf"), 4242);
        let host = args.iter().position(|a| a == "--host").unwrap();
        assert_eq!(args[host + 1], "127.0.0.1");
        assert!(args.contains(&"--no-webui".to_string()));
        assert!(args.contains(&"--offline".to_string()));
        assert!(!args.iter().any(|a| a == "-hf" || a == "--hf-repo"));
        let port = args.iter().position(|a| a == "--port").unwrap();
        assert_eq!(args[port + 1], "4242");
    }

    #[test]
    fn free_port_is_nonzero() {
        assert!(free_local_port().unwrap() > 0);
    }

    #[test]
    fn pid_parsing() {
        assert_eq!(parse_pid("1234\n"), Some(1234));
        assert_eq!(parse_pid("1"), None);
        assert_eq!(parse_pid("abc"), None);
    }

    #[test]
    fn stale_process_name_check() {
        assert!(is_llama_server_comm("/Applications/Filonex.app/Contents/MacOS/llama-server"));
        assert!(is_llama_server_comm("llama-server-aarch64-apple-darwin"));
        assert!(!is_llama_server_comm("/usr/bin/zsh"));
        assert!(!is_llama_server_comm(""));
    }
}

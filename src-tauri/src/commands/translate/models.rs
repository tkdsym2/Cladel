//! PLaMo 3 Translate model management: catalog (Hugging Face tree API),
//! resumable + SHA-256-verified downloads, local listing, deletion, import of
//! a local .gguf, and the active-model setting.
//!
//! Layout under `app_data_dir/models/`:
//!   {repo-name}/{file}.gguf                 installed model
//!   {repo-name}/{file}.gguf.manifest.json   provenance / verification
//!   {repo-name}/{file}.gguf.part            in-progress download
//!   {repo-name}/{file}.gguf.part.json       expected sha256/size of that download
//!   imported/{file}.gguf                    imported file not matching an official one
//!   catalog.json                            last fetched catalog (offline import checks)
//!   licenses/                               cached license text
//!
//! Network access happens only here (huggingface.co) and only on explicit user
//! actions: catalog refresh, download, license fetch.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;
use tokio::io::AsyncWriteExt;

use super::license::require_license;
use super::server::{models_dir, LlamaServerState};
use crate::commands::agent::emit_agent_log;

pub const MODEL_SIZES: [&str; 3] = ["0.8b", "2b", "8b"];
pub const RECOMMENDED_QUANT: &str = "Q4_K_M";
pub const PROGRESS_EVENT: &str = "translation-model-progress";
const STORE_FILE: &str = "settings.json";
const KEY_ACTIVE_MODEL: &str = "translation_active_model";
const CATALOG_FILE: &str = "catalog.json";
const IMPORTED_DIR: &str = "imported";

pub fn repo_for(size: &str) -> String {
    format!("pfnet/plamo-3-translate-{size}-GGUF")
}

fn repo_dir_name(repo: &str) -> &str {
    repo.rsplit('/').next().unwrap_or(repo)
}

fn size_of_repo(repo: &str) -> Option<&'static str> {
    MODEL_SIZES.iter().copied().find(|s| repo_for(s) == repo)
}

/// Client for huggingface.co (catalog, license, downloads). No overall
/// timeout (downloads are long); callers add per-request timeouts.
pub fn hf_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Filonex/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

// ─── Catalog ───

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemoteModelFile {
    pub repo: String,
    pub size_label: String,
    pub filename: String,
    pub bytes: u64,
    /// `lfs.oid` from the HF tree API = SHA-256 of the file.
    pub sha256: String,
    pub quant: String,
    pub recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteRepo {
    pub size_label: String,
    pub repo: String,
    pub files: Vec<RemoteModelFile>,
    /// Set when the live fetch failed (files then come from the cache, if any).
    pub error: Option<String>,
    pub from_cache: bool,
}

/// Parse `plamo-3-translate-{size}-{QUANT}.gguf` → (size, quant).
pub fn parse_model_filename(filename: &str) -> Option<(&'static str, String)> {
    let stem = filename.strip_suffix(".gguf")?;
    let rest = stem.strip_prefix("plamo-3-translate-")?;
    MODEL_SIZES.iter().copied().find_map(|size| {
        rest.strip_prefix(size)
            .and_then(|q| q.strip_prefix('-'))
            .filter(|q| !q.is_empty())
            .map(|q| (size, q.to_string()))
    })
}

/// Extract downloadable GGUF files from a HF `/api/models/{repo}/tree/main` response.
pub fn parse_tree(json: &Value, repo: &str, size_label: &str) -> Vec<RemoteModelFile> {
    let mut files: Vec<RemoteModelFile> = json
        .as_array()
        .into_iter()
        .flatten()
        .filter(|e| e.get("type").and_then(Value::as_str) == Some("file"))
        .filter_map(|e| {
            let path = e.get("path")?.as_str()?;
            if path.contains('/') || !path.ends_with(".gguf") {
                return None;
            }
            let lfs = e.get("lfs")?;
            let sha256 = lfs.get("oid")?.as_str()?.to_ascii_lowercase();
            if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
                return None;
            }
            let bytes = lfs.get("size").and_then(Value::as_u64).or_else(|| e.get("size")?.as_u64())?;
            let quant = parse_model_filename(path)
                .map(|(_, q)| q)
                .unwrap_or_else(|| path.trim_end_matches(".gguf").to_string());
            Some(RemoteModelFile {
                repo: repo.to_string(),
                size_label: size_label.to_string(),
                filename: path.to_string(),
                bytes,
                sha256,
                recommended: quant == RECOMMENDED_QUANT,
                quant,
            })
        })
        .collect();
    // Recommended first, then by size.
    files.sort_by(|a, b| b.recommended.cmp(&a.recommended).then(a.bytes.cmp(&b.bytes)));
    files
}

async fn fetch_repo_files(client: &reqwest::Client, repo: &str, size: &str) -> Result<Vec<RemoteModelFile>, String> {
    let url = format!("https://huggingface.co/api/models/{repo}/tree/main");
    let resp = client
        .get(&url)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("{repo}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{repo}: HTTP {}", resp.status()));
    }
    let json: Value = resp.json().await.map_err(|e| format!("{repo}: {e}"))?;
    let files = parse_tree(&json, repo, size);
    if files.is_empty() {
        return Err(format!("{repo}: no GGUF files found"));
    }
    Ok(files)
}

type CatalogCache = HashMap<String, Vec<RemoteModelFile>>;

fn read_catalog_cache(dir: &Path) -> CatalogCache {
    std::fs::read(dir.join(CATALOG_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_catalog_cache(dir: &Path, cache: &CatalogCache) {
    if let Ok(b) = serde_json::to_vec_pretty(cache) {
        let _ = std::fs::write(dir.join(CATALOG_FILE), b);
    }
}

/// Fetch the file list of all three repos (cached for offline use).
#[tauri::command]
pub async fn translation_remote_catalog(app: AppHandle) -> Result<Vec<RemoteRepo>, String> {
    let dir = models_dir(&app)?;
    let client = hf_client()?;
    let results = futures_util::future::join_all(MODEL_SIZES.iter().map(|size| {
        let client = client.clone();
        async move {
            let repo = repo_for(size);
            let r = fetch_repo_files(&client, &repo, size).await;
            (size.to_string(), repo, r)
        }
    }))
    .await;

    let mut cache = read_catalog_cache(&dir);
    let mut out = Vec::new();
    for (size, repo, r) in results {
        match r {
            Ok(files) => {
                cache.insert(repo.clone(), files.clone());
                out.push(RemoteRepo { size_label: size, repo, files, error: None, from_cache: false });
            }
            Err(e) => {
                let files = cache.get(&repo).cloned().unwrap_or_default();
                let from_cache = !files.is_empty();
                out.push(RemoteRepo { size_label: size, repo, files, error: Some(e), from_cache });
            }
        }
    }
    write_catalog_cache(&dir, &cache);
    Ok(out)
}

// ─── Local models ───

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    repo: Option<String>,
    filename: String,
    bytes: u64,
    sha256: Option<String>,
    /// SHA-256 matched the official Hugging Face file.
    verified: bool,
    /// "download" | "import"
    source: String,
    installed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PartMeta {
    repo: String,
    filename: String,
    sha256: String,
    bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalModel {
    pub path: String,
    pub filename: String,
    pub repo: Option<String>,
    pub size_label: Option<String>,
    pub quant: Option<String>,
    pub bytes: u64,
    pub sha256: Option<String>,
    pub verified: bool,
    /// "download" | "import" | "manual" (placed by hand, no manifest)
    pub source: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PartialDownload {
    pub path: String,
    pub repo: String,
    pub filename: String,
    pub downloaded: u64,
    pub total: u64,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalModels {
    pub models_dir: String,
    pub models: Vec<LocalModel>,
    pub partials: Vec<PartialDownload>,
    pub active_model_path: Option<String>,
}

fn manifest_path(model: &Path) -> PathBuf {
    PathBuf::from(format!("{}.manifest.json", model.display()))
}

fn part_path(dest: &Path) -> PathBuf {
    PathBuf::from(format!("{}.part", dest.display()))
}

fn part_meta_path(dest: &Path) -> PathBuf {
    PathBuf::from(format!("{}.part.json", dest.display()))
}

/// `models/` and its immediate subdirectories.
fn scan_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![root.to_path_buf()];
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) && e.file_name() != "licenses" {
                dirs.push(e.path());
            }
        }
    }
    dirs
}

fn local_model_from(path: &Path, active: Option<&Path>) -> Option<LocalModel> {
    let filename = path.file_name()?.to_str()?.to_string();
    let bytes = std::fs::metadata(path).ok()?.len();
    let manifest: Option<Manifest> = std::fs::read(manifest_path(path))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    let parsed = parse_model_filename(&filename);
    let repo = manifest
        .as_ref()
        .and_then(|m| m.repo.clone())
        .or_else(|| parsed.as_ref().map(|(s, _)| repo_for(s)));
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Some(LocalModel {
        path: canonical.to_string_lossy().into_owned(),
        size_label: repo.as_deref().and_then(size_of_repo).map(str::to_string),
        quant: parsed.map(|(_, q)| q),
        filename,
        repo,
        bytes,
        sha256: manifest.as_ref().and_then(|m| m.sha256.clone()),
        verified: manifest.as_ref().map(|m| m.verified).unwrap_or(false),
        source: manifest.map(|m| m.source).unwrap_or_else(|| "manual".into()),
        active: active.map(|a| a == canonical).unwrap_or(false),
    })
}

pub fn list_local(root: &Path, active: Option<&Path>, running: &[String]) -> LocalModels {
    let mut models = Vec::new();
    let mut partials = Vec::new();
    for dir in scan_dirs(root) {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let path = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if name.ends_with(".gguf") && path.is_file() {
                if let Some(m) = local_model_from(&path, active) {
                    models.push(m);
                }
            } else if let Some(dest_name) = name.strip_suffix(".gguf.part") {
                let dest = dir.join(format!("{dest_name}.gguf"));
                let meta: Option<PartMeta> = std::fs::read(part_meta_path(&dest))
                    .ok()
                    .and_then(|b| serde_json::from_slice(&b).ok());
                if let Some(meta) = meta {
                    let key = job_key(&meta.repo, &meta.filename);
                    partials.push(PartialDownload {
                        path: path.to_string_lossy().into_owned(),
                        downloaded: e.metadata().map(|m| m.len()).unwrap_or(0),
                        total: meta.bytes,
                        running: running.contains(&key),
                        repo: meta.repo,
                        filename: meta.filename,
                    });
                }
            }
        }
    }
    models.sort_by(|a, b| a.bytes.cmp(&b.bytes).then(a.filename.cmp(&b.filename)));
    LocalModels {
        models_dir: root.to_string_lossy().into_owned(),
        active_model_path: active.map(|p| p.to_string_lossy().into_owned()),
        models,
        partials,
    }
}

fn stored_active(app: &AppHandle) -> Option<PathBuf> {
    let store = app.store(STORE_FILE).ok()?;
    let path = PathBuf::from(store.get(KEY_ACTIVE_MODEL)?.as_str()?);
    path.canonicalize().ok().filter(|p| p.is_file())
}

fn set_stored_active(app: &AppHandle, path: Option<&Path>) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| format!("Failed to open store: {e}"))?;
    match path {
        Some(p) => store.set(KEY_ACTIVE_MODEL, serde_json::json!(p.to_string_lossy())),
        None => {
            store.delete(KEY_ACTIVE_MODEL);
        }
    }
    let _ = store.save();
    Ok(())
}

/// The model translations use: the stored choice, else the smallest installed
/// model. `NO_MODEL:` prefix lets the UI offer the download flow.
pub fn resolve_active_model(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(p) = stored_active(app) {
        return Ok(p);
    }
    let root = models_dir(app)?;
    let local = list_local(&root, None, &[]);
    local
        .models
        .first()
        .map(|m| PathBuf::from(&m.path))
        .ok_or_else(|| "NO_MODEL: No translation model is installed. Download one in Settings → Translation.".into())
}

#[tauri::command]
pub fn translation_list_local_models(app: AppHandle, jobs: State<'_, DownloadJobs>) -> Result<LocalModels, String> {
    let root = models_dir(&app)?;
    let active = resolve_active_model(&app).ok();
    let running: Vec<String> = jobs.0.lock().unwrap().keys().cloned().collect();
    Ok(list_local(&root, active.as_deref(), &running))
}

/// Choose the model used for translation. Stops a server running another model.
#[tauri::command]
pub async fn translation_set_active_model(
    app: AppHandle,
    server: State<'_, LlamaServerState>,
    path: String,
) -> Result<(), String> {
    let root = models_dir(&app)?;
    let p = ensure_inside(&root, Path::new(&path))?;
    if p.extension().and_then(|e| e.to_str()) != Some("gguf") || !p.is_file() {
        return Err("Not an installed .gguf model".into());
    }
    set_stored_active(&app, Some(&p))?;
    if let Some(status) = server.status() {
        if Path::new(&status.model_path) != p {
            server.stop(&app).await;
        }
    }
    Ok(())
}

/// Canonicalize `path` and require it to be inside `root`.
fn ensure_inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let p = path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))?;
    if p.starts_with(&root) && p != root {
        Ok(p)
    } else {
        Err("Path is outside the models directory".into())
    }
}

/// Delete an installed model (+ manifest) or a partial download (+ meta).
#[tauri::command]
pub async fn translation_delete_model(
    app: AppHandle,
    server: State<'_, LlamaServerState>,
    jobs: State<'_, DownloadJobs>,
    path: String,
) -> Result<(), String> {
    let root = models_dir(&app)?;
    let p = ensure_inside(&root, Path::new(&path))?;
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();

    if let Some(dest_name) = name.strip_suffix(".part") {
        let dest = p.with_file_name(dest_name);
        if let Ok(b) = std::fs::read(part_meta_path(&dest)) {
            if let Ok(meta) = serde_json::from_slice::<PartMeta>(&b) {
                if jobs.0.lock().unwrap().contains_key(&job_key(&meta.repo, &meta.filename)) {
                    return Err("This download is running. Cancel it first.".into());
                }
            }
        }
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(part_meta_path(&dest));
        return Ok(());
    }

    if !name.ends_with(".gguf") {
        return Err("Only .gguf models can be deleted".into());
    }
    if server.status().map(|s| PathBuf::from(s.model_path)) == Some(p.clone()) {
        server.stop(&app).await;
    }
    std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(manifest_path(&p));
    // Clear the setting if it pointed at the deleted file (it no longer resolves).
    if stored_active(&app).is_none() {
        set_stored_active(&app, None)?;
    }
    emit_agent_log(&app, "info", "translate", &format!("Deleted model {name}"), None);
    Ok(())
}

// ─── Download ───

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Progress {
    /// "{repo}/{filename}" or "import:{filename}"
    pub key: String,
    pub filename: String,
    /// "starting" | "hashing" | "downloading" | "done" | "cancelled" | "error"
    pub status: String,
    pub downloaded: u64,
    pub total: u64,
    pub bytes_per_sec: f64,
    pub error: Option<String>,
}

/// Cancel flags of running downloads/imports, keyed by `job_key`.
#[derive(Default)]
pub struct DownloadJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

struct DownloadGuard<'a> {
    jobs: &'a DownloadJobs,
    key: String,
}

impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        self.jobs.0.lock().unwrap().remove(&self.key);
    }
}

fn job_key(repo: &str, filename: &str) -> String {
    format!("{repo}/{filename}")
}

fn valid_filename(name: &str) -> bool {
    !name.is_empty()
        && name.ends_with(".gguf")
        && !name.contains('/')
        && !name.contains('\\')
        && !name.starts_with('.')
}

#[derive(Debug, PartialEq)]
pub enum DownloadOutcome {
    Completed,
    Cancelled,
}

/// Hash an existing file (resume) in a blocking thread.
async fn hash_file_prefix(path: PathBuf) -> Result<(Sha256, u64), String> {
    tokio::task::spawn_blocking(move || {
        let mut hasher = Sha256::new();
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8 * 1024 * 1024];
        let mut total = 0u64;
        loop {
            let n = file.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            total += n as u64;
        }
        Ok((hasher, total))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Download `url` into `part`, resuming from its current length with a Range
/// request, and verify the SHA-256 of the complete file. On mismatch the part
/// file is deleted. On cancel or network error it is kept for resuming.
pub async fn download_to_part(
    client: &reqwest::Client,
    url: &str,
    part: &Path,
    expected_sha256: &str,
    expected_bytes: u64,
    cancel: &AtomicBool,
    mut progress: impl FnMut(&str, u64, f64),
) -> Result<DownloadOutcome, String> {
    let mut existing = std::fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if existing > expected_bytes {
        std::fs::remove_file(part).map_err(|e| e.to_string())?;
        existing = 0;
    }

    let mut hasher = Sha256::new();
    if existing > 0 {
        progress("hashing", existing, 0.0);
        let (h, n) = hash_file_prefix(part.to_path_buf()).await?;
        hasher = h;
        existing = n;
    }

    if existing < expected_bytes {
        let mut req = client.get(url);
        if existing > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={existing}-"));
        }
        let resp = tokio::select! {
            r = req.send() => r.map_err(|e| format!("Download failed: {e}"))?,
            _ = wait_cancel(cancel) => return Ok(DownloadOutcome::Cancelled),
        };
        let status = resp.status();
        let append = if status == reqwest::StatusCode::PARTIAL_CONTENT {
            if content_range_start(&resp) != Some(existing) {
                return Err("Server returned an unexpected byte range; delete the partial file and retry".into());
            }
            true
        } else if status.is_success() {
            // Range ignored: start over.
            existing = 0;
            hasher = Sha256::new();
            false
        } else if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            let _ = std::fs::remove_file(part);
            return Err("Could not resume (HTTP 416). The partial file was removed; please retry.".into());
        } else {
            return Err(format!("Download failed: HTTP {status}"));
        };

        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(part)
            .await
            .map_err(|e| format!("Cannot write {}: {e}", part.display()))?;

        let mut downloaded = existing;
        let mut stream = resp.bytes_stream();
        let mut last_emit = Instant::now();
        let mut bytes_since = 0u64;
        let mut speed = 0.0f64;
        progress("downloading", downloaded, 0.0);
        loop {
            let next = tokio::select! {
                n = stream.next() => n,
                _ = wait_cancel(cancel) => {
                    file.flush().await.map_err(|e| e.to_string())?;
                    return Ok(DownloadOutcome::Cancelled);
                }
            };
            let Some(chunk) = next else { break };
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => {
                    let _ = file.flush().await;
                    return Err(format!("Download interrupted: {e} (it can be resumed)"));
                }
            };
            if downloaded + chunk.len() as u64 > expected_bytes {
                drop(file);
                let _ = std::fs::remove_file(part);
                return Err("Server sent more data than expected; the partial file was removed".into());
            }
            file.write_all(&chunk).await.map_err(|e| format!("Write failed: {e}"))?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
            bytes_since += chunk.len() as u64;
            let dt = last_emit.elapsed();
            if dt >= Duration::from_millis(250) {
                let instant = bytes_since as f64 / dt.as_secs_f64();
                speed = if speed == 0.0 { instant } else { speed * 0.7 + instant * 0.3 };
                progress("downloading", downloaded, speed);
                last_emit = Instant::now();
                bytes_since = 0;
            }
        }
        file.flush().await.map_err(|e| e.to_string())?;
        file.sync_all().await.map_err(|e| e.to_string())?;
        if downloaded != expected_bytes {
            return Err(format!(
                "Download incomplete ({downloaded} of {expected_bytes} bytes); it can be resumed"
            ));
        }
        progress("downloading", downloaded, speed);
    }

    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        let _ = std::fs::remove_file(part);
        return Err(format!(
            "SHA-256 mismatch (expected {expected_sha256}, got {actual}). The file was discarded."
        ));
    }
    Ok(DownloadOutcome::Completed)
}

fn content_range_start(resp: &reqwest::Response) -> Option<u64> {
    let v = resp.headers().get(reqwest::header::CONTENT_RANGE)?.to_str().ok()?;
    parse_content_range_start(v)
}

/// `bytes 100-199/1000` → 100
pub fn parse_content_range_start(v: &str) -> Option<u64> {
    v.trim().strip_prefix("bytes ")?.split('-').next()?.trim().parse().ok()
}

async fn wait_cancel(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn write_manifest(path: &Path, m: &Manifest) -> Result<(), String> {
    let b = serde_json::to_vec_pretty(m).map_err(|e| e.to_string())?;
    std::fs::write(manifest_path(path), b).map_err(|e| e.to_string())
}

/// Download (or resume) an official model file. Progress is emitted as
/// `translation-model-progress` events; resolves with the installed model.
#[tauri::command]
pub async fn translation_download_model(
    app: AppHandle,
    jobs: State<'_, DownloadJobs>,
    repo: String,
    filename: String,
) -> Result<LocalModel, String> {
    require_license(&app)?;
    let size = size_of_repo(&repo).ok_or_else(|| format!("Unknown repository: {repo}"))?;
    if !valid_filename(&filename) {
        return Err(format!("Invalid file name: {filename}"));
    }

    let key = job_key(&repo, &filename);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs.0.lock().unwrap();
        if map.contains_key(&key) {
            return Err("This model is already downloading".into());
        }
        map.insert(key.clone(), cancel.clone());
    }
    let _guard = DownloadGuard { jobs: &jobs, key: key.clone() };

    let emit = |status: &str, downloaded: u64, total: u64, speed: f64, error: Option<String>| {
        let _ = app.emit(
            PROGRESS_EVENT,
            Progress {
                key: key.clone(),
                filename: filename.clone(),
                status: status.into(),
                downloaded,
                total,
                bytes_per_sec: speed,
                error,
            },
        );
    };
    emit("starting", 0, 0, 0.0, None);

    let result: Result<Option<LocalModel>, String> = async {
        let client = hf_client()?;
        // Expected hash/size always come from the HF API, never from the caller.
        let files = fetch_repo_files(&client, &repo, size).await?;
        let remote = files
            .into_iter()
            .find(|f| f.filename == filename)
            .ok_or_else(|| format!("{filename} is not in {repo}"))?;

        let root = models_dir(&app)?;
        let dir = root.join(repo_dir_name(&repo));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = dir.join(&filename);
        if dest.is_file() {
            return Err(format!("{filename} is already installed"));
        }
        let part = part_path(&dest);
        let meta_path = part_meta_path(&dest);

        // A partial download for a different file version is discarded.
        let prev: Option<PartMeta> = std::fs::read(&meta_path).ok().and_then(|b| serde_json::from_slice(&b).ok());
        if prev.as_ref().map(|m| m.sha256 != remote.sha256 || m.bytes != remote.bytes).unwrap_or(true) {
            let _ = std::fs::remove_file(&part);
        }
        let meta = PartMeta {
            repo: repo.clone(),
            filename: filename.clone(),
            sha256: remote.sha256.clone(),
            bytes: remote.bytes,
        };
        std::fs::write(&meta_path, serde_json::to_vec(&meta).unwrap()).map_err(|e| e.to_string())?;

        let url = format!("https://huggingface.co/{repo}/resolve/main/{filename}");
        emit_agent_log(&app, "info", "translate", &format!("Downloading {filename}"), Some(&url));
        let outcome = download_to_part(&client, &url, &part, &remote.sha256, remote.bytes, &cancel, |status, done, speed| {
            emit(status, done, remote.bytes, speed, None)
        })
        .await;
        let outcome = match outcome {
            Ok(o) => o,
            Err(e) => {
                if !part.exists() {
                    let _ = std::fs::remove_file(&meta_path);
                }
                return Err(e);
            }
        };
        if outcome == DownloadOutcome::Cancelled {
            return Ok(None);
        }

        std::fs::rename(&part, &dest).map_err(|e| format!("Cannot install the model: {e}"))?;
        let _ = std::fs::remove_file(&meta_path);
        write_manifest(
            &dest,
            &Manifest {
                repo: Some(repo.clone()),
                filename: filename.clone(),
                bytes: remote.bytes,
                sha256: Some(remote.sha256.clone()),
                verified: true,
                source: "download".into(),
                installed_at: chrono::Utc::now().to_rfc3339(),
            },
        )?;
        if stored_active(&app).is_none() {
            set_stored_active(&app, Some(&dest.canonicalize().unwrap_or(dest.clone())))?;
        }
        let active = resolve_active_model(&app).ok();
        Ok(local_model_from(&dest, active.as_deref()))
    }
    .await;

    match result {
        Ok(Some(model)) => {
            emit("done", model.bytes, model.bytes, 0.0, None);
            emit_agent_log(&app, "info", "translate", &format!("Installed {filename} (SHA-256 verified)"), None);
            Ok(model)
        }
        Ok(None) => {
            emit("cancelled", 0, 0, 0.0, None);
            Err("CANCELLED: Download cancelled (it can be resumed)".into())
        }
        Err(e) => {
            emit("error", 0, 0, 0.0, Some(e.clone()));
            emit_agent_log(&app, "error", "translate", &format!("Download of {filename} failed"), Some(&e));
            Err(e)
        }
    }
}

#[tauri::command]
pub fn translation_cancel_download(jobs: State<'_, DownloadJobs>, repo: String, filename: String) -> bool {
    match jobs.0.lock().unwrap().get(&job_key(&repo, &filename)) {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            true
        }
        None => false,
    }
}

// ─── Import ───

const GGUF_MAGIC: &[u8; 4] = b"GGUF";

fn has_gguf_magic(path: &Path) -> bool {
    let mut magic = [0u8; 4];
    std::fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut magic))
        .map(|_| &magic == GGUF_MAGIC)
        .unwrap_or(false)
}

/// Find an official file by SHA-256 (preferred) or by file name.
fn lookup_official<'a>(cache: &'a CatalogCache, sha: &str, filename: &str) -> (Option<&'a RemoteModelFile>, Option<&'a RemoteModelFile>) {
    let all = || cache.values().flatten();
    (all().find(|f| f.sha256.eq_ignore_ascii_case(sha)), all().find(|f| f.filename == filename))
}

/// Copy a local .gguf into the models directory. Verified against the official
/// SHA-256 when the catalog is known (cached, or fetched briefly if online).
#[tauri::command]
pub async fn translation_import_model(
    app: AppHandle,
    jobs: State<'_, DownloadJobs>,
    source_path: String,
) -> Result<LocalModel, String> {
    require_license(&app)?;
    let src = PathBuf::from(&source_path);
    let filename = src
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string)
        .ok_or("Invalid file path")?;
    if !valid_filename(&filename) || !src.is_file() {
        return Err("Please choose a .gguf file".into());
    }
    if !has_gguf_magic(&src) {
        return Err(format!("{filename} is not a GGUF file"));
    }
    let total = std::fs::metadata(&src).map_err(|e| e.to_string())?.len();

    let key = format!("import:{filename}");
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0.lock().unwrap().insert(key.clone(), cancel.clone());
    let _guard = DownloadGuard { jobs: &jobs, key: key.clone() };
    let emit = |status: &str, done: u64, error: Option<String>| {
        let _ = app.emit(
            PROGRESS_EVENT,
            Progress {
                key: key.clone(),
                filename: filename.clone(),
                status: status.into(),
                downloaded: done,
                total,
                bytes_per_sec: 0.0,
                error,
            },
        );
    };

    let result: Result<LocalModel, String> = async {
        emit("hashing", 0, None);
        let (hasher, _) = hash_file_prefix(src.clone()).await?;
        let sha = hex::encode(hasher.finalize());

        let root = models_dir(&app)?;
        let mut cache = read_catalog_cache(&root);
        if lookup_official(&cache, &sha, &filename) == (None, None) {
            // Not known yet: try a quick online lookup (ignored when offline).
            if let Some((size, _)) = parse_model_filename(&filename) {
                if let Ok(client) = hf_client() {
                    let repo = repo_for(size);
                    if let Ok(Ok(files)) =
                        tokio::time::timeout(Duration::from_secs(8), fetch_repo_files(&client, &repo, size)).await
                    {
                        cache.insert(repo, files);
                        write_catalog_cache(&root, &cache);
                    }
                }
            }
        }
        let (by_sha, by_name) = lookup_official(&cache, &sha, &filename);
        let official = match (by_sha, by_name) {
            (Some(f), _) => Some(f.clone()),
            (None, Some(_)) => {
                return Err(format!(
                    "{filename} does not match the official file (SHA-256 differs). It may be corrupted or modified."
                ))
            }
            (None, None) => None,
        };

        let dir = match &official {
            Some(f) => root.join(repo_dir_name(&f.repo)),
            None => root.join(IMPORTED_DIR),
        };
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest_name = official.as_ref().map(|f| f.filename.clone()).unwrap_or(filename.clone());
        let dest = dir.join(&dest_name);
        if dest.exists() {
            return Err(format!("{dest_name} is already installed"));
        }
        if src.canonicalize().ok() == dest.canonicalize().ok() {
            return Err("This file is already in the models directory".into());
        }
        emit("downloading", 0, None);
        let (s, d) = (src.clone(), dest.clone());
        // std::fs::copy clones the file on APFS (instant, no extra space).
        tokio::task::spawn_blocking(move || std::fs::copy(&s, &d))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("Copy failed: {e}"))?;
        write_manifest(
            &dest,
            &Manifest {
                repo: official.as_ref().map(|f| f.repo.clone()),
                filename: dest_name.clone(),
                bytes: total,
                sha256: Some(sha.clone()),
                verified: official.is_some(),
                source: "import".into(),
                installed_at: chrono::Utc::now().to_rfc3339(),
            },
        )?;
        if stored_active(&app).is_none() {
            set_stored_active(&app, Some(&dest.canonicalize().unwrap_or(dest.clone())))?;
        }
        let active = resolve_active_model(&app).ok();
        local_model_from(&dest, active.as_deref()).ok_or_else(|| "Import failed".to_string())
    }
    .await;

    match &result {
        Ok(m) => {
            emit("done", total, None);
            emit_agent_log(
                &app,
                "info",
                "translate",
                &format!("Imported {} ({})", m.filename, if m.verified { "SHA-256 verified" } else { "not verified" }),
                None,
            );
        }
        Err(e) => emit("error", 0, Some(e.clone())),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;
    use std::net::TcpListener;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn filename_parsing() {
        assert_eq!(parse_model_filename("plamo-3-translate-0.8b-Q4_K_M.gguf"), Some(("0.8b", "Q4_K_M".into())));
        assert_eq!(parse_model_filename("plamo-3-translate-8b-Q2_K.gguf"), Some(("8b", "Q2_K".into())));
        assert_eq!(parse_model_filename("plamo-3-translate-2b-.gguf"), None);
        assert_eq!(parse_model_filename("other.gguf"), None);
    }

    #[test]
    fn tree_parsing_uses_lfs_oid_and_skips_non_gguf() {
        let tree = json!([
            {"type":"directory","path":"LICENSE"},
            {"type":"file","path":"README.md","size":45514},
            {"type":"file","path":"plamo-3-translate-0.8b-Q2_K.gguf","size":410138816,
             "lfs":{"oid":"aa".repeat(32),"size":410138816}},
            {"type":"file","oid":"00082a2e3ff5ac12216459a889c6f5d5b82ff1ac","size":573126848,
             "lfs":{"oid":"70891ec70dc7ab4205745a38307867c2881b99239f20327927633abfe4bc9ec6","size":573126848,"pointerSize":134},
             "path":"plamo-3-translate-0.8b-Q4_K_M.gguf"},
            {"type":"file","path":"sub/x.gguf","lfs":{"oid":"bb".repeat(32),"size":1}},
            {"type":"file","path":"bad.gguf","lfs":{"oid":"nothex","size":1}}
        ]);
        let files = parse_tree(&tree, "pfnet/plamo-3-translate-0.8b-GGUF", "0.8b");
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].filename, "plamo-3-translate-0.8b-Q4_K_M.gguf");
        assert!(files[0].recommended);
        assert_eq!(files[0].sha256, "70891ec70dc7ab4205745a38307867c2881b99239f20327927633abfe4bc9ec6");
        assert_eq!(files[0].bytes, 573126848);
        assert_eq!(files[1].quant, "Q2_K");
    }

    #[test]
    fn content_range() {
        assert_eq!(parse_content_range_start("bytes 100-199/1000"), Some(100));
        assert_eq!(parse_content_range_start("bytes */1000"), None);
    }

    #[test]
    fn filename_validation() {
        assert!(valid_filename("a.gguf"));
        assert!(!valid_filename("../a.gguf"));
        assert!(!valid_filename("a/b.gguf"));
        assert!(!valid_filename(".hidden.gguf"));
        assert!(!valid_filename("a.bin"));
    }

    #[test]
    fn ensure_inside_rejects_escape() {
        let root = tempdir("inside");
        let f = root.join("m.gguf");
        std::fs::write(&f, b"x").unwrap();
        assert!(ensure_inside(&root, &f).is_ok());
        assert!(ensure_inside(&root, &root.join("..").join(root.file_name().unwrap()).join("m.gguf")).is_ok());
        assert!(ensure_inside(&root, &root.join("..").join("..").join("etc").join("hosts")).is_err());
        assert!(ensure_inside(&root, Path::new("/etc/hosts")).is_err());
        assert!(ensure_inside(&root, &root).is_err());
    }

    #[test]
    fn listing_finds_models_manifests_and_partials() {
        let root = tempdir("list");
        let sub = root.join("plamo-3-translate-0.8b-GGUF");
        std::fs::create_dir_all(&sub).unwrap();
        let m = sub.join("plamo-3-translate-0.8b-Q4_K_M.gguf");
        std::fs::write(&m, b"GGUFxxxx").unwrap();
        write_manifest(
            &m,
            &Manifest {
                repo: Some(repo_for("0.8b")),
                filename: "plamo-3-translate-0.8b-Q4_K_M.gguf".into(),
                bytes: 8,
                sha256: Some("ab".repeat(32)),
                verified: true,
                source: "download".into(),
                installed_at: "now".into(),
            },
        )
        .unwrap();
        std::fs::write(root.join("plamo-3-translate-2b-Q2_K.gguf"), b"GGUF").unwrap(); // manual
        let dest = sub.join("plamo-3-translate-0.8b-Q2_K.gguf");
        std::fs::write(part_path(&dest), b"12345").unwrap();
        std::fs::write(
            part_meta_path(&dest),
            serde_json::to_vec(&PartMeta {
                repo: repo_for("0.8b"),
                filename: "plamo-3-translate-0.8b-Q2_K.gguf".into(),
                sha256: "cd".repeat(32),
                bytes: 100,
            })
            .unwrap(),
        )
        .unwrap();

        let active = m.canonicalize().unwrap();
        let l = list_local(&root, Some(&active), &[]);
        assert_eq!(l.models.len(), 2);
        let manual = l.models.iter().find(|x| x.source == "manual").unwrap();
        assert_eq!(manual.size_label.as_deref(), Some("2b"));
        assert!(!manual.verified);
        let dl = l.models.iter().find(|x| x.source == "download").unwrap();
        assert!(dl.verified && dl.active);
        assert_eq!(l.partials.len(), 1);
        assert_eq!((l.partials[0].downloaded, l.partials[0].total), (5, 100));
    }

    // ── Download against a tiny local HTTP server with Range support ──

    struct TestServer {
        port: u16,
        requests: Arc<AtomicUsize>,
        ranges: Arc<Mutex<Vec<Option<String>>>>,
    }

    /// `ignore_range`: answer 200 with the full body even for Range requests.
    /// `cut_after`: close the connection after this many body bytes (once).
    fn serve(body: Vec<u8>, ignore_range: bool, cut_after: Option<usize>) -> TestServer {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(AtomicUsize::new(0));
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let (rq, rg) = (requests.clone(), ranges.clone());
        std::thread::spawn(move || {
            let mut cut = cut_after;
            for stream in listener.incoming() {
                let mut s = stream.unwrap();
                let mut buf = [0u8; 4096];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                rq.fetch_add(1, Ordering::SeqCst);
                let range = req
                    .lines()
                    .find(|l| l.to_ascii_lowercase().starts_with("range:"))
                    .map(|l| l[6..].trim().to_string());
                rg.lock().unwrap().push(range.clone());
                let start = range
                    .as_deref()
                    .filter(|_| !ignore_range)
                    .and_then(|r| r.strip_prefix("bytes="))
                    .and_then(|r| r.trim_end_matches('-').parse::<usize>().ok());
                let (status, slice) = match start {
                    Some(st) => (
                        format!(
                            "206 Partial Content\r\nContent-Range: bytes {st}-{}/{}",
                            body.len() - 1,
                            body.len()
                        ),
                        &body[st..],
                    ),
                    None => ("200 OK".to_string(), &body[..]),
                };
                let send = match cut.take() {
                    Some(c) => &slice[..c.min(slice.len())],
                    None => slice,
                };
                let head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", slice.len());
                let _ = s.write_all(head.as_bytes());
                let _ = s.write_all(send);
            }
        });
        TestServer { port, requests, ranges }
    }

    fn tempdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("filonex-models-test-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn body() -> (Vec<u8>, String) {
        let body: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let sha = hex::encode(Sha256::digest(&body));
        (body, sha)
    }

    fn run(port: u16, part: &Path, sha: &str, len: u64) -> Result<DownloadOutcome, String> {
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let cancel = AtomicBool::new(false);
        tauri::async_runtime::block_on(download_to_part(
            &client,
            &format!("http://127.0.0.1:{port}/f"),
            part,
            sha,
            len,
            &cancel,
            |_, _, _| {},
        ))
    }

    #[test]
    fn download_fresh_verifies_sha() {
        let (body, sha) = body();
        let srv = serve(body.clone(), false, None);
        let part = tempdir("fresh").join("m.gguf.part");
        assert_eq!(run(srv.port, &part, &sha, body.len() as u64), Ok(DownloadOutcome::Completed));
        assert_eq!(std::fs::read(&part).unwrap(), body);
    }

    #[test]
    fn download_resumes_with_range_after_interruption() {
        let (body, sha) = body();
        let srv = serve(body.clone(), false, Some(70_000));
        let part = tempdir("resume").join("m.gguf.part");
        let first = run(srv.port, &part, &sha, body.len() as u64);
        assert!(first.is_err(), "first attempt should be cut: {first:?}");
        let partial = std::fs::metadata(&part).unwrap().len();
        assert!(partial > 0 && partial < body.len() as u64);

        assert_eq!(run(srv.port, &part, &sha, body.len() as u64), Ok(DownloadOutcome::Completed));
        assert_eq!(std::fs::read(&part).unwrap(), body);
        let ranges = srv.ranges.lock().unwrap();
        assert_eq!(ranges[0], None);
        assert_eq!(ranges[1].as_deref(), Some(format!("bytes={partial}-").as_str()));
    }

    #[test]
    fn download_restarts_when_server_ignores_range() {
        let (body, sha) = body();
        let srv = serve(body.clone(), true, None);
        let part = tempdir("norange").join("m.gguf.part");
        std::fs::write(&part, &body[..1000]).unwrap();
        assert_eq!(run(srv.port, &part, &sha, body.len() as u64), Ok(DownloadOutcome::Completed));
        assert_eq!(std::fs::read(&part).unwrap(), body);
    }

    #[test]
    fn corrupted_partial_fails_sha_and_is_discarded() {
        let (body, sha) = body();
        let srv = serve(body.clone(), false, None);
        let part = tempdir("corrupt").join("m.gguf.part");
        let mut bad = body[..50_000].to_vec();
        bad[10] ^= 0xff;
        std::fs::write(&part, &bad).unwrap();
        let r = run(srv.port, &part, &sha, body.len() as u64);
        assert!(r.unwrap_err().contains("SHA-256 mismatch"));
        assert!(!part.exists());
        assert_eq!(srv.requests.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn already_complete_part_needs_no_request() {
        let (body, sha) = body();
        let srv = serve(body.clone(), false, None);
        let part = tempdir("complete").join("m.gguf.part");
        std::fs::write(&part, &body).unwrap();
        assert_eq!(run(srv.port, &part, &sha, body.len() as u64), Ok(DownloadOutcome::Completed));
        assert_eq!(srv.requests.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn cancel_keeps_partial_file() {
        let (body, sha) = body();
        let srv = serve(body.clone(), false, None);
        let part = tempdir("cancel").join("m.gguf.part");
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let cancel = AtomicBool::new(true);
        let r = tauri::async_runtime::block_on(download_to_part(
            &client,
            &format!("http://127.0.0.1:{}/f", srv.port),
            &part,
            &sha,
            body.len() as u64,
            &cancel,
            |_, _, _| {},
        ));
        assert_eq!(r, Ok(DownloadOutcome::Cancelled));
    }

    #[test]
    fn gguf_magic_check() {
        let d = tempdir("magic");
        std::fs::write(d.join("a.gguf"), b"GGUF\x03\x00").unwrap();
        std::fs::write(d.join("b.gguf"), b"PK\x03\x04").unwrap();
        assert!(has_gguf_magic(&d.join("a.gguf")));
        assert!(!has_gguf_magic(&d.join("b.gguf")));
    }
}

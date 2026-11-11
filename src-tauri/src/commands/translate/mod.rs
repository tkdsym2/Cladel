//! Translate node backend: local PLaMo 3 Translate (GGUF) via a llama.cpp
//! `llama-server` sidecar.
//!
//! - `server`: sidecar lifecycle (start / health / restart / kill)
//! - `pfml`: PFML3 prompt construction (+ control-token sanitizing)
//! - `chunk`: splitting long text into paragraph/sentence pieces
//! - `completion`: streaming `/completion` client
//! - `models`: catalog / download / import / delete / active model
//! - `license`: PLaMo Community License text + consent
//!
//! Translation only talks to 127.0.0.1; nothing leaves the machine.

pub mod chunk;
pub mod completion;
pub mod license;
pub mod models;
pub mod pfml;
pub mod server;
pub mod sync;
pub mod typst_seg;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::commands::agent::emit_agent_log;
pub use pfml::TranslateOptions;
use typst_seg::{Piece, Unit};
pub use server::{LlamaServerState, ServerStatus};

// ─── Server lifecycle commands ───

/// Absolute path of `app_data_dir/models/` (created if missing).
#[tauri::command]
pub fn translation_models_dir(app: AppHandle) -> Result<String, String> {
    Ok(server::models_dir(&app)?.to_string_lossy().into_owned())
}

/// Start (or reuse) llama-server for `model_path`; restarts it if a different
/// model is currently loaded. Resolves once `/health` reports ready.
#[tauri::command]
pub async fn translation_server_start(
    app: AppHandle,
    state: State<'_, LlamaServerState>,
    model_path: String,
) -> Result<ServerStatus, String> {
    state.ensure_running(&app, &PathBuf::from(model_path)).await
}

#[tauri::command]
pub fn translation_server_status(state: State<'_, LlamaServerState>) -> Option<ServerStatus> {
    state.status()
}

#[tauri::command]
pub async fn translation_server_stop(app: AppHandle, state: State<'_, LlamaServerState>) -> Result<(), String> {
    state.stop(&app).await;
    Ok(())
}

// ─── Translation ───

/// How an input's text is structured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum InputFormat {
    /// Typst source (Note nodes): only prose is translated, markup preserved.
    Typst,
    /// Plain text / Markdown (Core, Paper abstract, typed text).
    #[default]
    Plain,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TranslateInput {
    pub text: String,
    #[serde(default)]
    pub format: InputFormat,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TranslateRequest {
    /// Caller-chosen id, used by `translate_cancel`.
    pub job_id: String,
    /// Omit to use the active model (Settings → Translation).
    #[serde(default)]
    pub model_path: Option<String>,
    /// Inputs translated in order and joined with a blank line.
    #[serde(default)]
    pub inputs: Vec<TranslateInput>,
    /// Shorthand for a single plain-text input.
    #[serde(default)]
    pub text: Option<String>,
    /// Image node display_id → caption (node title). In Typst inputs, lines
    /// holding only `{{@image_N}}` become explicit `#figure(...)`s whose
    /// caption is translated (see `typst_seg::expand_figure_refs`).
    #[serde(default)]
    pub figures: HashMap<String, String>,
    #[serde(flatten)]
    pub options: TranslateOptions,
}

impl TranslateRequest {
    fn all_inputs(&self) -> Vec<TranslateInput> {
        let mut v = self.inputs.clone();
        if let Some(t) = &self.text {
            v.push(TranslateInput { text: t.clone(), format: InputFormat::Plain });
        }
        v
    }
}

/// Streamed to the frontend over a Tauri channel. The running document is
/// `segment.prefix` (everything assembled before the current piece, incl.
/// untouched markup) followed by the `delta` texts of that piece. The
/// command's return value holds the final text.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TranslateEvent {
    /// Starting llama-server / loading the model (first run or model change).
    Loading,
    Started { chunk_count: usize },
    Segment { chunk_index: usize, prefix: String },
    Delta { chunk_index: usize, text: String },
    ChunkDone { chunk_index: usize },
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct TranslateResult {
    pub text: String,
    pub cancelled: bool,
    pub chunk_count: usize,
    pub tokens_predicted: u64,
    pub duration_ms: u64,
    /// A piece hit the generation limit (output may be cut short).
    pub truncated: bool,
    /// Pieces that needed the placeholder retry to keep their markup.
    pub masked_retries: usize,
    /// Pieces left untranslated because their markup could not be preserved.
    pub kept_original: Vec<String>,
    /// For a single Typst input: (source block, translated block) pairs, the
    /// starting snapshot of a bilingual note pair (see `sync`).
    pub pairs: Option<Vec<sync::SyncPair>>,
}

/// Cancel flags of running jobs (managed state).
#[derive(Default)]
pub struct TranslateJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

struct JobGuard<'a> {
    jobs: &'a TranslateJobs,
    id: String,
}

impl Drop for JobGuard<'_> {
    fn drop(&mut self) {
        self.jobs.0.lock().unwrap().remove(&self.id);
    }
}

/// Translate with streaming. Starts llama-server on first use.
#[tauri::command]
pub async fn translate_text(
    app: AppHandle,
    server: State<'_, LlamaServerState>,
    jobs: State<'_, TranslateJobs>,
    request: TranslateRequest,
    on_event: Channel<TranslateEvent>,
) -> Result<TranslateResult, String> {
    request.options.validate()?;
    let inputs = request.all_inputs();

    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0.lock().unwrap().insert(request.job_id.clone(), cancel.clone());
    let _guard = JobGuard { jobs: &jobs, id: request.job_id.clone() };

    let model_path = match &request.model_path {
        Some(p) => PathBuf::from(p),
        None => models::resolve_active_model(&app)?,
    };
    if server.status().map(|s| PathBuf::from(s.model_path)) != model_path.canonicalize().ok() {
        let _ = on_event.send(TranslateEvent::Loading);
    }
    let status = server.ensure_running(&app, &model_path).await?;
    if cancel.load(Ordering::Relaxed) {
        return Ok(TranslateResult { cancelled: true, ..Default::default() });
    }

    let client = server::local_http_client()?;
    let result = run_translation(&client, status.port, &inputs, &request.figures, &request.options, &cancel, |ev| {
        let _ = on_event.send(ev);
    })
    .await;

    match &result {
        Ok(r) => {
            emit_agent_log(
                &app,
                "info",
                "translate",
                &format!(
                    "Translated {} chars -> {} ({} piece(s), {} tokens, {} ms{}{}{})",
                    inputs.iter().map(|i| i.text.chars().count()).sum::<usize>(),
                    request.options.target_lang,
                    r.chunk_count,
                    r.tokens_predicted,
                    r.duration_ms,
                    if r.masked_retries > 0 { format!(", {} placeholder retries", r.masked_retries) } else { String::new() },
                    if r.cancelled { ", cancelled" } else { "" },
                    if r.truncated { ", TRUNCATED" } else { "" },
                ),
                None,
            );
            if !r.kept_original.is_empty() {
                emit_agent_log(
                    &app,
                    "warn",
                    "translate",
                    &format!("{} piece(s) kept untranslated (markup could not be preserved)", r.kept_original.len()),
                    Some(&r.kept_original.join("\n---\n")),
                );
            }
        }
        Err(e) => emit_agent_log(&app, "error", "translate", "Translation failed", Some(e)),
    }
    result
}

/// Request cancellation of a running `translate_text` job. Returns false if
/// no such job is running.
#[tauri::command]
pub fn translate_cancel(jobs: State<'_, TranslateJobs>, job_id: String) -> bool {
    match jobs.0.lock().unwrap().get(&job_id) {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            true
        }
        None => false,
    }
}

/// Plain text → pieces (paragraph/sentence chunks joined by their separators).
fn plain_plan(text: &str, target_lang: &str) -> Vec<Piece> {
    let mut pieces = Vec::new();
    for c in chunk::split_into_chunks(text, chunk::DEFAULT_MAX_CHARS) {
        pieces.push(Piece::Translate(Unit {
            text: c.text.clone(),
            protected: vec![],
            delimiters: vec![],
            continues_previous: false,
        }));
        let sep = c.sep.render(target_lang);
        if !sep.is_empty() {
            pieces.push(Piece::Keep(sep.to_string()));
        }
    }
    pieces
}

/// A unit never spans a paragraph break, so a blank line in its translation
/// would only split the paragraph (and the note's block structure).
fn collapse_blank_lines(t: &str) -> String {
    use std::sync::OnceLock;
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"\n[ \t]*\n\s*").unwrap()).replace_all(t, "\n").into_owned()
}

/// How many earlier pairs (and characters) to pass as translation history.
const HISTORY_PAIRS: usize = 3;
const HISTORY_CHARS: usize = 1500;

fn history_window(history: &[(String, String)]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut chars = 0;
    for pair in history.iter().rev().take(HISTORY_PAIRS) {
        chars += pair.0.chars().count() + pair.1.chars().count();
        if chars > HISTORY_CHARS && !out.is_empty() {
            break;
        }
        out.push(pair.clone());
    }
    out.reverse();
    out
}

/// Core pipeline (independent of Tauri state, used by the E2E tests):
/// plan (Typst-aware or plain) → per piece: prompt with history → stream →
/// verify markup (retry with placeholders, else keep original) → assemble.
pub async fn run_translation(
    client: &reqwest::Client,
    port: u16,
    inputs: &[TranslateInput],
    figures: &HashMap<String, String>,
    options: &TranslateOptions,
    cancel: &AtomicBool,
    mut on_event: impl FnMut(TranslateEvent),
) -> Result<TranslateResult, String> {
    options.validate()?;
    let started = Instant::now();
    let target = options.target_lang.as_str();
    let inputs: Vec<&TranslateInput> = inputs.iter().filter(|i| !i.text.trim().is_empty()).collect();
    // Typst inputs are planned block by block (top-level paragraphs), so each
    // translated block can be paired with its source block.
    let mut sources: Vec<String> = Vec::new();
    let plans: Vec<Vec<(Option<usize>, Piece)>> = inputs
        .iter()
        .map(|i| match i.format {
            InputFormat::Typst => {
                let doc = sync::Doc::parse(&i.text);
                let mut plan = vec![(None, Piece::Keep(doc.lead.clone()))];
                for (b, sep) in doc.blocks.iter().zip(&doc.seps) {
                    let n = sources.len();
                    sources.push(b.clone());
                    let expanded = typst_seg::expand_figure_refs(b, figures);
                    plan.extend(typst_seg::plan_typst(&expanded, target).into_iter().map(|p| (Some(n), p)));
                    plan.push((None, Piece::Keep(sep.clone())));
                }
                plan
            }
            InputFormat::Plain => plain_plan(&i.text, target).into_iter().map(|p| (None, p)).collect(),
        })
        .collect();
    let mut block_out: Vec<Option<(usize, usize)>> = vec![None; sources.len()];
    let total = plans.iter().flatten().filter(|p| matches!(p.1, Piece::Translate(_))).count();
    let mut result = TranslateResult { chunk_count: total, ..Default::default() };
    on_event(TranslateEvent::Started { chunk_count: total });

    let mut output = String::new();
    let mut history: Vec<(String, String)> = Vec::new();
    let mut index = 0;
    'inputs: for (n, plan) in plans.iter().enumerate() {
        if n > 0 {
            let trimmed = output.trim_end().len();
            output.truncate(trimmed);
            output.push_str("\n\n");
        }
        for (block, piece) in plan {
            let block_start = output.len();
            let mut mark = |output: &String| {
                if let Some(b) = *block {
                    let e = block_out[b].get_or_insert((block_start, block_start));
                    e.1 = output.len();
                }
            };
            let unit = match piece {
                Piece::Keep(s) => {
                    output.push_str(s);
                    mark(&output);
                    continue;
                }
                Piece::Translate(u) => u,
            };
            on_event(TranslateEvent::Segment { chunk_index: index, prefix: output.clone() });

            let hist = history_window(&history);
            let n_predict = completion::n_predict_for(unit.text.chars().count());
            let prompt = pfml::build_prompt_with_history(&unit.text, options, &hist);
            let outcome = completion::stream_completion(client, port, &prompt, n_predict, cancel, |delta| {
                on_event(TranslateEvent::Delta { chunk_index: index, text: delta.to_string() });
            })
            .await?;
            result.tokens_predicted += outcome.tokens_predicted.unwrap_or(0);
            if outcome.cancelled {
                output.push_str(&outcome.text);
                result.cancelled = true;
                break 'inputs;
            }
            let mut truncated = outcome.stop_type.as_deref() == Some("limit");
            let first = typst_seg::repair_line_comments(unit, outcome.text.trim());

            let needs_check = !unit.protected.is_empty() || !unit.delimiters.is_empty();
            let accepted = if first.is_empty() {
                None
            } else if !needs_check || typst_seg::check_output(unit, &first).is_ok() {
                Some(first)
            } else {
                // Retry with markup masked as ⟦n⟧ (not streamed).
                on_event(TranslateEvent::Segment { chunk_index: index, prefix: output.clone() });
                let (masked, tokens) = typst_seg::mask(unit);
                let prompt = pfml::build_prompt_with_history(&masked, options, &hist);
                let retry = completion::stream_completion(client, port, &prompt, n_predict, cancel, |_| {}).await?;
                result.tokens_predicted += retry.tokens_predicted.unwrap_or(0);
                if retry.cancelled {
                    result.cancelled = true;
                    break 'inputs;
                }
                truncated = retry.stop_type.as_deref() == Some("limit");
                result.masked_retries += 1;
                typst_seg::unmask(retry.text.trim(), &tokens)
                    .ok()
                    .map(|t| typst_seg::repair_line_comments(unit, &t))
                    .filter(|t| typst_seg::check_output(unit, t).is_ok())
            };
            result.truncated |= truncated;

            // Typst units never span a paragraph break (plain chunks may hold several paragraphs).
            let accepted = if block.is_some() { accepted.map(|t| collapse_blank_lines(&t)) } else { accepted };
            match accepted {
                Some(t) => {
                    output.push_str(&t);
                    history.push((unit.text.clone(), t));
                }
                None => {
                    output.push_str(&unit.text);
                    result.kept_original.push(unit.text.chars().take(80).collect());
                }
            }
            mark(&output);
            on_event(TranslateEvent::ChunkDone { chunk_index: index });
            index += 1;
        }
    }

    result.text = output.trim_end().to_string();
    if inputs.len() == 1 && inputs[0].format == InputFormat::Typst && !result.cancelled {
        result.pairs = Some(
            sources
                .into_iter()
                .zip(block_out)
                .map(|(src, r)| sync::SyncPair {
                    src: Some(src),
                    dst: r.map(|(a, b)| output[a..b].trim().to_string()).filter(|t| !t.is_empty()),
                })
                .collect(),
        );
    }
    result.duration_ms = started.elapsed().as_millis() as u64;
    Ok(result)
}

/// End-to-end test against a real model. Not run by default:
///
/// ```sh
/// PLAMO_GGUF="$HOME/Library/Application Support/com.filonex.desktop/models/plamo-3-translate-0.8b-Q4_K_M.gguf" \
///   cargo test --lib translate::e2e -- --ignored --nocapture
/// ```
#[cfg(test)]
mod e2e {
    use super::*;
    use std::path::Path;
    use std::time::Duration;

    struct Server(std::process::Child, u16);
    impl Drop for Server {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    fn start_server() -> Server {
        let model = std::env::var("PLAMO_GGUF").expect("set PLAMO_GGUF to a .gguf path");
        let bin = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/llama-server-aarch64-apple-darwin");
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let child = std::process::Command::new(bin)
            .args(server::server_args(Path::new(&model), port))
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn llama-server");
        let server = Server(child, port);
        tauri::async_runtime::block_on(async {
            let client = server::local_http_client().unwrap();
            for _ in 0..240 {
                if let Ok(r) = client.get(format!("http://127.0.0.1:{port}/health")).send().await {
                    if r.status().is_success() {
                        return;
                    }
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            panic!("llama-server not healthy");
        });
        server
    }

    fn run(port: u16, inputs: Vec<TranslateInput>, options: TranslateOptions) -> (TranslateResult, String) {
        run_with(port, inputs, &HashMap::new(), options)
    }

    fn run_with(
        port: u16,
        inputs: Vec<TranslateInput>,
        figures: &HashMap<String, String>,
        options: TranslateOptions,
    ) -> (TranslateResult, String) {
        let client = server::local_http_client().unwrap();
        let cancel = AtomicBool::new(false);
        // Rebuild the running document exactly like the frontend does.
        let mut live = String::new();
        let r = tauri::async_runtime::block_on(run_translation(&client, port, &inputs, figures, &options, &cancel, |ev| match ev {
            TranslateEvent::Segment { prefix, .. } => live = prefix,
            TranslateEvent::Delta { text, .. } => live.push_str(&text),
            _ => {}
        }))
        .unwrap();
        (r, live)
    }

    fn translate(port: u16, text: &str, options: TranslateOptions) -> (TranslateResult, String) {
        run(port, vec![TranslateInput { text: text.into(), format: InputFormat::Plain }], options)
    }

    fn opts(target: &str) -> TranslateOptions {
        TranslateOptions { target_lang: target.into(), ..Default::default() }
    }

    #[test]
    #[ignore]
    fn e2e_translations() {
        let s = start_server();

        let (r, streamed) = translate(s.1, "こんにちは、世界。", opts("en"));
        println!("ja->en: {:?} (streamed {:?})", r.text, streamed);
        assert!(r.text.to_lowercase().contains("hello"));
        assert_eq!(streamed.trim(), r.text);

        let mut o = opts("ja");
        o.form = Some(pfml::JaForm::Polite);
        let (polite, _) = translate(s.1, "This tool helps researchers organize their thoughts.", o.clone());
        o.form = Some(pfml::JaForm::Plain);
        let (plain, _) = translate(s.1, "This tool helps researchers organize their thoughts.", o);
        println!("en->ja polite: {}\nen->ja plain:  {}", polite.text, plain.text);
        assert!(polite.text.contains("ます") || polite.text.contains("です"));
        assert_ne!(polite.text, plain.text);

        let mut o = opts("en");
        o.glossary = vec![pfml::GlossaryEntry { src: "管理画面".into(), dst: "dashboard".into() }];
        let (g, _) = translate(s.1, "プロジェクトの管理画面を開いてください。", o);
        println!("glossary: {}", g.text);
        assert!(g.text.to_lowercase().contains("dashboard"));

        let (multi, _) = translate(s.1, "最初の段落です。\n\n二番目の段落です。", opts("en"));
        println!("multi: {:?} ({} piece(s))", multi.text, multi.chunk_count);
        assert!(multi.text.contains("\n\n"), "paragraph break lost: {:?}", multi.text);
    }

    #[test]
    #[ignore]
    fn e2e_cancel() {
        let s = start_server();
        let client = server::local_http_client().unwrap();
        let cancel = AtomicBool::new(false);
        let long = "研究者が思考を整理するためのアプリケーションです。".repeat(40);
        let mut deltas = 0;
        let inputs = vec![TranslateInput { text: long, format: InputFormat::Plain }];
        let r = tauri::async_runtime::block_on(run_translation(&client, s.1, &inputs, &HashMap::new(), &opts("en"), &cancel, |ev| {
            if matches!(ev, TranslateEvent::Delta { .. }) {
                deltas += 1;
                if deltas == 5 {
                    cancel.store(true, Ordering::Relaxed);
                }
            }
        }))
        .unwrap();
        println!("cancelled={} after {} deltas: {:?}", r.cancelled, deltas, r.text);
        assert!(r.cancelled);
        assert!(deltas < 20);
    }

    const TYPST_DOC: &str = "#set text(font: \"Noto Serif JP\", lang: \"ja\")\n#let 手法名 = [思考地図法]\n\n= はじめに\n研究者は日々多くの文献を読み、// TODO: 引用を追加\n思考を整理する必要がある。本研究では #手法名 を提案する。\n\n$ E = sum_(i=1)^n w_i x_i $ <eq:energy>\n\n@eq:energy に示すように、重み $w_i$ が重要である。先行研究 {@smith2020} よりも *高速* である。\n\n#figure(\n  image(\"fig1.png\"),\n  caption: [提案手法の概要],\n) <fig:overview>\n\n{{@image_1}}\n\n```python\nprint(\"こんにちは\")\n```\n\n- 文献管理\n- 思考の可視化\n\n思考地図は研究者の理解を助ける。思考地図は {@table_1[2,3]} の値を可視化する。\n";

    #[test]
    #[ignore]
    fn e2e_typst_note() {
        let s = start_server();
        let figures: HashMap<String, String> = [("image_1".to_string(), "実験装置の写真".to_string())].into();
        let input = TranslateInput { text: TYPST_DOC.into(), format: InputFormat::Typst };
        let (r, live) = run_with(s.1, vec![input], &figures, opts("en"));
        println!("{}\n--- pieces={} retries={} kept={:?}", r.text, r.chunk_count, r.masked_retries, r.kept_original);
        let out = &r.text;
        // Code / math / raw / refs untouched
        for keep in [
            "#let 手法名 = [",
            "#手法名",
            "$ E = sum_(i=1)^n w_i x_i $ <eq:energy>",
            "@eq:energy",
            "$w_i$",
            "{@smith2020}",
            "image(\"fig1.png\")",
            "<fig:overview>",
            "print(\"こんにちは\")",
            "{@table_1[2,3]}",
            "// TODO: 引用を追加",
            "#figure(image(\"@image_1\", width: 80%), caption: [",
            "]) <fig:image_1>",
        ] {
            assert!(out.contains(keep), "lost {keep:?}");
        }
        assert!(out.contains("lang: \"en\""));
        assert!(!typst::syntax::parse(out).erroneous(), "output is not valid Typst");
        // Prose (incl. heading, list, caption) translated
        assert!(!out.contains("はじめに") && !out.contains("文献管理") && !out.contains("提案手法の概要") && !out.contains("実験装置"));
        // Block pairs: one per source block, the translations make up the output.
        let pairs = r.pairs.as_ref().expect("pairs for a single Typst input");
        assert_eq!(pairs.len(), sync::blocks(TYPST_DOC).len());
        assert_eq!(pairs.iter().map(|p| p.dst.clone().unwrap()).collect::<Vec<_>>(), sync::blocks(out));
        assert!(pairs.iter().any(|p| p.src.as_deref() == Some("{{@image_1}}")
            && p.dst.as_deref().unwrap().starts_with("#figure(image(\"@image_1\"")));
        assert!(sync::plan(TYPST_DOC, out, pairs.clone()).is_empty());
        // The streamed document is built from the same prefix (incl. untouched code).
        assert!(live.contains("lang: \"en\"") && live.contains("#let 手法名"));
    }

    #[test]
    #[ignore]
    fn e2e_sync_round_trip() {
        use sync::{ItemKind, Side, SyncAction};
        let s = start_server();
        let figures: HashMap<String, String> = [("image_1".to_string(), "実験装置の写真".to_string())].into();
        let ja0 = "= はじめに\n\n研究者は日々多くの文献を読む。\n\n{{@image_1}}\n\n本研究では新しい手法を提案する。\n";
        let (r, _) = run_with(s.1, vec![TranslateInput { text: ja0.into(), format: InputFormat::Typst }], &figures, opts("en"));
        let pairs = r.pairs.clone().unwrap();
        // Hand edit on the EN side (figure width) + an edit and an addition on the JA side.
        let en0 = r.text.replace("width: 80%", "width: 50%");
        let ja1 = ja0
            .replace("本研究では新しい手法を提案する。", "本研究では高速な手法を提案する。")
            .replace("{{@image_1}}\n\n", "{{@image_1}}\n\n実験は三回行った。\n\n");
        let items = sync::plan(&ja1, &en0, pairs.clone());
        println!("items: {:?}", items.iter().map(|i| (i.kind, i.side, &i.key)).collect::<Vec<_>>());

        // Apply every JA→EN change with a real translation; ignore the layout-only EN edit.
        let (mut ja, mut en, mut pairs) = (ja1.clone(), en0.clone(), pairs);
        loop {
            let items = sync::plan(&ja, &en, pairs.clone());
            let Some(it) = items.into_iter().next() else { break };
            let (action, tr) = match (it.kind, it.side) {
                (ItemKind::Modified | ItemKind::Added, Side::Src) => {
                    let (t, _) = run_with(
                        s.1,
                        vec![TranslateInput { text: it.src_text.clone().unwrap(), format: InputFormat::Typst }],
                        &figures,
                        opts("en"),
                    );
                    (SyncAction::WriteDst, Some(t.text))
                }
                (ItemKind::Modified, Side::Dst) => (SyncAction::Ignore, None),
                other => panic!("unexpected item {other:?}"),
            };
            let st = sync::apply(&ja, &en, pairs, &it.key, action, tr.as_deref()).unwrap();
            (ja, en, pairs) = (st.source_text, st.target_text, st.pairs);
        }
        println!("--- EN after sync ---\n{en}");
        assert_eq!(ja, ja1, "JA untouched");
        assert!(en.contains("width: 50%"), "hand edit kept");
        assert!(!en.contains("実験") && !en.contains("高速"));
        assert_eq!(sync::blocks(&en).len(), sync::blocks(&ja).len());

        // EN → JA: edit the English conclusion and carry it back.
        let en2 = {
            let b = sync::blocks(&en);
            en.replace(b.last().unwrap().as_str(), "This study proposes a fast and accurate method.")
        };
        let items = sync::plan(&ja, &en2, pairs.clone());
        assert_eq!(items.len(), 1);
        assert_eq!((items[0].kind, items[0].side), (ItemKind::Modified, Side::Dst));
        let mut o = opts("ja");
        o.source_lang = Some("en".into());
        let (t, _) = run(s.1, vec![TranslateInput { text: items[0].dst_text.clone().unwrap(), format: InputFormat::Typst }], o);
        let st = sync::apply(&ja, &en2, pairs, &items[0].key, SyncAction::WriteSrc, Some(&t.text)).unwrap();
        println!("--- JA after EN→JA ---\n{}", st.source_text);
        assert!(st.items.is_empty());
        assert!(st.source_text.starts_with("= はじめに\n\n研究者は日々多くの文献を読む。"));
        assert!(!st.source_text.contains("高速な手法を提案する。"), "last JA paragraph replaced");
    }
}

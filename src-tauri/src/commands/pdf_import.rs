use regex::Regex;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use super::bibtex::generate_bibtex_entry;

const STORE_FILE: &str = "settings.json";
const API_KEY_FIELD: &str = "anthropic_api_key";
const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL: &str = "claude-sonnet-4-20250514";
const S2_BASE_URL: &str = "https://api.semanticscholar.org/graph/v1";
const CROSSREF_BASE_URL: &str = "https://api.crossref.org/works";
const API_TIMEOUT: Duration = Duration::from_secs(30);

// ─── Public types ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfMetadata {
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<String>,
    pub abstract_text: Option<String>,
    pub journal: Option<String>,
    pub doi: Option<String>,
    pub bibtex: Option<String>,
    pub extraction_method: String,
}

// ─── Text extraction ───

pub(crate) fn extract_text_from_pdf(file_path: &str) -> Result<String, String> {
    let bytes = std::fs::read(file_path)
        .map_err(|e| format!("Failed to read PDF file: {e}"))?;

    let text = pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("password") || msg.contains("encrypted") {
                "Failed to read PDF file: the document is password-protected.".to_string()
            } else {
                format!("Failed to read PDF file: {msg}")
            }
        })?;

    if text.trim().is_empty() {
        return Err(
            "Could not extract text from PDF. The file may be a scanned document without a text layer."
                .to_string(),
        );
    }

    // Limit to approximately the first 2-3 pages of text.
    // Academic pages average ~3000-4000 chars; cap at ~10000 chars.
    let truncated = if text.len() > 10_000 {
        // Find a word boundary near the limit
        let end = text[..10_000]
            .rfind(char::is_whitespace)
            .unwrap_or(10_000);
        text[..end].to_string()
    } else {
        text
    };

    Ok(truncated)
}

// ─── DOI extraction ───

fn find_doi(text: &str) -> Option<String> {
    // Match DOI patterns: 10.XXXX/... (the standard DOI format)
    let doi_re = Regex::new(r"(?i)10\.\d{4,9}/[^\s]+").unwrap();

    if let Some(m) = doi_re.find(text) {
        let doi = m.as_str();
        // Clean trailing punctuation that isn't part of the DOI
        let doi = doi.trim_end_matches(|c: char| {
            matches!(c, '.' | ',' | ';' | ')' | ']' | '}' | '>' | '\'' | '"')
        });
        return Some(doi.to_string());
    }

    // Also check for doi.org/ URL patterns
    let url_re = Regex::new(r"(?i)doi\.org/(10\.\d{4,9}/[^\s]+)").unwrap();
    if let Some(caps) = url_re.captures(text) {
        if let Some(m) = caps.get(1) {
            let doi = m.as_str().trim_end_matches(|c: char| {
                matches!(c, '.' | ',' | ';' | ')' | ']' | '}' | '>' | '\'' | '"')
            });
            return Some(doi.to_string());
        }
    }

    None
}

// ─── Semantic Scholar DOI lookup ───

#[derive(Deserialize)]
struct S2DoiPaper {
    title: Option<String>,
    authors: Option<Vec<S2DoiAuthor>>,
    year: Option<i32>,
    #[serde(rename = "abstract")]
    abstract_text: Option<String>,
    venue: Option<String>,
}

#[derive(Deserialize)]
struct S2DoiAuthor {
    name: Option<String>,
}

async fn lookup_semantic_scholar(doi: &str) -> Result<PdfMetadata, String> {
    let client = reqwest::Client::builder()
        .timeout(API_TIMEOUT)
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let url = format!(
        "{S2_BASE_URL}/paper/DOI:{doi}?fields=title,authors,year,abstract,venue"
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Semantic Scholar request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Semantic Scholar returned HTTP {}",
            resp.status()
        ));
    }

    let paper: S2DoiPaper = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Semantic Scholar response: {e}"))?;

    let title = paper.title.unwrap_or_default();
    if title.is_empty() {
        return Err("Semantic Scholar returned no title".to_string());
    }

    let authors: Vec<String> = paper
        .authors
        .unwrap_or_default()
        .into_iter()
        .filter_map(|a| a.name)
        .collect();

    let year = paper.year.map(|y| y.to_string());

    Ok(PdfMetadata {
        title,
        authors,
        year,
        abstract_text: paper.abstract_text,
        journal: paper.venue.filter(|v| !v.is_empty()),
        doi: Some(doi.to_string()),
        bibtex: None,
        extraction_method: "doi_lookup".to_string(),
    })
}

// ─── CrossRef DOI lookup ───

#[derive(Deserialize)]
struct CrossRefResponse {
    message: Option<CrossRefWork>,
}

#[derive(Deserialize)]
struct CrossRefWork {
    title: Option<Vec<String>>,
    author: Option<Vec<CrossRefAuthor>>,
    #[serde(rename = "container-title")]
    container_title: Option<Vec<String>>,
    #[serde(rename = "published-print")]
    published_print: Option<CrossRefDate>,
    #[serde(rename = "published-online")]
    published_online: Option<CrossRefDate>,
    #[serde(rename = "abstract")]
    abstract_text: Option<String>,
}

#[derive(Deserialize)]
struct CrossRefAuthor {
    given: Option<String>,
    family: Option<String>,
}

#[derive(Deserialize)]
struct CrossRefDate {
    #[serde(rename = "date-parts")]
    date_parts: Option<Vec<Vec<i32>>>,
}

impl CrossRefDate {
    fn year(&self) -> Option<String> {
        self.date_parts
            .as_ref()
            .and_then(|parts| parts.first())
            .and_then(|part| part.first())
            .map(|y| y.to_string())
    }
}

async fn lookup_crossref(doi: &str) -> Result<PdfMetadata, String> {
    let client = reqwest::Client::builder()
        .timeout(API_TIMEOUT)
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let url = format!("{CROSSREF_BASE_URL}/{doi}");

    let resp = client
        .get(&url)
        .header("User-Agent", "Cladel/0.1 (mailto:dev@cladel.app)")
        .send()
        .await
        .map_err(|e| format!("CrossRef request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("CrossRef returned HTTP {}", resp.status()));
    }

    let cr: CrossRefResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse CrossRef response: {e}"))?;

    let work = cr.message.ok_or("CrossRef returned no data")?;

    let title = work
        .title
        .as_ref()
        .and_then(|t| t.first())
        .cloned()
        .unwrap_or_default();

    if title.is_empty() {
        return Err("CrossRef returned no title".to_string());
    }

    let authors: Vec<String> = work
        .author
        .unwrap_or_default()
        .into_iter()
        .filter_map(|a| {
            match (&a.given, &a.family) {
                (Some(g), Some(f)) => Some(format!("{g} {f}")),
                (None, Some(f)) => Some(f.clone()),
                (Some(g), None) => Some(g.clone()),
                (None, None) => None,
            }
        })
        .collect();

    let year = work
        .published_print
        .as_ref()
        .and_then(|d| d.year())
        .or_else(|| work.published_online.as_ref().and_then(|d| d.year()));

    let journal = work
        .container_title
        .as_ref()
        .and_then(|t| t.first())
        .cloned();

    // CrossRef abstracts may contain JATS XML tags; strip them
    let abstract_text = work.abstract_text.map(|a| strip_jats_tags(&a));

    Ok(PdfMetadata {
        title,
        authors,
        year,
        abstract_text,
        journal,
        doi: Some(doi.to_string()),
        bibtex: None,
        extraction_method: "doi_lookup".to_string(),
    })
}

/// Strip JATS XML tags from CrossRef abstract text.
fn strip_jats_tags(text: &str) -> String {
    let tag_re = Regex::new(r"<[^>]+>").unwrap();
    tag_re.replace_all(text, "").trim().to_string()
}

// ─── Combined DOI lookup ───

async fn lookup_metadata_by_doi(doi: &str) -> Result<PdfMetadata, String> {
    // Try Semantic Scholar first
    match lookup_semantic_scholar(doi).await {
        Ok(meta) => return Ok(meta),
        Err(e) => {
            eprintln!("[pdf_import] Semantic Scholar lookup failed: {e}");
        }
    }

    // Fall back to CrossRef
    match lookup_crossref(doi).await {
        Ok(meta) => Ok(meta),
        Err(e) => {
            eprintln!("[pdf_import] CrossRef lookup failed: {e}");
            Err(format!("DOI lookup failed for {doi}"))
        }
    }
}

// ─── Claude-based extraction ───

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: Option<String>,
}

#[derive(Deserialize)]
struct ClaudeMetadataResponse {
    title: Option<String>,
    authors: Option<Vec<String>>,
    year: Option<serde_json::Value>,
    #[serde(rename = "abstract")]
    abstract_text: Option<String>,
    journal: Option<String>,
}

fn get_stored_api_key(app: &AppHandle) -> Option<String> {
    let store = app.store(STORE_FILE).ok()?;
    store
        .get(API_KEY_FIELD)
        .and_then(|v| v.as_str().map(String::from))
}

async fn extract_metadata_with_claude(
    text: &str,
    app: &AppHandle,
) -> Result<PdfMetadata, String> {
    let api_key = get_stored_api_key(app).ok_or_else(|| {
        "No API key configured. DOI was not found in the PDF, and Claude API is needed \
         for metadata extraction. Please add your API key in Settings, or use a PDF that contains a DOI."
            .to_string()
    })?;

    // Truncate text to ~3000 chars for token efficiency
    let text_for_claude = if text.len() > 3000 {
        let end = text[..3000]
            .rfind(char::is_whitespace)
            .unwrap_or(3000);
        &text[..end]
    } else {
        text
    };

    let system_prompt = "You are a metadata extraction tool for academic papers. \
        Given the text from the first pages of a PDF, extract the bibliographic metadata. \
        Respond with ONLY a JSON object, no other text.";

    let user_message = format!(
        "Extract the bibliographic metadata from this academic paper text. \
         Return a JSON object with exactly these fields:\n\
         - \"title\": string (the paper title)\n\
         - \"authors\": array of strings (full author names)\n\
         - \"year\": string or null (publication year)\n\
         - \"abstract\": string or null (the abstract text)\n\
         - \"journal\": string or null (journal or conference name)\n\n\
         Paper text:\n---\n{text_for_claude}\n---"
    );

    let body = serde_json::json!({
        "model": CLAUDE_MODEL,
        "max_tokens": 1024,
        "system": system_prompt,
        "messages": [
            { "role": "user", "content": user_message }
        ]
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Claude API request timed out".to_string()
            } else {
                format!("Claude API request failed: {e}")
            }
        })?;

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Invalid API key. Please check your key in Settings.".to_string());
    }
    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API error (HTTP {status}): {err_body}"));
    }

    let api_resp: AnthropicResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Claude response: {e}"))?;

    let raw_text = api_resp
        .content
        .first()
        .and_then(|c| c.text.as_deref())
        .unwrap_or("")
        .to_string();

    // Parse JSON from Claude's response
    let parsed = extract_json_value(&raw_text)
        .and_then(|v| serde_json::from_value::<ClaudeMetadataResponse>(v).ok())
        .ok_or("Claude did not return valid metadata JSON")?;

    let title = parsed.title.unwrap_or_default();
    if title.is_empty() {
        return Err("Claude could not extract a title from the PDF text".to_string());
    }

    // Year may come as number or string
    let year = parsed.year.and_then(|v| match v {
        serde_json::Value::String(s) if !s.is_empty() => Some(s),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    });

    Ok(PdfMetadata {
        title,
        authors: parsed.authors.unwrap_or_default(),
        year,
        abstract_text: parsed.abstract_text,
        journal: parsed.journal,
        doi: None,
        bibtex: None,
        extraction_method: "claude_extraction".to_string(),
    })
}

/// Extract a JSON value from text that may contain markdown code fences or
/// surrounding prose. Reuses the same approach as agent.rs.
fn extract_json_value(text: &str) -> Option<serde_json::Value> {
    let trimmed = text.trim();

    // 1. Try parsing as-is
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Some(v);
    }

    // 2. Strip markdown code fences
    let stripped = strip_code_blocks(trimmed);
    if stripped != trimmed {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(stripped.trim()) {
            return Some(v);
        }
    }

    // 3. Balanced brace extraction
    if let Some(json_str) = extract_balanced_json(trimmed) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json_str) {
            return Some(v);
        }
    }

    // 4. First { to last }
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&trimmed[start..=end]) {
                return Some(v);
            }
        }
    }

    None
}

fn strip_code_blocks(text: &str) -> &str {
    let text = text.trim();
    let inner = if text.starts_with("```json") {
        &text[7..]
    } else if text.starts_with("```") {
        &text[3..]
    } else {
        return text;
    };
    let inner = inner.trim_start_matches('\n');
    if let Some(end_pos) = inner.rfind("```") {
        &inner[..end_pos]
    } else {
        inner
    }
}

fn extract_balanced_json(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let bytes = text.as_bytes();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape_next = false;

    for i in start..bytes.len() {
        let ch = bytes[i];
        if escape_next {
            escape_next = false;
            continue;
        }
        if ch == b'\\' && in_string {
            escape_next = true;
            continue;
        }
        if ch == b'"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        match ch {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(text[start..=i].to_string());
                }
            }
            _ => {}
        }
    }

    None
}

// ─── BibTeX generation (delegates to shared utility) ───

fn generate_bibtex_from_meta(meta: &PdfMetadata) -> String {
    generate_bibtex_entry(
        &meta.title,
        &meta.authors,
        meta.year.as_deref(),
        meta.journal.as_deref(),
        meta.doi.as_deref(),
        meta.abstract_text.as_deref(),
    )
}

// ─── Tauri commands ───

/// Claude-only metadata extraction (skips DOI lookup).
/// Used as a recovery option when the full import pipeline fails.
#[tauri::command]
pub async fn extract_pdf_with_claude(app: AppHandle, file_path: String) -> Result<PdfMetadata, String> {
    eprintln!("[pdf_import] Claude-only extraction for: {file_path}");

    let text = extract_text_from_pdf(&file_path)?;
    let mut meta = extract_metadata_with_claude(&text, &app).await?;

    // Attach DOI if found in text (even though we skip DOI lookup)
    if meta.doi.is_none() {
        meta.doi = find_doi(&text);
    }
    meta.bibtex = Some(generate_bibtex_from_meta(&meta));
    eprintln!("[pdf_import] Claude-only extraction succeeded");
    Ok(meta)
}

#[tauri::command]
pub async fn import_pdf(app: AppHandle, file_path: String) -> Result<PdfMetadata, String> {
    eprintln!("[pdf_import] Starting import for: {file_path}");

    // 1. Extract text from PDF
    let text = extract_text_from_pdf(&file_path)?;
    eprintln!("[pdf_import] Extracted {} chars of text", text.len());

    // 2. Try to find a DOI in the text
    let doi = find_doi(&text);
    eprintln!("[pdf_import] DOI found: {:?}", doi);

    // 3. If DOI found, try lookup
    if let Some(ref doi_str) = doi {
        match lookup_metadata_by_doi(doi_str).await {
            Ok(mut meta) => {
                eprintln!("[pdf_import] DOI lookup succeeded");
                meta.bibtex = Some(generate_bibtex_from_meta(&meta));
                return Ok(meta);
            }
            Err(e) => {
                eprintln!("[pdf_import] DOI lookup failed, falling through to Claude: {e}");
                // Fall through to Claude extraction
            }
        }
    }

    // 4. Fallback: Claude extraction
    match extract_metadata_with_claude(&text, &app).await {
        Ok(mut meta) => {
            // If we had a DOI but lookup failed, still attach it
            if meta.doi.is_none() {
                meta.doi = doi;
            }
            meta.bibtex = Some(generate_bibtex_from_meta(&meta));
            eprintln!("[pdf_import] Claude extraction succeeded");
            Ok(meta)
        }
        Err(claude_err) => {
            eprintln!("[pdf_import] Claude extraction failed: {claude_err}");
            // If Claude error is about missing API key, return that specific message
            if claude_err.contains("No API key configured") {
                Err(claude_err)
            } else {
                Err(
                    "Failed to extract metadata from PDF. Please try a different file."
                        .to_string(),
                )
            }
        }
    }
}

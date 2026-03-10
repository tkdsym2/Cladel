use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

const S2_BASE_URL: &str = "https://api.semanticscholar.org/graph/v1";
const RATE_LIMIT_MAX: usize = 90; // Conservative margin under the 100/5min limit
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(300);

// ─── Managed state ───

pub struct LiteratureClient {
    client: reqwest::Client,
    request_log: Mutex<VecDeque<Instant>>,
    api_key: Mutex<Option<String>>,
}

impl LiteratureClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            request_log: Mutex::new(VecDeque::new()),
            api_key: Mutex::new(None),
        }
    }

    /// Set an optional API key for higher rate limits.
    #[allow(dead_code)]
    pub fn set_api_key(&self, key: Option<String>) {
        if let Ok(mut k) = self.api_key.lock() {
            *k = key;
        }
    }

    fn check_rate_limit(&self) -> Result<(), String> {
        let mut log = self.request_log.lock().map_err(|e| e.to_string())?;
        let now = Instant::now();

        // Remove timestamps outside the sliding window
        while let Some(front) = log.front() {
            if now.duration_since(*front) > RATE_LIMIT_WINDOW {
                log.pop_front();
            } else {
                break;
            }
        }

        if log.len() >= RATE_LIMIT_MAX {
            let oldest = log.front().unwrap();
            let wait = RATE_LIMIT_WINDOW
                .checked_sub(now.duration_since(*oldest))
                .unwrap_or_default();
            return Err(format!(
                "Rate limit reached ({RATE_LIMIT_MAX} requests per 5 minutes). \
                 Please wait {} seconds before retrying.",
                wait.as_secs() + 1
            ));
        }

        log.push_back(now);
        Ok(())
    }

    fn get_api_key(&self) -> Option<String> {
        self.api_key.lock().ok().and_then(|k| k.clone())
    }

    /// Search papers — callable from other Rust modules (e.g. agent service).
    pub async fn search(&self, query: &str, limit: u32) -> Result<Vec<PaperResult>, String> {
        if query.trim().is_empty() {
            return Err("Search query cannot be empty".to_string());
        }

        self.check_rate_limit()?;

        let limit = limit.min(100);
        let fields = "title,authors,year,abstract,externalIds,url";
        let url = format!("{S2_BASE_URL}/paper/search");

        let mut req = self.client.get(&url).query(&[
            ("query", query),
            ("limit", &limit.to_string()),
            ("fields", fields),
        ]);

        if let Some(key) = self.get_api_key() {
            req = req.header("x-api-key", key);
        }

        let response = req.send().await.map_err(|e| {
            if e.is_timeout() {
                "Request timed out. Semantic Scholar may be unavailable.".to_string()
            } else if e.is_connect() {
                "Could not connect to Semantic Scholar. Check your internet connection.".to_string()
            } else {
                format!("Network error: {e}")
            }
        })?;

        let status = response.status();

        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(
                "Semantic Scholar rate limit exceeded (HTTP 429). Please wait a few minutes and try again."
                    .to_string(),
            );
        }

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Semantic Scholar API error (HTTP {status}): {body}"
            ));
        }

        let resp: S2SearchResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Semantic Scholar response: {e}"))?;

        let papers = resp
            .data
            .unwrap_or_default()
            .iter()
            .map(|p| p.to_paper_result())
            .collect();

        Ok(papers)
    }
}

// ─── Public output types ───

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaperResult {
    pub paper_id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<i32>,
    pub abstract_text: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaperDetail {
    pub paper_id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<i32>,
    pub abstract_text: Option<String>,
    pub url: Option<String>,
    pub doi: Option<String>,
    pub citation_count: Option<i32>,
    pub reference_count: Option<i32>,
    pub references: Vec<PaperResult>,
    pub citations: Vec<PaperResult>,
}

// ─── S2 API response deserialization (private) ───

#[derive(Deserialize)]
struct S2SearchResponse {
    data: Option<Vec<S2Paper>>,
}

#[derive(Deserialize)]
struct S2Paper {
    #[serde(rename = "paperId")]
    paper_id: Option<String>,
    title: Option<String>,
    authors: Option<Vec<S2Author>>,
    year: Option<i32>,
    #[serde(rename = "abstract")]
    abstract_text: Option<String>,
    url: Option<String>,
    #[serde(rename = "externalIds")]
    external_ids: Option<S2ExternalIds>,
    #[serde(rename = "citationCount")]
    citation_count: Option<i32>,
    #[serde(rename = "referenceCount")]
    reference_count: Option<i32>,
    references: Option<Vec<S2CitedPaper>>,
    citations: Option<Vec<S2CitedPaper>>,
}

#[derive(Deserialize)]
struct S2Author {
    name: Option<String>,
}

#[derive(Deserialize)]
struct S2ExternalIds {
    #[serde(rename = "DOI")]
    doi: Option<String>,
}

/// References/citations come wrapped in { citedPaper: {...} } or { citingPaper: {...} }
/// but when using the flat `references` field they come as direct paper objects.
#[derive(Deserialize)]
struct S2CitedPaper {
    #[serde(rename = "paperId")]
    paper_id: Option<String>,
    title: Option<String>,
    authors: Option<Vec<S2Author>>,
    year: Option<i32>,
    url: Option<String>,
}

// ─── Conversions ───

impl S2Paper {
    fn to_paper_result(&self) -> PaperResult {
        PaperResult {
            paper_id: self.paper_id.clone().unwrap_or_default(),
            title: self.title.clone().unwrap_or_default(),
            authors: self
                .authors
                .as_ref()
                .map(|a| a.iter().filter_map(|author| author.name.clone()).collect())
                .unwrap_or_default(),
            year: self.year,
            abstract_text: self.abstract_text.clone(),
            url: self.url.clone(),
        }
    }

    fn to_paper_detail(&self) -> PaperDetail {
        let doi = self.external_ids.as_ref().and_then(|ids| ids.doi.clone());

        let references = self
            .references
            .as_ref()
            .map(|refs| refs.iter().map(|r| r.to_paper_result()).collect())
            .unwrap_or_default();

        let citations = self
            .citations
            .as_ref()
            .map(|cits| cits.iter().map(|c| c.to_paper_result()).collect())
            .unwrap_or_default();

        PaperDetail {
            paper_id: self.paper_id.clone().unwrap_or_default(),
            title: self.title.clone().unwrap_or_default(),
            authors: self
                .authors
                .as_ref()
                .map(|a| a.iter().filter_map(|author| author.name.clone()).collect())
                .unwrap_or_default(),
            year: self.year,
            abstract_text: self.abstract_text.clone(),
            url: self.url.clone(),
            doi,
            citation_count: self.citation_count,
            reference_count: self.reference_count,
            references,
            citations,
        }
    }
}

impl S2CitedPaper {
    fn to_paper_result(&self) -> PaperResult {
        PaperResult {
            paper_id: self.paper_id.clone().unwrap_or_default(),
            title: self.title.clone().unwrap_or_default(),
            authors: self
                .authors
                .as_ref()
                .map(|a| a.iter().filter_map(|author| author.name.clone()).collect())
                .unwrap_or_default(),
            year: self.year,
            abstract_text: None,
            url: self.url.clone(),
        }
    }
}

// ─── Tauri commands ───

#[tauri::command]
pub async fn search_papers(
    client: State<'_, LiteratureClient>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<PaperResult>, String> {
    if query.trim().is_empty() {
        return Err("Search query cannot be empty".to_string());
    }

    client.check_rate_limit()?;

    let limit = limit.unwrap_or(10).min(100);
    let fields = "title,authors,year,abstract,externalIds,url";

    let url = format!("{S2_BASE_URL}/paper/search");

    let mut req = client.client.get(&url).query(&[
        ("query", query.as_str()),
        ("limit", &limit.to_string()),
        ("fields", fields),
    ]);

    if let Some(key) = client.get_api_key() {
        req = req.header("x-api-key", key);
    }

    let response = req.send().await.map_err(|e| {
        if e.is_timeout() {
            "Request timed out. Semantic Scholar may be unavailable.".to_string()
        } else if e.is_connect() {
            "Could not connect to Semantic Scholar. Check your internet connection.".to_string()
        } else {
            format!("Network error: {e}")
        }
    })?;

    let status = response.status();

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(
            "Semantic Scholar rate limit exceeded (HTTP 429). Please wait a few minutes and try again."
                .to_string(),
        );
    }

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Semantic Scholar API error (HTTP {status}): {body}"
        ));
    }

    let resp: S2SearchResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Semantic Scholar response: {e}"))?;

    let papers = resp
        .data
        .unwrap_or_default()
        .iter()
        .map(|p| p.to_paper_result())
        .collect();

    Ok(papers)
}

#[tauri::command]
pub async fn get_paper_details(
    client: State<'_, LiteratureClient>,
    paper_id: String,
) -> Result<PaperDetail, String> {
    if paper_id.trim().is_empty() {
        return Err("Paper ID cannot be empty".to_string());
    }

    client.check_rate_limit()?;

    let fields = "title,authors,year,abstract,externalIds,url,citationCount,referenceCount,references,citations";
    let url = format!("{S2_BASE_URL}/paper/{paper_id}");

    let mut req = client.client.get(&url).query(&[("fields", fields)]);

    if let Some(key) = client.get_api_key() {
        req = req.header("x-api-key", key);
    }

    let response = req.send().await.map_err(|e| {
        if e.is_timeout() {
            "Request timed out. Semantic Scholar may be unavailable.".to_string()
        } else if e.is_connect() {
            "Could not connect to Semantic Scholar. Check your internet connection.".to_string()
        } else {
            format!("Network error: {e}")
        }
    })?;

    let status = response.status();

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(
            "Semantic Scholar rate limit exceeded (HTTP 429). Please wait a few minutes and try again."
                .to_string(),
        );
    }

    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("Paper not found: {paper_id}"));
    }

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Semantic Scholar API error (HTTP {status}): {body}"
        ));
    }

    let paper: S2Paper = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Semantic Scholar response: {e}"))?;

    Ok(paper.to_paper_detail())
}

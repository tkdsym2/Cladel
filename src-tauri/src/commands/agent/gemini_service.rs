use super::{AgentContext, AgentError, AgentResponse, AgentService};
use super::super::literature::LiteratureClient;
use super::parser::parse_claude_response;
use super::prompt::{build_system_prompt, build_user_message};
use serde::Deserialize;
use std::time::Duration;

pub(crate) const GEMINI_MODEL: &str = "gemini-2.5-flash";

const MAX_RETRIES: u32 = 2;
const RETRY_DELAYS_MS: [u64; 2] = [2000, 5000];

fn gemini_api_url() -> String {
    format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        GEMINI_MODEL
    )
}

// ─── Gemini API response types ───

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct GeminiResponse {
    pub candidates: Option<Vec<GeminiCandidate>>,
    #[serde(rename = "usageMetadata")]
    pub usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct GeminiCandidate {
    pub content: Option<GeminiContent>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct GeminiContent {
    pub parts: Option<Vec<GeminiPart>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct GeminiPart {
    pub text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct GeminiUsageMetadata {
    #[serde(rename = "promptTokenCount", default)]
    pub prompt_token_count: u64,
    #[serde(rename = "candidatesTokenCount", default)]
    pub candidates_token_count: u64,
    #[serde(rename = "totalTokenCount", default)]
    pub total_token_count: u64,
}

// ─── Service ───

pub struct GeminiAgentService {
    http_client: reqwest::Client,
    api_key: String,
    structure_analysis: Option<String>,
    content_analysis: Option<String>,
    last_usage: std::sync::Mutex<Option<(u64, u64)>>,
}

impl GeminiAgentService {
    pub fn new(api_key: String) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            http_client,
            api_key,
            structure_analysis: None,
            content_analysis: None,
            last_usage: std::sync::Mutex::new(None),
        }
    }

    pub fn with_structure_analysis(mut self, analysis: Option<String>) -> Self {
        self.structure_analysis = analysis;
        self
    }

    pub fn with_content_analysis(mut self, analysis: Option<String>) -> Self {
        self.content_analysis = analysis;
        self
    }

    pub fn get_last_usage(&self) -> Option<(u64, u64)> {
        self.last_usage.lock().ok().and_then(|g| *g)
    }

    async fn invoke_once(
        &self,
        body: &serde_json::Value,
        context: &AgentContext,
    ) -> Result<AgentResponse, AgentError> {
        let (text, usage) = call_gemini_api(&self.http_client, &self.api_key, body).await?;

        if let Some((input_tokens, output_tokens)) = usage {
            if let Ok(mut guard) = self.last_usage.lock() {
                *guard = Some((input_tokens, output_tokens));
            }
        }

        Ok(parse_claude_response(&text, context))
    }
}

impl AgentService for GeminiAgentService {
    async fn invoke(
        &self,
        query: &str,
        invocation_type: &str,
        context: &AgentContext,
        _literature: &LiteratureClient,
    ) -> Result<AgentResponse, AgentError> {
        let system_prompt = build_system_prompt();
        let user_message = build_user_message(
            query,
            invocation_type,
            context,
            self.structure_analysis.as_deref(),
            self.content_analysis.as_deref(),
        );

        let body = build_gemini_request_body(&system_prompt, &user_message, 4096);

        // Retry loop
        let mut last_error: Option<AgentError> = None;
        for attempt in 0..=MAX_RETRIES {
            if attempt > 0 {
                let delay_ms = RETRY_DELAYS_MS[(attempt - 1) as usize];
                eprintln!("[gemini] Retry attempt {attempt}/{MAX_RETRIES} after {delay_ms}ms");
                std::thread::sleep(Duration::from_millis(delay_ms));
            }

            match self.invoke_once(&body, context).await {
                Ok(response) => return Ok(response),
                Err(e) if e.is_retryable() && attempt < MAX_RETRIES => {
                    eprintln!("[gemini] Retryable error: {e}");
                    last_error = Some(e);
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        Err(last_error.unwrap_or_else(|| AgentError::ApiError("Unexpected retry exhaustion".to_string())))
    }
}

// ─── Standalone invoke for agent_node / comment_agent ───

/// Single Gemini API call returning (text, usage). Used by agent_node.rs and comment_agent.rs.
pub(super) async fn invoke_gemini_once(
    client: &reqwest::Client,
    api_key: &str,
    body: &serde_json::Value,
) -> Result<(String, Option<(u64, u64)>), AgentError> {
    call_gemini_api(client, api_key, body).await
}

// ─── Shared API call ───

async fn call_gemini_api(
    client: &reqwest::Client,
    api_key: &str,
    body: &serde_json::Value,
) -> Result<(String, Option<(u64, u64)>), AgentError> {
    let response = client
        .post(gemini_api_url())
        .header("x-goog-api-key", api_key)
        .header("content-type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                AgentError::Timeout
            } else if e.is_connect() {
                AgentError::NetworkError("Could not connect. Please check your connection.".to_string())
            } else {
                AgentError::NetworkError(e.to_string())
            }
        })?;

    let status = response.status();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AgentError::ApiKeyInvalid);
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status == reqwest::StatusCode::FORBIDDEN
    {
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        return Err(AgentError::RateLimited(retry_after));
    }
    if status.is_server_error() {
        return Err(AgentError::ServerError(format!("HTTP {status}")));
    }
    if !status.is_success() {
        let body_text = response.text().await.unwrap_or_default();
        return Err(AgentError::ApiError(format!(
            "API error (HTTP {status}): {body_text}"
        )));
    }

    let api_resp: GeminiResponse = response
        .json()
        .await
        .map_err(|e| AgentError::ParseError(format!("Failed to parse Gemini response: {e}")))?;

    let usage = api_resp.usage_metadata.as_ref().map(|u| {
        (u.prompt_token_count, u.candidates_token_count)
    });

    let raw_text = api_resp
        .candidates
        .as_ref()
        .and_then(|c| c.first())
        .and_then(|c| c.content.as_ref())
        .and_then(|c| c.parts.as_ref())
        .and_then(|p| p.first())
        .and_then(|p| p.text.as_deref())
        .unwrap_or("")
        .to_string();

    Ok((raw_text, usage))
}

// ─── Request body builder ───

pub(super) fn build_gemini_request_body(
    system_prompt: &str,
    user_message: &str,
    max_output_tokens: u32,
) -> serde_json::Value {
    serde_json::json!({
        "system_instruction": {
            "parts": [{ "text": system_prompt }]
        },
        "contents": [{
            "role": "user",
            "parts": [{ "text": user_message }]
        }],
        "generationConfig": {
            "maxOutputTokens": max_output_tokens
        }
    })
}

use super::{AgentContext, AgentError, AgentResponse, AgentService};
use super::super::literature::LiteratureClient;
use super::parser::{AnthropicResponse, parse_claude_response};
use super::prompt::{build_system_prompt, build_user_message};
use std::time::Duration;

pub(crate) const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
pub(crate) const CLAUDE_MODEL: &str = "claude-sonnet-4-20250514";

const MAX_RETRIES: u32 = 2;
const RETRY_DELAYS_MS: [u64; 2] = [2000, 5000];

pub struct ClaudeAgentService {
    http_client: reqwest::Client,
    api_key: String,
    structure_analysis: Option<String>,
    content_analysis: Option<String>,
    last_usage: std::sync::Mutex<Option<(u64, u64)>>,
}

impl ClaudeAgentService {
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

    /// Get the last usage info captured from an API call.
    pub fn get_last_usage(&self) -> Option<(u64, u64)> {
        self.last_usage.lock().ok().and_then(|g| *g)
    }

    /// Single API call attempt — maps HTTP errors to structured AgentError variants.
    async fn invoke_once(
        &self,
        body: &serde_json::Value,
        context: &AgentContext,
    ) -> Result<AgentResponse, AgentError> {
        let response = self
            .http_client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
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
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            // Try to extract Retry-After header
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

        let api_resp: AnthropicResponse = response
            .json()
            .await
            .map_err(|e| AgentError::ParseError(format!("Failed to parse API response: {e}")))?;

        // Capture usage from API response
        if let Some(usage) = api_resp.usage {
            if let Ok(mut guard) = self.last_usage.lock() {
                *guard = Some((usage.input_tokens, usage.output_tokens));
            }
        }

        let raw_text = api_resp
            .content
            .first()
            .and_then(|c| c.text.as_deref())
            .unwrap_or("")
            .to_string();

        Ok(parse_claude_response(&raw_text, context))
    }
}

impl AgentService for ClaudeAgentService {
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

        let body = serde_json::json!({
            "model": CLAUDE_MODEL,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": [
                { "role": "user", "content": user_message }
            ]
        });

        // Retry loop for transient errors
        let mut last_error: Option<AgentError> = None;
        for attempt in 0..=MAX_RETRIES {
            if attempt > 0 {
                let delay_ms = RETRY_DELAYS_MS[(attempt - 1) as usize];
                eprintln!("[agent] Retry attempt {attempt}/{MAX_RETRIES} after {delay_ms}ms");
                std::thread::sleep(Duration::from_millis(delay_ms));
            }

            match self.invoke_once(&body, context).await {
                Ok(response) => return Ok(response),
                Err(e) if e.is_retryable() && attempt < MAX_RETRIES => {
                    eprintln!("[agent] Retryable error: {e}");
                    last_error = Some(e);
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        Err(last_error.unwrap_or_else(|| AgentError::ApiError("Unexpected retry exhaustion".to_string())))
    }
}

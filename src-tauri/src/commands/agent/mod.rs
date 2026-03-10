pub(crate) mod agent_node;
pub(crate) mod comment_agent;
pub(crate) mod paper_chat;
mod analysis;
mod claude_service;
mod context;
pub(crate) mod gemini_service;
mod parser;
mod prompt;
mod stub_service;

use crate::db::Database;
use super::literature::LiteratureClient;
use super::settings::{get_agent_capabilities, get_stored_gemini_api_key};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;

// ─── Public types (shared with frontend) ───

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeSummary {
    pub id: String,
    pub node_type: String,
    pub title: String,
    pub content_preview: Option<String>,
    pub connection_count: usize,
    pub connected_to: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentEdgeComment {
    pub author_type: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EdgeSummary {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub source_node_title: String,
    pub target_node_title: String,
    pub weight: i32,
    pub comment: String,
    pub comment_count: usize,
    #[serde(default)]
    pub comments: Vec<AgentEdgeComment>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GraphStats {
    pub total_nodes: usize,
    pub total_edges: usize,
    pub node_type_counts: HashMap<String, usize>,
    pub isolated_node_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentContext {
    pub current_layer_id: String,
    pub core_content_preview: Option<String>,
    pub graph_stats: GraphStats,
    pub node_summaries: Vec<NodeSummary>,
    pub edge_summaries: Vec<EdgeSummary>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionSuggestion {
    pub source_node_id: String,
    pub target_node_id: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentSuggestionData {
    pub suggestion_type: String,
    pub title: String,
    pub description: String,
    pub paper_data: Option<super::literature::PaperResult>,
    pub idea_body: Option<String>,
    pub connection: Option<ConnectionSuggestion>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentResponse {
    pub suggestions: Vec<AgentSuggestionData>,
    pub message: String,
}

// ─── Agent error ───

/// Structured error info serialized to JSON for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct AgentErrorInfo {
    pub error_code: String,
    pub message: String,
    pub retry_after_secs: Option<u64>,
    pub recoverable: bool,
}

impl AgentErrorInfo {
    pub(crate) fn to_json_string(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| self.message.clone())
    }
}

#[derive(Debug)]
#[allow(dead_code)]
pub(crate) enum AgentError {
    LiteratureSearch(String),
    InvalidInput(String),
    ApiKeyMissing,
    ApiKeyInvalid,
    RateLimited(Option<u64>),
    Timeout,
    ServerError(String),
    NetworkError(String),
    ParseError(String),
    ApiError(String),
}

impl AgentError {
    /// Whether this error is worth retrying automatically.
    pub(crate) fn is_retryable(&self) -> bool {
        matches!(
            self,
            AgentError::RateLimited(_)
                | AgentError::ServerError(_)
                | AgentError::NetworkError(_)
                | AgentError::Timeout
        )
    }

    /// Convert to structured error info for the frontend.
    pub(crate) fn to_error_info(&self) -> AgentErrorInfo {
        match self {
            AgentError::ApiKeyMissing => AgentErrorInfo {
                error_code: "api_key_missing".to_string(),
                message: "API key not configured. Please set your key in Settings.".to_string(),
                retry_after_secs: None,
                recoverable: false,
            },
            AgentError::ApiKeyInvalid => AgentErrorInfo {
                error_code: "api_key_invalid".to_string(),
                message: "Invalid API key. Please check your key in Settings.".to_string(),
                retry_after_secs: None,
                recoverable: false,
            },
            AgentError::RateLimited(retry_after) => AgentErrorInfo {
                error_code: "rate_limited".to_string(),
                message: "Rate limited by Anthropic API. Please wait a moment.".to_string(),
                retry_after_secs: Some(retry_after.unwrap_or(30)),
                recoverable: true,
            },
            AgentError::Timeout => AgentErrorInfo {
                error_code: "timeout".to_string(),
                message: "Request timed out. Please try again.".to_string(),
                retry_after_secs: Some(5),
                recoverable: true,
            },
            AgentError::ServerError(msg) => AgentErrorInfo {
                error_code: "server_error".to_string(),
                message: format!("Anthropic API is temporarily unavailable. {msg}"),
                retry_after_secs: Some(10),
                recoverable: true,
            },
            AgentError::NetworkError(msg) => AgentErrorInfo {
                error_code: "network_error".to_string(),
                message: format!("Network error: {msg}"),
                retry_after_secs: Some(5),
                recoverable: true,
            },
            AgentError::ParseError(msg) => AgentErrorInfo {
                error_code: "parse_error".to_string(),
                message: format!("Failed to parse response. {msg}"),
                retry_after_secs: None,
                recoverable: true,
            },
            AgentError::LiteratureSearch(msg) => AgentErrorInfo {
                error_code: "unknown".to_string(),
                message: format!("Literature search error: {msg}"),
                retry_after_secs: None,
                recoverable: true,
            },
            AgentError::InvalidInput(msg) => AgentErrorInfo {
                error_code: "unknown".to_string(),
                message: format!("Invalid input: {msg}"),
                retry_after_secs: None,
                recoverable: true,
            },
            AgentError::ApiError(msg) => AgentErrorInfo {
                error_code: "unknown".to_string(),
                message: msg.clone(),
                retry_after_secs: None,
                recoverable: true,
            },
        }
    }
}

impl std::fmt::Display for AgentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentError::LiteratureSearch(msg) => write!(f, "Literature search error: {msg}"),
            AgentError::InvalidInput(msg) => write!(f, "Invalid input: {msg}"),
            AgentError::ApiKeyMissing => write!(f, "API key not configured"),
            AgentError::ApiKeyInvalid => write!(f, "Invalid API key"),
            AgentError::RateLimited(_) => write!(f, "Rate limited"),
            AgentError::Timeout => write!(f, "Request timed out"),
            AgentError::ServerError(msg) => write!(f, "Server error: {msg}"),
            AgentError::NetworkError(msg) => write!(f, "Network error: {msg}"),
            AgentError::ParseError(msg) => write!(f, "Parse error: {msg}"),
            AgentError::ApiError(msg) => write!(f, "{msg}"),
        }
    }
}

// ─── Agent service trait ───

pub(crate) trait AgentService: Send + Sync {
    fn invoke(
        &self,
        query: &str,
        invocation_type: &str,
        context: &AgentContext,
        literature: &LiteratureClient,
    ) -> impl std::future::Future<Output = Result<AgentResponse, AgentError>> + Send;
}

// ─── Helpers ───

pub(crate) fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &s[..end])
    }
}

// ─── Agent console log ───

#[derive(Debug, Serialize, Clone)]
struct AgentConsoleLogEntry {
    level: String,
    source: String,
    message: String,
    detail: Option<String>,
    timestamp: String,
}

/// Emit a log entry to the agent console window via Tauri event.
pub(crate) fn emit_agent_log(app: &AppHandle, level: &str, source: &str, message: &str, detail: Option<&str>) {
    let entry = AgentConsoleLogEntry {
        level: level.to_string(),
        source: source.to_string(),
        message: message.to_string(),
        detail: detail.map(|s| s.to_string()),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    let _ = app.emit("agent-console-log", &entry);
}

// ─── Usage logging ───

const STORE_FILE: &str = "settings.json";
const API_KEY_FIELD: &str = "anthropic_api_key";

/// Read the API key from tauri-plugin-store.
fn get_stored_api_key(app: &AppHandle) -> Option<String> {
    let store = app.store(STORE_FILE).ok()?;
    store
        .get(API_KEY_FIELD)
        .and_then(|v| v.as_str().map(String::from))
}

/// Log an API call's token usage to the agent_usage_log table.
/// This is non-fatal — if logging fails, we just print a warning and continue.
pub fn log_agent_usage(
    db: &Database,
    invocation_type: &str,
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    success: bool,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let total_tokens = input_tokens + output_tokens;
    let success_int: i32 = if success { 1 } else { 0 };

    let result = (|| -> Result<(), String> {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO agent_usage_log (id, invocation_type, model, input_tokens, output_tokens, total_tokens, success, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
            rusqlite::params![id, invocation_type, model, input_tokens, output_tokens, total_tokens, success_int],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })();

    if let Err(e) = result {
        eprintln!("[agent] Warning: failed to log usage: {e}");
    }
}

// ─── Tauri command ───

#[tauri::command]
pub async fn invoke_agent(
    app: AppHandle,
    db: State<'_, Database>,
    literature: State<'_, LiteratureClient>,
    query: String,
    invocation_type: String,
    context: AgentContext,
    provider: Option<String>,
) -> Result<AgentResponse, String> {
    emit_agent_log(&app, "info", "global_agent", &format!("invoke_agent started — type={invocation_type}"), Some(&format!("query: {}", truncate_str(&query, 200))));

    if query.trim().is_empty() {
        let err = AgentErrorInfo {
            error_code: "unknown".to_string(),
            message: "Query cannot be empty".to_string(),
            retry_after_secs: None,
            recoverable: false,
        };
        return Err(err.to_json_string());
    }

    // ─── Capability guard ───
    // Check agent capabilities BEFORE API key check
    let capabilities = get_agent_capabilities(app.clone()).unwrap_or_default();

    if !capabilities.agent_enabled {
        return Err(AgentErrorInfo {
            error_code: "agent_disabled".to_string(),
            message: "Agent is currently disabled. Enable it in Settings.".to_string(),
            retry_after_secs: None,
            recoverable: false,
        }
        .to_json_string());
    }

    // Check specific capability for the invocation type
    let capability_disabled = match invocation_type.as_str() {
        "search_papers" => !capabilities.search_papers_enabled,
        "suggest_connections" => !capabilities.suggest_connections_enabled,
        "suggest_ideas" => !capabilities.suggest_ideas_enabled,
        "autonomous" => !capabilities.autonomous_enabled,
        _ => false, // "general" only needs agent_enabled
    };
    if capability_disabled {
        let feature_name = match invocation_type.as_str() {
            "search_papers" => "Paper search",
            "suggest_connections" => "Connection suggestions",
            "suggest_ideas" => "Idea suggestions",
            "autonomous" => "Autonomous analysis",
            _ => "This feature",
        };
        return Err(AgentErrorInfo {
            error_code: "capability_disabled".to_string(),
            message: format!("{feature_name} is currently disabled. Enable it in Settings."),
            retry_after_secs: None,
            recoverable: false,
        }
        .to_json_string());
    }

    // Fetch edge comments from DB before any await points
    // (MutexGuard is dropped within fetch_edge_comments_batch)
    let edge_ids: Vec<String> = context.edge_summaries.iter().map(|e| e.id.clone()).collect();
    let edge_comments = context::fetch_edge_comments_batch(&db, &edge_ids).map_err(|e| {
        AgentErrorInfo {
            error_code: "unknown".to_string(),
            message: format!("Database error: {e}"),
            retry_after_secs: None,
            recoverable: true,
        }
        .to_json_string()
    })?;

    // Attach comments to edge summaries
    let mut context = context;
    for edge in &mut context.edge_summaries {
        if let Some(comments) = edge_comments.get(&edge.id) {
            edge.comments = comments.clone();
        }
    }

    // For autonomous invocations, analyze graph structure before await points
    let structure_analysis = if invocation_type == "autonomous" {
        match analysis::analyze_graph_structure(&db, &context.current_layer_id) {
            Ok(anomalies) if anomalies.has_anomalies => {
                eprintln!(
                    "[agent] Structure analysis: {} isolated, star={}, {} clusters, depth_imbalance={}",
                    anomalies.isolated_nodes.len(),
                    anomalies.star_pattern.is_some(),
                    anomalies.disconnected_clusters.len(),
                    anomalies.depth_imbalance.is_some(),
                );
                Some(analysis::format_anomalies_for_prompt(&anomalies))
            }
            Ok(_) => {
                eprintln!("[agent] Structure analysis: no anomalies detected");
                None
            }
            Err(e) => {
                eprintln!("[agent] Structure analysis failed (non-fatal): {e}");
                None
            }
        }
    } else {
        None
    };

    // For autonomous invocations, analyze content signals before await points
    let content_analysis = if invocation_type == "autonomous" {
        match analysis::analyze_content_signals(&db, &context.current_layer_id) {
            Ok(signals) if signals.has_signals => {
                eprintln!(
                    "[agent] Content analysis: {} questions, {} contradictions, {} orphan topics",
                    signals.unanswered_questions.len(),
                    signals.potential_contradictions.len(),
                    signals.orphan_topics.len(),
                );
                analysis::format_content_signals_for_prompt(&signals)
            }
            Ok(_) => {
                eprintln!("[agent] Content analysis: no signals detected");
                None
            }
            Err(e) => {
                eprintln!("[agent] Content analysis failed (non-fatal): {e}");
                None
            }
        }
    } else {
        None
    };

    // Optimize context with relevance-based node selection and token budgets
    emit_agent_log(&app, "info", "global_agent", &format!("Context: {} nodes, {} edges — optimizing", context.node_summaries.len(), context.edge_summaries.len()), None);
    let context = context::optimize_context(context, &query);
    emit_agent_log(&app, "info", "global_agent", &format!("Context optimized: {} nodes, {} edges", context.node_summaries.len(), context.edge_summaries.len()), None);

    // Choose service based on provider
    let use_gemini = provider.as_deref() == Some("gemini");

    let provider_name = if use_gemini { "Gemini" } else { "Claude" };
    emit_agent_log(&app, "info", "global_agent", &format!("Sending API request to {provider_name}..."), None);

    let result = if use_gemini {
        let api_key = get_stored_gemini_api_key(&app).ok_or_else(|| {
            AgentError::ApiKeyMissing.to_error_info().to_json_string()
        })?;
        let gemini = gemini_service::GeminiAgentService::new(api_key)
            .with_structure_analysis(structure_analysis)
            .with_content_analysis(content_analysis);
        let r = gemini
            .invoke(&query, &invocation_type, &context, &literature)
            .await;

        if let Some((input_tokens, output_tokens)) = gemini.get_last_usage() {
            emit_agent_log(&app, "info", "global_agent", &format!("Response received — in:{input_tokens} out:{output_tokens} tokens"), None);
            log_agent_usage(
                &db,
                &invocation_type,
                gemini_service::GEMINI_MODEL,
                input_tokens,
                output_tokens,
                r.is_ok(),
            );
        }

        r
    } else if let Some(api_key) = get_stored_api_key(&app) {
        let claude = claude_service::ClaudeAgentService::new(api_key)
            .with_structure_analysis(structure_analysis)
            .with_content_analysis(content_analysis);
        let r = claude
            .invoke(&query, &invocation_type, &context, &literature)
            .await;

        if let Some((input_tokens, output_tokens)) = claude.get_last_usage() {
            emit_agent_log(&app, "info", "global_agent", &format!("Response received — in:{input_tokens} out:{output_tokens} tokens"), None);
            log_agent_usage(
                &db,
                &invocation_type,
                claude_service::CLAUDE_MODEL,
                input_tokens,
                output_tokens,
                r.is_ok(),
            );
        }

        r
    } else {
        return Err(AgentError::ApiKeyMissing.to_error_info().to_json_string());
    };

    match &result {
        Ok(resp) => emit_agent_log(&app, "info", "global_agent", &format!("invoke_agent completed — {} suggestions", resp.suggestions.len()), None),
        Err(e) => emit_agent_log(&app, "error", "global_agent", &format!("invoke_agent failed: {e}"), None),
    }

    result.map_err(|e| e.to_error_info().to_json_string())
}

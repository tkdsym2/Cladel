use crate::db::Database;
use super::gemini_service::{self, GEMINI_MODEL};
use super::{AgentError, AgentErrorInfo, emit_agent_log, log_agent_usage, truncate_str};
use crate::commands::nodes::{get_next_display_id, NodeData, NODE_COLUMNS, node_from_row};
use crate::commands::settings::{get_agent_capabilities, get_stored_gemini_api_key, get_stored_paper_summary_prompt};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, State};
use base64::Engine;

// ─── Types ───

#[derive(Debug, Serialize, Deserialize)]
pub struct PaperSummarizeResult {
    pub agent_message: String,
    pub output_node_id: String,
}

// ─── Constants ───

const MAX_RETRIES: u32 = 2;
const RETRY_DELAYS_MS: [u64; 2] = [2000, 5000];

// ─── Tauri commands ───

#[tauri::command]
pub async fn invoke_paper_summarize(
    app: AppHandle,
    db: State<'_, Database>,
    node_id: String,
    layer_id: String,
) -> Result<PaperSummarizeResult, String> {
    // Capability guard
    let capabilities = get_agent_capabilities(app.clone()).unwrap_or_default();
    if !capabilities.agent_enabled {
        return Err(to_error_json(
            "agent_disabled",
            "Agent is currently disabled. Enable it in Settings.",
            None,
            false,
        ));
    }

    // Gemini API key check
    let api_key = get_stored_gemini_api_key(&app).ok_or_else(|| {
        AgentError::ApiKeyMissing.to_error_info().to_json_string()
    })?;

    // Load paper node from DB
    let paper_node = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            &format!("SELECT {} FROM nodes WHERE id = ?1", NODE_COLUMNS),
            [&node_id],
            node_from_row,
        )
        .map_err(|e| format!("Paper node not found: {e}"))?
    };

    emit_agent_log(&app, "info", "paper_chat", &format!("invoke_paper_summarize started — \"{}\"", truncate_str(&paper_node.title, 60)), None);

    // Get PDF path
    let pdf_path = paper_node.pdf_path.as_deref().ok_or_else(|| {
        to_error_json("invalid_input", "No PDF linked to this paper node.", None, false)
    })?;

    emit_agent_log(&app, "info", "paper_chat", &format!("Reading PDF: {}", truncate_str(pdf_path, 100)), None);

    // Read PDF file and base64 encode
    let pdf_bytes = std::fs::read(pdf_path).map_err(|e| {
        to_error_json("invalid_input", &format!("Failed to read PDF file: {e}"), None, false)
    })?;
    let pdf_base64 = base64::engine::general_purpose::STANDARD.encode(&pdf_bytes);
    emit_agent_log(&app, "info", "paper_chat", &format!("PDF encoded: {} bytes → {} base64 chars", pdf_bytes.len(), pdf_base64.len()), None);
    emit_agent_log(&app, "info", "paper_chat", "Sending summarize request to Gemini...", None);

    // Load prompt template
    let prompt = get_stored_paper_summary_prompt(&app);

    // Build Gemini request with inline_data
    let body = serde_json::json!({
        "system_instruction": {
            "parts": [{ "text": "You are a research paper analysis assistant." }]
        },
        "contents": [{
            "role": "user",
            "parts": [
                {
                    "inline_data": {
                        "mime_type": "application/pdf",
                        "data": pdf_base64
                    }
                },
                { "text": prompt }
            ]
        }],
        "generationConfig": {
            "maxOutputTokens": 8192
        }
    });

    // Make API call with retry
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut last_error: Option<AgentError> = None;
    let mut response_text = String::new();
    let mut usage_info: Option<(u64, u64)> = None;

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            let delay_ms = RETRY_DELAYS_MS[(attempt - 1) as usize];
            eprintln!("[paper_chat] Retry attempt {attempt}/{MAX_RETRIES} after {delay_ms}ms");
            std::thread::sleep(Duration::from_millis(delay_ms));
        }

        match gemini_service::invoke_gemini_once(&http_client, &api_key, &body).await {
            Ok((text, usage)) => {
                response_text = text;
                usage_info = usage;
                if let Some((inp, out)) = usage {
                    emit_agent_log(&app, "info", "paper_chat", &format!("Summarize response received — in:{inp} out:{out} tokens"), None);
                }
                last_error = None;
                break;
            }
            Err(e) if e.is_retryable() && attempt < MAX_RETRIES => {
                emit_agent_log(&app, "warn", "paper_chat", &format!("Retryable error (attempt {attempt}/{MAX_RETRIES}): {e}"), None);
                eprintln!("[paper_chat] Retryable error: {e}");
                last_error = Some(e);
                continue;
            }
            Err(e) => {
                emit_agent_log(&app, "error", "paper_chat", &format!("Summarize failed: {e}"), None);
                if let Some((input_tokens, output_tokens)) = usage_info {
                    log_agent_usage(&db, "paper_summarize", GEMINI_MODEL, input_tokens, output_tokens, false);
                }
                return Err(e.to_error_info().to_json_string());
            }
        }
    }

    if let Some(e) = last_error {
        return Err(e.to_error_info().to_json_string());
    }

    // Log successful usage
    if let Some((input_tokens, output_tokens)) = usage_info {
        log_agent_usage(&db, "paper_summarize", GEMINI_MODEL, input_tokens, output_tokens, true);
    }

    let agent_response = response_text.trim().to_string();
    if agent_response.is_empty() {
        return Err(to_error_json(
            "parse_error",
            "Gemini returned an empty response. Please try again.",
            None,
            true,
        ));
    }

    // Create output Edit node
    let output_node_id = create_summary_output_node(
        &db,
        &layer_id,
        &node_id,
        &paper_node,
        &agent_response,
    )?;

    // Save messages to agent_node_messages (using paper node_id as the node)
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();

        // Save user prompt
        let user_msg_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO agent_node_messages (id, node_id, role, content, output_node_id, created_at) VALUES (?1, ?2, 'user', ?3, NULL, ?4)",
            rusqlite::params![user_msg_id, node_id, truncate_str(&prompt, 200), now],
        ).map_err(|e| format!("Failed to save user message: {e}"))?;

        // Save agent response
        let agent_msg_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO agent_node_messages (id, node_id, role, content, output_node_id, created_at) VALUES (?1, ?2, 'agent', ?3, ?4, ?5)",
            rusqlite::params![agent_msg_id, node_id, agent_response, output_node_id, now],
        ).map_err(|e| format!("Failed to save agent message: {e}"))?;
    }

    Ok(PaperSummarizeResult {
        agent_message: agent_response,
        output_node_id,
    })
}

#[tauri::command]
pub async fn invoke_paper_chat(
    app: AppHandle,
    db: State<'_, Database>,
    node_id: String,
    user_message: String,
) -> Result<String, String> {
    emit_agent_log(&app, "info", "paper_chat", "invoke_paper_chat started", Some(&format!("message: {}", truncate_str(&user_message, 150))));

    if user_message.trim().is_empty() {
        return Err(to_error_json("unknown", "Message cannot be empty", None, false));
    }

    // Capability guard
    let capabilities = get_agent_capabilities(app.clone()).unwrap_or_default();
    if !capabilities.agent_enabled {
        return Err(to_error_json(
            "agent_disabled",
            "Agent is currently disabled. Enable it in Settings.",
            None,
            false,
        ));
    }

    // Gemini API key check
    let api_key = get_stored_gemini_api_key(&app).ok_or_else(|| {
        AgentError::ApiKeyMissing.to_error_info().to_json_string()
    })?;

    // Load paper node
    let paper_node = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            &format!("SELECT {} FROM nodes WHERE id = ?1", NODE_COLUMNS),
            [&node_id],
            node_from_row,
        )
        .map_err(|e| format!("Paper node not found: {e}"))?
    };

    // Get PDF path
    let pdf_path = paper_node.pdf_path.as_deref().ok_or_else(|| {
        to_error_json("invalid_input", "No PDF linked to this paper node.", None, false)
    })?;

    // Read PDF and base64 encode
    let pdf_bytes = std::fs::read(pdf_path).map_err(|e| {
        to_error_json("invalid_input", &format!("Failed to read PDF file: {e}"), None, false)
    })?;
    let pdf_base64 = base64::engine::general_purpose::STANDARD.encode(&pdf_bytes);

    // Load chat history (last 10 messages)
    let chat_history = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        get_chat_history(&conn, &node_id, 10)?
    };

    // Build multi-turn Gemini request
    // First message contains the PDF + initial context
    let mut contents = Vec::new();

    // If there's chat history, include the PDF in the first user turn with the original prompt
    if !chat_history.is_empty() {
        // First turn: PDF + original summarize prompt
        contents.push(serde_json::json!({
            "role": "user",
            "parts": [
                {
                    "inline_data": {
                        "mime_type": "application/pdf",
                        "data": pdf_base64
                    }
                },
                { "text": "I've attached a research paper PDF. Please help me understand and analyze this paper. Answer questions about it accurately based on the actual content." }
            ]
        }));

        // Reconstruct previous conversation turns
        for (role, content) in &chat_history {
            let gemini_role = if role == "agent" { "model" } else { "user" };
            contents.push(serde_json::json!({
                "role": gemini_role,
                "parts": [{ "text": content }]
            }));
        }

        // Current user message
        contents.push(serde_json::json!({
            "role": "user",
            "parts": [{ "text": user_message }]
        }));
    } else {
        // No history — first chat message includes PDF
        contents.push(serde_json::json!({
            "role": "user",
            "parts": [
                {
                    "inline_data": {
                        "mime_type": "application/pdf",
                        "data": pdf_base64
                    }
                },
                { "text": user_message }
            ]
        }));
    }

    emit_agent_log(&app, "info", "paper_chat", &format!("Sending chat request to Gemini — {} history messages", chat_history.len()), None);

    let body = serde_json::json!({
        "system_instruction": {
            "parts": [{ "text": "You are a research paper analysis assistant. You have access to the attached PDF paper. Answer questions accurately based on the paper's content. If you're unsure, say so. Respond in the same language as the user's question." }]
        },
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": 4096
        }
    });

    // Make API call with retry
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut last_error: Option<AgentError> = None;
    let mut response_text = String::new();
    let mut usage_info: Option<(u64, u64)> = None;

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            let delay_ms = RETRY_DELAYS_MS[(attempt - 1) as usize];
            eprintln!("[paper_chat] Retry attempt {attempt}/{MAX_RETRIES} after {delay_ms}ms");
            std::thread::sleep(Duration::from_millis(delay_ms));
        }

        match gemini_service::invoke_gemini_once(&http_client, &api_key, &body).await {
            Ok((text, usage)) => {
                response_text = text;
                usage_info = usage;
                last_error = None;
                break;
            }
            Err(e) if e.is_retryable() && attempt < MAX_RETRIES => {
                eprintln!("[paper_chat] Retryable error: {e}");
                last_error = Some(e);
                continue;
            }
            Err(e) => {
                if let Some((input_tokens, output_tokens)) = usage_info {
                    log_agent_usage(&db, "paper_chat", GEMINI_MODEL, input_tokens, output_tokens, false);
                }
                return Err(e.to_error_info().to_json_string());
            }
        }
    }

    if let Some(e) = last_error {
        return Err(e.to_error_info().to_json_string());
    }

    // Log successful usage
    if let Some((input_tokens, output_tokens)) = usage_info {
        log_agent_usage(&db, "paper_chat", GEMINI_MODEL, input_tokens, output_tokens, true);
    }

    let agent_response = response_text.trim().to_string();
    if agent_response.is_empty() {
        return Err(to_error_json(
            "parse_error",
            "Gemini returned an empty response. Please try again.",
            None,
            true,
        ));
    }

    // Save messages
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();

        let user_msg_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO agent_node_messages (id, node_id, role, content, output_node_id, created_at) VALUES (?1, ?2, 'user', ?3, NULL, ?4)",
            rusqlite::params![user_msg_id, node_id, user_message, now],
        ).map_err(|e| format!("Failed to save user message: {e}"))?;

        let agent_msg_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO agent_node_messages (id, node_id, role, content, output_node_id, created_at) VALUES (?1, ?2, 'agent', ?3, NULL, ?4)",
            rusqlite::params![agent_msg_id, node_id, agent_response, now],
        ).map_err(|e| format!("Failed to save agent message: {e}"))?;
    }

    Ok(agent_response)
}

// ─── Helpers ───

fn get_chat_history(
    conn: &rusqlite::Connection,
    node_id: &str,
    limit: usize,
) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT role, content FROM agent_node_messages \
             WHERE node_id = ?1 \
             ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, String)> = stmt
        .query_map(rusqlite::params![node_id, limit as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut history = rows;
    history.reverse();
    Ok(history)
}

fn create_summary_output_node(
    db: &Database,
    layer_id: &str,
    paper_node_id: &str,
    paper_node: &NodeData,
    content: &str,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let title = format!("Summary: {}", truncate_str(&paper_node.title, 40));
    let display_id = get_next_display_id(&conn, "note")?;

    let metadata = serde_json::json!({
        "produced_by_paper_summarize": paper_node_id,
        "paper_title": paper_node.title,
    })
    .to_string();

    // Position to the right of the paper node
    let position_x = paper_node.position_x + (paper_node.width.unwrap_or(280.0)) + 100.0;
    let position_y = paper_node.position_y;

    conn.execute(
        "INSERT INTO nodes (id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height)
         VALUES (?1, ?2, 'user_doc', ?3, ?4, NULL, ?5, NULL, ?6, ?7, ?8, 'active', 'agent', ?9, ?9, 260, 195)",
        rusqlite::params![
            id,
            layer_id,
            title,
            content,
            metadata,
            display_id,
            position_x,
            position_y,
            now,
        ],
    )
    .map_err(|e| format!("Failed to create summary node: {e}"))?;

    // Create edge from paper node to output node
    let edge_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO edges (id, layer_id, source_node_id, target_node_id, source_handle, target_handle, weight, comment, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'right', 'left-target', 3, '', 'agent', ?5, ?5)",
        rusqlite::params![edge_id, layer_id, paper_node_id, id, now],
    )
    .map_err(|e| format!("Failed to create edge to summary node: {e}"))?;

    Ok(id)
}

fn to_error_json(
    error_code: &str,
    message: &str,
    retry_after: Option<u64>,
    recoverable: bool,
) -> String {
    let info = AgentErrorInfo {
        error_code: error_code.to_string(),
        message: message.to_string(),
        retry_after_secs: retry_after,
        recoverable,
    };
    info.to_json_string()
}

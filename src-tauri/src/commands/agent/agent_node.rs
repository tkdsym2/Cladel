use crate::db::Database;
use super::claude_service::{ANTHROPIC_API_URL, CLAUDE_MODEL};
use super::gemini_service::{self, GEMINI_MODEL};
use super::parser::AnthropicResponse;
use super::{AgentError, AgentErrorInfo, emit_agent_log, get_stored_api_key, get_stored_gemini_api_key, log_agent_usage, truncate_str};
use crate::commands::nodes::{get_next_display_id, NodeData, NODE_COLUMNS, node_from_row};
use crate::commands::settings::get_agent_capabilities;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::time::Duration;
use tauri::{AppHandle, State};

// ─── Types ───

#[derive(Debug, Serialize, Deserialize)]
pub struct InvokeAgentNodeResult {
    pub agent_message: String,
    pub output_node_id: Option<String>,
    pub is_update: bool,
}

/// Connected node info gathered from the graph.
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct ConnectedNodeInfo {
    id: String,
    node_type: String,
    title: String,
    content: Option<String>,
    display_id: Option<String>,
    distance: usize,
}

// ─── Constants ───

const MAX_RETRIES: u32 = 2;
const RETRY_DELAYS_MS: [u64; 2] = [2000, 5000];
const MAX_CONTEXT_NODES: usize = 20;
const MAX_CONTENT_CHARS_NEAR: usize = 30000;
const MAX_CONTENT_CHARS_FAR: usize = 3000;
const MAX_TOKENS: u32 = 16384;

// ─── Tauri command ───

#[tauri::command]
pub async fn invoke_agent_node(
    app: AppHandle,
    db: State<'_, Database>,
    agent_node_id: String,
    user_message: String,
    update_node_id: Option<String>,
    provider: Option<String>,
) -> Result<InvokeAgentNodeResult, String> {
    if user_message.trim().is_empty() {
        return Err(to_error_json("unknown", "Message cannot be empty", None, false));
    }

    // Capability guard — check agent_enabled
    let capabilities = get_agent_capabilities(app.clone()).unwrap_or_default();
    if !capabilities.agent_enabled {
        return Err(to_error_json(
            "agent_disabled",
            "Agent is currently disabled. Enable it in Settings.",
            None,
            false,
        ));
    }

    // Determine provider
    let use_gemini = provider.as_deref() == Some("gemini");

    // Get API key for the selected provider
    let api_key = if use_gemini {
        get_stored_gemini_api_key(&app)
    } else {
        get_stored_api_key(&app)
    }.ok_or_else(|| {
        AgentError::ApiKeyMissing.to_error_info().to_json_string()
    })?;

    emit_agent_log(&app, "info", "agent_node", "invoke_agent_node started", Some(&format!("message: {}", truncate_str(&user_message, 150))));

    // Gather context from connected nodes (before any await)
    let (agent_node, connected_nodes, layer_id, chat_history) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        // Get the agent node itself
        let agent_node = conn
            .query_row(
                &format!("SELECT {} FROM nodes WHERE id = ?1", NODE_COLUMNS),
                [&agent_node_id],
                node_from_row,
            )
            .map_err(|e| format!("Agent node not found: {e}"))?;

        let layer_id = agent_node.layer_id.clone();

        // BFS to find connected nodes
        let connected = gather_connected_nodes(&conn, &agent_node_id, &layer_id)?;

        // Get recent chat history (last 10 messages)
        let history = get_recent_chat_history(&conn, &agent_node_id, 10)?;

        (agent_node, connected, layer_id, history)
    };

    // If updating, get the existing output node content
    let existing_output_content = if let Some(ref update_id) = update_node_id {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT content FROM nodes WHERE id = ?1",
            [update_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    } else {
        None
    };

    emit_agent_log(&app, "info", "agent_node", &format!("Context gathered: {} connected nodes, {} chat messages", connected_nodes.len(), chat_history.len()), None);

    // Build the system prompt for agent node invocation
    let system_prompt = build_agent_node_system_prompt();

    // Build user message with context
    let full_user_message = build_agent_node_user_message(
        &user_message,
        &agent_node,
        &connected_nodes,
        &chat_history,
        update_node_id.as_deref(),
        existing_output_content.as_deref(),
    );

    // Make API call with retry
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let model_name = if use_gemini { GEMINI_MODEL } else { CLAUDE_MODEL };
    emit_agent_log(&app, "info", "agent_node", &format!("Sending API request to {model_name}..."), Some(&format!("max_tokens: {MAX_TOKENS}, prompt size: ~{} chars", full_user_message.len())));

    let body = if use_gemini {
        gemini_service::build_gemini_request_body(&system_prompt, &full_user_message, MAX_TOKENS)
    } else {
        serde_json::json!({
            "model": CLAUDE_MODEL,
            "max_tokens": MAX_TOKENS,
            "system": system_prompt,
            "messages": [
                { "role": "user", "content": full_user_message }
            ]
        })
    };

    let mut last_error: Option<AgentError> = None;
    let mut response_text = String::new();
    let mut usage_info: Option<(u64, u64)> = None;

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            let delay_ms = RETRY_DELAYS_MS[(attempt - 1) as usize];
            eprintln!("[agent_node] Retry attempt {attempt}/{MAX_RETRIES} after {delay_ms}ms");
            std::thread::sleep(Duration::from_millis(delay_ms));
        }

        let call_result = if use_gemini {
            gemini_service::invoke_gemini_once(&http_client, &api_key, &body).await
        } else {
            invoke_claude_once(&http_client, &api_key, &body).await
        };

        match call_result {
            Ok((text, usage)) => {
                response_text = text;
                usage_info = usage;
                if let Some((inp, out)) = usage {
                    emit_agent_log(&app, "info", "agent_node", &format!("Response received — in:{inp} out:{out} tokens ({} chars)", response_text.len()), None);
                } else {
                    emit_agent_log(&app, "info", "agent_node", &format!("Response received — {} chars", response_text.len()), None);
                }
                last_error = None;
                break;
            }
            Err(e) if e.is_retryable() && attempt < MAX_RETRIES => {
                emit_agent_log(&app, "warn", "agent_node", &format!("Retryable error (attempt {attempt}/{MAX_RETRIES}): {e}"), None);
                eprintln!("[agent_node] Retryable error: {e}");
                last_error = Some(e);
                continue;
            }
            Err(e) => {
                emit_agent_log(&app, "error", "agent_node", &format!("API call failed: {e}"), None);
                // Log failed usage
                if let Some((input_tokens, output_tokens)) = usage_info {
                    log_agent_usage(&db, "agent_node", model_name, input_tokens, output_tokens, false);
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
        log_agent_usage(&db, "agent_node", model_name, input_tokens, output_tokens, true);
    }

    // Parse the response — agent node returns plain text (not JSON suggestions)
    let agent_response = response_text.trim().to_string();

    if agent_response.is_empty() {
        return Err(to_error_json(
            "parse_error",
            "Agent returned an empty response. Please try again.",
            None,
            true,
        ));
    }

    // Create or update the output node
    let is_update = update_node_id.is_some();
    let output_node_id = if let Some(update_id) = update_node_id {
        // Update existing output node
        update_output_node(&db, &update_id, &agent_response)?;
        update_id
    } else {
        // Create new output Note node
        create_output_node(
            &db,
            &layer_id,
            &agent_node_id,
            &agent_node,
            &user_message,
            &agent_response,
        )?
    };

    emit_agent_log(&app, "info", "agent_node", &format!("Output node {} — id={}", if is_update { "updated" } else { "created" }, &output_node_id), None);

    Ok(InvokeAgentNodeResult {
        agent_message: agent_response,
        output_node_id: Some(output_node_id),
        is_update,
    })
}

// ─── Claude API call ───

pub(super) async fn invoke_claude_once(
    client: &reqwest::Client,
    api_key: &str,
    body: &serde_json::Value,
) -> Result<(String, Option<(u64, u64)>), AgentError> {
    let response = client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", api_key)
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

    let usage = api_resp.usage.map(|u| (u.input_tokens, u.output_tokens));

    let raw_text = api_resp
        .content
        .first()
        .and_then(|c| c.text.as_deref())
        .unwrap_or("")
        .to_string();

    Ok((raw_text, usage))
}

// ─── Context gathering ───

/// BFS from the agent node to find connected nodes within the same layer.
fn gather_connected_nodes(
    conn: &rusqlite::Connection,
    agent_node_id: &str,
    layer_id: &str,
) -> Result<Vec<ConnectedNodeInfo>, String> {
    // Get all edges in this layer
    let mut stmt = conn
        .prepare(
            "SELECT source_node_id, target_node_id FROM edges WHERE layer_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let edges: Vec<(String, String)> = stmt
        .query_map([layer_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Build adjacency list (undirected)
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for (src, tgt) in &edges {
        adj.entry(src.clone()).or_default().push(tgt.clone());
        adj.entry(tgt.clone()).or_default().push(src.clone());
    }

    // BFS from agent node
    let mut distances: HashMap<String, usize> = HashMap::new();
    distances.insert(agent_node_id.to_string(), 0);
    let mut queue = VecDeque::new();
    queue.push_back(agent_node_id.to_string());

    while let Some(current) = queue.pop_front() {
        let current_dist = distances[&current];
        if let Some(neighbors) = adj.get(&current) {
            for neighbor in neighbors {
                if !distances.contains_key(neighbor) {
                    distances.insert(neighbor.clone(), current_dist + 1);
                    queue.push_back(neighbor.clone());
                }
            }
        }
    }

    // Fetch node details for connected nodes (excluding the agent node itself)
    let mut connected: Vec<ConnectedNodeInfo> = Vec::new();
    let query = format!(
        "SELECT {} FROM nodes WHERE layer_id = ?1 AND id != ?2 AND node_type NOT IN ('deleted', 'junction')",
        NODE_COLUMNS
    );

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let nodes: Vec<NodeData> = stmt
        .query_map(rusqlite::params![layer_id, agent_node_id], node_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for node in nodes {
        let distance = distances.get(&node.id).copied().unwrap_or(usize::MAX);
        // Only include nodes that are reachable from the agent node
        if distance == usize::MAX {
            continue;
        }

        connected.push(ConnectedNodeInfo {
            id: node.id,
            node_type: node.node_type,
            title: node.title,
            content: node.content,
            display_id: node.display_id,
            distance,
        });
    }

    // Sort by distance (closest first), then by node type priority
    connected.sort_by(|a, b| {
        a.distance.cmp(&b.distance).then_with(|| {
            let priority = |t: &str| -> u8 {
                match t {
                    "core" => 0,
                    "paper" => 1,
                    "user_doc" => 2,
                    "agent" => 3,
                    _ => 4,
                }
            };
            priority(&a.node_type).cmp(&priority(&b.node_type))
        })
    });

    // Limit to top N nodes
    connected.truncate(MAX_CONTEXT_NODES);

    Ok(connected)
}

/// Get recent chat history for context.
fn get_recent_chat_history(
    conn: &rusqlite::Connection,
    agent_node_id: &str,
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
        .query_map(rusqlite::params![agent_node_id, limit as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Reverse to get chronological order
    let mut history = rows;
    history.reverse();
    Ok(history)
}

// ─── Prompt building ───

fn build_agent_node_system_prompt() -> String {
    r#"You are a research assistant embedded in an Agent Node within Cladel, a knowledge graph application.

## Your Role
You analyze the nodes connected to your Agent Node and produce research output based on the user's instructions. You can see the content of connected nodes (papers, notes, core research question) and use them as context.

## How You Work
- You receive context from nodes directly connected to your Agent Node in the knowledge graph.
- The user gives you instructions about what to produce (summaries, analyses, synthesis, etc.).
- You produce a text output that will be saved as a Note node in the graph.
- Your output should be substantive, well-structured, and directly useful for the researcher.

## Output Format
- Write your response as plain text or markdown.
- Be thorough but concise. Structure with headings if the output is long.
- Reference specific nodes by their display_id when discussing their content (e.g., "As discussed in [paper_1]...").
- Do NOT wrap your response in JSON. Just write the content directly.

## Quality Guidelines
- Ground your analysis in the actual content of connected nodes.
- If asked to synthesize, identify themes, tensions, and gaps across the connected material.
- If asked to summarize, capture the essential points without losing critical nuance.
- If the connected context is insufficient for the task, say so clearly and explain what additional information would help.
- When updating existing output, preserve what was good and refine based on the new instructions."#
        .to_string()
}

fn build_agent_node_user_message(
    user_message: &str,
    agent_node: &NodeData,
    connected_nodes: &[ConnectedNodeInfo],
    chat_history: &[(String, String)],
    update_node_id: Option<&str>,
    existing_output: Option<&str>,
) -> String {
    let mut msg = String::with_capacity(8192);

    msg.push_str("## Instruction\n");
    msg.push_str(user_message);
    msg.push_str("\n\n");

    // Agent node info
    if let Some(ref did) = agent_node.display_id {
        msg.push_str(&format!("Agent Node: {} (\"{}\")\n\n", did, agent_node.title));
    }

    // Connected nodes context
    if !connected_nodes.is_empty() {
        msg.push_str(&format!(
            "## Connected Nodes ({} nodes)\n\n",
            connected_nodes.len()
        ));

        for node in connected_nodes {
            let did = node.display_id.as_deref().unwrap_or("—");
            msg.push_str(&format!(
                "### [{}] {} (type: {}, distance: {})\n",
                did, node.title, node.node_type, node.distance
            ));

            if let Some(ref content) = node.content {
                if !content.is_empty() {
                    // Use larger limit for directly connected nodes (distance 1)
                    let max_chars = if node.distance <= 1 {
                        MAX_CONTENT_CHARS_NEAR
                    } else {
                        MAX_CONTENT_CHARS_FAR
                    };
                    let truncated = truncate_str(content, max_chars);
                    msg.push_str(&truncated);
                    msg.push('\n');
                }
            }
            msg.push('\n');
        }
    } else {
        msg.push_str("## Connected Nodes\nNo nodes are currently connected to this Agent Node. Connect nodes to provide context.\n\n");
    }

    // Chat history (for continuity)
    if !chat_history.is_empty() {
        msg.push_str("## Recent Conversation\n");
        for (role, content) in chat_history {
            let label = if role == "agent" { "Agent" } else { "User" };
            let truncated = truncate_str(content, 2000);
            msg.push_str(&format!("[{label}]: {truncated}\n"));
        }
        msg.push('\n');
    }

    // If updating, include existing output
    if update_node_id.is_some() {
        msg.push_str("## Current Output (to be updated)\n");
        if let Some(existing) = existing_output {
            msg.push_str(existing);
        } else {
            msg.push_str("(empty)");
        }
        msg.push_str("\n\n");
        msg.push_str("Please update the output above based on the user's instruction. Preserve what is good and refine as directed.\n");
    }

    msg
}

// ─── Output node management ───

/// Create a new output Note node linked to the agent node.
fn create_output_node(
    db: &Database,
    layer_id: &str,
    agent_node_id: &str,
    agent_node: &NodeData,
    user_instruction: &str,
    content: &str,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Generate a title from the instruction (first ~50 chars, UTF-8 safe)
    let title = truncate_str(user_instruction, 50);

    let display_id = get_next_display_id(&conn, "note")?;

    // Store metadata linking back to the agent node
    let metadata = serde_json::json!({
        "produced_by_agent_node_id": agent_node_id,
        "agent_node_title": agent_node.title,
    })
    .to_string();

    // Count existing output nodes produced by this agent to calculate vertical offset
    let existing_output_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM nodes WHERE layer_id = ?1 AND metadata LIKE ?2 AND node_type = 'user_doc'",
            rusqlite::params![layer_id, format!("%\"produced_by_agent_node_id\":\"{}\"%" , agent_node_id)],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Position the output node to the right of the agent node, stacked vertically
    let position_x = agent_node.position_x + (agent_node.width.unwrap_or(280.0)) + 100.0;
    let position_y = agent_node.position_y + (existing_output_count as f64 * 275.0);

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
    .map_err(|e| format!("Failed to create output node: {e}"))?;

    // Create an edge from the agent node to the output node
    let edge_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO edges (id, layer_id, source_node_id, target_node_id, source_handle, target_handle, weight, comment, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'right', 'left-target', 3, '', 'agent', ?5, ?5)",
        rusqlite::params![edge_id, layer_id, agent_node_id, id, now],
    )
    .map_err(|e| format!("Failed to create edge to output node: {e}"))?;

    Ok(id)
}

/// Update an existing output node's content.
fn update_output_node(
    db: &Database,
    node_id: &str,
    content: &str,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE nodes SET content = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![content, now, node_id],
    )
    .map_err(|e| format!("Failed to update output node: {e}"))?;

    Ok(())
}

// ─── Error helper ───

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


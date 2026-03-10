use crate::db::Database;
use super::agent_node::invoke_claude_once;
use super::claude_service::CLAUDE_MODEL;
use super::gemini_service::{self, GEMINI_MODEL};
use super::{AgentError, AgentErrorInfo, emit_agent_log, get_stored_api_key, get_stored_gemini_api_key, log_agent_usage, truncate_str};
use crate::commands::nodes::{NODE_COLUMNS, node_from_row, NodeData};
use crate::commands::pdf_import::extract_text_from_pdf;
use crate::commands::settings::get_agent_capabilities;
use std::collections::{HashMap, VecDeque};
use std::time::Duration;
use tauri::{AppHandle, State};

const MAX_CONTEXT_NODES: usize = 15;
const MAX_CONTENT_CHARS: usize = 1200;
const MAX_TARGET_CONTENT_CHARS: usize = 4000;
const MAX_TARGET_PDF_CHARS: usize = 4000;
const MAX_CONNECTED_PDF_CHARS: usize = 2000;
const MAX_RETRIES: u32 = 2;
const RETRY_DELAYS_MS: [u64; 2] = [2000, 5000];

#[tauri::command]
pub async fn invoke_agent_comment(
    app: AppHandle,
    db: State<'_, Database>,
    node_id: String,
    layer_id: String,
    user_message: String,
    provider: Option<String>,
) -> Result<String, String> {
    emit_agent_log(&app, "info", "comment_agent", "invoke_agent_comment started", Some(&format!("node: {node_id}, message: {}", truncate_str(&user_message, 150))));

    if user_message.trim().is_empty() {
        return Err(to_error_json("unknown", "Message cannot be empty"));
    }

    // Capability guard
    let capabilities = get_agent_capabilities(app.clone()).unwrap_or_default();
    if !capabilities.agent_enabled {
        return Err(to_error_json(
            "agent_disabled",
            "Agent is currently disabled. Enable it in Settings.",
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

    // Gather context (before any await)
    let (target_node, connected_context, recent_comments) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        // Get the full target node data (content, bibtex, metadata, pdf_path, etc.)
        let target: NodeData = conn
            .query_row(
                &format!("SELECT {} FROM nodes WHERE id = ?1", NODE_COLUMNS),
                [&node_id],
                node_from_row,
            )
            .map_err(|e| format!("Node not found: {e}"))?;

        // BFS to find connected nodes
        let connected = gather_comment_context(&conn, &node_id, &layer_id)?;

        // Get recent node comments (last 10)
        let comments = get_recent_node_comments(&conn, &node_id, 10)?;

        (target, connected, comments)
    };

    emit_agent_log(&app, "info", "comment_agent", &format!("Target node: [{}] \"{}\" ({}), {} connected nodes, {} comments", target_node.display_id.as_deref().unwrap_or("—"), truncate_str(&target_node.title, 40), target_node.node_type, connected_context.len(), recent_comments.len()), None);

    // Extract PDF text for the target node if it's a paper with a linked PDF
    let target_pdf_text = extract_pdf_text_for_node(&target_node, MAX_TARGET_PDF_CHARS);

    // Extract PDF text for connected paper nodes (distance 1 only, to limit cost)
    let connected_pdf_texts: HashMap<usize, String> = connected_context
        .iter()
        .enumerate()
        .filter(|(_, n)| n.node_type == "paper" && n.pdf_path.is_some() && n.distance <= 1)
        .filter_map(|(i, n)| {
            extract_pdf_text_for_path(n.pdf_path.as_deref().unwrap(), MAX_CONNECTED_PDF_CHARS)
                .map(|text| (i, text))
        })
        .collect();

    if target_pdf_text.is_some() {
        emit_agent_log(&app, "info", "comment_agent", "PDF text extracted for target node", None);
    }
    if !connected_pdf_texts.is_empty() {
        emit_agent_log(&app, "info", "comment_agent", &format!("{} connected paper PDF(s) extracted", connected_pdf_texts.len()), None);
    }

    // Build prompt
    let system_prompt = build_comment_system_prompt();
    let full_message = build_comment_user_message(
        &user_message,
        &target_node,
        &target_pdf_text,
        &connected_context,
        &connected_pdf_texts,
        &recent_comments,
    );

    // Make API call with retry
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let model_name = if use_gemini { GEMINI_MODEL } else { CLAUDE_MODEL };
    emit_agent_log(&app, "info", "comment_agent", &format!("Sending API request to {model_name}..."), Some(&format!("prompt size: ~{} chars", full_message.len())));

    let body = if use_gemini {
        gemini_service::build_gemini_request_body(&system_prompt, &full_message, 1024)
    } else {
        serde_json::json!({
            "model": CLAUDE_MODEL,
            "max_tokens": 1024,
            "system": system_prompt,
            "messages": [
                { "role": "user", "content": full_message }
            ]
        })
    };

    let mut last_error: Option<AgentError> = None;
    let mut response_text = String::new();
    let mut usage_info: Option<(u64, u64)> = None;

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            let delay_ms = RETRY_DELAYS_MS[(attempt - 1) as usize];
            eprintln!("[comment_agent] Retry attempt {attempt}/{MAX_RETRIES} after {delay_ms}ms");
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
                    emit_agent_log(&app, "info", "comment_agent", &format!("Response received — in:{inp} out:{out} tokens"), None);
                } else {
                    emit_agent_log(&app, "info", "comment_agent", "Response received", None);
                }
                last_error = None;
                break;
            }
            Err(e) if e.is_retryable() && attempt < MAX_RETRIES => {
                emit_agent_log(&app, "warn", "comment_agent", &format!("Retryable error (attempt {attempt}/{MAX_RETRIES}): {e}"), None);
                eprintln!("[comment_agent] Retryable error: {e}");
                last_error = Some(e);
                continue;
            }
            Err(e) => {
                emit_agent_log(&app, "error", "comment_agent", &format!("API call failed: {e}"), None);
                if let Some((input_tokens, output_tokens)) = usage_info {
                    log_agent_usage(&db, "comment_agent", model_name, input_tokens, output_tokens, false);
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
        log_agent_usage(&db, "comment_agent", model_name, input_tokens, output_tokens, true);
    }

    let agent_response = response_text.trim().to_string();
    if agent_response.is_empty() {
        emit_agent_log(&app, "error", "comment_agent", "Agent returned an empty response", None);
        return Err(to_error_json("parse_error", "Agent returned an empty response."));
    }

    emit_agent_log(&app, "info", "comment_agent", &format!("Comment agent completed — {} chars", agent_response.len()), None);

    Ok(agent_response)
}

// ─── Context gathering ───

struct CommentContextNode {
    node_type: String,
    title: String,
    content: Option<String>,
    bibtex: Option<String>,
    pdf_path: Option<String>,
    display_id: Option<String>,
    distance: usize,
}

fn gather_comment_context(
    conn: &rusqlite::Connection,
    node_id: &str,
    layer_id: &str,
) -> Result<Vec<CommentContextNode>, String> {
    // Get all edges in this layer
    let mut stmt = conn
        .prepare("SELECT source_node_id, target_node_id FROM edges WHERE layer_id = ?1")
        .map_err(|e| e.to_string())?;

    let edges: Vec<(String, String)> = stmt
        .query_map([layer_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Build adjacency list
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();
    for (src, tgt) in &edges {
        adj.entry(src.clone()).or_default().push(tgt.clone());
        adj.entry(tgt.clone()).or_default().push(src.clone());
    }

    // BFS from target node
    let mut distances: HashMap<String, usize> = HashMap::new();
    distances.insert(node_id.to_string(), 0);
    let mut queue = VecDeque::new();
    queue.push_back(node_id.to_string());

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

    // Fetch connected node details
    let query = format!(
        "SELECT {} FROM nodes WHERE layer_id = ?1 AND id != ?2 AND node_type NOT IN ('deleted', 'junction')",
        NODE_COLUMNS
    );
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let nodes: Vec<crate::commands::nodes::NodeData> = stmt
        .query_map(rusqlite::params![layer_id, node_id], node_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut connected: Vec<CommentContextNode> = Vec::new();
    for node in nodes {
        let distance = distances.get(&node.id).copied().unwrap_or(usize::MAX);
        if distance == usize::MAX {
            continue;
        }
        connected.push(CommentContextNode {
            node_type: node.node_type,
            title: node.title,
            content: node.content,
            bibtex: node.bibtex,
            pdf_path: node.pdf_path,
            display_id: node.display_id,
            distance,
        });
    }

    connected.sort_by(|a, b| a.distance.cmp(&b.distance));
    connected.truncate(MAX_CONTEXT_NODES);
    Ok(connected)
}

fn get_recent_node_comments(
    conn: &rusqlite::Connection,
    node_id: &str,
    limit: usize,
) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT author_type, content FROM node_comments \
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

// ─── Prompt building ───

fn build_comment_system_prompt() -> String {
    r#"You are a research assistant responding to a comment thread on a node in Cladel, a knowledge graph application.

## Your Role
You provide helpful, concise responses as comments. You can see the node's connected context and the recent comment history on this node.

## Output Format
- Write a direct, conversational response.
- Be concise — comments should be brief and focused (1-3 paragraphs max).
- Reference specific nodes by their display_id when relevant.
- Do NOT wrap your response in JSON or markdown code blocks.

## Quality Guidelines
- Answer questions directly using context from connected nodes.
- Offer insights, suggestions, or clarifications relevant to the discussion.
- If you lack sufficient context, say so briefly."#
        .to_string()
}

/// Extract PDF text for a node if it has a pdf_path.
fn extract_pdf_text_for_node(node: &NodeData, max_chars: usize) -> Option<String> {
    let pdf_path = node.pdf_path.as_deref()?;
    extract_pdf_text_for_path(pdf_path, max_chars)
}

/// Extract PDF text from a file path, truncated to max_chars.
fn extract_pdf_text_for_path(pdf_path: &str, max_chars: usize) -> Option<String> {
    match extract_text_from_pdf(pdf_path) {
        Ok(text) => {
            if text.len() > max_chars {
                Some(truncate_str(&text, max_chars))
            } else {
                Some(text)
            }
        }
        Err(e) => {
            eprintln!("[comment_agent] Failed to extract PDF text: {e}");
            None
        }
    }
}

fn build_comment_user_message(
    user_message: &str,
    target_node: &NodeData,
    target_pdf_text: &Option<String>,
    connected_nodes: &[CommentContextNode],
    connected_pdf_texts: &HashMap<usize, String>,
    recent_comments: &[(String, String)],
) -> String {
    let mut msg = String::with_capacity(8192);

    // Target node with full details
    let did = target_node.display_id.as_deref().unwrap_or("—");
    msg.push_str(&format!(
        "## Target Node: [{}] \"{}\" (type: {})\n\n",
        did, target_node.title, target_node.node_type
    ));

    // Include target node's full content
    if let Some(ref content) = target_node.content {
        if !content.is_empty() {
            msg.push_str("### Content\n");
            let truncated = truncate_str(content, MAX_TARGET_CONTENT_CHARS);
            msg.push_str(&truncated);
            msg.push_str("\n\n");
        }
    }

    // Include BibTeX metadata for paper nodes
    if target_node.node_type == "paper" {
        if let Some(ref bibtex) = target_node.bibtex {
            if !bibtex.is_empty() {
                msg.push_str("### BibTeX\n");
                msg.push_str(&truncate_str(bibtex, 1200));
                msg.push_str("\n\n");
            }
        }
    }

    // Include PDF extracted text for the target node
    if let Some(ref pdf_text) = target_pdf_text {
        msg.push_str("### PDF Extracted Text\n");
        msg.push_str(pdf_text);
        msg.push_str("\n\n");
    }

    // Recent comment thread
    if !recent_comments.is_empty() {
        msg.push_str("## Recent Comments\n");
        for (author, content) in recent_comments {
            let label = if author == "agent" { "AI" } else { "User" };
            let truncated = truncate_str(content, 400);
            msg.push_str(&format!("[{label}]: {truncated}\n"));
        }
        msg.push('\n');
    }

    // Connected nodes context
    if !connected_nodes.is_empty() {
        msg.push_str(&format!(
            "## Connected Nodes ({} nodes)\n\n",
            connected_nodes.len()
        ));
        for (i, node) in connected_nodes.iter().enumerate() {
            let did = node.display_id.as_deref().unwrap_or("—");
            msg.push_str(&format!(
                "### [{}] {} (type: {}, distance: {})\n",
                did, node.title, node.node_type, node.distance
            ));
            if let Some(ref content) = node.content {
                if !content.is_empty() {
                    let truncated = truncate_str(content, MAX_CONTENT_CHARS);
                    msg.push_str(&truncated);
                    msg.push('\n');
                }
            }
            // Include BibTeX for connected paper nodes
            if node.node_type == "paper" {
                if let Some(ref bibtex) = node.bibtex {
                    if !bibtex.is_empty() {
                        msg.push_str(&format!("BibTeX: {}\n", truncate_str(bibtex, 600)));
                    }
                }
            }
            // Include PDF text for nearby connected paper nodes
            if let Some(pdf_text) = connected_pdf_texts.get(&i) {
                msg.push_str("PDF Text: ");
                msg.push_str(pdf_text);
                msg.push('\n');
            }
            msg.push('\n');
        }
    }

    msg.push_str("## User's Comment\n");
    msg.push_str(user_message);
    msg.push('\n');

    msg
}

// ─── Error helper ───

fn to_error_json(error_code: &str, message: &str) -> String {
    let info = AgentErrorInfo {
        error_code: error_code.to_string(),
        message: message.to_string(),
        retry_after_secs: None,
        recoverable: false,
    };
    info.to_json_string()
}

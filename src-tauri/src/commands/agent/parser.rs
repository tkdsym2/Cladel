use super::{
    AgentContext, AgentResponse, AgentSuggestionData, ConnectionSuggestion,
    truncate_str,
};
use super::super::literature::PaperResult;
use serde::Deserialize;

// ─── Response envelope types ───

/// Response envelope from Anthropic Messages API.
#[derive(Deserialize)]
pub(crate) struct AnthropicResponse {
    pub content: Vec<AnthropicContent>,
    pub usage: Option<AnthropicUsage>,
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub(crate) struct AnthropicUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Deserialize)]
pub(crate) struct AnthropicContent {
    pub text: Option<String>,
}

/// The JSON shape Claude returns inside its text response.
#[derive(Debug, Deserialize)]
struct ClaudeRawResponse {
    message: Option<String>,
    suggestions: Option<Vec<ClaudeRawSuggestion>>,
}

#[derive(Debug, Deserialize)]
struct ClaudeRawSuggestion {
    #[serde(rename = "type")]
    suggestion_type: Option<String>,
    title: Option<String>,
    description: Option<String>,
    data: Option<serde_json::Value>,
}

// ─── JSON extraction ───

/// Extract JSON from Claude's response text, handling common patterns:
/// 1. Pure JSON (ideal)
/// 2. JSON in markdown code block (```json ... ```)
/// 3. Text before/after JSON (bracket matching)
fn extract_json_from_response(text: &str) -> Option<ClaudeRawResponse> {
    let trimmed = text.trim();

    // 1. Try parsing the whole text as-is
    if let Ok(parsed) = serde_json::from_str::<ClaudeRawResponse>(trimmed) {
        eprintln!("[agent] JSON extraction: pure JSON parse succeeded");
        return Some(parsed);
    }

    // 2. Strip markdown code blocks: ```json\n...\n``` or ```\n...\n```
    let stripped = strip_code_blocks(trimmed);
    if stripped != trimmed {
        if let Ok(parsed) = serde_json::from_str::<ClaudeRawResponse>(stripped.trim()) {
            eprintln!("[agent] JSON extraction: code-block stripping succeeded");
            return Some(parsed);
        }
    }

    // 3. Bracket matching: find first { to matching }
    if let Some(json_str) = extract_balanced_json(trimmed) {
        if let Ok(parsed) = serde_json::from_str::<ClaudeRawResponse>(&json_str) {
            eprintln!("[agent] JSON extraction: bracket matching succeeded");
            return Some(parsed);
        }
    }

    // 4. Last resort: first { to last }
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            if let Ok(parsed) =
                serde_json::from_str::<ClaudeRawResponse>(&trimmed[start..=end])
            {
                eprintln!("[agent] JSON extraction: first-last bracket fallback succeeded");
                return Some(parsed);
            }
        }
    }

    eprintln!("[agent] JSON extraction: all methods failed");
    None
}

/// Strip markdown code fences from text.
fn strip_code_blocks(text: &str) -> &str {
    let text = text.trim();
    // Match ```json or ``` at start
    let inner = if text.starts_with("```json") {
        &text[7..]
    } else if text.starts_with("```") {
        &text[3..]
    } else {
        return text;
    };
    // Strip trailing ```
    let inner = inner.trim_start_matches('\n');
    if let Some(end_pos) = inner.rfind("```") {
        &inner[..end_pos]
    } else {
        inner
    }
}

/// Extract the first balanced JSON object from text.
/// Walks from the first `{` counting braces, handling string literals.
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

// ─── Suggestion validation ───

/// Validate and convert a raw suggestion into an `AgentSuggestionData`.
/// Returns `None` if the suggestion is invalid (with debug logging).
fn validate_suggestion(
    raw: ClaudeRawSuggestion,
    context: &AgentContext,
) -> Option<AgentSuggestionData> {
    let stype = raw.suggestion_type.as_deref().unwrap_or("idea");
    let title = raw.title.unwrap_or_default();
    let description = raw.description.unwrap_or_default();
    let data = raw.data.unwrap_or(serde_json::Value::Null);

    match stype {
        "paper" => validate_paper_suggestion(title, description, &data),
        "idea" => validate_idea_suggestion(title, description, &data),
        "connection" => validate_connection_suggestion(title, description, &data, context),
        other => {
            eprintln!("[agent] Unknown suggestion type \"{other}\", treating as idea");
            validate_idea_suggestion(title, description, &data)
        }
    }
}

fn validate_paper_suggestion(
    title: String,
    description: String,
    data: &serde_json::Value,
) -> Option<AgentSuggestionData> {
    // Extract paper title — try data.title first, fall back to suggestion title
    let paper_title = data
        .get("title")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            data.get("paper_title")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or(&title);

    if paper_title.is_empty() {
        eprintln!("[agent] Skipping paper suggestion: no title found");
        return None;
    }

    // Authors — handle both array of strings and single comma-separated string
    let authors: Vec<String> = if let Some(arr) = data.get("authors").and_then(|v| v.as_array()) {
        arr.iter()
            .filter_map(|a| a.as_str().map(String::from))
            .collect()
    } else if let Some(s) = data.get("authors").and_then(|v| v.as_str()) {
        s.split(',').map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect()
    } else {
        vec![]
    };

    // Year — handle both number and string
    let year: Option<i32> = data
        .get("year")
        .and_then(|v| {
            v.as_i64()
                .map(|y| y as i32)
                .or_else(|| v.as_str().and_then(|s| s.parse::<i32>().ok()))
        });

    let abstract_text = data
        .get("abstract_text")
        .or_else(|| data.get("abstract"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    let url = data
        .get("url")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    let paper_id = data
        .get("paper_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let paper_data = PaperResult {
        paper_id,
        title: paper_title.to_string(),
        authors,
        year,
        abstract_text,
        url,
    };

    let desc = if description.is_empty() {
        format!("Suggested paper: {paper_title}")
    } else {
        description
    };

    Some(AgentSuggestionData {
        suggestion_type: "paper".to_string(),
        title: if title.is_empty() {
            paper_title.to_string()
        } else {
            title
        },
        description: desc,
        paper_data: Some(paper_data),
        idea_body: None,
        connection: None,
    })
}

fn validate_idea_suggestion(
    title: String,
    description: String,
    data: &serde_json::Value,
) -> Option<AgentSuggestionData> {
    // Body: try data.body, fall back to description
    let body = data
        .get("body")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(&description)
        .to_string();

    if body.is_empty() {
        eprintln!("[agent] Skipping idea suggestion: no body or description");
        return None;
    }

    let idea_title = if title.is_empty() {
        truncate_str(&body, 60)
    } else {
        title
    };

    let desc = if description.is_empty() {
        truncate_str(&body, 150)
    } else {
        description
    };

    Some(AgentSuggestionData {
        suggestion_type: "idea".to_string(),
        title: idea_title,
        description: desc,
        paper_data: None,
        idea_body: Some(body),
        connection: None,
    })
}

fn validate_connection_suggestion(
    title: String,
    description: String,
    data: &serde_json::Value,
    context: &AgentContext,
) -> Option<AgentSuggestionData> {
    let raw_source = data
        .get("source_node_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let raw_target = data
        .get("target_node_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if raw_source.is_empty() || raw_target.is_empty() {
        eprintln!("[agent] Skipping connection: missing source or target node ID");
        return None;
    }

    // Resolve node IDs — exact match first, then fuzzy title match
    let source_id = resolve_node_id(&raw_source, context);
    let target_id = resolve_node_id(&raw_target, context);

    let source_id = match source_id {
        Some(id) => id,
        None => {
            eprintln!(
                "[agent] Skipping connection: source node \"{}\" not found in graph",
                raw_source
            );
            return None;
        }
    };
    let target_id = match target_id {
        Some(id) => id,
        None => {
            eprintln!(
                "[agent] Skipping connection: target node \"{}\" not found in graph",
                raw_target
            );
            return None;
        }
    };

    // Self-connection check
    if source_id == target_id {
        eprintln!("[agent] Skipping connection: source and target are the same node");
        return None;
    }

    let reason = data
        .get("reason")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(&description)
        .to_string();

    if reason.is_empty() {
        eprintln!("[agent] Skipping connection: no reason provided");
        return None;
    }

    let desc = if description.is_empty() {
        reason.clone()
    } else {
        description
    };

    Some(AgentSuggestionData {
        suggestion_type: "connection".to_string(),
        title: if title.is_empty() {
            "Suggested connection".to_string()
        } else {
            title
        },
        description: desc,
        paper_data: None,
        idea_body: None,
        connection: Some(ConnectionSuggestion {
            source_node_id: source_id,
            target_node_id: target_id,
            reason,
        }),
    })
}

// ─── Fuzzy node ID resolution ───

/// Resolve a node reference to an actual node ID.
/// First tries exact ID match, then case-insensitive title match.
fn resolve_node_id(reference: &str, context: &AgentContext) -> Option<String> {
    // Exact ID match
    if context
        .node_summaries
        .iter()
        .any(|n| n.id == reference)
    {
        return Some(reference.to_string());
    }

    // Fuzzy: case-insensitive title match (Claude sometimes puts titles instead of IDs)
    let ref_lower = reference.to_lowercase();
    let matched = context
        .node_summaries
        .iter()
        .find(|n| n.title.to_lowercase() == ref_lower);
    if let Some(node) = matched {
        eprintln!(
            "[agent] Fuzzy-matched node reference \"{}\" to id \"{}\" via title",
            reference, node.id
        );
        return Some(node.id.clone());
    }

    None
}

// ─── Full response parsing ───

/// Parse and validate the full Claude response, with tiered fallback.
pub(crate) fn parse_claude_response(
    raw_text: &str,
    context: &AgentContext,
) -> AgentResponse {
    // Tier 5: Empty response
    if raw_text.trim().is_empty() {
        eprintln!("[agent] Empty response from Claude");
        return AgentResponse {
            message: "I wasn't able to generate suggestions for this query. Please try rephrasing.".to_string(),
            suggestions: vec![],
        };
    }

    // Try to extract and parse JSON
    let parsed = extract_json_from_response(raw_text);

    match parsed {
        Some(raw_response) => {
            // Tier 1-3: JSON parsed successfully (full or partial)
            let message = raw_response
                .message
                .filter(|m| !m.is_empty())
                .unwrap_or_else(|| "Here are my suggestions.".to_string());

            let raw_suggestions = raw_response.suggestions.unwrap_or_default();
            let raw_count = raw_suggestions.len();

            // Validate each suggestion
            let suggestions: Vec<AgentSuggestionData> = raw_suggestions
                .into_iter()
                .filter_map(|s| validate_suggestion(s, context))
                .collect();

            let valid_count = suggestions.len();
            let skipped = raw_count - valid_count;
            eprintln!(
                "[agent] Suggestions: {raw_count} received, {valid_count} valid, {skipped} skipped"
            );

            AgentResponse {
                message,
                suggestions,
            }
        }
        None => {
            // Tier 4: No JSON found — extract useful text as message
            eprintln!("[agent] No valid JSON found in response, using raw text as message");
            let clean_text = raw_text.trim();
            // Try to extract something readable (skip if it looks like garbled JSON)
            let message = if clean_text.starts_with('{') || clean_text.starts_with('[') {
                "I received an unexpected response format. Please try again.".to_string()
            } else {
                truncate_str(clean_text, 500)
            };
            AgentResponse {
                message,
                suggestions: vec![],
            }
        }
    }
}

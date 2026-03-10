use super::{
    AgentContext, AgentEdgeComment, EdgeSummary, NodeSummary,
    truncate_str,
};
use crate::db::Database;
use std::collections::{HashMap, VecDeque};

// ─── Token budget constants ───

/// Character-based token budget constants (~4 chars ≈ 1 token).
const CORE_CONTENT_MAX_CHARS: usize = 2000; // ~500 tokens
const TOKEN_BUDGET_TIER2_CHARS: usize = 4400; // ~1100 tokens
const TOKEN_BUDGET_TIER3_CHARS: usize = 1800; // ~450 tokens
const TOKEN_BUDGET_EDGES_CHARS: usize = 1600; // ~400 tokens (increased for comment content)
const TOKEN_BUDGET_EDGE_COMMENTS_CHARS: usize = 3200; // ~800 tokens for edge comment threads

/// Rough character-based token estimate (~4 chars ≈ 1 token).
#[allow(dead_code)]
fn estimate_tokens(text: &str) -> usize {
    text.len() / 4 + 1
}

/// Estimate how many characters a node summary takes with full content.
fn estimate_node_chars_full(node: &NodeSummary) -> usize {
    // "- [uuid] Title (type: xxx, N connections): content...\n"
    let base = 50 + node.id.len() + node.title.len() + node.node_type.len();
    let content = node.content_preview.as_deref().map_or(0, |c| c.len());
    base + content
}

/// Estimate how many characters a node summary takes with title only.
fn estimate_node_chars_title_only(node: &NodeSummary) -> usize {
    // "- [uuid] Title (type: xxx)\n"
    50 + node.id.len() + node.title.len() + node.node_type.len()
}

/// Estimate how many characters an edge summary line takes (excluding inline comments).
fn estimate_edge_chars(edge: &EdgeSummary) -> usize {
    // "- Source -> Target [weight: N] (M annotations): comment...\n"
    50 + edge.source_node_title.len()
        + edge.target_node_title.len()
        + edge.comment.len().min(100)
}

/// Estimate how many characters an edge's inline comments take.
fn estimate_edge_comments_chars(edge: &EdgeSummary) -> usize {
    edge.comments.iter().map(|c| 6 + c.author_type.len() + c.content.len()).sum()
}

// ─── BFS distance computation ───

/// BFS from Core node, treating edges as undirected.
/// Returns map of node_id → distance. Unreachable nodes are absent.
pub(crate) fn compute_distances_from_core(
    core_node_id: &str,
    edges: &[EdgeSummary],
) -> HashMap<String, usize> {
    // Build adjacency list
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in edges {
        adj.entry(e.source_id.as_str())
            .or_default()
            .push(e.target_id.as_str());
        adj.entry(e.target_id.as_str())
            .or_default()
            .push(e.source_id.as_str());
    }

    let mut distances: HashMap<String, usize> = HashMap::new();
    distances.insert(core_node_id.to_string(), 0);

    let mut queue = VecDeque::new();
    queue.push_back(core_node_id.to_string());

    while let Some(current) = queue.pop_front() {
        let current_dist = distances[&current];
        if let Some(neighbors) = adj.get(current.as_str()) {
            for &neighbor in neighbors {
                if !distances.contains_key(neighbor) {
                    distances.insert(neighbor.to_string(), current_dist + 1);
                    queue.push_back(neighbor.to_string());
                }
            }
        }
    }

    distances
}

// ─── Relevance scoring ───

/// Compute a relevance score [0.0, 1.0] for a node.
///
/// Factors (weighted sum):
/// - Node type priority (0.3): core=1.0, user_doc=0.7, paper=0.6, ghost=0.2
/// - Graph distance from Core (0.3): d=0..1→1.0, d=2→0.6, d=3→0.3, d≥4→0.1
/// - Connection count (0.2): normalized against max in graph
/// - Query keyword match (0.2): fraction of query words found in title+content
fn compute_node_relevance(
    node: &NodeSummary,
    distances: &HashMap<String, usize>,
    max_connections: usize,
    query_words: &[String],
) -> f64 {
    // Factor 1: Node type priority
    let type_score = match node.node_type.as_str() {
        "core" => 1.0,
        "user_doc" => 0.7,
        "paper" => 0.6,
        "agent_proposal" | "ghost" => 0.2,
        _ => 0.0,
    };

    // Factor 2: Graph distance from Core
    let dist = distances.get(&node.id).copied().unwrap_or(usize::MAX);
    let dist_score = match dist {
        0 | 1 => 1.0,
        2 => 0.6,
        3 => 0.3,
        _ => 0.1,
    };

    // Factor 3: Connection count (normalized)
    let conn_score = if max_connections > 0 {
        node.connection_count as f64 / max_connections as f64
    } else {
        0.0
    };

    // Factor 4: Query keyword match
    let keyword_score = if query_words.is_empty() {
        0.5 // neutral when no query words
    } else {
        let title_lower = node.title.to_lowercase();
        let content_lower = node
            .content_preview
            .as_deref()
            .unwrap_or("")
            .to_lowercase();
        let text = format!("{title_lower} {content_lower}");
        let matches = query_words
            .iter()
            .filter(|w| text.contains(w.as_str()))
            .count();
        (matches as f64 / query_words.len() as f64).min(1.0)
    };

    0.3 * type_score + 0.3 * dist_score + 0.2 * conn_score + 0.2 * keyword_score
}

// ─── Context optimization ───

/// Apply relevance-based tiered selection to fit within token budgets.
///
/// - Tier 1: Core content (always included, capped)
/// - Tier 2: Top scored nodes with full content
/// - Tier 3: Remaining nodes as title-only summaries
/// - Tier 4: Edge summaries sorted by weight
pub(crate) fn optimize_context(mut context: AgentContext, query: &str) -> AgentContext {
    // Find core node ID
    let core_node_id = context
        .node_summaries
        .iter()
        .find(|n| n.node_type == "core")
        .map(|n| n.id.clone())
        .unwrap_or_default();

    // Compute BFS distances from Core
    let distances = compute_distances_from_core(&core_node_id, &context.edge_summaries);

    // Max connection count for normalization
    let max_connections = context
        .node_summaries
        .iter()
        .map(|n| n.connection_count)
        .max()
        .unwrap_or(1)
        .max(1);

    // Extract query keywords (words >= 3 chars, lowercase)
    let query_words: Vec<String> = query
        .split_whitespace()
        .filter(|w| w.len() >= 3)
        .map(|w| w.to_lowercase())
        .collect();

    // Score and sort all nodes by relevance descending
    let mut scored_nodes: Vec<(NodeSummary, f64)> = context
        .node_summaries
        .drain(..)
        .map(|n| {
            let score =
                compute_node_relevance(&n, &distances, max_connections, &query_words);
            (n, score)
        })
        .collect();
    scored_nodes.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Tier 1: Truncate core content preview
    if let Some(ref mut core) = context.core_content_preview {
        if core.len() > CORE_CONTENT_MAX_CHARS {
            *core = truncate_str(core, CORE_CONTENT_MAX_CHARS);
        }
    }

    // Tier 2: High relevance nodes with full content
    let mut tier2_chars = 0usize;
    let mut result_nodes: Vec<NodeSummary> = Vec::new();
    let mut remaining: Vec<NodeSummary> = Vec::new();

    for (node, _score) in scored_nodes {
        let chars = estimate_node_chars_full(&node);
        if tier2_chars + chars <= TOKEN_BUDGET_TIER2_CHARS {
            tier2_chars += chars;
            result_nodes.push(node);
        } else {
            remaining.push(node);
        }
    }

    // Tier 3: Remaining nodes as title-only (strip content_preview)
    let mut tier3_chars = 0usize;
    for mut node in remaining {
        let chars = estimate_node_chars_title_only(&node);
        if tier3_chars + chars > TOKEN_BUDGET_TIER3_CHARS {
            break;
        }
        tier3_chars += chars;
        node.content_preview = None; // strip content for title-only tier
        result_nodes.push(node);
    }

    context.node_summaries = result_nodes;

    // Tier 4: Edge summaries sorted by weight descending, within budget
    // Prioritize edges that have comments (they carry reasoning about connections)
    context.edge_summaries.sort_by(|a, b| {
        let a_has_comments = !a.comments.is_empty() as u8;
        let b_has_comments = !b.comments.is_empty() as u8;
        b_has_comments
            .cmp(&a_has_comments)
            .then(b.weight.cmp(&a.weight))
    });
    let mut edge_chars = 0usize;
    let mut keep_edges: Vec<EdgeSummary> = Vec::new();
    for edge in context.edge_summaries.drain(..) {
        let chars = estimate_edge_chars(&edge) + estimate_edge_comments_chars(&edge);
        if edge_chars + chars > TOKEN_BUDGET_EDGES_CHARS {
            break;
        }
        edge_chars += chars;
        keep_edges.push(edge);
    }

    // Apply edge comment budget (truncate comment threads to fit)
    apply_edge_comment_budget(&mut keep_edges, TOKEN_BUDGET_EDGE_COMMENTS_CHARS);
    context.edge_summaries = keep_edges;

    context
}

// ─── Edge comment fetching ───

/// Fetch all edge comments for a batch of edge IDs from the database.
/// Returns a map of edge_id → Vec<AgentEdgeComment>.
pub(crate) fn fetch_edge_comments_batch(
    db: &Database,
    edge_ids: &[String],
) -> Result<HashMap<String, Vec<AgentEdgeComment>>, String> {
    if edge_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let placeholders: Vec<String> = (1..=edge_ids.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT edge_id, author_type, content FROM edge_comments WHERE edge_id IN ({}) ORDER BY created_at ASC",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params: Vec<&dyn rusqlite::types::ToSql> = edge_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();

    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut result: HashMap<String, Vec<AgentEdgeComment>> = HashMap::new();
    for (edge_id, author_type, content) in rows {
        result.entry(edge_id).or_default().push(AgentEdgeComment {
            author_type,
            content,
        });
    }

    Ok(result)
}

/// Apply a token budget to edge comments.
/// Truncates or removes comments to stay within the character budget.
fn apply_edge_comment_budget(edges: &mut [EdgeSummary], budget_chars: usize) {
    let mut used = 0usize;
    for edge in edges.iter_mut() {
        if edge.comments.is_empty() {
            continue;
        }
        let mut kept: Vec<AgentEdgeComment> = Vec::new();
        for comment in edge.comments.drain(..) {
            // Estimate: "  [author_type]: content\n"
            let chars = 6 + comment.author_type.len() + comment.content.len();
            if used + chars > budget_chars {
                break;
            }
            used += chars;
            kept.push(comment);
        }
        edge.comments = kept;
    }
}

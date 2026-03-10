use crate::db::Database;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};

// ─── Graph structure analysis types ───

#[derive(Debug, Clone, Serialize)]
pub struct GraphAnomalies {
    pub isolated_nodes: Vec<IsolatedNodeInfo>,
    pub star_pattern: Option<StarPatternInfo>,
    pub disconnected_clusters: Vec<ClusterInfo>,
    pub depth_imbalance: Option<DepthImbalanceInfo>,
    pub has_anomalies: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct IsolatedNodeInfo {
    pub node_id: String,
    pub node_title: String,
    pub node_type: String,
    pub edge_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct StarPatternInfo {
    pub core_direct_edges: usize,
    pub total_edges: usize,
    pub ratio: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClusterInfo {
    pub cluster_id: usize,
    pub node_ids: Vec<String>,
    pub node_titles: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DepthImbalanceInfo {
    pub max_depth: usize,
    pub min_leaf_depth: usize,
    pub depth_difference: usize,
}

// ─── Content analysis types ───

#[derive(Debug, Clone, Serialize)]
pub struct ContentSignals {
    pub unanswered_questions: Vec<UnansweredQuestion>,
    pub potential_contradictions: Vec<Contradiction>,
    pub orphan_topics: Vec<OrphanTopic>,
    pub has_signals: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct UnansweredQuestion {
    pub node_id: String,
    pub node_title: String,
    pub question_text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Contradiction {
    pub node_a_id: String,
    pub node_a_title: String,
    pub node_b_id: String,
    pub node_b_title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrphanTopic {
    pub term: String,
    pub mentioned_in_nodes: Vec<String>,
}

// ─── Graph structure analysis ───

/// Analyze graph structure for anomalies.
/// Queries the DB for nodes/edges in the given layer and detects:
/// 1. Isolated nodes (degree <= 1, excluding core/junction/deleted)
/// 2. Star pattern (core's direct edges / total edges > 0.7, skip if <= 4 nodes)
/// 3. Disconnected clusters (unreachable from core via BFS)
/// 4. Depth imbalance (max leaf depth - min leaf depth >= 3)
pub(crate) fn analyze_graph_structure(
    db: &Database,
    layer_id: &str,
) -> Result<GraphAnomalies, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Fetch all active nodes in this layer
    let mut node_stmt = conn
        .prepare(
            "SELECT id, node_type, title FROM nodes WHERE layer_id = ?1 AND status = 'active'",
        )
        .map_err(|e| e.to_string())?;

    let nodes: Vec<(String, String, String)> = node_stmt
        .query_map([layer_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Fetch all edges in this layer
    let mut edge_stmt = conn
        .prepare("SELECT id, source_node_id, target_node_id FROM edges WHERE layer_id = ?1")
        .map_err(|e| e.to_string())?;

    let edges: Vec<(String, String, String)> = edge_stmt
        .query_map([layer_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Build lookup maps
    let node_titles: HashMap<&str, &str> = nodes
        .iter()
        .map(|(id, _, t)| (id.as_str(), t.as_str()))
        .collect();

    // Find core node
    let core_node_id = nodes
        .iter()
        .find(|(_, t, _)| t == "core")
        .map(|(id, _, _)| id.as_str());

    // Build adjacency list and compute degrees
    let mut degree: HashMap<&str, usize> = HashMap::new();
    for (id, _, _) in &nodes {
        degree.insert(id.as_str(), 0);
    }

    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for (_eid, src, tgt) in &edges {
        *degree.entry(src.as_str()).or_default() += 1;
        *degree.entry(tgt.as_str()).or_default() += 1;
        adj.entry(src.as_str()).or_default().push(tgt.as_str());
        adj.entry(tgt.as_str()).or_default().push(src.as_str());
    }

    // --- 1. Isolated nodes (degree <= 1, excluding core/junction/deleted) ---
    let isolated_nodes: Vec<IsolatedNodeInfo> = nodes
        .iter()
        .filter(|(_, t, _)| t != "core" && t != "junction" && t != "deleted")
        .filter(|(id, _, _)| degree.get(id.as_str()).copied().unwrap_or(0) <= 1)
        .map(|(id, t, title)| IsolatedNodeInfo {
            node_id: id.clone(),
            node_title: title.clone(),
            node_type: t.clone(),
            edge_count: degree.get(id.as_str()).copied().unwrap_or(0),
        })
        .collect();

    // --- 2. Star pattern (core hub ratio) ---
    let total_active_nodes = nodes.len();
    let star_pattern = if let Some(core_id) = core_node_id {
        if total_active_nodes > 4 && !edges.is_empty() {
            let core_edges = degree.get(core_id).copied().unwrap_or(0);
            let total_edge_count = edges.len();
            let ratio = core_edges as f64 / total_edge_count as f64;
            if ratio > 0.7 {
                Some(StarPatternInfo {
                    core_direct_edges: core_edges,
                    total_edges: total_edge_count,
                    ratio,
                })
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    // --- 3. Disconnected clusters (BFS from core, group unreachable) ---
    let disconnected_clusters = if let Some(core_id) = core_node_id {
        let mut visited: HashSet<&str> = HashSet::new();
        let mut queue: VecDeque<&str> = VecDeque::new();

        visited.insert(core_id);
        queue.push_back(core_id);

        while let Some(current) = queue.pop_front() {
            if let Some(neighbors) = adj.get(current) {
                for &neighbor in neighbors {
                    if !visited.contains(neighbor) {
                        visited.insert(neighbor);
                        queue.push_back(neighbor);
                    }
                }
            }
        }

        // Find unreachable non-deleted/non-junction nodes
        let unreachable: Vec<&str> = nodes
            .iter()
            .filter(|(id, t, _)| {
                !visited.contains(id.as_str()) && t != "deleted" && t != "junction"
            })
            .map(|(id, _, _)| id.as_str())
            .collect();

        if unreachable.is_empty() {
            vec![]
        } else {
            // Group unreachable nodes into connected components
            let mut cluster_visited: HashSet<&str> = HashSet::new();
            let mut clusters: Vec<ClusterInfo> = Vec::new();
            let mut next_cluster_id = 0usize;

            for &node_id in &unreachable {
                if cluster_visited.contains(node_id) {
                    continue;
                }

                // BFS within unreachable nodes
                let mut component_ids: Vec<String> = Vec::new();
                let mut component_titles: Vec<String> = Vec::new();
                let mut q: VecDeque<&str> = VecDeque::new();

                q.push_back(node_id);
                cluster_visited.insert(node_id);

                while let Some(current) = q.pop_front() {
                    component_ids.push(current.to_string());
                    if let Some(&title) = node_titles.get(current) {
                        component_titles.push(title.to_string());
                    }

                    if let Some(neighbors) = adj.get(current) {
                        for &neighbor in neighbors {
                            if !cluster_visited.contains(neighbor)
                                && unreachable.contains(&neighbor)
                            {
                                cluster_visited.insert(neighbor);
                                q.push_back(neighbor);
                            }
                        }
                    }
                }

                clusters.push(ClusterInfo {
                    cluster_id: next_cluster_id,
                    node_ids: component_ids,
                    node_titles: component_titles,
                });
                next_cluster_id += 1;
            }

            clusters
        }
    } else {
        vec![]
    };

    // --- 4. Depth imbalance (BFS distances, leaf depth difference >= 3) ---
    let depth_imbalance = if let Some(core_id) = core_node_id {
        // BFS distances from core
        let mut distances: HashMap<&str, usize> = HashMap::new();
        let mut queue: VecDeque<&str> = VecDeque::new();

        distances.insert(core_id, 0);
        queue.push_back(core_id);

        while let Some(current) = queue.pop_front() {
            let current_dist = distances[current];
            if let Some(neighbors) = adj.get(current) {
                for &neighbor in neighbors {
                    if !distances.contains_key(neighbor) {
                        distances.insert(neighbor, current_dist + 1);
                        queue.push_back(neighbor);
                    }
                }
            }
        }

        // Find leaf nodes: degree == 1, not core/deleted/junction, reachable from core
        let leaf_depths: Vec<usize> = nodes
            .iter()
            .filter(|(id, t, _)| {
                t != "core"
                    && t != "deleted"
                    && t != "junction"
                    && degree.get(id.as_str()).copied().unwrap_or(0) == 1
                    && distances.contains_key(id.as_str())
            })
            .map(|(id, _, _)| distances[id.as_str()])
            .collect();

        if leaf_depths.len() >= 2 {
            let max_depth = *leaf_depths.iter().max().unwrap();
            let min_depth = *leaf_depths.iter().min().unwrap();
            let diff = max_depth - min_depth;

            if diff >= 3 {
                Some(DepthImbalanceInfo {
                    max_depth,
                    min_leaf_depth: min_depth,
                    depth_difference: diff,
                })
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let has_anomalies = !isolated_nodes.is_empty()
        || star_pattern.is_some()
        || !disconnected_clusters.is_empty()
        || depth_imbalance.is_some();

    Ok(GraphAnomalies {
        isolated_nodes,
        star_pattern,
        disconnected_clusters,
        depth_imbalance,
        has_anomalies,
    })
}

/// Format detected graph anomalies into a readable prompt section.
pub(crate) fn format_anomalies_for_prompt(anomalies: &GraphAnomalies) -> String {
    let mut out = String::with_capacity(1024);
    out.push_str("## Graph Structure Analysis\n\n");
    out.push_str("The following structural anomalies were detected in the graph:\n\n");

    // Isolated nodes
    if !anomalies.isolated_nodes.is_empty() {
        out.push_str("### Isolated Nodes\n");
        out.push_str("These nodes have very few connections (0-1 edges) and may be underutilized:\n");
        for node in &anomalies.isolated_nodes {
            out.push_str(&format!(
                "- [{}] \"{}\" (id: {}) — {} edge{}\n",
                node.node_type,
                node.node_title,
                node.node_id,
                node.edge_count,
                if node.edge_count == 1 { "" } else { "s" }
            ));
        }
        out.push('\n');
    }

    // Star pattern
    if let Some(ref star) = anomalies.star_pattern {
        out.push_str("### Star Pattern Detected\n");
        out.push_str(&format!(
            "The Core node has {} direct edges out of {} total ({:.0}% of all edges). \
             The graph is overly centralized — most nodes connect only to Core \
             without intermediate organizing nodes or cross-connections.\n\n",
            star.core_direct_edges,
            star.total_edges,
            star.ratio * 100.0
        ));
    }

    // Disconnected clusters
    if !anomalies.disconnected_clusters.is_empty() {
        out.push_str("### Disconnected Clusters\n");
        out.push_str(
            "These groups of nodes are not reachable from the Core node via any path:\n",
        );
        for cluster in &anomalies.disconnected_clusters {
            out.push_str(&format!(
                "- Cluster {} ({} node{}): {}\n",
                cluster.cluster_id,
                cluster.node_ids.len(),
                if cluster.node_ids.len() == 1 { "" } else { "s" },
                cluster.node_titles.join(", ")
            ));
        }
        out.push('\n');
    }

    // Depth imbalance
    if let Some(ref depth) = anomalies.depth_imbalance {
        out.push_str("### Depth Imbalance\n");
        out.push_str(&format!(
            "The graph has uneven depth: the deepest leaf is {} hops from Core, \
             while the shallowest is only {} hop{} away (difference: {}). \
             Some branches are much more developed than others.\n\n",
            depth.max_depth,
            depth.min_leaf_depth,
            if depth.min_leaf_depth == 1 { "" } else { "s" },
            depth.depth_difference
        ));
    }

    out
}

// ─── Content analysis ───

/// Analyze node content for textual signals that the agent can act on.
/// Detects: unanswered questions, potential contradictions, orphan topics.
/// Queries the DB for nodes/edges in the given layer.
pub(crate) fn analyze_content_signals(
    db: &Database,
    layer_id: &str,
) -> Result<ContentSignals, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Fetch all active nodes with content in this layer
    let mut node_stmt = conn
        .prepare(
            "SELECT id, node_type, title, content FROM nodes \
             WHERE layer_id = ?1 AND status = 'active' \
             AND node_type IN ('core', 'paper', 'user_doc')",
        )
        .map_err(|e| e.to_string())?;

    let nodes: Vec<(String, String, String, String)> = node_stmt
        .query_map([layer_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Fetch all edges in this layer
    let mut edge_stmt = conn
        .prepare("SELECT source_node_id, target_node_id FROM edges WHERE layer_id = ?1")
        .map_err(|e| e.to_string())?;

    let edges: Vec<(String, String)> = edge_stmt
        .query_map([layer_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Build adjacency and degree maps
    let mut degree: HashMap<&str, usize> = HashMap::new();
    let _neighbors: HashMap<&str, Vec<&str>> = HashMap::new();
    for (id, _, _, _) in &nodes {
        degree.insert(id.as_str(), 0);
    }
    for (src, tgt) in &edges {
        *degree.entry(src.as_str()).or_default() += 1;
        *degree.entry(tgt.as_str()).or_default() += 1;
    }

    // --- 1. Unanswered questions ---
    // Find sentences ending with "?" in nodes with few connections (degree 0-1)
    let question_re_pattern = r"[^.!?\n]*\?";
    let question_re = regex::Regex::new(question_re_pattern).unwrap();

    let mut unanswered_questions: Vec<UnansweredQuestion> = Vec::new();
    for (id, _node_type, title, content) in &nodes {
        let deg = degree.get(id.as_str()).copied().unwrap_or(0);
        if deg > 1 || content.is_empty() {
            continue;
        }

        for cap in question_re.find_iter(content) {
            let question_text = cap.as_str().trim().to_string();
            if question_text.len() >= 10 {
                // Skip very short fragments like "?"
                unanswered_questions.push(UnansweredQuestion {
                    node_id: id.clone(),
                    node_title: title.clone(),
                    question_text: if question_text.len() > 200 {
                        format!("{}...", &question_text[..197])
                    } else {
                        question_text
                    },
                });
                break; // One question per node is enough
            }
        }
    }

    // --- 2. Potential contradictions ---
    // For each edge, check if connected nodes contain negation patterns
    // near overlapping key terms.
    let negation_words: HashSet<&str> = [
        "not", "no", "never", "neither", "nor", "however", "but",
        "contrary", "unlike", "whereas", "although", "despite",
        "instead", "rather", "fails", "unable", "cannot", "impossible",
    ]
    .into_iter()
    .collect();

    let node_map: HashMap<&str, (&str, &str)> = nodes
        .iter()
        .map(|(id, _, title, content)| (id.as_str(), (title.as_str(), content.as_str())))
        .collect();

    let mut potential_contradictions: Vec<Contradiction> = Vec::new();
    let mut seen_pairs: HashSet<(String, String)> = HashSet::new();

    for (src, tgt) in &edges {
        let pair_key = if src < tgt {
            (src.clone(), tgt.clone())
        } else {
            (tgt.clone(), src.clone())
        };
        if seen_pairs.contains(&pair_key) {
            continue;
        }
        seen_pairs.insert(pair_key);

        let (src_title, src_content) = match node_map.get(src.as_str()) {
            Some(v) => *v,
            None => continue,
        };
        let (tgt_title, tgt_content) = match node_map.get(tgt.as_str()) {
            Some(v) => *v,
            None => continue,
        };

        if src_content.is_empty() || tgt_content.is_empty() {
            continue;
        }

        // Extract significant words from each node (len >= 4, lowercase)
        let src_words: HashSet<String> = src_content
            .split_whitespace()
            .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
            .filter(|w| w.len() >= 4)
            .collect();
        let tgt_words: HashSet<String> = tgt_content
            .split_whitespace()
            .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
            .filter(|w| w.len() >= 4)
            .collect();

        // Find overlapping key terms (shared vocabulary)
        let shared: Vec<&String> = src_words.intersection(&tgt_words).collect();
        if shared.is_empty() {
            continue;
        }

        // Check if one node has negation near shared terms
        let src_lower = src_content.to_lowercase();
        let tgt_lower = tgt_content.to_lowercase();

        let src_has_negation = negation_words
            .iter()
            .any(|neg| src_lower.contains(neg));
        let tgt_has_negation = negation_words
            .iter()
            .any(|neg| tgt_lower.contains(neg));

        // One has negation, the other doesn't (or both do) — with shared terms
        if (src_has_negation != tgt_has_negation) && shared.len() >= 2 {
            let shared_sample: Vec<&str> = shared
                .iter()
                .take(3)
                .map(|s| s.as_str())
                .collect();
            potential_contradictions.push(Contradiction {
                node_a_id: src.clone(),
                node_a_title: src_title.to_string(),
                node_b_id: tgt.clone(),
                node_b_title: tgt_title.to_string(),
                description: format!(
                    "Possible conflicting statements about: {}",
                    shared_sample.join(", ")
                ),
            });

            if potential_contradictions.len() >= 3 {
                break;
            }
        }
    }

    // --- 3. Orphan topics ---
    // Extract significant terms from content, check if they match existing node titles.
    // Flag terms that appear 2+ times across nodes but have no dedicated node.
    let node_titles_lower: HashSet<String> = nodes
        .iter()
        .map(|(_, _, title, _)| title.to_lowercase())
        .collect();

    // Count how many nodes mention each capitalized phrase or quoted term
    let mut term_mentions: HashMap<String, Vec<String>> = HashMap::new();

    for (id, _, _title, content) in &nodes {
        if content.is_empty() {
            continue;
        }

        // Extract quoted terms
        let quote_re = regex::Regex::new(r#""([^"]{3,40})""#).unwrap();
        for cap in quote_re.captures_iter(content) {
            if let Some(m) = cap.get(1) {
                let term = m.as_str().to_lowercase();
                term_mentions
                    .entry(term)
                    .or_default()
                    .push(id.clone());
            }
        }

        // Extract capitalized multi-word phrases (e.g., "Machine Learning", "Graph Theory")
        let cap_phrase_re =
            regex::Regex::new(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b").unwrap();
        for cap in cap_phrase_re.captures_iter(content) {
            if let Some(m) = cap.get(1) {
                let term = m.as_str().to_lowercase();
                term_mentions
                    .entry(term)
                    .or_default()
                    .push(id.clone());
            }
        }
    }

    // Filter: mentioned in 2+ nodes, not already a node title
    let mut orphan_topics: Vec<OrphanTopic> = term_mentions
        .into_iter()
        .filter(|(term, node_ids)| {
            // Deduplicate node_ids (same node may mention multiple times)
            let unique: HashSet<&String> = node_ids.iter().collect();
            unique.len() >= 2 && !node_titles_lower.contains(term)
        })
        .map(|(term, node_ids)| {
            let unique: Vec<String> = node_ids
                .into_iter()
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();
            OrphanTopic {
                term,
                mentioned_in_nodes: unique,
            }
        })
        .collect();

    // Limit to 5 most-mentioned orphan topics
    orphan_topics.sort_by(|a, b| b.mentioned_in_nodes.len().cmp(&a.mentioned_in_nodes.len()));
    orphan_topics.truncate(5);

    let has_signals = !unanswered_questions.is_empty()
        || !potential_contradictions.is_empty()
        || !orphan_topics.is_empty();

    Ok(ContentSignals {
        unanswered_questions,
        potential_contradictions,
        orphan_topics,
        has_signals,
    })
}

/// Format detected content signals into a readable prompt section.
/// Returns None if no signals were detected.
pub(crate) fn format_content_signals_for_prompt(signals: &ContentSignals) -> Option<String> {
    if !signals.has_signals {
        return None;
    }

    let mut out = String::with_capacity(1024);
    out.push_str("## Content Analysis\n\n");
    out.push_str("The following content signals were detected:\n\n");

    // Unanswered questions
    if !signals.unanswered_questions.is_empty() {
        out.push_str("### Unanswered Questions\n");
        out.push_str(
            "These nodes contain questions that appear unaddressed by connected nodes:\n",
        );
        for q in &signals.unanswered_questions {
            out.push_str(&format!(
                "- \"{}\" (id: {}) asks: \"{}\"\n",
                q.node_title, q.node_id, q.question_text
            ));
        }
        out.push('\n');
    }

    // Potential contradictions
    if !signals.potential_contradictions.is_empty() {
        out.push_str("### Potential Contradictions\n");
        out.push_str(
            "These connected node pairs may contain conflicting statements:\n",
        );
        for c in &signals.potential_contradictions {
            out.push_str(&format!(
                "- \"{}\" (id: {}) vs \"{}\" (id: {}): {}\n",
                c.node_a_title, c.node_a_id, c.node_b_title, c.node_b_id, c.description
            ));
        }
        out.push('\n');
    }

    // Orphan topics
    if !signals.orphan_topics.is_empty() {
        out.push_str("### Orphan Topics\n");
        out.push_str(
            "These terms appear across multiple nodes but have no dedicated node:\n",
        );
        for t in &signals.orphan_topics {
            out.push_str(&format!(
                "- \"{}\" (mentioned in {} nodes)\n",
                t.term,
                t.mentioned_in_nodes.len()
            ));
        }
        out.push('\n');
    }

    Some(out)
}

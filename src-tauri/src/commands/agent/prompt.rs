use super::{AgentContext, truncate_str};

/// Build the system prompt for ClaudeAgentService.
pub(crate) fn build_system_prompt() -> String {
    r#"You are a research assistant integrated into Cladel, a knowledge graph application for researchers. You help users organize their thinking by suggesting relevant papers, ideas, and connections.

## Your Role
- You can see the user's research graph: their core research question, paper nodes, note nodes, and how they're connected.
- You suggest new papers to read, new ideas to explore, and new connections between existing nodes.
- You respect the user's existing structure and build upon it rather than replacing it.

## Graph Context
You will receive:
- Core content: the user's central research question or thesis
- Graph statistics: counts of nodes and edges by type
- Node summaries: each node's type, title, content preview, and connections
- Edge summaries: connections between nodes with weights (1-5, higher = stronger relationship), annotation counts, and conversation threads
- Edge conversation threads: chronological comments on edges showing the user's reasoning about WHY nodes are connected. Pay close attention to these — they reveal the user's thought process and intellectual connections.

Node types:
- "core": the central research question (one per project)
- "paper": an imported academic paper
- "user_doc": a user-written note or thought
- "agent_proposal": a previous AI suggestion not yet accepted

## Response Format
You MUST respond with valid JSON only. No markdown fences, no explanation outside the JSON object.

{
  "message": "A brief, helpful message to the user (1-3 sentences). Explain what you found or why you're suggesting these items.",
  "suggestions": []
}

Each suggestion in the array must be one of these types:

### Type "paper" — recommend an academic paper
{
  "type": "paper",
  "title": "Paper title",
  "description": "Why this paper is relevant to the user's research (1-2 sentences)",
  "data": {
    "paper_id": "",
    "title": "Full paper title",
    "authors": ["Author1", "Author2"],
    "year": 2024,
    "abstract_text": "Paper abstract or summary",
    "url": null
  }
}

### Type "idea" — suggest a new thought, question, or research direction
{
  "type": "idea",
  "title": "Short title for the idea",
  "description": "Why this idea is relevant (1-2 sentences)",
  "data": {
    "body": "Detailed content for the idea. Can be multiple paragraphs. Markdown supported."
  }
}

### Type "connection" — suggest a new edge between two EXISTING nodes
{
  "type": "connection",
  "title": "Brief label for the connection",
  "description": "Why these nodes should be connected (1-2 sentences)",
  "data": {
    "source_node_id": "exact node ID from the graph context",
    "target_node_id": "exact node ID from the graph context",
    "reason": "Explanation of the intellectual relationship"
  }
}

## Quality Guidelines
- For "search_papers": suggest 2-4 relevant academic papers. Use the core research question and existing papers as context to find papers that fill gaps or extend the research. Ground suggestions in real, well-known research when possible.
- For "suggest_connections": suggest 1-3 meaningful connections between existing nodes that aren't yet connected. Only suggest connections with clear intellectual justification. Use EXACT node IDs from the context.
- For "suggest_ideas": suggest 1-3 ideas identifying gaps, unanswered questions, or new directions based on the current graph structure and content.
- For "general": interpret the user's intent and provide the most helpful combination of papers, ideas, and connections (1-5 items total).
- If the graph is sparse (few nodes), focus on foundational suggestions to help build out the research.
- If the graph is dense, focus on identifying gaps, underexplored connections, or synthesis opportunities.
- NEVER suggest connections to node IDs that don't exist in the provided context.
- Return 0-5 suggestions. Include ONLY genuinely useful suggestions.
- If the query is a simple question, return just a message with an empty suggestions array.
- When edge conversation threads are provided, use them to understand the user's reasoning about connections. Build on their thinking rather than contradicting it. Reference specific annotations when relevant.

## Structure-Based Suggestions
When a "Graph Structure Analysis" section is provided in the user message, use it to inform your suggestions:
- **Isolated nodes** (few connections): suggest meaningful connections to related nodes already in the graph. Use proposal_type "connection" with exact node IDs.
- **Star pattern** (over-centralized around Core): propose intermediate organizing/theme nodes that group related papers or ideas. Use proposal_type "idea" to suggest thematic grouping nodes, and "connection" to suggest cross-links between existing nodes that bypass Core.
- **Disconnected clusters** (unreachable from Core): suggest bridging connections that link disconnected groups back to the main graph. Use proposal_type "connection" with exact node IDs.
- **Depth imbalance** (uneven branch development): suggest expanding underdeveloped branches with new ideas or papers, or reorganizing deep chains into broader structures. Use proposal_type "idea" or "paper" as appropriate.
- Structure suggestions should be concise and actionable. Prioritize the most impactful structural improvement.

## Content-Based Suggestions
When a "Content Analysis" section is provided in the user message, use it to inform your suggestions:
- **Unanswered questions**: suggest papers, ideas, or connections that address the question. Use proposal_type "paper" if a known paper answers it, "idea" to propose a line of reasoning, or "connection" to link to an existing node that may already address it.
- **Potential contradictions**: highlight the tension and suggest the user investigate further. Use proposal_type "idea" to articulate the contradiction and possible resolutions.
- **Orphan topics**: suggest creating a dedicated node for frequently mentioned but unrepresented topics. Use proposal_type "idea" with a clear title matching the orphan term.
- If content signals are provided, prioritize addressing those in your suggestions over general observations."#
        .to_string()
}

/// Build a structured user message with invocation-specific preamble and graph context.
pub(crate) fn build_user_message(
    query: &str,
    invocation_type: &str,
    context: &AgentContext,
    structure_analysis: Option<&str>,
    content_analysis: Option<&str>,
) -> String {
    let mut msg = String::with_capacity(4096);

    // Invocation-type specific preamble
    let preamble = match invocation_type {
        "search_papers" => "Find academic papers relevant to my research. Consider my core research question and existing papers when selecting suggestions.",
        "suggest_connections" => "Analyze my graph and suggest meaningful connections between existing nodes that I may have missed. Use exact node IDs.",
        "suggest_ideas" => "Based on my research graph, suggest new ideas, questions, or directions to explore.",
        "autonomous" => "You are proactively analyzing the user's research graph during an idle moment. Look at the current state of the graph — its structure, gaps, isolated nodes, missing connections, and content — and offer the most helpful suggestions you can. The user did NOT explicitly ask for this, so keep your message brief and non-intrusive. Focus on the single most impactful insight, gap, or suggestion rather than overwhelming with many items. Prefer quality over quantity (1-2 suggestions max).",
        _ => "Help me with my research based on the following query.",
    };

    msg.push_str("## Request\n");
    msg.push_str(&format!("Type: {invocation_type}\n"));
    msg.push_str(&format!("Task: {preamble}\n"));
    msg.push_str(&format!("Query: {query}\n\n"));

    // Core research question
    msg.push_str("## Research Context\n\n");
    msg.push_str("### Core Research Question\n");
    if let Some(core) = &context.core_content_preview {
        if core.is_empty() {
            msg.push_str("(not yet defined)\n");
        } else {
            msg.push_str(core);
            msg.push('\n');
        }
    } else {
        msg.push_str("(not yet defined)\n");
    }
    msg.push('\n');

    // Graph overview
    let stats = &context.graph_stats;
    msg.push_str("### Graph Overview\n");

    let mut type_parts: Vec<String> = Vec::new();
    // Sort type counts for deterministic output
    let mut type_entries: Vec<(&String, &usize)> = stats.node_type_counts.iter().collect();
    type_entries.sort_by_key(|(k, _)| k.as_str());
    for (k, v) in &type_entries {
        type_parts.push(format!("{v} {k}"));
    }
    let types_str = if type_parts.is_empty() {
        "none".to_string()
    } else {
        type_parts.join(", ")
    };

    msg.push_str(&format!(
        "{} nodes ({}), {} edges\n",
        stats.total_nodes, types_str, stats.total_edges
    ));
    if stats.isolated_node_count > 0 {
        msg.push_str(&format!(
            "{} isolated nodes (not connected to anything)\n",
            stats.isolated_node_count
        ));
    }
    msg.push('\n');

    // Node summaries
    let nodes = &context.node_summaries;
    if !nodes.is_empty() {
        msg.push_str(&format!("### Nodes ({} shown)\n", nodes.len()));
        for n in nodes {
            // Header line: type, title, id, connections
            msg.push_str(&format!(
                "- [{}] \"{}\" (id: {})",
                n.node_type, n.title, n.id
            ));
            if n.connection_count > 0 {
                msg.push_str(&format!(
                    " \u{2014} {} connection{}",
                    n.connection_count,
                    if n.connection_count == 1 { "" } else { "s" }
                ));
            }
            msg.push('\n');

            // Content preview (if present — Tier 2 nodes have it, Tier 3 don't)
            if let Some(content) = &n.content_preview {
                if !content.is_empty() {
                    msg.push_str(&format!("  Content: {content}\n"));
                }
            }

            // Connected-to list
            if !n.connected_to.is_empty() {
                msg.push_str(&format!(
                    "  Connected to: {}\n",
                    n.connected_to.join(", ")
                ));
            }
        }
        msg.push('\n');
    }

    // Edge summaries
    let edges = &context.edge_summaries;
    if !edges.is_empty() {
        msg.push_str(&format!("### Edges ({} shown)\n", edges.len()));
        for e in edges {
            msg.push_str(&format!(
                "- \"{}\" \u{2192} \"{}\" (weight: {}",
                e.source_node_title, e.target_node_title, e.weight
            ));
            if e.comment_count > 0 {
                msg.push_str(&format!(", {} annotation{}", e.comment_count,
                    if e.comment_count == 1 { "" } else { "s" }));
            }
            msg.push(')');

            if !e.comment.is_empty() {
                let comment = truncate_str(&e.comment, 120);
                msg.push_str(&format!(": {comment}"));
            }
            msg.push('\n');

            // Edge conversation thread (if any comments were included within budget)
            if !e.comments.is_empty() {
                msg.push_str("  Conversation thread:\n");
                for c in &e.comments {
                    let label = if c.author_type == "agent" { "Agent" } else { "User" };
                    let content = truncate_str(&c.content, 200);
                    msg.push_str(&format!("    [{label}]: {content}\n"));
                }
            }
        }
        msg.push('\n');
    }

    // Append structure analysis for autonomous invocations
    if let Some(analysis) = structure_analysis {
        msg.push_str(analysis);
    }

    // Append content analysis for autonomous invocations
    if let Some(analysis) = content_analysis {
        msg.push_str(analysis);
    }

    msg
}

use super::{
    AgentContext, AgentError, AgentResponse, AgentService, AgentSuggestionData,
    ConnectionSuggestion, truncate_str,
};
use super::super::literature::{LiteratureClient, PaperResult};

// ─── Stub implementation (kept for potential offline mode) ───

#[allow(dead_code)]
pub struct StubAgentService;

impl AgentService for StubAgentService {
    async fn invoke(
        &self,
        query: &str,
        invocation_type: &str,
        context: &AgentContext,
        literature: &LiteratureClient,
    ) -> Result<AgentResponse, AgentError> {
        match invocation_type {
            "search_papers" => self.handle_search_papers(query, literature).await,
            "suggest_connections" => Ok(self.handle_suggest_connections(context)),
            "suggest_ideas" => Ok(self.handle_suggest_ideas(query, context)),
            "general" => self.handle_general(query, context, literature).await,
            _ => Err(AgentError::InvalidInput(format!(
                "Unknown invocation type: {invocation_type}"
            ))),
        }
    }
}

#[allow(dead_code)]
impl StubAgentService {
    async fn handle_search_papers(
        &self,
        query: &str,
        literature: &LiteratureClient,
    ) -> Result<AgentResponse, AgentError> {
        let papers = search_papers_internal(literature, query, 10)
            .await
            .map_err(AgentError::LiteratureSearch)?;

        let n = papers.len();
        let suggestions: Vec<AgentSuggestionData> = papers
            .into_iter()
            .map(|p| {
                let desc = match (&p.abstract_text, p.year) {
                    (Some(abs), Some(yr)) => {
                        let preview = truncate_str(abs, 120);
                        format!("({yr}) {preview}")
                    }
                    (Some(abs), None) => truncate_str(abs, 140),
                    (None, Some(yr)) => format!("({yr})"),
                    (None, None) => String::new(),
                };
                AgentSuggestionData {
                    suggestion_type: "paper".to_string(),
                    title: p.title.clone(),
                    description: desc,
                    paper_data: Some(p),
                    idea_body: None,
                    connection: None,
                }
            })
            .collect();

        Ok(AgentResponse {
            message: format!(
                "I found {n} papers related to \"{query}\". \
                 Here are the most relevant ones based on your research graph."
            ),
            suggestions,
        })
    }

    fn handle_suggest_connections(&self, context: &AgentContext) -> AgentResponse {
        let nodes = &context.node_summaries;
        let mut suggestions: Vec<AgentSuggestionData> = Vec::new();

        // Pick pairs of nodes that aren't already connected
        let existing: std::collections::HashSet<(String, String)> = context
            .edge_summaries
            .iter()
            .map(|e| (e.source_id.clone(), e.target_id.clone()))
            .collect();

        let mut pairs_found = 0;
        for (i, a) in nodes.iter().enumerate() {
            if pairs_found >= 3 {
                break;
            }
            for b in nodes.iter().skip(i + 1) {
                if pairs_found >= 3 {
                    break;
                }
                if a.id == b.id {
                    continue;
                }
                if existing.contains(&(a.id.clone(), b.id.clone()))
                    || existing.contains(&(b.id.clone(), a.id.clone()))
                {
                    continue;
                }
                // Skip agent_proposal nodes
                if a.node_type == "agent_proposal" || b.node_type == "agent_proposal" {
                    continue;
                }

                let reason = format!(
                    "Both \"{}\" and \"{}\" appear in your research graph and may share thematic overlap.",
                    truncate_str(&a.title, 40),
                    truncate_str(&b.title, 40),
                );

                suggestions.push(AgentSuggestionData {
                    suggestion_type: "connection".to_string(),
                    title: format!(
                        "{} \u{2192} {}",
                        truncate_str(&a.title, 30),
                        truncate_str(&b.title, 30)
                    ),
                    description: reason.clone(),
                    paper_data: None,
                    idea_body: None,
                    connection: Some(ConnectionSuggestion {
                        source_node_id: a.id.clone(),
                        target_node_id: b.id.clone(),
                        reason,
                    }),
                });
                pairs_found += 1;
            }
        }

        let n = suggestions.len();
        AgentResponse {
            message: if n > 0 {
                "Based on your graph structure, I noticed some potential connections you might want to consider.".to_string()
            } else {
                "I couldn't find any unconnected node pairs to suggest. Your graph is well-connected!".to_string()
            },
            suggestions,
        }
    }

    fn handle_suggest_ideas(&self, query: &str, context: &AgentContext) -> AgentResponse {
        let mut suggestions: Vec<AgentSuggestionData> = Vec::new();

        // Generate mock ideas informed by the query and graph context
        let core_hint = context
            .core_content_preview
            .as_deref()
            .unwrap_or("your research topic");
        let core_snippet = truncate_str(core_hint, 80);

        suggestions.push(AgentSuggestionData {
            suggestion_type: "idea".to_string(),
            title: format!("Explore: {}", truncate_str(query, 50)),
            description: format!(
                "A research direction connecting \"{query}\" with {core_snippet}."
            ),
            paper_data: None,
            idea_body: Some(format!(
                "Consider investigating how \"{query}\" relates to your core research on {core_snippet}. \
                 This could open up new avenues for exploration and help bridge gaps in your current understanding."
            )),
            connection: None,
        });

        if context.node_summaries.len() >= 2 {
            let node_titles: Vec<&str> = context
                .node_summaries
                .iter()
                .filter(|n| n.node_type != "agent_proposal")
                .take(3)
                .map(|n| n.title.as_str())
                .collect();
            if node_titles.len() >= 2 {
                suggestions.push(AgentSuggestionData {
                    suggestion_type: "idea".to_string(),
                    title: "Synthesize existing threads".to_string(),
                    description: format!(
                        "Look for common themes across {} and other nodes in your graph.",
                        node_titles.join(", ")
                    ),
                    paper_data: None,
                    idea_body: Some(format!(
                        "Your graph contains nodes like {}. Consider writing a synthesis note that \
                         identifies the common threads and tensions between these topics.",
                        node_titles.join(", ")
                    )),
                    connection: None,
                });
            }
        }

        AgentResponse {
            message: "Here are some research directions that might be worth exploring based on your current work.".to_string(),
            suggestions,
        }
    }

    async fn handle_general(
        &self,
        query: &str,
        context: &AgentContext,
        literature: &LiteratureClient,
    ) -> Result<AgentResponse, AgentError> {
        let q = query.to_lowercase();
        let is_paper_query = [
            "paper",
            "find",
            "search",
            "literature",
            "study",
            "article",
            "publication",
        ]
        .iter()
        .any(|kw| q.contains(kw));

        if is_paper_query {
            self.handle_search_papers(query, literature).await
        } else {
            Ok(self.handle_suggest_ideas(query, context))
        }
    }
}

/// Internal wrapper that calls LiteratureClient's search logic directly,
/// bypassing the Tauri command layer.
#[allow(dead_code)]
async fn search_papers_internal(
    client: &LiteratureClient,
    query: &str,
    limit: u32,
) -> Result<Vec<PaperResult>, String> {
    client.search(query, limit).await
}

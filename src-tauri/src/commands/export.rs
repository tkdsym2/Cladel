use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::bibtex::generate_bibtex_entry;

// ─── Types ───

/// Minimal struct for reading Paper Node data needed for BibTeX export.
struct PaperRow {
    title: String,
    bibtex: Option<String>,
    metadata: Option<String>,
    content: Option<String>,
}

/// Info about a single paper node, sent to the frontend for the checkbox tree.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaperExportInfo {
    pub node_id: String,
    pub title: String,
    pub authors: String,
    pub year: String,
    pub has_bibtex: bool,
}

/// Papers grouped by layer for the export dialog checkbox tree.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LayerPaperGroup {
    pub layer_id: String,
    pub layer_name: String,
    pub layer_number: i32,
    pub papers: Vec<PaperExportInfo>,
}

// ─── Helpers ───

/// Build a BibTeX string for a paper node.
///
/// If the node already has a stored `bibtex` field, use it directly.
/// Otherwise, generate one from the metadata JSON.
fn bibtex_for_paper(paper: &PaperRow) -> Option<String> {
    // Prefer the stored BibTeX string
    if let Some(ref bib) = paper.bibtex {
        let trimmed = bib.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    // Fall back: generate from metadata JSON
    if let Some(ref meta_json) = paper.metadata {
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(meta_json) {
            let authors: Vec<String> = meta
                .get("authors")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            let year = meta.get("year").and_then(|v| {
                v.as_str()
                    .map(|s| s.to_string())
                    .or_else(|| v.as_i64().map(|n| n.to_string()))
                    .or_else(|| v.as_f64().map(|n| (n as i64).to_string()))
            });

            let journal = meta
                .get("journal")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let doi = meta
                .get("doi")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let abstract_text = paper.content.as_deref();

            return Some(generate_bibtex_entry(
                &paper.title,
                &authors,
                year.as_deref(),
                journal.as_deref(),
                doi.as_deref(),
                abstract_text,
            ));
        }
    }

    // Last resort: generate with title only
    Some(generate_bibtex_entry(&paper.title, &[], None, None, None, None))
}

/// Extract author and year strings from a node's metadata JSON.
fn extract_author_year(metadata: &Option<String>) -> (String, String) {
    if let Some(ref meta_json) = metadata {
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(meta_json) {
            let authors = meta
                .get("authors")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();

            let year = meta
                .get("year")
                .and_then(|v| {
                    v.as_str()
                        .map(|s| s.to_string())
                        .or_else(|| v.as_i64().map(|n| n.to_string()))
                        .or_else(|| v.as_f64().map(|n| (n as i64).to_string()))
                })
                .unwrap_or_default();

            return (authors, year);
        }
    }
    (String::new(), String::new())
}

/// Collect BibTeX for a specific set of node IDs.
fn collect_bibtex_by_ids(db: &Database, node_ids: &[String]) -> Result<String, String> {
    if node_ids.is_empty() {
        return Ok(String::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Build a dynamic IN clause
    let placeholders: Vec<String> = node_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
    let sql = format!(
        "SELECT title, bibtex, metadata, content FROM nodes \
         WHERE id IN ({}) AND node_type = 'paper' AND status = 'active' \
         ORDER BY created_at",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params: Vec<&dyn rusqlite::types::ToSql> = node_ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();

    let rows: Vec<PaperRow> = stmt
        .query_map(params.as_slice(), |row| {
            Ok(PaperRow {
                title: row.get(0)?,
                bibtex: row.get(1)?,
                metadata: row.get(2)?,
                content: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let entries: Vec<String> = rows
        .iter()
        .filter_map(|p| bibtex_for_paper(p))
        .collect();

    Ok(entries.join("\n\n"))
}

// ─── Tauri Commands ───

/// Return papers grouped by layer for the export dialog checkbox tree.
#[tauri::command]
pub fn get_paper_nodes_by_layers(db: State<Database>) -> Result<Vec<LayerPaperGroup>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get all layers (the layers table has no name column; the frontend
    // labels groups as "Layer {layer_number}" when layer_name is empty)
    let mut layer_stmt = conn
        .prepare("SELECT id, layer_number FROM layers ORDER BY layer_number")
        .map_err(|e| e.to_string())?;

    let layers: Vec<(String, i32)> = layer_stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    drop(layer_stmt);

    let mut groups = Vec::new();

    for (layer_id, layer_number) in &layers {
        let mut paper_stmt = conn
            .prepare(
                "SELECT id, title, bibtex, metadata FROM nodes \
                 WHERE layer_id = ?1 AND node_type = 'paper' AND status = 'active' \
                 ORDER BY created_at",
            )
            .map_err(|e| e.to_string())?;

        let papers: Vec<PaperExportInfo> = paper_stmt
            .query_map([layer_id], |row| {
                let node_id: String = row.get(0)?;
                let title: String = row.get(1)?;
                let bibtex: Option<String> = row.get(2)?;
                let metadata: Option<String> = row.get(3)?;
                Ok((node_id, title, bibtex, metadata))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|(node_id, title, bibtex, metadata)| {
                let (authors, year) = extract_author_year(&metadata);
                let has_bibtex = bibtex.as_ref().map_or(false, |b| !b.trim().is_empty());
                PaperExportInfo {
                    node_id,
                    title,
                    authors,
                    year,
                    has_bibtex,
                }
            })
            .collect();

        groups.push(LayerPaperGroup {
            layer_id: layer_id.clone(),
            layer_name: String::new(),
            layer_number: *layer_number,
            papers,
        });
    }

    Ok(groups)
}

/// Return concatenated BibTeX content for a specific set of node IDs.
#[tauri::command]
pub fn export_bibtex_selected(
    db: State<Database>,
    node_ids: Vec<String>,
) -> Result<String, String> {
    collect_bibtex_by_ids(&db, &node_ids)
}

/// Export BibTeX for specific node IDs to a file via a native save dialog.
///
/// Returns the chosen file path on success.
#[tauri::command]
pub async fn export_bibtex_to_file(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    node_ids: Vec<String>,
) -> Result<String, String> {
    let content = collect_bibtex_by_ids(&db, &node_ids)?;

    if content.trim().is_empty() {
        return Err("No paper nodes found to export".to_string());
    }

    use tauri_plugin_dialog::DialogExt;
    let file_path = app
        .dialog()
        .file()
        .set_title("Export BibTeX")
        .set_file_name("references.bib")
        .add_filter("BibTeX", &["bib"])
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            std::fs::write(&path_str, &content)
                .map_err(|e| format!("Failed to write file: {e}"))?;
            Ok(path_str)
        }
        None => Err("Export cancelled".to_string()),
    }
}

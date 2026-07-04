//! Render-node pipeline: gather the Typst source of connected Note nodes,
//! translate Cladel graph references (`{@cite}`, `{{@image}}`, `{@table[r,c]}`)
//! into native Typst, and compile to a PDF preview (PNG pages) or a final PDF.
//!
//! Graph references are preserved (per the product decision) and translated at
//! compile time, so authors keep Content Pull / @Mention and the paper/image/
//! table node integration while writing in Typst.

use std::collections::HashSet;
use std::path::Path;

use regex::Regex;
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::db::Database;
use super::nodes::{node_from_row, NodeData, NODE_COLUMNS};
use super::pdf_export::{build_table_map, parse_table_cell_ref, preview_output_path, resolve_table_cell, split_citation_ids};
use super::typst_engine;

/// Preview resolution (points-per-pixel). 2.0 ≈ 144 dpi — crisp on-screen.
const PREVIEW_PIXEL_PER_PT: f32 = 2.0;

/// Typst document preamble shared by preview and export. Uses bundled fonts so
/// Latin (Liberation Serif) and Japanese (Noto Serif JP, via fallback) render.
const PREAMBLE: &str = "#set text(font: (\"Liberation Serif\", \"Noto Serif JP\"), size: 11pt)\n\
#set page(paper: \"a4\", margin: 2cm)\n\
#set par(justify: true)\n\n";

#[derive(Serialize)]
pub struct RenderPreviewResult {
    /// Absolute file paths to per-page PNG previews (use convertFileSrc to show).
    pub pages: Vec<String>,
    pub page_count: usize,
    /// Number of connected Note nodes that fed this render.
    pub note_count: usize,
}

/// Escape text coming from data (node titles, table cell values) so it is shown
/// literally in Typst markup rather than interpreted as Typst syntax.
fn escape_typst(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        if matches!(
            ch,
            '\\' | '#' | '$' | '*' | '_' | '@' | '<' | '>' | '[' | ']' | '`' | '~'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Sanitize a string into a safe ASCII filename stem.
fn safe_filename(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect()
}

/// Rewrite a BibTeX entry's citation key so it matches `new_key` (the node's
/// display_id), guaranteeing that `@display_id` resolves against the generated
/// bibliography even if the stored entry used a different key.
fn rewrite_bibtex_key(bibtex: &str, new_key: &str) -> String {
    if let Some(brace) = bibtex.find('{') {
        if let Some(comma_rel) = bibtex[brace + 1..].find(',') {
            let comma = brace + 1 + comma_rel;
            let mut out = String::with_capacity(bibtex.len());
            out.push_str(&bibtex[..=brace]);
            out.push_str(new_key);
            out.push_str(&bibtex[comma..]);
            return out;
        }
    }
    bibtex.to_string()
}

/// Assemble a full Typst document from ordered Note nodes.
///
/// Side effects: copies referenced images and writes `refs.bib` into `work_dir`,
/// which must therefore be the file-system-resolver root used to compile.
pub(crate) fn assemble_typst_source(
    conn: &Connection,
    all_nodes: &[NodeData],
    notes: &[NodeData],
    work_dir: &Path,
    citation_style: &str,
) -> Result<String, String> {
    let tables = build_table_map(all_nodes);
    let ref_re = Regex::new(r"\{{1,2}@([^}]+)\}{1,2}").map_err(|e| e.to_string())?;

    let mut bib_entries: Vec<String> = Vec::new();
    let mut cited_keys: HashSet<String> = HashSet::new();

    let mut body = String::new();
    body.push_str(PREAMBLE);

    for note in notes {
        let content = note.content.clone().unwrap_or_default();

        let translated = ref_re.replace_all(&content, |caps: &regex::Captures| {
            let raw = &caps[1];
            let mut parts: Vec<String> = Vec::new();
            for did in split_citation_ids(raw) {
                // Table cell reference: `table_1[0,1]` → inline cell value.
                if let Some((base, row, col)) = parse_table_cell_ref(did) {
                    if let Some(val) = resolve_table_cell(&tables, base, row, col) {
                        parts.push(escape_typst(&val));
                        continue;
                    }
                }
                // Resolve by display_id and dispatch by node type.
                match all_nodes.iter().find(|n| n.display_id.as_deref() == Some(did)) {
                    Some(node) if node.node_type == "paper" => {
                        let bib = node.bibtex.as_deref().map(str::trim).filter(|s| !s.is_empty());
                        if let Some(bib) = bib {
                            if cited_keys.insert(did.to_string()) {
                                bib_entries.push(rewrite_bibtex_key(bib, did));
                            }
                            parts.push(format!("@{did}"));
                        } else {
                            // No BibTeX: fall back to the title in brackets.
                            parts.push(format!("[{}]", escape_typst(&node.title)));
                        }
                    }
                    Some(node) if node.node_type == "image" => {
                        let file_path: Option<String> = conn
                            .query_row(
                                "SELECT file_path FROM node_images WHERE node_id = ?1 LIMIT 1",
                                [&node.id],
                                |row| row.get(0),
                            )
                            .ok();
                        let copied = file_path.as_deref().and_then(|fp| {
                            if !Path::new(fp).exists() {
                                return None;
                            }
                            let ext = Path::new(fp)
                                .extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("png");
                            let fname = format!("{}.{}", safe_filename(did), ext);
                            std::fs::copy(fp, work_dir.join(&fname)).ok().map(|_| fname)
                        });
                        match copied {
                            Some(fname) => parts.push(format!(
                                "#figure(image(\"{}\", width: 80%), caption: [{}])",
                                fname,
                                escape_typst(&node.title)
                            )),
                            None => parts.push(format!("[{}]", escape_typst(&node.title))),
                        }
                    }
                    Some(_) | None => {
                        // Other node types (e.g. another note) or unresolved
                        // references: keep the display_id as literal text.
                        parts.push(escape_typst(did));
                    }
                }
            }
            parts.join(" ")
        });

        body.push_str(&translated);
        body.push_str("\n\n");
    }

    // Bibliography (only if at least one resolvable citation was found).
    if !bib_entries.is_empty() {
        std::fs::write(work_dir.join("refs.bib"), bib_entries.join("\n\n"))
            .map_err(|e| format!("Failed to write bibliography: {e}"))?;
        let style = if citation_style == "apa" { "apa" } else { "ieee" };
        body.push_str(&format!("\n#bibliography(\"refs.bib\", style: \"{style}\")\n"));
    }

    Ok(body)
}

/// Fetch the active Note nodes connected to `node_id` (edges in either
/// direction), ordered top-to-bottom then left-to-right for a stable reading
/// order on the canvas.
fn connected_notes(conn: &Connection, node_id: &str) -> Result<Vec<NodeData>, String> {
    let query = format!(
        "SELECT {NODE_COLUMNS} FROM nodes WHERE id IN (
            SELECT source_node_id FROM edges WHERE target_node_id = ?1
            UNION
            SELECT target_node_id FROM edges WHERE source_node_id = ?1
        ) AND node_type = 'user_doc' AND status = 'active'
        ORDER BY position_y, position_x"
    );
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let notes = stmt
        .query_map([node_id], node_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(notes)
}

fn all_active_nodes(conn: &Connection, layer_id: &str) -> Result<Vec<NodeData>, String> {
    let query = format!("SELECT {NODE_COLUMNS} FROM nodes WHERE layer_id = ?1 AND status = 'active'");
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let nodes = stmt
        .query_map([layer_id], node_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(nodes)
}

fn citation_style_of(node: &NodeData) -> String {
    node.metadata
        .as_deref()
        .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
        .and_then(|v| v.get("citation_style").and_then(|s| s.as_str().map(String::from)))
        .unwrap_or_else(|| "ieee".to_string())
}

/// Compile the connected Notes of a render node into per-page PNG previews.
#[tauri::command]
pub fn render_typst_preview(
    db: State<Database>,
    render_node_id: String,
) -> Result<RenderPreviewResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let query = format!("SELECT {NODE_COLUMNS} FROM nodes WHERE id = ?1");
    let render_node: NodeData = conn
        .query_row(&query, [&render_node_id], node_from_row)
        .map_err(|e| format!("Render node not found: {e}"))?;
    if render_node.node_type != "render" {
        return Err("Node is not a render node".to_string());
    }

    let citation_style = citation_style_of(&render_node);
    let notes = connected_notes(&conn, &render_node_id)?;
    let note_count = notes.len();

    // Fresh work dir per render node (cleared each run to drop stale pages).
    let work_dir = std::env::temp_dir()
        .join("cladel-render")
        .join(safe_filename(&render_node_id));
    let _ = std::fs::remove_dir_all(&work_dir);
    std::fs::create_dir_all(&work_dir).map_err(|e| e.to_string())?;

    if notes.is_empty() {
        return Ok(RenderPreviewResult { pages: vec![], page_count: 0, note_count: 0 });
    }

    let all_nodes = all_active_nodes(&conn, &render_node.layer_id)?;
    let source = assemble_typst_source(&conn, &all_nodes, &notes, &work_dir, &citation_style)?;
    drop(conn); // release the DB lock before the (heavier) Typst compile

    let pngs = typst_engine::compile_to_pngs(source, Some(&work_dir), PREVIEW_PIXEL_PER_PT)?;
    let mut pages = Vec::with_capacity(pngs.len());
    for (i, png) in pngs.iter().enumerate() {
        let path = work_dir.join(format!("page_{i:03}.png"));
        std::fs::write(&path, png).map_err(|e| e.to_string())?;
        pages.push(path.to_string_lossy().into_owned());
    }

    Ok(RenderPreviewResult { page_count: pages.len(), pages, note_count })
}

/// Generate a final PDF from an export node connected to one or more render
/// nodes. Notes from all connected render nodes are gathered (ordered, dedup'd),
/// assembled into one Typst document, and compiled to `output_path`.
#[tauri::command]
pub fn generate_typst_export_pdf(
    db: State<Database>,
    window: tauri::Window,
    export_node_id: String,
    output_path: Option<String>,
) -> Result<String, String> {
    use tauri::Emitter;
    let emit = |stage: &str, percent: u8, message: &str| {
        let _ = window.emit(
            "export-progress",
            serde_json::json!({ "stage": stage, "percent": percent, "message": message }),
        );
    };

    emit("init", 5, "Loading render nodes...");

    // No explicit path → preview flow: write into the app temp dir.
    let output_path = match output_path {
        Some(p) => p,
        None => preview_output_path(&export_node_id)?,
    };

    // Assemble the Typst source while holding the DB lock, then release it
    // before the (heavier) compile + file write.
    let (source, work_dir) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        let query = format!("SELECT {NODE_COLUMNS} FROM nodes WHERE id = ?1");
        let export_node: NodeData = conn
            .query_row(&query, [&export_node_id], node_from_row)
            .map_err(|e| format!("Export node not found: {e}"))?;
        if export_node.node_type != "export" {
            return Err("Node is not an export node".to_string());
        }
        let citation_style = citation_style_of(&export_node);

        // Connected render nodes, ordered top-to-bottom then left-to-right.
        let render_q = format!(
            "SELECT {NODE_COLUMNS} FROM nodes WHERE id IN (
                SELECT source_node_id FROM edges WHERE target_node_id = ?1
                UNION
                SELECT target_node_id FROM edges WHERE source_node_id = ?1
            ) AND node_type = 'render' AND status = 'active'
            ORDER BY position_y, position_x"
        );
        let mut stmt = conn.prepare(&render_q).map_err(|e| e.to_string())?;
        let render_nodes: Vec<NodeData> = stmt
            .query_map([&export_node_id], node_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);

        if render_nodes.is_empty() {
            return Err("No render nodes are connected to this export node.".to_string());
        }

        emit("sections", 30, "Gathering notes from render nodes...");

        // Flatten notes across render nodes, dedup by id while preserving order.
        let mut seen: HashSet<String> = HashSet::new();
        let mut notes: Vec<NodeData> = Vec::new();
        for rn in &render_nodes {
            for note in connected_notes(&conn, &rn.id)? {
                if seen.insert(note.id.clone()) {
                    notes.push(note);
                }
            }
        }
        if notes.is_empty() {
            return Err("The connected render nodes have no Note nodes to export.".to_string());
        }

        let all_nodes = all_active_nodes(&conn, &export_node.layer_id)?;

        let work_dir = std::env::temp_dir()
            .join("cladel-export")
            .join(safe_filename(&export_node_id));
        let _ = std::fs::remove_dir_all(&work_dir);
        std::fs::create_dir_all(&work_dir).map_err(|e| e.to_string())?;

        emit("references", 55, "Translating references...");
        let source = assemble_typst_source(&conn, &all_nodes, &notes, &work_dir, &citation_style)?;
        (source, work_dir)
    };

    emit("writing", 80, "Compiling Typst → PDF...");
    let pdf = typst_engine::compile_to_pdf(source, Some(&work_dir))?;
    std::fs::write(&output_path, &pdf).map_err(|e| format!("Failed to write PDF: {e}"))?;

    emit("done", 100, "PDF export complete!");
    Ok(output_path)
}

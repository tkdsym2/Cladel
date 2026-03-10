use crate::db::Database;
use genpdf::Element as _;
use regex::Regex;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::bibtex::parse_bibtex;
use super::nodes::{node_from_row, NodeData, NODE_COLUMNS};

// ─── Types ───

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportSection {
    pub node_id: String,
    pub display_id: Option<String>,
    pub title: String,
    pub content: String,
    pub cited_papers: Vec<CitedPaper>,
    pub referenced_images: Vec<ReferencedImage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CitedPaper {
    pub display_id: String,
    pub node_id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<String>,
    pub journal: Option<String>,
    pub volume: Option<String>,
    pub number: Option<String>,
    pub pages: Option<String>,
    pub doi: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReferencedImage {
    pub display_id: String,
    pub node_id: String,
    pub title: String,
    pub file_path: Option<String>,
    pub caption: Option<String>,
    pub file_exists: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportAuthor {
    pub name: String,
    #[serde(default)]
    pub affiliations: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportTitlePage {
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub authors: Vec<ExportAuthor>,
}

impl Default for ExportTitlePage {
    fn default() -> Self {
        Self {
            subtitle: String::new(),
            authors: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportPreview {
    pub sections: Vec<ExportSection>,
    pub citation_style: String,
    pub language: String,
    pub all_cited_papers: Vec<CitedPaper>,
    pub all_referenced_images: Vec<ReferencedImage>,
    pub style_config: ExportStyleConfig,
    pub title_page: ExportTitlePage,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportStyleConfig {
    #[serde(default = "default_en_font_preset")]
    pub en_font_preset: String,
    #[serde(default = "default_jp_font_preset")]
    pub jp_font_preset: String,
    pub title_size: f64,
    pub section_heading_size: f64,
    pub subsection_heading_size: f64,
    pub body_size: f64,
    pub line_spacing: f64,
    pub margin_top: u8,
    pub margin_bottom: u8,
    pub margin_left: u8,
    pub margin_right: u8,
    #[serde(default = "default_true")]
    pub section_numbering: bool,
    #[serde(default = "default_title_alignment")]
    pub title_alignment: String,
    #[serde(default = "default_affiliation_marker")]
    pub affiliation_marker: String,
    #[serde(default)]
    pub show_line_numbers: bool,
}

fn default_en_font_preset() -> String {
    "times_new_roman".to_string()
}

fn default_jp_font_preset() -> String {
    "ms_mincho".to_string()
}

fn default_true() -> bool {
    true
}

fn default_title_alignment() -> String {
    "left".to_string()
}

fn default_affiliation_marker() -> String {
    "number".to_string()
}

/// Convert a number to Unicode superscript digits.
fn to_superscript_digits(n: usize) -> String {
    n.to_string()
        .chars()
        .map(|c| match c {
            '0' => '\u{2070}',
            '1' => '\u{00B9}',
            '2' => '\u{00B2}',
            '3' => '\u{00B3}',
            '4' => '\u{2074}',
            '5' => '\u{2075}',
            '6' => '\u{2076}',
            '7' => '\u{2077}',
            '8' => '\u{2078}',
            '9' => '\u{2079}',
            _ => c,
        })
        .collect()
}

/// Get a dagger-style marker for the given 1-based index.
fn to_dagger_marker(n: usize) -> String {
    match n {
        1 => "\u{2020}".to_string(),   // †
        2 => "\u{2021}".to_string(),   // ‡
        3 => "\u{00A7}".to_string(),   // §
        4 => "\u{2016}".to_string(),   // ‖
        5 => "\u{00B6}".to_string(),   // ¶
        6 => "\u{2020}\u{2020}".to_string(), // ††
        7 => "\u{2021}\u{2021}".to_string(), // ‡‡
        8 => "\u{00A7}\u{00A7}".to_string(), // §§
        _ => format!("\u{2020}{}", n),
    }
}

/// Get an affiliation marker string for the given 1-based index.
fn affiliation_marker(index: usize, style: &str) -> String {
    if style == "dagger" {
        to_dagger_marker(index)
    } else {
        to_superscript_digits(index)
    }
}

/// Convert f64 font size to u8 for genpdf (which only accepts u8).
fn font_size_to_u8(size: f64) -> u8 {
    (size.round() as u8).max(6)
}

impl Default for ExportStyleConfig {
    fn default() -> Self {
        Self {
            en_font_preset: default_en_font_preset(),
            jp_font_preset: default_jp_font_preset(),
            title_size: 18.0,
            section_heading_size: 14.0,
            subsection_heading_size: 12.0,
            body_size: 11.0,
            line_spacing: 1.0,
            margin_top: 20,
            margin_bottom: 20,
            margin_left: 15,
            margin_right: 15,
            section_numbering: true,
            title_alignment: default_title_alignment(),
            affiliation_marker: default_affiliation_marker(),
            show_line_numbers: false,
        }
    }
}

/// Tracks hierarchical section numbering across Edit nodes.
/// `#` increments section, `##` increments subsection, `###` increments subsubsection.
struct HeadingCounters {
    section: usize,
    subsection: usize,
    subsubsection: usize,
}

impl HeadingCounters {
    fn new() -> Self {
        Self { section: 0, subsection: 0, subsubsection: 0 }
    }

    /// Advance the counter for the given heading level and return the numbering string.
    fn advance(&mut self, level: u8) -> String {
        match level {
            1 => {
                self.section += 1;
                self.subsection = 0;
                self.subsubsection = 0;
                format!("{}", self.section)
            }
            2 => {
                self.subsection += 1;
                self.subsubsection = 0;
                format!("{}.{}", self.section, self.subsection)
            }
            3 => {
                self.subsubsection += 1;
                format!("{}.{}.{}", self.section, self.subsection, self.subsubsection)
            }
            _ => String::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportMetadata {
    pub citation_style: Option<String>,
    pub section_order: Option<Vec<String>>,
    pub language: Option<String>,
    pub style_config: Option<ExportStyleConfig>,
}

// ─── Title Node Helpers ───

/// Look for a connected title node and build ExportTitlePage from it.
/// Falls back to using the export node's own title if no title node is connected.
fn find_connected_title_node(
    conn: &rusqlite::Connection,
    export_node_id: &str,
    _export_node_title: &str,
) -> Result<ExportTitlePage, String> {
    let title_node: Option<NodeData> = conn
        .query_row(
            &format!(
                "SELECT {} FROM nodes WHERE id IN (
                    SELECT source_node_id FROM edges WHERE target_node_id = ?1
                    UNION
                    SELECT target_node_id FROM edges WHERE source_node_id = ?1
                ) AND node_type = 'title' AND status = 'active' LIMIT 1",
                NODE_COLUMNS
            ),
            [export_node_id],
            node_from_row,
        )
        .ok();

    if let Some(tn) = title_node {
        let meta: serde_json::Value = tn
            .metadata
            .as_deref()
            .and_then(|m| serde_json::from_str(m).ok())
            .unwrap_or_default();

        let subtitle = meta["subtitle"].as_str().unwrap_or("").to_string();
        let authors: Vec<ExportAuthor> = meta["authors"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();

        Ok(ExportTitlePage {
            subtitle,
            authors,
        })
    } else {
        // Fallback: use export node title, no subtitle/authors
        Ok(ExportTitlePage {
            subtitle: String::new(),
            authors: Vec::new(),
        })
    }
}

// ─── Commands ───

#[tauri::command]
pub fn get_export_sections(
    db: State<Database>,
    export_node_id: String,
) -> Result<ExportPreview, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 1. Fetch the export node itself
    let query = format!("SELECT {} FROM nodes WHERE id = ?1", NODE_COLUMNS);
    let export_node: NodeData = conn
        .query_row(&query, [&export_node_id], node_from_row)
        .map_err(|e| format!("Export node not found: {e}"))?;

    if export_node.node_type != "export" {
        return Err("Node is not an export node".to_string());
    }

    // Parse metadata for section order and citation style
    let meta: ExportMetadata = export_node
        .metadata
        .as_deref()
        .and_then(|m| serde_json::from_str(m).ok())
        .unwrap_or(ExportMetadata {
            citation_style: None,
            section_order: None,
            language: None,
            style_config: None,
        });

    let citation_style = meta.citation_style.unwrap_or_else(|| "ieee".to_string());
    let language = meta.language.unwrap_or_else(|| "en".to_string());
    let style_config = meta.style_config.unwrap_or_default();

    // 2. Look for a connected title node
    let title_page = find_connected_title_node(&conn, &export_node_id, &export_node.title)?;

    // 3. Find all connected user_doc nodes (edges in either direction)
    let connected_query = format!(
        "SELECT {} FROM nodes WHERE id IN (
            SELECT source_node_id FROM edges WHERE target_node_id = ?1
            UNION
            SELECT target_node_id FROM edges WHERE source_node_id = ?1
        ) AND node_type = 'user_doc' AND status = 'active'",
        NODE_COLUMNS
    );
    let mut stmt = conn
        .prepare(&connected_query)
        .map_err(|e| e.to_string())?;
    let connected_nodes: Vec<NodeData> = stmt
        .query_map([&export_node_id], node_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // 3. Order sections: use metadata order if set, else connection order
    let ordered_nodes = if let Some(ref order) = meta.section_order {
        let mut ordered: Vec<NodeData> = Vec::new();
        for id in order {
            if let Some(n) = connected_nodes.iter().find(|n| &n.id == id) {
                ordered.push(n.clone());
            }
        }
        // Add any connected nodes not in the order list
        for n in &connected_nodes {
            if !ordered.iter().any(|o| o.id == n.id) {
                ordered.push(n.clone());
            }
        }
        ordered
    } else {
        connected_nodes
    };

    // 4. Get all nodes in the layer for reference resolution
    let layer_id = &export_node.layer_id;
    let all_query = format!(
        "SELECT {} FROM nodes WHERE layer_id = ?1 AND status = 'active'",
        NODE_COLUMNS
    );
    let mut all_stmt = conn.prepare(&all_query).map_err(|e| e.to_string())?;
    let all_nodes: Vec<NodeData> = all_stmt
        .query_map([layer_id], node_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let ref_re = Regex::new(r"\{{1,2}@([^}]+)\}{1,2}").map_err(|e| e.to_string())?;

    let mut all_cited: Vec<CitedPaper> = Vec::new();
    let mut all_images: Vec<ReferencedImage> = Vec::new();

    // 5. Build sections — unified {@id} / {{@id}} references, dispatched by node type
    let mut sections: Vec<ExportSection> = Vec::new();
    for node in &ordered_nodes {
        let content = node.content.clone().unwrap_or_default();

        let mut cited_papers: Vec<CitedPaper> = Vec::new();
        let mut referenced_images: Vec<ReferencedImage> = Vec::new();

        for cap in ref_re.captures_iter(&content) {
            let raw = &cap[1];
            for did in split_citation_ids(raw) {
                if let Some(ref_node) = all_nodes
                    .iter()
                    .find(|n| n.display_id.as_deref() == Some(did))
                {
                    match ref_node.node_type.as_str() {
                        "paper" => {
                            let cited = build_cited_paper(ref_node, did);

                            if !all_cited.iter().any(|c| c.node_id == cited.node_id) {
                                all_cited.push(cited.clone());
                            }
                            cited_papers.push(cited);
                        }
                        "image" => {
                            let file_path: Option<String> = conn
                                .query_row(
                                    "SELECT file_path FROM node_images WHERE node_id = ?1 LIMIT 1",
                                    [&ref_node.id],
                                    |row| row.get(0),
                                )
                                .ok();

                            let file_exists = file_path
                                .as_ref()
                                .map(|p| std::path::Path::new(p).exists())
                                .unwrap_or(false);

                            let caption: Option<String> = {
                                let mut cmt_stmt = conn
                                    .prepare(
                                        "SELECT content FROM node_comments WHERE node_id = ?1 ORDER BY created_at ASC",
                                    )
                                    .map_err(|e| e.to_string())?;
                                let comments: Vec<String> = cmt_stmt
                                    .query_map([&ref_node.id], |row| row.get(0))
                                    .map_err(|e| e.to_string())?
                                    .collect::<Result<Vec<_>, _>>()
                                    .map_err(|e| e.to_string())?;
                                if comments.is_empty() {
                                    None
                                } else {
                                    Some(comments.join(" "))
                                }
                            };

                            let img_ref = ReferencedImage {
                                display_id: did.to_string(),
                                node_id: ref_node.id.clone(),
                                title: ref_node.title.clone(),
                                file_path,
                                caption,
                                file_exists,
                            };

                            if !all_images.iter().any(|i| i.node_id == img_ref.node_id) {
                                all_images.push(img_ref.clone());
                            }
                            referenced_images.push(img_ref);
                        }
                        _ => {} // Other node types: referenced but no special export handling
                    }
                }
            }
        }

        sections.push(ExportSection {
            node_id: node.id.clone(),
            display_id: node.display_id.clone(),
            title: node.title.clone(),
            content,
            cited_papers,
            referenced_images,
        });
    }

    Ok(ExportPreview {
        sections,
        citation_style,
        language,
        all_cited_papers: all_cited,
        all_referenced_images: all_images,
        style_config,
        title_page,
    })
}

#[tauri::command]
pub fn update_export_section_order(
    db: State<Database>,
    export_node_id: String,
    section_order: Vec<String>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Get current metadata
    let current_meta: Option<String> = conn
        .query_row(
            "SELECT metadata FROM nodes WHERE id = ?1 AND node_type = 'export'",
            [&export_node_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Export node not found: {e}"))?;

    let mut meta: serde_json::Value = current_meta
        .as_deref()
        .and_then(|m| serde_json::from_str(m).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    meta["section_order"] = serde_json::json!(section_order);

    conn.execute(
        "UPDATE nodes SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
        params![serde_json::to_string(&meta).unwrap_or_default(), now, export_node_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn update_export_citation_style(
    db: State<Database>,
    export_node_id: String,
    style: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let current_meta: Option<String> = conn
        .query_row(
            "SELECT metadata FROM nodes WHERE id = ?1 AND node_type = 'export'",
            [&export_node_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Export node not found: {e}"))?;

    let mut meta: serde_json::Value = current_meta
        .as_deref()
        .and_then(|m| serde_json::from_str(m).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    meta["citation_style"] = serde_json::json!(style);

    conn.execute(
        "UPDATE nodes SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
        params![serde_json::to_string(&meta).unwrap_or_default(), now, export_node_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn update_export_language(
    db: State<Database>,
    export_node_id: String,
    language: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let current_meta: Option<String> = conn
        .query_row(
            "SELECT metadata FROM nodes WHERE id = ?1 AND node_type = 'export'",
            [&export_node_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Export node not found: {e}"))?;

    let mut meta: serde_json::Value = current_meta
        .as_deref()
        .and_then(|m| serde_json::from_str(m).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    meta["language"] = serde_json::json!(language);

    conn.execute(
        "UPDATE nodes SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
        params![serde_json::to_string(&meta).unwrap_or_default(), now, export_node_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn update_export_style_config(
    db: State<Database>,
    export_node_id: String,
    style_config: ExportStyleConfig,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let current_meta: Option<String> = conn
        .query_row(
            "SELECT metadata FROM nodes WHERE id = ?1 AND node_type = 'export'",
            [&export_node_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Export node not found: {e}"))?;

    let mut meta: serde_json::Value = current_meta
        .as_deref()
        .and_then(|m| serde_json::from_str(m).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    meta["style_config"] = serde_json::to_value(&style_config).unwrap_or_default();

    conn.execute(
        "UPDATE nodes SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
        params![serde_json::to_string(&meta).unwrap_or_default(), now, export_node_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Clone, Serialize)]
struct ExportProgress {
    stage: String,
    percent: u8,
    message: String,
}

#[tauri::command]
pub fn generate_export_pdf(
    db: State<Database>,
    window: tauri::Window,
    export_node_id: String,
    output_path: String,
) -> Result<String, String> {
    use tauri::Emitter;

    let emit_progress = |stage: &str, percent: u8, message: &str| {
        let _ = window.emit("export-progress", ExportProgress {
            stage: stage.to_string(),
            percent,
            message: message.to_string(),
        });
    };

    emit_progress("init", 5, "Loading export data...");

    let preview = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;

        // Fetch export node
        let query = format!("SELECT {} FROM nodes WHERE id = ?1", NODE_COLUMNS);
        let export_node: NodeData = conn
            .query_row(&query, [&export_node_id], node_from_row)
            .map_err(|e| format!("Export node not found: {e}"))?;

        if export_node.node_type != "export" {
            return Err("Node is not an export node".to_string());
        }

        // Reuse get_export_sections logic inline
        let meta: ExportMetadata = export_node
            .metadata
            .as_deref()
            .and_then(|m| serde_json::from_str(m).ok())
            .unwrap_or(ExportMetadata {
                citation_style: None,
                section_order: None,
                language: None,
                style_config: None,
            });
        let citation_style = meta.citation_style.unwrap_or_else(|| "ieee".to_string());
        let language = meta.language.unwrap_or_else(|| "en".to_string());
        let style_config = meta.style_config.unwrap_or_default();
        let title_page = find_connected_title_node(&conn, &export_node_id, &export_node.title)?;

        // Connected user_doc nodes
        let connected_query = format!(
            "SELECT {} FROM nodes WHERE id IN (
                SELECT source_node_id FROM edges WHERE target_node_id = ?1
                UNION
                SELECT target_node_id FROM edges WHERE source_node_id = ?1
            ) AND node_type = 'user_doc' AND status = 'active'",
            NODE_COLUMNS
        );
        let mut stmt = conn.prepare(&connected_query).map_err(|e| e.to_string())?;
        let connected_nodes: Vec<NodeData> = stmt
            .query_map([&export_node_id], node_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let ordered_nodes = if let Some(ref order) = meta.section_order {
            let mut ordered: Vec<NodeData> = Vec::new();
            for id in order {
                if let Some(n) = connected_nodes.iter().find(|n| &n.id == id) {
                    ordered.push(n.clone());
                }
            }
            for n in &connected_nodes {
                if !ordered.iter().any(|o| o.id == n.id) {
                    ordered.push(n.clone());
                }
            }
            ordered
        } else {
            connected_nodes
        };

        // All nodes for reference resolution
        let all_query = format!(
            "SELECT {} FROM nodes WHERE layer_id = ?1 AND status = 'active'",
            NODE_COLUMNS
        );
        let mut all_stmt = conn.prepare(&all_query).map_err(|e| e.to_string())?;
        let all_nodes: Vec<NodeData> = all_stmt
            .query_map([&export_node.layer_id], node_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let ref_re = Regex::new(r"\{{1,2}@([^}]+)\}{1,2}").map_err(|e| e.to_string())?;

        let mut all_cited: Vec<CitedPaper> = Vec::new();
        let mut all_images: Vec<ReferencedImage> = Vec::new();
        let mut sections: Vec<ExportSection> = Vec::new();

        for node in &ordered_nodes {
            let content = node.content.clone().unwrap_or_default();

            let mut cited_papers: Vec<CitedPaper> = Vec::new();
            let mut referenced_images: Vec<ReferencedImage> = Vec::new();

            for cap in ref_re.captures_iter(&content) {
                let raw = &cap[1];
                for did in split_citation_ids(raw) {
                    if let Some(ref_node) = all_nodes
                        .iter()
                        .find(|n| n.display_id.as_deref() == Some(did))
                    {
                        match ref_node.node_type.as_str() {
                            "paper" => {
                                let cited = build_cited_paper(ref_node, did);

                                if !all_cited.iter().any(|c| c.node_id == cited.node_id) {
                                    all_cited.push(cited.clone());
                                }
                                cited_papers.push(cited);
                            }
                            "image" => {
                                let file_path: Option<String> = conn
                                    .query_row(
                                        "SELECT file_path FROM node_images WHERE node_id = ?1 LIMIT 1",
                                        [&ref_node.id],
                                        |row| row.get(0),
                                    )
                                    .ok();

                                let file_exists = file_path
                                    .as_ref()
                                    .map(|p| std::path::Path::new(p).exists())
                                    .unwrap_or(false);

                                let caption: Option<String> = {
                                    let mut cmt_stmt = conn
                                        .prepare(
                                            "SELECT content FROM node_comments WHERE node_id = ?1 ORDER BY created_at ASC",
                                        )
                                        .map_err(|e| e.to_string())?;
                                    let comments: Vec<String> = cmt_stmt
                                        .query_map([&ref_node.id], |row| row.get(0))
                                        .map_err(|e| e.to_string())?
                                        .collect::<Result<Vec<_>, _>>()
                                        .map_err(|e| e.to_string())?;
                                    if comments.is_empty() {
                                        None
                                    } else {
                                        Some(comments.join(" "))
                                    }
                                };

                                let img_ref = ReferencedImage {
                                    display_id: did.to_string(),
                                    node_id: ref_node.id.clone(),
                                    title: ref_node.title.clone(),
                                    file_path,
                                    caption,
                                    file_exists,
                                };

                                if !all_images.iter().any(|i| i.node_id == img_ref.node_id) {
                                    all_images.push(img_ref.clone());
                                }
                                referenced_images.push(img_ref);
                            }
                            _ => {}
                        }
                    }
                }
            }

            sections.push(ExportSection {
                node_id: node.id.clone(),
                display_id: node.display_id.clone(),
                title: node.title.clone(),
                content,
                cited_papers,
                referenced_images,
            });
        }

        // Use title node's title if connected, otherwise export node's title
        let effective_title = {
            let title_node_title: Option<String> = conn
                .query_row(
                    "SELECT title FROM nodes WHERE id IN (
                        SELECT source_node_id FROM edges WHERE target_node_id = ?1
                        UNION
                        SELECT target_node_id FROM edges WHERE source_node_id = ?1
                    ) AND node_type = 'title' AND status = 'active' LIMIT 1",
                    [&export_node_id],
                    |row| row.get(0),
                )
                .ok();
            title_node_title.unwrap_or(export_node.title)
        };

        (effective_title, sections, citation_style, language, all_cited, all_images, style_config, title_page)
    };

    let (doc_title, sections, citation_style, language, all_cited, all_images, style_config, title_page) = preview;

    // ─── Build PDF with genpdf ───

    emit_progress("fonts", 15, "Loading fonts...");

    let jp_font_family = load_jp_font_family(&style_config.jp_font_preset)?;
    let en_font_family = load_en_font_family(&style_config.en_font_preset)?;

    let mut doc = genpdf::Document::new(jp_font_family);
    let en_font_ref = doc.add_font_family(en_font_family);
    doc.set_title(&doc_title);
    doc.set_minimal_conformance();

    // Page margins from style config
    let mut decorator = genpdf::SimplePageDecorator::new();
    decorator.set_margins(genpdf::Margins::trbl(
        style_config.margin_top as i32,
        style_config.margin_right as i32,
        style_config.margin_bottom as i32,
        style_config.margin_left as i32,
    ));
    doc.set_page_decorator(decorator);

    // Title alignment
    let title_align = if style_config.title_alignment == "center" {
        genpdf::Alignment::Center
    } else {
        genpdf::Alignment::Left
    };

    // Document title — clean invisible chars
    let title_style = genpdf::style::Style::new().bold().with_font_size(font_size_to_u8(style_config.title_size));
    push_mixed_paragraph_aligned(&mut doc, &clean_for_pdf(&doc_title), title_style, en_font_ref, title_align);

    // Subtitle
    if !title_page.subtitle.is_empty() {
        doc.push(genpdf::elements::Break::new(0.3));
        let subtitle_size = font_size_to_u8((style_config.title_size - 4.0).max(10.0));
        let subtitle_style = genpdf::style::Style::new().with_font_size(subtitle_size);
        push_mixed_paragraph_aligned(&mut doc, &clean_for_pdf(&title_page.subtitle), subtitle_style, en_font_ref, title_align);
    }

    // Authors with affiliations
    if !title_page.authors.is_empty() {
        doc.push(genpdf::elements::Break::new(0.5));
        let author_size = font_size_to_u8(style_config.body_size + 1.0);
        let author_style = genpdf::style::Style::new().with_font_size(author_size);
        let affil_size = font_size_to_u8(style_config.body_size);
        let affil_style = genpdf::style::Style::new().italic().with_font_size(affil_size);
        let marker_style = &style_config.affiliation_marker;

        // Collect unique affiliations across all authors for numbering
        let mut affil_list: Vec<String> = Vec::new();
        for author in &title_page.authors {
            for aff in &author.affiliations {
                if !aff.is_empty() && !affil_list.contains(aff) {
                    affil_list.push(aff.clone());
                }
            }
        }
        let use_markers = affil_list.len() > 1;

        // Author names line with superscript affiliation markers (no brackets)
        let author_names: Vec<String> = title_page.authors.iter().map(|a| {
            if use_markers {
                let markers: Vec<String> = a.affiliations.iter()
                    .filter(|af| !af.is_empty())
                    .filter_map(|af| affil_list.iter().position(|x| x == af).map(|i| {
                        affiliation_marker(i + 1, marker_style)
                    }))
                    .collect();
                if markers.is_empty() {
                    clean_for_pdf(&a.name)
                } else {
                    format!("{}{}", clean_for_pdf(&a.name), markers.join(","))
                }
            } else {
                clean_for_pdf(&a.name)
            }
        }).collect();
        push_mixed_paragraph_aligned(&mut doc, &author_names.join(", "), author_style, en_font_ref, title_align);

        // Affiliation lines
        if use_markers {
            for (i, affil) in affil_list.iter().enumerate() {
                let marker = affiliation_marker(i + 1, marker_style);
                let text = format!("{} {}", marker, clean_for_pdf(affil));
                push_mixed_paragraph_aligned(&mut doc, &text, affil_style, en_font_ref, title_align);
            }
        } else if let Some(single_affil) = affil_list.first() {
            push_mixed_paragraph_aligned(&mut doc, &clean_for_pdf(single_affil), affil_style, en_font_ref, title_align);
        }
    }

    doc.push(genpdf::elements::Break::new(1.0));

    // Build citation numbering map for IEEE — only count paper nodes
    let ref_re = Regex::new(r"\{{1,2}@([^}]+)\}{1,2}").unwrap();
    let mut cite_number_map: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut cite_counter = 1;
    for section in &sections {
        let content = &section.content;
        for cap in ref_re.captures_iter(content) {
            let raw = cap[1].to_string();
            for did in split_citation_ids(&raw) {
                let did = did.to_string();
                // Only number paper citations
                if all_cited.iter().any(|p| p.display_id == did) && !cite_number_map.contains_key(&did) {
                    cite_number_map.insert(did, cite_counter);
                    cite_counter += 1;
                }
            }
        }
    }

    emit_progress("sections", 25, "Processing sections...");

    // Heading counters for section numbering across all Edit nodes
    let mut heading_counters = HeadingCounters::new();
    let total_sections = sections.len();

    // Line number counter for body content
    let mut line_counter: usize = 1;
    let content_width_mm = 210.0 - style_config.margin_left as f64 - style_config.margin_right as f64;

    // Process sections (Edit node content only — titles are NOT included)
    for (sec_i, section) in sections.iter().enumerate() {
        // Progress: 25% to 75% spread across sections
        let sec_percent = if total_sections > 0 {
            25 + ((sec_i as u8) * 50 / (total_sections as u8).max(1))
        } else {
            50
        };
        emit_progress("sections", sec_percent, &format!("Processing section {} / {}...", sec_i + 1, total_sections));
        // Process content — clean invisible chars before rendering
        let mut processed = clean_for_pdf(&section.content);

        // Unified replacement: dispatch by whether the ID is a paper, image, or other
        let ref_replaced = ref_re.replace_all(&processed, |caps: &regex::Captures| {
            let raw = &caps[1];
            let ids = split_citation_ids(raw);

            // Separate paper IDs from image/other IDs
            let mut paper_parts: Vec<String> = Vec::new();
            let mut other_parts: Vec<String> = Vec::new();

            for did in &ids {
                if let Some(paper) = all_cited.iter().find(|p| p.display_id == *did) {
                    match citation_style.as_str() {
                        "apa" => paper_parts.push(format_apa_inline_bare(paper)),
                        _ => {
                            if let Some(num) = cite_number_map.get(*did) {
                                paper_parts.push(num.to_string());
                            } else {
                                paper_parts.push(did.to_string());
                            }
                        }
                    }
                } else if let Some(img) = all_images.iter().find(|i| i.display_id == *did) {
                    let fig_label = if language == "ja" { "図" } else { "Figure" };
                    other_parts.push(format!("[{}: {}]", fig_label, img.title));
                } else {
                    other_parts.push(format!("[{}]", did));
                }
            }

            let mut result = String::new();
            if !paper_parts.is_empty() {
                match citation_style.as_str() {
                    "apa" => result.push_str(&format!("({})", paper_parts.join("; "))),
                    _ => result.push_str(&format!("[{}]", paper_parts.join(","))),
                }
            }
            for part in &other_parts {
                if !result.is_empty() { result.push(' '); }
                result.push_str(part);
            }
            result
        });
        processed = ref_replaced.into_owned();

        // Parse markdown and output paragraphs (# = section, ## = subsection, ### = subsubsection)
        render_markdown_to_doc(&mut doc, &processed, &style_config, en_font_ref, &mut heading_counters, &mut line_counter, content_width_mm);

        // Embed images referenced in this section
        for img_ref in &section.referenced_images {
            if img_ref.file_exists {
                if let Some(ref path) = img_ref.file_path {
                    if let Ok(genpdf_img) = genpdf::elements::Image::from_path(path) {
                        let img_element = genpdf_img.with_scale(genpdf::Scale::new(0.5, 0.5));
                        doc.push(img_element);
                    }
                }
            }

            // Caption from comments
            if let Some(ref caption) = img_ref.caption {
                let cap_style = genpdf::style::Style::new().italic().with_font_size(10);
                let fig_label = if language == "ja" { "図" } else { "Figure" };
                let cap_text = format!("{}: {} - {}", fig_label, img_ref.title, caption);
                push_mixed_paragraph(&mut doc, &cap_text, cap_style, en_font_ref);
            }
        }

        doc.push(genpdf::elements::Break::new(0.5 * style_config.line_spacing));
    }

    // ─── References section ───
    emit_progress("references", 80, "Building references...");
    if !all_cited.is_empty() {
        doc.push(genpdf::elements::Break::new(1.0 * style_config.line_spacing));
        let ref_heading_style = genpdf::style::Style::new().bold().with_font_size(font_size_to_u8(style_config.section_heading_size));
        let ref_heading = if language == "ja" { "参考文献" } else { "References" };
        push_mixed_paragraph(&mut doc, ref_heading, ref_heading_style, en_font_ref);
        doc.push(genpdf::elements::Break::new(0.5));

        match citation_style.as_str() {
            "apa" => {
                // APA: sorted alphabetically by first author
                let mut sorted_cited = all_cited.clone();
                sorted_cited.sort_by(|a, b| {
                    let a_author = a.authors.first().map(|s| s.as_str()).unwrap_or("");
                    let b_author = b.authors.first().map(|s| s.as_str()).unwrap_or("");
                    a_author.cmp(b_author)
                });

                for paper in &sorted_cited {
                    doc.push(build_apa_reference_paragraph(paper, en_font_ref));
                }
            }
            _ => {
                // IEEE: numbered by order of appearance
                let mut ordered_cited: Vec<(usize, &CitedPaper)> = Vec::new();
                for paper in &all_cited {
                    if let Some(&num) = cite_number_map.get(&paper.display_id) {
                        ordered_cited.push((num, paper));
                    }
                }
                ordered_cited.sort_by_key(|(n, _)| *n);

                for (num, paper) in &ordered_cited {
                    let ref_text = format_ieee_reference(*num, paper);
                    let ref_style = genpdf::style::Style::new().with_font_size(10);
                    push_mixed_paragraph(&mut doc, &ref_text, ref_style, en_font_ref);
                }
            }
        }
    }

    // Write to file
    emit_progress("writing", 90, "Writing PDF file...");
    doc.render_to_file(&output_path)
        .map_err(|e| format!("Failed to write PDF: {e}"))?;

    emit_progress("done", 100, "PDF export complete!");

    Ok(output_path)
}

// ─── Helpers ───

/// Strip invisible / non-printable Unicode characters and normalize whitespace.
///
/// Removes: soft hyphens (U+00AD), zero-width spaces (U+200B), non-breaking spaces (U+00A0),
/// BOM (U+FEFF), zero-width joiners/non-joiners, and other control/format characters
/// that cause rendering artifacts (e.g. "⊠" replacement boxes) in PDF output.
/// Preserves standard printable characters including BibTeX-significant ones ({}\~^$%&_#@).
fn clean_for_pdf(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| match c {
            // Replace non-breaking space with regular space
            '\u{00A0}' => ' ',
            // Replace en-dash/em-dash variants with ASCII hyphen
            '\u{2013}' | '\u{2014}' => '\u{2013}',
            // Keep the character if it's printable and not a control/format char
            _ if should_keep(c) => c,
            // Drop everything else (invisible/non-printable)
            _ => '\0',
        })
        .filter(|&c| c != '\0')
        .collect();

    // Normalize runs of whitespace into single spaces
    let mut result = String::with_capacity(cleaned.len());
    let mut prev_space = false;
    for c in cleaned.chars() {
        if c == ' ' || c == '\t' {
            if !prev_space {
                result.push(' ');
            }
            prev_space = true;
        } else {
            prev_space = false;
            result.push(c);
        }
    }
    result.trim().to_string()
}

/// Returns true if the character should be kept in PDF output.
fn should_keep(c: char) -> bool {
    if c.is_ascii() {
        // Keep all printable ASCII (space through tilde) and common whitespace
        c >= ' ' || c == '\n' || c == '\r' || c == '\t'
    } else {
        // For non-ASCII: keep if it has a visible representation
        // Drop: C0/C1 control chars, format chars, soft hyphens, zero-width chars, BOM, etc.
        !matches!(c,
            '\u{00AD}'          |  // Soft hyphen
            '\u{00A0}'          |  // Non-breaking space (already mapped above, belt-and-suspenders)
            '\u{200B}'          |  // Zero-width space
            '\u{200C}'          |  // Zero-width non-joiner
            '\u{200D}'          |  // Zero-width joiner
            '\u{200E}'          |  // Left-to-right mark
            '\u{200F}'          |  // Right-to-left mark
            '\u{202A}'..='\u{202E}' | // Bidi formatting
            '\u{2060}'..='\u{2064}' | // Word joiner, invisible plus/times
            '\u{2066}'..='\u{2069}' | // Bidi isolate formatting
            '\u{FEFF}'          |  // BOM / zero-width no-break space
            '\u{FFF9}'..='\u{FFFB}' | // Interlinear annotation anchors
            '\u{FFFC}'          |  // Object replacement character
            '\u{FFFD}'             // Replacement character
        ) && !c.is_control()
    }
}

/// Build a CitedPaper from a paper node, extracting BibTeX fields for volume/number/pages.
/// All string fields are cleaned of invisible Unicode characters before use.
fn build_cited_paper(ref_node: &NodeData, display_id: &str) -> CitedPaper {
    let meta_json: serde_json::Value = ref_node
        .metadata
        .as_deref()
        .and_then(|m| serde_json::from_str(m).ok())
        .unwrap_or_default();

    // Parse BibTeX to get volume, number, pages
    let bibtex_fields = ref_node
        .bibtex
        .as_deref()
        .and_then(|bib| parse_bibtex(bib.to_string()).ok())
        .and_then(|entries| entries.into_iter().next())
        .map(|entry| entry.fields)
        .unwrap_or_default();

    CitedPaper {
        display_id: display_id.to_string(),
        node_id: ref_node.id.clone(),
        title: clean_for_pdf(&ref_node.title),
        authors: meta_json["authors"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| clean_for_pdf(s)))
                    .collect()
            })
            .unwrap_or_default(),
        year: meta_json["year"].as_str().map(|s| clean_for_pdf(s)),
        journal: meta_json["journal"]
            .as_str()
            .map(|s| clean_for_pdf(s))
            .or_else(|| bibtex_fields.get("journal").map(|s| clean_for_pdf(s))),
        volume: bibtex_fields.get("volume").map(|s| clean_for_pdf(s)),
        number: bibtex_fields.get("number").map(|s| clean_for_pdf(s)),
        pages: bibtex_fields.get("pages").map(|s| clean_for_pdf(s)),
        doi: meta_json["doi"].as_str().map(|s| clean_for_pdf(s)),
    }
}

/// Split a multi-citation capture into individual display_ids.
/// E.g. "XXX; @YYY; @ZZZ" → ["XXX", "YYY", "ZZZ"]
fn split_citation_ids(captured: &str) -> Vec<&str> {
    let mut ids = Vec::new();
    for part in captured.split([',', ';']) {
        let trimmed = part.trim().trim_start_matches('@');
        if !trimmed.is_empty() {
            ids.push(trimmed);
        }
    }
    ids
}

fn format_apa_inline_bare(paper: &CitedPaper) -> String {
    let year = paper.year.as_deref().unwrap_or("n.d.");
    match paper.authors.len() {
        0 => format!("{}, {}", paper.title, year),
        1 => format!("{}, {}", last_name(&paper.authors[0]), year),
        2 => format!("{} & {}, {}", last_name(&paper.authors[0]), last_name(&paper.authors[1]), year),
        _ => format!("{} et al., {}", last_name(&paper.authors[0]), year),
    }
}

/// Build an APA 7th edition reference as a genpdf Paragraph with proper italic/roman styling.
///
/// APA 7 typographic rules:
///   - Authors, year, article title, issue number, pages, DOI → roman (plain)
///   - Journal name, volume number → italic
fn build_apa_reference_paragraph(
    paper: &CitedPaper,
    en_font_ref: genpdf::fonts::FontFamily<genpdf::fonts::Font>,
) -> genpdf::elements::Paragraph {
    let roman = genpdf::style::Style::new().with_font_size(10);
    let italic = genpdf::style::Style::new().italic().with_font_size(10);

    // Authors: LastName, F. M., LastName, F. M., & LastName, F. M.
    let authors_str = paper
        .authors
        .iter()
        .enumerate()
        .map(|(i, a)| {
            if i == paper.authors.len() - 1 && paper.authors.len() > 1 {
                format!("& {}", abbreviate_name(a))
            } else {
                abbreviate_name(a)
            }
        })
        .collect::<Vec<_>>()
        .join(", ");

    let year = paper.year.as_deref().unwrap_or("n.d.");

    // Start building the paragraph
    let mut para = genpdf::elements::Paragraph::default();

    if paper.journal.is_some() {
        // Journal article: title is roman, journal is italic
        push_mixed_styled(
            &mut para,
            &clean_for_pdf(&format!("{} ({}). {}. ", authors_str, year, paper.title)),
            roman,
            en_font_ref,
        );
    } else {
        // Book/report/thesis: title itself is italic
        push_mixed_styled(
            &mut para,
            &clean_for_pdf(&format!("{} ({}). ", authors_str, year)),
            roman,
            en_font_ref,
        );
        push_mixed_styled(
            &mut para,
            &clean_for_pdf(&format!("{}. ", paper.title)),
            italic,
            en_font_ref,
        );
    }

    // Journal source: "Journal Name, Volume" italic + "(Issue), Pages." roman
    if let Some(ref journal) = paper.journal {
        // Journal name → italic
        let mut italic_part = clean_for_pdf(journal).to_string();

        // Volume → italic (appended to journal)
        if let Some(ref vol) = paper.volume {
            italic_part.push_str(&format!(", {}", clean_for_pdf(vol)));
        }

        push_mixed_styled(&mut para, &italic_part, italic, en_font_ref);

        // Issue number → roman
        if let Some(ref num) = paper.number {
            push_mixed_styled(&mut para, &format!("({})", clean_for_pdf(num)), roman, en_font_ref);
        }

        // Pages → roman
        if let Some(ref pages) = paper.pages {
            push_mixed_styled(&mut para, &format!(", {}.", clean_for_pdf(pages)), roman, en_font_ref);
        } else {
            para.push_styled(".", roman);
        }
    }

    // DOI → roman (always EN font)
    if let Some(ref doi) = paper.doi {
        let en_roman = roman.with_font_family(en_font_ref);
        para.push_styled(format!(" https://doi.org/{}", clean_for_pdf(doi)), en_roman);
    }

    para
}

fn format_ieee_reference(num: usize, paper: &CitedPaper) -> String {
    let authors_str = paper
        .authors
        .iter()
        .map(|a| abbreviate_name_ieee(a))
        .collect::<Vec<_>>()
        .join(", ");

    let year = paper.year.as_deref().unwrap_or("n.d.");
    let journal_part = paper
        .journal
        .as_ref()
        .map(|j| format!(", {}", j))
        .unwrap_or_default();

    format!(
        "[{}] {}, \"{},\" {}{}, {}.",
        num, authors_str, paper.title, journal_part, "", year
    )
}

fn last_name(full: &str) -> String {
    if let Some((last, _)) = full.split_once(',') {
        // "LastName, FirstName" format
        last.trim().to_string()
    } else {
        // "FirstName LastName" format
        let parts: Vec<&str> = full.split_whitespace().collect();
        parts.last().unwrap_or(&full).to_string()
    }
}

/// Format a name for APA style: "LastName, F. M."
/// Handles both "FirstName LastName" and "LastName, FirstName" input formats.
fn abbreviate_name(full: &str) -> String {
    if let Some((last, first)) = full.split_once(',') {
        // Already in "LastName, FirstName MiddleName" format
        let last = last.trim();
        let initials: String = first
            .split_whitespace()
            .filter(|p| !p.is_empty())
            .map(|p| {
                let c = p.chars().next().unwrap_or('?');
                if p.ends_with('.') && p.chars().count() <= 3 {
                    // Already an initial like "J." or "W."
                    p.to_string()
                } else {
                    format!("{}.", c.to_uppercase().next().unwrap_or(c))
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        format!("{}, {}", last, initials)
    } else {
        // "FirstName MiddleName LastName" format
        let parts: Vec<&str> = full.split_whitespace().collect();
        if parts.len() <= 1 {
            return full.to_string();
        }
        let last = parts.last().unwrap();
        let initials: String = parts[..parts.len() - 1]
            .iter()
            .map(|p| {
                let c = p.chars().next().unwrap_or('?');
                format!("{}.", c.to_uppercase().next().unwrap_or(c))
            })
            .collect::<Vec<_>>()
            .join(" ");
        format!("{}, {}", last, initials)
    }
}

/// Format a name for IEEE style: "F. M. LastName"
/// Handles both "FirstName LastName" and "LastName, FirstName" input formats.
fn abbreviate_name_ieee(full: &str) -> String {
    if let Some((last, first)) = full.split_once(',') {
        let last = last.trim();
        let initials: String = first
            .split_whitespace()
            .filter(|p| !p.is_empty())
            .map(|p| {
                let c = p.chars().next().unwrap_or('?');
                if p.ends_with('.') && p.chars().count() <= 3 {
                    p.to_string()
                } else {
                    format!("{}.", c.to_uppercase().next().unwrap_or(c))
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        format!("{} {}", initials, last)
    } else {
        let parts: Vec<&str> = full.split_whitespace().collect();
        if parts.len() <= 1 {
            return full.to_string();
        }
        let last = parts.last().unwrap();
        let initials: String = parts[..parts.len() - 1]
            .iter()
            .map(|p| {
                let c = p.chars().next().unwrap_or('?');
                format!("{}.", c.to_uppercase().next().unwrap_or(c))
            })
            .collect::<Vec<_>>()
            .join(" ");
        format!("{} {}", initials, last)
    }
}

fn render_markdown_to_doc(
    doc: &mut genpdf::Document,
    text: &str,
    sc: &ExportStyleConfig,
    en_font_ref: genpdf::fonts::FontFamily<genpdf::fonts::Font>,
    counters: &mut HeadingCounters,
    line_counter: &mut usize,
    content_width_mm: f64,
) {
    use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

    let parser = Parser::new_ext(text, Options::all());
    let body_u8 = font_size_to_u8(sc.body_size);
    let spacing = sc.line_spacing;
    let show_ln = sc.show_line_numbers;

    let mut current_text = String::new();
    let mut is_bold = false;
    let mut is_italic = false;
    let mut _in_heading = false;
    let mut heading_level: u8 = 0;
    let mut list_depth: usize = 0;
    let mut _in_list_item = false;

    for event in parser {
        match event {
            Event::Start(tag) => match tag {
                Tag::Heading { level, .. } => {
                    flush_paragraph(doc, &mut current_text, is_bold, is_italic, body_u8, spacing, en_font_ref, show_ln, line_counter, content_width_mm);
                    _in_heading = true;
                    heading_level = level as u8;
                }
                Tag::Paragraph => {}
                Tag::Strong => is_bold = true,
                Tag::Emphasis => is_italic = true,
                Tag::List(_) => {
                    flush_paragraph(doc, &mut current_text, is_bold, is_italic, body_u8, spacing, en_font_ref, show_ln, line_counter, content_width_mm);
                    list_depth += 1;
                }
                Tag::Item => {
                    _in_list_item = true;
                    let indent = "  ".repeat(list_depth.saturating_sub(1));
                    current_text.push_str(&format!("{}- ", indent));
                }
                Tag::CodeBlock(_) => {
                    flush_paragraph(doc, &mut current_text, is_bold, is_italic, body_u8, spacing, en_font_ref, show_ln, line_counter, content_width_mm);
                }
                _ => {}
            },
            Event::End(tag_end) => match tag_end {
                TagEnd::Heading(_) => {
                    // Map heading levels: # = section, ## = subsection, ### = subsubsection
                    let size = match heading_level {
                        1 => font_size_to_u8(sc.section_heading_size),
                        2 => font_size_to_u8(sc.subsection_heading_size),
                        3 => font_size_to_u8(sc.body_size + 1.0), // subsubsection: bold body+1
                        _ => font_size_to_u8(sc.body_size),
                    };

                    if !current_text.is_empty() {
                        // Prepend numbering if enabled and heading level <= 3
                        let heading_text = if sc.section_numbering && heading_level <= 3 {
                            let num = counters.advance(heading_level);
                            format!("{} {}", num, current_text.trim())
                        } else {
                            if heading_level <= 3 {
                                // Still advance counters even if not displaying numbers
                                counters.advance(heading_level);
                            }
                            current_text.trim().to_string()
                        };

                        let style = genpdf::style::Style::new().bold().with_font_size(size);

                        if show_ln {
                            push_element_with_line_number(doc, &heading_text, style, en_font_ref, line_counter, 1, size, content_width_mm);
                        } else {
                            push_mixed_paragraph(doc, &heading_text, style, en_font_ref);
                        }
                        doc.push(genpdf::elements::Break::new(0.3 * spacing));
                        current_text.clear();
                    }
                    _in_heading = false;
                    heading_level = 0;
                }
                TagEnd::Paragraph => {
                    flush_paragraph(doc, &mut current_text, is_bold, is_italic, body_u8, spacing, en_font_ref, show_ln, line_counter, content_width_mm);
                }
                TagEnd::Strong => is_bold = false,
                TagEnd::Emphasis => is_italic = false,
                TagEnd::List(_) => {
                    flush_paragraph(doc, &mut current_text, is_bold, is_italic, body_u8, spacing, en_font_ref, show_ln, line_counter, content_width_mm);
                    list_depth = list_depth.saturating_sub(1);
                }
                TagEnd::Item => {
                    flush_paragraph(doc, &mut current_text, is_bold, is_italic, body_u8, spacing, en_font_ref, show_ln, line_counter, content_width_mm);
                    _in_list_item = false;
                }
                TagEnd::CodeBlock => {
                    if !current_text.is_empty() {
                        let code_size = font_size_to_u8((sc.body_size - 2.0).max(7.0));
                        let code_style = genpdf::style::Style::new()
                            .with_font_size(code_size);
                        // Code blocks: use EN font for all content
                        let en_code_style = code_style.with_font_family(en_font_ref);
                        let safe = sanitize_for_pdf(current_text.trim());

                        if show_ln {
                            let para = genpdf::elements::Paragraph::new(&safe).styled(en_code_style);
                            let estimated = estimate_lines(current_text.trim(), code_size, content_width_mm);
                            push_raw_element_with_line_number(doc, para, line_counter, estimated, code_size);
                        } else {
                            doc.push(
                                genpdf::elements::Paragraph::new(&safe)
                                    .styled(en_code_style),
                            );
                        }
                        current_text.clear();
                    }
                }
                _ => {}
            },
            Event::Text(t) => {
                current_text.push_str(&t);
            }
            Event::SoftBreak | Event::HardBreak => {
                current_text.push(' ');
            }
            Event::Code(code) => {
                current_text.push_str(&code);
            }
            _ => {}
        }
    }

    // Flush any remaining text
    flush_paragraph(doc, &mut current_text, is_bold, is_italic, body_u8, spacing, en_font_ref, show_ln, line_counter, content_width_mm);
}

/// Estimate the number of visual lines a text block will occupy.
fn estimate_lines(text: &str, font_size: u8, content_width_mm: f64) -> usize {
    let chars_per_line = (content_width_mm / (font_size as f64) * 5.0).max(20.0) as usize;
    (text.chars().count() / chars_per_line).max(1)
}

/// Push a mixed-font paragraph wrapped in a TableLayout with a line number column.
fn push_element_with_line_number(
    doc: &mut genpdf::Document,
    text: &str,
    base_style: genpdf::style::Style,
    en_font_ref: genpdf::fonts::FontFamily<genpdf::fonts::Font>,
    line_counter: &mut usize,
    estimated_lines: usize,
    font_size: u8,
    content_width_mm: f64,
) {
    let runs = split_into_font_runs(text);
    if runs.is_empty() {
        return;
    }
    let mut para = genpdf::elements::Paragraph::default();
    for (segment_text, is_en) in runs {
        let safe = if is_en {
            sanitize_en_segment(&segment_text)
        } else {
            sanitize_for_pdf(&segment_text)
        };
        let style = if is_en {
            base_style.with_font_family(en_font_ref)
        } else {
            base_style
        };
        para.push_styled(safe, style);
    }

    let est = if estimated_lines > 0 { estimated_lines } else {
        estimate_lines(text, font_size, content_width_mm)
    };
    push_raw_element_with_line_number(doc, para, line_counter, est, font_size);
}

/// Push any Element wrapped in a TableLayout with a line number column.
fn push_raw_element_with_line_number(
    doc: &mut genpdf::Document,
    element: impl genpdf::Element + 'static,
    line_counter: &mut usize,
    estimated_lines: usize,
    font_size: u8,
) {
    let line_num_size = font_size.saturating_sub(2).max(6);
    let line_num_style = genpdf::style::Style::new().with_font_size(line_num_size);
    let num_para = genpdf::elements::Paragraph::new(format!("{}", *line_counter))
        .aligned(genpdf::Alignment::Right)
        .styled(line_num_style);

    *line_counter += estimated_lines;

    let mut table = genpdf::elements::TableLayout::new(vec![1, 19]);
    let mut row = table.row();
    row.push_element(num_para);
    row.push_element(element);
    row.push().ok();
    doc.push(table);
}

fn flush_paragraph(
    doc: &mut genpdf::Document,
    text: &mut String,
    bold: bool,
    italic: bool,
    font_size: u8,
    line_spacing: f64,
    en_font_ref: genpdf::fonts::FontFamily<genpdf::fonts::Font>,
    show_line_numbers: bool,
    line_counter: &mut usize,
    content_width_mm: f64,
) {
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        let mut base_style = genpdf::style::Style::new().with_font_size(font_size);
        if bold {
            base_style = base_style.bold();
        }
        if italic {
            base_style = base_style.italic();
        }

        let runs = split_into_font_runs(trimmed);
        let mut para = genpdf::elements::Paragraph::default();
        for (segment_text, is_en) in runs {
            let safe = if is_en {
                sanitize_en_segment(&segment_text)
            } else {
                sanitize_for_pdf(&segment_text)
            };
            let style = if is_en {
                base_style.with_font_family(en_font_ref)
            } else {
                base_style
            };
            para.push_styled(safe, style);
        }

        if show_line_numbers {
            let estimated = estimate_lines(trimmed, font_size, content_width_mm);
            push_raw_element_with_line_number(doc, para, line_counter, estimated, font_size);
        } else {
            doc.push(para);
        }
        doc.push(genpdf::elements::Break::new(0.3 * line_spacing));
    }
    text.clear();
}

/// Break long words to prevent genpdf panic on multi-byte UTF-8 text.
///
/// genpdf 0.2's word-wrapping silently skips words wider than the page width
/// but doesn't remove them from its internal word list. This causes a byte-offset
/// mismatch in cleanup, and `replace_range` panics at a non-char-boundary when
/// multi-byte characters are present. We prevent this by ensuring no single
/// whitespace-delimited token exceeds the page width.
///
/// For CJK text: inserts zero-width-safe spaces between CJK characters so
/// genpdf can wrap them. CJK scripts don't use spaces between words, so the
/// entire paragraph becomes one "word" from genpdf's perspective.
fn sanitize_for_pdf(text: &str) -> String {
    const MAX_WORD_CHARS: usize = 70;

    let mut result = String::with_capacity(text.len() * 2);
    for (i, segment) in text.split(' ').enumerate() {
        if i > 0 {
            result.push(' ');
        }
        if has_cjk(segment) {
            // Insert spaces between CJK characters so genpdf can wrap them
            insert_cjk_breaks(&mut result, segment);
        } else if segment.starts_with("http://") || segment.starts_with("https://") {
            // Never break URLs — they must stay intact
            result.push_str(segment);
        } else {
            let char_count = segment.chars().count();
            if char_count <= MAX_WORD_CHARS {
                result.push_str(segment);
            } else {
                break_long_word(&mut result, segment, MAX_WORD_CHARS);
            }
        }
    }
    result
}

fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{3000}'..='\u{303F}' |  // CJK Symbols and Punctuation
        '\u{3040}'..='\u{309F}' |  // Hiragana
        '\u{30A0}'..='\u{30FF}' |  // Katakana
        '\u{4E00}'..='\u{9FFF}' |  // CJK Unified Ideographs
        '\u{F900}'..='\u{FAFF}' |  // CJK Compatibility Ideographs
        '\u{FF00}'..='\u{FFEF}' |  // Halfwidth and Fullwidth Forms
        '\u{20000}'..='\u{2A6DF}'  // CJK Unified Ideographs Extension B
    )
}

fn has_cjk(text: &str) -> bool {
    text.chars().any(is_cjk)
}

/// Insert spaces between CJK characters so genpdf can wrap at any character.
/// For runs of Latin/ASCII characters within CJK text, keep them grouped.
fn insert_cjk_breaks(out: &mut String, text: &str) {
    let mut prev_was_cjk = false;
    for c in text.chars() {
        if is_cjk(c) {
            if prev_was_cjk {
                out.push(' ');
            }
            out.push(c);
            prev_was_cjk = true;
        } else {
            prev_was_cjk = false;
            out.push(c);
        }
    }
}

fn break_long_word(out: &mut String, word: &str, max: usize) {
    let mut since_break = 0usize;
    for c in word.chars() {
        out.push(c);
        since_break += 1;
        if since_break >= max / 2 && matches!(c, '/' | '.' | '-' | '_' | '=' | '&' | '?' | ':') {
            out.push(' ');
            since_break = 0;
        } else if since_break >= max {
            out.push(' ');
            since_break = 0;
        }
    }
}

// ─── Mixed Font Helpers ───

/// Split text into runs of (text, is_en_font). Alphanumeric/ASCII uses EN font,
/// CJK/kana characters use JP font. Spaces attach to the current run.
fn split_into_font_runs(text: &str) -> Vec<(String, bool)> {
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return vec![];
    }

    // Determine initial run type from first non-space character
    let first_non_space_is_en = chars
        .iter()
        .find(|c| !c.is_ascii_whitespace())
        .map(|c| !is_cjk(*c))
        .unwrap_or(true);

    let mut runs: Vec<(String, bool)> = Vec::new();
    let mut current = String::new();
    let mut current_is_en = first_non_space_is_en;

    for &c in &chars {
        if c.is_ascii_whitespace() {
            // Spaces attach to current run
            current.push(c);
        } else {
            let char_is_en = !is_cjk(c);
            if char_is_en != current_is_en {
                if !current.is_empty() {
                    runs.push((current, current_is_en));
                    current = String::new();
                }
                current_is_en = char_is_en;
            }
            current.push(c);
        }
    }

    if !current.is_empty() {
        runs.push((current, current_is_en));
    }

    runs
}

/// Sanitize EN-only text segment (long word breaking, no CJK space insertion).
fn sanitize_en_segment(text: &str) -> String {
    const MAX_WORD_CHARS: usize = 70;
    let mut result = String::with_capacity(text.len());
    for (i, segment) in text.split(' ').enumerate() {
        if i > 0 {
            result.push(' ');
        }
        if segment.starts_with("http://") || segment.starts_with("https://") {
            result.push_str(segment);
        } else {
            let char_count = segment.chars().count();
            if char_count <= MAX_WORD_CHARS {
                result.push_str(segment);
            } else {
                break_long_word(&mut result, segment, MAX_WORD_CHARS);
            }
        }
    }
    result
}

/// Push styled text segments to a paragraph, splitting by font (EN vs JP).
fn push_mixed_styled(
    para: &mut genpdf::elements::Paragraph,
    text: &str,
    base_style: genpdf::style::Style,
    en_font_ref: genpdf::fonts::FontFamily<genpdf::fonts::Font>,
) {
    let runs = split_into_font_runs(text);
    for (segment_text, is_en) in runs {
        let safe = if is_en {
            sanitize_en_segment(&segment_text)
        } else {
            sanitize_for_pdf(&segment_text)
        };
        let style = if is_en {
            base_style.with_font_family(en_font_ref)
        } else {
            base_style
        };
        para.push_styled(safe, style);
    }
}

/// Push an entire paragraph with mixed EN/JP font rendering.
fn push_mixed_paragraph(
    doc: &mut genpdf::Document,
    text: &str,
    base_style: genpdf::style::Style,
    en_font_ref: genpdf::fonts::FontFamily<genpdf::fonts::Font>,
) {
    push_mixed_paragraph_aligned(doc, text, base_style, en_font_ref, genpdf::Alignment::Left);
}

/// Push a paragraph with mixed EN/JP font rendering and specified alignment.
fn push_mixed_paragraph_aligned(
    doc: &mut genpdf::Document,
    text: &str,
    base_style: genpdf::style::Style,
    en_font_ref: genpdf::fonts::FontFamily<genpdf::fonts::Font>,
    alignment: genpdf::Alignment,
) {
    let runs = split_into_font_runs(text);
    if runs.is_empty() {
        return;
    }
    let mut para = genpdf::elements::Paragraph::default().aligned(alignment);
    for (segment_text, is_en) in runs {
        let safe = if is_en {
            sanitize_en_segment(&segment_text)
        } else {
            sanitize_for_pdf(&segment_text)
        };
        let style = if is_en {
            base_style.with_font_family(en_font_ref)
        } else {
            base_style
        };
        para.push_styled(safe, style);
    }
    doc.push(para);
}

// ─── Font Loading ───

/// Home directory for resolving ~/Library/Fonts paths.
fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
}

/// Try to load a font from a list of candidate paths. Returns None if all fail.
fn try_load_system_font(candidates: &[String]) -> Option<Vec<u8>> {
    for path in candidates {
        if let Ok(bytes) = std::fs::read(path) {
            return Some(bytes);
        }
    }
    None
}

/// Build a FontFamily using a single font file for all weights (common for CJK fonts).
fn build_font_family_single(
    font_bytes: Vec<u8>,
) -> Result<genpdf::fonts::FontFamily<genpdf::fonts::FontData>, String> {
    let regular = genpdf::fonts::FontData::new(font_bytes.clone(), None)
        .map_err(|e| format!("Failed to load font: {e}"))?;
    let bold = genpdf::fonts::FontData::new(font_bytes.clone(), None)
        .map_err(|e| format!("Failed to load font: {e}"))?;
    let italic = genpdf::fonts::FontData::new(font_bytes.clone(), None)
        .map_err(|e| format!("Failed to load font: {e}"))?;
    let bold_italic = genpdf::fonts::FontData::new(font_bytes, None)
        .map_err(|e| format!("Failed to load font: {e}"))?;
    Ok(genpdf::fonts::FontFamily { regular, bold, italic, bold_italic })
}

/// Load English font family by preset name.
fn load_en_font_family(preset: &str) -> Result<genpdf::fonts::FontFamily<genpdf::fonts::FontData>, String> {
    match preset {
        "computer_modern" => load_computer_modern(),
        _ => load_times_new_roman(), // default: times_new_roman
    }
}

/// Load Japanese font family by preset name.
fn load_jp_font_family(preset: &str) -> Result<genpdf::fonts::FontFamily<genpdf::fonts::FontData>, String> {
    match preset {
        "yu_mincho" => load_yu_mincho(),
        _ => load_ms_mincho(), // default: ms_mincho
    }
}

fn load_times_new_roman() -> Result<genpdf::fonts::FontFamily<genpdf::fonts::FontData>, String> {
    let home = home_dir();

    // System font paths for Times New Roman (macOS, Windows, Linux)
    let regular_paths = vec![
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf".to_string(),
        "/Library/Fonts/Times New Roman.ttf".to_string(),
        format!("{}/Library/Fonts/Times New Roman.ttf", home),
        "C:\\Windows\\Fonts\\times.ttf".to_string(),
        "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman.ttf".to_string(),
    ];
    let bold_paths = vec![
        "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf".to_string(),
        "/Library/Fonts/Times New Roman Bold.ttf".to_string(),
        format!("{}/Library/Fonts/Times New Roman Bold.ttf", home),
        "C:\\Windows\\Fonts\\timesbd.ttf".to_string(),
        "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Bold.ttf".to_string(),
    ];
    let italic_paths = vec![
        "/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf".to_string(),
        "/Library/Fonts/Times New Roman Italic.ttf".to_string(),
        format!("{}/Library/Fonts/Times New Roman Italic.ttf", home),
        "C:\\Windows\\Fonts\\timesi.ttf".to_string(),
        "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Italic.ttf".to_string(),
    ];
    let bold_italic_paths = vec![
        "/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf".to_string(),
        "/Library/Fonts/Times New Roman Bold Italic.ttf".to_string(),
        format!("{}/Library/Fonts/Times New Roman Bold Italic.ttf", home),
        "C:\\Windows\\Fonts\\timesbi.ttf".to_string(),
        "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Bold_Italic.ttf".to_string(),
    ];

    let regular_bytes = try_load_system_font(&regular_paths);
    let bold_bytes = try_load_system_font(&bold_paths);
    let italic_bytes = try_load_system_font(&italic_paths);
    let bold_italic_bytes = try_load_system_font(&bold_italic_paths);

    if let Some(r) = regular_bytes {
        let regular = genpdf::fonts::FontData::new(r, None)
            .map_err(|e| format!("Failed to load Times New Roman: {e}"))?;
        let bold = genpdf::fonts::FontData::new(
            bold_bytes.unwrap_or_else(|| include_bytes!("../../fonts/LiberationSerif-Bold.ttf").to_vec()),
            None,
        ).map_err(|e| format!("Failed to load font: {e}"))?;
        let italic = genpdf::fonts::FontData::new(
            italic_bytes.unwrap_or_else(|| include_bytes!("../../fonts/LiberationSerif-Italic.ttf").to_vec()),
            None,
        ).map_err(|e| format!("Failed to load font: {e}"))?;
        let bold_italic = genpdf::fonts::FontData::new(
            bold_italic_bytes.unwrap_or_else(|| include_bytes!("../../fonts/LiberationSerif-BoldItalic.ttf").to_vec()),
            None,
        ).map_err(|e| format!("Failed to load font: {e}"))?;
        Ok(genpdf::fonts::FontFamily { regular, bold, italic, bold_italic })
    } else {
        // Fallback to bundled Liberation Serif (metric-compatible with Times New Roman)
        let regular = genpdf::fonts::FontData::new(
            include_bytes!("../../fonts/LiberationSerif-Regular.ttf").to_vec(), None,
        ).map_err(|e| format!("Failed to load font: {e}"))?;
        let bold = genpdf::fonts::FontData::new(
            include_bytes!("../../fonts/LiberationSerif-Bold.ttf").to_vec(), None,
        ).map_err(|e| format!("Failed to load font: {e}"))?;
        let italic = genpdf::fonts::FontData::new(
            include_bytes!("../../fonts/LiberationSerif-Italic.ttf").to_vec(), None,
        ).map_err(|e| format!("Failed to load font: {e}"))?;
        let bold_italic = genpdf::fonts::FontData::new(
            include_bytes!("../../fonts/LiberationSerif-BoldItalic.ttf").to_vec(), None,
        ).map_err(|e| format!("Failed to load font: {e}"))?;
        Ok(genpdf::fonts::FontFamily { regular, bold, italic, bold_italic })
    }
}

fn load_computer_modern() -> Result<genpdf::fonts::FontFamily<genpdf::fonts::FontData>, String> {
    let home = home_dir();

    // CMU Serif (Computer Modern Unicode) font paths
    let regular_paths = vec![
        format!("{}/Library/Fonts/cmunrm.ttf", home),
        "/usr/share/fonts/truetype/cmu/cmunrm.ttf".to_string(),
        "/usr/share/fonts/cmu-serif/cmunrm.ttf".to_string(),
    ];
    let bold_paths = vec![
        format!("{}/Library/Fonts/cmunbx.ttf", home),
        "/usr/share/fonts/truetype/cmu/cmunbx.ttf".to_string(),
        "/usr/share/fonts/cmu-serif/cmunbx.ttf".to_string(),
    ];
    let italic_paths = vec![
        format!("{}/Library/Fonts/cmunti.ttf", home),
        "/usr/share/fonts/truetype/cmu/cmunti.ttf".to_string(),
        "/usr/share/fonts/cmu-serif/cmunti.ttf".to_string(),
    ];
    let bold_italic_paths = vec![
        format!("{}/Library/Fonts/cmunbi.ttf", home),
        "/usr/share/fonts/truetype/cmu/cmunbi.ttf".to_string(),
        "/usr/share/fonts/cmu-serif/cmunbi.ttf".to_string(),
    ];

    let regular_bytes = try_load_system_font(&regular_paths);
    let bold_bytes = try_load_system_font(&bold_paths);
    let italic_bytes = try_load_system_font(&italic_paths);
    let bold_italic_bytes = try_load_system_font(&bold_italic_paths);

    if let Some(r) = regular_bytes {
        let regular = genpdf::fonts::FontData::new(r, None)
            .map_err(|e| format!("Failed to load Computer Modern: {e}"))?;
        let bold = genpdf::fonts::FontData::new(
            bold_bytes.unwrap_or_else(|| include_bytes!("../../fonts/LiberationSerif-Bold.ttf").to_vec()),
            None,
        ).map_err(|e| format!("Failed to load font: {e}"))?;
        let italic = genpdf::fonts::FontData::new(
            italic_bytes.unwrap_or_else(|| include_bytes!("../../fonts/LiberationSerif-Italic.ttf").to_vec()),
            None,
        ).map_err(|e| format!("Failed to load font: {e}"))?;
        let bold_italic = genpdf::fonts::FontData::new(
            bold_italic_bytes.unwrap_or_else(|| include_bytes!("../../fonts/LiberationSerif-BoldItalic.ttf").to_vec()),
            None,
        ).map_err(|e| format!("Failed to load font: {e}"))?;
        Ok(genpdf::fonts::FontFamily { regular, bold, italic, bold_italic })
    } else {
        // Fallback to bundled Liberation Serif
        load_times_new_roman()
    }
}

fn load_ms_mincho() -> Result<genpdf::fonts::FontFamily<genpdf::fonts::FontData>, String> {
    let home = home_dir();

    // MS Mincho: typically from MS Office installation
    // For TTC files, genpdf/rusttype will use the first font in the collection (index 0 = MS Mincho)
    let candidates = vec![
        "/Library/Fonts/Microsoft/MS Mincho.ttf".to_string(),
        "/Library/Fonts/msmincho.ttc".to_string(),
        format!("{}/Library/Fonts/MS Mincho.ttf", home),
        format!("{}/Library/Fonts/msmincho.ttc", home),
        "C:\\Windows\\Fonts\\msmincho.ttc".to_string(),
    ];

    if let Some(bytes) = try_load_system_font(&candidates) {
        return build_font_family_single(bytes);
    }

    // Fallback to bundled Noto Serif JP
    let font = include_bytes!("../../fonts/NotoSerifJP.ttf");
    build_font_family_single(font.to_vec())
}

fn load_yu_mincho() -> Result<genpdf::fonts::FontFamily<genpdf::fonts::FontData>, String> {
    let home = home_dir();

    // Yu Mincho: macOS system font or Windows
    // For TTC files, genpdf/rusttype will use the first font (index 0 = YuMincho-Medium)
    let candidates = vec![
        "/System/Library/Fonts/YuMincho.ttc".to_string(),
        "/Library/Fonts/Yu Mincho.ttf".to_string(),
        format!("{}/Library/Fonts/YuMincho.ttc", home),
        format!("{}/Library/Fonts/Yu Mincho.ttf", home),
        "C:\\Windows\\Fonts\\yumin.ttf".to_string(),
        "C:\\Windows\\Fonts\\YuMincho.ttc".to_string(),
    ];

    if let Some(bytes) = try_load_system_font(&candidates) {
        return build_font_family_single(bytes);
    }

    // Fallback to MS Mincho → then Noto Serif JP
    load_ms_mincho()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dual_font_renders_english_and_japanese() {
        let jp_font = load_jp_font_family("ms_mincho").expect("JP font loading failed");
        let en_font = load_en_font_family("times_new_roman").expect("EN font loading failed");
        let mut doc = genpdf::Document::new(jp_font);
        let en_ref = doc.add_font_family(en_font);
        doc.set_title("Mixed Language Test");
        doc.set_minimal_conformance();
        let mut decorator = genpdf::SimplePageDecorator::new();
        decorator.set_margins(genpdf::Margins::trbl(20, 15, 20, 15));
        doc.set_page_decorator(decorator);

        let style = genpdf::style::Style::new().with_font_size(14);
        push_mixed_paragraph(&mut doc, "English text rendered correctly", style, en_ref);
        push_mixed_paragraph(&mut doc, "日本語テスト", style, en_ref);
        push_mixed_paragraph(&mut doc, "Mixed: English and 日本語 together", style, en_ref);
        push_mixed_paragraph(&mut doc, "研究の背景 (Background) について", style, en_ref);

        let path = "/tmp/test_dual_font_export.pdf";
        let result = doc.render_to_file(path);
        assert!(result.is_ok(), "Failed to render: {:?}", result.err());

        let file_size = std::fs::metadata(path).unwrap().len();
        eprintln!("Dual font PDF size: {} bytes", file_size);
        assert!(file_size > 1000, "PDF too small");
    }

    #[test]
    fn test_split_into_font_runs() {
        // Pure EN
        let runs = split_into_font_runs("Hello world");
        assert_eq!(runs.len(), 1);
        assert!(runs[0].1); // is_en

        // Pure JP
        let runs = split_into_font_runs("日本語テスト");
        assert_eq!(runs.len(), 1);
        assert!(!runs[0].1); // is_jp

        // Mixed
        let runs = split_into_font_runs("これは test です");
        assert_eq!(runs.len(), 3);
        assert!(!runs[0].1); // JP: "これは "
        assert!(runs[1].1);  // EN: "test "
        assert!(!runs[2].1); // JP: "です"
    }

    #[test]
    fn test_clean_for_pdf() {
        // Soft hyphen removed
        assert_eq!(clean_for_pdf("hel\u{00AD}lo"), "hello");
        // Zero-width space removed
        assert_eq!(clean_for_pdf("hel\u{200B}lo"), "hello");
        // Non-breaking space → regular space
        assert_eq!(clean_for_pdf("hello\u{00A0}world"), "hello world");
        // BOM removed
        assert_eq!(clean_for_pdf("\u{FEFF}title"), "title");
        // Replacement character removed
        assert_eq!(clean_for_pdf("bad\u{FFFD}char"), "badchar");
        // Multiple spaces normalized
        assert_eq!(clean_for_pdf("hello   world"), "hello world");
        // Tabs normalized to space
        assert_eq!(clean_for_pdf("hello\t\tworld"), "hello world");
        // Leading/trailing whitespace trimmed
        assert_eq!(clean_for_pdf("  hello  "), "hello");
        // Normal text unchanged
        assert_eq!(clean_for_pdf("Hello, World!"), "Hello, World!");
        // BibTeX special chars preserved
        assert_eq!(clean_for_pdf("{\\LaTeX} $x^2$ 100%"), "{\\LaTeX} $x^2$ 100%");
        // CJK preserved
        assert_eq!(clean_for_pdf("日本語テスト"), "日本語テスト");
        // En-dash preserved
        assert_eq!(clean_for_pdf("377\u{2013}384"), "377\u{2013}384");
    }
}

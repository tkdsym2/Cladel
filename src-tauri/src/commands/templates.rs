//! Built-in document templates and samples.
//!
//! * `acm.typ` — an ACM-style (CHI / UIST) Typst template, written into every
//!   Typst compile work dir so any Note can `#import "acm.typ": acm`.
//! * `open_template_as_new` — builds a ready-made document (notes, images,
//!   table, papers, render + export nodes) in a new untitled tab.
//!
//! Documents are generated from the text sources in `src-tauri/templates/`
//! rather than shipped as binary `.flnx` files, so they always match the
//! current schema.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager, State};

use crate::db::{initialize_schema, Database, TabInfo};

/// The ACM-style Typst template (importable from notes as `"acm.typ"`).
const ACM_TEMPLATE: &str = include_str!("../../templates/acm.typ");
const ACM_SKELETON: &str = include_str!("../../templates/acm-skeleton.typ");

const SAMPLE_FRONT: &str = include_str!("../../templates/chi-uist-sample/front.typ");
const SAMPLE_BODY: &str = include_str!("../../templates/chi-uist-sample/body.typ");
const SAMPLE_PAPERS: &str = include_str!("../../templates/chi-uist-sample/papers.bib");
const SAMPLE_TABLE: &str = include_str!("../../templates/chi-uist-sample/table.json");
const SAMPLE_FIG_OVERVIEW: &[u8] = include_bytes!("../../templates/chi-uist-sample/fig_overview.png");
const SAMPLE_FIG_RESULTS: &[u8] = include_bytes!("../../templates/chi-uist-sample/fig_results.png");

/// Write the bundled Typst template files into a compile work dir (the
/// file-resolver root), making `#import "acm.typ": acm` work in any Note.
pub(crate) fn write_bundled_templates(work_dir: &Path) -> Result<(), String> {
    std::fs::write(work_dir.join("acm.typ"), ACM_TEMPLATE)
        .map_err(|e| format!("Failed to write template file: {e}"))
}

struct Builder<'a> {
    conn: &'a Connection,
    layer_id: String,
    now: String,
}

struct NodeSpec<'a> {
    node_type: &'a str,
    display_id: &'a str,
    title: &'a str,
    content: Option<&'a str>,
    bibtex: Option<&'a str>,
    metadata: Option<String>,
    pos: (f64, f64),
    size: (f64, f64),
}

impl<'a> Builder<'a> {
    /// Create the project, layer 1 and its Core node.
    fn new(conn: &'a Connection, project_name: &str, core_content: &str) -> Result<Self, String> {
        let now = chrono::Utc::now().to_rfc3339();
        let project_id = uuid::Uuid::new_v4().to_string();
        let layer_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![project_id, project_name, now],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO layers (id, project_id, layer_number, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)",
            params![layer_id, project_id, now],
        )
        .map_err(|e| e.to_string())?;
        let b = Builder { conn, layer_id, now };
        Ok(b)
            .and_then(|b: Builder| {
                b.node(NodeSpec {
                    node_type: "core",
                    display_id: "Core1",
                    title: "Core",
                    content: Some(core_content),
                    bibtex: None,
                    metadata: None,
                    pos: (0.0, 0.0),
                    size: (280.0, 210.0),
                })?;
                Ok(b)
            })
    }

    fn node(&self, s: NodeSpec) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.conn
            .execute(
                "INSERT INTO nodes (id, layer_id, node_type, title, content, bibtex, metadata, display_id, position_x, position_y, width, height, status, created_by, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', 'user', ?13, ?13)",
                params![
                    id, self.layer_id, s.node_type, s.title, s.content, s.bibtex, s.metadata,
                    s.display_id, s.pos.0, s.pos.1, s.size.0, s.size.1, self.now
                ],
            )
            .map_err(|e| format!("Failed to create {} node: {e}", s.node_type))?;
        Ok(id)
    }

    fn edge(&self, source: &str, target: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO edges (id, layer_id, source_node_id, target_node_id, source_handle, target_handle, weight, comment, created_by, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'right', 'left-target', 3, '', 'user', ?5, ?5)",
                params![uuid::Uuid::new_v4().to_string(), self.layer_id, source, target, self.now],
            )
            .map_err(|e| format!("Failed to create edge: {e}"))?;
        Ok(())
    }

    fn note(&self, display_id: &str, title: &str, content: &str, pos: (f64, f64)) -> Result<String, String> {
        self.node(NodeSpec {
            node_type: "user_doc",
            display_id,
            title,
            content: Some(content),
            bibtex: None,
            metadata: None,
            pos,
            size: (280.0, 210.0),
        })
    }

    /// Render + export node pair (ACM reference style); returns the render node id.
    fn render_and_export(&self, export_title: &str, pos: (f64, f64)) -> Result<String, String> {
        let render = self.node(NodeSpec {
            node_type: "render",
            display_id: "render_1",
            title: "Render",
            content: None,
            bibtex: None,
            metadata: Some(serde_json::json!({ "kind": "render", "citation_style": "acm" }).to_string()),
            pos,
            size: (300.0, 360.0),
        })?;
        let export = self.node(NodeSpec {
            node_type: "export",
            display_id: "export_1",
            title: export_title,
            content: None,
            bibtex: None,
            metadata: Some(serde_json::json!({ "citation_style": "acm" }).to_string()),
            pos: (pos.0 + 400.0, pos.1 + 75.0),
            size: (280.0, 210.0),
        })?;
        self.edge(&render, &export)?;
        Ok(render)
    }

    /// Image node referencing `file` (already on disk).
    fn image(&self, display_id: &str, caption: &str, file: &Path, pos: (f64, f64)) -> Result<String, String> {
        let path = file.to_string_lossy().to_string();
        let id = self.node(NodeSpec {
            node_type: "image",
            display_id,
            title: caption,
            content: None,
            bibtex: None,
            metadata: Some(serde_json::json!({ "file_path": path, "description": "" }).to_string()),
            pos,
            size: (280.0, 210.0),
        })?;
        let (w, h) = image::image_dimensions(file).map_err(|e| format!("Failed to read sample image: {e}"))?;
        let name = file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        self.conn
            .execute(
                "INSERT INTO node_images (id, node_id, file_path, mime_type, original_filename, image_width, image_height, created_at)
                 VALUES (?1, ?2, ?3, 'image/png', ?4, ?5, ?6, ?7)",
                params![uuid::Uuid::new_v4().to_string(), id, path, name, w, h, self.now],
            )
            .map_err(|e| format!("Failed to create image record: {e}"))?;
        Ok(id)
    }
}

/// Blank CHI/UIST paper: one Note with the template skeleton → render → export.
fn build_acm_blank(conn: &Connection, single_column: bool) -> Result<(), String> {
    let skeleton = if single_column {
        ACM_SKELETON
            .replace("format: \"double\",", "format: \"single\",")
            .replace("// review: true, ", "review: true,    ")
    } else {
        ACM_SKELETON.to_string()
    };
    let b = Builder::new(
        conn,
        "My Research",
        "# Research Question\n\nDescribe your central research question here.\n\nThe Note on the right holds a CHI / UIST (ACM) paper skeleton. Select the Render node to preview the PDF.",
    )?;
    let note = b.note("note_1", "Paper", &skeleton, (420.0, 0.0))?;
    let render = b.render_and_export("Paper", (820.0, -75.0))?;
    b.edge(&note, &render)?;
    Ok(())
}

/// Two-page, two-column CHI/UIST sample with figures, a table, math and references.
/// `assets_dir` receives the sample images (image nodes reference files by path).
fn build_chi_uist_sample(conn: &Connection, assets_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(assets_dir).map_err(|e| format!("Cannot create sample asset dir: {e}"))?;
    let fig_overview = assets_dir.join("fig_overview.png");
    let fig_results = assets_dir.join("fig_results.png");
    std::fs::write(&fig_overview, SAMPLE_FIG_OVERVIEW).map_err(|e| format!("Cannot write sample image: {e}"))?;
    std::fs::write(&fig_results, SAMPLE_FIG_RESULTS).map_err(|e| format!("Cannot write sample image: {e}"))?;

    let b = Builder::new(
        conn,
        "CHI / UIST Sample",
        "# CHI / UIST sample paper\n\nA two-page, two-column paper in the ACM conference style.\n\n- **note_1**: template setup (title, authors, abstract, teaser figure)\n- **note_2**: body text with citations, a table, a figure and an equation\n- **render_1**: select it to see the rendered PDF\n\nSet `format: \"single\"` in note_1 for the single-column review layout.",
    )?;
    let core: String = conn
        .query_row("SELECT id FROM nodes WHERE node_type = 'core'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    conn.execute("UPDATE nodes SET position_x = 40, position_y = -620 WHERE id = ?1", [&core])
        .map_err(|e| e.to_string())?;

    let front = b.note("note_1", "Front matter (template setup)", SAMPLE_FRONT, (460.0, -330.0))?;
    let body = b.note("note_2", "Body", SAMPLE_BODY, (460.0, 60.0))?;
    b.edge(&core, &front)?;

    let image_1 = b.image("image_1", "ThoughtWeave workflow", &fig_overview, (40.0, -330.0))?;
    let image_2 = b.image("image_2", "NASA-TLX subscale scores by condition", &fig_results, (40.0, -40.0))?;
    b.edge(&image_1, &front)?;
    b.edge(&image_2, &body)?;

    let rows: serde_json::Value = serde_json::from_str(SAMPLE_TABLE).map_err(|e| e.to_string())?;
    let table = b.node(NodeSpec {
        node_type: "table",
        display_id: "table_1",
        title: "Study results",
        content: None,
        bibtex: None,
        metadata: Some(
            serde_json::json!({ "kind": "table", "mode": "manual", "rows": rows, "source": null }).to_string(),
        ),
        pos: (40.0, 250.0),
        size: (340.0, 240.0),
    })?;
    b.edge(&table, &body)?;

    // Papers: two columns to the left of the notes.
    let entries = super::bibtex::parse_bibtex(SAMPLE_PAPERS.to_string())?;
    for (i, entry) in entries.iter().enumerate() {
        let venue = entry.journal.clone().or_else(|| entry.booktitle.clone());
        let metadata = serde_json::json!({ "authors": entry.authors, "journal": venue, "year": entry.year });
        let pos = (-680.0 + 340.0 * (i % 2) as f64, -330.0 + 250.0 * (i / 2) as f64);
        let paper = b.node(NodeSpec {
            node_type: "paper",
            display_id: &entry.cite_key,
            title: &entry.title,
            content: None,
            bibtex: Some(entry.raw.trim()),
            metadata: Some(metadata.to_string()),
            pos,
            size: (280.0, 210.0),
        })?;
        b.edge(&paper, &body)?;
    }

    let render = b.render_and_export("ThoughtWeave sample paper", (880.0, -210.0))?;
    b.edge(&front, &render)?;
    b.edge(&body, &render)?;
    Ok(())
}

fn build_template(conn: &Connection, template_id: &str, assets_root: &Path) -> Result<&'static str, String> {
    match template_id {
        "chi-uist-sample" => {
            build_chi_uist_sample(conn, &assets_root.join("chi-uist-sample"))?;
            Ok("chi-uist-sample")
        }
        "acm-double" => {
            build_acm_blank(conn, false)?;
            Ok("acm-two-column")
        }
        "acm-single" => {
            build_acm_blank(conn, true)?;
            Ok("acm-single-column")
        }
        other => Err(format!("Unknown template: {other}")),
    }
}

/// Where sample images live (image nodes reference files by absolute path, so
/// this must outlive the tab — unlike the temp working copies).
fn assets_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("templates"))
}

/// Open a built-in template / sample as a NEW untitled tab (first save is
/// "Save As", like `open_sample_as_new`).
#[tauri::command]
pub fn open_template_as_new(
    app: AppHandle,
    db: State<Database>,
    template_id: String,
) -> Result<TabInfo, String> {
    // Build the document first, so a failure leaves the current tab untouched.
    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    initialize_schema(&conn).map_err(|e| e.to_string())?;
    let display_name = build_template(&conn, &template_id, &assets_root(&app)?)?;

    super::tab_commands::register_new_tab(&db, conn, display_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{typst_engine, typst_render};

    /// Compile the notes connected to `render_1` exactly like the render node does.
    fn render_pages(conn: &Connection, tag: &str) -> Vec<Vec<u8>> {
        let (render_id, layer_id): (String, String) = conn
            .query_row("SELECT id, layer_id FROM nodes WHERE node_type = 'render'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        let work = std::env::temp_dir().join(format!("filonex-template-test-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&work).unwrap();
        let notes = typst_render::connected_notes(conn, &render_id).unwrap();
        let all = typst_render::all_active_nodes(conn, &layer_id).unwrap();
        let source = typst_render::assemble_typst_source(conn, &all, &notes, &work, "acm").unwrap();
        let pages = typst_engine::compile_to_pngs(source, Some(&work), 2.0).expect("template compiles");
        // FILONEX_TEMPLATE_OUT=<dir> keeps the pages for visual inspection.
        if let Ok(out) = std::env::var("FILONEX_TEMPLATE_OUT") {
            std::fs::create_dir_all(&out).unwrap();
            for (i, p) in pages.iter().enumerate() {
                std::fs::write(Path::new(&out).join(format!("{tag}-{}.png", i + 1)), p).unwrap();
            }
        }
        let _ = std::fs::remove_dir_all(&work);
        pages
    }

    fn build(template_id: &str) -> (Connection, PathBuf) {
        let conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();
        let assets = std::env::temp_dir().join(format!("filonex-template-assets-{}", uuid::Uuid::new_v4()));
        build_template(&conn, template_id, &assets).unwrap();
        (conn, assets)
    }

    #[test]
    fn chi_uist_sample_renders_two_pages() {
        let (conn, assets) = build("chi-uist-sample");
        let papers: i64 = conn
            .query_row("SELECT COUNT(*) FROM nodes WHERE node_type = 'paper'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(papers, 9);
        let pages = render_pages(&conn, "sample-double");
        assert_eq!(pages.len(), 2, "the sample must fill exactly two pages");

        // The same notes in the single-column manuscript layout still compile.
        conn.execute(
            "UPDATE nodes SET content = REPLACE(content, 'format: \"double\"', 'format: \"single\", review: true') WHERE display_id = 'note_1'",
            [],
        )
        .unwrap();
        assert!(render_pages(&conn, "sample-single").len() >= 2);
        let _ = std::fs::remove_dir_all(assets);
    }

    #[test]
    fn blank_templates_compile() {
        for id in ["acm-double", "acm-single"] {
            let (conn, assets) = build(id);
            assert_eq!(render_pages(&conn, id).len(), 1, "{id}");
            let _ = std::fs::remove_dir_all(assets);
        }
        let conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();
        assert!(build_template(&conn, "nope", Path::new("/nonexistent")).is_err());
    }
}

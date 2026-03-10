use crate::commands::nodes::get_next_display_id;
use crate::db::Database;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, State};

// ─── Public types ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageFileInfo {
    pub file_path: String,
    pub mime_type: String,
    pub original_filename: String,
    pub image_width: Option<u32>,
    pub image_height: Option<u32>,
    pub node_id: Option<String>,
}

// ─── MIME type detection by extension ───

fn detect_mime_type(file_path: &str) -> Result<String, String> {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or("File has no extension")?;

    match ext.as_str() {
        "png" => Ok("image/png".to_string()),
        "jpg" | "jpeg" => Ok("image/jpeg".to_string()),
        "svg" => Ok("image/svg+xml".to_string()),
        "gif" => Ok("image/gif".to_string()),
        "webp" => Ok("image/webp".to_string()),
        "bmp" => Ok("image/bmp".to_string()),
        "tif" | "tiff" => Ok("image/tiff".to_string()),
        "ico" => Ok("image/x-icon".to_string()),
        _ => Err(format!("Unsupported image format: .{ext}")),
    }
}

// ─── Image dimension reading ───

fn read_image_dimensions(file_path: &str, mime_type: &str) -> (Option<u32>, Option<u32>) {
    // Skip dimension reading for SVG and ICO (not raster, or unreliable)
    if mime_type == "image/svg+xml" || mime_type == "image/x-icon" {
        return (None, None);
    }

    match image::image_dimensions(file_path) {
        Ok((w, h)) => (Some(w), Some(h)),
        Err(e) => {
            eprintln!("[image_import] Failed to read dimensions for {file_path}: {e}");
            (None, None)
        }
    }
}

// ─── Tauri commands ───

#[tauri::command]
pub fn validate_image_file(file_path: String) -> Result<ImageFileInfo, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }
    if !path.is_file() {
        return Err(format!("Not a file: {file_path}"));
    }

    let mime_type = detect_mime_type(&file_path)?;

    let original_filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let (image_width, image_height) = read_image_dimensions(&file_path, &mime_type);

    Ok(ImageFileInfo {
        file_path,
        mime_type,
        original_filename,
        image_width,
        image_height,
        node_id: None,
    })
}

#[tauri::command]
pub fn create_image_node(
    db: State<Database>,
    layer_id: String,
    title: String,
    description: Option<String>,
    position_x: f64,
    position_y: f64,
    node_width: Option<f64>,
    node_height: Option<f64>,
    file_path: String,
    mime_type: String,
    original_filename: String,
    image_width: Option<u32>,
    image_height: Option<u32>,
    creator_user_id: Option<String>,
    creator_user_name: Option<String>,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let node_id = uuid::Uuid::new_v4().to_string();
    let image_record_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let display_id = get_next_display_id(&conn, "image")?;

    // Build metadata JSON with file_path and description
    let desc_str = description.clone().unwrap_or_default();
    let metadata = serde_json::json!({
        "file_path": file_path,
        "description": desc_str,
    });

    // Create the node
    conn.execute(
        "INSERT INTO nodes (id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name)
         VALUES (?1, ?2, 'image', ?3, ?4, NULL, ?5, NULL, ?6, ?7, ?8, 'active', 'user', ?9, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            node_id,
            layer_id,
            title,
            description,
            metadata.to_string(),
            display_id,
            position_x,
            position_y,
            now,
            node_width,
            node_height,
            creator_user_id,
            creator_user_name,
        ],
    )
    .map_err(|e| format!("Failed to create image node: {e}"))?;

    // Create the node_images record
    conn.execute(
        "INSERT INTO node_images (id, node_id, file_path, mime_type, original_filename, image_width, image_height, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            image_record_id,
            node_id,
            file_path,
            mime_type,
            original_filename,
            image_width,
            image_height,
            now,
        ],
    )
    .map_err(|e| format!("Failed to create node_images record: {e}"))?;

    Ok(node_id)
}

#[tauri::command]
pub fn get_node_image_info(db: State<Database>, node_id: String) -> Result<ImageFileInfo, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT file_path, mime_type, original_filename, image_width, image_height FROM node_images WHERE node_id = ?1",
        [&node_id],
        |row| {
            Ok(ImageFileInfo {
                file_path: row.get(0)?,
                mime_type: row.get(1)?,
                original_filename: row.get(2)?,
                image_width: row.get(3)?,
                image_height: row.get(4)?,
                node_id: Some(node_id.clone()),
            })
        },
    )
    .map_err(|e| format!("Image info not found for node {node_id}: {e}"))
}

#[tauri::command]
pub fn check_file_exists(file_path: String) -> Result<bool, String> {
    Ok(Path::new(&file_path).exists())
}

#[tauri::command]
pub fn update_node_image_path(
    db: State<Database>,
    node_id: String,
    new_file_path: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Update file_path in node_images
    let rows = conn
        .execute(
            "UPDATE node_images SET file_path = ?1 WHERE node_id = ?2",
            rusqlite::params![new_file_path, node_id],
        )
        .map_err(|e| format!("Failed to update image path: {e}"))?;

    if rows == 0 {
        return Err(format!("No image record found for node {node_id}"));
    }

    // Also update metadata JSON on the node
    let current_metadata: Option<String> = conn
        .query_row(
            "SELECT metadata FROM nodes WHERE id = ?1",
            [&node_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Node not found: {e}"))?;

    let mut meta: serde_json::Value = current_metadata
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::json!({}));

    if let Some(obj) = meta.as_object_mut() {
        obj.insert(
            "file_path".to_string(),
            serde_json::Value::String(new_file_path),
        );
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE nodes SET metadata = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![meta.to_string(), now, node_id],
    )
    .map_err(|e| format!("Failed to update node metadata: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn open_file_external(app: AppHandle, file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }

    // Use platform-conditional commands to open files with the system default application.
    // tauri_plugin_shell::ShellExt::open() is designed for URLs, not local file paths,
    // so we use std::process::Command with the correct OS-specific opener.
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        std::process::Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        let _ = app;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        let _ = app;
        std::process::Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {e}"))?;
    }

    Ok(())
}

// ─── Paper PDF path commands ───

#[tauri::command]
pub fn set_paper_pdf_path(
    db: State<Database>,
    node_id: String,
    pdf_path: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let rows = conn
        .execute(
            "UPDATE nodes SET pdf_path = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![pdf_path, now, node_id],
        )
        .map_err(|e| format!("Failed to set pdf_path: {e}"))?;

    if rows == 0 {
        return Err(format!("Node not found: {node_id}"));
    }

    Ok(())
}

#[tauri::command]
pub fn get_paper_pdf_path(db: State<Database>, node_id: String) -> Result<Option<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT pdf_path FROM nodes WHERE id = ?1",
        [&node_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .map_err(|e| format!("Node not found: {e}"))
}

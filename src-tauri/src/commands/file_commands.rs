use crate::db::{initialize_schema, Database};
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

fn tab_snapshot_dir() -> PathBuf {
    std::env::temp_dir().join("filonex-tabs")
}

fn active_tab_snapshot_path(db: &Database) -> Result<PathBuf, String> {
    let active_id = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    let snap_dir = tab_snapshot_dir();
    std::fs::create_dir_all(&snap_dir).map_err(|e| format!("Cannot create snapshot dir: {e}"))?;
    Ok(snap_dir.join(format!("{active_id}.flnx")))
}

fn vacuum_into(conn: &Connection, target_path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create directory: {e}"))?;
    }
    if target_path.exists() {
        std::fs::remove_file(target_path).map_err(|e| format!("Cannot replace temp file: {e}"))?;
    }
    let escaped = target_path.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{}';", escaped))
        .map_err(|e| format!("Failed to write database: {e}"))
}

fn save_connection_to_path(conn: &Connection, target_path: &PathBuf) -> Result<(), String> {
    let tmp_path = target_path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    vacuum_into(conn, &tmp_path)?;

    // `rename` atomically replaces an existing target (Unix and Windows), so the
    // old file must NOT be removed first: a crash in between would leave no
    // document at all. On failure the old file is intact; drop the sidecar.
    if let Err(e) = std::fs::rename(&tmp_path, target_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("Failed to move saved file into place: {e}"));
    }
    Ok(())
}

fn open_working_copy_for_path(
    path: &PathBuf,
    snapshot_path: &PathBuf,
) -> Result<Connection, String> {
    if snapshot_path.exists() {
        std::fs::remove_file(snapshot_path)
            .map_err(|e| format!("Cannot replace working copy: {e}"))?;
    }
    std::fs::copy(path, snapshot_path)
        .map_err(|e| format!("Failed to create working copy: {e}"))?;
    let conn = Connection::open(snapshot_path)
        .map_err(|e| format!("Cannot open working copy as database: {e}"))?;
    validate_and_initialize(&conn)
        .map_err(|e| format!("File is not a valid Filonex document: {e}"))?;
    Ok(conn)
}

fn validate_and_initialize(conn: &Connection) -> Result<(), String> {
    let has_projects: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='projects'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|count| count > 0)
        .map_err(|e| format!("missing schema: {e}"))?;

    if !has_projects {
        return Err("missing projects table".to_string());
    }

    initialize_schema(conn).map_err(|e| format!("Schema migration failed: {e}"))
}

/// Create a new empty .flnx document.
/// Swaps to a fresh in-memory DB with full schema applied.
#[tauri::command]
pub fn file_new(db: State<Database>) -> Result<(), String> {
    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    initialize_schema(&conn).map_err(|e| e.to_string())?;
    db.swap_connection(conn, None)?;
    Ok(())
}

/// Open an existing .flnx file into a temp working copy.
/// The original file is not modified until Save/Save As.
#[tauri::command]
pub fn file_open(db: State<Database>, path: String) -> Result<(), String> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let snapshot_path = active_tab_snapshot_path(&db)?;
    let conn = open_working_copy_for_path(&file_path, &snapshot_path)?;

    db.swap_connection(conn, Some(file_path))?;
    let active_id = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
    if let Some(tab) = tabs.iter_mut().find(|t| t.id == active_id) {
        tab.snapshot_path = Some(snapshot_path.to_string_lossy().to_string());
    }
    Ok(())
}

/// Save current document to its current path.
/// Writes the active temp working copy back to the real file.
/// Returns error if no file path is set (frontend should use Save As).
#[tauri::command]
pub fn file_save(db: State<Database>) -> Result<(), String> {
    let current_path = db.get_current_path()?;

    match current_path {
        Some(path) => {
            {
                let conn = db.conn.lock().map_err(|e| e.to_string())?;
                save_connection_to_path(&conn, &path)?;
            }
            let active_id = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
            let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
            if let Some(tab) = tabs.iter_mut().find(|t| t.id == active_id) {
                tab.is_dirty = false;
            }
            Ok(())
        }
        None => Err("No file path set. Use Save As to choose a location.".to_string()),
    }
}

/// Save current document to a new path, then continue editing a temp working copy.
#[tauri::command]
pub fn file_save_as(db: State<Database>, path: String) -> Result<(), String> {
    let target_path = PathBuf::from(&path);

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        save_connection_to_path(&conn, &target_path)?;
    }

    let snapshot_path = active_tab_snapshot_path(&db)?;
    let new_conn = open_working_copy_for_path(&target_path, &snapshot_path)?;

    let display_name = target_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());
    db.swap_connection(new_conn, Some(target_path))?;
    let active_id = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
    if let Some(tab) = tabs.iter_mut().find(|t| t.id == active_id) {
        tab.snapshot_path = Some(snapshot_path.to_string_lossy().to_string());
        // The tab itself records the save, so it stays correct even if the
        // frontend's follow-up `update_tab_after_save` never arrives.
        tab.file_path = Some(path);
        tab.display_name = display_name;
        tab.is_dirty = false;
    }
    Ok(())
}

/// Return the current file path, or null if unsaved / in-memory.
#[tauri::command]
pub fn file_get_current_path(db: State<Database>) -> Result<Option<String>, String> {
    let path = db.get_current_path()?;
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

/// Locate the bundled sample.flnx file.
/// Checks the Tauri resource dir (production) first, then falls back to the
/// source tree relative to CARGO_MANIFEST_DIR (dev mode).
pub(crate) fn find_bundled_sample(app: &AppHandle) -> Result<PathBuf, String> {
    // Production: bundled resource
    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join("sample.flnx");
        if path.exists() {
            return Ok(path);
        }
    }

    // Dev mode: relative to src-tauri/
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sample/sample.flnx");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err("Bundled sample file not found".to_string())
}

// NOTE: The sample is now opened as a read-only TEMPLATE (see
// `tab_commands::open_sample_as_new`): its content is loaded into a new untitled
// tab so the first save becomes "Save As". The built-in sample is never
// overwritten, so the old writable app-data cache (ensure/restore_sample_file)
// has been removed.

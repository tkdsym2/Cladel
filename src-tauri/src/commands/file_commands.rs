use crate::db::{initialize_schema, Database};
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

fn tab_snapshot_dir() -> PathBuf {
    std::env::temp_dir().join("cladel-tabs")
}

fn active_tab_snapshot_path(db: &Database) -> Result<PathBuf, String> {
    let active_id = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    let snap_dir = tab_snapshot_dir();
    std::fs::create_dir_all(&snap_dir).map_err(|e| format!("Cannot create snapshot dir: {e}"))?;
    Ok(snap_dir.join(format!("{active_id}.cld")))
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

    if target_path.exists() {
        std::fs::remove_file(target_path)
            .map_err(|e| format!("Cannot overwrite existing file: {e}"))?;
    }
    std::fs::rename(&tmp_path, target_path)
        .map_err(|e| format!("Failed to move saved file into place: {e}"))?;
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
        .map_err(|e| format!("File is not a valid Cladel document: {e}"))?;
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

/// Create a new empty .cld document.
/// Swaps to a fresh in-memory DB with full schema applied.
#[tauri::command]
pub fn file_new(db: State<Database>) -> Result<(), String> {
    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    initialize_schema(&conn).map_err(|e| e.to_string())?;
    db.swap_connection(conn, None)?;
    Ok(())
}

/// Open an existing .cld, .klv, or .tmgx file into a temp working copy.
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
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            save_connection_to_path(&conn, &path)
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

    db.swap_connection(new_conn, Some(target_path))?;
    let active_id = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
    if let Some(tab) = tabs.iter_mut().find(|t| t.id == active_id) {
        tab.snapshot_path = Some(snapshot_path.to_string_lossy().to_string());
    }
    Ok(())
}

/// Return the current file path, or null if unsaved / in-memory.
#[tauri::command]
pub fn file_get_current_path(db: State<Database>) -> Result<Option<String>, String> {
    let path = db.get_current_path()?;
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

/// Locate the bundled sample.cld file.
/// Checks the Tauri resource dir (production) first, then falls back to the
/// source tree relative to CARGO_MANIFEST_DIR (dev mode).
fn find_bundled_sample(app: &AppHandle) -> Result<PathBuf, String> {
    // Production: bundled resource
    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join("sample.cld");
        if path.exists() {
            return Ok(path);
        }
    }

    // Dev mode: relative to src-tauri/
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sample/sample.cld");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err("Bundled sample file not found".to_string())
}

/// Ensure the sample file exists in the app data directory.
/// Copies the bundled sample.cld to the user's data dir if it doesn't exist yet.
/// Returns the path to the working copy.
#[tauri::command]
pub fn ensure_sample_file(app: AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {e}"))?;

    let sample_path = data_dir.join("sample.cld");

    if !sample_path.exists() {
        let resource_path = find_bundled_sample(&app)?;
        std::fs::copy(&resource_path, &sample_path)
            .map_err(|e| format!("Failed to copy sample file: {e}"))?;
    }

    Ok(sample_path.to_string_lossy().to_string())
}

/// Restore the sample file to its initial state.
/// Overwrites the user's working copy with the bundled original.
/// The caller must ensure the file is not currently open (close the tab first).
/// Returns the path to the restored file.
#[tauri::command]
pub fn restore_sample_file(app: AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {e}"))?;

    let sample_path = data_dir.join("sample.cld");
    let resource_path = find_bundled_sample(&app)?;

    std::fs::copy(&resource_path, &sample_path)
        .map_err(|e| format!("Failed to restore sample file: {e}"))?;

    Ok(sample_path.to_string_lossy().to_string())
}

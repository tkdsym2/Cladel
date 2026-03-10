use crate::db::{initialize_schema, Database};
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

/// Create a new empty .cld document.
/// Swaps to a fresh in-memory DB with full schema applied.
#[tauri::command]
pub fn file_new(db: State<Database>) -> Result<(), String> {
    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    initialize_schema(&conn).map_err(|e| e.to_string())?;
    db.swap_connection(conn, None)?;
    Ok(())
}

/// Open an existing .cld, .klv, or .tmgx file.
/// Validates it is a valid SQLite database with the Cladel schema,
/// runs migrations for forward compatibility, then swaps the connection.
#[tauri::command]
pub fn file_open(db: State<Database>, path: String) -> Result<(), String> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    // Attempt to open as SQLite
    let conn =
        Connection::open(&file_path).map_err(|e| format!("Cannot open file as database: {}", e))?;

    // Validate: check that at least the 'projects' table exists
    let has_projects: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='projects'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|count| count > 0)
        .map_err(|e| format!("File is not a valid Cladel document: {}", e))?;

    if !has_projects {
        return Err("File is not a valid Cladel document (missing schema).".to_string());
    }

    // Run migrations to handle older schema versions
    initialize_schema(&conn).map_err(|e| format!("Schema migration failed: {}", e))?;

    db.swap_connection(conn, Some(file_path))?;
    Ok(())
}

/// Save current document to its current path.
/// In DELETE journal mode all writes are already committed to the main file,
/// so this is essentially a consistency check that a path exists.
/// Returns error if no file path is set (frontend should use Save As).
#[tauri::command]
pub fn file_save(db: State<Database>) -> Result<(), String> {
    let current_path = db.get_current_path()?;

    match current_path {
        Some(_) => Ok(()),
        None => Err("No file path set. Use Save As to choose a location.".to_string()),
    }
}

/// Save current document to a new path using VACUUM INTO,
/// then reopen the connection at the new location.
#[tauri::command]
pub fn file_save_as(db: State<Database>, path: String) -> Result<(), String> {
    let target_path = PathBuf::from(&path);

    // Ensure parent directory exists
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create directory: {}", e))?;
    }

    // Remove target if it already exists (VACUUM INTO fails on existing files)
    if target_path.exists() {
        std::fs::remove_file(&target_path)
            .map_err(|e| format!("Cannot overwrite existing file: {}", e))?;
    }

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        // Escape single quotes in path for SQL safety
        let escaped = target_path.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{}';", escaped))
            .map_err(|e| format!("Failed to save file: {}", e))?;
    }

    // Reopen at the new path
    let new_conn = Connection::open(&target_path)
        .map_err(|e| format!("Failed to reopen saved file: {}", e))?;
    new_conn
        .execute_batch("PRAGMA journal_mode=DELETE;")
        .map_err(|e| e.to_string())?;
    new_conn
        .execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;

    db.swap_connection(new_conn, Some(target_path))?;
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
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../sample/sample.cld");
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
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {e}"))?;

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
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {e}"))?;

    let sample_path = data_dir.join("sample.cld");
    let resource_path = find_bundled_sample(&app)?;

    std::fs::copy(&resource_path, &sample_path)
        .map_err(|e| format!("Failed to restore sample file: {e}"))?;

    Ok(sample_path.to_string_lossy().to_string())
}

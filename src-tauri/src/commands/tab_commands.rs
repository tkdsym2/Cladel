use crate::db::{initialize_schema, Database, TabInfo};
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Get the temp directory for tab snapshots.
fn tab_snapshot_dir() -> PathBuf {
    std::env::temp_dir().join("cladel-tabs")
}

fn tab_snapshot_path(tab_id: &str) -> Result<PathBuf, String> {
    let snap_dir = tab_snapshot_dir();
    std::fs::create_dir_all(&snap_dir).map_err(|e| format!("Cannot create snapshot dir: {e}"))?;
    Ok(snap_dir.join(format!("{tab_id}.cld")))
}

fn validate_and_initialize(conn: &Connection) -> Result<(), String> {
    let has_projects: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='projects'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .map(|count| count > 0)
        .map_err(|e| format!("File is not a valid Cladel document: {e}"))?;
    if !has_projects {
        return Err("File is not a valid Cladel document (missing schema).".to_string());
    }
    initialize_schema(conn).map_err(|e| format!("Schema migration failed: {e}"))
}

fn open_snapshot_connection(path: &PathBuf) -> Result<Connection, String> {
    let conn =
        Connection::open(path).map_err(|e| format!("Failed to open tab working copy: {e}"))?;
    validate_and_initialize(&conn)?;
    Ok(conn)
}

fn create_working_copy(source_path: &PathBuf, tab_id: &str) -> Result<PathBuf, String> {
    let snap_path = tab_snapshot_path(tab_id)?;
    if snap_path.exists() {
        std::fs::remove_file(&snap_path)
            .map_err(|e| format!("Cannot replace tab working copy: {e}"))?;
    }
    std::fs::copy(source_path, &snap_path)
        .map_err(|e| format!("Failed to create tab working copy: {e}"))?;
    Ok(snap_path)
}

/// Return all tab metadata for UI.
#[tauri::command]
pub fn get_tabs(db: State<Database>) -> Result<Vec<TabInfo>, String> {
    let tabs = db.tabs.lock().map_err(|e| e.to_string())?;
    Ok(tabs.clone())
}

/// Return the active tab ID.
#[tauri::command]
pub fn get_active_tab_id(db: State<Database>) -> Result<String, String> {
    let id = db.active_tab_id.lock().map_err(|e| e.to_string())?;
    Ok(id.clone())
}

/// Create a new empty tab (in-memory DB) and switch to it.
#[tauri::command]
pub fn create_tab(db: State<Database>) -> Result<TabInfo, String> {
    // 1. Snapshot current tab
    snapshot_current_tab_inner(&db)?;

    // 2. Create fresh in-memory DB
    let new_conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    initialize_schema(&new_conn).map_err(|e| e.to_string())?;

    // 3. Create new tab info
    let new_tab = TabInfo {
        id: uuid::Uuid::new_v4().to_string(),
        file_path: None,
        snapshot_path: None,
        display_name: "Untitled".to_string(),
        is_dirty: false,
    };

    // 4. Swap connection
    db.swap_connection(new_conn, None)?;

    // 5. Add tab and set active
    {
        let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
        tabs.push(new_tab.clone());
    }
    {
        let mut active = db.active_tab_id.lock().map_err(|e| e.to_string())?;
        *active = new_tab.id.clone();
    }

    Ok(new_tab)
}

/// Open a file in a new tab, or switch to existing tab if same path is already open.
#[tauri::command]
pub fn open_file_in_tab(db: State<Database>, path: String) -> Result<TabInfo, String> {
    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    // Check if any existing tab has the same file path — if so, just switch to it
    {
        let tabs = db.tabs.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = tabs.iter().find(|t| t.file_path.as_deref() == Some(&path)) {
            let tab_id = existing.id.clone();
            let tab_info = existing.clone();
            let active = db.active_tab_id.lock().map_err(|e| e.to_string())?;
            if *active == tab_id {
                return Ok(tab_info);
            }
            drop(tabs);
            drop(active);
            // Switch to existing tab
            switch_tab_inner(&db, &tab_id)?;
            return Ok(tab_info);
        }
    }

    // Snapshot current tab before switching
    snapshot_current_tab_inner(&db)?;

    let new_tab_id = uuid::Uuid::new_v4().to_string();
    let snapshot_path = create_working_copy(&file_path, &new_tab_id)?;
    let conn = open_snapshot_connection(&snapshot_path)?;

    // Extract display name from filename
    let display_name = file_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());

    let new_tab = TabInfo {
        id: new_tab_id,
        file_path: Some(path),
        snapshot_path: Some(snapshot_path.to_string_lossy().to_string()),
        display_name,
        is_dirty: false,
    };

    db.swap_connection(conn, Some(file_path))?;

    {
        let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
        tabs.push(new_tab.clone());
    }
    {
        let mut active = db.active_tab_id.lock().map_err(|e| e.to_string())?;
        *active = new_tab.id.clone();
    }

    Ok(new_tab)
}

/// Switch to a different tab by ID.
#[tauri::command]
pub fn switch_tab(db: State<Database>, tab_id: String) -> Result<(), String> {
    let current_active = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    if current_active == tab_id {
        return Ok(());
    }
    switch_tab_inner(&db, &tab_id)
}

/// Open the built-in sample as a NEW untitled tab (read-only template semantics).
///
/// The sample is loaded from the bundled resource into a fresh working copy, but
/// the tab has NO file path — so the first save becomes "Save As" and the
/// built-in sample is never overwritten. This replaces the old writable-cache
/// approach (ensure/restore_sample_file).
#[tauri::command]
pub fn open_sample_as_new(app: AppHandle, db: State<Database>) -> Result<TabInfo, String> {
    let sample_path = crate::commands::file_commands::find_bundled_sample(&app)?;

    // Persist the current tab's edits before switching away from it.
    snapshot_current_tab_inner(&db)?;

    let new_tab_id = uuid::Uuid::new_v4().to_string();
    let snapshot_path = create_working_copy(&sample_path, &new_tab_id)?;
    let conn = open_snapshot_connection(&snapshot_path)?;

    let new_tab = TabInfo {
        id: new_tab_id,
        file_path: None, // untitled → first save is "Save As"
        snapshot_path: Some(snapshot_path.to_string_lossy().to_string()),
        display_name: "sample".to_string(),
        is_dirty: false,
    };

    // No file path: the document is untitled, backed by the working copy.
    db.swap_connection(conn, None)?;

    {
        let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
        tabs.push(new_tab.clone());
    }
    {
        let mut active = db.active_tab_id.lock().map_err(|e| e.to_string())?;
        *active = new_tab.id.clone();
    }

    Ok(new_tab)
}

/// Close a tab. Returns the new active tab ID.
/// If closing the last tab, creates a fresh empty tab first.
#[tauri::command]
pub fn close_tab(db: State<Database>, tab_id: String) -> Result<String, String> {
    let active_id = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    let tabs_count = db.tabs.lock().map_err(|e| e.to_string())?.len();

    // If this is the last tab, create a new empty one first
    if tabs_count <= 1 {
        // Create a fresh empty tab
        let new_conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        initialize_schema(&new_conn).map_err(|e| e.to_string())?;

        let new_tab = TabInfo {
            id: uuid::Uuid::new_v4().to_string(),
            file_path: None,
            snapshot_path: None,
            display_name: "Untitled".to_string(),
            is_dirty: false,
        };

        db.swap_connection(new_conn, None)?;

        let new_id = new_tab.id.clone();
        {
            let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
            tabs.push(new_tab);
        }
        {
            let mut active = db.active_tab_id.lock().map_err(|e| e.to_string())?;
            *active = new_id.clone();
        }

        // Now remove the old tab
        cleanup_tab_snapshot(&db, &tab_id)?;
        {
            let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
            tabs.retain(|t| t.id != tab_id);
        }

        return Ok(new_id);
    }

    // Find the tab to close and determine the next active tab
    let next_active_id = {
        let tabs = db.tabs.lock().map_err(|e| e.to_string())?;
        if active_id == tab_id {
            // Need to switch to another tab
            let idx = tabs.iter().position(|t| t.id == tab_id).unwrap_or(0);
            if idx + 1 < tabs.len() {
                tabs[idx + 1].id.clone()
            } else if idx > 0 {
                tabs[idx - 1].id.clone()
            } else {
                // Shouldn't happen (already handled above)
                return Err("No tab to switch to".to_string());
            }
        } else {
            active_id.clone()
        }
    };

    // If closing the active tab, switch to the next one first
    if active_id == tab_id {
        switch_tab_inner(&db, &next_active_id)?;
    }

    // Clean up snapshot file if any
    cleanup_tab_snapshot(&db, &tab_id)?;

    // Remove the tab
    {
        let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
        tabs.retain(|t| t.id != tab_id);
    }

    Ok(next_active_id)
}

/// Discard the active tab's working copy and reload it from its real file path.
#[tauri::command]
pub fn reload_active_tab_from_disk(db: State<Database>) -> Result<(), String> {
    let active_id = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    let tab = {
        let tabs = db.tabs.lock().map_err(|e| e.to_string())?;
        tabs.iter()
            .find(|t| t.id == active_id)
            .cloned()
            .ok_or_else(|| "Active tab not found".to_string())?
    };

    let file_path = tab
        .file_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "Active tab has no file path".to_string())?;
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path.to_string_lossy()));
    }

    let snapshot_path = create_working_copy(&file_path, &active_id)?;
    let conn = open_snapshot_connection(&snapshot_path)?;
    db.swap_connection(conn, Some(file_path))?;

    let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
    if let Some(tab) = tabs.iter_mut().find(|t| t.id == active_id) {
        tab.snapshot_path = Some(snapshot_path.to_string_lossy().to_string());
        tab.is_dirty = false;
    }

    Ok(())
}

/// Update tab metadata after a save operation.
#[tauri::command]
pub fn update_tab_after_save(
    db: State<Database>,
    file_path: String,
    display_name: String,
    is_dirty: bool,
) -> Result<(), String> {
    let active_id = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;

    if let Some(tab) = tabs.iter_mut().find(|t| t.id == active_id) {
        tab.file_path = Some(file_path);
        tab.display_name = display_name;
        tab.is_dirty = is_dirty;
    }

    Ok(())
}

// ─── Internal helpers ───

/// Snapshot the current active tab's working DB.
fn snapshot_current_tab_inner(db: &Database) -> Result<(), String> {
    let active_id = db.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    let existing_snapshot = {
        let tabs = db.tabs.lock().map_err(|e| e.to_string())?;
        tabs.iter()
            .find(|t| t.id == active_id)
            .and_then(|t| t.snapshot_path.clone())
    };
    if let Some(snapshot) = existing_snapshot {
        if PathBuf::from(snapshot).exists() {
            // The active connection is already backed by this working-copy file,
            // so SQLite has committed changes there as they happened.
            return Ok(());
        }
    }

    let snap_path = tab_snapshot_path(&active_id)?;

    // Remove existing snapshot if any
    if snap_path.exists() {
        let _ = std::fs::remove_file(&snap_path);
    }

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let escaped = snap_path.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{}';", escaped))
            .map_err(|e| format!("Failed to snapshot tab: {}", e))?;
    }

    // Update tab with snapshot path
    {
        let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
        if let Some(tab) = tabs.iter_mut().find(|t| t.id == active_id) {
            tab.snapshot_path = Some(snap_path.to_string_lossy().to_string());
        }
    }

    Ok(())
}

/// Switch to a target tab by restoring its connection.
fn switch_tab_inner(db: &Database, target_tab_id: &str) -> Result<(), String> {
    // 1. Snapshot current tab
    snapshot_current_tab_inner(db)?;

    // 2. Find target tab info
    let target_tab = {
        let tabs = db.tabs.lock().map_err(|e| e.to_string())?;
        tabs.iter()
            .find(|t| t.id == target_tab_id)
            .cloned()
            .ok_or_else(|| format!("Tab not found: {}", target_tab_id))?
    };

    // 3. Open target tab's working connection
    let (new_conn, new_path) = if let Some(ref snap) = target_tab.snapshot_path {
        // Existing working copy
        let snap_path = PathBuf::from(snap);
        if snap_path.exists() {
            let conn = open_snapshot_connection(&snap_path)?;
            (conn, target_tab.file_path.as_deref().map(PathBuf::from))
        } else if let Some(ref fp) = target_tab.file_path {
            let file_path = PathBuf::from(fp);
            let new_snap = create_working_copy(&file_path, target_tab_id)?;
            let conn = open_snapshot_connection(&new_snap)?;
            {
                let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
                if let Some(tab) = tabs.iter_mut().find(|t| t.id == target_tab_id) {
                    tab.snapshot_path = Some(new_snap.to_string_lossy().to_string());
                }
            }
            (conn, Some(file_path))
        } else {
            // Snapshot missing — create fresh
            let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
            initialize_schema(&conn).map_err(|e| e.to_string())?;
            (conn, None)
        }
    } else if let Some(ref fp) = target_tab.file_path {
        // File-backed tab that has not yet created a working copy
        let file_path = PathBuf::from(fp);
        let snap_path = create_working_copy(&file_path, target_tab_id)?;
        let conn = open_snapshot_connection(&snap_path)?;
        {
            let mut tabs = db.tabs.lock().map_err(|e| e.to_string())?;
            if let Some(tab) = tabs.iter_mut().find(|t| t.id == target_tab_id) {
                tab.snapshot_path = Some(snap_path.to_string_lossy().to_string());
            }
        }
        (conn, Some(file_path))
    } else {
        // Fresh in-memory tab (never been snapshotted)
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        initialize_schema(&conn).map_err(|e| e.to_string())?;
        (conn, None)
    };

    // 4. Swap connection
    db.swap_connection(new_conn, new_path)?;

    // 5. Update active tab
    {
        let mut active = db.active_tab_id.lock().map_err(|e| e.to_string())?;
        *active = target_tab_id.to_string();
    }

    Ok(())
}

/// Clean up a tab's snapshot file.
fn cleanup_tab_snapshot(db: &Database, tab_id: &str) -> Result<(), String> {
    let tabs = db.tabs.lock().map_err(|e| e.to_string())?;
    if let Some(tab) = tabs.iter().find(|t| t.id == tab_id) {
        if let Some(ref snap) = tab.snapshot_path {
            let _ = std::fs::remove_file(snap);
        }
    }
    Ok(())
}

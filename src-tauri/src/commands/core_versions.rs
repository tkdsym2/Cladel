use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CoreVersionData {
    pub id: String,
    pub node_id: String,
    pub version_number: i32,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CoreVersionDiff {
    pub version_a: i32,
    pub version_b: i32,
    pub content_a: String,
    pub content_b: String,
}

#[tauri::command]
pub fn save_core_version(
    db: State<Database>,
    node_id: String,
    content: String,
) -> Result<CoreVersionData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Get the next version number
    let version_number: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM core_versions WHERE node_id = ?1",
            [&node_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO core_versions (id, node_id, version_number, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, node_id, version_number, content, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(CoreVersionData {
        id,
        node_id,
        version_number,
        content,
        created_at: now,
    })
}

#[tauri::command]
pub fn get_core_versions(
    db: State<Database>,
    node_id: String,
) -> Result<Vec<CoreVersionData>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, node_id, version_number, content, created_at FROM core_versions WHERE node_id = ?1 ORDER BY version_number DESC")
        .map_err(|e| e.to_string())?;

    let versions = stmt
        .query_map([&node_id], |row| {
            Ok(CoreVersionData {
                id: row.get(0)?,
                node_id: row.get(1)?,
                version_number: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(versions)
}

#[tauri::command]
pub fn get_core_version_diff(
    db: State<Database>,
    node_id: String,
    version_a: i32,
    version_b: i32,
) -> Result<CoreVersionDiff, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let content_a: String = conn
        .query_row(
            "SELECT content FROM core_versions WHERE node_id = ?1 AND version_number = ?2",
            rusqlite::params![node_id, version_a],
            |row| row.get(0),
        )
        .map_err(|e| format!("Version {} not found: {}", version_a, e))?;

    let content_b: String = conn
        .query_row(
            "SELECT content FROM core_versions WHERE node_id = ?1 AND version_number = ?2",
            rusqlite::params![node_id, version_b],
            |row| row.get(0),
        )
        .map_err(|e| format!("Version {} not found: {}", version_b, e))?;

    Ok(CoreVersionDiff {
        version_a,
        version_b,
        content_a,
        content_b,
    })
}

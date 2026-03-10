use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EdgeData {
    pub id: String,
    pub layer_id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    pub weight: i32,
    pub comment: String,
    pub source_handle: Option<String>,
    pub target_handle: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateEdgeInput {
    pub layer_id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    pub weight: Option<i32>,
    pub comment: Option<String>,
    pub source_handle: Option<String>,
    pub target_handle: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEdgeInput {
    pub id: String,
    pub weight: Option<i32>,
    pub comment: Option<String>,
    pub source_node_id: Option<String>,
    pub target_node_id: Option<String>,
    pub source_handle: Option<String>,
    pub target_handle: Option<String>,
}

#[tauri::command]
pub fn create_edge(db: State<Database>, input: CreateEdgeInput) -> Result<EdgeData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let weight = input.weight.unwrap_or(3);
    let comment = input.comment.unwrap_or_default();

    let source_handle = input.source_handle.clone();
    let target_handle = input.target_handle.clone();

    conn.execute(
        "INSERT INTO edges (id, layer_id, source_node_id, target_node_id, weight, comment, source_handle, target_handle, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'user', ?9, ?9)",
        rusqlite::params![id, input.layer_id, input.source_node_id, input.target_node_id, weight, comment, source_handle, target_handle, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(EdgeData {
        id,
        layer_id: input.layer_id,
        source_node_id: input.source_node_id,
        target_node_id: input.target_node_id,
        weight,
        comment,
        source_handle,
        target_handle,
        created_by: "user".to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_edge(db: State<Database>, input: UpdateEdgeInput) -> Result<EdgeData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let edge = conn
        .query_row(
            "SELECT id, layer_id, source_node_id, target_node_id, weight, comment, source_handle, target_handle, created_by, created_at, updated_at FROM edges WHERE id = ?1",
            [&input.id],
            |row| {
                Ok(EdgeData {
                    id: row.get(0)?,
                    layer_id: row.get(1)?,
                    source_node_id: row.get(2)?,
                    target_node_id: row.get(3)?,
                    weight: row.get(4)?,
                    comment: row.get(5)?,
                    source_handle: row.get(6)?,
                    target_handle: row.get(7)?,
                    created_by: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .map_err(|e| format!("Edge not found: {}", e))?;

    let weight = input.weight.unwrap_or(edge.weight);
    let comment = input.comment.unwrap_or(edge.comment);
    let source_node_id = input.source_node_id.unwrap_or(edge.source_node_id);
    let target_node_id = input.target_node_id.unwrap_or(edge.target_node_id);
    let source_handle = input.source_handle.or(edge.source_handle);
    let target_handle = input.target_handle.or(edge.target_handle);

    conn.execute(
        "UPDATE edges SET source_node_id = ?1, target_node_id = ?2, weight = ?3, comment = ?4, source_handle = ?5, target_handle = ?6, updated_at = ?7 WHERE id = ?8",
        rusqlite::params![source_node_id, target_node_id, weight, comment, source_handle, target_handle, now, input.id],
    )
    .map_err(|e| e.to_string())?;

    Ok(EdgeData {
        id: input.id,
        layer_id: edge.layer_id,
        source_node_id,
        target_node_id,
        weight,
        comment,
        source_handle,
        target_handle,
        created_by: edge.created_by,
        created_at: edge.created_at,
        updated_at: now,
    })
}

#[derive(Debug, Deserialize)]
pub struct RestoreEdgeInput {
    pub id: String,
    pub layer_id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    pub weight: i32,
    pub comment: String,
    pub source_handle: Option<String>,
    pub target_handle: Option<String>,
    pub created_by: String,
}

#[tauri::command]
pub fn restore_edge(db: State<Database>, input: RestoreEdgeInput) -> Result<EdgeData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO edges (id, layer_id, source_node_id, target_node_id, weight, comment, source_handle, target_handle, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        rusqlite::params![
            input.id, input.layer_id, input.source_node_id, input.target_node_id,
            input.weight, input.comment, input.source_handle, input.target_handle,
            input.created_by, now,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(EdgeData {
        id: input.id,
        layer_id: input.layer_id,
        source_node_id: input.source_node_id,
        target_node_id: input.target_node_id,
        weight: input.weight,
        comment: input.comment,
        source_handle: input.source_handle,
        target_handle: input.target_handle,
        created_by: input.created_by,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_edge(db: State<Database>, edge_id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM edges WHERE id = ?1", [&edge_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_edges_by_layer(db: State<Database>, layer_id: String) -> Result<Vec<EdgeData>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, layer_id, source_node_id, target_node_id, weight, comment, source_handle, target_handle, created_by, created_at, updated_at FROM edges WHERE layer_id = ?1")
        .map_err(|e| e.to_string())?;

    let edges = stmt
        .query_map([&layer_id], |row| {
            Ok(EdgeData {
                id: row.get(0)?,
                layer_id: row.get(1)?,
                source_node_id: row.get(2)?,
                target_node_id: row.get(3)?,
                weight: row.get(4)?,
                comment: row.get(5)?,
                source_handle: row.get(6)?,
                target_handle: row.get(7)?,
                created_by: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(edges)
}

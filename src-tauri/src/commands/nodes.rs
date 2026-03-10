use crate::db::Database;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::bibtex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeData {
    pub id: String,
    pub layer_id: String,
    pub node_type: String,
    pub title: String,
    pub content: Option<String>,
    pub bibtex: Option<String>,
    pub metadata: Option<String>,
    pub pdf_path: Option<String>,
    pub display_id: Option<String>,
    pub position_x: f64,
    pub position_y: f64,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub status: String,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
    pub creator_user_id: Option<String>,
    pub creator_user_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateNodeInput {
    pub layer_id: String,
    pub node_type: String,
    pub title: String,
    pub content: Option<String>,
    pub bibtex: Option<String>,
    pub metadata: Option<String>,
    pub position_x: f64,
    pub position_y: f64,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub created_by: Option<String>,
    pub creator_user_id: Option<String>,
    pub creator_user_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNodeInput {
    pub id: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub bibtex: Option<String>,
    pub metadata: Option<String>,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub status: Option<String>,
}

/// Column list used in all SELECT queries to ensure consistent ordering.
pub(crate) const NODE_COLUMNS: &str = "id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name";

/// Helper: read a NodeData from a SELECT with NODE_COLUMNS ordering.
pub(crate) fn node_from_row(row: &rusqlite::Row) -> rusqlite::Result<NodeData> {
    Ok(NodeData {
        id: row.get(0)?,
        layer_id: row.get(1)?,
        node_type: row.get(2)?,
        title: row.get(3)?,
        content: row.get(4)?,
        bibtex: row.get(5)?,
        metadata: row.get(6)?,
        pdf_path: row.get(7)?,
        display_id: row.get(8)?,
        position_x: row.get(9)?,
        position_y: row.get(10)?,
        status: row.get(11)?,
        created_by: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        width: row.get(15)?,
        height: row.get(16)?,
        creator_user_id: row.get(17)?,
        creator_user_name: row.get(18)?,
    })
}

/// Get the next sequential display_id for a given prefix.
/// Queries ALL nodes across ALL layers to ensure global uniqueness.
/// Example: get_next_display_id(conn, "note") → "note_4" if max is 3.
pub fn get_next_display_id(conn: &Connection, prefix: &str) -> Result<String, String> {
    let pattern = format!("{prefix}_%");
    let prefix_len = prefix.len() as i64 + 1; // +1 for the underscore

    let max_n: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(CAST(SUBSTR(display_id, ?1 + 1) AS INTEGER)), 0) FROM nodes WHERE display_id LIKE ?2",
            rusqlite::params![prefix_len, pattern],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to query max display_id for {prefix}: {e}"))?;

    Ok(format!("{prefix}_{}", max_n + 1))
}

/// Extract BibTeX citation key from a bibtex string.
/// E.g. "@article{grunbaum2020, ...}" → Some("grunbaum2020")
pub fn extract_bibtex_key(bibtex: &str) -> Option<String> {
    let open = bibtex.find('{')?;
    let after_open = &bibtex[open + 1..];
    let comma = after_open.find(',')?;
    let key = after_open[..comma].trim();
    if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    }
}

#[tauri::command]
pub fn create_node(db: State<Database>, input: CreateNodeInput) -> Result<NodeData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let created_by = input.created_by.unwrap_or_else(|| "user".to_string());

    // Auto-assign display_id based on node type
    let display_id: Option<String> = match input.node_type.as_str() {
        "user_doc" => Some(get_next_display_id(&conn, "note")?),
        "paper" => {
            // Try to extract BibTeX citation key
            let key = input.bibtex.as_deref().and_then(extract_bibtex_key);
            Some(key.unwrap_or_else(|| get_next_display_id(&conn, "paper").unwrap_or_else(|_| "paper_1".to_string())))
        }
        "agent_proposal" => Some(get_next_display_id(&conn, "agent")?),
        "agent" => Some(get_next_display_id(&conn, "agent_node")?),
        "paper_group" => Some(get_next_display_id(&conn, "group")?),
        "export" => Some(get_next_display_id(&conn, "export")?),
        "compare" => Some(get_next_display_id(&conn, "compare")?),
        "title" => Some(get_next_display_id(&conn, "title")?),
        "nano_banana" => Some(get_next_display_id(&conn, "nanob")?),
        "junction" | "deleted" => None,
        _ => None,
    };

    conn.execute(
        "INSERT INTO nodes (id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, 'active', ?11, ?12, ?12, ?13, ?14, ?15, ?16)",
        rusqlite::params![
            id,
            input.layer_id,
            input.node_type,
            input.title,
            input.content,
            input.bibtex,
            input.metadata,
            display_id,
            input.position_x,
            input.position_y,
            created_by,
            now,
            input.width,
            input.height,
            input.creator_user_id,
            input.creator_user_name,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(NodeData {
        id,
        layer_id: input.layer_id,
        node_type: input.node_type,
        title: input.title,
        content: input.content,
        bibtex: input.bibtex,
        metadata: input.metadata,
        pdf_path: None,
        display_id,
        position_x: input.position_x,
        position_y: input.position_y,
        width: input.width,
        height: input.height,
        status: "active".to_string(),
        created_by,
        created_at: now.clone(),
        updated_at: now,
        creator_user_id: input.creator_user_id,
        creator_user_name: input.creator_user_name,
    })
}

#[tauri::command]
pub fn update_node(db: State<Database>, input: UpdateNodeInput) -> Result<NodeData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Fetch current node first
    let query = format!("SELECT {} FROM nodes WHERE id = ?1", NODE_COLUMNS);
    let node = conn
        .query_row(
            &query,
            [&input.id],
            node_from_row,
        )
        .map_err(|e| format!("Node not found: {}", e))?;

    let title = input.title.unwrap_or(node.title);
    let content = input.content.or(node.content);
    let bibtex = input.bibtex.or(node.bibtex);
    let metadata = input.metadata.or(node.metadata);
    let position_x = input.position_x.unwrap_or(node.position_x);
    let position_y = input.position_y.unwrap_or(node.position_y);
    let width = input.width.or(node.width);
    let height = input.height.or(node.height);
    let status = input.status.unwrap_or(node.status);

    conn.execute(
        "UPDATE nodes SET title = ?1, content = ?2, bibtex = ?3, metadata = ?4, position_x = ?5, position_y = ?6, status = ?7, updated_at = ?8, width = ?9, height = ?10 WHERE id = ?11",
        rusqlite::params![title, content, bibtex, metadata, position_x, position_y, status, now, width, height, input.id],
    )
    .map_err(|e| e.to_string())?;

    Ok(NodeData {
        id: input.id,
        layer_id: node.layer_id,
        node_type: node.node_type,
        title,
        content,
        bibtex,
        metadata,
        pdf_path: node.pdf_path,
        display_id: node.display_id,
        position_x,
        position_y,
        width,
        height,
        status,
        created_by: node.created_by,
        created_at: node.created_at,
        updated_at: now,
        creator_user_id: node.creator_user_id,
        creator_user_name: node.creator_user_name,
    })
}

#[tauri::command]
pub fn soft_delete_node(db: State<Database>, node_id: String) -> Result<NodeData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // Fetch the current node
    let query = format!("SELECT {} FROM nodes WHERE id = ?1", NODE_COLUMNS);
    let node = conn
        .query_row(
            &query,
            [&node_id],
            node_from_row,
        )
        .map_err(|e| format!("Node not found: {}", e))?;

    // Build metadata: preserve original title/type and timestamp
    let meta = serde_json::json!({
        "original_title": node.title,
        "original_type": node.node_type,
        "deleted_at": now,
    });

    // Update the node to 'deleted' type; clear dimensions so the placeholder uses its default small size
    conn.execute(
        "UPDATE nodes SET node_type = 'deleted', title = 'Deleted', content = NULL, bibtex = NULL, metadata = ?1, width = NULL, height = NULL, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![meta.to_string(), now, node_id],
    )
    .map_err(|e| e.to_string())?;

    // Remove node_comments for this node (no longer meaningful)
    conn.execute("DELETE FROM node_comments WHERE node_id = ?1", [&node_id])
        .map_err(|e| e.to_string())?;

    // Edges and edge_comments are intentionally preserved

    Ok(NodeData {
        id: node_id,
        layer_id: node.layer_id,
        node_type: "deleted".to_string(),
        title: "Deleted".to_string(),
        content: None,
        bibtex: None,
        metadata: Some(meta.to_string()),
        pdf_path: None,
        display_id: None,
        position_x: node.position_x,
        position_y: node.position_y,
        width: None,
        height: None,
        status: node.status,
        created_by: node.created_by,
        created_at: node.created_at,
        updated_at: now,
        creator_user_id: node.creator_user_id,
        creator_user_name: node.creator_user_name,
    })
}

#[derive(Debug, Deserialize)]
pub struct RestoreNodeInput {
    pub id: String,
    pub layer_id: String,
    pub node_type: String,
    pub title: String,
    pub content: Option<String>,
    pub bibtex: Option<String>,
    pub metadata: Option<String>,
    pub pdf_path: Option<String>,
    pub display_id: Option<String>,
    pub position_x: f64,
    pub position_y: f64,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub status: String,
    pub created_by: String,
    pub creator_user_id: Option<String>,
    pub creator_user_name: Option<String>,
}

#[tauri::command]
pub fn restore_node(db: State<Database>, input: RestoreNodeInput) -> Result<NodeData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO nodes (id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15, ?16, ?17, ?18)",
        rusqlite::params![
            input.id,
            input.layer_id,
            input.node_type,
            input.title,
            input.content,
            input.bibtex,
            input.metadata,
            input.pdf_path,
            input.display_id,
            input.position_x,
            input.position_y,
            input.status,
            input.created_by,
            now,
            input.width,
            input.height,
            input.creator_user_id,
            input.creator_user_name,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(NodeData {
        id: input.id,
        layer_id: input.layer_id,
        node_type: input.node_type,
        title: input.title,
        content: input.content,
        bibtex: input.bibtex,
        metadata: input.metadata,
        pdf_path: input.pdf_path,
        display_id: input.display_id,
        position_x: input.position_x,
        position_y: input.position_y,
        width: input.width,
        height: input.height,
        status: input.status,
        created_by: input.created_by,
        created_at: now.clone(),
        updated_at: now,
        creator_user_id: input.creator_user_id,
        creator_user_name: input.creator_user_name,
    })
}

#[tauri::command]
pub fn delete_node(db: State<Database>, node_id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Delete associated edges first
    conn.execute(
        "DELETE FROM edges WHERE source_node_id = ?1 OR target_node_id = ?1",
        [&node_id],
    )
    .map_err(|e| e.to_string())?;

    // Delete associated core versions
    conn.execute("DELETE FROM core_versions WHERE node_id = ?1", [&node_id])
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM nodes WHERE id = ?1", [&node_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_nodes_by_layer(db: State<Database>, layer_id: String) -> Result<Vec<NodeData>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let query = format!("SELECT {} FROM nodes WHERE layer_id = ?1", NODE_COLUMNS);
    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| e.to_string())?;

    let nodes = stmt
        .query_map([&layer_id], node_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(nodes)
}

#[tauri::command]
pub fn update_display_id(
    db: State<Database>,
    node_id: String,
    new_display_id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 1. Verify the node exists and is user_doc type
    let node_type: String = conn
        .query_row(
            "SELECT node_type FROM nodes WHERE id = ?1",
            [&node_id],
            |row| row.get(0),
        )
        .map_err(|_| format!("Node not found: {node_id}"))?;

    if node_type != "user_doc" {
        return Err("Only note nodes can have their ID edited".to_string());
    }

    // 2. Validate non-empty
    let trimmed = new_display_id.trim().to_string();
    if trimmed.is_empty() {
        return Err("Display ID cannot be empty".to_string());
    }

    // 3. Check for conflicts
    let conflict: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM nodes WHERE display_id = ?1 AND id != ?2",
            rusqlite::params![trimmed, node_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to check display_id conflict: {e}"))?;

    if conflict {
        return Err("Display ID already in use".to_string());
    }

    // 4. Update
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE nodes SET display_id = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![trimmed, now, node_id],
    )
    .map_err(|e| format!("Failed to update display_id: {e}"))?;

    Ok(())
}

/// Update a Paper node's BibTeX string, re-sync metadata, title, abstract, and display_id.
#[tauri::command]
pub fn update_paper_bibtex(
    db: State<Database>,
    node_id: String,
    new_bibtex: String,
) -> Result<NodeData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // 1. Fetch current node
    let query = format!("SELECT {} FROM nodes WHERE id = ?1", NODE_COLUMNS);
    let node = conn
        .query_row(&query, [&node_id], node_from_row)
        .map_err(|e| format!("Node not found: {}", e))?;

    if node.node_type != "paper" {
        return Err("Only paper nodes can have their BibTeX edited".to_string());
    }

    // 2. Parse the new BibTeX
    let entries = bibtex::parse_bibtex(new_bibtex.clone())?;

    let mut title = node.title.clone();
    let mut content = node.content.clone();
    let mut metadata = node.metadata.clone();
    let mut display_id = node.display_id.clone();

    if let Some(entry) = entries.first() {
        // Update title from BibTeX if available
        if !entry.title.is_empty() {
            title = entry.title.clone();
        }

        // Update abstract from BibTeX if available
        if let Some(ref abs) = entry.abstract_text {
            content = Some(abs.clone());
        }

        // Re-sync metadata JSON
        let mut meta: serde_json::Value = node
            .metadata
            .as_deref()
            .and_then(|m| serde_json::from_str(m).ok())
            .unwrap_or_else(|| serde_json::json!({}));

        if !entry.authors.is_empty() {
            meta["authors"] = serde_json::json!(entry.authors);
        }
        if let Some(ref year) = entry.year {
            meta["year"] = serde_json::json!(year);
        }
        if let Some(ref journal) = entry.journal {
            meta["journal"] = serde_json::json!(journal);
        } else if let Some(ref booktitle) = entry.booktitle {
            meta["journal"] = serde_json::json!(booktitle);
        }
        if let Some(ref doi) = entry.doi {
            meta["doi"] = serde_json::json!(doi);
        }

        metadata = Some(serde_json::to_string(&meta).unwrap_or_default());

        // Update display_id from citation key
        if !entry.cite_key.is_empty() {
            let conflict: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM nodes WHERE display_id = ?1 AND id != ?2",
                    rusqlite::params![entry.cite_key, node_id],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if !conflict {
                display_id = Some(entry.cite_key.clone());
            }
        }
    }

    // 3. Persist
    conn.execute(
        "UPDATE nodes SET title = ?1, content = ?2, bibtex = ?3, metadata = ?4, display_id = ?5, updated_at = ?6 WHERE id = ?7",
        rusqlite::params![title, content, new_bibtex, metadata, display_id, now, node_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(NodeData {
        title,
        content,
        bibtex: Some(new_bibtex),
        metadata,
        display_id,
        updated_at: now,
        ..node
    })
}

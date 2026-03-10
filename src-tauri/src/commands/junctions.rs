use crate::db::Database;
use serde::Serialize;
use tauri::State;

use super::edges::EdgeData;
use super::nodes::NodeData;

/// Given a source handle direction (e.g. "right"), return the matching target handle
/// on the junction node (e.g. "left-target") — the side facing back toward the source.
fn junction_target_for_source(source_handle: &str) -> Option<String> {
    match source_handle {
        "right" => Some("left-target".to_string()),
        "left" => Some("right-target".to_string()),
        "top" => Some("bottom-target".to_string()),
        "bottom" => Some("top-target".to_string()),
        _ => None,
    }
}

/// Given a target handle direction (e.g. "left-target"), return the matching source handle
/// on the junction node (e.g. "right") — the side facing toward the target.
fn junction_source_for_target(target_handle: &str) -> Option<String> {
    match target_handle {
        "left-target" => Some("right".to_string()),
        "right-target" => Some("left".to_string()),
        "top-target" => Some("bottom".to_string()),
        "bottom-target" => Some("top".to_string()),
        _ => None,
    }
}

#[derive(Debug, Serialize)]
pub struct SplitEdgeResult {
    pub junction_node: NodeData,
    pub edge_a: EdgeData,
    pub edge_b: EdgeData,
}

#[derive(Debug, Serialize)]
pub struct DissolveJunctionResult {
    pub merged_edge: EdgeData,
}

#[tauri::command]
pub fn split_edge_at_junction(
    db: State<Database>,
    edge_id: String,
    position_x: f64,
    position_y: f64,
) -> Result<SplitEdgeResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // 1. Fetch the original edge
    let orig_edge = conn
        .query_row(
            "SELECT id, layer_id, source_node_id, target_node_id, weight, comment, source_handle, target_handle, created_by, created_at, updated_at FROM edges WHERE id = ?1",
            [&edge_id],
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

    // 2. Create the junction node
    let junction_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO nodes (id, layer_id, node_type, title, content, bibtex, metadata, position_x, position_y, status, created_by, created_at, updated_at)
         VALUES (?1, ?2, 'junction', 'Junction', NULL, NULL, NULL, ?3, ?4, 'active', 'user', ?5, ?5)",
        rusqlite::params![junction_id, orig_edge.layer_id, position_x, position_y, now],
    )
    .map_err(|e| e.to_string())?;

    // 3. Compute junction-side handles based on original edge direction
    //    Edge A (source→junction): keep original source_handle, infer junction's target handle
    //    Edge B (junction→target): infer junction's source handle, keep original target_handle
    let edge_a_source_handle = orig_edge.source_handle.clone();
    let edge_a_target_handle = orig_edge.source_handle.as_deref()
        .and_then(junction_target_for_source);
    let edge_b_source_handle = orig_edge.target_handle.as_deref()
        .and_then(junction_source_for_target);
    let edge_b_target_handle = orig_edge.target_handle.clone();

    // 3b. Create edge A: original source → junction (inherits weight + handles)
    let edge_a_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO edges (id, layer_id, source_node_id, target_node_id, weight, comment, source_handle, target_handle, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, 'user', ?8, ?8)",
        rusqlite::params![
            edge_a_id,
            orig_edge.layer_id,
            orig_edge.source_node_id,
            junction_id,
            orig_edge.weight,
            edge_a_source_handle,
            edge_a_target_handle,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    // 4. Create edge B: junction → original target (inherits weight + handles)
    let edge_b_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO edges (id, layer_id, source_node_id, target_node_id, weight, comment, source_handle, target_handle, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, 'user', ?8, ?8)",
        rusqlite::params![
            edge_b_id,
            orig_edge.layer_id,
            junction_id,
            orig_edge.target_node_id,
            orig_edge.weight,
            edge_b_source_handle,
            edge_b_target_handle,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    // 5. Move edge_comments from original edge to edge A (upstream relationship)
    conn.execute(
        "UPDATE edge_comments SET edge_id = ?1 WHERE edge_id = ?2",
        rusqlite::params![edge_a_id, edge_id],
    )
    .map_err(|e| e.to_string())?;

    // 6. Delete the original edge (comments already moved, CASCADE is harmless)
    conn.execute("DELETE FROM edges WHERE id = ?1", [&edge_id])
        .map_err(|e| e.to_string())?;

    let junction_node = NodeData {
        id: junction_id.clone(),
        layer_id: orig_edge.layer_id.clone(),
        node_type: "junction".to_string(),
        title: "Junction".to_string(),
        content: None,
        bibtex: None,
        metadata: None,
        pdf_path: None,
        display_id: None,
        position_x,
        position_y,
        width: None,
        height: None,
        status: "active".to_string(),
        created_by: "user".to_string(),
        created_at: now.clone(),
        updated_at: now.clone(),
        creator_user_id: None,
        creator_user_name: None,
    };

    let edge_a = EdgeData {
        id: edge_a_id,
        layer_id: orig_edge.layer_id.clone(),
        source_node_id: orig_edge.source_node_id,
        target_node_id: junction_id.clone(),
        weight: orig_edge.weight,
        comment: String::new(),
        source_handle: edge_a_source_handle,
        target_handle: edge_a_target_handle,
        created_by: "user".to_string(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    let edge_b = EdgeData {
        id: edge_b_id,
        layer_id: orig_edge.layer_id,
        source_node_id: junction_id,
        target_node_id: orig_edge.target_node_id,
        weight: orig_edge.weight,
        comment: String::new(),
        source_handle: edge_b_source_handle,
        target_handle: edge_b_target_handle,
        created_by: "user".to_string(),
        created_at: now.clone(),
        updated_at: now,
    };

    Ok(SplitEdgeResult {
        junction_node,
        edge_a,
        edge_b,
    })
}

#[tauri::command]
pub fn dissolve_junction(
    db: State<Database>,
    node_id: String,
) -> Result<DissolveJunctionResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // 1. Verify this is a junction node
    let node_type: String = conn
        .query_row(
            "SELECT node_type FROM nodes WHERE id = ?1",
            [&node_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Node not found: {}", e))?;

    if node_type != "junction" {
        return Err("Not a junction node".to_string());
    }

    // 2. Find all edges connected to this junction
    let mut stmt = conn
        .prepare(
            "SELECT id, layer_id, source_node_id, target_node_id, weight, comment, source_handle, target_handle, created_by, created_at, updated_at FROM edges WHERE source_node_id = ?1 OR target_node_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let edges: Vec<EdgeData> = stmt
        .query_map([&node_id], |row| {
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

    // 3. Validate pass-through topology: exactly 1 incoming + 1 outgoing
    let incoming: Vec<&EdgeData> = edges
        .iter()
        .filter(|e| e.target_node_id == node_id)
        .collect();
    let outgoing: Vec<&EdgeData> = edges
        .iter()
        .filter(|e| e.source_node_id == node_id)
        .collect();

    if incoming.len() != 1 || outgoing.len() != 1 {
        return Err(format!(
            "Cannot dissolve: junction has {} incoming and {} outgoing edges (expected 1 and 1)",
            incoming.len(),
            outgoing.len()
        ));
    }

    let edge_in = incoming[0];
    let edge_out = outgoing[0];
    let source = &edge_in.source_node_id;
    let target = &edge_out.target_node_id;
    let layer_id = &edge_in.layer_id;
    let weight = edge_in.weight;

    // 4. Create merged edge: source → target (preserve handles from outer endpoints)
    let merged_source_handle = edge_in.source_handle.clone();
    let merged_target_handle = edge_out.target_handle.clone();
    let merged_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO edges (id, layer_id, source_node_id, target_node_id, weight, comment, source_handle, target_handle, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, 'user', ?8, ?8)",
        rusqlite::params![merged_id, layer_id, source, target, weight, merged_source_handle, merged_target_handle, now],
    )
    .map_err(|e| e.to_string())?;

    // 5. Move edge_comments from both old edges to the merged edge
    conn.execute(
        "UPDATE edge_comments SET edge_id = ?1 WHERE edge_id = ?2",
        rusqlite::params![merged_id, edge_in.id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE edge_comments SET edge_id = ?1 WHERE edge_id = ?2",
        rusqlite::params![merged_id, edge_out.id],
    )
    .map_err(|e| e.to_string())?;

    // 6. Delete the two old edges (comments already moved)
    conn.execute("DELETE FROM edges WHERE id = ?1", [&edge_in.id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM edges WHERE id = ?1", [&edge_out.id])
        .map_err(|e| e.to_string())?;

    // 7. Delete the junction node
    conn.execute("DELETE FROM nodes WHERE id = ?1", [&node_id])
        .map_err(|e| e.to_string())?;

    let merged_edge = EdgeData {
        id: merged_id,
        layer_id: layer_id.clone(),
        source_node_id: source.clone(),
        target_node_id: target.clone(),
        weight,
        comment: String::new(),
        source_handle: merged_source_handle,
        target_handle: merged_target_handle,
        created_by: "user".to_string(),
        created_at: now.clone(),
        updated_at: now,
    };

    Ok(DissolveJunctionResult { merged_edge })
}

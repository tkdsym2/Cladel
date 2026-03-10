use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LayerData {
    pub id: String,
    pub project_id: String,
    pub layer_number: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectData {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn create_project(db: State<Database>, name: String) -> Result<ProjectData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        rusqlite::params![id, name, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(ProjectData {
        id,
        name,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn create_layer(
    db: State<Database>,
    project_id: String,
    core_content: Option<String>,
    source_node_id: Option<String>,
) -> Result<LayerData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let layer_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Get the next layer number for this project
    let layer_number: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(layer_number), 0) + 1 FROM layers WHERE project_id = ?1",
            [&project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO layers (id, project_id, layer_number, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        rusqlite::params![layer_id, project_id, layer_number, now],
    )
    .map_err(|e| e.to_string())?;

    // Determine Core node title and content
    let (core_title, core_content_final) = if let Some(ref sid) = source_node_id {
        // Fetch the source node
        let query = format!(
            "SELECT {} FROM nodes WHERE id = ?1",
            super::nodes::NODE_COLUMNS
        );
        let source = conn
            .query_row(&query, [sid], super::nodes::node_from_row)
            .map_err(|_| format!("Source node not found: {}", sid))?;

        // Validate node type
        match source.node_type.as_str() {
            "core" | "junction" | "deleted" | "agent" => {
                return Err(format!(
                    "Cannot create layer from {} node",
                    source.node_type
                ));
            }
            _ => {}
        }

        // Validate the source node belongs to this project
        let source_project: String = conn
            .query_row(
                "SELECT l.project_id FROM layers l WHERE l.id = ?1",
                [&source.layer_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to verify source node project: {}", e))?;

        if source_project != project_id {
            return Err("Source node does not belong to this project".to_string());
        }

        // Build content based on node type
        let title = source.title.clone();
        let content = match source.node_type.as_str() {
            "user_doc" | "agent_proposal" => {
                let mut c = source.content.unwrap_or_default();
                // For agent_proposal, if content is empty, try metadata body
                if c.is_empty() && source.node_type == "agent_proposal" {
                    if let Some(ref meta_str) = source.metadata {
                        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(meta_str) {
                            if let Some(body) = meta.get("body").and_then(|v| v.as_str()) {
                                c = body.to_string();
                            }
                        }
                    }
                }
                c
            }
            "image" => {
                let display_id = source.display_id.unwrap_or_default();
                let mut description = String::new();
                if let Some(ref meta_str) = source.metadata {
                    if let Ok(meta) = serde_json::from_str::<serde_json::Value>(meta_str) {
                        if let Some(desc) = meta.get("description").and_then(|v| v.as_str()) {
                            description = desc.to_string();
                        }
                    }
                }
                let desc_section = if description.is_empty() {
                    String::new()
                } else {
                    format!("\n\n{}", description)
                };
                format!(
                    "# {}\n\nSource: {} (image node){}",
                    title, display_id, desc_section
                )
            }
            "paper" => {
                // Use abstract as content, prepend title
                let abstract_text = source.content.unwrap_or_default();
                if abstract_text.is_empty() {
                    format!("# {}", title)
                } else {
                    format!("# {}\n\n{}", title, abstract_text)
                }
            }
            _ => source.content.unwrap_or_default(),
        };

        (title, content)
    } else {
        // Default behavior: inherit from current Core or use template
        let title = "Core".to_string();
        let content = core_content.unwrap_or_else(|| {
            "# Research Question\n\nDescribe your central research question here.".to_string()
        });
        (title, content)
    };

    // Create the Core node for this layer
    let core_node_id = uuid::Uuid::new_v4().to_string();
    let core_display_id = format!("Core{}", layer_number);

    conn.execute(
        "INSERT INTO nodes (id, layer_id, node_type, title, content, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height)
         VALUES (?1, ?2, 'core', ?3, ?4, ?5, 0, 0, 'active', 'user', ?6, ?6, 280, 210)",
        rusqlite::params![core_node_id, layer_id, core_title, core_content_final, core_display_id, now],
    )
    .map_err(|e| e.to_string())?;

    // No initial core_version is created here.
    // Version history starts empty; entries are created when the user edits.

    Ok(LayerData {
        id: layer_id,
        project_id,
        layer_number,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn get_layers(db: State<Database>, project_id: String) -> Result<Vec<LayerData>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, project_id, layer_number, created_at, updated_at FROM layers WHERE project_id = ?1 ORDER BY layer_number")
        .map_err(|e| e.to_string())?;

    let layers = stmt
        .query_map([&project_id], |row| {
            Ok(LayerData {
                id: row.get(0)?,
                project_id: row.get(1)?,
                layer_number: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(layers)
}

#[tauri::command]
pub fn delete_layer(db: State<Database>, layer_id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Check that the layer exists and get its layer_number
    let layer_number: i32 = conn
        .query_row(
            "SELECT layer_number FROM layers WHERE id = ?1",
            [&layer_id],
            |row| row.get(0),
        )
        .map_err(|_| "Layer not found".to_string())?;

    if layer_number == 1 {
        return Err("Cannot delete Layer 1".to_string());
    }

    // Get all node IDs in this layer (needed for core_versions cleanup)
    let mut node_stmt = conn
        .prepare("SELECT id FROM nodes WHERE layer_id = ?1")
        .map_err(|e| e.to_string())?;
    let node_ids: Vec<String> = node_stmt
        .query_map([&layer_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Delete in FK-safe order: core_versions + note_versions → edges → nodes → layer
    for node_id in &node_ids {
        conn.execute("DELETE FROM core_versions WHERE node_id = ?1", [node_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM note_versions WHERE node_id = ?1", [node_id])
            .map_err(|e| e.to_string())?;
    }

    conn.execute("DELETE FROM edges WHERE layer_id = ?1", [&layer_id])
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM nodes WHERE layer_id = ?1", [&layer_id])
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM layers WHERE id = ?1", [&layer_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_projects(db: State<Database>) -> Result<Vec<ProjectData>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, created_at, updated_at FROM projects ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let projects = stmt
        .query_map([], |row| {
            Ok(ProjectData {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(projects)
}

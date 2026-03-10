use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentNodeMessage {
    pub id: String,
    pub node_id: String,
    pub role: String,
    pub content: String,
    pub output_node_id: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn get_agent_node_messages(
    db: State<Database>,
    node_id: String,
) -> Result<Vec<AgentNodeMessage>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, node_id, role, content, output_node_id, created_at
             FROM agent_node_messages
             WHERE node_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let messages = stmt
        .query_map([&node_id], |row| {
            Ok(AgentNodeMessage {
                id: row.get(0)?,
                node_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                output_node_id: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(messages)
}

#[tauri::command]
pub fn add_agent_node_message(
    db: State<Database>,
    node_id: String,
    role: String,
    content: String,
    output_node_id: Option<String>,
) -> Result<AgentNodeMessage, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO agent_node_messages (id, node_id, role, content, output_node_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, node_id, role, content, output_node_id, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(AgentNodeMessage {
        id,
        node_id,
        role,
        content,
        output_node_id,
        created_at: now,
    })
}

#[tauri::command]
pub fn delete_agent_node_message(
    db: State<Database>,
    message_id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM agent_node_messages WHERE id = ?1",
        [&message_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

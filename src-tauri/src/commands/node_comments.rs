use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeComment {
    pub id: String,
    pub node_id: String,
    pub author_type: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub creator_user_id: Option<String>,
    pub creator_user_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeCommentCount {
    pub node_id: String,
    pub count: i64,
}

#[tauri::command]
pub fn add_node_comment(
    db: State<Database>,
    node_id: String,
    content: String,
    author_type: String,
    creator_user_id: Option<String>,
    creator_user_name: Option<String>,
) -> Result<NodeComment, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO node_comments (id, node_id, author_type, content, created_at, updated_at, creator_user_id, creator_user_name) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
        rusqlite::params![id, node_id, author_type, content, now, creator_user_id, creator_user_name],
    )
    .map_err(|e| e.to_string())?;

    Ok(NodeComment {
        id,
        node_id,
        author_type,
        content,
        created_at: now.clone(),
        updated_at: now,
        creator_user_id,
        creator_user_name,
    })
}

#[tauri::command]
pub fn get_node_comments(db: State<Database>, node_id: String) -> Result<Vec<NodeComment>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, node_id, author_type, content, created_at, updated_at, creator_user_id, creator_user_name FROM node_comments WHERE node_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let comments = stmt
        .query_map([&node_id], |row| {
            Ok(NodeComment {
                id: row.get(0)?,
                node_id: row.get(1)?,
                author_type: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                creator_user_id: row.get(6)?,
                creator_user_name: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(comments)
}

#[tauri::command]
pub fn update_node_comment(
    db: State<Database>,
    comment_id: String,
    content: String,
) -> Result<NodeComment, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let comment = conn
        .query_row(
            "SELECT id, node_id, author_type, content, created_at, updated_at, creator_user_id, creator_user_name FROM node_comments WHERE id = ?1",
            [&comment_id],
            |row| {
                Ok(NodeComment {
                    id: row.get(0)?,
                    node_id: row.get(1)?,
                    author_type: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    creator_user_id: row.get(6)?,
                    creator_user_name: row.get(7)?,
                })
            },
        )
        .map_err(|_| "Comment not found".to_string())?;

    conn.execute(
        "UPDATE node_comments SET content = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![content, now, comment_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(NodeComment {
        id: comment.id,
        node_id: comment.node_id,
        author_type: comment.author_type,
        content,
        created_at: comment.created_at,
        updated_at: now,
        creator_user_id: comment.creator_user_id,
        creator_user_name: comment.creator_user_name,
    })
}

#[tauri::command]
pub fn delete_node_comment(db: State<Database>, comment_id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM node_comments WHERE id = ?1", [&comment_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_node_comment_counts(
    db: State<Database>,
    node_ids: Vec<String>,
) -> Result<Vec<NodeCommentCount>, String> {
    if node_ids.is_empty() {
        return Ok(vec![]);
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Build parameterized query for the list of node IDs
    let placeholders: Vec<String> = (1..=node_ids.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT node_id, COUNT(*) as cnt FROM node_comments WHERE node_id IN ({}) GROUP BY node_id",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params: Vec<&dyn rusqlite::types::ToSql> = node_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();

    let counts = stmt
        .query_map(params.as_slice(), |row| {
            Ok(NodeCommentCount {
                node_id: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(counts)
}

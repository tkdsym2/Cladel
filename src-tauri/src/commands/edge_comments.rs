use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EdgeComment {
    pub id: String,
    pub edge_id: String,
    pub author_type: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub creator_user_id: Option<String>,
    pub creator_user_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EdgeCommentCount {
    pub edge_id: String,
    pub count: i64,
}

#[tauri::command]
pub fn add_edge_comment(
    db: State<Database>,
    edge_id: String,
    content: String,
    author_type: String,
    creator_user_id: Option<String>,
    creator_user_name: Option<String>,
) -> Result<EdgeComment, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO edge_comments (id, edge_id, author_type, content, created_at, updated_at, creator_user_id, creator_user_name) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
        rusqlite::params![id, edge_id, author_type, content, now, creator_user_id, creator_user_name],
    )
    .map_err(|e| e.to_string())?;

    Ok(EdgeComment {
        id,
        edge_id,
        author_type,
        content,
        created_at: now.clone(),
        updated_at: now,
        creator_user_id,
        creator_user_name,
    })
}

#[tauri::command]
pub fn get_edge_comments(db: State<Database>, edge_id: String) -> Result<Vec<EdgeComment>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, edge_id, author_type, content, created_at, updated_at, creator_user_id, creator_user_name FROM edge_comments WHERE edge_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let comments = stmt
        .query_map([&edge_id], |row| {
            Ok(EdgeComment {
                id: row.get(0)?,
                edge_id: row.get(1)?,
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
pub fn update_edge_comment(
    db: State<Database>,
    comment_id: String,
    content: String,
) -> Result<EdgeComment, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let comment = conn
        .query_row(
            "SELECT id, edge_id, author_type, content, created_at, updated_at, creator_user_id, creator_user_name FROM edge_comments WHERE id = ?1",
            [&comment_id],
            |row| {
                Ok(EdgeComment {
                    id: row.get(0)?,
                    edge_id: row.get(1)?,
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
        "UPDATE edge_comments SET content = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![content, now, comment_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(EdgeComment {
        id: comment.id,
        edge_id: comment.edge_id,
        author_type: comment.author_type,
        content,
        created_at: comment.created_at,
        updated_at: now,
        creator_user_id: comment.creator_user_id,
        creator_user_name: comment.creator_user_name,
    })
}

#[tauri::command]
pub fn delete_edge_comment(db: State<Database>, comment_id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM edge_comments WHERE id = ?1", [&comment_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_edge_comment_counts(
    db: State<Database>,
    edge_ids: Vec<String>,
) -> Result<Vec<EdgeCommentCount>, String> {
    if edge_ids.is_empty() {
        return Ok(vec![]);
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let placeholders: Vec<String> = (1..=edge_ids.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT edge_id, COUNT(*) as cnt FROM edge_comments WHERE edge_id IN ({}) GROUP BY edge_id",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params: Vec<&dyn rusqlite::types::ToSql> = edge_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();

    let counts = stmt
        .query_map(params.as_slice(), |row| {
            Ok(EdgeCommentCount {
                edge_id: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(counts)
}

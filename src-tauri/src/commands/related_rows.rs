//! Snapshot / restore of the rows that disappear together with a node or an edge.
//!
//! Deleting a node removes its comments, image record, agent chat and note
//! versions (ON DELETE CASCADE), and — through its edges — their edge comments.
//! Undo used to re-insert only the `nodes` / `edges` rows, so e.g. an Image node
//! came back without its `node_images` row and could no longer be exported.
//! `delete_node` / `delete_edge` now return these rows; the frontend keeps them
//! in the undo entry and hands them back to `restore_related_rows`.

use crate::db::Database;
use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::State;

/// Tables that may be snapshotted / restored, with the column that owns the row.
const NODE_TABLES: &[&str] = &[
    "node_comments",
    "node_images",
    "agent_node_messages",
    "note_versions",
    "core_versions",
];
const EDGE_TABLE: &str = "edge_comments";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableRows {
    pub table: String,
    pub rows: Vec<Map<String, Value>>,
}

fn is_allowed_table(table: &str) -> bool {
    table == EDGE_TABLE || NODE_TABLES.contains(&table)
}

fn rows_where(conn: &Connection, sql: &str, param: &str) -> Result<Vec<Map<String, Value>>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let mut out = Vec::new();
    let mut rows = stmt.query([param]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut map = Map::new();
        for (i, name) in columns.iter().enumerate() {
            let value = match row.get_ref(i).map_err(|e| e.to_string())? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => Value::from(n),
                ValueRef::Real(f) => Value::from(f),
                ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
                // None of these tables hold BLOBs; skip rather than corrupt.
                ValueRef::Blob(_) => continue,
            };
            map.insert(name.clone(), value);
        }
        out.push(map);
    }
    Ok(out)
}

fn push(out: &mut Vec<TableRows>, table: &str, rows: Vec<Map<String, Value>>) {
    if !rows.is_empty() {
        out.push(TableRows { table: table.to_string(), rows });
    }
}

/// Everything that `DELETE FROM nodes WHERE id = node_id` (plus its edges) takes
/// with it. Call BEFORE deleting.
pub(crate) fn snapshot_for_node(conn: &Connection, node_id: &str) -> Result<Vec<TableRows>, String> {
    let mut out = Vec::new();
    for table in NODE_TABLES {
        let sql = format!("SELECT * FROM {table} WHERE node_id = ?1");
        push(&mut out, table, rows_where(conn, &sql, node_id)?);
    }
    let sql = format!(
        "SELECT * FROM {EDGE_TABLE} WHERE edge_id IN \
         (SELECT id FROM edges WHERE source_node_id = ?1 OR target_node_id = ?1)"
    );
    push(&mut out, EDGE_TABLE, rows_where(conn, &sql, node_id)?);
    Ok(out)
}

/// The edge comments that `DELETE FROM edges WHERE id = edge_id` takes with it.
pub(crate) fn snapshot_for_edge(conn: &Connection, edge_id: &str) -> Result<Vec<TableRows>, String> {
    let mut out = Vec::new();
    let sql = format!("SELECT * FROM {EDGE_TABLE} WHERE edge_id = ?1");
    push(&mut out, EDGE_TABLE, rows_where(conn, &sql, edge_id)?);
    Ok(out)
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(cols)
}

/// Re-insert snapshotted rows. Returns how many were restored.
///
/// The input comes from the webview, so table names are checked against the
/// allow-list and column names against the real schema before being put into
/// SQL. Rows that already exist are left alone; rows whose owner was not
/// restored (foreign-key failure) are skipped.
pub(crate) fn restore(conn: &Connection, tables: &[TableRows]) -> Result<usize, String> {
    let mut restored = 0;
    for t in tables {
        if !is_allowed_table(&t.table) {
            return Err(format!("Cannot restore rows of table '{}'", t.table));
        }
        let known = table_columns(conn, &t.table)?;
        for row in &t.rows {
            let cols: Vec<&String> = row.keys().filter(|k| known.contains(k)).collect();
            if cols.is_empty() {
                continue;
            }
            let names = cols.iter().map(|c| c.as_str()).collect::<Vec<_>>().join(", ");
            let marks = (1..=cols.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
            let sql = format!("INSERT OR IGNORE INTO {} ({names}) VALUES ({marks})", t.table);
            let values: Vec<rusqlite::types::Value> = cols
                .iter()
                .map(|c| match &row[c.as_str()] {
                    Value::Null => rusqlite::types::Value::Null,
                    Value::Bool(b) => rusqlite::types::Value::Integer(*b as i64),
                    Value::Number(n) => match n.as_i64() {
                        Some(i) => rusqlite::types::Value::Integer(i),
                        None => rusqlite::types::Value::Real(n.as_f64().unwrap_or(0.0)),
                    },
                    Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                    other => rusqlite::types::Value::Text(other.to_string()),
                })
                .collect();
            match conn.execute(&sql, rusqlite::params_from_iter(values)) {
                Ok(n) => restored += n,
                Err(e) => eprintln!("[undo] skipped a {} row: {e}", t.table),
            }
        }
    }
    Ok(restored)
}

/// Undo support: put back the rows returned by `delete_node` / `delete_edge`.
/// Call after the node and its edges have been restored.
#[tauri::command]
pub fn restore_related_rows(db: State<Database>, rows: Vec<TableRows>) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    restore(&conn, &rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::initialize_schema;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO projects VALUES ('p','P','t','t');
             INSERT INTO layers VALUES ('l','p',1,'t','t');
             INSERT INTO nodes (id, layer_id, node_type, title, created_at, updated_at) VALUES ('a','l','image','A','t','t');
             INSERT INTO nodes (id, layer_id, node_type, title, created_at, updated_at) VALUES ('b','l','user_doc','B','t','t');
             INSERT INTO edges (id, layer_id, source_node_id, target_node_id, created_at, updated_at) VALUES ('e','l','a','b','t','t');
             INSERT INTO node_comments (id, node_id, author_type, content, created_at, updated_at) VALUES ('c1','a','user','hi','t','t');
             INSERT INTO node_images (id, node_id, file_path, mime_type, original_filename, image_width) VALUES ('i1','a','/x.png','image/png','x.png',640);
             INSERT INTO agent_node_messages (id, node_id, role, content) VALUES ('m1','a','user','q');
             INSERT INTO edge_comments (id, edge_id, author_type, content, created_at, updated_at) VALUES ('ec1','e','user','why','t','t');",
        )
        .unwrap();
        conn
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn node_delete_snapshot_round_trips() {
        let conn = setup();
        let snap = snapshot_for_node(&conn, "a").unwrap();

        // Same statements as delete_node.
        conn.execute("DELETE FROM edges WHERE source_node_id = 'a' OR target_node_id = 'a'", []).unwrap();
        conn.execute("DELETE FROM nodes WHERE id = 'a'", []).unwrap();
        for t in ["node_comments", "node_images", "agent_node_messages", "edge_comments"] {
            assert_eq!(count(&conn, t), 0, "{t} should cascade");
        }

        // Undo: node, edge, then the related rows.
        conn.execute_batch(
            "INSERT INTO nodes (id, layer_id, node_type, title, created_at, updated_at) VALUES ('a','l','image','A','t','t');
             INSERT INTO edges (id, layer_id, source_node_id, target_node_id, created_at, updated_at) VALUES ('e','l','a','b','t','t');",
        )
        .unwrap();
        assert_eq!(restore(&conn, &snap).unwrap(), 4);
        for t in ["node_comments", "node_images", "agent_node_messages", "edge_comments"] {
            assert_eq!(count(&conn, t), 1, "{t} should be restored");
        }
        let width: i64 = conn.query_row("SELECT image_width FROM node_images WHERE id='i1'", [], |r| r.get(0)).unwrap();
        assert_eq!(width, 640);

        // Restoring twice does not duplicate.
        assert_eq!(restore(&conn, &snap).unwrap(), 0);
    }

    #[test]
    fn restore_rejects_other_tables_and_skips_orphans() {
        let conn = setup();
        let bad = vec![TableRows { table: "nodes".into(), rows: vec![Map::new()] }];
        assert!(restore(&conn, &bad).is_err());

        // Owner edge is gone → the row is skipped, not an error.
        let snap = snapshot_for_edge(&conn, "e").unwrap();
        conn.execute("DELETE FROM edges WHERE id = 'e'", []).unwrap();
        assert_eq!(restore(&conn, &snap).unwrap(), 0);
    }
}

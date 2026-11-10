use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// Current schema version. Bump this when adding new migrations.
const SCHEMA_VERSION: i32 = 21;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabInfo {
    pub id: String,
    pub file_path: Option<String>,
    pub snapshot_path: Option<String>,
    pub display_name: String,
    pub is_dirty: bool,
}

pub struct Database {
    pub conn: Mutex<Connection>,
    pub current_path: Mutex<Option<PathBuf>>,
    pub tabs: Mutex<Vec<TabInfo>>,
    pub active_tab_id: Mutex<String>,
}

/// Initialize the Cladel schema on the given connection.
/// Safe to call on both fresh and existing databases (uses IF NOT EXISTS
/// and conditional migrations).
pub fn initialize_schema(conn: &Connection) -> Result<()> {
    // DELETE journal mode: no -shm/-wal sidecar files, suitable for a
    // single-user desktop app where the .cld file must be portable.
    // (Silently ignored for in-memory databases, which is fine.)
    conn.execute_batch("PRAGMA journal_mode=DELETE;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS layers (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            layer_number INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            layer_id TEXT NOT NULL REFERENCES layers(id),
            node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image', 'agent', 'paper_group', 'export', 'compare', 'title', 'nano_banana', 'table')),
            title TEXT NOT NULL,
            content TEXT,
            bibtex TEXT,
            metadata TEXT,
            pdf_path TEXT,
            position_x REAL NOT NULL DEFAULT 0,
            position_y REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
            created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS node_images (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            file_path TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            image_width INTEGER,
            image_height INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_node_images_node_id ON node_images(node_id);

        CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY,
            layer_id TEXT NOT NULL REFERENCES layers(id),
            source_node_id TEXT NOT NULL REFERENCES nodes(id),
            target_node_id TEXT NOT NULL REFERENCES nodes(id),
            weight INTEGER NOT NULL DEFAULT 3 CHECK(weight BETWEEN 1 AND 5),
            comment TEXT DEFAULT '',
            created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS core_versions (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id),
            version_number INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS node_comments (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            author_type TEXT NOT NULL CHECK(author_type IN ('user', 'agent')),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_node_comments_node_id ON node_comments(node_id);

        CREATE TABLE IF NOT EXISTS edge_comments (
            id TEXT PRIMARY KEY,
            edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
            author_type TEXT NOT NULL CHECK(author_type IN ('user', 'agent')),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_edge_comments_edge_id ON edge_comments(edge_id);

        CREATE TABLE IF NOT EXISTS note_versions (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
            version_number INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_note_versions_node_id ON note_versions(node_id);
        ",
    )?;

    // ─── Schema version tracking ───
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);",
    )?;

    let current_version: i32 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )?;

    // Fast path: if already at latest version, skip all migrations.
    if current_version >= SCHEMA_VERSION {
        return Ok(());
    }

    // ─── Migration v1: Legacy edge_comments migration ───
    if current_version < 1 {
        conn.execute_batch(
            "
            INSERT OR IGNORE INTO edge_comments (id, edge_id, author_type, content, created_at, updated_at)
            SELECT
                ('migrated-' || id),
                id,
                'user',
                comment,
                created_at,
                updated_at
            FROM edges
            WHERE comment IS NOT NULL AND comment != '';
            ",
        )?;
    }

    // ─── Migration v2: add 'deleted' to node_type CHECK constraint ───
    if current_version < 2 {
        let needs_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'deleted'"))
            .unwrap_or(false);

        if needs_migration {
            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;
            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO _nodes_new SELECT * FROM nodes;
                DROP TABLE nodes;
                ALTER TABLE _nodes_new RENAME TO nodes;
                ",
            )?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Migration v3: add source_handle/target_handle on edges ───
    if current_version < 3 {
        let edges_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='edges'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if !edges_sql.contains("source_handle") {
            conn.execute_batch(
                "
                ALTER TABLE edges ADD COLUMN source_handle TEXT;
                ALTER TABLE edges ADD COLUMN target_handle TEXT;
                ",
            )?;
        }
    }

    // ─── Migration v4: add 'junction' to node_type CHECK constraint ───
    if current_version < 4 {
        let needs_junction_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'junction'"))
            .unwrap_or(false);

        if needs_junction_migration {
            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;
            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO _nodes_new SELECT * FROM nodes;
                DROP TABLE nodes;
                ALTER TABLE _nodes_new RENAME TO nodes;
                ",
            )?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Migration v5: add width/height on nodes ───
    if current_version < 5 {
        let nodes_sql2: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if !nodes_sql2.contains("width") {
            conn.execute_batch(
                "
                ALTER TABLE nodes ADD COLUMN width REAL;
                ALTER TABLE nodes ADD COLUMN height REAL;
                ",
            )?;
        }
    }

    // ─── Migration v6: add pdf_path on nodes ───
    if current_version < 6 {
        let nodes_sql3: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if !nodes_sql3.contains("pdf_path") {
            conn.execute_batch("ALTER TABLE nodes ADD COLUMN pdf_path TEXT;")?;
        }
    }

    // ─── Migration v7: add 'image' to node_type CHECK (column-aware rebuild) ───
    if current_version < 7 {
        let needs_image_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'image'"))
            .unwrap_or(false);

        if needs_image_migration {
            // We need to figure out which columns exist to build the correct INSERT
            let current_sql: String = conn
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            let has_pdf_path = current_sql.contains("pdf_path");
            let has_width = current_sql.contains("width");

            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;

            // Build _nodes_new with all columns
            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    pdf_path TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    width REAL,
                    height REAL
                );
                ",
            )?;

            // Build INSERT based on existing columns
            let insert_sql = if has_pdf_path && has_width {
                "INSERT INTO _nodes_new (id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, position_x, position_y, status, created_by, created_at, updated_at, width, height) SELECT id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, position_x, position_y, status, created_by, created_at, updated_at, width, height FROM nodes;"
            } else if has_width {
                "INSERT INTO _nodes_new (id, layer_id, node_type, title, content, bibtex, metadata, position_x, position_y, status, created_by, created_at, updated_at, width, height) SELECT id, layer_id, node_type, title, content, bibtex, metadata, position_x, position_y, status, created_by, created_at, updated_at, width, height FROM nodes;"
            } else {
                "INSERT INTO _nodes_new (id, layer_id, node_type, title, content, bibtex, metadata, position_x, position_y, status, created_by, created_at, updated_at) SELECT id, layer_id, node_type, title, content, bibtex, metadata, position_x, position_y, status, created_by, created_at, updated_at FROM nodes;"
            };

            conn.execute_batch(insert_sql)?;
            conn.execute_batch("DROP TABLE nodes; ALTER TABLE _nodes_new RENAME TO nodes;")?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Migration v8: create node_images table ───
    if current_version < 8 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS node_images (
                id TEXT PRIMARY KEY,
                node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                file_path TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                image_width INTEGER,
                image_height INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_node_images_node_id ON node_images(node_id);
            ",
        )?;
    }

    // ─── Migration v9: add display_id on nodes + populate existing ───
    if current_version < 9 {
        let nodes_sql4: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if !nodes_sql4.contains("display_id") {
            conn.execute_batch("ALTER TABLE nodes ADD COLUMN display_id TEXT;")?;

            // Populate display_id for existing nodes

            // 1. Core nodes: "Core{layer_number}"
            conn.execute_batch(
                "UPDATE nodes SET display_id = 'Core' || (
                    SELECT l.layer_number FROM layers l WHERE l.id = nodes.layer_id
                 )
                 WHERE node_type = 'core' AND display_id IS NULL;",
            )?;

            // 2. Paper nodes: extract BibTeX citation key, else paper_{N}
            // First, papers with bibtex: key is text between first '{' and first ','
            // We use SUBSTR + INSTR to extract it.
            conn.execute_batch(
                "UPDATE nodes SET display_id = SUBSTR(
                    bibtex,
                    INSTR(bibtex, '{') + 1,
                    INSTR(bibtex, ',') - INSTR(bibtex, '{') - 1
                 )
                 WHERE node_type = 'paper'
                   AND bibtex IS NOT NULL AND bibtex != ''
                   AND INSTR(bibtex, '{') > 0 AND INSTR(bibtex, ',') > INSTR(bibtex, '{')
                   AND display_id IS NULL;",
            )?;

            // Papers without bibtex key or extraction failed: assign paper_{N}
            // Use a Rust loop for sequential numbering
            {
                let mut stmt = conn.prepare(
                    "SELECT id FROM nodes WHERE node_type = 'paper' AND (display_id IS NULL OR display_id = '') ORDER BY created_at"
                ).map_err(|e| e)?;
                let ids: Vec<String> = stmt
                    .query_map([], |row| row.get(0))
                    .map_err(|e| e)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(|e| e)?;

                // Find current max N in existing paper_N display_ids
                let max_paper: i64 = conn.query_row(
                    "SELECT COALESCE(MAX(CAST(SUBSTR(display_id, 7) AS INTEGER)), 0) FROM nodes WHERE display_id LIKE 'paper_%'",
                    [],
                    |row| row.get(0),
                ).unwrap_or(0);
                let mut counter = max_paper + 1;
                for id in &ids {
                    conn.execute(
                        "UPDATE nodes SET display_id = ?1 WHERE id = ?2",
                        rusqlite::params![format!("paper_{counter}"), id],
                    )?;
                    counter += 1;
                }
            }

            // 3. User doc nodes: "comment_{N}" globally ordered by created_at
            {
                let mut stmt = conn.prepare(
                    "SELECT id FROM nodes WHERE node_type = 'user_doc' AND display_id IS NULL ORDER BY created_at"
                ).map_err(|e| e)?;
                let ids: Vec<String> = stmt
                    .query_map([], |row| row.get(0))
                    .map_err(|e| e)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(|e| e)?;
                for (i, id) in ids.iter().enumerate() {
                    conn.execute(
                        "UPDATE nodes SET display_id = ?1 WHERE id = ?2",
                        rusqlite::params![format!("comment_{}", i + 1), id],
                    )?;
                }
            }

            // 4. Image nodes: "image_{N}" globally ordered by created_at
            {
                let mut stmt = conn.prepare(
                    "SELECT id FROM nodes WHERE node_type = 'image' AND display_id IS NULL ORDER BY created_at"
                ).map_err(|e| e)?;
                let ids: Vec<String> = stmt
                    .query_map([], |row| row.get(0))
                    .map_err(|e| e)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(|e| e)?;
                for (i, id) in ids.iter().enumerate() {
                    conn.execute(
                        "UPDATE nodes SET display_id = ?1 WHERE id = ?2",
                        rusqlite::params![format!("image_{}", i + 1), id],
                    )?;
                }
            }

            // 5. Agent proposal / ghost nodes: "agent_{N}" globally ordered by created_at
            {
                let mut stmt = conn.prepare(
                    "SELECT id FROM nodes WHERE node_type = 'agent_proposal' AND display_id IS NULL ORDER BY created_at"
                ).map_err(|e| e)?;
                let ids: Vec<String> = stmt
                    .query_map([], |row| row.get(0))
                    .map_err(|e| e)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(|e| e)?;
                for (i, id) in ids.iter().enumerate() {
                    conn.execute(
                        "UPDATE nodes SET display_id = ?1 WHERE id = ?2",
                        rusqlite::params![format!("agent_{}", i + 1), id],
                    )?;
                }
            }

            // 6. Junction / deleted nodes: display_id stays NULL (no action needed)
        }
    }

    // ─── Migration v10: create agent_usage_log table ───
    if current_version < 10 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS agent_usage_log (
                id TEXT PRIMARY KEY,
                invocation_type TEXT NOT NULL,
                model TEXT NOT NULL,
                input_tokens INTEGER NOT NULL,
                output_tokens INTEGER NOT NULL,
                total_tokens INTEGER NOT NULL,
                success INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_agent_usage_created_at ON agent_usage_log(created_at);
            ",
        )?;
    }

    // ─── Migration v11: add 'agent' to node_type CHECK (column-aware rebuild) ───
    if current_version < 11 {
        let needs_agent_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'agent'"))
            .unwrap_or(false);

        if needs_agent_migration {
            // Detect which columns exist to build the correct INSERT
            let current_sql: String = conn
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            let has_pdf_path = current_sql.contains("pdf_path");
            let has_width = current_sql.contains("width");
            let has_display_id = current_sql.contains("display_id");

            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;

            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image', 'agent')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    pdf_path TEXT,
                    display_id TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    width REAL,
                    height REAL
                );
                ",
            )?;

            // Build INSERT based on existing columns
            let cols_base = "id, layer_id, node_type, title, content, bibtex, metadata";
            let cols_pdf = if has_pdf_path { ", pdf_path" } else { "" };
            let cols_did = if has_display_id { ", display_id" } else { "" };
            let cols_pos = ", position_x, position_y, status, created_by, created_at, updated_at";
            let cols_wh = if has_width { ", width, height" } else { "" };

            let cols = format!("{cols_base}{cols_pdf}{cols_did}{cols_pos}{cols_wh}");
            let insert_sql = format!(
                "INSERT INTO _nodes_new ({cols}) SELECT {cols} FROM nodes;"
            );

            conn.execute_batch(&insert_sql)?;
            conn.execute_batch("DROP TABLE nodes; ALTER TABLE _nodes_new RENAME TO nodes;")?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Migration v12: create agent_node_messages table ───
    if current_version < 12 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS agent_node_messages (
                id TEXT PRIMARY KEY,
                node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('user', 'agent')),
                content TEXT NOT NULL,
                output_node_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_agent_node_messages_node_id ON agent_node_messages(node_id);
            ",
        )?;
    }

    // ─── Migration v13: add 'paper_group' to node_type CHECK (column-aware rebuild) ───
    if current_version < 13 {
        let needs_paper_group_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'paper_group'"))
            .unwrap_or(false);

        if needs_paper_group_migration {
            let current_sql: String = conn
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            let has_pdf_path = current_sql.contains("pdf_path");
            let has_width = current_sql.contains("width");
            let has_display_id = current_sql.contains("display_id");

            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;

            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image', 'agent', 'paper_group')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    pdf_path TEXT,
                    display_id TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    width REAL,
                    height REAL
                );
                ",
            )?;

            let cols_base = "id, layer_id, node_type, title, content, bibtex, metadata";
            let cols_pdf = if has_pdf_path { ", pdf_path" } else { "" };
            let cols_did = if has_display_id { ", display_id" } else { "" };
            let cols_pos = ", position_x, position_y, status, created_by, created_at, updated_at";
            let cols_wh = if has_width { ", width, height" } else { "" };

            let cols = format!("{cols_base}{cols_pdf}{cols_did}{cols_pos}{cols_wh}");
            let insert_sql = format!(
                "INSERT INTO _nodes_new ({cols}) SELECT {cols} FROM nodes;"
            );

            conn.execute_batch(&insert_sql)?;
            conn.execute_batch("DROP TABLE nodes; ALTER TABLE _nodes_new RENAME TO nodes;")?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Migration v14: add 'export' to node_type CHECK (column-aware rebuild) ───
    if current_version < 14 {
        let needs_export_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'export'"))
            .unwrap_or(false);

        if needs_export_migration {
            let current_sql: String = conn
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            let has_pdf_path = current_sql.contains("pdf_path");
            let has_width = current_sql.contains("width");
            let has_display_id = current_sql.contains("display_id");

            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;

            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image', 'agent', 'paper_group', 'export', 'compare')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    pdf_path TEXT,
                    display_id TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    width REAL,
                    height REAL
                );
                ",
            )?;

            let cols_base = "id, layer_id, node_type, title, content, bibtex, metadata";
            let cols_pdf = if has_pdf_path { ", pdf_path" } else { "" };
            let cols_did = if has_display_id { ", display_id" } else { "" };
            let cols_pos = ", position_x, position_y, status, created_by, created_at, updated_at";
            let cols_wh = if has_width { ", width, height" } else { "" };

            let cols = format!("{cols_base}{cols_pdf}{cols_did}{cols_pos}{cols_wh}");
            let insert_sql = format!(
                "INSERT INTO _nodes_new ({cols}) SELECT {cols} FROM nodes;"
            );

            conn.execute_batch(&insert_sql)?;
            conn.execute_batch("DROP TABLE nodes; ALTER TABLE _nodes_new RENAME TO nodes;")?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Migration v15: add 'compare' to node_type CHECK (column-aware rebuild) ───
    if current_version < 15 {
        let needs_compare_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'compare'"))
            .unwrap_or(false);

        if needs_compare_migration {
            let current_sql: String = conn
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            let has_pdf_path = current_sql.contains("pdf_path");
            let has_width = current_sql.contains("width");
            let has_display_id = current_sql.contains("display_id");

            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;

            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image', 'agent', 'paper_group', 'export', 'compare')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    pdf_path TEXT,
                    display_id TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    width REAL,
                    height REAL
                );
                ",
            )?;

            let cols_base = "id, layer_id, node_type, title, content, bibtex, metadata";
            let cols_pdf = if has_pdf_path { ", pdf_path" } else { "" };
            let cols_did = if has_display_id { ", display_id" } else { "" };
            let cols_pos = ", position_x, position_y, status, created_by, created_at, updated_at";
            let cols_wh = if has_width { ", width, height" } else { "" };

            let cols = format!("{cols_base}{cols_pdf}{cols_did}{cols_pos}{cols_wh}");
            let insert_sql = format!(
                "INSERT INTO _nodes_new ({cols}) SELECT {cols} FROM nodes;"
            );

            conn.execute_batch(&insert_sql)?;
            conn.execute_batch("DROP TABLE nodes; ALTER TABLE _nodes_new RENAME TO nodes;")?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Migration v16: add creator_user_id on nodes ───
    if current_version < 16 {
        let nodes_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if !nodes_sql.contains("creator_user_id") {
            conn.execute_batch("ALTER TABLE nodes ADD COLUMN creator_user_id TEXT;")?;
        }
    }

    // ─── Migration v17: add creator_user_name on nodes + creator columns on comments ───
    if current_version < 17 {
        let nodes_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if !nodes_sql.contains("creator_user_name") {
            conn.execute_batch("ALTER TABLE nodes ADD COLUMN creator_user_name TEXT;")?;
        }

        let nc_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='node_comments'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if !nc_sql.contains("creator_user_id") {
            conn.execute_batch(
                "ALTER TABLE node_comments ADD COLUMN creator_user_id TEXT;
                 ALTER TABLE node_comments ADD COLUMN creator_user_name TEXT;",
            )?;
        }

        let ec_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='edge_comments'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if !ec_sql.contains("creator_user_id") {
            conn.execute_batch(
                "ALTER TABLE edge_comments ADD COLUMN creator_user_id TEXT;
                 ALTER TABLE edge_comments ADD COLUMN creator_user_name TEXT;",
            )?;
        }
    }

    // ─── Migration v18: add 'title' node_type CHECK (column-aware rebuild) ───
    if current_version < 18 {
        let needs_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'title'"))
            .unwrap_or(false);

        if needs_migration {
            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;

            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image', 'agent', 'paper_group', 'export', 'compare', 'title')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    pdf_path TEXT,
                    display_id TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    width REAL,
                    height REAL,
                    creator_user_id TEXT,
                    creator_user_name TEXT
                );
                ",
            )?;

            conn.execute_batch(
                "INSERT INTO _nodes_new (id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name)
                 SELECT id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name FROM nodes;"
            )?;
            conn.execute_batch("DROP TABLE nodes; ALTER TABLE _nodes_new RENAME TO nodes;")?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Migration v19: add 'nano_banana' node_type CHECK (column-aware rebuild) ───
    if current_version < 19 {
        let needs_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'nano_banana'"))
            .unwrap_or(false);

        if needs_migration {
            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;

            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image', 'agent', 'paper_group', 'export', 'compare', 'title', 'nano_banana')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    pdf_path TEXT,
                    display_id TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    width REAL,
                    height REAL,
                    creator_user_id TEXT,
                    creator_user_name TEXT
                );
                ",
            )?;

            conn.execute_batch(
                "INSERT INTO _nodes_new (id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name)
                 SELECT id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name FROM nodes;"
            )?;
            conn.execute_batch("DROP TABLE nodes; ALTER TABLE _nodes_new RENAME TO nodes;")?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Migration v20: add 'table' node_type CHECK (column-aware rebuild) ───
    if current_version < 20 {
        let needs_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'table'"))
            .unwrap_or(false);

        if needs_migration {
            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;

            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image', 'agent', 'paper_group', 'export', 'compare', 'title', 'nano_banana', 'table')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    pdf_path TEXT,
                    display_id TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    width REAL,
                    height REAL,
                    creator_user_id TEXT,
                    creator_user_name TEXT
                );
                ",
            )?;

            conn.execute_batch(
                "INSERT INTO _nodes_new (id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name)
                 SELECT id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name FROM nodes;"
            )?;
            conn.execute_batch("DROP TABLE nodes; ALTER TABLE _nodes_new RENAME TO nodes;")?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Migration v21: add 'render' node_type CHECK (column-aware rebuild) ───
    if current_version < 21 {
        let needs_migration: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(|sql| !sql.contains("'render'"))
            .unwrap_or(false);

        if needs_migration {
            conn.execute_batch("PRAGMA foreign_keys=OFF;")?;

            conn.execute_batch(
                "
                CREATE TABLE _nodes_new (
                    id TEXT PRIMARY KEY,
                    layer_id TEXT NOT NULL REFERENCES layers(id),
                    node_type TEXT NOT NULL CHECK(node_type IN ('core', 'paper', 'user_doc', 'agent_proposal', 'deleted', 'junction', 'image', 'agent', 'paper_group', 'export', 'compare', 'title', 'nano_banana', 'table', 'render')),
                    title TEXT NOT NULL,
                    content TEXT,
                    bibtex TEXT,
                    metadata TEXT,
                    pdf_path TEXT,
                    display_id TEXT,
                    position_x REAL NOT NULL DEFAULT 0,
                    position_y REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ghost', 'dismissed')),
                    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'agent')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    width REAL,
                    height REAL,
                    creator_user_id TEXT,
                    creator_user_name TEXT
                );
                ",
            )?;

            conn.execute_batch(
                "INSERT INTO _nodes_new (id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name)
                 SELECT id, layer_id, node_type, title, content, bibtex, metadata, pdf_path, display_id, position_x, position_y, status, created_by, created_at, updated_at, width, height, creator_user_id, creator_user_name FROM nodes;"
            )?;
            conn.execute_batch("DROP TABLE nodes; ALTER TABLE _nodes_new RENAME TO nodes;")?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        }
    }

    // ─── Update schema version to latest ───
    conn.execute_batch(&format!(
        "DELETE FROM schema_version; INSERT INTO schema_version (version) VALUES ({SCHEMA_VERSION});"
    ))?;

    Ok(())
}

impl Database {
    /// Create a new Database with an in-memory SQLite connection.
    /// The app starts with no file open; the user can Save As to persist.
    pub fn new() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        initialize_schema(&conn)?;

        let initial_tab_id = uuid::Uuid::new_v4().to_string();
        let initial_tab = TabInfo {
            id: initial_tab_id.clone(),
            file_path: None,
            snapshot_path: None,
            display_name: "Untitled".to_string(),
            is_dirty: false,
        };

        Ok(Database {
            conn: Mutex::new(conn),
            current_path: Mutex::new(None),
            tabs: Mutex::new(vec![initial_tab]),
            active_tab_id: Mutex::new(initial_tab_id),
        })
    }

    /// Swap the internal connection to a new one.
    /// The old connection is dropped (closed) when replaced.
    pub fn swap_connection(
        &self,
        new_conn: Connection,
        new_path: Option<PathBuf>,
    ) -> std::result::Result<(), String> {
        {
            let mut conn_guard = self.conn.lock().map_err(|e| e.to_string())?;
            *conn_guard = new_conn;
        }
        {
            let mut path_guard = self.current_path.lock().map_err(|e| e.to_string())?;
            *path_guard = new_path;
        }
        Ok(())
    }

    /// Get the current file path (None if unsaved / in-memory).
    pub fn get_current_path(&self) -> std::result::Result<Option<PathBuf>, String> {
        let guard = self.current_path.lock().map_err(|e| e.to_string())?;
        Ok(guard.clone())
    }
}

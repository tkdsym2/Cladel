# Cladel -- Research Thought-Mapping Application (Tauri v2)

Tauri v2 + React + TypeScript desktop app for researchers to organize thinking as a knowledge graph. Combines literature management (PDF import), personal thought mapping, and AI agents (Claude/Gemini APIs) as collaborative research partners. Single `.cld` file format (SQLite, DELETE journal mode; legacy `.klv` and `.tmgx` also supported for reading).

## Tech Stack

- **Framework**: Tauri v2 (Rust backend + WebView frontend)
- **Frontend**: React 19.2 / TypeScript 5.9, Vite 7.3, react-router-dom 7.13 (HashRouter), @xyflow/react 12.10 (React Flow), Zustand 5.0, @mui/icons-material 7.3, Tailwind CSS 4.2 + @mui/material 7.3 + @emotion, react-markdown 10, rehype-raw 7, remark-gfm 4
- **Backend**: rusqlite 0.31 (bundled), reqwest 0.12, pdf-extract 0.7, image 0.24, regex 1, serde/chrono/uuid, tauri-plugin-store 2, tauri-plugin-updater 2 + tauri-plugin-process 2 (auto-update), tauri-plugin-shell 2 + tauri-plugin-dialog 2, base64 0.22, genpdf 0.2 + pulldown-cmark 0.12 (Markdown->PDF), typst 0.14 + typst-as-lib 0.15 + typst-pdf 0.14 + typst-render 0.14 (Typst typesetting + preview)
- **File Format**: `.cld` (SQLite, DELETE journal mode, single-file; legacy `.klv` and `.tmgx` also supported for reading)
- **App ID**: `com.cladel.desktop`

---

## Core Concepts

### Node Types (14 active + deleted placeholder + import temp)

| Type | Visual | Key Behavior |
|------|--------|-------------|
| **core** | Deep blue (#1e3a5f), 2px solid #1e40af, 280x210 | One per layer. Markdown. Auto-save 2s. NOT deletable. |
| **paper** | Light green (#f0fdf4), 1px solid #059669, 280x210 | Created via PDF import. BibTeX metadata. PDF viewing. Paper chat. |
| **user_doc** | Amber (#fffbeb), 1px solid #d97706, 280x210 | UI label: "Edit". Raw **Typst** source (preview via render node). Auto-save 800ms. Content Pull. display_id editable. |
| **agent_proposal** | Purple rgba(124,58,237,0.12), 1px dashed #7c3aed | AI suggestions. Accept -> Paper/Edit. Dismiss -> removed. Not user-editable. |
| **agent** | Indigo #e0e7ff, 1px solid #4338ca, 280x210 | Chat-based AI assistant. BFS context. Creates/updates output Edit nodes. SmartToy icon. |
| **image** | Teal (#f0fdfa), 1px solid #0891b2, 280x210 | File path reference (not BLOB). Thumbnail via convertFileSrc. Error state if path broken. |
| **paper_group** | Green composite | Groups multiple Paper nodes. Collapsible. Metadata: `{ member_node_ids: string[] }`. |
| **export** | Rose #ffe4e6, 1px solid #e11d48, 280x210 | PDF export node. Connected Edit nodes = sections. Citation styles (IEEE/APA). |
| **compare** | Cyan #e0f2fe, 1px solid #0284c7, 280x210 | Connects 2 Edit nodes, shows word-level diff. CompareArrows icon. |
| **title** | Stone #e7e5e4, 1px solid #78716c, 280x210 | Document title page for PDF export. Authors + affiliations metadata. Title icon. |
| **table** | Teal #ccfbf1, 1px solid #0f766e, 280x210 | Manual grid OR CSV/XLSX/ODS import. `TableModel` metadata. Cell refs in export. TableChart icon. |
| **render** | Purple #f3e8ff, 1px solid #9333ea, 300x360 | Compiles connected Note (Typst) nodes -> live PDF preview (PNG pages). `RenderModel` metadata. Preview icon. |
| **deleted** | Gray rgba(229,231,235,0.3), 1px dashed #d1d5db, circle | Soft-delete placeholder. Preserves edges. Right-click -> "Remove completely". |
| **junction** | Dark gray (#4b5563), circle, ~16x16 | Edge branching point. "Dissolve junction" merges back. |
| **import** | Gray dashed, temp React-only | NOT a DB node_type. Temporary placeholder for file import. Auto-detects PDF vs image. |

All nodes: 4-directional handles (left/right source+target), NodeResizer, **4:3 landscape defaults** (280x210). All canvas nodes show `ProcessingIndicator` (spinning SmartToy icon, amber #f59e0b) when agent is processing. Paper/Edit/Image nodes support **Color Mode** (user-based coloring by creator_user_id).

### Display ID System

Every node gets a globally unique `display_id` (across ALL layers). **The display_id IS the node's visible name**: canvas cards and detail panels show it as the header (monospace); the separate "Title" edit UI was removed. Numbering is MAX+1 per prefix across all layers; paper citation keys are deduped with `_2`, `_3`... suffixes on import (`unique_display_id` in nodes.rs). The DB `title` column remains as *data*, surfaced only where it means something: paper bibliographic title (card metadata line, from BibTeX), image figure caption ("Caption" field in panel, printed via `{{@image_id}}`), title node's Document Title, export node's Document Title (PDF fallback when no Title node), agent-output note descriptions.

| Node Type | Prefix | Editable |
|-----------|--------|----------|
| core | `Core{layer_number}` | No |
| paper | BibTeX citation key or `paper_{N}` | Via BibTeX edit (auto-syncs) |
| user_doc | `note_{N}` | Yes (update_display_id command) |
| agent_proposal | `agent_{N}` | No |
| agent | `agent_node_{N}` | No |
| image | `image_{N}` | No |
| export | `export_{N}` | No |
| compare | `compare_{N}` | No |
| title | `title_{N}` | No |
| table | `table_{N}` | No |
| render | `render_{N}` | No |

### Edges

First-class entities with weight 1-5 (visual thickness), bezier curves, 4-directional handles. Click -> action popover (Edit Annotations / Edge Properties / Add Branch Point). Badge for comment count. Reconnectable. No self-loops or duplicates (enforced server-side in `create_edge`). Directional arrows via `<polygon>` triangle (not SVG markers -- WebKit breaks them).

### Layer System

Layers = stages of thinking evolution. Layer 1 default, non-deletable. Vertical left panel (higher at top). Creating new layer: inherits Core content (or optionally from a source node). Each layer has independent nodes/edges.

### Comment System

**node_comments**: Paper + Edit + Image + Compare nodes. **edge_comments**: conversation threads on edges. Both support user/agent author types, inline editing, count badges (blue #2563eb, 30px circle at node top-right). Comments support **@Agent invocation** and **@Mention references**. Comments include `creator_user_id`/`creator_user_name`.

### Color Mode System

Toggle between "Type Mode" (nodes colored by node type, default) and "User Mode" (Paper/Edit/Image nodes colored by `creator_user_id`). Press **C** key or click palette button in upper-left indicator bar. 8-color deterministic palette in `src/lib/userColors.ts`. Core/Agent/Export/Compare/deleted/junction keep functional colors in both modes.

### User Identity System

Users register with a name (stored in settings via tauri-plugin-store). `creator_user_id`/`creator_user_name` attached to nodes and comments. `CreatorLabel` component shows "You" or creator name on nodes. `userStore.ts` manages identity state.

---

## Data Model (SQLite Schema)

```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE layers (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    layer_number INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE nodes (
    id TEXT PRIMARY KEY, layer_id TEXT NOT NULL REFERENCES layers(id),
    node_type TEXT NOT NULL CHECK(node_type IN ('core','paper','user_doc','agent_proposal','deleted','junction','image','agent','paper_group','export','compare','title','nano_banana','table','render')),
    title TEXT NOT NULL, content TEXT, bibtex TEXT, metadata TEXT,
    pdf_path TEXT, display_id TEXT,
    position_x REAL NOT NULL DEFAULT 0, position_y REAL NOT NULL DEFAULT 0,
    width REAL, height REAL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ghost','dismissed')),
    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user','agent')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    creator_user_id TEXT, creator_user_name TEXT
);
CREATE TABLE edges (
    id TEXT PRIMARY KEY, layer_id TEXT NOT NULL REFERENCES layers(id),
    source_node_id TEXT NOT NULL REFERENCES nodes(id),
    target_node_id TEXT NOT NULL REFERENCES nodes(id),
    source_handle TEXT, target_handle TEXT,
    weight INTEGER NOT NULL DEFAULT 3 CHECK(weight BETWEEN 1 AND 5),
    comment TEXT DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user','agent')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE core_versions (id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id),
    version_number INTEGER NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE note_versions (id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE node_comments (id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL CHECK(author_type IN ('user','agent')),
    content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    creator_user_id TEXT, creator_user_name TEXT);
CREATE TABLE edge_comments (id TEXT PRIMARY KEY, edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL CHECK(author_type IN ('user','agent')),
    content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    creator_user_id TEXT, creator_user_name TEXT);
CREATE TABLE node_images (id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL, mime_type TEXT NOT NULL, original_filename TEXT NOT NULL,
    image_width INTEGER, image_height INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE agent_usage_log (id TEXT PRIMARY KEY, invocation_type TEXT NOT NULL, model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL,
    success INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE agent_node_messages (id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'agent')),
    content TEXT NOT NULL, output_node_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE schema_version (version INTEGER NOT NULL);
```

### Migrations (db.rs `initialize_schema()`)

`SCHEMA_VERSION` = 21. Version-tracked via `schema_version` table. Fast path: skip all if `current_version >= SCHEMA_VERSION`. Append-only -- never reorder.

| # | Migration |
|---|-----------|
| 1 | Legacy edge_comments (INSERT OR IGNORE from edges.comment) |
| 2 | 'deleted' node_type CHECK (table rebuild) |
| 3 | source_handle/target_handle on edges (ALTER TABLE) |
| 4 | 'junction' node_type CHECK (table rebuild) |
| 5 | width/height on nodes (ALTER TABLE) |
| 6 | pdf_path on nodes (ALTER TABLE) |
| 7 | 'image' node_type CHECK (column-aware table rebuild) |
| 8 | node_images table (CREATE IF NOT EXISTS) |
| 9 | display_id on nodes (ALTER TABLE + populate existing) |
| 10 | agent_usage_log table + index |
| 11 | 'agent' node_type CHECK (column-aware table rebuild) |
| 12 | agent_node_messages table + index |
| 13 | 'paper_group' node_type CHECK (column-aware table rebuild) |
| 14 | 'export' + 'compare' node_type CHECK (column-aware table rebuild) |
| 15 | 'compare' node_type CHECK (column-aware table rebuild, idempotent) |
| 16 | creator_user_id on nodes (ALTER TABLE) |
| 17 | creator_user_name on nodes + creator columns on node_comments/edge_comments |
| 18 | 'title' node_type CHECK (column-aware table rebuild with all columns) |
| 19 | 'nano_banana' node_type CHECK (column-aware table rebuild with all columns) |
| 20 | 'table' node_type CHECK (column-aware table rebuild with all columns) |
| 21 | 'render' node_type CHECK (column-aware table rebuild with all columns) |

**Key design decisions**:
- .cld stores text/metadata only, NOT binary data. PDFs/images referenced by local file path.
- DELETE journal mode = single portable file, no -shm/-wal sidecars.
- App starts with in-memory DB; no file created until explicit Save As.
- Saving is atomic (`file_commands::save_connection_to_path`): `VACUUM INTO` a `{target}.{uuid}.tmp` sidecar, then `std::fs::rename` over the target (crash-safe). Save As reopens the new path as the working copy; `reload_active_tab_from_disk` discards the working copy and re-reads from disk (Revert).
- `Mutex<Connection>` for thread-safe single-user access. `Database` struct also holds `tabs: Mutex<Vec<TabInfo>>` and `active_tab_id: Mutex<String>` for multi-tab support.
- Edges have no ON DELETE CASCADE on node references (soft-delete preserves edges).
- `core_versions`/`note_versions` tables exist in DB but **version history UI has been removed**.
- `'nano_banana'` is still a valid `node_type` in the CHECK constraint (migration v19), but the **NanoBanana feature/UI was removed** (unreliable Gemini image API). It is kept as a reserved enum value for backward-compatibility with older files; no new nano_banana nodes can be created.

---

## Architecture

### File Map

**Frontend -- 93 files, ~32,600 lines**

| Path | Lines | Purpose |
|------|------:|---------|
| `src/App.tsx` | 830 | Main app shell: initialization, tab/layer/delete orchestration, layout composition, dialog state, startup update check |
| `src/main.tsx` | 26 | Entry: HashRouter with 5 routes: `/`, `/node-detail/:nodeId/:layerId`, `/agent-console`, `/manual`, `/note-help` |
| `src/types/index.ts` | 760 | All shared interfaces, SYSTEM_DEFAULTS, TabNodeType, TableModel/TableSource, RenderModel, ExportStyleConfig, ExportTitlePage |
| `src/lib/tauri-commands.ts` | 768 | Typed wrappers for 113 of 115 Tauri invoke commands (all except backend-only get_api_key/get_gemini_api_key) |
| `src/lib/detached-window.ts` | 180 | Multi-window management (open/focus/closeAll); spawns node-detail, agent-console, manual, note-help windows |
| `src/lib/sync-events.ts` | 183 | Cross-window event bus (node-updated, node-deleted, comments-changed, file-changed, graph-changed, settings-changed, export-started, export-finished) |
| `src/lib/userColors.ts` | 21 | Deterministic 8-color palette for user-based node coloring |
| `src/lib/i18n.ts` | 103 | Bilingual EN/JP translation table + `useT()` hook (active language from UI preferences) |
| **Stores (13)** | | |
| `src/store/graphStore.ts` | 1,862 | Nodes, edges, selection, comment counts, CRUD, ghost nodes, junctions, groups, colorMode |
| `src/store/agentStore.ts` | 382 | Global agent: status, suggestions, history, context building, cooldown |
| `src/store/tabStore.ts` | 223 | Tab lifecycle: new/open/switch/close/reload-from-disk, reinitialize on switch |
| `src/store/fileStore.ts` | 163 | File ops (new/open/save/save-as), delegates to tabStore, auto-dirty |
| `src/store/exportStore.ts` | 62 | PDF export progress, error state, cross-window coordination |
| `src/store/renderStore.ts` | 50 | Transient render-node preview state (status/pages/error), keyed by node id |
| `src/store/settingsStore.ts` | 98 | API key status, AgentCapabilities, UIPreferences |
| `src/store/syncStore.ts` | 96 | Cloud sync state (Supabase) |
| `src/store/layerStore.ts` | 58 | Layer list, current layer, smart switch on delete |
| `src/store/agentNodeStore.ts` | 44 | Per-agent-node processing state (Set + Map) |
| `src/store/userStore.ts` | 44 | User identity (userId, userName, isRegistered) |
| `src/store/projectStore.ts` | 35 | Project list, current project |
| `src/store/consoleStore.ts` | 35 | Agent console log entries (max 500), feeds the `/agent-console` window |
| **Hooks** | | |
| `src/hooks/useIdleDetector.ts` | 65 | Document-level idle detection (6 event types) |
| `src/hooks/useAutonomousTrigger.ts` | 53 | Idle -> auto invoke_agent (shared cooldown) |
| `src/hooks/useStructureTrigger.ts` | 173 | Structure change -> BFS anomaly check -> trigger (3s debounce) |
| **Graph Components** | | |
| `src/components/graph/GraphCanvas.tsx` | 1,661 | Canvas: nodeTypes/edgeTypes, clipboard, connection normalization, Tab-to-Create, drag-drop, edge merge, keyboard handler (V/G/C keys) |
| `src/components/graph/CoreNode.tsx` | 118 | Core node |
| `src/components/graph/PaperNode.tsx` | 244 | Paper node (PDF warning icon, metadata, user color) |
| `src/components/graph/UserDocNode.tsx` | 161 | Edit node (content preview, user color) |
| `src/components/graph/ImageNode.tsx` | 237 | Image thumbnail + error state + user color |
| `src/components/graph/GhostNode.tsx` | 283 | Agent proposal (accept/dismiss, type badge) |
| `src/components/graph/AgentNode.tsx` | 159 | Agent node (SmartToy icon, processing/idle/error) |
| `src/components/graph/ExportNode.tsx` | 156 | Export node (PictureAsPdf icon, section count) |
| `src/components/graph/CompareNode.tsx` | 144 | Compare node (CompareArrows icon) |
| `src/components/graph/TitleNode.tsx` | 160 | Title node card (Title icon, subtitle, author count) |
| `src/components/graph/TableNode.tsx` | 219 | Table node (TableChart icon, preview grid, mode badge: manual/imported/unconfigured) |
| `src/components/graph/RenderNode.tsx` | 194 | Render node (Preview icon, first-page thumbnail via renderStore, status badge) |
| `src/components/graph/ImportNode.tsx` | 133 | Temp import placeholder (file dialog trigger) |
| `src/components/graph/DeletedNode.tsx` | 165 | Soft-delete circle (tooltip with original title) |
| `src/components/graph/JunctionNode.tsx` | 69 | Edge branch point dot |
| `src/components/graph/PaperGroupNode.tsx` | 221 | Paper group with collapse/expand |
| `src/components/graph/ProcessingIndicator.tsx` | 37 | Spinning SmartToy icon for agent processing state |
| `src/components/graph/CreatorLabel.tsx` | 46 | Shows creator name on nodes ("You" or user name) |
| `src/components/graph/GroupingButton.tsx` | 73 | "Group" button for multi-selected papers |
| `src/components/graph/GroupNamePopover.tsx` | 115 | Popover input for group name |
| `src/components/graph/AnnotatedEdge.tsx` | 226 | Bezier edge + weight + badge + polygon arrow |
| `src/components/graph/TabCreatePopover.tsx` | 300 | Light-themed popover (10 options: Edit/Paper/Image/Agent/Import/Export/Compare/Title/Table/Render), bilingual labels |
| `src/components/graph/CanvasControls.tsx` | 124 | Zoom in/out/fit, agent panel toggle, minimap toggle |
| `src/components/graph/CursorModeIndicator.tsx` | 196 | Upper-left bar: Move/Select pills, Color Mode toggle, shortcut help |
| `src/components/graph/CustomMiniMap.tsx` | 258 | SVG minimap (160x120) with color-coded nodes + edges |
| `src/components/graph/EdgePopover.tsx` | 525 | Edge annotation modal: weight slider, comment thread, delete |
| `src/components/graph/EdgeActionMenu.tsx` | 275 | Edge context menu: Edit Annotations / Properties / Branch Point |
| `src/components/graph/ContextMenu.tsx` | 359 | Canvas/node right-click menus (unified "Import File", Add Agent) |
| `src/components/graph/NodeAccordionSection.tsx` | 86 | Collapsible section for node detail panel |
| `src/components/graph/useConnectedDisplayIds.ts` | 30 | Hook: connected node display_ids |
| `src/components/graph/NodePorts.tsx` | 33 | Shared TouchDesigner-style port tabs (4 handles, ids/order preserved; geometry in index.css) |
| **Panel Components** | | |
| `src/components/panels/NodeDetailPanel.tsx` | 2,685 | Right sidebar: polymorphic viewer + CommentSection with @Agent |
| `src/components/panels/AgentNodeViewer.tsx` | 1,101 | Agent node chat interface (messages, send, output tracking) |
| `src/components/panels/AgentPanel.tsx` | 984 | Global agent: queries, suggestions, history, status |
| `src/components/panels/ExportNodeViewer.tsx` | 754 | Export node: display_id + Document Title, sections, citations, reorder, style config, generate PDF (Markdown genpdf or Typst mode when render nodes connected) |
| `src/components/panels/TitleNodeViewer.tsx` | 381 | Title node editor: title, subtitle, authors with affiliations |
| `src/components/panels/CompareNodeViewer.tsx` | 484 | Compare node: word-level diff of 2 connected Edit nodes (LCS algorithm) |
| `src/components/panels/TableNodeViewer.tsx` | 600 | Table node editor: manual grid edit + CSV/XLSX/ODS import (import_table_file), cell selection copies {@id[r,c]} ref |
| `src/components/panels/RenderNodeViewer.tsx` | 211 | Render node viewer: multi-page Typst PDF preview (PNG), re-render button, compile-error panel |
| `src/components/panels/NoteEditorWithPull.tsx` | 916 | Textarea with Content Pull + @mention; `format` prop (Markdown+preview for Core, raw Typst for Edit) |
| `src/components/panels/ContentPullPopover.tsx` | 508 | Dark-themed two-step content selection popover |
| `src/components/panels/MentionPopover.tsx` | 392 | @mention autocomplete for node references |
| `src/components/panels/DetachedNodeDetail.tsx` | 228 | Standalone node detail window (cross-window sync) |
| `src/components/panels/MarkdownPreview.tsx` | 132 | Markdown preview with remark-gfm and rehype-raw |
| `src/components/panels/AgentConsole.tsx` | 237 | `/agent-console` window: live `agent-console-log` event stream, level/source-tagged entries, auto-scroll |
| `src/components/panels/ManualWindow.tsx` | 615 | `/manual` window: in-app help (shortcuts, features, getting-started) |
| `src/components/panels/NoteHelpWindow.tsx` | 219 | `/note-help` window: bilingual Note/Typst writing help (/import, @mention, citations, images, table refs) |
| `src/components/panels/FloatingDetailPanel.tsx` | 108 | Floating wrapper around the node detail panel |
| `src/components/panels/MultiSelectPanel.tsx` | 39 | Actions panel shown when multiple nodes are selected |
| **Dialog Components** | | |
| `src/components/dialogs/SettingsDialog.tsx` | 2,071 | API keys (Anthropic+Gemini), capabilities, UI prefs, usage, paper prompt, sync, user identity |
| `src/components/dialogs/PdfImportDialog.tsx` | 733 | PDF import: 6-phase state machine with error recovery |
| `src/components/dialogs/WelcomeDialog.tsx` | 610 | Launch dialog: recent files, create new, open existing |
| `src/components/dialogs/CloudOpenDialog.tsx` | 575 | Cloud file browser (Supabase sync) |
| `src/components/dialogs/ExportBibtexDialog.tsx` | 471 | Tri-state checkbox tree export to .bib |
| `src/components/dialogs/SyncDialog.tsx` | 440 | Cloud sync management dialog |
| `src/components/dialogs/NewLayerDialog.tsx` | 389 | Layer creation with optional source node |
| `src/components/dialogs/ImageImportDialog.tsx` | 386 | Image import + validation + positionOverride |
| `src/components/dialogs/ExportStyleConfigDialog.tsx` | 681 | PDF export style config (fonts, sizes, margins, alignment, markers, line numbers) with preview |
| `src/components/dialogs/ConfirmDialogs.tsx` | 238 | Shared confirm dialogs (Delete, BatchDelete, EdgeDelete, UnsavedChanges) |
| `src/components/dialogs/UpdateDialog.tsx` | 334 | Auto-update dialog: available version, download + install progress, relaunch |
| `src/components/dialogs/PdfExportProgressDialog.tsx` | 176 | PDF export progress bar (self-initiated exports) |
| **Layout Components** | | |
| `src/components/layers/LayerBar.tsx` | 313 | Left sidebar: layers (sorted), add/delete, Export BibTeX |
| `src/components/FileTabBar.tsx` | 250 | Top tab bar: open tabs, active indicator, close/new buttons, settings |
| `src/components/StatusBar.tsx` | 152 | Bottom status bar: node/edge counts, API status, agent status, sync |
| `src/components/ResizeHandle.tsx` | 22 | Simple sidebar resize handle with hover state |

**Backend -- 38 files, ~15,070 lines**

| Path | Lines | Purpose |
|------|------:|---------|
| `src-tauri/src/main.rs` | 6 | Calls `cladel_app_lib::run()` |
| `src-tauri/src/lib.rs` | 299 | App entry: 115 command registrations, native menu, 5 plugins (store/shell/dialog/updater/process) |
| `src-tauri/src/db.rs` | 1,116 | SQLite schema, SCHEMA_VERSION=21, 21 migrations, Database+TabInfo |
| `src-tauri/src/commands/mod.rs` | 24 | Module declarations (24 submodules) |
| `src-tauri/src/commands/nodes.rs` | 600 | CRUD + soft_delete + restore + update_display_id + update_paper_bibtex |
| `src-tauri/src/commands/edges.rs` | 225 | CRUD (rejects self-loops + duplicates) + restore with handle persistence, weight 1-5 |
| `src-tauri/src/commands/layers.rs` | 279 | CRUD + Core node creation per layer + source node inheritance |
| `src-tauri/src/commands/tab_commands.rs` | 466 | Multi-tab: create/switch/close/open/reload-from-disk, open_sample_as_new, snapshot/restore via VACUUM INTO |
| `src-tauri/src/commands/file_commands.rs` | 178 | file_new/open/save/save_as (atomic temp+rename); sample loaded via tab_commands::open_sample_as_new |
| `src-tauri/src/commands/core_versions.rs` | 115 | save, list, diff (backend exists, frontend no longer calls) |
| `src-tauri/src/commands/note_versions.rs` | 74 | save, list (backend exists, frontend no longer calls) |
| `src-tauri/src/commands/node_comments.rs` | 177 | CRUD + batch count (dynamic IN clause) |
| `src-tauri/src/commands/edge_comments.rs` | 176 | CRUD + batch count |
| `src-tauri/src/commands/agent_node_messages.rs` | 92 | CRUD for agent node chat messages |
| `src-tauri/src/commands/junctions.rs` | 321 | split_edge_at_junction, dissolve_junction |
| `src-tauri/src/commands/bibtex.rs` | 409 | Hand-written BibTeX parser + entry generator (no external crate) |
| `src-tauri/src/commands/literature.rs` | 406 | Semantic Scholar API (rate-limited: 90/5min sliding window) |
| `src-tauri/src/commands/pdf_import.rs` | 638 | import_pdf (DOI->S2/CrossRef->Claude), extract_pdf_with_claude |
| `src-tauri/src/commands/table_import.rs` | 142 | import_table_file (CSV/TSV/XLSX/XLS/ODS -> rows[][]) |
| `src-tauri/src/commands/typst_engine.rs` | 150 | In-process Typst engine (typst-as-lib): compile source -> PDF / per-page PNG, bundled fonts |
| `src-tauri/src/commands/typst_render.rs` | 357 | render_typst_preview + generate_typst_export_pdf: gather Notes, translate {@..} refs to Typst, compile |
| `src-tauri/src/commands/pdf_export.rs` | 2,183 | Export node -> PDF (genpdf + pulldown-cmark), IEEE/APA citations, style config, title page, line numbers |
| `src-tauri/src/commands/image_import.rs` | 315 | validate, create, check, re-link, open_external, paper PDF path |
| `src-tauri/src/commands/export.rs` | 283 | BibTeX export by layer/selection, native save dialog |
| `src-tauri/src/commands/settings.rs` | 686 | API keys (Anthropic+Gemini), AgentCapabilities, UIPreferences, recent files, paper prompt, Supabase config, user identity |
| `src-tauri/src/commands/usage.rs` | 223 | Usage summary, history, clear, cost estimation |
| `src-tauri/src/commands/sync.rs` | 445 | Cloud sync via Supabase (upload/download/status/list/stats) |
| **Agent subsystem** | | |
| `src-tauri/src/commands/agent/mod.rs` | 475 | Public API, types (AgentError, AgentService trait), invoke_agent, capability guards |
| `src-tauri/src/commands/agent/agent_node.rs` | 634 | invoke_agent_node: BFS context, chat, output node creation, provider selection |
| `src-tauri/src/commands/agent/paper_chat.rs` | 475 | Paper summarize + chat via Gemini (PDF base64 upload) |
| `src-tauri/src/commands/agent/comment_agent.rs` | 351 | invoke_agent_comment: @Agent in node comment threads |
| `src-tauri/src/commands/agent/claude_service.rs` | 171 | ClaudeAgentService: Anthropic API call + retry logic (2x after 2s, 5s) |
| `src-tauri/src/commands/agent/gemini_service.rs` | 260 | GeminiAgentService: Google Gemini API call + retry logic |
| `src-tauri/src/commands/agent/stub_service.rs` | 239 | StubAgentService: offline mode (not currently used) |
| `src-tauri/src/commands/agent/prompt.rs` | 252 | build_system_prompt(), build_user_message() |
| `src-tauri/src/commands/agent/parser.rs` | 489 | 4-tier JSON extraction, validation, fuzzy ID resolution |
| `src-tauri/src/commands/agent/context.rs` | 332 | BFS distance, relevance scoring, tiered token budget |
| `src-tauri/src/commands/agent/analysis.rs` | 730 | GraphAnomalies + ContentSignals for autonomous triggers |

### UI Layout

```
+--------+------------------------------+----------------------------+
|  File Tab Bar (Untitled* | paper.cld | +)              [Settings] |
+--------+------------------------------+----------------------------+
| Layers |  [< Move | Select] [Color]  |  Node Detail Panel         |
| (160px)|       Graph Canvas           |  (Core/Paper/Edit/Image/   |
| Layer 3|       (React Flow)           |   Ghost/Agent/Export/       |
| Layer 2|                              |   Compare)                 |
| Layer 1|  Tab -> create connected node|  OR Agent Panel            |
|--------|  Right-click -> context menu |  (resizable, min 280px)    |
| Export |  PDF/Image drag-and-drop     |  Double-click -> detach    |
| BibTeX |                              |                            |
+--------+------------------------------+----------------------------+
|  Nodes: 5  Edges: 3   Claude API: *   Agent: On / Auto *          |
+-------------------------------------------------------------------+
```

---

## Registered Tauri Commands (115 total)

Counted from `generate_handler![]` in `lib.rs`:

| Category | Count | Commands |
|----------|------:|---------|
| File | 5 | `file_new`, `file_open`, `file_save`, `file_save_as`, `file_get_current_path` |
| Tabs | 9 | `open_sample_as_new`, `get_tabs`, `get_active_tab_id`, `create_tab`, `open_file_in_tab`, `switch_tab`, `close_tab`, `reload_active_tab_from_disk`, `update_tab_after_save` |
| Nodes | 8 | `create_node`, `update_node`, `delete_node`, `soft_delete_node`, `restore_node`, `get_nodes_by_layer`, `update_display_id`, `update_paper_bibtex` |
| Edges | 5 | `create_edge`, `update_edge`, `delete_edge`, `restore_edge`, `get_edges_by_layer` |
| Layers/Projects | 5 | `create_project`, `create_layer`, `delete_layer`, `get_layers`, `get_projects` |
| Core Versions | 3 | `save_core_version`, `get_core_versions`, `get_core_version_diff` |
| Note Versions | 2 | `save_note_version`, `get_note_versions` |
| BibTeX | 1 | `parse_bibtex` |
| Literature | 2 | `search_papers`, `get_paper_details` |
| Node Comments | 5 | `add_node_comment`, `get_node_comments`, `update_node_comment`, `delete_node_comment`, `get_node_comment_counts` |
| Edge Comments | 5 | `add_edge_comment`, `get_edge_comments`, `update_edge_comment`, `delete_edge_comment`, `get_edge_comment_counts` |
| Junctions | 2 | `split_edge_at_junction`, `dissolve_junction` |
| Agent | 5 | `invoke_agent`, `invoke_agent_node`, `invoke_agent_comment`, `invoke_paper_summarize`, `invoke_paper_chat` |
| Settings (Keys) | 8 | `save_api_key`, `get_api_key_status`, `get_api_key`*, `delete_api_key`, `save_gemini_api_key`, `get_gemini_api_key_status`, `get_gemini_api_key`*, `delete_gemini_api_key` |
| Settings (Other) | 14 | `save_agent_capabilities`, `get_agent_capabilities`, `get_ui_preferences`, `save_ui_preferences`, `get_recent_files`, `add_recent_file`, `remove_recent_file`, `get_paper_summary_prompt`, `save_paper_summary_prompt`, `reset_paper_summary_prompt`, `save_supabase_config`, `get_supabase_config`, `get_supabase_config_status`, `delete_supabase_config` |
| User Identity | 3 | `get_user_identity`, `register_user`, `update_user_name` |
| PDF Import | 2 | `import_pdf`, `extract_pdf_with_claude` |
| Table Import | 1 | `import_table_file` |
| Image Import | 8 | `validate_image_file`, `create_image_node`, `get_node_image_info`, `check_file_exists`, `update_node_image_path`, `open_file_external`, `set_paper_pdf_path`, `get_paper_pdf_path` |
| BibTeX Export | 3 | `get_paper_nodes_by_layers`, `export_bibtex_selected`, `export_bibtex_to_file` |
| PDF Export | 6 | `get_export_sections`, `update_export_section_order`, `update_export_citation_style`, `update_export_language`, `update_export_style_config`, `generate_export_pdf` |
| Typst Render | 2 | `render_typst_preview`, `generate_typst_export_pdf` |
| Usage | 3 | `get_usage_summary`, `get_usage_history`, `clear_usage_log` |
| Agent Messages | 3 | `add_agent_node_message`, `get_agent_node_messages`, `delete_agent_node_message` |
| Sync | 5 | `sync_list_remote`, `sync_check_status`, `sync_upload`, `sync_download`, `sync_get_remote_stats` |

*`get_api_key` and `get_gemini_api_key` are **backend-only** -- registered in generate_handler but intentionally have no frontend wrapper (raw keys used only server-side for API calls).

---

## Feature Specifications

### File Tab System

Browser-style multi-file tabs (FileTabBar + tabStore + tab_commands.rs):
- Each tab has its own SQLite connection. Switching snapshots current tab's in-memory DB to temp file (`{OS temp dir}/cladel-tabs/{tab_id}.cld`) via `VACUUM INTO`, then restores the target tab's connection.
- `tabStore.ts`: `newTab()`, `switchTab()`, `openFileInTab()`, `closeTab()` -- each calls backend + reinitializes all frontend stores.
- Closing last tab creates a fresh empty tab automatically.
- **Native menu**: Close Tab (Cmd+W).

### Agent Node System

Per-node AI assistant with persistent chat history and output node creation.

**Pipeline** (agent/agent_node.rs): `invoke_agent_node` -> provider select -> capability guard -> BFS context (up to 20 nodes; near nodes ≤30K chars, far nodes ≤3K chars) -> last 10 messages -> API call (max 16,384 tokens, retry 2x) -> create/update output Edit node -> return `InvokeAgentNodeResult`.

**Output nodes**: Agent creates `user_doc` Edit nodes positioned right of agent node (+width+100, stacked by 275px). Auto-creates edge: agent -> output.

### @Agent Comment Invocation

Include `@Agent` (case-insensitive) in any node's comment -> stripped -> `invoke_agent_comment` -> BFS context (up to 15 nodes) + PDF text extraction (target paper ≤4K chars, connected papers ≤2K chars each) -> last 10 comments -> API call (max 1024 tokens) -> agent comment posted.

### @Mention Popover

`MentionPopover.tsx`: inline autocomplete for referencing nodes by display_id. Triggered by `@` in textareas. Color-coded type badges. Keyboard navigation.

### Paper Chat (Gemini-Powered)

AI-assisted paper reading with full PDF context (paper_chat.rs):
- `invoke_paper_summarize(node_id, layer_id)` -- Sends PDF (base64) + customizable prompt to Gemini (8192 max tokens). Creates output Edit node with summary.
- `invoke_paper_chat(node_id, user_message)` -- Multi-turn Q&A about a paper. PDF + chat history sent to Gemini. Persistent via `agent_node_messages`.
- Uses Gemini 2.5 Flash with `inline_data` for PDF upload. 120s timeout.

### Export Node (PDF Export)

`node_type='export'` -- connects to Edit nodes (sections) and optionally a Title node (title page with authors/affiliations).

**Backend** (pdf_export.rs, 2,183 lines): Renders PDF via genpdf + pulldown-cmark. Bundled LiberationSerif fonts at `src-tauri/fonts/`. Mixed EN/JP font rendering.

**ExportStyleConfig** (JSON in export node metadata): `en_font_preset`, `jp_font_preset`, `title_size`, `section_heading_size`, `subsection_heading_size`, `body_size`, `line_spacing`, margins (top/bottom/left/right mm), `section_numbering`, `title_alignment` ("left"/"center"), `affiliation_marker` ("number"/"dagger"), `show_line_numbers`. Configured via ExportStyleConfigDialog.tsx.

**Title page**: Title node metadata stores `ExportTitlePage { subtitle, authors: ExportAuthor[] }`. Authors display superscript affiliation indices (Unicode ¹²³) or dagger symbols (†‡§) based on `affiliation_marker` setting.

**Citation syntax in Edit nodes**: `{@cite_key}` for papers, `{@A; @B; @C}` for multi-citation, `{{@image_id}}` for images, `{@table_id[row,col]}` for a single table cell value.

### Compare Node

`node_type='compare'` -- connects to exactly 2 Edit nodes and displays a word-level diff.

**Frontend** (CompareNodeViewer.tsx): Uses LCS algorithm to compute word-level differences. Highlights added (green) and removed (red) text. Swap button to change comparison direction.

### Table Node

`node_type='table'` (teal #0f766e, TableChart icon) -- a data table stored as `TableModel` JSON in metadata: `{ kind: "table", mode: "unconfigured"|"manual"|"imported", rows: string[][], source?: TableSource }`. `TableSource` keeps the import `format` (csv/xlsx), `filename`, absolute `path`, and `sheet`.

**Frontend** (TableNodeViewer.tsx, 640 lines): Two modes -- (1) **manual** grid editing (add/remove rows/cols, edit cells, debounced save), (2) **imported** from CSV/TSV/XLSX/XLS/ODS via `import_table_file` (Refresh re-reads the latest file state from the stored path). Copy button yields the node's `display_id` (`table_N`) for citation.

**Export integration**: Reference an individual cell from an Edit node with `{@table_id[row,col]}`; pdf_export.rs `split_citation_ids()` keeps the comma inside `[r,c]` as part of the id, then inlines the cell value.

### Render Node & Typst Pipeline

A second authoring pipeline (parallel to Markdown/genpdf) for writing in **Typst**:

- **Note (user_doc) nodes hold raw Typst source.** The Edit editor (`NoteEditorWithPull` with `format="typst"`) shows raw text only — no Markdown preview; Content Pull (`/`) and @Mention still insert graph refs. Core nodes stay Markdown.
- **`render` node** (`node_type='render'`, purple #9333ea): compiles the Typst of its connected Note nodes into a live **PDF preview** (PNG pages). Multiple Notes → one render (concatenated top-to-bottom, then left-to-right). Metadata: `RenderModel { kind:"render", citation_style }`.
- **Export from render(s):** connect render node(s) to an `export` node → ExportNodeViewer auto-detects "Typst mode" and `generate_typst_export_pdf` assembles all connected renders' Notes into one PDF (`typst-pdf`). The existing Markdown export (Edit→Export) is unchanged and still works.

**Engine** (`typst_engine.rs`): in-process via `typst-as-lib` (typst 0.14). Bundled fonts (`NotoSerifJP`/`NotoSansJP` + Liberation) → JP + Latin. `compile_to_pdf` / `compile_to_pngs` (typst-render @ 2.0 ppt). A temp work dir per node holds copied images + `refs.bib` and is the file-resolver root.

**Reference translation** (`typst_render.rs::assemble_typst_source`, reuses `split_citation_ids` / `parse_table_cell_ref` / `build_table_map` from pdf_export): `{@cite}` → Typst `@cite` (plus a `#bibliography("refs.bib", style:"ieee"|"apa")` generated from cited papers' BibTeX, entry key rewritten to the display_id); `{{@image_id}}` → `#figure(image(...), caption:[title])` (image copied into the work dir); `{@table_id[r,c]}` → the cell value. Data-derived text is Typst-escaped.

**Commands:** `render_typst_preview(render_node_id)` → `{ pages, page_count, note_count }`; `generate_typst_export_pdf(export_node_id, output_path)` (emits `export-progress`, reuses the export overlay). Frontend preview state lives in `renderStore` (transient — never dirties the file).

### Content Pull

Inline reference insertion for Edit (user_doc) and Core nodes. Type `/` on an empty line -> slash menu (`/import`) -> ContentPullPopover. Two-step: (1) Select connected node, (2) Choose what to pull (content, abstract, comments). The editor textarea has **no placeholder text** (it overlapped the "Type / for commands" focus hint); a **help window** (`NoteHelpWindow.tsx`, route `/note-help`, bilingual, opened via the ? button next to the note's display_id) opens as a separate always-usable window and documents Typst basics, `/import` + `@mention`, citations, `{{@image}}` and `{@table[r,c]}` usage.

### Tab-to-Create

**Keyboard shortcuts**: **Tab** -> right, **Shift+Tab** -> down, **Ctrl/Cmd+Tab** -> left, **Ctrl/Cmd+Shift+Tab** -> up.

**Popover** (TabCreatePopover.tsx): Light-themed, 10 options: 1. Edit, 2. Paper, 3. Image, 4. Agent, 5. Import File, 6. Export, 7. Compare, 8. Title, 9. Table, 0. Render. Number keys instant select. Labels are bilingual (EN/JP via i18n).

**Three creation paths**: (1) Tab during edge drag -> connected to drag-from node. (2) Tab with node selected -> connected. (3) Tab with no selection -> standalone at cursor.

### Import Node (Unified File Import)

Temporary React-only node. NOT a DB node_type. Created via Tab-to-Create or context menu. Click -> file dialog -> auto-detects PDF vs image -> opens appropriate dialog. Success creates real node at temp position.

### PDF Import Pipeline

**Backend** (`import_pdf`): extract text via pdf-extract (~10K chars) -> find DOI via regex -> Semantic Scholar/CrossRef lookup -> Claude fallback -> generate_bibtex -> PdfMetadata.

**Frontend** (PdfImportDialog.tsx) -- 6 phases: idle -> extracting -> preview -> success, with error recovery. Supports `positionOverride`.

### Paper Group System

Select 2+ papers -> "Group" button -> enter name -> creates `paper_group` node with `{ member_node_ids: string[] }`. Expand/collapse via context menu. `graphStore.expandedGroupIds` tracks state.

### Global Agent System

**Capability guards**: agent_enabled (master), autonomous_enabled, search_papers_enabled, suggest_connections_enabled, suggest_ideas_enabled, autonomous_idle_seconds (45), autonomous_cooldown_seconds (120).

**Pipeline**: Frontend buildContext -> Backend `invoke_agent` -> capability guard -> BFS -> relevance scoring -> 4-tier token budget -> Claude API -> 4-tier JSON extraction -> AgentResponse.

**Token budget**: Core 2,000 | Full content 4,400 | Title-only 1,800 | Edges 1,600 | Edge comments 3,200 chars.

**Autonomous triggers**: Time-based (useAutonomousTrigger: idle detection), Structure-based (useStructureTrigger: BFS anomaly, 3s debounce). Both share `lastAutonomousTriggerTime` cooldown.

**Graph analysis** (analysis.rs): Isolated nodes, star pattern, disconnected clusters, depth imbalance, unanswered questions, contradictions, orphan topics.

### AI Provider System

| Provider | Model | Used By | API |
|----------|-------|---------|-----|
| Claude (Anthropic) | `claude-sonnet-4-20250514` | Global agent, Agent node, Comment agent | `api.anthropic.com/v1/messages` |
| Gemini (Google) | `gemini-2.5-flash` | Paper summarize/chat, Agent node (optional), Comment agent (optional) | `generativelanguage.googleapis.com/v1beta/...` |

Both: retry 2x after 2s/5s, only on transient errors. Cost estimation: Sonnet $3/$15, Opus $15/$75, Haiku $0.25/$1.25, Gemini $0.15/$0.60 per M tokens.

### Multi-Window Node Detail

HashRouter: "/" = main, "/node-detail/:nodeId/:layerId" = detached. Double-click any node (except junction/deleted) -> detached WebviewWindow (500x700). Sync events via sync-events.ts. Auto-close on file operations. Three additional standalone windows: `/agent-console` (live agent log stream), `/manual` (in-app help), and `/note-help` (Note/Typst writing help, openable from the note editor's ? button — also from detached node windows via `core:webview:allow-create-webview-window` in node-detail.json), spawned via detached-window.ts and granted permissions by `capabilities/auxiliary-windows.json`.

### Cloud Sync (Supabase)

Optional cloud sync for .cld files via Supabase storage:
- **Backend** (sync.rs): `sync_list_remote`, `sync_check_status`, `sync_upload`, `sync_download`, `sync_get_remote_stats`
- **Frontend**: SyncDialog (management), CloudOpenDialog (browse remote files), syncStore (state)
- **Settings**: Supabase URL + anon key configured in SettingsDialog
- **StatusBar**: Shows sync status indicator (in sync / not uploaded / out of sync)

### Agent API Usage Monitor

`agent_usage_log` table, `get_usage_summary` (cost estimation), `get_usage_history`. Frontend: SettingsDialog "API Usage" section.

### Auto-Update System

GitHub-Releases-based auto-update (tauri-plugin-updater + tauri-plugin-process):
- **Config** (tauri.conf.json): `createUpdaterArtifacts: true`; `plugins.updater.endpoints` -> `https://github.com/tkdsym2/Cladel/releases/latest/download/latest.json`; minisign `pubkey`.
- **Frontend**: `UpdateDialog.tsx` checks for updates on startup (production only, from App.tsx) -> shows available version + download/install progress -> relaunch via plugin-process.
- **CI/Release**: `.github/workflows/release.yml` builds + signs artifacts and publishes `latest.json`. `scripts/check-release.mjs` (`npm run release:check`) is a pre-release guard.

### Agent Console & Manual Windows

- **Agent Console** (`/agent-console`, AgentConsole.tsx + consoleStore): standalone window listening to `agent-console-log` Tauri events emitted by every agent invocation (global / node / comment / paper). Level- and source-tagged entries, auto-scroll, clear, max 500.
- **Manual** (`/manual`, ManualWindow.tsx): in-app help/documentation (keyboard shortcuts, feature reference, getting-started).

### Internationalization (i18n)

`src/lib/i18n.ts`: lightweight bilingual (EN/JP) translation table with a `useT()` hook and a non-hook `t(key, lang)` helper. Active language reads from `UIPreferences.language` (`"en"` default | `"ja"`, persisted as `ui_language` in settings). Used across ~20 components (TabCreatePopover, TableNodeViewer, export UI, SettingsDialog, etc.). Distinct from the **export language** (`update_export_language`), which controls figure/section labels inside generated PDFs.

---

## Settings System

**Storage**: `~/Library/Application Support/com.cladel.desktop/settings.json` (tauri-plugin-store)

**API keys**: `anthropic_api_key`, `gemini_api_key`, `supabase_url`, `supabase_anon_key`
**User**: `user_id` (UUID), `user_name`
**Agent toggles** (all bool, default true): `agent_enabled`, `autonomous_enabled`, `search_papers_enabled`, `suggest_connections_enabled`, `suggest_ideas_enabled`
**Agent timing**: `autonomous_idle_seconds` (45), `autonomous_cooldown_seconds` (120)
**Node sizes** (f64, default 280x210): `core_default_width/height`, `paper_default_width/height`, `user_doc_default_width/height`, `ghost_default_width/height`, `image_default_width/height`
**Canvas**: `sidebar_default_width` (380), `canvas_background` (#f8fafc), `canvas_grid_enabled` (true), `canvas_grid_size` (20), `editor_font_size` (13)
**UI language**: `ui_language` ("en" default | "ja") -- drives the i18n `useT()` hook
**Other**: `paper_summary_prompt` (template), `recent_files` (JSON array, max 10)

---

## Visual Design Tokens

```
Node styles (border: unselected | selected, box-sizing: border-box):
  core:           bg #1e3a5f, 2px|4px solid #1e40af, text #fff, glow #60a5fa
  paper:          bg #f0fdf4, 1px|3px solid #059669, text #1f2937, glow #34d399
  user_doc(Edit): bg #fffbeb, 1px|3px solid #d97706, text #1f2937, glow #fbbf24
  agent_proposal: bg rgba(124,58,237,0.12), 1px|3px dashed #7c3aed, glow #a78bfa
  agent:          bg #e0e7ff (solid), 1px|3px solid #4338ca, glow #6366f1
  export:         bg #ffe4e6 (solid), 1px|3px solid #e11d48, glow #e11d48
  compare:        bg #e0f2fe (solid), 1px|3px solid #0284c7, glow #0284c7
  title:          bg #e7e5e4 (solid), 1px|3px solid #78716c, glow #78716c
  table:          bg #ccfbf1 (solid), 1px|3px solid #0f766e, glow #0f766e
  render:         bg #f3e8ff (solid), 1px|3px solid #9333ea, glow #9333ea
  deleted:        bg rgba(229,231,235,0.3), 1px|3px dashed #d1d5db, circle
  junction:       bg #4b5563, circle
  image:          bg #f0fdfa, 1px|3px solid #0891b2, glow #06b6d4
  paper_group:    bg #f0fdf4 composite, 1px solid #059669

User Color Mode palette (8 colors, deterministic hash):
  blue:    bg #dbeafe, border #3b82f6, glow #93c5fd
  pink:    bg #fce7f3, border #ec4899, glow #f9a8d4
  green:   bg #d1fae5, border #10b981, glow #6ee7b7
  yellow:  bg #fef3c7, border #f59e0b, glow #fcd34d
  violet:  bg #ede9fe, border #8b5cf6, glow #c4b5fd
  orange:  bg #ffedd5, border #f97316, glow #fdba74
  cyan:    bg #cffafe, border #06b6d4, glow #67e8f9
  fuchsia: bg #fdf2f8, border #d946ef, glow #f0abfc
  unknown: bg #f3f4f6, border #9ca3af, glow #d1d5db

Edge colors: default #94a3b8, hover #2563eb, selected #3b82f6 (+glow halo), agent-created #7c3aed (dashed), deleted #9ca3af. Wires: round caps, width = 1 + weight*0.6 (1.6-4.0px), curvature EDGE_CURVATURE=0.32 (exported from AnnotatedEdge; GraphCanvas hit-test/preview must reuse it), slim polygon arrowhead.
Ports (TouchDesigner-style): shared <NodePorts accent> component — rounded tabs 10x22 (7x14 compact) protruding from left(input)/right(output) edges, geometry+hover/connecting effects in index.css (.td-port), accent color per node type, enlarged invisible hit area via ::after
ProcessingIndicator: amber #f59e0b icon, rgba(245,158,11,0.15) bg circle, spinning 1.2s
Multi-select: Shift+click toggles, Shift+drag draws selection box (SelectionMode.Partial)
```

## Native Menu Bar

- **Cladel**: About, Settings (Cmd+,), Hide, Hide Others, Show All, Quit
- **File**: New (Cmd+N), Open (Cmd+O), Save (Cmd+S), Save As (Cmd+Shift+S), Close Tab (Cmd+W)
- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All
- **Window**: Minimize, Close

## Context Menus

- **Canvas right-click**: "Add Edit Node", "Import File", "Add Agent Node"
- **Node right-click** (Paper/UserDoc/Image/Agent/Compare/Title/Table/Render): "Delete Node"
- **Deleted placeholder right-click**: "Remove completely"
- **Junction right-click**: "Dissolve junction", "Remove junction"
- **Paper Group right-click**: "Expand Group", "Collapse Group", "Ungroup Papers"
- **Edge left-click**: popover -> Edit Annotations / Edge Properties / Add Branch Point

## IPC Conventions

- **Command names**: snake_case in Rust and `invoke()` calls (`create_node`)
- **Function params**: auto-converted to camelCase by Tauri boundary (`layer_id` -> `layerId`)
- **Struct fields inside wrapped params**: stay snake_case (`input: { layer_id: "..." }`)
- **Response fields**: snake_case as defined in Rust Serialize structs

## Tauri v2 Notes

- **Asset protocol**: Enabled with scope `["**/*"]` for image/PDF file access via `convertFileSrc()`
- **CSP**: Set to `null` (permissive, required for asset:// protocol)
- **Dev**: `npm run tauri dev` (frontend at localhost:1420)
- **Build**: `npm run tauri build`
- **Window**: 1200x800 default, resizable. Auxiliary windows `agent-console` + `manual` are scoped by `capabilities/auxiliary-windows.json` (grants `core:window` set-title/focus/close/destroy + `store:default`).
- **Auto-update**: `tauri-plugin-updater` (+ `tauri-plugin-process` for relaunch); `createUpdaterArtifacts: true` and signing required for `tauri build` to emit update artifacts.

---

## Known Issues & Lessons Learned

- **React Flow v12**: `NodeDragHandler` doesn't exist -> use `OnNodeDrag`. Custom node props: `NodeProps<Node<MyDataType>>` with `[key: string]: unknown`.
- **Handle overlap causes edge direction swap**: Each node side has overlapping source + target handles. Always use `connectingFrom` state to detect and normalize swaps.
- **Arrow rendering**: Use `bezierPoint(t~0.92)` for accurate tangent, not control points. Must use `<polygon>`, not SVG markers (WebKit breaks them).
- **Semantic Scholar rate limiting**: 90 requests per 5-minute sliding window.
- **PDF Claude fallback requires API key**: If no key and DOI lookup fails, import_pdf errors.
- **open_file_external**: Cross-platform via `#[cfg(target_os)]` -- `open` (macOS), `cmd /c start` (Windows), `xdg-open` (Linux).
- **Deprecated files**: `src/components/graph/GraphToolbar.tsx` (199), `src/components/panels/CoreHistoryPanel.tsx` (383) -- still present, safe to delete.
- **Tab snapshots**: VACUUM INTO temp files at `{OS temp dir}/cladel-tabs/` (`std::env::temp_dir()`, e.g. `$TMPDIR` on macOS). Cleaned on tab close, not on crash.
- **Large files**: NodeDetailPanel.tsx (2,694), pdf_export.rs (2,183), SettingsDialog.tsx (2,071), graphStore.ts (1,862), GraphCanvas.tsx (1,612), AgentNodeViewer.tsx (1,140), db.rs (1,017) -- modify with care.

---

## How to Continue Development

1. **Always read this CLAUDE.md first** before making changes.
2. Project path: `/Users/kazuma/Desktop/Cladel`
3. Run: `npm run tauri dev`
4. Rust env: `source "$HOME/.cargo/env"` or `export PATH="$HOME/.cargo/bin:$PATH"`
5. Compile check: `npx tsc --noEmit` (use instead of `npm run tauri dev` in Claude Code)
6. Handoff docs: see `docs/handoff.md` for comprehensive codebase reference

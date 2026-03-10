# Cladel -- Research Thought-Mapping Application (Tauri v2)

Tauri v2 + React + TypeScript desktop app for researchers to organize thinking as a knowledge graph. Combines literature management (PDF import), personal thought mapping, and AI agents (Claude/Gemini APIs) as collaborative research partners. Single `.cld` file format (SQLite, DELETE journal mode; legacy `.klv` and `.tmgx` also supported for reading).

## Tech Stack

- **Framework**: Tauri v2 (Rust backend + WebView frontend)
- **Frontend**: React 19.2 / TypeScript 5.9, Vite 7.3, react-router-dom 7.13 (HashRouter), @xyflow/react 12.10 (React Flow), Zustand 5.0, @mui/icons-material 7.3, Tailwind CSS 4.2 + @mui/material 7.3 + @emotion, react-markdown 10, rehype-raw 7, remark-gfm 4
- **Backend**: rusqlite 0.31 (bundled), reqwest 0.12, pdf-extract 0.7, image 0.24, regex 1, serde/chrono/uuid, tauri-plugin-store 2, base64 0.22, genpdf 0.2 + pulldown-cmark 0.12 (PDF generation)
- **File Format**: `.cld` (SQLite, DELETE journal mode, single-file; legacy `.klv` and `.tmgx` also supported for reading)
- **App ID**: `com.cladel.desktop`

---

## Core Concepts

### Node Types (13 active + deleted placeholder + import temp)

| Type | Visual | Key Behavior |
|------|--------|-------------|
| **core** | Deep blue (#1e3a5f), 2px solid #1e40af, 280x210 | One per layer. Markdown. Auto-save 2s. NOT deletable. |
| **paper** | Light green (#f0fdf4), 1px solid #059669, 280x210 | Created via PDF import. BibTeX metadata. PDF viewing. Paper chat. |
| **user_doc** | Amber (#fffbeb), 1px solid #d97706, 280x210 | UI label: "Edit". Markdown. Auto-save 800ms. Content Pull. display_id editable. |
| **agent_proposal** | Purple rgba(124,58,237,0.12), 1px dashed #7c3aed | AI suggestions. Accept -> Paper/Edit. Dismiss -> removed. Not user-editable. |
| **agent** | Indigo rgba(67,56,202,0.08), 1px solid #4338ca, 280x210 | Chat-based AI assistant. BFS context. Creates/updates output Edit nodes. SmartToy icon. |
| **image** | Teal (#f0fdfa), 1px solid #0891b2, 280x210 | File path reference (not BLOB). Thumbnail via convertFileSrc. Error state if path broken. |
| **paper_group** | Green composite | Groups multiple Paper nodes. Collapsible. Metadata: `{ member_node_ids: string[] }`. |
| **export** | Rose rgba(225,29,72,0.08), 1px solid #e11d48, 280x210 | PDF export node. Connected Edit nodes = sections. Citation styles (IEEE/APA). |
| **compare** | Cyan rgba(2,132,199,0.08), 1px solid #0284c7, 280x210 | Connects 2 Edit nodes, shows word-level diff. CompareArrows icon. |
| **title** | Stone rgba(120,113,108,0.08), 1px solid #78716c, 280x210 | Document title page for PDF export. Authors + affiliations metadata. Title icon. |
| **nano_banana** | Yellow (#fefce8), 1px solid #ca8a04, 280x210 | AI image generation via Gemini. Prompt + aspect ratio. Saves PNG to disk. AutoAwesome icon. |
| **deleted** | Gray rgba(229,231,235,0.3), 1px dashed #d1d5db, circle | Soft-delete placeholder. Preserves edges. Right-click -> "Remove completely". |
| **junction** | Dark gray (#4b5563), circle, ~16x16 | Edge branching point. "Dissolve junction" merges back. |
| **import** | Gray dashed, temp React-only | NOT a DB node_type. Temporary placeholder for file import. Auto-detects PDF vs image. |

All nodes: 4-directional handles (left/right source+target), NodeResizer, **4:3 landscape defaults** (280x210). All canvas nodes show `ProcessingIndicator` (spinning SmartToy icon, amber #f59e0b) when agent is processing. Paper/Edit/Image nodes support **Color Mode** (user-based coloring by creator_user_id).

### Display ID System

Every node gets a globally unique `display_id` (across ALL layers):

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
| nano_banana | `nanob_{N}` | No |

### Edges

First-class entities with weight 1-5 (visual thickness), bezier curves, 4-directional handles. Click -> action popover (Edit Annotations / Edge Properties / Add Branch Point). Badge for comment count. Reconnectable. No self-loops or duplicates. Directional arrows via `<polygon>` triangle (not SVG markers -- WebKit breaks them).

### Layer System

Layers = stages of thinking evolution. Layer 1 default, non-deletable. Vertical left panel (higher at top). Creating new layer: inherits Core content (or optionally from a source node). Each layer has independent nodes/edges.

### Comment System

**node_comments**: Paper + Edit + Image + Compare nodes. **edge_comments**: conversation threads on edges. Both support user/agent author types, inline editing, count badges (blue #2563eb). Comments support **@Agent invocation** and **@Mention references**. Comments include `creator_user_id`/`creator_user_name`.

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
    node_type TEXT NOT NULL CHECK(node_type IN ('core','paper','user_doc','agent_proposal','deleted','junction','image','agent','paper_group','export','compare','title','nano_banana')),
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

`SCHEMA_VERSION` = 19. Version-tracked via `schema_version` table. Fast path: skip all if `current_version >= SCHEMA_VERSION`. Append-only -- never reorder.

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

**Key design decisions**:
- .cld stores text/metadata only, NOT binary data. PDFs/images referenced by local file path.
- DELETE journal mode = single portable file, no -shm/-wal sidecars.
- App starts with in-memory DB; no file created until explicit Save As.
- `VACUUM INTO` for Save As (compacted copy), then reopen at new path.
- `Mutex<Connection>` for thread-safe single-user access. `Database` struct also holds `tabs: Mutex<Vec<TabInfo>>` and `active_tab_id: Mutex<String>` for multi-tab support.
- Edges have no ON DELETE CASCADE on node references (soft-delete preserves edges).
- `core_versions`/`note_versions` tables exist in DB but **version history UI has been removed**.

---

## Architecture

### File Map

**Frontend -- 82 files, ~28,926 lines**

| Path | Lines | Purpose |
|------|------:|---------|
| `src/App.tsx` | 784 | Main app shell: initialization, tab/layer/delete orchestration, layout composition, dialog state |
| `src/main.tsx` | 20 | Entry: HashRouter with `/` and `/node-detail/:nodeId/:layerId` routes |
| `src/types/index.ts` | 714 | All shared interfaces, SYSTEM_DEFAULTS, TabNodeType, ExportStyleConfig, ExportTitlePage |
| `src/lib/tauri-commands.ts` | 744 | Typed wrappers for 108 of 110 Tauri invoke commands |
| `src/lib/detached-window.ts` | 90 | Multi-window management (open/focus/closeAll) |
| `src/lib/sync-events.ts` | 144 | Cross-window event bus (node-updated, node-deleted, comments-changed, file-changed, settings-changed) |
| `src/lib/userColors.ts` | 21 | Deterministic 8-color palette for user-based node coloring |
| **Stores (11)** | | |
| `src/store/graphStore.ts` | 1,853 | Nodes, edges, selection, comment counts, CRUD, ghost nodes, junctions, groups, colorMode |
| `src/store/agentStore.ts` | 382 | Global agent: status, suggestions, history, context building, cooldown |
| `src/store/tabStore.ts` | 200 | Tab lifecycle: new/open/switch/close, reinitialize on switch |
| `src/store/fileStore.ts` | 163 | File ops (new/open/save/save-as), delegates to tabStore, auto-dirty |
| `src/store/exportStore.ts` | 62 | PDF export progress, error state, cross-window coordination |
| `src/store/settingsStore.ts` | 98 | API key status, AgentCapabilities, UIPreferences |
| `src/store/syncStore.ts` | 96 | Cloud sync state (Supabase) |
| `src/store/layerStore.ts` | 58 | Layer list, current layer, smart switch on delete |
| `src/store/agentNodeStore.ts` | 44 | Per-agent-node processing state (Set + Map) |
| `src/store/userStore.ts` | 44 | User identity (userId, userName, isRegistered) |
| `src/store/projectStore.ts` | 35 | Project list, current project |
| **Hooks** | | |
| `src/hooks/useIdleDetector.ts` | 65 | Document-level idle detection (6 event types) |
| `src/hooks/useAutonomousTrigger.ts` | 53 | Idle -> auto invoke_agent (shared cooldown) |
| `src/hooks/useStructureTrigger.ts` | 173 | Structure change -> BFS anomaly check -> trigger (3s debounce) |
| **Graph Components** | | |
| `src/components/graph/GraphCanvas.tsx` | 1,608 | Canvas: nodeTypes/edgeTypes, clipboard, connection normalization, Tab-to-Create, drag-drop, edge merge, keyboard handler (V/G/C keys) |
| `src/components/graph/CoreNode.tsx` | 131 | Core node |
| `src/components/graph/PaperNode.tsx` | 257 | Paper node (PDF warning icon, metadata, user color) |
| `src/components/graph/UserDocNode.tsx` | 174 | Edit node (content preview, user color) |
| `src/components/graph/ImageNode.tsx` | 263 | Image thumbnail + error state + user color |
| `src/components/graph/GhostNode.tsx` | 294 | Agent proposal (accept/dismiss, type badge) |
| `src/components/graph/AgentNode.tsx` | 173 | Agent node (SmartToy icon, processing/idle/error) |
| `src/components/graph/ExportNode.tsx` | 170 | Export node (PictureAsPdf icon, section count) |
| `src/components/graph/CompareNode.tsx` | 158 | Compare node (CompareArrows icon) |
| `src/components/graph/TitleNode.tsx` | 159 | Title node card (Title icon, subtitle, author count) |
| `src/components/graph/NanoBananaNode.tsx` | 230 | NanoBanana node (AutoAwesome icon, image thumbnail, prompt preview) |
| `src/components/graph/ImportNode.tsx` | 124 | Temp import placeholder (file dialog trigger) |
| `src/components/graph/DeletedNode.tsx` | 176 | Soft-delete circle (tooltip with original title) |
| `src/components/graph/JunctionNode.tsx` | 80 | Edge branch point dot |
| `src/components/graph/PaperGroupNode.tsx` | 235 | Paper group with collapse/expand |
| `src/components/graph/ProcessingIndicator.tsx` | 37 | Spinning SmartToy icon for agent processing state |
| `src/components/graph/CreatorLabel.tsx` | 46 | Shows creator name on nodes ("You" or user name) |
| `src/components/graph/GroupingButton.tsx` | 73 | "Group" button for multi-selected papers |
| `src/components/graph/GroupNamePopover.tsx` | 115 | Popover input for group name |
| `src/components/graph/AnnotatedEdge.tsx` | 213 | Bezier edge + weight + badge + polygon arrow |
| `src/components/graph/TabCreatePopover.tsx` | 296 | Light-themed popover (8 options: Edit/Paper/Image/Agent/Import/Export/Compare/Title) |
| `src/components/graph/CanvasControls.tsx` | 124 | Zoom in/out/fit, agent panel toggle, minimap toggle |
| `src/components/graph/CursorModeIndicator.tsx` | 196 | Upper-left bar: Move/Select pills, Color Mode toggle, shortcut help |
| `src/components/graph/CustomMiniMap.tsx` | 256 | SVG minimap (160x120) with color-coded nodes + edges |
| `src/components/graph/EdgePopover.tsx` | 525 | Edge annotation modal: weight slider, comment thread, delete |
| `src/components/graph/EdgeActionMenu.tsx` | 275 | Edge context menu: Edit Annotations / Properties / Branch Point |
| `src/components/graph/ContextMenu.tsx` | 359 | Canvas/node right-click menus (unified "Import File") |
| `src/components/graph/NodeAccordionSection.tsx` | 86 | Collapsible section for node detail panel |
| `src/components/graph/useConnectedDisplayIds.ts` | 30 | Hook: connected node display_ids |
| **Panel Components** | | |
| `src/components/panels/NodeDetailPanel.tsx` | 2,533 | Right sidebar: polymorphic viewer + CommentSection with @Agent |
| `src/components/panels/AgentNodeViewer.tsx` | 1,140 | Agent node chat interface (messages, send, output tracking) |
| `src/components/panels/AgentPanel.tsx` | 984 | Global agent: queries, suggestions, history, status |
| `src/components/panels/ExportNodeViewer.tsx` | 664 | Export node: sections, citations, reorder, style config, generate PDF |
| `src/components/panels/TitleNodeViewer.tsx` | 374 | Title node editor: title, subtitle, authors with affiliations |
| `src/components/panels/NanoBananaNodeViewer.tsx` | 280 | NanoBanana node: prompt input, aspect ratio selector, image generation + preview |
| `src/components/panels/CompareNodeViewer.tsx` | 484 | Compare node: word-level diff of 2 connected Edit nodes (LCS algorithm) |
| `src/components/panels/NoteEditorWithPull.tsx` | 892 | Textarea with Content Pull + @mention support |
| `src/components/panels/ContentPullPopover.tsx` | 506 | Dark-themed two-step content selection popover |
| `src/components/panels/MentionPopover.tsx` | 390 | @mention autocomplete for node references |
| `src/components/panels/DetachedNodeDetail.tsx` | 193 | Standalone node detail window (cross-window sync) |
| `src/components/panels/MarkdownPreview.tsx` | 132 | Markdown preview with remark-gfm and rehype-raw |
| **Dialog Components** | | |
| `src/components/dialogs/SettingsDialog.tsx` | 2,007 | API keys (Anthropic+Gemini), capabilities, UI prefs, usage, paper prompt, sync, user identity |
| `src/components/dialogs/PdfImportDialog.tsx` | 733 | PDF import: 6-phase state machine with error recovery |
| `src/components/dialogs/WelcomeDialog.tsx` | 753 | Launch dialog: recent files, create new, open existing |
| `src/components/dialogs/CloudOpenDialog.tsx` | 575 | Cloud file browser (Supabase sync) |
| `src/components/dialogs/ExportBibtexDialog.tsx` | 471 | Tri-state checkbox tree export to .bib |
| `src/components/dialogs/SyncDialog.tsx` | 440 | Cloud sync management dialog |
| `src/components/dialogs/NewLayerDialog.tsx` | 389 | Layer creation with optional source node |
| `src/components/dialogs/ImageImportDialog.tsx` | 386 | Image import + validation + positionOverride |
| `src/components/dialogs/ExportStyleConfigDialog.tsx` | 681 | PDF export style config (fonts, sizes, margins, alignment, markers, line numbers) with preview |
| `src/components/dialogs/ConfirmDialogs.tsx` | 238 | Shared confirm dialogs (Delete, BatchDelete, EdgeDelete, UnsavedChanges) |
| **Layout Components** | | |
| `src/components/layers/LayerBar.tsx` | 313 | Left sidebar: layers (sorted), add/delete, Export BibTeX |
| `src/components/FileTabBar.tsx` | 216 | Top tab bar: open tabs, active indicator, close/new buttons, settings |
| `src/components/StatusBar.tsx` | 152 | Bottom status bar: node/edge counts, API status, agent status, sync |
| `src/components/ResizeHandle.tsx` | 22 | Simple sidebar resize handle with hover state |

**Backend -- 36 files, ~15,261 lines**

| Path | Lines | Purpose |
|------|------:|---------|
| `src-tauri/src/main.rs` | 6 | Calls `cladel_app_lib::run()` |
| `src-tauri/src/lib.rs` | 278 | App entry: 111 command registrations, native menu, plugins init |
| `src-tauri/src/db.rs` | 968 | SQLite schema, SCHEMA_VERSION=19, 19 migrations, Database+TabInfo |
| `src-tauri/src/commands/mod.rs` | 21 | Module declarations (22 submodules) |
| `src-tauri/src/commands/nodes.rs` | 567 | CRUD + soft_delete + restore + update_display_id + update_paper_bibtex |
| `src-tauri/src/commands/edges.rs` | 211 | CRUD + restore with handle persistence, weight 1-5 |
| `src-tauri/src/commands/layers.rs` | 279 | CRUD + Core node creation per layer + source node inheritance |
| `src-tauri/src/commands/tab_commands.rs` | 358 | Multi-tab: create/switch/close/open, snapshot/restore via VACUUM INTO |
| `src-tauri/src/commands/file_commands.rs` | 110 | file_new/open/save/save_as (VACUUM INTO) |
| `src-tauri/src/commands/core_versions.rs` | 115 | save, list, diff (backend exists, frontend no longer calls) |
| `src-tauri/src/commands/note_versions.rs` | 74 | save, list (backend exists, frontend no longer calls) |
| `src-tauri/src/commands/node_comments.rs` | 177 | CRUD + batch count (dynamic IN clause) |
| `src-tauri/src/commands/edge_comments.rs` | 176 | CRUD + batch count |
| `src-tauri/src/commands/agent_node_messages.rs` | 92 | CRUD for agent node chat messages |
| `src-tauri/src/commands/junctions.rs` | 321 | split_edge_at_junction, dissolve_junction |
| `src-tauri/src/commands/bibtex.rs` | 409 | Hand-written BibTeX parser + entry generator (no external crate) |
| `src-tauri/src/commands/literature.rs` | 406 | Semantic Scholar API (rate-limited: 90/5min sliding window) |
| `src-tauri/src/commands/pdf_import.rs` | 638 | import_pdf (DOI->S2/CrossRef->Claude), extract_pdf_with_claude |
| `src-tauri/src/commands/pdf_export.rs` | 2,183 | Export node -> PDF (genpdf + pulldown-cmark), IEEE/APA citations, style config, title page, line numbers |
| `src-tauri/src/commands/image_import.rs` | 315 | validate, create, check, re-link, open_external, paper PDF path |
| `src-tauri/src/commands/export.rs` | 283 | BibTeX export by layer/selection, native save dialog |
| `src-tauri/src/commands/settings.rs` | 686 | API keys (Anthropic+Gemini), AgentCapabilities, UIPreferences, recent files, paper prompt, Supabase config, user identity |
| `src-tauri/src/commands/usage.rs` | 223 | Usage summary, history, clear, cost estimation |
| `src-tauri/src/commands/sync.rs` | 445 | Cloud sync via Supabase (upload/download/status/list/stats) |
| `src-tauri/src/commands/nano_banana.rs` | 260 | NanoBanana image generation via Gemini (gemini-2.5-flash-image) |
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

## Registered Tauri Commands (111 total)

Counted from `generate_handler![]` in `lib.rs`:

| Category | Count | Commands |
|----------|------:|---------|
| File | 5 | `file_new`, `file_open`, `file_save`, `file_save_as`, `file_get_current_path` |
| Tabs | 7 | `get_tabs`, `get_active_tab_id`, `create_tab`, `open_file_in_tab`, `switch_tab`, `close_tab`, `update_tab_after_save` |
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
| Image Import | 8 | `validate_image_file`, `create_image_node`, `get_node_image_info`, `check_file_exists`, `update_node_image_path`, `open_file_external`, `set_paper_pdf_path`, `get_paper_pdf_path` |
| BibTeX Export | 3 | `get_paper_nodes_by_layers`, `export_bibtex_selected`, `export_bibtex_to_file` |
| PDF Export | 6 | `get_export_sections`, `update_export_section_order`, `update_export_citation_style`, `update_export_language`, `update_export_style_config`, `generate_export_pdf` |
| Usage | 3 | `get_usage_summary`, `get_usage_history`, `clear_usage_log` |
| Agent Messages | 3 | `add_agent_node_message`, `get_agent_node_messages`, `delete_agent_node_message` |
| Sync | 5 | `sync_list_remote`, `sync_check_status`, `sync_upload`, `sync_download`, `sync_get_remote_stats` |
| NanoBanana | 1 | `generate_nano_banana_image` |

*`get_api_key` and `get_gemini_api_key` are **backend-only** -- registered in generate_handler but intentionally have no frontend wrapper (raw keys used only server-side for API calls).

---

## Feature Specifications

### File Tab System

Browser-style multi-file tabs (FileTabBar + tabStore + tab_commands.rs):
- Each tab has its own SQLite connection. Switching snapshots current tab's in-memory DB to temp file (`~/.tmp/cladel-tabs/{tab_id}.cld`) via `VACUUM INTO`, then restores the target tab's connection.
- `tabStore.ts`: `newTab()`, `switchTab()`, `openFileInTab()`, `closeTab()` -- each calls backend + reinitializes all frontend stores.
- Closing last tab creates a fresh empty tab automatically.
- **Native menu**: Close Tab (Cmd+W).

### Agent Node System

Per-node AI assistant with persistent chat history and output node creation.

**Pipeline** (agent/agent_node.rs): `invoke_agent_node` -> provider select -> capability guard -> BFS context (up to 20 nodes) -> last 10 messages -> API call (max 4096 tokens, retry 2x) -> create/update output Edit node -> return `InvokeAgentNodeResult`.

**Output nodes**: Agent creates `user_doc` Edit nodes positioned right of agent node (+width+100, stacked by 275px). Auto-creates edge: agent -> output.

### @Agent Comment Invocation

Include `@Agent` (case-insensitive) in any node's comment -> stripped -> `invoke_agent_comment` -> BFS context (up to 15 nodes) -> last 10 comments -> API call (max 1024 tokens) -> agent comment posted.

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

**Citation syntax in Edit nodes**: `{@cite_key}` for papers, `{@A; @B; @C}` for multi-citation, `{{image_id}}` for images.

### Compare Node

`node_type='compare'` -- connects to exactly 2 Edit nodes and displays a word-level diff.

**Frontend** (CompareNodeViewer.tsx): Uses LCS algorithm to compute word-level differences. Highlights added (green) and removed (red) text. Swap button to change comparison direction.

### Content Pull

Inline reference insertion for Edit (user_doc) and Core nodes. Press Space on empty line -> ContentPullPopover. Two-step: (1) Select connected node, (2) Choose what to pull (content, abstract, comments).

### Tab-to-Create

**Keyboard shortcuts**: **Tab** -> right, **Shift+Tab** -> down, **Ctrl/Cmd+Tab** -> left, **Ctrl/Cmd+Shift+Tab** -> up.

**Popover** (TabCreatePopover.tsx): Light-themed, 8 options: 1. Edit, 2. Paper, 3. Image, 4. Agent, 5. Import File, 6. Export, 7. Compare, 8. Title. Number keys instant select.

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
| Gemini (Google) | `gemini-2.5-flash-image` | NanoBanana image generation | `generativelanguage.googleapis.com/v1beta/...` |

Both: retry 2x after 2s/5s, only on transient errors. Cost estimation: Sonnet $3/$15, Opus $15/$75, Haiku $0.25/$1.25, Gemini $0.15/$0.60 per M tokens.

### Multi-Window Node Detail

HashRouter: "/" = main, "/node-detail/:nodeId/:layerId" = detached. Double-click any node (except junction/deleted) -> detached WebviewWindow (500x700). Sync events via sync-events.ts. Auto-close on file operations.

### Cloud Sync (Supabase)

Optional cloud sync for .cld files via Supabase storage:
- **Backend** (sync.rs): `sync_list_remote`, `sync_check_status`, `sync_upload`, `sync_download`, `sync_get_remote_stats`
- **Frontend**: SyncDialog (management), CloudOpenDialog (browse remote files), syncStore (state)
- **Settings**: Supabase URL + anon key configured in SettingsDialog
- **StatusBar**: Shows sync status indicator (in sync / not uploaded / out of sync)

### Agent API Usage Monitor

`agent_usage_log` table, `get_usage_summary` (cost estimation), `get_usage_history`. Frontend: SettingsDialog "API Usage" section.

---

## Settings System

**Storage**: `~/Library/Application Support/com.cladel.desktop/settings.json` (tauri-plugin-store)

**API keys**: `anthropic_api_key`, `gemini_api_key`, `supabase_url`, `supabase_anon_key`
**User**: `user_id` (UUID), `user_name`
**Agent toggles** (all bool, default true): `agent_enabled`, `autonomous_enabled`, `search_papers_enabled`, `suggest_connections_enabled`, `suggest_ideas_enabled`
**Agent timing**: `autonomous_idle_seconds` (45), `autonomous_cooldown_seconds` (120)
**Node sizes** (f64, default 280x210): `core_default_width/height`, `paper_default_width/height`, `user_doc_default_width/height`, `ghost_default_width/height`, `image_default_width/height`
**Canvas**: `sidebar_default_width` (380), `canvas_background` (#f8fafc), `canvas_grid_enabled` (true), `canvas_grid_size` (20), `editor_font_size` (13)
**Other**: `paper_summary_prompt` (template), `recent_files` (JSON array, max 10)

---

## Visual Design Tokens

```
Node styles (border: unselected | selected, box-sizing: border-box):
  core:           bg #1e3a5f, 2px|4px solid #1e40af, text #fff, glow #60a5fa
  paper:          bg #f0fdf4, 1px|3px solid #059669, text #1f2937, glow #34d399
  user_doc(Edit): bg #fffbeb, 1px|3px solid #d97706, text #1f2937, glow #fbbf24
  agent_proposal: bg rgba(124,58,237,0.12), 1px|3px dashed #7c3aed, glow #a78bfa
  agent:          bg rgba(67,56,202,0.08), 1px|3px solid #4338ca, glow #6366f1
  export:         bg rgba(225,29,72,0.08), 1px|3px solid #e11d48, glow #e11d48
  compare:        bg rgba(2,132,199,0.08), 1px|3px solid #0284c7, glow #0284c7
  title:          bg rgba(120,113,108,0.08), 1px|3px solid #78716c, glow #78716c
  nano_banana:    bg #fefce8, 1px|3px solid #ca8a04, glow #eab308
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

Edge colors: default #6b7280, selected #3b82f6, agent-created #7c3aed (dashed), deleted #9ca3af
ProcessingIndicator: amber #f59e0b icon, rgba(245,158,11,0.15) bg circle, spinning 1.2s
Multi-select: Shift+click toggles, Shift+drag draws selection box (SelectionMode.Partial)
```

## Native Menu Bar

- **Cladel**: About, Settings (Cmd+,), Hide, Hide Others, Show All, Quit
- **File**: New (Cmd+N), Open (Cmd+O), Save (Cmd+S), Save As (Cmd+Shift+S), Close Tab (Cmd+W)
- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All
- **Window**: Minimize, Close

## Context Menus

- **Canvas right-click**: "Add Edit Node", "Import File", "Add Agent Node", "Add NanoBanana Node"
- **Node right-click** (Paper/UserDoc/Image/Agent/Compare/Title): "Delete Node"
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
- **Window**: 1200x800 default, resizable

---

## Known Issues & Lessons Learned

- **React Flow v12**: `NodeDragHandler` doesn't exist -> use `OnNodeDrag`. Custom node props: `NodeProps<Node<MyDataType>>` with `[key: string]: unknown`.
- **Handle overlap causes edge direction swap**: Each node side has overlapping source + target handles. Always use `connectingFrom` state to detect and normalize swaps.
- **Arrow rendering**: Use `bezierPoint(t~0.92)` for accurate tangent, not control points. Must use `<polygon>`, not SVG markers (WebKit breaks them).
- **Semantic Scholar rate limiting**: 90 requests per 5-minute sliding window.
- **PDF Claude fallback requires API key**: If no key and DOI lookup fails, import_pdf errors.
- **open_file_external**: Cross-platform via `#[cfg(target_os)]` -- `open` (macOS), `cmd /c start` (Windows), `xdg-open` (Linux).
- **Deprecated files**: GraphToolbar.tsx, CoreHistoryPanel.tsx -- safe to delete.
- **Tab snapshots**: VACUUM INTO temp files at `~/.tmp/cladel-tabs/`. Cleaned on tab close, not on crash.
- **Large files**: NodeDetailPanel.tsx (2,533), pdf_export.rs (2,183), SettingsDialog.tsx (2,007), graphStore.ts (1,853), GraphCanvas.tsx (1,608), AgentNodeViewer.tsx (1,140) -- modify with care.

---

## How to Continue Development

1. **Always read this CLAUDE.md first** before making changes.
2. Project path: `/Users/kazuma/Desktop/Tsumugix`
3. Run: `npm run tauri dev`
4. Rust env: `source "$HOME/.cargo/env"` or `export PATH="$HOME/.cargo/bin:$PATH"`
5. Compile check: `npx tsc --noEmit` (use instead of `npm run tauri dev` in Claude Code)
6. Handoff docs: see `docs/handoff.md` for comprehensive codebase reference

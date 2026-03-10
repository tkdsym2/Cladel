# Cladel -- Handoff Document

> Last updated: 2026-03-09. Code is the source of truth.

---

## 1. Project Summary

**Cladel** is a desktop application for researchers to organize thinking as a knowledge graph. It combines literature management (PDF import with DOI lookup), personal thought mapping (free-form note nodes), and AI agents (Claude/Gemini APIs) as collaborative research partners. Users build layered graphs where nodes represent papers, notes, images, AI suggestions, and comparisons, connected by weighted edges with annotation threads. The app saves everything in a single `.cld` file (SQLite, DELETE journal mode; legacy `.klv` and `.tmgx` also supported for reading).

| Property | Value |
|----------|-------|
| **Framework** | Tauri v2 (Rust backend + WebView frontend) |
| **Frontend** | React 19.2, TypeScript 5.9, Vite 7.3 |
| **Graph Library** | @xyflow/react 12.10 (React Flow) |
| **State Management** | Zustand 5.0 |
| **UI** | Tailwind CSS 4.2 + @mui/material 7.3 + @emotion |
| **Icons** | @mui/icons-material 7.3 |
| **Routing** | react-router-dom 7.13 (HashRouter) |
| **Backend DB** | rusqlite 0.31 (bundled SQLite) |
| **HTTP** | reqwest 0.12 |
| **PDF** | pdf-extract 0.7 (read), genpdf 0.2 + pulldown-cmark 0.12 (write) |
| **Settings** | tauri-plugin-store 2 |
| **File format** | `.cld` (SQLite, DELETE journal mode, single-file; legacy `.klv` and `.tmgx` also supported for reading) |
| **App ID** | `com.cladel.desktop` |

### Development Commands

```bash
npm run tauri dev          # Dev server (frontend at localhost:1420)
source "$HOME/.cargo/env"  # Rust env setup (if needed)
npx tsc --noEmit           # Frontend type-check only (fast)
cd src-tauri && cargo check # Rust compilation check only
npm run tauri build         # Production build
```

---

## 2. Architecture Overview

### UI Layout

```
+--------+------------------------------+----------------------------+
| File Tab Bar (Untitled* | paper.cld | +)              [Settings] |
+--------+------------------------------+----------------------------+
| Layers |                              |  Node Detail Panel         |
| (160px)|       Graph Canvas           |  (Core/Paper/Edit/Image/   |
| Layer 3|       (React Flow)           |   Ghost/Agent/Export/      |
| Layer 2|                              |   Compare)                 |
| Layer 1|  Tab -> create connected node|  OR Agent Panel            |
|--------|  Right-click -> context menu |  (resizable, min 280px)    |
| Export |  PDF/Image drag-and-drop     |  Double-click -> detach    |
| BibTeX |                              |                            |
+--------+------------------------------+----------------------------+
|  Nodes: 5  Edges: 3   Claude API: *   Agent: On / Auto *          |
+-------------------------------------------------------------------+
```

Top-left overlay: cursor mode indicator (Move/Select) + color mode toggle (Type/User).
Bottom-left overlay: zoom controls, agent panel button, minimap toggle, minimap.

### Data Flow

```
User interaction
  -> React component (event handler)
    -> Zustand store action
      -> tauri-commands.ts wrapper (invoke)
        -> Tauri IPC
          -> Rust #[tauri::command] function
            -> rusqlite (SQLite)
          <- Result<T, String>
        <- Promise<T>
      <- store state update
    <- React re-render
```

### IPC Conventions

| Context | Convention |
|---------|-----------|
| Rust command names | `snake_case` (e.g. `create_node`) |
| JS `invoke()` calls | `snake_case` (matches Rust) |
| Function parameters at IPC boundary | Auto-converted `snake_case` -> `camelCase` by Tauri |
| Struct fields inside wrapped params | Remain `snake_case` (e.g. `input: { layer_id: "..." }`) |
| Response fields | `snake_case` as defined in Rust `Serialize` structs |

---

## 3. Database Schema

**SCHEMA_VERSION = 18** (in `src-tauri/src/db.rs` line 7)

### Tables

#### `projects`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| name | TEXT | NOT NULL |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |

#### `layers`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| project_id | TEXT | NOT NULL, FK projects(id) |
| layer_number | INTEGER | NOT NULL |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |

#### `nodes`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| layer_id | TEXT | NOT NULL, FK layers(id) |
| node_type | TEXT | NOT NULL, CHECK IN ('core','paper','user_doc','agent_proposal','deleted','junction','image','agent','paper_group','export','compare','title','nano_banana') |
| title | TEXT | NOT NULL |
| content | TEXT | nullable |
| bibtex | TEXT | nullable |
| metadata | TEXT | nullable (JSON) |
| pdf_path | TEXT | nullable (added v6) |
| display_id | TEXT | nullable (added v9) |
| position_x | REAL | NOT NULL DEFAULT 0 |
| position_y | REAL | NOT NULL DEFAULT 0 |
| width | REAL | nullable (added v5) |
| height | REAL | nullable (added v5) |
| status | TEXT | NOT NULL DEFAULT 'active', CHECK IN ('active','ghost','dismissed') |
| created_by | TEXT | NOT NULL DEFAULT 'user', CHECK IN ('user','agent') |
| creator_user_id | TEXT | nullable (added v16) |
| creator_user_name | TEXT | nullable (added v17) |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |

#### `edges`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| layer_id | TEXT | NOT NULL, FK layers(id) |
| source_node_id | TEXT | NOT NULL, FK nodes(id) |
| target_node_id | TEXT | NOT NULL, FK nodes(id) |
| source_handle | TEXT | nullable (added v3) |
| target_handle | TEXT | nullable (added v3) |
| weight | INTEGER | NOT NULL DEFAULT 3, CHECK 1-5 |
| comment | TEXT | DEFAULT '' |
| created_by | TEXT | NOT NULL DEFAULT 'user', CHECK IN ('user','agent') |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |

Note: Edges have **no ON DELETE CASCADE** on node references. Soft-delete preserves edges.

#### `node_comments`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| node_id | TEXT | NOT NULL, FK nodes(id) ON DELETE CASCADE |
| author_type | TEXT | NOT NULL, CHECK IN ('user','agent') |
| content | TEXT | NOT NULL |
| creator_user_id | TEXT | nullable (added v17) |
| creator_user_name | TEXT | nullable (added v17) |
| created_at | TEXT | NOT NULL |
| updated_at | TEXT | NOT NULL |

#### `edge_comments`
Same structure as node_comments but with `edge_id` FK to edges(id).

#### `core_versions`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| node_id | TEXT | NOT NULL, FK nodes(id) |
| version_number | INTEGER | NOT NULL |
| content | TEXT | NOT NULL |
| created_at | TEXT | NOT NULL |

Note: Backend commands exist but **frontend version history UI has been removed**.

#### `note_versions`
Same structure as core_versions but with ON DELETE CASCADE on node_id. Backend commands exist but **frontend no longer uses them**.

#### `node_images`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| node_id | TEXT | NOT NULL, FK nodes(id) ON DELETE CASCADE |
| file_path | TEXT | NOT NULL |
| mime_type | TEXT | NOT NULL |
| original_filename | TEXT | NOT NULL |
| image_width | INTEGER | nullable |
| image_height | INTEGER | nullable |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') |

#### `agent_usage_log`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| invocation_type | TEXT | NOT NULL |
| model | TEXT | NOT NULL |
| input_tokens | INTEGER | NOT NULL |
| output_tokens | INTEGER | NOT NULL |
| total_tokens | INTEGER | NOT NULL |
| success | INTEGER | NOT NULL DEFAULT 1 |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') |

Index: `idx_agent_usage_created_at` on `created_at`.

#### `agent_node_messages`
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT | PRIMARY KEY |
| node_id | TEXT | NOT NULL, FK nodes(id) ON DELETE CASCADE |
| role | TEXT | NOT NULL, CHECK IN ('user','agent') |
| content | TEXT | NOT NULL |
| output_node_id | TEXT | nullable |
| created_at | TEXT | NOT NULL, DEFAULT datetime('now') |

Index: `idx_agent_node_messages_node_id` on `node_id`.

#### `schema_version`
Single row tracking current schema version. Updated at end of migrations.

### Migration History

| Version | Migration |
|---------|-----------|
| 1 | Legacy edge_comments: INSERT from edges.comment field |
| 2 | Add 'deleted' to node_type CHECK (table rebuild) |
| 3 | Add source_handle/target_handle on edges (ALTER TABLE) |
| 4 | Add 'junction' to node_type CHECK (table rebuild) |
| 5 | Add width/height on nodes (ALTER TABLE) |
| 6 | Add pdf_path on nodes (ALTER TABLE) |
| 7 | Add 'image' to node_type CHECK (column-aware rebuild) |
| 8 | Create node_images table |
| 9 | Add display_id on nodes + populate existing nodes with generated IDs |
| 10 | Create agent_usage_log table + index |
| 11 | Add 'agent' to node_type CHECK (column-aware rebuild) |
| 12 | Create agent_node_messages table + index |
| 13 | Add 'paper_group' to node_type CHECK (column-aware rebuild) |
| 14 | Add 'export' + 'compare' to node_type CHECK (column-aware rebuild) |
| 15 | Add 'compare' to node_type CHECK (column-aware rebuild, safety net for v14) |
| 16 | Add creator_user_id on nodes (ALTER TABLE) |
| 17 | Add creator_user_name on nodes + creator_user_id/creator_user_name on node_comments and edge_comments |
| 18 | Add 'title' to node_type CHECK (column-aware rebuild with all columns) |
| 19 | Add 'nano_banana' to node_type CHECK (column-aware rebuild with all columns) |

**Design decisions**:
- `.cld` stores text/metadata only, NOT binary data. PDFs/images referenced by local file path.
- DELETE journal mode = single portable file, no -shm/-wal sidecars.
- App starts with in-memory DB; no file created until explicit Save As.
- `VACUUM INTO` for Save As (compacted copy), then reopen at new path.
- `Mutex<Connection>` for thread-safe single-user access. `Database` struct also holds `tabs: Mutex<Vec<TabInfo>>` and `active_tab_id: Mutex<String>`.

---

## 4. Node Types

13 active node types + 1 deleted placeholder + 1 temp-only (import):

| Type (DB) | UI Label | Color | Key Behavior | Canvas Component | Detail Component |
|-----------|----------|-------|-------------|------------------|------------------|
| `core` | Core | bg #1e3a5f, border #1e40af | One per layer. Markdown. NOT deletable. | CoreNode.tsx | NodeDetailPanel (core section) |
| `paper` | Paper | bg #f0fdf4, border #059669 | PDF import. BibTeX metadata. Paper chat. | PaperNode.tsx | NodeDetailPanel (paper section) |
| `user_doc` | Edit | bg #fffbeb, border #d97706 | Free-form markdown. Content Pull. display_id editable. | UserDocNode.tsx | NodeDetailPanel (user_doc section) |
| `agent_proposal` | Suggestion | bg rgba(124,58,237,0.12), border #7c3aed dashed | AI-generated. Accept -> Paper/Edit. Dismiss -> removed. | GhostNode.tsx | NodeDetailPanel (ghost section) |
| `agent` | Agent | bg rgba(67,56,202,0.08), border #4338ca | Chat-based AI. BFS context. Creates output Edit nodes. | AgentNode.tsx | AgentNodeViewer.tsx |
| `image` | Image | bg #f0fdfa, border #0891b2 | File path reference. Thumbnail via convertFileSrc. | ImageNode.tsx | NodeDetailPanel (image section) |
| `paper_group` | Group | Green composite | Groups multiple papers. Collapse/expand. | PaperGroupNode.tsx | NodeDetailPanel (group section) |
| `export` | Export | bg rgba(225,29,72,0.08), border #e11d38 | PDF export. Connected Edit nodes = sections. | ExportNode.tsx | ExportNodeViewer.tsx |
| `compare` | Compare | bg rgba(2,132,199,0.08), border #0284c7 | Diff viewer for 2 Edit nodes. | CompareNode.tsx | CompareNodeViewer.tsx |
| `title` | Title | bg rgba(120,113,108,0.08), border #78716c | Document title page for PDF export. Authors + affiliations. | TitleNode.tsx | TitleNodeViewer.tsx |
| `nano_banana` | NanoBanana | bg #fefce8, border #ca8a04 | AI image generation via Gemini. Prompt-based. Thumbnail preview. | NanoBananaNode.tsx | NanoBananaNodeViewer.tsx |
| `deleted` | (deleted) | bg rgba(229,231,235,0.3), border #d1d5db dashed | Soft-delete placeholder. Preserves edges. | DeletedNode.tsx | -- |
| `junction` | (junction) | bg #4b5563, circle ~16x16 | Edge branching point. Dissolve merges back. | JunctionNode.tsx | -- |
| `import` | (temp) | Gray dashed | **NOT a DB type**. React-only temp for file import. | ImportNode.tsx | -- |

All canvas nodes: 4-directional handles (top/bottom/left/right, source+target), NodeResizer, 4:3 landscape defaults (280x210), ProcessingIndicator.

### Display ID System

Every node gets a globally unique `display_id` (across ALL layers):

| Node Type | Prefix | Editable |
|-----------|--------|----------|
| core | `Core{layer_number}` | No |
| paper | BibTeX citation key or `paper_{N}` | Via BibTeX edit |
| user_doc | `note_{N}` | Yes (update_display_id) |
| agent_proposal | `agent_{N}` | No |
| agent | `agent_node_{N}` | No |
| image | `image_{N}` | No |
| export | `export_{N}` | No |
| compare | `compare_{N}` | No |
| title | `title_{N}` | No |
| nano_banana | `nanob_{N}` | No |

`get_next_display_id(conn, prefix)` in nodes.rs queries MAX across all nodes for global uniqueness.

---

## 5. Feature Specifications

### 5.1 File Tab System

Browser-style multi-file tabs. Each tab has its own SQLite connection.

**Flow**: FileTabBar (UI) -> tabStore -> tab_commands.rs (backend)

**Switching tabs**: Current tab's in-memory DB is snapshot to temp file (`~/.tmp/cladel-tabs/{tab_id}.cld`) via `VACUUM INTO`, then the target tab's snapshot is reopened. All frontend stores are reinitialized after switch.

**Key files**: `FileTabBar.tsx`, `tabStore.ts`, `tab_commands.rs`

**Commands**: `get_tabs`, `get_active_tab_id`, `create_tab`, `open_file_in_tab`, `switch_tab`, `close_tab`, `update_tab_after_save`

**Gotchas**: Closing the last tab creates a fresh empty tab automatically. Tab snapshots at `~/.tmp/cladel-tabs/` are cleaned up on tab close but not on crash.

### 5.2 Layer System

Layers represent stages of thinking evolution. Layer 1 is default and non-deletable.

**Flow**: LayerBar (UI, vertical left panel) -> layerStore -> layers.rs

**Creating a layer**: Inherits Core content (or optionally from a source node). Each layer gets its own Core node.

**Commands**: `create_layer`, `delete_layer`, `get_layers`

### 5.3 Tab-to-Create

Keyboard shortcut to create a connected node in a direction.

**Shortcuts**: Tab -> right, Shift+Tab -> down, Ctrl/Cmd+Tab -> left, Ctrl/Cmd+Shift+Tab -> up.

**Popover** (TabCreatePopover.tsx): Light-themed, 8 options: Edit, Paper, Image, Agent, Import File, Export, Compare, Title. Number keys 1-8 for instant select.

**Three creation paths**: (1) Tab during edge drag -> connected to drag-from node. (2) Tab with node selected -> connected. (3) Tab with no selection -> standalone at cursor.

**Guards**: Ignored in input/textarea/contentEditable, when junction/deleted selected, or popover already open.

**Key files**: `GraphCanvas.tsx` (keyboard handler), `TabCreatePopover.tsx`

### 5.4 Edge System

First-class entities with weight 1-5 (visual thickness), bezier curves, 4-directional handles.

**Interaction**: Click -> EdgeActionMenu (Edit Annotations / Edge Properties / Add Branch Point). Edge popover has weight slider + comment thread.

**Directional arrows**: `<polygon>` triangle (not SVG markers -- WebKit breaks them). Arrow tangent from `bezierPoint(t=0.92)`.

**Visual states**: gray default (#6b7280), blue selected (#3b82f6), purple agent-created (#7c3aed, dashed), gray deleted endpoint (#9ca3af).

**Connection normalization**: Each node side has overlapping source + target handles. `connectingFrom` state in GraphCanvas.tsx detects and normalizes handle swaps.

**Commands**: `create_edge`, `update_edge`, `delete_edge`, `restore_edge`, `get_edges_by_layer`

**Key files**: `AnnotatedEdge.tsx`, `EdgePopover.tsx`, `EdgeActionMenu.tsx`, `edges.rs`

### 5.5 Comment System

**Node comments**: On Paper, Edit, Image, Agent, Core nodes. `node_comments` table.

**Edge comments**: Conversation threads on edges. `edge_comments` table.

Both support user/agent author types, inline editing, count badges (blue #2563eb).

**@Agent invocation**: Include `@Agent` (case-insensitive) in any node comment -> stripped -> sent to `invoke_agent_comment`. Backend BFS context (up to 15 nodes) -> last 10 comments -> API call (max 1024 tokens) -> agent comment posted back.

**@Mention references**: `MentionPopover.tsx` provides inline autocomplete triggered by typing `@` in textareas. Shows filtered list with color-coded type badges. Inserts `@display_id`.

**Creator attribution**: Comments store `creator_user_id` and `creator_user_name` (added in v17 migration). Displayed via `CreatorLabel.tsx`.

**Key files**: `NodeDetailPanel.tsx` (comment section), `MentionPopover.tsx`, `node_comments.rs`, `edge_comments.rs`, `comment_agent.rs`

### 5.6 Agent System

#### Global Agent (Research Assistant)
**Capability guards**: agent_enabled (master), autonomous_enabled, search_papers_enabled, suggest_connections_enabled, suggest_ideas_enabled, autonomous_idle_seconds (45), autonomous_cooldown_seconds (120).

**Pipeline**: Frontend `buildContext()` (agentStore) -> `invoke_agent` -> capability guard -> BFS context -> relevance scoring -> 4-tier token budget -> Claude API -> 4-tier JSON extraction -> AgentResponse.

**Token budget**: Core 2,000 | Full content 4,400 | Title-only 1,800 | Edges 1,600 | Edge comments 3,200 chars.

**Autonomous triggers**:
- Time-based (`useAutonomousTrigger`): idle detection via `useIdleDetector`
- Structure-based (`useStructureTrigger`): BFS anomaly detection, 3s debounce
- Both share `lastAutonomousTriggerTime` cooldown.

**Key files**: `AgentPanel.tsx`, `agentStore.ts`, `agent/mod.rs`, `agent/context.rs`, `agent/analysis.rs`, `agent/parser.rs`, `agent/prompt.rs`

#### Agent Node (Per-Node Chat)
**Pipeline**: `invoke_agent_node(agent_node_id, user_message, update_node_id?, provider?)` -> BFS context (up to 20 nodes) -> last 10 chat messages -> API call (max 4096 tokens, 90s timeout) -> create/update output Edit node.

**Output nodes**: Creates `user_doc` positioned right of agent node (+width+100, stacked by 275px). Auto-creates edge: agent -> output.

**Key files**: `AgentNodeViewer.tsx`, `agentNodeStore.ts`, `agent/agent_node.rs`

### 5.7 PDF Import Pipeline

**Backend** (`import_pdf`): extract text via pdf-extract (~10K chars) -> find DOI via regex -> Semantic Scholar/CrossRef lookup -> Claude fallback (`extract_pdf_with_claude`) -> `generate_bibtex` -> PdfMetadata.

**Frontend** (PdfImportDialog.tsx): 6-phase state machine: idle -> extracting -> preview -> success, with error recovery. Supports `positionOverride` for placement.

**Commands**: `import_pdf`, `extract_pdf_with_claude`

**Gotcha**: Claude fallback requires API key. If no key and DOI lookup fails, import_pdf errors.

### 5.8 PDF Export Pipeline

`node_type='export'` connects to Edit nodes which become document sections. Optionally connects to a Title node for a document title page with authors and affiliations.

**Backend** (pdf_export.rs, 2,183 lines): Renders PDF via genpdf. Markdown -> PDF via pulldown-cmark. Bundled LiberationSerif fonts at `src-tauri/fonts/`. Mixed EN/JP font rendering via `push_mixed_paragraph()` and `push_mixed_paragraph_aligned()`.

**Citation syntax in Edit nodes**: `{@cite_key}` for papers, `{@A; @B; @C}` for multi-citation, `{{image_id}}` for images.

**Title page**: When a Title node is connected to the Export node, the PDF includes a title page with document title, subtitle, and authors with affiliation markers. Authors display superscript affiliation indices (Unicode superscript characters ¹²³⁴⁵⁶⁷⁸⁹⁰) or dagger symbols (†‡§‖¶) depending on configuration.

**ExportStyleConfig** (stored as JSON in export node metadata): Controls PDF formatting. Fields:
- `en_font_preset` / `jp_font_preset`: Font selection
- `title_size` / `section_heading_size` / `subsection_heading_size` / `body_size`: Font sizes
- `line_spacing`: Line spacing multiplier
- `margin_top` / `margin_bottom` / `margin_left` / `margin_right`: Page margins (mm)
- `section_numbering`: Enable/disable section numbering
- `title_alignment`: `"left"` or `"center"` -- controls title page alignment
- `affiliation_marker`: `"number"` or `"dagger"` -- superscript digit vs dagger symbols for author affiliations
- `show_line_numbers`: Boolean -- adds line numbers on the left side of PDF body text

**Frontend** (ExportNodeViewer.tsx, 664 lines): Title, citation style radio (IEEE/APA), language selector, section list with reorder, references/images summary, style config button, "Generate PDF" button. ExportStyleConfigDialog.tsx (681 lines) provides a comprehensive style configuration modal with live preview.

**State**: `exportStore.ts` (62 lines) manages export progress, error state, and cross-window export coordination.

**Commands**: `get_export_sections`, `update_export_section_order`, `update_export_citation_style`, `update_export_language`, `update_export_style_config`, `generate_export_pdf`

### 5.9 Paper Chat (Gemini-Powered)

AI-assisted paper reading with full PDF context.

- `invoke_paper_summarize(node_id, layer_id)`: Sends PDF (base64) + customizable prompt to Gemini (8192 max tokens). Creates output Edit node with summary.
- `invoke_paper_chat(node_id, user_message)`: Multi-turn Q&A. PDF + chat history sent to Gemini. Persistent via `agent_node_messages`.

Uses Gemini 2.5 Flash with `inline_data` for PDF upload. 120s timeout.

**Key files**: `NodeDetailPanel.tsx` (paper chat section), `agent/paper_chat.rs`

### 5.10 Cloud Sync (Supabase)

Optional cloud sync for `.cld` files via Supabase storage.

**Backend** (sync.rs): upload, download, list remote, check status, get remote stats. Bucket name: "cladel".

**Frontend**: SyncDialog (management), CloudOpenDialog (browse remote files), syncStore (state).

**Settings**: Supabase URL + anon key configured in SettingsDialog.

**StatusBar**: Shows sync status indicator (in sync / not uploaded / out of sync).

**Commands**: `sync_list_remote`, `sync_check_status`, `sync_upload`, `sync_download`, `sync_get_remote_stats`, `save_supabase_config`, `get_supabase_config`, `get_supabase_config_status`, `delete_supabase_config`

### 5.11 Multi-Window Node Detail

**Routing**: HashRouter: "/" = main, "/node-detail/:nodeId/:layerId" = detached.

Double-click any node (except junction/deleted) -> opens detached WebviewWindow (500x700).

**Sync**: Cross-window events via `sync-events.ts` (NODE_UPDATED, NODE_DELETED, COMMENTS_CHANGED, FILE_CHANGED, GRAPH_CHANGED, SETTINGS_CHANGED). Auto-close on file operations.

**Key files**: `DetachedNodeDetail.tsx`, `detached-window.ts`, `sync-events.ts`

### 5.12 Color Mode Toggle (C Key)

Canvas-wide color mode toggle. Press C on the canvas to switch between two display modes:

- **Type Mode** (default): Nodes colored by node type (existing behavior).
- **User Mode**: Paper, Edit, and Image nodes colored by their `creator_user_id`. All other nodes keep functional colors.

**State**: `colorMode: 'type' | 'user'` in graphStore. Toggled via `toggleColorMode()`.

**Keyboard**: C key handler in GraphCanvas.tsx (within cursor mode keyboard handler). Skips input/textarea/contentEditable. Ignores Cmd/Ctrl+C.

**Visual**: CursorModeIndicator.tsx shows clickable "Type"/"User" pill with palette icon. Indigo (#6366f1) background when User mode active. Expanded help panel shows `C` shortcut.

**User colors**: `src/lib/userColors.ts` -- 8-color pastel palette (blue, pink, green, yellow, violet, orange, cyan, fuchsia). Deterministic hash by userId. Unknown/null -> gray (#f3f4f6).

**Key files**: `userColors.ts`, `CursorModeIndicator.tsx`, `graphStore.ts`, `PaperNode.tsx`, `UserDocNode.tsx`, `ImageNode.tsx`

### 5.13 User Identity System

Nodes and comments track which user created them.

**Backend**: `get_user_identity`, `register_user`, `update_user_name` in settings.rs. Stored in tauri-plugin-store as `user_id` (UUID) and `user_name`.

**Frontend**: `userStore.ts` with `userId`, `userName`, `isRegistered`. Loaded on app init.

**Data flow**: When creating a node (`CreateNodeInput`) or comment, `creator_user_id` and `creator_user_name` are passed from `userStore`. Stored in DB (v16+v17 migrations).

**Display**: `CreatorLabel.tsx` shows attribution on node cards. Color Mode uses `creator_user_id` for deterministic coloring.

### 5.14 Import Node (Temp React-Only)

NOT a DB node_type. Temporary placeholder created via Tab-to-Create or context menu.

Click -> file dialog -> auto-detects PDF vs image -> opens PdfImportDialog or ImageImportDialog. Success replaces temp node with real node at same position.

**Key files**: `ImportNode.tsx`, `GraphCanvas.tsx`

### 5.15 Content Pull

Inline reference insertion for Edit and Core nodes. Press Space on empty line -> ContentPullPopover.

**Two-step**: (1) Select connected node, (2) Choose what to pull (content, abstract, comments).

**Key files**: `ContentPullPopover.tsx`, `NoteEditorWithPull.tsx`

### 5.16 Paper Group System

Select 2+ papers -> GroupingButton -> enter name -> creates `paper_group` node with `{ member_node_ids: string[] }`.

Expand/collapse via context menu. `graphStore.expandedGroupIds` tracks state. Collapsed papers render in a compact grid layout.

**Key files**: `PaperGroupNode.tsx`, `GroupingButton.tsx`, `GroupNamePopover.tsx`, `graphStore.ts`

### 5.17 Compare Node

Connect exactly 2 Edit nodes to a Compare node to see their differences.

**Frontend**: CompareNodeViewer.tsx implements LCS-based line-level and word-level diff. Shows +added/-removed/~modified stats. Swap button to reverse before/after.

**Key files**: `CompareNode.tsx`, `CompareNodeViewer.tsx`

### 5.18 NanoBanana Node (AI Image Generation)

AI-powered image generation using the Gemini API (`gemini-2.5-flash-image` model).

- Generates images from text prompts with configurable aspect ratio.
- Reuses existing Gemini API key (no separate key needed).
- Generated images saved locally in `nano_banana_images/` subfolder next to the .cld file (or temp dir if unsaved).
- Supports aspect ratios: 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9.
- If no Gemini API key configured, viewer shows guidance with link to https://aistudio.google.com/apikey.
- 90s HTTP timeout, 2x retry on transient errors (429, 500, 502, 503, 529).
- Usage logged to `agent_usage_log` with `invocation_type = 'nano_banana'`.

**Key files**: `NanoBananaNode.tsx`, `NanoBananaNodeViewer.tsx`, `nano_banana.rs`
**Command**: `generate_nano_banana_image`

---

## 6. Rust Backend -- File Map

### Core Files

| File | Lines | Purpose |
|------|------:|---------|
| `src-tauri/src/main.rs` | 6 | Calls `cladel_app_lib::run()` |
| `src-tauri/src/lib.rs` | 280 | App entry: 111 command registrations, native menu, plugins init |
| `src-tauri/src/db.rs` | 1000 | SQLite schema, SCHEMA_VERSION=19, 19 migrations, Database+TabInfo structs |
| `src-tauri/src/commands/mod.rs` | 21 | Module declarations |

### Command Files

| File | Lines | #[tauri::command] Functions |
|------|------:|----------------------------|
| `commands/nodes.rs` | 567 | `create_node`, `update_node`, `delete_node`, `soft_delete_node`, `restore_node`, `get_nodes_by_layer`, `update_display_id`, `update_paper_bibtex` |
| `commands/edges.rs` | 211 | `create_edge`, `update_edge`, `delete_edge`, `restore_edge`, `get_edges_by_layer` |
| `commands/layers.rs` | 279 | `create_project`, `create_layer`, `delete_layer`, `get_layers`, `get_projects` |
| `commands/file_commands.rs` | 110 | `file_new`, `file_open`, `file_save`, `file_save_as`, `file_get_current_path` |
| `commands/tab_commands.rs` | 358 | `get_tabs`, `get_active_tab_id`, `create_tab`, `open_file_in_tab`, `switch_tab`, `close_tab`, `update_tab_after_save` |
| `commands/core_versions.rs` | 115 | `save_core_version`, `get_core_versions`, `get_core_version_diff` |
| `commands/note_versions.rs` | 74 | `save_note_version`, `get_note_versions` |
| `commands/node_comments.rs` | 177 | `add_node_comment`, `get_node_comments`, `update_node_comment`, `delete_node_comment`, `get_node_comment_counts` |
| `commands/edge_comments.rs` | 176 | `add_edge_comment`, `get_edge_comments`, `update_edge_comment`, `delete_edge_comment`, `get_edge_comment_counts` |
| `commands/agent_node_messages.rs` | 92 | `get_agent_node_messages`, `add_agent_node_message`, `delete_agent_node_message` |
| `commands/junctions.rs` | 321 | `split_edge_at_junction`, `dissolve_junction` |
| `commands/bibtex.rs` | 409 | `parse_bibtex` (hand-written parser, no external crate) |
| `commands/literature.rs` | 406 | `search_papers`, `get_paper_details` (Semantic Scholar API, 90 req/5min) |
| `commands/pdf_import.rs` | 638 | `import_pdf`, `extract_pdf_with_claude` |
| `commands/pdf_export.rs` | 2,183 | `get_export_sections`, `update_export_section_order`, `update_export_citation_style`, `update_export_language`, `update_export_style_config`, `generate_export_pdf` |
| `commands/image_import.rs` | 315 | `validate_image_file`, `create_image_node`, `get_node_image_info`, `check_file_exists`, `update_node_image_path`, `open_file_external`, `set_paper_pdf_path`, `get_paper_pdf_path` |
| `commands/export.rs` | 283 | `get_paper_nodes_by_layers`, `export_bibtex_selected`, `export_bibtex_to_file` |
| `commands/settings.rs` | 686 | `save_api_key`, `get_api_key_status`, `get_api_key`, `delete_api_key`, `save_gemini_api_key`, `get_gemini_api_key_status`, `get_gemini_api_key`, `delete_gemini_api_key`, `save_agent_capabilities`, `get_agent_capabilities`, `get_ui_preferences`, `save_ui_preferences`, `get_recent_files`, `add_recent_file`, `remove_recent_file`, `get_paper_summary_prompt`, `save_paper_summary_prompt`, `reset_paper_summary_prompt`, `save_supabase_config`, `get_supabase_config`, `get_supabase_config_status`, `delete_supabase_config`, `get_user_identity`, `register_user`, `update_user_name` |
| `commands/usage.rs` | 223 | `get_usage_summary`, `get_usage_history`, `clear_usage_log` |
| `commands/sync.rs` | 445 | `sync_list_remote`, `sync_check_status`, `sync_upload`, `sync_download`, `sync_get_remote_stats` |
| `commands/nano_banana.rs` | 260 | `generate_nano_banana_image` (Gemini image generation API) |

### Agent Subsystem

| File | Lines | Purpose |
|------|------:|---------|
| `commands/agent/mod.rs` | 475 | Public API, types (AgentError, AgentService trait), `invoke_agent`, capability guards |
| `commands/agent/agent_node.rs` | 634 | `invoke_agent_node`: BFS context, chat, output node creation, provider selection |
| `commands/agent/paper_chat.rs` | 475 | `invoke_paper_summarize`, `invoke_paper_chat` (Gemini, PDF base64 upload) |
| `commands/agent/comment_agent.rs` | 351 | `invoke_agent_comment`: @Agent in node comment threads |
| `commands/agent/claude_service.rs` | 171 | ClaudeAgentService: Anthropic API call + retry logic |
| `commands/agent/gemini_service.rs` | 260 | GeminiAgentService: Google Gemini API call + retry logic |
| `commands/agent/stub_service.rs` | 239 | StubAgentService: offline mode (not currently used) |
| `commands/agent/prompt.rs` | 252 | `build_system_prompt()`, `build_user_message()` |
| `commands/agent/parser.rs` | 489 | 4-tier JSON extraction, validation, fuzzy ID resolution |
| `commands/agent/context.rs` | 332 | BFS distance, relevance scoring, tiered token budget |
| `commands/agent/analysis.rs` | 730 | GraphAnomalies + ContentSignals for autonomous triggers |

### Key Internal Functions

**nodes.rs**: `get_next_display_id(conn, prefix)` -- global display ID generation. `extract_bibtex_key(bibtex)` -- citation key extraction. `node_from_row(row)` -- SQL row parsing.

**junctions.rs**: `junction_target_for_source(handle)`, `junction_source_for_target(handle)` -- handle mapping.

**literature.rs**: `LiteratureClient` with sliding-window rate limiter (VecDeque<Instant>, 90 req/5min).

**pdf_import.rs**: `extract_text_from_pdf(path)` (~10K chars limit). `find_doi(text)` (regex DOI extraction). Fallback chain: DOI -> Semantic Scholar -> CrossRef -> Claude.

**image_import.rs**: `detect_mime_type(path)`, `read_image_dimensions(path, mime)`. `open_file_external` is cross-platform: `open` (macOS), `cmd /c start` (Windows), `xdg-open` (Linux).

---

## 7. Frontend -- File Map

### Root Files

| File | Lines | Purpose |
|------|------:|---------|
| `src/main.tsx` | 20 | Entry: HashRouter with `/` and `/node-detail/:nodeId/:layerId` routes |
| `src/App.tsx` | 784 | Main app shell: initialization, tab/layer/delete orchestration, layout composition, dialog state |
| `src/types/index.ts` | 714 | All shared interfaces, SYSTEM_DEFAULTS, TabNodeType, TAB_HANDLE_MAP, ExportStyleConfig, ExportTitlePage |
| `src/vite-env.d.ts` | 1 | Vite client type reference |

### Stores (`src/store/`)

| File | Lines | Purpose | Key State |
|------|------:|---------|-----------|
| `graphStore.ts` | 1,853 | Nodes, edges, selection, CRUD, ghost nodes, junctions, groups, undo, color mode | `nodes`, `edges`, `dbNodes`, `dbEdges`, `selectedNodeId`, `colorMode`, `undoStack` |
| `agentStore.ts` | 382 | Global agent: status, suggestions, history, context building, cooldown | `status`, `suggestions`, `history`, `panelOpen`, `provider` |
| `tabStore.ts` | 200 | Tab lifecycle: new/open/switch/close, reinitialize on switch | `tabs`, `activeTabId`, `switching` |
| `fileStore.ts` | 163 | File ops (new/open/save/save-as), auto-dirty tracking | `currentFilePath`, `fileName`, `isDirty` |
| `settingsStore.ts` | 98 | API key status, AgentCapabilities, UIPreferences | `apiKeyStatus`, `agentCapabilities`, `uiPreferences` |
| `syncStore.ts` | 96 | Cloud sync state (Supabase) | `isConfigured`, `remoteFiles`, `syncStatus` |
| `layerStore.ts` | 58 | Layer list, current layer | `layers`, `currentLayer` |
| `agentNodeStore.ts` | 44 | Per-agent-node processing state | `processingNodes: Set`, `errors: Map` |
| `projectStore.ts` | 35 | Project list, current project | `projects`, `currentProject` |
| `userStore.ts` | 44 | User identity | `userId`, `userName`, `isRegistered` |
| `exportStore.ts` | 62 | PDF export progress + cross-window coordination | `selfExporting`, `progress`, `exportError` |

### Library Files (`src/lib/`)

| File | Lines | Purpose |
|------|------:|---------|
| `tauri-commands.ts` | 744 | Typed wrappers for all Tauri invoke commands (108 functions + 2 interface exports) |
| `sync-events.ts` | 144 | Cross-window event bus (6 event types, emit/listen helpers) |
| `detached-window.ts` | 90 | Multi-window management (open/focus/closeAll) |
| `userColors.ts` | 21 | User color palette (8 colors + unknown gray, deterministic hash) |

### Hooks (`src/hooks/`)

| File | Lines | Purpose |
|------|------:|---------|
| `useIdleDetector.ts` | 65 | Document-level idle detection (6 event types) |
| `useAutonomousTrigger.ts` | 53 | Idle -> auto invoke_agent (shared cooldown) |
| `useStructureTrigger.ts` | 173 | Structure change -> BFS anomaly check -> trigger (3s debounce) |

### Graph Components (`src/components/graph/`)

| File | Lines | Purpose |
|------|------:|---------|
| `GraphCanvas.tsx` | 1,608 | **Modify with care**. Canvas: nodeTypes/edgeTypes, clipboard, connection normalization, Tab-to-Create, drag-drop, edge merge, cursor mode, color mode keyboard handler |
| `CoreNode.tsx` | 131 | Core node card |
| `PaperNode.tsx` | 257 | Paper node card (BibTeX, PDF warning, user color support) |
| `UserDocNode.tsx` | 174 | Edit node card (content preview, user color support) |
| `ImageNode.tsx` | 263 | Image thumbnail + error state + user color support |
| `GhostNode.tsx` | 294 | Agent proposal (accept/dismiss, type badge) |
| `AgentNode.tsx` | 173 | Agent node (SmartToy icon, status indicator) |
| `ExportNode.tsx` | 170 | Export node (PictureAsPdf icon, section count) |
| `CompareNode.tsx` | 158 | Compare node (CompareArrows icon) |
| `TitleNode.tsx` | 159 | Title node card (Title icon, subtitle, author count) |
| `NanoBananaNode.tsx` | 230 | NanoBanana node card (AutoAwesome icon, image thumbnail, prompt preview) |
| `DeletedNode.tsx` | 176 | Soft-delete circle (tooltip with original title) |
| `JunctionNode.tsx` | 80 | Edge branch point dot |
| `PaperGroupNode.tsx` | 235 | Paper group with collapse/expand |
| `ImportNode.tsx` | 124 | Temp import placeholder (file dialog trigger) |
| `AnnotatedEdge.tsx` | 213 | Bezier edge + weight + badge + polygon arrow |
| `TabCreatePopover.tsx` | 298 | Light-themed popover (9 node type options, includes NanoBanana) |
| `EdgePopover.tsx` | 525 | Edge annotation modal: weight slider, comment thread, delete |
| `EdgeActionMenu.tsx` | 275 | Edge context menu |
| `ContextMenu.tsx` | 359 | Canvas/node right-click menus |
| `CanvasControls.tsx` | 124 | Zoom in/out/fit, agent panel toggle, minimap toggle |
| `CursorModeIndicator.tsx` | 196 | Upper-left bar: Move/Select pills + Color Type/User toggle + help panel |
| `CustomMiniMap.tsx` | 256 | SVG minimap (160x120) with color-coded nodes + edges |
| `ProcessingIndicator.tsx` | 37 | Spinning SmartToy icon (amber #f59e0b) |
| `GroupingButton.tsx` | 73 | "Group" button for multi-selected papers |
| `GroupNamePopover.tsx` | 115 | Popover input for group name |
| `CreatorLabel.tsx` | 46 | User attribution label on node cards |
| `NodeAccordionSection.tsx` | 86 | Reusable accordion for detail panel |
| `useConnectedDisplayIds.ts` | 30 | Hook: connected node display_ids |
| `GraphToolbar.tsx` | 199 | **DEPRECATED -- NOT rendered** |

### Panel Components (`src/components/panels/`)

| File | Lines | Purpose |
|------|------:|---------|
| `NodeDetailPanel.tsx` | 2,533 | **Modify with care**. Polymorphic viewer + CommentSection with @Agent |
| `AgentNodeViewer.tsx` | 1,140 | **Modify with care**. Agent node chat interface |
| `AgentPanel.tsx` | 984 | **Modify with care**. Global agent: queries, suggestions, history |
| `NoteEditorWithPull.tsx` | 892 | Textarea with Content Pull + @mention support |
| `ExportNodeViewer.tsx` | 664 | Export node: sections, citations, reorder, style config, generate PDF |
| `TitleNodeViewer.tsx` | 374 | Title node editor: title, subtitle, authors with affiliations |
| `ContentPullPopover.tsx` | 506 | Dark-themed two-step content selection popover |
| `CompareNodeViewer.tsx` | 484 | Diff viewer for Compare node (LCS algorithm) |
| `NanoBananaNodeViewer.tsx` | 280 | NanoBanana viewer: prompt input, aspect ratio, generate button, image preview |
| `MentionPopover.tsx` | 390 | @mention autocomplete for node references |
| `CoreHistoryPanel.tsx` | 383 | **DEPRECATED -- NOT imported/rendered** |
| `DetachedNodeDetail.tsx` | 193 | Standalone node detail window (cross-window sync) |
| `MarkdownPreview.tsx` | 132 | Markdown preview component |
| `FloatingDetailPanel.tsx` | 108 | Floating resizable detail panel |
| `MultiSelectPanel.tsx` | 39 | Multi-select info panel (placeholder) |

### Dialog Components (`src/components/dialogs/`)

| File | Lines | Purpose |
|------|------:|---------|
| `SettingsDialog.tsx` | 2,007 | **Modify with care**. API keys, capabilities, UI prefs, usage, paper prompt, sync |
| `WelcomeDialog.tsx` | 753 | Launch dialog: recent files, create/open |
| `PdfImportDialog.tsx` | 733 | PDF import 6-phase state machine with error recovery |
| `CloudOpenDialog.tsx` | 575 | Cloud file browser (Supabase) |
| `ExportBibtexDialog.tsx` | 471 | Tri-state checkbox tree export to .bib |
| `SyncDialog.tsx` | 440 | Cloud sync management |
| `NewLayerDialog.tsx` | 389 | Layer creation with optional source node |
| `ImageImportDialog.tsx` | 386 | Image import + validation + positionOverride |
| `ExportStyleConfigDialog.tsx` | 681 | PDF export style configuration (fonts, sizes, margins, title alignment, affiliation markers, line numbers) with live preview |
| `ConfirmDialogs.tsx` | 238 | Delete, BatchDelete, EdgeDelete, UnsavedChanges dialogs |

### Layout Components

| File | Lines | Purpose |
|------|------:|---------|
| `src/components/layers/LayerBar.tsx` | 313 | Left sidebar: layers, add/delete, Export BibTeX |
| `src/components/FileTabBar.tsx` | 216 | Top tab bar: open tabs, active indicator, close/new buttons |
| `src/components/StatusBar.tsx` | 152 | Bottom: node/edge counts, API status, agent status, sync |
| `src/components/ResizeHandle.tsx` | 22 | Sidebar resize handle |

---

## 8. Tauri Commands Reference

111 commands registered in `generate_handler![]` in `lib.rs`:

| Command | Rust File | Description |
|---------|-----------|-------------|
| `file_new` | file_commands.rs | Reset to empty in-memory DB |
| `file_open` | file_commands.rs | Open .cld/.klv/.tmgx file at path |
| `file_save` | file_commands.rs | Save to current path (VACUUM INTO) |
| `file_save_as` | file_commands.rs | Save to new path (VACUUM INTO) |
| `file_get_current_path` | file_commands.rs | Get current .cld file path |
| `get_tabs` | tab_commands.rs | List all tabs |
| `get_active_tab_id` | tab_commands.rs | Get active tab ID |
| `create_tab` | tab_commands.rs | Create new empty tab |
| `open_file_in_tab` | tab_commands.rs | Open file in new tab |
| `switch_tab` | tab_commands.rs | Switch active tab (snapshot + restore) |
| `close_tab` | tab_commands.rs | Close tab, cleanup snapshot |
| `update_tab_after_save` | tab_commands.rs | Update tab metadata after save |
| `create_node` | nodes.rs | Create node with auto display_id |
| `update_node` | nodes.rs | Update node fields |
| `delete_node` | nodes.rs | Hard delete node + connected edges |
| `soft_delete_node` | nodes.rs | Change node_type to 'deleted' |
| `restore_node` | nodes.rs | Restore node from undo data |
| `get_nodes_by_layer` | nodes.rs | Get all nodes in layer |
| `update_display_id` | nodes.rs | Change a node's display_id |
| `update_paper_bibtex` | nodes.rs | Update paper bibtex + sync display_id |
| `create_edge` | edges.rs | Create edge (no self-loops/duplicates) |
| `update_edge` | edges.rs | Update edge weight/comment/handles |
| `delete_edge` | edges.rs | Delete edge |
| `restore_edge` | edges.rs | Restore edge from undo data |
| `get_edges_by_layer` | edges.rs | Get all edges in layer |
| `create_project` | layers.rs | Create project |
| `create_layer` | layers.rs | Create layer + core node |
| `delete_layer` | layers.rs | Delete layer + all nodes/edges |
| `get_layers` | layers.rs | Get layers for project |
| `get_projects` | layers.rs | Get all projects |
| `save_core_version` | core_versions.rs | Save core node version snapshot |
| `get_core_versions` | core_versions.rs | List core node versions |
| `get_core_version_diff` | core_versions.rs | Diff two core versions |
| `save_note_version` | note_versions.rs | Save note version snapshot |
| `get_note_versions` | note_versions.rs | List note versions |
| `parse_bibtex` | bibtex.rs | Parse BibTeX string to entries |
| `search_papers` | literature.rs | Semantic Scholar search |
| `get_paper_details` | literature.rs | Semantic Scholar paper details |
| `add_node_comment` | node_comments.rs | Add comment to node |
| `get_node_comments` | node_comments.rs | Get comments for node |
| `update_node_comment` | node_comments.rs | Update comment content |
| `delete_node_comment` | node_comments.rs | Delete comment |
| `get_node_comment_counts` | node_comments.rs | Batch count comments by node IDs |
| `add_edge_comment` | edge_comments.rs | Add comment to edge |
| `get_edge_comments` | edge_comments.rs | Get comments for edge |
| `update_edge_comment` | edge_comments.rs | Update edge comment |
| `delete_edge_comment` | edge_comments.rs | Delete edge comment |
| `get_edge_comment_counts` | edge_comments.rs | Batch count comments by edge IDs |
| `split_edge_at_junction` | junctions.rs | Insert junction node into edge |
| `dissolve_junction` | junctions.rs | Merge junction back into single edge |
| `invoke_agent` | agent/mod.rs | Global agent invocation |
| `invoke_agent_node` | agent/agent_node.rs | Per-node agent chat |
| `invoke_agent_comment` | agent/comment_agent.rs | @Agent comment invocation |
| `invoke_paper_summarize` | agent/paper_chat.rs | Gemini paper summarization |
| `invoke_paper_chat` | agent/paper_chat.rs | Gemini paper Q&A |
| `save_api_key` | settings.rs | Save Anthropic API key |
| `get_api_key_status` | settings.rs | Get masked API key status |
| `get_api_key` | settings.rs | Get raw API key (backend-only, no frontend wrapper) |
| `delete_api_key` | settings.rs | Delete Anthropic API key |
| `save_gemini_api_key` | settings.rs | Save Gemini API key |
| `get_gemini_api_key_status` | settings.rs | Get masked Gemini key status |
| `get_gemini_api_key` | settings.rs | Get raw Gemini key (backend-only, no frontend wrapper) |
| `delete_gemini_api_key` | settings.rs | Delete Gemini API key |
| `save_agent_capabilities` | settings.rs | Save agent capability toggles |
| `get_agent_capabilities` | settings.rs | Get agent capabilities |
| `get_ui_preferences` | settings.rs | Get UI preference values |
| `save_ui_preferences` | settings.rs | Save UI preference values |
| `get_recent_files` | settings.rs | Get recent file list (max 10) |
| `add_recent_file` | settings.rs | Add path to recent files |
| `remove_recent_file` | settings.rs | Remove path from recent files |
| `get_paper_summary_prompt` | settings.rs | Get custom paper summary prompt |
| `save_paper_summary_prompt` | settings.rs | Save custom paper summary prompt |
| `reset_paper_summary_prompt` | settings.rs | Reset to default prompt |
| `save_supabase_config` | settings.rs | Save Supabase URL + key |
| `get_supabase_config` | settings.rs | Get Supabase config |
| `get_supabase_config_status` | settings.rs | Check if Supabase configured |
| `delete_supabase_config` | settings.rs | Delete Supabase config |
| `get_user_identity` | settings.rs | Get user_id + user_name |
| `register_user` | settings.rs | Register new user (generates UUID) |
| `update_user_name` | settings.rs | Update user display name |
| `import_pdf` | pdf_import.rs | Import PDF: extract text, DOI lookup, BibTeX |
| `extract_pdf_with_claude` | pdf_import.rs | Claude fallback for PDF metadata |
| `validate_image_file` | image_import.rs | Validate image file + read dimensions |
| `create_image_node` | image_import.rs | Create image node + node_images record |
| `get_node_image_info` | image_import.rs | Get image metadata for node |
| `check_file_exists` | image_import.rs | Check if file path exists |
| `update_node_image_path` | image_import.rs | Update image file path |
| `open_file_external` | image_import.rs | Open file in system default app |
| `set_paper_pdf_path` | image_import.rs | Set PDF path on paper node |
| `get_paper_pdf_path` | image_import.rs | Get PDF path for paper node |
| `get_paper_nodes_by_layers` | export.rs | Get papers grouped by layer (for BibTeX export) |
| `export_bibtex_selected` | export.rs | Export selected papers as BibTeX string |
| `export_bibtex_to_file` | export.rs | Export BibTeX to file via save dialog |
| `get_export_sections` | pdf_export.rs | Get export node sections preview |
| `update_export_section_order` | pdf_export.rs | Reorder sections |
| `update_export_citation_style` | pdf_export.rs | Set IEEE or APA |
| `update_export_language` | pdf_export.rs | Set export language |
| `update_export_style_config` | pdf_export.rs | Update export style config (fonts, sizes, margins, alignment, line numbers) |
| `generate_export_pdf` | pdf_export.rs | Generate PDF file |
| `get_usage_summary` | usage.rs | Usage stats + cost estimation |
| `get_usage_history` | usage.rs | Usage log entries |
| `clear_usage_log` | usage.rs | Clear usage log table |
| `get_agent_node_messages` | agent_node_messages.rs | Get chat messages for agent node |
| `add_agent_node_message` | agent_node_messages.rs | Add message to agent node chat |
| `delete_agent_node_message` | agent_node_messages.rs | Delete message from agent node chat |
| `sync_list_remote` | sync.rs | List remote files in Supabase |
| `sync_check_status` | sync.rs | Compare local vs remote file |
| `sync_upload` | sync.rs | Upload .cld to Supabase |
| `sync_download` | sync.rs | Download .cld from Supabase |
| `sync_get_remote_stats` | sync.rs | Get remote file stats |
| `generate_nano_banana_image` | nano_banana.rs | Generate image via Gemini Nano Banana API |

---

## 9. Settings Reference

Store file: `~/Library/Application Support/com.cladel.desktop/settings.json` (tauri-plugin-store)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `anthropic_api_key` | string | -- | Anthropic (Claude) API key |
| `gemini_api_key` | string | -- | Google Gemini API key (shared by Paper chat + NanoBanana) |
| `agent_enabled` | bool | true | Master agent toggle |
| `autonomous_enabled` | bool | true | Autonomous trigger toggle |
| `search_papers_enabled` | bool | true | Paper search capability |
| `suggest_connections_enabled` | bool | true | Connection suggestion capability |
| `suggest_ideas_enabled` | bool | true | Idea suggestion capability |
| `autonomous_idle_seconds` | u64 | 45 | Seconds idle before auto-trigger |
| `autonomous_cooldown_seconds` | u64 | 120 | Cooldown between auto-triggers |
| `core_default_width` | f64 | 280 | Core node default width |
| `core_default_height` | f64 | 210 | Core node default height |
| `paper_default_width` | f64 | 280 | Paper node default width |
| `paper_default_height` | f64 | 210 | Paper node default height |
| `user_doc_default_width` | f64 | 280 | Edit node default width |
| `user_doc_default_height` | f64 | 210 | Edit node default height |
| `ghost_default_width` | f64 | 280 | Agent proposal default width |
| `ghost_default_height` | f64 | 210 | Agent proposal default height |
| `image_default_width` | f64 | 280 | Image node default width |
| `image_default_height` | f64 | 210 | Image node default height |
| `sidebar_default_width` | f64 | 380 | Right sidebar default width |
| `canvas_background` | string | #f8fafc | Canvas background color |
| `canvas_grid_enabled` | bool | true | Show grid on canvas |
| `canvas_grid_size` | f64 | 20 | Grid cell size in pixels |
| `editor_font_size` | f64 | 13 | Editor font size in pixels |
| `paper_summary_prompt` | string | (template) | Custom prompt for paper summarization |
| `supabase_url` | string | -- | Supabase project URL |
| `supabase_anon_key` | string | -- | Supabase anonymous key |
| `recent_files` | JSON array | [] | Recent files list (max 10 entries) |
| `user_id` | string | -- | User UUID (generated on register) |
| `user_name` | string | -- | User display name |

---

## 10. AI Provider System

### Providers

| Provider | Model | Endpoint | Used By |
|----------|-------|----------|---------|
| Claude (Anthropic) | `claude-sonnet-4-20250514` | `api.anthropic.com/v1/messages` | Global agent, Agent node, Comment agent |
| Gemini (Google) | `gemini-2.5-flash` | `generativelanguage.googleapis.com/v1beta/...` | Paper summarize/chat, Agent node (optional), Comment agent (optional) |
| Gemini (Google) | `gemini-2.5-flash-image` | `generativelanguage.googleapis.com/v1beta/...` | NanoBanana image generation |

### Retry Logic

Both providers: retry 2x on transient errors (HTTP 429, 500, 502, 503, 529). Delays: 2s after first failure, 5s after second.

### Timeouts

| Use Case | Timeout |
|----------|---------|
| Global agent | 60s |
| Agent node | 90s |
| Comment agent | 60s |
| Paper summarize | 120s |
| Paper chat | 60s |
| NanoBanana image | 90s |

### Token Limits

| Use Case | Max Output Tokens |
|----------|-------------------|
| Global agent | 4096 |
| Agent node | 4096 |
| Comment agent | 1024 |
| Paper summarize | 8192 |
| Paper chat | 4096 |

### Cost Model (per million tokens)

| Model | Input | Output |
|-------|-------|--------|
| claude-sonnet-4-20250514 | $3 | $15 |
| gemini-2.5-flash | $0.15 | $0.60 |

### Usage Logging

All API calls logged to `agent_usage_log` table. `get_usage_summary` returns aggregate stats + cost estimation. Frontend displays in SettingsDialog "API Usage" section.

---

## 11. Visual Design Tokens

### Node Colors

| Node Type | Background | Border (unselected) | Border (selected) | Glow (selected) |
|-----------|------------|--------------------|--------------------|------------------|
| core | #1e3a5f | 2px solid #1e40af | 4px solid #1e40af | #60a5fa |
| paper | #f0fdf4 | 1px solid #059669 | 3px solid #34d399 | rgba(52,211,153,0.3) |
| user_doc | #fffbeb | 1px solid #d97706 | 3px solid #fbbf24 | rgba(251,191,36,0.3) |
| agent_proposal | rgba(124,58,237,0.12) | 1px dashed #7c3aed | 3px dashed #7c3aed | #a78bfa |
| agent | rgba(67,56,202,0.08) | 1px solid #4338ca | 3px solid #4338ca | #6366f1 |
| export | rgba(225,29,72,0.08) | 1px solid #e11d48 | 3px solid #e11d48 | #e11d48 |
| compare | rgba(2,132,199,0.08) | 1px solid #0284c7 | 3px solid #0284c7 | #0284c7 |
| title | rgba(120,113,108,0.08) | 1px solid #78716c | 3px solid #78716c | rgba(120,113,108,0.3) |
| image | #f0fdfa | 1px solid #0891b2 | 3px solid #06b6d4 | rgba(6,182,212,0.3) |
| nano_banana | #fefce8 | 1px solid #ca8a04 | 3px solid #eab308 | rgba(250,204,21,0.4) |
| deleted | rgba(229,231,235,0.3) | 1px dashed #d1d5db | 3px dashed #d1d5db | -- |
| junction | #4b5563 (circle) | -- | -- | -- |

### Edge Colors

| State | Color |
|-------|-------|
| Default | #6b7280 |
| Selected | #3b82f6 |
| Agent-created | #7c3aed (dashed) |
| Deleted endpoint | #9ca3af |

### ProcessingIndicator

Spinning SmartToy icon: amber #f59e0b, background circle rgba(245,158,11,0.15), 1.2s rotation.

### User Color Palette (User Color Mode)

8 deterministic colors assigned by hashing `creator_user_id`:

| Index | Name | Background | Border | Glow |
|-------|------|------------|--------|------|
| 0 | Blue | #dbeafe | #3b82f6 | #93c5fd |
| 1 | Pink | #fce7f3 | #ec4899 | #f9a8d4 |
| 2 | Green | #d1fae5 | #10b981 | #6ee7b7 |
| 3 | Yellow | #fef3c7 | #f59e0b | #fcd34d |
| 4 | Violet | #ede9fe | #8b5cf6 | #c4b5fd |
| 5 | Orange | #ffedd5 | #f97316 | #fdba74 |
| 6 | Cyan | #cffafe | #06b6d4 | #67e8f9 |
| 7 | Fuchsia | #fdf2f8 | #d946ef | #f0abfc |

Unknown/null user: bg #f3f4f6, border #9ca3af, glow #d1d5db.

---

## 12. Known Issues and Technical Notes

### Discrepancies Found

1. **Backend-only commands**: `get_api_key` and `get_gemini_api_key` are registered in `generate_handler![]` but have **no frontend wrapper** in `tauri-commands.ts`. These are raw key accessors used internally by backend agent commands. The frontend uses `get_api_key_status` / `get_gemini_api_key_status` instead. This is intentional.

2. **Node types**: All 12 DB node types in the CHECK constraint have corresponding React components. The `import` type exists in `TabNodeType` (frontend only) but is NOT in the DB CHECK -- this is by design (temp placeholder).

3. **Deprecated files still on disk**:
   - `src/components/graph/GraphToolbar.tsx` (199 lines) -- NOT rendered anywhere. Can be safely deleted.
   - `src/components/panels/CoreHistoryPanel.tsx` (383 lines) -- NOT imported/rendered. Can be safely deleted.

4. **SCHEMA_VERSION**: Value is 19. There are exactly 19 migration blocks (`if current_version < 1` through `if current_version < 19`). **Matches**.

### Technical Notes

- **React Flow v12**: `NodeDragHandler` doesn't exist -- use `OnNodeDrag`. Custom node props: `NodeProps<Node<MyDataType>>` with `[key: string]: unknown` in data type.
- **Handle overlap causes edge direction swap**: Each node side has overlapping source + target handles. Always use `connectingFrom` state to detect and normalize swaps.
- **Arrow rendering**: Use `bezierPoint(t=0.92)` for accurate tangent. Must use `<polygon>` not SVG markers (WebKit breaks them).
- **Semantic Scholar rate limiting**: 90 requests per 5-minute sliding window. Tracked via `VecDeque<Instant>` in `LiteratureClient`.
- **PDF Claude fallback requires API key**: If no key and DOI lookup fails, `import_pdf` errors.
- **BibTeX parser**: Hand-written in `bibtex.rs` (no external crate). Handles UTF-8/multibyte correctly.
- **StubAgentService**: Exists in `stub_service.rs` (239 lines) but is not used. Only ClaudeAgentService and GeminiAgentService are active.
- **Version history tables**: `core_versions`/`note_versions` tables and backend commands exist but frontend no longer uses them.
- **Tab snapshots**: In-memory tabs `VACUUM INTO` temp files at `~/.tmp/cladel-tabs/`. Cleaned up on tab close but not on crash.
- **PDF export fonts**: LiberationSerif bundled at `src-tauri/fonts/` (Regular/Bold/Italic/BoldItalic).
- **Multi-selection**: Shift+click toggles individual, Shift+drag draws selection box (SelectionMode.Partial). Module-level `_shiftHeld` flag works around React Flow's stale `multiSelectionActive` bug.
- **open_file_external**: Cross-platform via `#[cfg(target_os)]` -- `open` (macOS), `cmd /c start` (Windows), `xdg-open` (Linux).
- **Migration v14 and v15 overlap**: v14 added both 'export' and 'compare' to the CHECK constraint. v15 is a safety net that re-checks for 'compare' in case a user upgraded from a state where v14 only added 'export'.
- **Migration v18 (title node)**: Column-aware rebuild with all columns (including creator_user_id, creator_user_name from v16/v17). Safe for both fresh DBs and upgrades from any prior version.
- **Migration v19 (nano_banana node)**: Column-aware rebuild with all columns. Same pattern as v18.
- **Large files** (modify with care): NodeDetailPanel.tsx (2,533), pdf_export.rs (2,183), SettingsDialog.tsx (2,007), graphStore.ts (1,853), GraphCanvas.tsx (1,608), AgentNodeViewer.tsx (1,140), AgentPanel.tsx (984), NoteEditorWithPull.tsx (892), ExportStyleConfigDialog.tsx (681), ExportNodeViewer.tsx (664).

### Native Menu Bar

- **Cladel**: About, Settings (Cmd+,), Hide, Hide Others, Show All, Quit
- **File**: New (Cmd+N), Open (Cmd+O), Save (Cmd+S), Save As (Cmd+Shift+S), Close Tab (Cmd+W)
- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All
- **Window**: Minimize, Close

Close Tab (Cmd+W) has special handling: if a detached window is focused, closes that window instead.

### Context Menus

- **Canvas right-click**: "Add Edit Node", "Import File", "Add Agent Node", "Add Export Node", "Add NanoBanana Node"
- **Node right-click** (Paper/UserDoc/Image/Agent/Title/NanoBanana): "Delete Node"
- **Deleted placeholder right-click**: "Remove completely"
- **Junction right-click**: "Dissolve junction", "Remove junction"
- **Paper Group right-click**: "Expand Group", "Collapse Group", "Ungroup Papers"
- **Edge left-click**: popover -> Edit Annotations / Edge Properties / Add Branch Point

---

## 13. How to Continue Development

### How to Add a New Tauri Command

1. Write a `#[tauri::command]` function in the appropriate `src-tauri/src/commands/*.rs` file.
2. Register it in `generate_handler![]` in `src-tauri/src/lib.rs`.
3. If the command module is new, add `pub mod <name>;` in `src-tauri/src/commands/mod.rs`.
4. Add a typed wrapper function in `src/lib/tauri-commands.ts`.
5. Call the wrapper from the appropriate Zustand store or component.
6. Run `cd src-tauri && cargo check` to verify Rust compilation.
7. Run `npx tsc --noEmit` to verify TypeScript types.

### How to Add a DB Migration

1. Increment `SCHEMA_VERSION` in `src-tauri/src/db.rs` (line 7).
2. Add a new `if current_version < N { ... }` block at the end of `initialize_schema()`, before the final version update.
3. For ALTER TABLE additions: use `ALTER TABLE ... ADD COLUMN`.
4. For CHECK constraint changes: use column-aware table rebuild pattern (see migrations v7, v11, v13, v14 for examples).
5. Never reorder existing migrations. Append-only.
6. Test on both fresh DB (in-memory) and existing `.cld` files.

### How to Add a New Node Type

1. Add the type string to the CHECK constraint in `db.rs` via a new migration (table rebuild).
2. Add the type to `NodeType` union in `src/types/index.ts`.
3. Add to `TabNodeType` if it should appear in Tab-to-Create.
4. Create a React component in `src/components/graph/` (follow existing pattern: handles, NodeResizer, ProcessingIndicator).
5. Register it in `nodeTypes` in `GraphCanvas.tsx`.
6. Add rendering logic in `NodeDetailPanel.tsx` (or a new viewer component).
7. Update `getDefaultNodeSizes()` in `graphStore.ts` if the node needs custom defaults.
8. Update `CustomMiniMap.tsx` color mapping.
9. Optionally add to `COPYABLE_TYPES` in `GraphCanvas.tsx` for clipboard support.
10. Optionally add to context menu options in `ContextMenu.tsx`.

### How to Add a New AI Provider

1. Create a new service file in `src-tauri/src/commands/agent/` implementing the `AgentService` trait:
   - `fn name(&self) -> &str`
   - `async fn call(&self, system_prompt: &str, user_message: &str, max_tokens: u32) -> Result<AgentApiResponse, AgentError>`
2. Add the provider as an option in `invoke_agent_node` and `invoke_agent_comment` provider selection logic.
3. Add API key management commands in `settings.rs`.
4. Add frontend API key UI in `SettingsDialog.tsx`.
5. Add provider option in `AgentPanel.tsx` and `AgentNodeViewer.tsx` dropdowns.
6. Update cost model in `usage.rs` `calculate_cost()`.

### How to Add a New Settings Key

1. Add the key string in `settings.rs` read/write functions. Use `tauri_plugin_store` to persist.
2. Add the corresponding TypeScript type/interface in `src/types/index.ts`.
3. Add load/save functions in `src/lib/tauri-commands.ts`.
4. Add state + actions in the appropriate Zustand store (usually `settingsStore.ts`).
5. Add UI controls in `SettingsDialog.tsx`.

---

## Appendix: Build Configuration

### Cargo.toml Dependencies

| Crate | Version | Features | Purpose |
|-------|---------|----------|---------|
| tauri | 2 | protocol-asset | App framework |
| tauri-plugin-shell | 2 | -- | Shell commands |
| tauri-plugin-dialog | 2 | -- | File dialogs |
| tauri-plugin-store | 2 | -- | Settings persistence |
| serde | 1 | derive | Serialization |
| serde_json | 1 | -- | JSON parsing |
| rusqlite | 0.31 | bundled | SQLite (bundled, no system dep) |
| uuid | 1 | v4, serde | UUID generation |
| chrono | 0.4 | serde | Date/time |
| reqwest | 0.12 | json | HTTP client |
| pdf-extract | 0.7 | -- | PDF text extraction |
| regex | 1 | -- | DOI extraction |
| image | 0.24 | -- | Image dimension reading |
| base64 | 0.22 | -- | PDF base64 encoding |
| genpdf | 0.2 | images | PDF generation |
| pulldown-cmark | 0.12 | -- | Markdown to PDF |

### package.json Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @tauri-apps/api | ^2.10.1 | Tauri IPC, window, events |
| @tauri-apps/plugin-dialog | ^2.6.0 | File dialogs |
| @tauri-apps/plugin-store | ^2.4.2 | Settings storage |
| @xyflow/react | ^12.10.1 | React Flow graph library |
| react | ^19.2.4 | UI framework |
| react-router-dom | ^7.13.1 | HashRouter routing |
| zustand | ^5.0.11 | State management |
| @mui/material | ^7.3.8 | UI components |
| @mui/icons-material | ^7.3.8 | Material icons |
| react-markdown | ^10.1.0 | Markdown rendering |
| tailwindcss | ^4.2.1 | CSS framework |
| typescript | ^5.9.3 | Type checking |
| vite | ^7.3.1 | Build tool |

### tauri.conf.json

| Setting | Value |
|---------|-------|
| App identifier | `com.cladel.desktop` |
| Window size | 1200 x 800, resizable |
| CSP | null (permissive, required for asset:// protocol) |
| Asset protocol | Enabled, scope `["**/*"]` |
| Dev URL | `http://localhost:1420` |

---

**Total**: Frontend 28,416 lines (80 files) + Backend 15,001 lines (35 files) = **43,417 lines**.

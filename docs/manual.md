# Tsumugix User Manual

Tsumugix is a desktop application for researchers to organize thinking as a knowledge graph. It combines literature management (PDF import), personal thought mapping, and AI agents (Claude / Gemini) as collaborative research partners.

The name comes from the Japanese verb 「紡ぐ」(tsumugu) — to spin or weave threads together.

**File format:** `.tmgx` (single portable SQLite file). PDFs and images are referenced by file path, not embedded.

---

## 1. Getting Started

### 1.1 Welcome Dialog

On launch, the Welcome Dialog provides three options:

- **Create New** — Start a fresh research project (in-memory until first Save)
- **Open File** — Browse for an existing `.tmgx` file
- **Recent Files** — Quick access to previously opened projects

### 1.2 Application Layout

```
+--------+------------------------------+----------------------------+
|  File Tab Bar (file1.tmgx | file2.tmgx | +)            [Settings] |
+--------+------------------------------+----------------------------+
| Layers |                              |  Node Detail Panel         |
| (left) |       Graph Canvas           |  (right sidebar,           |
| Layer 3|       (React Flow)           |   resizable, min 280px)    |
| Layer 2|                              |                            |
| Layer 1|                              |  OR Agent Panel            |
|--------|                              |                            |
| Export |                              |                            |
| BibTeX |                              |                            |
+--------+------------------------------+----------------------------+
|  Status Bar: Nodes: N  Edges: N  |  Claude API: *  Agent: On    |
+-------------------------------------------------------------------+
```

- **File Tab Bar** (top): Browser-style tabs for multiple open files, plus a Settings button.
- **Layer Bar** (left): Vertical list of layers. Higher layers at top.
- **Graph Canvas** (center): The main workspace. Nodes and edges.
- **Node Detail Panel** (right): Opens when a node is selected. Content varies by node type.
- **Status Bar** (bottom): Node/edge counts, API status, agent status.
- **MiniMap** (bottom-right): 160x120 SVG overview of the canvas with color-coded nodes.

---

## 2. File Operations

### 2.1 File Tab System

Each tab maintains its own independent project. Switching tabs snapshots the current tab and restores the target tab.

| Action | How |
|--------|-----|
| New file | `Cmd+N` or click **+** on the tab bar |
| Open file | `Cmd+O` |
| Save | `Cmd+S` |
| Save As | `Cmd+Shift+S` |
| Close tab | `Cmd+W` or click **x** on the tab |

Closing the last tab automatically creates a new empty tab.

---

## 3. Nodes

### 3.1 Node Types

All nodes default to **280x210** (4:3 landscape) and are resizable. Every node has 4-directional handles (top, bottom, left, right) for connecting edges.

| Node | Color | Purpose |
|------|-------|---------|
| **Core** | Deep blue | One per layer. Foundation for that stage of thinking. Not deletable. |
| **Edit** | Amber | Your notes and ideas. Markdown editor with auto-save, Content Pull, and @mention. |
| **Paper** | Light green | Imported research papers. BibTeX metadata, PDF viewing, Paper Chat. |
| **Image** | Teal | Image attachments. References a file path (not embedded). |
| **Agent** | Indigo | AI chat assistant. Context-aware responses, creates output Edit nodes. |
| **Export** | Rose | PDF document builder. Connected Edit nodes become sections. |
| **Agent Proposal** | Purple (dashed) | AI-generated suggestion. Accept to convert to Paper or Edit, or dismiss. |
| **Paper Group** | Green composite | Groups multiple Paper nodes. Collapsible. |
| **Junction** | Dark gray dot | Edge branching point. Can be dissolved. |
| **Deleted** | Gray circle | Soft-delete placeholder. Right-click to remove completely. |

### 3.2 Creating Nodes

#### Tab-to-Create (recommended)

Press **Tab** to open a popover near the selected node. Choose a direction:

| Shortcut | Direction |
|----------|-----------|
| `Tab` | Right |
| `Shift+Tab` | Down |
| `Ctrl+Tab` / `Cmd+Tab` | Left |
| `Ctrl+Shift+Tab` / `Cmd+Shift+Tab` | Up |

The popover offers six options (press **1-6** for instant selection):

1. Edit
2. Paper
3. Image
4. Agent
5. Import File
6. Export

The new node is automatically connected to the source node with an edge.

**Three contexts:**
- **Node selected** — new node is placed relative to and connected to the selected node.
- **Edge being dragged** — press Tab during a drag to create a connected node at the drag target.
- **Nothing selected** — new node is placed at the cursor with no connection.

#### Right-Click Context Menu

Right-click on the canvas to open the context menu:

- Add Edit Node
- Import File
- Add Agent Node
- Add Export Node

#### Drag-and-Drop

Drag a PDF or image file onto the canvas to import it.

### 3.3 Deleting Nodes

- **Soft delete:** Right-click a node and select "Delete Node", or select and press `Delete` / `Backspace`. The node becomes a gray circle placeholder. Edges are preserved.
- **Hard delete:** Right-click a soft-deleted placeholder and select "Remove completely".
- Core nodes cannot be deleted.

### 3.4 Copy and Paste

`Cmd+C` / `Cmd+V` to copy and paste selected nodes (Paper, Edit, Image, Agent, Export). Connected edges between copied nodes are included.

### 3.5 Display IDs

Every node has a globally unique display ID:

| Node Type | Format | Editable |
|-----------|--------|----------|
| Core | `Core1`, `Core2`, ... | No |
| Paper | BibTeX citation key or `paper_1` | Via BibTeX edit |
| Edit | `note_1`, `note_2`, ... | Yes |
| Agent | `agent_node_1`, ... | No |
| Image | `image_1`, ... | No |
| Export | `export_1`, ... | No |

Display IDs are shown as muted labels on nodes and are used for `@{id}` references.

---

## 4. Edges (Connections)

### 4.1 Creating Edges

Drag from any handle on one node to a handle on another node. Self-loops and duplicate edges are not allowed.

### 4.2 Edge Properties

- **Weight** (1-5): Controls visual thickness.
- **Comments**: Threaded conversations on edges, with count badges.
- **Direction**: Shown with an arrowhead along the curve.
- **Visual states**: Gray (default), blue (selected), purple dashed (agent-created), gray faded (endpoint deleted).

### 4.3 Edge Interactions

Left-click an edge to open the action menu:

| Action | Description |
|--------|-------------|
| Edit Annotations | Full modal with weight slider and comment thread |
| Delete Connection | Remove the edge |
| Edge Properties | Weight slider, creation date |
| Add Branch Point | Insert a junction node to fork the edge |

---

## 5. Layers

Layers represent stages in the evolution of your thinking.

- **Layer 1** is created by default and cannot be deleted.
- Each layer has its own independent set of nodes and edges, plus one Core node.
- Creating a new layer optionally inherits Core content from the previous layer (or from a selected source node).

**Layer Bar** (left sidebar):
- Click a layer to switch.
- Click **+** to add a new layer.
- Click **x** to delete a layer (Layer 2+).
- Click **Export .bib** to export BibTeX references.

---

## 6. Editing Content

### 6.1 Edit Nodes

The right sidebar shows a markdown textarea when an Edit node is selected.

- **Auto-save**: Changes save automatically after 800ms of inactivity.
- **Title**: Editable text field at the top.
- **Display ID**: Editable (must be globally unique).

### 6.2 Core Nodes

Same markdown editor as Edit nodes, but with a 2-second auto-save delay. Title and display ID are not editable.

### 6.3 Content Pull

Insert content from connected nodes without retyping.

1. Place cursor on an **empty line** in an Edit or Core node.
2. Press **Space**.
3. **Step 1**: Select a connected node (Core, Paper, or Edit).
4. **Step 2**: Choose what to pull:
   - **Core / Edit**: Content or comments
   - **Paper**: Abstract or comments

Navigate with arrow keys, Enter to select, Esc to cancel.

### 6.4 @Mention References

Reference any connected node inline using autocomplete.

1. Type `@` in any textarea (Edit nodes, comments).
2. A popover appears listing all connected nodes (except junctions and deleted nodes).
3. Filter by typing part of the display ID.
4. Select with Enter or click.
5. Inserts `@{display_id}` at the cursor.

The popover shows:
- Color-coded type badge (Core, Paper, Edit, Agent, Image, Export)
- Display ID (monospace)
- Node title
- Group name (for papers inside a Paper Group)

**Keyboard navigation**: arrows to move, Enter to select, Esc to cancel.

### 6.5 Reference Format

All node references use the unified `@{display_id}` format:

```
See the results in @{note_3} which build on @{paper_1}.
```

Multi-citation (for Export/PDF generation):

```
Previous work @{paper_1; paper_2; paper_3} has shown...
```

The Export node interprets these references based on node type:
- **Paper** nodes become formatted citations
- **Image** nodes become embedded figures
- **Other** node types are rendered as `[display_id]`

---

## 7. AI Agent Features

Tsumugix supports two AI providers:

| Provider | Model | Used For |
|----------|-------|----------|
| **Claude** (Anthropic) | claude-sonnet-4 | Global agent, Agent nodes, comment replies |
| **Gemini** (Google) | gemini-2.5-flash | Paper summarize/chat, Agent nodes (optional) |

API keys are configured in **Settings** (`Cmd+,`).

### 7.1 Agent Node

A per-node AI assistant with persistent chat history.

1. Create an Agent node (Tab-to-Create or context menu).
2. Select it to open the chat interface in the right panel.
3. Type a message and click **Run** (or press `Ctrl+Enter` / `Cmd+Enter`).
4. The agent reads context from connected nodes (up to 20 nodes via BFS traversal).
5. The response is placed in a new Edit node, connected to the Agent node.
6. Click **Update Last** to revise the existing output instead of creating a new node.

Provider can be toggled between Claude and Gemini per invocation.

### 7.2 @Agent in Comments

Invoke AI directly from a comment thread on any node.

1. Open a node's comment section in the right sidebar.
2. Type a comment that includes `@Agent` (case-insensitive).
3. The comment posts immediately, and the AI processes the request.
4. The AI response appears as a new comment from the agent.

A spinning amber indicator appears on the node during processing.

### 7.3 Global Agent

When no node is selected, the right sidebar shows the Global Agent panel.

- **Query box**: Ask the AI about your entire graph.
- **Suggestions**: AI-generated insights based on graph structure.
- **History**: Past queries and responses.

### 7.4 Autonomous Triggers

When enabled (in Settings), the agent can trigger automatically:

- **Time-based**: Activates after a configurable idle period (default: 45 seconds).
- **Structure-based**: Detects graph anomalies (isolated nodes, disconnected clusters, star patterns, etc.).
- **Cooldown**: Minimum time between autonomous triggers (default: 120 seconds).

### 7.5 Paper Chat (Gemini)

For Paper nodes with an associated PDF:

1. Select a Paper node.
2. In the right panel, use **Summarize** to generate an AI summary in a new Edit node.
3. Use the **Chat** section for multi-turn Q&A about the paper's content.
4. Gemini receives the full PDF for context.

---

## 8. Importing Papers and Images

### 8.1 PDF Import

Import a research paper PDF to create a Paper node with extracted metadata.

**How to import:**
- Tab-to-Create → Import File → select PDF
- Right-click canvas → Import File → select PDF
- Drag-and-drop a PDF onto the canvas

**Metadata extraction pipeline** (automatic):
1. Extract text from PDF (~10,000 characters)
2. Detect DOI via regex
3. Look up metadata via Semantic Scholar
4. Fallback to CrossRef
5. Fallback to Claude AI extraction (requires API key)
6. Manual BibTeX entry if all fail

### 8.2 Image Import

**How to import:**
- Tab-to-Create → Image
- Right-click canvas → Import File → select image
- Drag-and-drop an image onto the canvas

Images are referenced by file path (not embedded in the `.tmgx` file). If the file is moved or deleted, the node shows an error state with a re-link option.

---

## 9. Export

### 9.1 PDF Export (Export Node)

Create a structured PDF document from your graph.

1. Create an **Export node** (Tab-to-Create or context menu).
2. Connect **Edit nodes** to it — each becomes a section in the document.
3. Select the Export node to configure in the right panel:
   - **Title**: Document title
   - **Citation style**: IEEE `[1]` or APA `(Author, Year)`
   - **Sections**: Reorder with arrow buttons. Refresh to pick up new connections.
   - **References**: Auto-detected from `@{paper_id}` references in section content.
   - **Images**: Auto-detected from `@{image_id}` references in section content.
4. Click **Generate PDF** to save.

**Reference syntax in Edit nodes** (used by Export):

| Syntax | Rendered As |
|--------|-------------|
| `@{paper_id}` | `[1]` (IEEE) or `(Author, Year)` (APA) |
| `@{paper_1; paper_2}` | `[1,2]` (IEEE) or `(Author1; Author2, Year)` (APA) |
| `@{image_id}` | `[Figure: title]` + embedded image |

### 9.2 BibTeX Export

Export bibliography entries for selected papers.

1. Click **Export .bib** in the Layer Bar (left sidebar).
2. Select papers using the tri-state checkbox tree (per layer).
3. Choose output location for the `.bib` file.

---

## 10. Paper Groups

Organize multiple Paper nodes into a collapsible group.

1. Select 2 or more Paper nodes (Shift+click).
2. Click the **Group** button that appears.
3. Enter a group name.
4. A Paper Group node is created containing the selected papers.

**Right-click a Paper Group to:**
- Expand Group (show member papers)
- Collapse Group (hide members)
- Ungroup Papers (dissolve back to individual nodes)

When using @mention, papers inside a connected Paper Group are available for selection (shown with "in: group_name").

---

## 11. Multi-Window

Double-click any node (except junction or deleted) to open it in a **detached window** (500x700). The detached window shows the full Node Detail Panel and syncs with the main window. It auto-closes on file operations (new, open, switch tab).

---

## 12. Settings

Open with `Cmd+,` or click the gear icon on the File Tab Bar.

### API Keys

| Key | Provider | Where to Get |
|-----|----------|-------------|
| Anthropic API Key | Claude | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| Gemini API Key | Google | [aistudio.google.com](https://aistudio.google.com/apikey) |

### Agent Capabilities

| Setting | Default | Description |
|---------|---------|-------------|
| Agent Enabled | On | Master switch for all AI features |
| Autonomous Mode | On | Enable idle / structure triggers |
| Search Papers | On | Allow Semantic Scholar lookups |
| Suggest Connections | On | AI graph analysis |
| Suggest Ideas | On | AI content analysis |
| Idle Seconds | 45 | Time before idle trigger |
| Cooldown Seconds | 120 | Minimum time between auto-triggers |

### UI Preferences

- Canvas background color
- Grid on/off and grid size
- Default node sizes (per type)
- Sidebar width

### API Usage Monitor

- Total tokens used and cost estimate
- Usage history with timestamps
- Clear history button

### Paper Summary Prompt

Customize the prompt used for Gemini paper summarization. Reset to default available.

---

## 13. Keyboard Shortcuts Reference

### Global

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New file |
| `Cmd+O` | Open file |
| `Cmd+S` | Save |
| `Cmd+Shift+S` | Save As |
| `Cmd+W` | Close tab |
| `Cmd+,` | Settings |

### Canvas

| Shortcut | Action |
|----------|--------|
| `Tab` | Create node to the right |
| `Shift+Tab` | Create node below |
| `Ctrl/Cmd+Tab` | Create node to the left |
| `Ctrl/Cmd+Shift+Tab` | Create node above |
| `Delete` / `Backspace` | Delete selected node or edge |
| `Cmd+C` | Copy selected nodes |
| `Cmd+V` | Paste nodes |
| `Shift+Click` | Toggle multi-select |
| `Shift+Drag` | Selection box |
| `Double-click node` | Open in detached window |

### Tab-to-Create Popover

| Key | Action |
|-----|--------|
| `1` - `6` | Instant select node type |
| `Arrow keys` | Navigate options |
| `Enter` | Confirm selection |
| `Escape` | Cancel |

### Text Editing

| Shortcut | Action |
|----------|--------|
| `Space` (empty line) | Content Pull popover |
| `@` | @mention autocomplete |
| `Ctrl/Cmd+Enter` | Send message (Agent chat) |

---

## 14. Right-Click Context Menus

| Target | Options |
|--------|---------|
| Canvas | Add Edit Node, Import File, Add Agent Node, Add Export Node |
| Paper / Edit / Image / Agent / Export node | Delete Node |
| Deleted placeholder | Remove Completely |
| Junction | Dissolve Junction, Remove Junction |
| Paper Group | Expand Group, Collapse Group, Ungroup Papers |

---

## 15. Visual Reference

### Node Colors

| Node Type | Background | Border |
|-----------|-----------|--------|
| Core | `#1e3a5f` | `#1e40af` solid |
| Edit | `#fffbeb` | `#d97706` solid |
| Paper | `#f0fdf4` | `#059669` solid |
| Image | `#f0fdfa` | `#0891b2` solid |
| Agent | `rgba(67,56,202,0.08)` | `#4338ca` solid |
| Export | `rgba(225,29,72,0.08)` | `#e11d48` solid |
| Agent Proposal | `rgba(124,58,237,0.12)` | `#7c3aed` dashed |
| Deleted | `rgba(229,231,235,0.3)` | `#d1d5db` dashed |

### Edge Colors

| State | Color |
|-------|-------|
| Default | `#6b7280` (gray) |
| Selected | `#3b82f6` (blue) |
| Agent-created | `#7c3aed` (purple, dashed) |
| Deleted endpoint | `#9ca3af` (light gray) |

### Status Indicators

- **Processing**: Spinning amber SmartToy icon on nodes during AI work.
- **Comment badge**: Blue count badge on edges with comments.
- **Error**: Warning icon on Image nodes with broken file paths.

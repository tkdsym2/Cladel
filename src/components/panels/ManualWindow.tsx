import { useState } from "react";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";

// ─── Collapsible Section ───

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          width: "100%",
          padding: "8px 12px",
          background: open ? "#f0f4ff" : "#f9fafb",
          border: "none",
          borderBottom: "1px solid #e5e7eb",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          color: "#1e293b",
          textAlign: "left",
        }}
      >
        {open ? (
          <KeyboardArrowDownIcon sx={{ fontSize: 16, color: "#6b7280" }} />
        ) : (
          <KeyboardArrowRightIcon sx={{ fontSize: 16, color: "#6b7280" }} />
        )}
        {title}
      </button>
      {open && (
        <div style={{ padding: "10px 16px 14px", fontSize: 12.5, lineHeight: 1.7, color: "#374151" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Sub-heading ───

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontWeight: 600, fontSize: 12.5, color: "#1e40af", margin: "10px 0 4px" }}>
      {children}
    </div>
  );
}

// ─── Keyboard shortcut badge ───

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-block",
        padding: "1px 6px",
        fontSize: 11,
        fontFamily: "monospace",
        fontWeight: 600,
        lineHeight: "18px",
        color: "#374151",
        background: "#f3f4f6",
        border: "1px solid #d1d5db",
        borderRadius: 3,
        margin: "0 2px",
      }}
    >
      {children}
    </kbd>
  );
}

// ─── Table ───

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 12,
        marginTop: 6,
        marginBottom: 6,
      }}
    >
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={i}
              style={{
                textAlign: "left",
                padding: "5px 8px",
                borderBottom: "2px solid #d1d5db",
                color: "#374151",
                fontWeight: 600,
                fontSize: 11.5,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td
                key={ci}
                style={{
                  padding: "4px 8px",
                  borderBottom: "1px solid #e5e7eb",
                  verticalAlign: "top",
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Main Manual ───

export function ManualWindow() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#ffffff",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px 10px",
          borderBottom: "1px solid #e5e7eb",
          background: "#f8fafc",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>
          Cladel Manual
        </div>
        <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 2 }}>
          Research Thought-Mapping Application
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* ─── Getting Started ─── */}
        <Section title="Getting Started" defaultOpen={true}>
          <p>
            Cladel is a desktop application for researchers to organize thinking as a knowledge graph.
            It combines literature management (PDF import), personal thought mapping, and AI agents
            as collaborative research partners.
          </p>
          <p style={{ marginTop: 6 }}>
            Your work is saved in a single <b>.cld</b> file (SQLite-based). The app starts with an
            in-memory database; use <Kbd>Cmd+S</Kbd> to save to disk.
          </p>

          <Sub>Quick Start</Sub>
          <ol style={{ margin: "4px 0", paddingLeft: 20 }}>
            <li>Create or open a file from the Welcome dialog</li>
            <li>The canvas shows your <b>Core</b> node (one per layer, your main notes)</li>
            <li>Press <Kbd>Tab</Kbd> on a selected node to create a connected node</li>
            <li>Right-click the canvas to add nodes from the context menu</li>
            <li>Drag PDF or image files onto the canvas to import them</li>
          </ol>
        </Section>

        {/* ─── Node Types ─── */}
        <Section title="Node Types">
          <Sub>Core Node</Sub>
          <p>
            Deep blue node. One per layer. Contains your main research notes in Markdown.
            Auto-saves after 2 seconds. Cannot be deleted.
          </p>

          <Sub>Edit Node (user_doc)</Sub>
          <p>
            Amber/yellow node labeled "Edit". General-purpose Markdown note.
            Auto-saves after 800ms. Supports <b>Content Pull</b> (press Space on an empty line
            to pull content from connected nodes). Display ID is editable.
          </p>

          <Sub>Paper Node</Sub>
          <p>
            Light green node. Created via PDF import. Stores BibTeX metadata.
            Supports PDF viewing, paper summarization, and paper chat (powered by Gemini AI).
          </p>

          <Sub>Agent Node</Sub>
          <p>
            Indigo node with SmartToy icon. A per-node AI chat assistant.
            Uses BFS context from surrounding nodes. Creates/updates output Edit nodes
            with AI responses. Supports both Claude and Gemini as providers.
          </p>

          <Sub>Image Node</Sub>
          <p>
            Teal node. References an image file on disk (not embedded).
            Shows a thumbnail preview. Displays an error state if the file path is broken.
          </p>

          <Sub>Export Node</Sub>
          <p>
            Rose/pink node. Connects to Edit nodes (as sections) and optionally a Title node.
            Generates a PDF document with IEEE or APA citation styles. Configure formatting
            via the style config dialog.
          </p>

          <Sub>Compare Node</Sub>
          <p>
            Cyan node. Connect exactly 2 Edit nodes to see a word-level diff between them.
            Highlights added text in green and removed text in red.
          </p>

          <Sub>Title Node</Sub>
          <p>
            Stone/gray node. Used as a title page for PDF export.
            Stores title, subtitle, and authors with affiliations.
            Connect to an Export node to include as the first page.
          </p>


          <Sub>Paper Group</Sub>
          <p>
            Green composite node. Select 2+ Paper nodes and click "Group" to combine them.
            Collapsible via right-click menu. Useful for organizing related papers.
          </p>

          <Sub>Import Node</Sub>
          <p>
            Gray dashed temporary node. Created via Tab-to-Create or context menu.
            Click to open a file dialog; auto-detects PDF vs image and opens the
            appropriate import dialog.
          </p>

          <Sub>Junction</Sub>
          <p>
            Small dark gray circle. Acts as an edge branching point.
            Created via "Add Branch Point" on an edge. Right-click to dissolve.
          </p>

          <Sub>Deleted Node</Sub>
          <p>
            Gray dashed circle. When you delete a node, it becomes a soft-delete placeholder
            that preserves edge connections. Right-click and choose "Remove completely" to
            permanently delete.
          </p>
        </Section>

        {/* ─── Creating Nodes ─── */}
        <Section title="Creating Nodes">
          <Sub>Tab-to-Create</Sub>
          <p>
            The primary way to create connected nodes. With a node selected, press:
          </p>
          <Table
            headers={["Shortcut", "Direction"]}
            rows={[
              ["Tab", "Create to the right"],
              ["Shift + Tab", "Create below"],
              ["Cmd + Tab", "Create to the left"],
              ["Cmd + Shift + Tab", "Create above"],
            ]}
          />
          <p>
            A popover appears with 8 options (press the number key to instant-select):
          </p>
          <Table
            headers={["Key", "Node Type"]}
            rows={[
              ["1", "Edit"],
              ["2", "Paper"],
              ["3", "Image"],
              ["4", "Agent"],
              ["5", "Import File"],
              ["6", "Export"],
              ["7", "Compare"],
              ["8", "Title"],
            ]}
          />
          <p>
            Tab-to-Create also works during edge dragging (creates a node connected to the
            drag source) or with no selection (creates a standalone node at the cursor position).
          </p>

          <Sub>Right-Click Context Menu</Sub>
          <p>
            Right-click on the canvas to access:
          </p>
          <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
            <li><b>Add Edit Node</b> -- creates a new Edit node at the click position</li>
            <li><b>Import File</b> -- opens a file dialog to import PDF or image</li>
            <li><b>Add Agent Node</b> -- creates a new Agent node</li>
          </ul>

          <Sub>Drag and Drop</Sub>
          <p>
            Drag PDF or image files from your file system onto the canvas to import them directly.
          </p>
        </Section>

        {/* ─── Edges ─── */}
        <Section title="Edges (Connections)">
          <p>
            Nodes have handles on all 4 sides (left, right, top, bottom).
            Drag from a handle to another node to create an edge.
          </p>

          <Sub>Edge Actions</Sub>
          <p>Click on an edge to see the action popover:</p>
          <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
            <li><b>Edit Annotations</b> -- open the edge annotation modal with comment thread and weight slider</li>
            <li><b>Edge Properties</b> -- adjust edge weight (1-5, affects visual thickness)</li>
            <li><b>Add Branch Point</b> -- insert a junction node to split the edge</li>
          </ul>

          <Sub>Edge Comments</Sub>
          <p>
            Edges support comment threads. A badge on the edge shows the comment count.
            Comments support @Agent invocation and @Mention references.
          </p>
        </Section>

        {/* ─── Layers ─── */}
        <Section title="Layers">
          <p>
            Layers represent stages of thinking evolution. The left sidebar shows all layers
            (higher layers at top). Layer 1 is the default and cannot be deleted.
          </p>
          <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
            <li>Click a layer to switch to it</li>
            <li>Click <b>+</b> to create a new layer (inherits Core content from current layer)</li>
            <li>Optionally create a layer from a specific node (right-click node options)</li>
            <li>Each layer has its own independent set of nodes and edges</li>
          </ul>
        </Section>

        {/* ─── AI Features ─── */}
        <Section title="AI Features">
          <Sub>Global Agent (Research Assistant)</Sub>
          <p>
            The global agent panel (toggle via the sparkle button at bottom-left, or the sidebar).
            It analyzes your graph and provides suggestions for connections, ideas, and paper searches.
            Requires an Anthropic API key configured in Settings.
          </p>

          <Sub>Agent Node</Sub>
          <p>
            A per-node AI chat assistant. Send messages and the agent responds using context
            from surrounding nodes (via BFS traversal, up to 20 nodes). The agent creates
            output Edit nodes with its responses, positioned to the right.
          </p>

          <Sub>@Agent in Comments</Sub>
          <p>
            Include <b>@Agent</b> (case-insensitive) in any node or edge comment to invoke
            the AI. The agent reads the comment thread and surrounding context, then posts
            a reply as an agent comment.
          </p>

          <Sub>Paper Chat (Gemini)</Sub>
          <p>
            On Paper nodes, use "Summarize" to generate an AI summary (creates an output Edit node),
            or use the chat interface to ask questions about the paper. Powered by Gemini with
            full PDF context. Requires a Gemini API key.
          </p>


          <Sub>Autonomous Agent</Sub>
          <p>
            When enabled in Settings, the agent can automatically analyze your graph when
            you're idle (after 45s by default) or when structural changes are detected.
            Configure timing and capabilities in Settings.
          </p>
        </Section>

        {/* ─── Content Pull & Mentions ─── */}
        <Section title="Content Pull & @Mentions">
          <Sub>Content Pull</Sub>
          <p>
            In Edit or Core nodes, press <Kbd>Space</Kbd> on an empty line to open the
            Content Pull popover. Two-step process:
          </p>
          <ol style={{ margin: "4px 0", paddingLeft: 20 }}>
            <li>Select a connected node from the list</li>
            <li>Choose what to pull: content, abstract, or comments</li>
          </ol>
          <p>The selected content is inserted at the cursor position.</p>

          <Sub>@Mention References</Sub>
          <p>
            Type <b>@</b> in any text area to open the mention autocomplete popover.
            Search and select nodes by their display_id. Mentions are shown with
            color-coded type badges. Navigate with keyboard (arrow keys + Enter).
          </p>
        </Section>

        {/* ─── PDF Export ─── */}
        <Section title="PDF Export">
          <p>
            Create an <b>Export</b> node and connect Edit nodes to it as sections.
            Optionally connect a <b>Title</b> node for a title page with authors and affiliations.
          </p>

          <Sub>Citation Syntax</Sub>
          <Table
            headers={["Syntax", "Description"]}
            rows={[
              ["{@cite_key}", "Single citation (e.g., {@smith2024})"],
              ["{@A; @B; @C}", "Multi-citation"],
              ["{{image_id}}", "Inline image reference"],
            ]}
          />

          <Sub>Style Configuration</Sub>
          <p>
            Open the style config dialog from the Export node panel to customize:
            font presets (EN/JP), title/heading/body sizes, line spacing,
            margins, section numbering, title alignment, affiliation markers,
            and line numbers.
          </p>
        </Section>

        {/* ─── Keyboard Shortcuts ─── */}
        <Section title="Keyboard Shortcuts">
          <Sub>Canvas Mode</Sub>
          <Table
            headers={["Shortcut", "Action"]}
            rows={[
              ["V", "Switch to Move mode"],
              ["G", "Switch to Select mode"],
              ["C", "Toggle Color mode (Type / User)"],
            ]}
          />

          <Sub>Node Creation (Tab-to-Create)</Sub>
          <Table
            headers={["Shortcut", "Action"]}
            rows={[
              ["Tab", "Create connected node to the right"],
              ["Shift + Tab", "Create connected node below"],
              ["Cmd + Tab", "Create connected node to the left"],
              ["Cmd + Shift + Tab", "Create connected node above"],
            ]}
          />

          <Sub>File Operations</Sub>
          <Table
            headers={["Shortcut", "Action"]}
            rows={[
              ["Cmd + N", "New file / New tab"],
              ["Cmd + O", "Open file"],
              ["Cmd + S", "Save"],
              ["Cmd + Shift + S", "Save As"],
              ["Cmd + W", "Close tab"],
              ["Cmd + ,", "Open Settings"],
            ]}
          />

          <Sub>Selection</Sub>
          <Table
            headers={["Shortcut", "Action"]}
            rows={[
              ["Shift + Click", "Toggle node selection (multi-select)"],
              ["Shift + Drag", "Draw selection box"],
              ["Delete / Backspace", "Delete selected node(s)"],
            ]}
          />
        </Section>

        {/* ─── Color Mode ─── */}
        <Section title="Color Mode">
          <p>
            Toggle between two coloring schemes using <Kbd>C</Kbd> or the palette button
            in the upper-left indicator bar:
          </p>

          <Sub>Type Mode (Default)</Sub>
          <p>Nodes are colored by their type (blue for Core, green for Paper, amber for Edit, etc.).</p>

          <Sub>User Mode</Sub>
          <p>
            Paper, Edit, and Image nodes are colored by their creator (user identity).
            Uses a deterministic 8-color palette. Useful for collaborative projects to see
            who created what. Core, Agent, Export, Compare, and other functional nodes
            keep their type-based colors.
          </p>
        </Section>

        {/* ─── Multi-Window ─── */}
        <Section title="Multi-Window & Tabs">
          <Sub>File Tabs</Sub>
          <p>
            Browser-style multi-file tabs at the top. Each tab has its own database connection.
            Use <Kbd>Cmd+N</Kbd> to create new tabs and <Kbd>Cmd+W</Kbd> to close them.
          </p>

          <Sub>Detached Node Detail</Sub>
          <p>
            Double-click any node (except junction/deleted) to open its detail panel
            in a separate window. Changes sync back to the main window automatically.
          </p>

          <Sub>Agent Console</Sub>
          <p>
            Click the monitor icon in the top-right tab bar area to open the Agent Console
            in a separate window.
          </p>
        </Section>

        {/* ─── Cloud Sync ─── */}
        <Section title="Cloud Sync (Optional)">
          <p>
            Cladel supports optional cloud sync for .cld files via Supabase storage.
            Configure your Supabase URL and anonymous key in Settings.
          </p>
          <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
            <li>Upload your .cld file to the cloud</li>
            <li>Download .cld files from cloud storage</li>
            <li>Status bar shows sync state (in sync / not uploaded / out of sync)</li>
          </ul>
        </Section>

        {/* ─── Settings ─── */}
        <Section title="Settings">
          <p>
            Open Settings with <Kbd>Cmd+,</Kbd> or the gear icon in the top-right.
          </p>
          <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
            <li><b>API Keys</b> -- Anthropic (Claude) and Google (Gemini) API keys</li>
            <li><b>Agent Capabilities</b> -- enable/disable agent, autonomous mode, paper search, suggestions</li>
            <li><b>Agent Timing</b> -- idle seconds (default 45), cooldown seconds (default 120)</li>
            <li><b>UI Preferences</b> -- default node sizes, sidebar width, canvas background, grid, font size</li>
            <li><b>Paper Summary Prompt</b> -- customize the template used for paper summarization</li>
            <li><b>User Identity</b> -- register your name (shown on nodes and comments)</li>
            <li><b>API Usage</b> -- view token usage and estimated costs</li>
            <li><b>Cloud Sync</b> -- Supabase configuration</li>
          </ul>
        </Section>

        {/* ─── Tips ─── */}
        <Section title="Tips & Tricks">
          <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
            <li>Use layers to track thinking evolution: start broad in Layer 1, refine in Layer 2, etc.</li>
            <li>Connect related papers and notes with edges; weighted edges (1-5) show importance</li>
            <li>Use the Agent node for focused AI conversations about specific topics</li>
            <li>Use Paper Chat (Gemini) to ask questions about specific PDFs</li>
            <li>The Export node collects connected Edit nodes as sections for PDF generation</li>
            <li>Group related papers with Paper Group for a cleaner canvas</li>
            <li>Use @Mentions in notes to create references between nodes</li>
            <li>Double-click a node to open it in a separate window for side-by-side editing</li>
            <li>The Compare node is great for reviewing differences between two drafts</li>
          </ul>
        </Section>

        {/* Footer */}
        <div
          style={{
            padding: "12px 16px",
            textAlign: "center",
            fontSize: 11,
            color: "#9ca3af",
            borderTop: "1px solid #e5e7eb",
          }}
        >
          Cladel -- Research Thought-Mapping Application
        </div>
      </div>
    </div>
  );
}

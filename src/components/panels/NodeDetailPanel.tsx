import { useState, useEffect, useRef, useCallback } from "react";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import EditIcon from "@mui/icons-material/Edit";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import BrokenImageIcon from "@mui/icons-material/BrokenImage";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import LinkIcon from "@mui/icons-material/Link";
import LayersIcon from "@mui/icons-material/Layers";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import SendIcon from "@mui/icons-material/Send";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useGraphStore } from "../../store/graphStore";
import { useAgentNodeStore } from "../../store/agentNodeStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUserStore } from "../../store/userStore";
import * as cmd from "../../lib/tauri-commands";
import { emitCommentsChanged, onCommentsChanged, onGraphChanged } from "../../lib/sync-events";
import { NoteEditorWithPull } from "./NoteEditorWithPull";
import { MentionPopover, type MentionItem } from "./MentionPopover";
import { AgentNodeViewer } from "./AgentNodeViewer";
import { ExportNodeViewer } from "./ExportNodeViewer";
import { CompareNodeViewer } from "./CompareNodeViewer";
import { TitleNodeViewer } from "./TitleNodeViewer";
import { TableNodeViewer } from "./TableNodeViewer";
import { AccordionSection } from "../graph/NodeAccordionSection";
import type { NodeData, EdgeData, NodeComment, AgentNodeMessage, PaperGroupMetadata } from "../../types";

interface NodeDetailPanelProps {
  onDeleteNode?: (nodeId: string) => void;
  /** Callback to create a new layer from the given node's content */
  onCreateLayerFromNode?: (nodeId: string) => void;
  /** When provided, renders this node directly instead of reading from graphStore selection */
  nodeOverride?: NodeData;
  /** When true, hides close/delete/detach buttons (used in detached windows) */
  detached?: boolean;
}

export function NodeDetailPanel({
  onDeleteNode,
  onCreateLayerFromNode,
  nodeOverride,
  detached,
}: NodeDetailPanelProps) {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const dbNodes = useGraphStore((s) => s.dbNodes);
  const updateNodeContent = useGraphStore((s) => s.updateNodeContent);
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);

  const node = nodeOverride
    ?? (selectedNodeId ? dbNodes.find((n) => n.id === selectedNodeId) : undefined);

  if (!node || node.node_type === "deleted" || node.node_type === "junction") return null;

  const isDeletable = node.node_type === "paper" || node.node_type === "user_doc" || node.node_type === "image" || node.node_type === "agent" || node.node_type === "export" || node.node_type === "compare" || node.node_type === "title" || node.node_type === "table";

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={typeBadgeStyle(node.node_type)}>{typeLabel(node.node_type)}</span>
        {!detached && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {isDeletable && onDeleteNode && (
              <button
                onClick={() => onDeleteNode(node.id)}
                style={deleteNodeBtnStyle}
                title="Delete node"
              >
                <DeleteIcon sx={{ fontSize: 16 }} />
              </button>
            )}
            <DetachButton node={node} />
            <button onClick={() => setSelectedNodeId(null)} style={closeBtnStyle}>
              <CloseIcon sx={{ fontSize: 20 }} />
            </button>
          </div>
        )}
      </div>
      {node.node_type === "core" && (
        <CoreEditor node={node} onUpdate={updateNodeContent} detached={detached} />
      )}
      {node.node_type === "paper" && <PaperViewer node={node} detached={detached} />}
      {node.node_type === "user_doc" && (
        <UserDocEditor node={node} onUpdate={updateNodeContent} onCreateLayerFromNode={detached ? undefined : onCreateLayerFromNode} detached={detached} />
      )}
      {node.node_type === "agent_proposal" && <GhostViewer node={node} onCreateLayerFromNode={detached ? undefined : onCreateLayerFromNode} detached={detached} />}
      {node.node_type === "image" && (
        <>
          <ImageViewer node={node} onCreateLayerFromNode={detached ? undefined : onCreateLayerFromNode} detached={detached} />
          <CommentSection nodeId={node.id} layerId={node.layer_id} />
        </>
      )}
      {node.node_type === "agent" && (
        <AgentNodeViewer nodeId={node.id} layerId={node.layer_id} />
      )}
      {node.node_type === "paper_group" && (
        <PaperGroupViewer node={node} />
      )}
      {node.node_type === "export" && (
        <ExportNodeViewer node={node} />
      )}
      {node.node_type === "compare" && (
        <CompareNodeViewer node={node} />
      )}
      {node.node_type === "title" && (
        <TitleNodeViewer node={node} />
      )}
      {node.node_type === "table" && (
        <TableNodeViewer node={node} />
      )}
    </div>
  );
}

// ─── Detach Button ───

function DetachButton({ node }: { node: NodeData }) {
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);

  const handleDetach = async () => {
    const { openNodeDetailWindow } = await import("../../lib/detached-window");
    await openNodeDetailWindow(node.id, node.layer_id, node.title);
    setSelectedNodeId(null);
  };

  return (
    <button
      onClick={handleDetach}
      style={detachBtnStyle}
      title="Open in new window"
    >
      <OpenInNewIcon sx={{ fontSize: 15 }} />
    </button>
  );
}

// ─── Core Editor with auto-save, flush-on-unmount, and explicit Save button ───

function CoreEditor({
  node,
  onUpdate,
  detached,
}: {
  node: NodeData;
  onUpdate: (id: string, fields: { title?: string; content?: string }) => Promise<void>;
  detached?: boolean;
}) {
  const editorFontSize = useSettingsStore((s) => s.uiPreferences.editor_font_size) || 13;
  const editorStyle: React.CSSProperties = { ...baseEditorStyle, fontSize: editorFontSize };
  const [title, setTitle] = useState(node.title);
  const [content, setContent] = useState(node.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContent = useRef<string | null>(null);
  const nodeIdRef = useRef(node.id);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => setOpenSections((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Only reset local state when switching to a different node
  useEffect(() => {
    nodeIdRef.current = node.id;
    setTitle(node.title);
    setContent(node.content ?? "");
    pendingContent.current = null;
    setDirty(false);
    setSaveError(null);
    setOpenSections(new Set());
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSave = useCallback(
    async (nodeId: string, newContent: string) => {
      try {
        setSaving(true);
        setSaveError(null);
        await onUpdate(nodeId, { content: newContent });
        pendingContent.current = null;
        setDirty(false);
      } catch (err) {
        console.error("Core save failed:", err);
        setSaveError(String(err));
      } finally {
        setSaving(false);
      }
    },
    [onUpdate],
  );

  const debouncedSave = useCallback(
    (newContent: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      pendingContent.current = newContent;
      saveTimer.current = setTimeout(() => {
        doSave(nodeIdRef.current, newContent);
      }, 2000);
    },
    [doSave],
  );

  // Flush pending save on unmount or when doSave changes (node switch)
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const pending = pendingContent.current;
      const nid = nodeIdRef.current;
      if (pending !== null) {
        // Fire-and-forget: persist before component is destroyed
        onUpdate(nid, { content: pending }).catch((err) =>
          console.error("Core flush-on-unmount failed:", err),
        );
        pendingContent.current = null;
      }
    };
  }, [doSave, onUpdate]);

  const handleContentChange = (val: string) => {
    setContent(val);
    setDirty(true);
    debouncedSave(val);
  };

  const handleTitleBlur = async () => {
    if (title !== node.title) {
      try {
        await onUpdate(node.id, { title });
      } catch (err) {
        console.error("Title save failed:", err);
        setSaveError(String(err));
      }
    }
  };

  const handleSaveClick = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingContent.current = null;
    await doSave(node.id, content);
  };

  return (
    <div style={detached
      ? { display: "flex", flexDirection: "column" as const, gap: 4 }
      : { display: "flex", flexDirection: "column" as const, gap: 4, flex: 1, minHeight: 0, overflow: "hidden" }
    }>
      <AccordionSection label="Title" expanded={openSections.has("title")} onToggle={() => toggleSection("title")} detached={detached}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          style={titleInputStyle}
        />
      </AccordionSection>
      <AccordionSection label="Content" expanded={openSections.has("content")} onToggle={() => toggleSection("content")} detached={detached}>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
          Auto-saves 2s after typing.
        </div>
        <div>
          <NoteEditorWithPull
            nodeId={node.id}
            layerId={node.layer_id}
            value={content}
            onChange={handleContentChange}
            placeholder="Write your core research question in Markdown..."
            style={editorStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <button
            onClick={handleSaveClick}
            disabled={saving || !dirty}
            style={{
              ...saveBtnStyle,
              opacity: saving || !dirty ? 0.5 : 1,
              cursor: saving || !dirty ? "default" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {dirty && !saving && (
            <span style={{ fontSize: 11, color: "#d97706" }}>Unsaved changes</span>
          )}
          {saveError && (
            <span style={{ fontSize: 11, color: "#dc2626" }}>Error: {saveError}</span>
          )}
        </div>
      </AccordionSection>
    </div>
  );
}

// ─── Paper Viewer (read-only BibTeX fields) ───

function PaperViewer({ node, detached }: { node: NodeData; detached?: boolean }) {
  const refreshNode = useGraphStore((s) => s.refreshNode);

  let meta: Record<string, unknown> = {};
  if (node.metadata) {
    try {
      meta = JSON.parse(node.metadata);
    } catch {
      /* ignore */
    }
  }

  const authors = (meta.authors as string[]) ?? [];
  const year = (meta.year as string) ?? null;
  const journal = (meta.journal as string) ?? null;

  const [authorsExpanded, setAuthorsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingBibtex, setEditingBibtex] = useState(false);
  const [editBibtexValue, setEditBibtexValue] = useState("");
  const [bibtexSaving, setBibtexSaving] = useState(false);
  const [bibtexError, setBibtexError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => setOpenSections((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Reset collapse state when switching nodes
  useEffect(() => {
    setAuthorsExpanded(false);
    setCopied(false);
    setEditingBibtex(false);
    setBibtexError(null);
    setOpenSections(new Set());
  }, [node.id]);

  const handleCopyBibtex = useCallback(async () => {
    if (!node.bibtex) return;
    try {
      await navigator.clipboard.writeText(node.bibtex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API may fail in some contexts */
    }
  }, [node.bibtex]);

  const handleStartEditBibtex = useCallback(() => {
    setEditBibtexValue(node.bibtex ?? "");
    setBibtexError(null);
    setEditingBibtex(true);
  }, [node.bibtex]);

  const handleSaveBibtex = useCallback(async () => {
    const trimmed = editBibtexValue.trim();
    if (!trimmed) {
      setBibtexError("BibTeX cannot be empty");
      return;
    }
    setBibtexSaving(true);
    setBibtexError(null);
    try {
      await cmd.updatePaperBibtex(node.id, trimmed);
      await refreshNode(node.id);
      setEditingBibtex(false);
    } catch (e) {
      setBibtexError(String(e));
    } finally {
      setBibtexSaving(false);
    }
  }, [node.id, editBibtexValue, refreshNode]);

  const handleCancelEditBibtex = useCallback(() => {
    setEditingBibtex(false);
    setBibtexError(null);
  }, []);

  // Format authors line
  const MAX_AUTHORS = 3;
  const hasMany = authors.length > MAX_AUTHORS;
  const displayAuthors = authorsExpanded
    ? authors.join(", ")
    : hasMany
      ? authors.slice(0, MAX_AUTHORS).join(", ") + " et al."
      : authors.join(", ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minHeight: 0, overflowY: "auto" }}>
      {/* Title — always visible */}
      <div style={{ fontSize: 17, fontWeight: 600, color: "#111827", lineHeight: 1.35, marginBottom: 4 }}>
        {node.title}
      </div>

      {/* Authors + Year */}
      {(authors.length > 0 || year) && (
        <AccordionSection label="Authors" expanded={openSections.has("authors")} onToggle={() => toggleSection("authors")} detached={detached}>
          <div style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.5 }}>
            {authors.length > 0 && (
              <span
                onClick={hasMany ? () => setAuthorsExpanded(!authorsExpanded) : undefined}
                style={hasMany ? { cursor: "pointer" } : undefined}
                title={hasMany && !authorsExpanded ? authors.join(", ") : undefined}
              >
                {displayAuthors}
              </span>
            )}
            {year && (
              <span style={{ color: "#9ca3af" }}>
                {authors.length > 0 ? ` (${year})` : year}
              </span>
            )}
          </div>
        </AccordionSection>
      )}

      {/* Abstract */}
      <AccordionSection label="Abstract" expanded={openSections.has("abstract")} onToggle={() => toggleSection("abstract")} detached={detached}>
        {node.content ? (
          <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
            {node.content}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>
            No abstract available
          </div>
        )}
      </AccordionSection>

      {/* PDF */}
      <AccordionSection label="PDF" expanded={openSections.has("pdf")} onToggle={() => toggleSection("pdf")} detached={detached}>
        <PaperPdfSection nodeId={node.id} pdfPath={node.pdf_path} />
        {node.pdf_path && (
          <PaperSummarizeButton nodeId={node.id} layerId={node.layer_id} />
        )}
        {node.pdf_path && (
          <PaperChatSection nodeId={node.id} />
        )}
      </AccordionSection>

      {/* Comments */}
      <AccordionSection label="Comments" expanded={openSections.has("comments")} onToggle={() => toggleSection("comments")} detached={detached}>
        <CommentSection nodeId={node.id} layerId={node.layer_id} />
      </AccordionSection>

      {/* Venue */}
      {journal && (
        <AccordionSection label="Venue" expanded={openSections.has("venue")} onToggle={() => toggleSection("venue")} detached={detached}>
          <div style={fieldValueStyle}>{journal}</div>
        </AccordionSection>
      )}

      {/* Raw BibTeX */}
      <AccordionSection label="BibTeX" expanded={openSections.has("bibtex")} onToggle={() => toggleSection("bibtex")} detached={detached}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            {!editingBibtex && (
              <button
                onClick={handleStartEditBibtex}
                style={bibtexEditBtnStyle}
                title="Edit BibTeX"
              >
                <EditIcon sx={{ fontSize: 12 }} /> Edit
              </button>
            )}
          </div>
          {editingBibtex ? (
            <div>
              <textarea
                value={editBibtexValue}
                onChange={(e) => setEditBibtexValue(e.target.value)}
                style={bibtexEditTextareaStyle}
              />
              {bibtexError && (
                <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{bibtexError}</div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  onClick={handleSaveBibtex}
                  disabled={bibtexSaving}
                  style={{
                    ...bibtexSaveBtnStyle,
                    opacity: bibtexSaving ? 0.5 : 1,
                  }}
                >
                  {bibtexSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={handleCancelEditBibtex}
                  disabled={bibtexSaving}
                  style={bibtexCancelBtnStyle}
                >
                  Cancel
                </button>
              </div>
              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
                Saving will update title, authors, year, and display ID from the BibTeX entry.
              </div>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              {node.bibtex ? (
                <>
                  <pre style={bibtexPreStyle}>{node.bibtex}</pre>
                  <button
                    onClick={handleCopyBibtex}
                    style={bibtexCopyBtnStyle}
                    title="Copy to clipboard"
                  >
                    {copied ? "Copied!" : <ContentCopyIcon sx={{ fontSize: 12 }} />}
                  </button>
                </>
              ) : (
                <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>
                  No BibTeX available.{" "}
                  <button
                    onClick={handleStartEditBibtex}
                    style={{ fontSize: 12, color: "#1e40af", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                  >
                    Add BibTeX
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </AccordionSection>
    </div>
  );
}

// ─── Paper Summarize Button ───

function PaperSummarizeButton({ nodeId, layerId }: { nodeId: string; layerId: string }) {
  const geminiKeyStatus = useSettingsStore((s) => s.geminiApiKeyStatus);
  const { setProcessing, isProcessing } = useAgentNodeStore();
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const [error, setError] = useState<string | null>(null);

  const processing = isProcessing(nodeId);
  const hasGeminiKey = !!geminiKeyStatus;

  const handleSummarize = useCallback(async () => {
    if (processing || !hasGeminiKey) return;
    setError(null);
    setProcessing(nodeId, true);
    try {
      await cmd.invokePaperSummarize(nodeId, layerId);
      await loadGraph(layerId);
    } catch (err: unknown) {
      let msg = "Summarization failed";
      if (typeof err === "string") {
        try {
          const parsed = JSON.parse(err);
          msg = parsed.message || msg;
        } catch {
          msg = err;
        }
      }
      setError(msg);
    } finally {
      setProcessing(nodeId, false);
    }
  }, [nodeId, layerId, processing, hasGeminiKey, setProcessing, loadGraph]);

  return (
    <div>
      <button
        onClick={handleSummarize}
        disabled={processing || !hasGeminiKey}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 16px",
          fontSize: 13,
          fontWeight: 500,
          color: processing ? "#9ca3af" : !hasGeminiKey ? "#9ca3af" : "#fff",
          background: processing ? "#e5e7eb" : !hasGeminiKey ? "#e5e7eb" : "#1a73e8",
          border: "none",
          borderRadius: 6,
          cursor: processing || !hasGeminiKey ? "not-allowed" : "pointer",
          transition: "background 0.15s",
        }}
        title={!hasGeminiKey ? "Configure Gemini API key in Settings first" : "Summarize this paper using Gemini"}
      >
        <AutoAwesomeIcon sx={{ fontSize: 16 }} />
        {processing ? "Summarizing..." : "Summarize"}
      </button>
      {!hasGeminiKey && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
          Gemini API key required. Configure in Settings.
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: "#dc2626", marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}

// ─── Paper Chat Section ───

function PaperChatSection({ nodeId }: { nodeId: string }) {
  const geminiKeyStatus = useSettingsStore((s) => s.geminiApiKeyStatus);
  const { setProcessing, isProcessing } = useAgentNodeStore();
  const [messages, setMessages] = useState<AgentNodeMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const processing = isProcessing(nodeId);
  const hasGeminiKey = !!geminiKeyStatus;

  // Load messages on mount and when nodeId changes
  useEffect(() => {
    cmd.getAgentNodeMessages(nodeId).then(setMessages).catch(console.error);
  }, [nodeId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || processing || loading || !hasGeminiKey) return;
    const userMsg = input.trim();
    setInput("");
    setLoading(true);
    setProcessing(nodeId, true);

    // Optimistically add user message
    const optimisticUser: AgentNodeMessage = {
      id: `temp-${Date.now()}`,
      node_id: nodeId,
      role: "user",
      content: userMsg,
      output_node_id: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      await cmd.invokePaperChat(nodeId, userMsg);
      // Reload messages from DB to get actual IDs
      const fresh = await cmd.getAgentNodeMessages(nodeId);
      setMessages(fresh);
    } catch (err: unknown) {
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      let msg = "Chat failed";
      if (typeof err === "string") {
        try {
          const parsed = JSON.parse(err);
          msg = parsed.message || msg;
        } catch {
          msg = err;
        }
      }
      console.error("[PaperChat] Error:", msg);
    } finally {
      setLoading(false);
      setProcessing(nodeId, false);
    }
  }, [input, nodeId, processing, loading, hasGeminiKey, setProcessing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  if (!hasGeminiKey) return null;

  return (
    <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <SmartToyIcon sx={{ fontSize: 16, color: "#1a73e8" }} />
        Chat with PDF
      </div>

      {/* Messages */}
      {messages.length > 0 && (
        <div style={{
          maxHeight: 300,
          overflowY: "auto",
          marginBottom: 8,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                fontSize: 12.5,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                ...(msg.role === "user"
                  ? { background: "#eff6ff", color: "#1e40af", alignSelf: "flex-end", maxWidth: "85%", borderBottomRightRadius: 2 }
                  : { background: "#f3f4f6", color: "#374151", alignSelf: "flex-start", maxWidth: "85%", borderBottomLeftRadius: 2 }),
              }}
            >
              {msg.content}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this paper... (Ctrl+Enter to send)"
          rows={2}
          style={{
            flex: 1,
            padding: "8px 10px",
            fontSize: 12.5,
            border: "1px solid #d1d5db",
            borderRadius: 6,
            resize: "vertical",
            outline: "none",
            fontFamily: "inherit",
            minHeight: 36,
          }}
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          style={{
            padding: "7px 10px",
            background: !input.trim() || loading ? "#e5e7eb" : "#1a73e8",
            color: !input.trim() || loading ? "#9ca3af" : "#fff",
            border: "none",
            borderRadius: 6,
            cursor: !input.trim() || loading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
          }}
          title="Send (Ctrl+Enter)"
        >
          <SendIcon sx={{ fontSize: 16 }} />
        </button>
      </div>
    </div>
  );
}

// ─── Paper PDF Section ───

function PaperPdfSection({ nodeId, pdfPath: initialPdfPath }: { nodeId: string; pdfPath: string | null }) {
  const [pdfPath, setPdfPath] = useState<string | null>(initialPdfPath);
  const [pdfFileExists, setPdfFileExists] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(true);

  useEffect(() => {
    setPdfPath(initialPdfPath);
    if (!initialPdfPath) {
      setPdfFileExists(false);
      setPdfLoading(false);
      return;
    }
    let cancelled = false;
    setPdfLoading(true);
    cmd.checkFileExists(initialPdfPath).then((exists) => {
      if (!cancelled) {
        setPdfFileExists(exists);
        setPdfLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setPdfFileExists(false);
        setPdfLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [nodeId, initialPdfPath]);

  const handleOpenPdf = async () => {
    if (pdfPath) {
      try {
        await cmd.openFileExternal(pdfPath);
      } catch (err) {
        console.error("Failed to open PDF:", err);
      }
    }
  };

  const handleBrowsePdf = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "Select PDF file",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        await cmd.setPaperPdfPath(nodeId, selected);
        setPdfPath(selected);
        setPdfFileExists(true);
      }
    } catch (err) {
      console.error("Failed to link PDF:", err);
    }
  };

  if (pdfLoading) return null;

  // State A: pdf_path exists and file is accessible
  if (pdfPath && pdfFileExists) {
    return (
      <div style={pdfSectionStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PictureAsPdfIcon sx={{ fontSize: 18, color: "#dc2626" }} />
          <button onClick={handleOpenPdf} style={pdfViewBtnStyle}>
            View PDF
          </button>
          <button onClick={handleBrowsePdf} style={pdfChangeLinkStyle}>
            Change
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, wordBreak: "break-all" }}>
          {pdfPath.length > 60 ? "..." + pdfPath.slice(-57) : pdfPath}
        </div>
      </div>
    );
  }

  // State B: pdf_path exists but file NOT found
  if (pdfPath && !pdfFileExists) {
    return (
      <div style={{ ...pdfSectionStyle, background: "#fffbeb", border: "1px solid #fbbf24", borderRadius: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <WarningAmberIcon sx={{ fontSize: 16, color: "#d97706" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#92400e" }}>PDF not found</span>
        </div>
        <div style={{ fontSize: 11, color: "#92400e", fontFamily: "monospace", wordBreak: "break-all", marginBottom: 6 }}>
          {pdfPath}
        </div>
        <button onClick={handleBrowsePdf} style={pdfRelinkBtnStyle}>
          Re-link PDF
        </button>
      </div>
    );
  }

  // State C: no pdf_path
  return (
    <div style={pdfSectionStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <LinkIcon sx={{ fontSize: 16, color: "#9ca3af" }} />
        <button onClick={handleBrowsePdf} style={pdfLinkBtnStyle}>
          Link PDF
        </button>
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
        Associate a PDF file with this paper
      </div>
    </div>
  );
}

const pdfSectionStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "#f9fafb",
  borderRadius: 6,
  border: "1px solid #e5e7eb",
};

const pdfViewBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  background: "#dc2626",
  color: "#ffffff",
  border: "none",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const pdfChangeLinkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#6b7280",
  fontSize: 11,
  cursor: "pointer",
  textDecoration: "underline",
  padding: 0,
};

const pdfRelinkBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  background: "#d97706",
  color: "#ffffff",
  border: "none",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const pdfLinkBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  background: "#e5e7eb",
  color: "#374151",
  border: "none",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
};

// ─── Comment Section ───

type AgentCommentStatus = "posting" | "waiting" | "receiving" | "error" | null;

function CommentSection({ nodeId, layerId }: { nodeId: string; layerId: string }) {
  const [comments, setComments] = useState<NodeComment[]>([]);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentCommentStatus>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const updateCommentCount = useGraphStore((s) => s.updateCommentCount);
  const setProcessing = useAgentNodeStore((s) => s.setProcessing);
  const agentStatusScrollRef = useRef<HTMLDivElement>(null);

  // @ Mention state for comment textarea
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionPos, setMentionPos] = useState({ x: 0, y: 0 });
  const [mentionFilter, setMentionFilter] = useState("");
  const mentionStartRef = useRef<number>(-1);
  const storeDbNodes = useGraphStore((s) => s.dbNodes);
  const storeDbEdges = useGraphStore((s) => s.dbEdges);

  // Fallback fetch for detached windows where graphStore is empty
  const [fallbackNodes, setFallbackNodes] = useState<NodeData[]>([]);
  const [fallbackEdges, setFallbackEdges] = useState<EdgeData[]>([]);

  const fetchFallbackGraph = useCallback(() => {
    Promise.all([
      cmd.getNodesByLayer(layerId),
      cmd.getEdgesByLayer(layerId),
    ]).then(([nodes, edges]) => {
      setFallbackNodes(nodes);
      setFallbackEdges(edges);
    }).catch(() => {});
  }, [layerId]);

  useEffect(() => {
    if (storeDbNodes.length > 0) return;
    fetchFallbackGraph();
  }, [layerId, storeDbNodes.length, fetchFallbackGraph]);

  useEffect(() => {
    if (storeDbNodes.length > 0) return;
    const unlisten = onGraphChanged(() => { fetchFallbackGraph(); });
    return () => { unlisten.then((fn) => fn()); };
  }, [storeDbNodes.length, fetchFallbackGraph]);

  const dbNodes = storeDbNodes.length > 0 ? storeDbNodes : fallbackNodes;
  const dbEdges = storeDbEdges.length > 0 ? storeDbEdges : fallbackEdges;

  const getCommentMentionItems = useCallback((): MentionItem[] => {
    const connectedIds = new Set<string>();
    for (const e of dbEdges) {
      if (e.source_node_id === nodeId) connectedIds.add(e.target_node_id);
      if (e.target_node_id === nodeId) connectedIds.add(e.source_node_id);
    }
    const items: MentionItem[] = [];
    const seenDisplayIds = new Set<string>();
    const allowedTypes = new Set(["paper", "image"]);
    for (const n of dbNodes) {
      if (!connectedIds.has(n.id) || !n.display_id) continue;
      if (!allowedTypes.has(n.node_type)) continue;
      if (!seenDisplayIds.has(n.display_id)) {
        seenDisplayIds.add(n.display_id);
        items.push({ display_id: n.display_id, node_type: n.node_type, title: n.title });
      }
      if (n.node_type === "paper_group" && n.metadata) {
        try {
          const meta = JSON.parse(n.metadata) as PaperGroupMetadata;
          const groupName = meta.group_name || n.title;
          for (const memberId of meta.member_node_ids) {
            const m = dbNodes.find((nd) => nd.id === memberId);
            if (m?.display_id && m.node_type === "paper" && !seenDisplayIds.has(m.display_id)) {
              seenDisplayIds.add(m.display_id);
              items.push({ display_id: m.display_id, node_type: m.node_type, title: m.title, group_name: groupName });
            }
          }
        } catch { /* ignore */ }
      }
    }
    items.sort((a, b) => a.display_id.localeCompare(b.display_id));
    return items;
  }, [nodeId, dbNodes, dbEdges]);

  const calcCommentMentionPos = useCallback((textarea: HTMLTextAreaElement, cursorPos: number) => {
    const rect = textarea.getBoundingClientRect();
    const textBefore = textarea.value.substring(0, cursorPos);
    const lineNumber = textBefore.split("\n").length;
    const lineHeight = 19.2; // fontSize 12 * lineHeight 1.6
    const cursorY = rect.top + Math.min(lineNumber * lineHeight, rect.height - 16);
    return { x: rect.left + 16, y: cursorY };
  }, []);

  const handleCommentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setNewContent(newValue);
    const cursorPos = e.target.selectionStart;
    if (mentionOpen) {
      const atPos = mentionStartRef.current;
      if (atPos >= 0 && cursorPos > atPos) {
        const filterText = newValue.substring(atPos + 1, cursorPos);
        if (/[\s\n]/.test(filterText) || cursorPos <= atPos) {
          setMentionOpen(false);
          mentionStartRef.current = -1;
        } else {
          setMentionFilter(filterText);
        }
      } else {
        setMentionOpen(false);
        mentionStartRef.current = -1;
      }
      return;
    }
    if (cursorPos > 0 && newValue[cursorPos - 1] === "@") {
      if (cursorPos === 1 || !/[a-zA-Z0-9_]/.test(newValue[cursorPos - 2])) {
        const items = getCommentMentionItems();
        if (items.length > 0) {
          mentionStartRef.current = cursorPos - 1;
          setMentionFilter("");
          setMentionPos(calcCommentMentionPos(e.target, cursorPos));
          setMentionOpen(true);
        }
      }
    }
  }, [mentionOpen, getCommentMentionItems, calcCommentMentionPos]);

  const handleCommentMentionSelect = useCallback((displayId: string, _nodeType: string) => {
    setMentionOpen(false);
    const textarea = commentTextareaRef.current;
    if (!textarea) return;
    const atPos = mentionStartRef.current;
    if (atPos < 0) return;
    const cursorPos = textarea.selectionStart;
    const before = newContent.substring(0, atPos);
    const after = newContent.substring(cursorPos);
    const updated = before + "@" + displayId + " " + after;
    const newCursorPos = atPos + 1 + displayId.length + 1;
    mentionStartRef.current = -1;
    setNewContent(updated);
    requestAnimationFrame(() => {
      textarea.selectionStart = newCursorPos;
      textarea.selectionEnd = newCursorPos;
      textarea.focus();
    });
  }, [newContent]);

  const handleCommentMentionClose = useCallback(() => {
    setMentionOpen(false);
    mentionStartRef.current = -1;
    requestAnimationFrame(() => { commentTextareaRef.current?.focus(); });
  }, []);

  const loadComments = useCallback(async () => {
    try {
      const result = await cmd.getNodeComments(nodeId);
      setComments(result);
    } catch (err) {
      console.error("Failed to load comments:", err);
    }
  }, [nodeId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Listen for cross-window comment changes
  useEffect(() => {
    const unlisten = onCommentsChanged((changedNodeId) => {
      if (changedNodeId === nodeId) loadComments();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [nodeId, loadComments]);

  // Scroll to agent status indicator when it appears
  useEffect(() => {
    if (agentStatus) {
      agentStatusScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [agentStatus]);

  const handleAdd = async () => {
    const text = newContent.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const u = useUserStore.getState();
      const comment = await cmd.addNodeComment(nodeId, text, "user", u.userId, u.userName);
      setComments((c) => [...c, comment]);
      setNewContent("");
      updateCommentCount(nodeId, 1);
      emitCommentsChanged(nodeId);

      // Check for @Agent mention
      if (/@Agent\b/i.test(text)) {
        const stripped = text.replace(/@Agent\b/gi, "").trim();
        if (stripped) {
          setProcessing(nodeId, true);
          setAgentError(null);
          setAgentStatus("posting");
          try {
            // Transition to "waiting" shortly after posting
            const waitTimer = setTimeout(() => setAgentStatus("waiting"), 400);
            const agentReply = await cmd.invokeAgentComment(nodeId, layerId, stripped);
            clearTimeout(waitTimer);

            // Show "receiving" phase briefly before displaying the comment
            setAgentStatus("receiving");
            // Small delay so user can see the "receiving" state
            await new Promise((r) => setTimeout(r, 500));

            const agentComment = await cmd.addNodeComment(nodeId, agentReply, "agent");
            setComments((c) => [...c, agentComment]);
            updateCommentCount(nodeId, 1);
            emitCommentsChanged(nodeId);
            setAgentStatus(null);
          } catch (err) {
            console.error("Agent comment failed:", err);
            const errMsg = typeof err === "string" ? err : (err instanceof Error ? err.message : "Unknown error");
            // Try to parse agent error JSON
            let displayMsg = errMsg;
            try {
              const parsed = JSON.parse(errMsg);
              if (parsed.message) displayMsg = parsed.message;
            } catch { /* use raw message */ }
            setAgentError(displayMsg);
            setAgentStatus("error");
            // Auto-clear error after 6 seconds
            setTimeout(() => {
              setAgentStatus((s) => (s === "error" ? null : s));
              setAgentError(null);
            }, 6000);
          } finally {
            setProcessing(nodeId, false);
          }
        }
      }
    } catch (err) {
      console.error("Failed to add comment:", err);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await cmd.deleteNodeComment(commentId);
      setComments((c) => c.filter((x) => x.id !== commentId));
      updateCommentCount(nodeId, -1);
      emitCommentsChanged(nodeId);
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  };

  const handleEditStart = (comment: NodeComment) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
  };

  const handleEditSave = async () => {
    if (!editingId || !editContent.trim()) return;
    try {
      const updated = await cmd.updateNodeComment(editingId, editContent.trim());
      setComments((c) => c.map((x) => (x.id === updated.id ? updated : x)));
      setEditingId(null);
      setEditContent("");
      emitCommentsChanged(nodeId);
    } catch (err) {
      console.error("Failed to update comment:", err);
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditContent("");
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...fieldLabelStyle, marginBottom: 8 }}>
        Comments ({comments.length})
      </div>

      {comments.length === 0 && (
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
          No comments yet.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {comments.map((c) => (
          <div key={c.id} style={commentCardStyle(c.author_type)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={authorBadgeStyle(c.author_type)}>
                {c.author_type === "agent"
                  ? "AI"
                  : c.creator_user_id && c.creator_user_id === useUserStore.getState().userId
                    ? "You"
                    : c.creator_user_name || "You"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 10, color: "#9ca3af" }}>
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
                {c.author_type === "user" && editingId !== c.id && (
                  <>
                    <button
                      onClick={() => handleEditStart(c)}
                      style={commentIconBtnStyle}
                      title="Edit"
                    >
                      <EditIcon sx={{ fontSize: 12 }} />
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      style={commentIconBtnStyle}
                      title="Delete"
                    >
                      <DeleteIcon sx={{ fontSize: 12 }} />
                    </button>
                  </>
                )}
              </div>
            </div>
            {editingId === c.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  style={commentEditTextareaStyle}
                  rows={3}
                />
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button onClick={handleEditCancel} style={commentCancelBtnStyle}>
                    Cancel
                  </button>
                  <button onClick={handleEditSave} style={commentSaveBtnStyle}>
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#1f2937", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                {c.content}
              </div>
            )}
          </div>
        ))}

        {/* Agent processing status indicator */}
        {agentStatus && (
          <div ref={agentStatusScrollRef} style={agentStatusCardStyle(agentStatus)}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: agentStatus === "error" ? 0 : 6 }}>
              <span style={authorBadgeStyle("agent")}>AI</span>
              {agentStatus === "error" ? (
                <span style={{ fontSize: 11, color: "#dc2626", fontWeight: 500 }}>Error</span>
              ) : (
                <span style={{ fontSize: 11, color: "#7c3aed", fontWeight: 500 }}>Responding...</span>
              )}
            </div>
            {agentStatus === "error" ? (
              <div style={{ fontSize: 12, color: "#dc2626", lineHeight: 1.5 }}>
                {agentError || "Agent failed to respond."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <AgentStatusStep status="posting" current={agentStatus} label="Sending request" />
                <AgentStatusStep status="waiting" current={agentStatus} label="Waiting for response" />
                <AgentStatusStep status="receiving" current={agentStatus} label="Receiving response" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add comment input */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, position: "relative" }}>
        <textarea
          ref={commentTextareaRef}
          value={newContent}
          onChange={handleCommentChange}
          placeholder="Write a comment... (use @Agent to ask AI)"
          style={commentInputStyle}
          rows={2}
        />
        <MentionPopover
          isOpen={mentionOpen}
          position={mentionPos}
          items={getCommentMentionItems()}
          filter={mentionFilter}
          onSelect={handleCommentMentionSelect}
          onClose={handleCommentMentionClose}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleAdd}
            disabled={!newContent.trim() || adding}
            style={{
              ...addCommentBtnStyle,
              opacity: !newContent.trim() || adding ? 0.5 : 1,
              cursor: !newContent.trim() || adding ? "default" : "pointer",
            }}
          >
            {adding ? "Adding..." : "Add Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Image Node Viewer ───

function ImageViewer({ node, onCreateLayerFromNode, detached }: { node: NodeData; onCreateLayerFromNode?: (nodeId: string) => void; detached?: boolean }) {
  const updateNodeContent = useGraphStore((s) => s.updateNodeContent);
  const [title, setTitle] = useState(node.title);
  const [description, setDescription] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [fileExists, setFileExists] = useState(true);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => setOpenSections((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  useEffect(() => {
    setTitle(node.title);
    setOpenSections(new Set());
    let fp: string | null = null;
    let desc = "";
    if (node.metadata) {
      try {
        const meta = JSON.parse(node.metadata);
        fp = meta.file_path ?? null;
        desc = meta.description ?? "";
      } catch {
        /* ignore */
      }
    }
    setFilePath(fp);
    setDescription(desc);

    if (fp) {
      cmd.checkFileExists(fp).then((exists) => {
        setFileExists(exists);
        if (exists) {
          setImageSrc(convertFileSrc(fp!));
        } else {
          setImageSrc(null);
        }
      });
    } else {
      setFileExists(false);
    }
  }, [node.id, node.metadata, node.title]);

  const handleTitleBlur = async () => {
    if (title !== node.title) {
      await updateNodeContent(node.id, { title });
    }
  };

  const handleOpenExternal = async () => {
    if (filePath) {
      try {
        await cmd.openFileExternal(filePath);
      } catch (err) {
        console.error("Failed to open image:", err);
      }
    }
  };

  const handleRelink = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "Select image file",
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "svg", "gif", "webp", "bmp", "tif", "tiff", "ico"],
          },
        ],
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        await cmd.updateNodeImagePath(node.id, selected);
        setFilePath(selected);
        setFileExists(true);
        setImageSrc(convertFileSrc(selected));
      }
    } catch (err) {
      console.error("Failed to re-link image:", err);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minHeight: 0, overflowY: "auto" }}>
      <AccordionSection label="Title" expanded={openSections.has("title")} onToggle={() => toggleSection("title")} detached={detached}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          style={titleInputStyle}
        />
      </AccordionSection>

      <AccordionSection label="Preview" expanded={openSections.has("preview")} onToggle={() => toggleSection("preview")} detached={detached}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 120,
            maxHeight: detached ? undefined : 300,
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            overflow: "hidden",
            background: "#f9fafb",
          }}
        >
          {fileExists && imageSrc ? (
            <img
              src={imageSrc}
              alt={title}
              style={{ maxWidth: "100%", maxHeight: detached ? undefined : 300, objectFit: "contain" }}
            />
          ) : (
            <div style={{ textAlign: "center", padding: 16, color: "#dc2626" }}>
              <BrokenImageIcon sx={{ fontSize: 32, mb: 1 }} />
              <div style={{ fontSize: 12 }}>Image not found</div>
            </div>
          )}
        </div>
      </AccordionSection>

      <AccordionSection label="File" expanded={openSections.has("file")} onToggle={() => toggleSection("file")} detached={detached}>
        {filePath && (
          <div style={{ fontSize: 11, color: "#6b7280", wordBreak: "break-all", marginBottom: 8 }}>{filePath}</div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          {fileExists && filePath && (
            <button onClick={handleOpenExternal} style={imageActionBtnStyle}>
              <OpenInBrowserIcon sx={{ fontSize: 14, mr: "4px" }} />
              Open in viewer
            </button>
          )}
          {!fileExists && (
            <button onClick={handleRelink} style={imageRelinkBtnStyle}>
              Re-link image
            </button>
          )}
        </div>
      </AccordionSection>

      <AccordionSection label="Description" expanded={openSections.has("description")} onToggle={() => toggleSection("description")} detached={detached}>
        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
          {description || <span style={{ color: "#9ca3af", fontStyle: "italic" }}>No description</span>}
        </div>
      </AccordionSection>

      {onCreateLayerFromNode && (
        <AccordionSection label="Layer" expanded={openSections.has("layer")} onToggle={() => toggleSection("layer")} detached={detached}>
          <button
            onClick={() => onCreateLayerFromNode(node.id)}
            style={createLayerBtnStyle}
            title="Create a new layer using this node's content as the Core"
          >
            <LayersIcon sx={{ fontSize: 14, mr: "4px" }} />
            Create Layer from This Node
          </button>
        </AccordionSection>
      )}
    </div>
  );
}

// ─── Ghost Node Viewer (read-only) ───

function GhostViewer({ node, onCreateLayerFromNode, detached }: { node: NodeData; onCreateLayerFromNode?: (nodeId: string) => void; detached?: boolean }) {
  const acceptGhostNode = useGraphStore((s) => s.acceptGhostNode);
  const dismissGhostNode = useGraphStore((s) => s.dismissGhostNode);

  let ghostData: import("../../types").GhostData | null = null;
  if (node.metadata) {
    try {
      ghostData = JSON.parse(node.metadata);
    } catch {
      /* ignore */
    }
  }

  const proposalType = ghostData?.proposal_type ?? "idea";
  const reason = ghostData?.reason;

  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => setOpenSections((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  useEffect(() => {
    setOpenSections(new Set());
  }, [node.id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 0" }}>
        <span style={ghostBadgeStyle}>AI Suggested</span>
        <span style={ghostTypeBadgeStyle}>{proposalType}</span>
      </div>

      <AccordionSection label="Info" expanded={openSections.has("info")} onToggle={() => toggleSection("info")} detached={detached}>
        <div>
          <div style={fieldLabelStyle}>Title</div>
          <div style={fieldValueStyle}>{node.title}</div>
        </div>
        {reason && (
          <div style={{ marginTop: 8 }}>
            <div style={fieldLabelStyle}>Reason</div>
            <div style={{ ...fieldValueStyle, fontStyle: "italic", color: "#7c3aed" }}>
              {reason}
            </div>
          </div>
        )}
      </AccordionSection>

      <AccordionSection label="Details" expanded={openSections.has("details")} onToggle={() => toggleSection("details")} detached={detached}>
        {proposalType === "paper" && ghostData && (
          <>
            {ghostData.authors && ghostData.authors.length > 0 && (
              <div>
                <div style={fieldLabelStyle}>Authors</div>
                <div style={fieldValueStyle}>{ghostData.authors.join(", ")}</div>
              </div>
            )}
            {ghostData.year != null && (
              <div style={{ marginTop: 8 }}>
                <div style={fieldLabelStyle}>Year</div>
                <div style={fieldValueStyle}>{ghostData.year}</div>
              </div>
            )}
            {ghostData.abstract_text && (
              <div style={{ marginTop: 8 }}>
                <div style={fieldLabelStyle}>Abstract</div>
                <div style={{ ...fieldValueStyle, fontSize: 12, lineHeight: 1.5 }}>
                  {ghostData.abstract_text}
                </div>
              </div>
            )}
            {ghostData.url && (
              <div style={{ marginTop: 8 }}>
                <div style={fieldLabelStyle}>URL</div>
                <div style={{ ...fieldValueStyle, wordBreak: "break-all" }}>
                  {ghostData.url}
                </div>
              </div>
            )}
          </>
        )}
        {proposalType === "idea" && ghostData?.body && (
          <div>
            <div style={fieldLabelStyle}>Content</div>
            <div style={{ ...fieldValueStyle, fontSize: 12, lineHeight: 1.5 }}>
              {ghostData.body}
            </div>
          </div>
        )}
      </AccordionSection>

      <AccordionSection label="Actions" expanded={openSections.has("actions")} onToggle={() => toggleSection("actions")} detached={detached}>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={() => acceptGhostNode(node.id)}
            style={ghostAcceptBtnStyle}
          >
            Accept
          </button>
          <button
            onClick={() => dismissGhostNode(node.id)}
            style={ghostDismissBtnStyle}
          >
            Dismiss
          </button>
        </div>
        {onCreateLayerFromNode && (
          <button
            onClick={() => onCreateLayerFromNode(node.id)}
            style={{ ...createLayerBtnStyle, marginTop: 8 }}
            title="Create a new layer using this node's content as the Core"
          >
            <LayersIcon sx={{ fontSize: 14, mr: "4px" }} />
            Create Layer from This Node
          </button>
        )}
      </AccordionSection>
    </div>
  );
}

// ─── User Document Editor ───

function UserDocEditor({
  node,
  onUpdate,
  onCreateLayerFromNode,
  detached,
}: {
  node: NodeData;
  onUpdate: (id: string, fields: { title?: string; content?: string }) => Promise<void>;
  onCreateLayerFromNode?: (nodeId: string) => void;
  detached?: boolean;
}) {
  const editorFontSize = useSettingsStore((s) => s.uiPreferences.editor_font_size) || 13;
  const editorStyle: React.CSSProperties = { ...baseEditorStyle, fontSize: editorFontSize };
  const [title, setTitle] = useState(node.title);
  const [content, setContent] = useState(node.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContent = useRef<string | null>(null);
  const nodeIdRef = useRef(node.id);

  // Display ID editing state
  const refreshNode = useGraphStore((s) => s.refreshNode);
  const [editingDisplayId, setEditingDisplayId] = useState(false);
  const [displayIdDraft, setDisplayIdDraft] = useState(node.display_id ?? "");
  const [displayIdError, setDisplayIdError] = useState<string | null>(null);
  const displayIdInputRef = useRef<HTMLInputElement>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => setOpenSections((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Only reset local state when switching to a different node
  useEffect(() => {
    nodeIdRef.current = node.id;
    setTitle(node.title);
    setContent(node.content ?? "");
    pendingContent.current = null;
    setDirty(false);
    setSaveError(null);
    setEditingDisplayId(false);
    setDisplayIdDraft(node.display_id ?? "");
    setDisplayIdError(null);
    setOpenSections(new Set());
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep draft in sync when display_id updates from outside (e.g. refreshNode)
  useEffect(() => {
    if (!editingDisplayId) {
      setDisplayIdDraft(node.display_id ?? "");
    }
  }, [node.display_id, editingDisplayId]);

  const handleDisplayIdEdit = useCallback(() => {
    setDisplayIdDraft(node.display_id ?? "");
    setDisplayIdError(null);
    setEditingDisplayId(true);
    setTimeout(() => displayIdInputRef.current?.focus(), 0);
  }, [node.display_id]);

  const handleDisplayIdCancel = useCallback(() => {
    setEditingDisplayId(false);
    setDisplayIdDraft(node.display_id ?? "");
    setDisplayIdError(null);
  }, [node.display_id]);

  const handleDisplayIdSave = useCallback(async () => {
    const trimmed = displayIdDraft.trim();
    if (!trimmed) {
      setDisplayIdError("Display ID cannot be empty");
      return;
    }
    if (/\s/.test(trimmed)) {
      setDisplayIdError("Display ID cannot contain spaces");
      return;
    }
    if (trimmed === node.display_id) {
      setEditingDisplayId(false);
      return;
    }
    try {
      setDisplayIdError(null);
      await cmd.updateDisplayId(node.id, trimmed);
      await refreshNode(node.id);
      setEditingDisplayId(false);
    } catch (err) {
      setDisplayIdError(String(err));
    }
  }, [displayIdDraft, node.id, node.display_id, refreshNode]);

  const doSave = useCallback(
    async (nodeId: string, newContent: string) => {
      try {
        setSaving(true);
        setSaveError(null);
        await onUpdate(nodeId, { content: newContent });
        pendingContent.current = null;
        setDirty(false);
      } catch (err) {
        console.error("Note save failed:", err);
        setSaveError(String(err));
      } finally {
        setSaving(false);
      }
    },
    [onUpdate],
  );

  const debouncedSave = useCallback(
    (newContent: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      pendingContent.current = newContent;
      saveTimer.current = setTimeout(() => {
        doSave(nodeIdRef.current, newContent);
      }, 800);
    },
    [doSave],
  );

  // Flush pending save on unmount or node switch
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const pending = pendingContent.current;
      const nid = nodeIdRef.current;
      if (pending !== null) {
        onUpdate(nid, { content: pending }).catch((err) =>
          console.error("Note flush-on-unmount failed:", err),
        );
        pendingContent.current = null;
      }
    };
  }, [doSave, onUpdate]);

  const handleContentChange = (val: string) => {
    setContent(val);
    setDirty(true);
    debouncedSave(val);
  };

  const handleTitleBlur = async () => {
    if (title !== node.title) {
      try {
        await onUpdate(node.id, { title });
      } catch (err) {
        console.error("Title save failed:", err);
        setSaveError(String(err));
      }
    }
  };

  const handleSaveClick = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingContent.current = null;
    await doSave(node.id, content);
  };

  return (
    <div style={detached
      ? { display: "flex", flexDirection: "column" as const, gap: 4 }
      : { display: "flex", flexDirection: "column" as const, gap: 4, flex: 1, minHeight: 0, overflow: "hidden" as const }
    }>
      {/* Display ID — always visible */}
      <div style={{ paddingBottom: 4, borderBottom: "1px solid #f3f4f6" }}>
        {editingDisplayId ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                ref={displayIdInputRef}
                value={displayIdDraft}
                onChange={(e) => {
                  setDisplayIdDraft(e.target.value);
                  setDisplayIdError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleDisplayIdSave();
                  if (e.key === "Escape") handleDisplayIdCancel();
                }}
                style={{
                  fontSize: 13,
                  fontFamily: "monospace",
                  border: displayIdError ? "1px solid #dc2626" : "1px solid #d97706",
                  borderRadius: 4,
                  padding: "4px 8px",
                  flex: 1,
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={handleDisplayIdSave}
                style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", border: "none", borderRadius: 4, background: "#d97706", color: "#fff", cursor: "pointer" }}
              >
                Save
              </button>
              <button
                onClick={handleDisplayIdCancel}
                style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", border: "1px solid #e5e7eb", borderRadius: 4, background: "#fff", color: "#6b7280", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
            {displayIdError && (
              <span style={{ fontSize: 11, color: "#dc2626" }}>{displayIdError}</span>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontFamily: "monospace", color: "#92400e" }}>
              {node.display_id ?? "—"}
            </span>
            <button
              onClick={handleDisplayIdEdit}
              title="Edit display ID"
              style={{ border: "none", background: "transparent", cursor: "pointer", padding: "2px", lineHeight: 1, color: "#9ca3af" }}
            >
              <EditIcon sx={{ fontSize: 14 }} />
            </button>
          </div>
        )}
      </div>

      <AccordionSection label="Title" expanded={openSections.has("title")} onToggle={() => toggleSection("title")} detached={detached}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          style={titleInputStyle}
        />
      </AccordionSection>

      <AccordionSection label="Content" expanded={openSections.has("content")} onToggle={() => toggleSection("content")} detached={detached}>
        <div>
          <NoteEditorWithPull
            nodeId={node.id}
            layerId={node.layer_id}
            value={content}
            onChange={handleContentChange}
            placeholder=""
            style={editorStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <button
            onClick={handleSaveClick}
            disabled={saving || !dirty}
            style={{
              ...saveBtnStyle,
              opacity: saving || !dirty ? 0.5 : 1,
              cursor: saving || !dirty ? "default" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {dirty && !saving && (
            <span style={{ fontSize: 11, color: "#d97706" }}>Unsaved changes</span>
          )}
          {saveError && (
            <span style={{ fontSize: 11, color: "#dc2626" }}>Error: {saveError}</span>
          )}
        </div>
      </AccordionSection>

      <AccordionSection label="Comments" expanded={openSections.has("comments")} onToggle={() => toggleSection("comments")} detached={detached}>
        <CommentSection nodeId={node.id} layerId={node.layer_id} />
      </AccordionSection>

      {/* Create Layer — always visible at bottom */}
      {onCreateLayerFromNode && (
        <div style={{ paddingTop: 4 }}>
          <button
            onClick={() => onCreateLayerFromNode(node.id)}
            style={createLayerBtnStyle}
            title="Create a new layer using this node's content as the Core"
          >
            <LayersIcon sx={{ fontSize: 14, mr: "4px" }} />
            Create Layer from This Node
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Paper Group Viewer ───

function PaperGroupViewer({ node }: { node: NodeData }) {
  const dbNodes = useGraphStore((s) => s.dbNodes);
  const updateNodeContent = useGraphStore((s) => s.updateNodeContent);
  const addPaperToGroup = useGraphStore((s) => s.addPaperToGroup);
  const draggingPaperNodeId = useGraphStore((s) => s.draggingPaperNodeId);
  const [editingName, setEditingName] = useState(node.title);
  const [addQuery, setAddQuery] = useState("");
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const addInputRef = useRef<HTMLInputElement>(null);

  let meta: PaperGroupMetadata | null = null;
  if (node.metadata) {
    try {
      meta = JSON.parse(node.metadata) as PaperGroupMetadata;
    } catch { /* ignore */ }
  }

  const memberIds = meta?.member_node_ids ?? [];
  const members = memberIds
    .map((mid) => dbNodes.find((n) => n.id === mid))
    .filter(Boolean) as NodeData[];

  useEffect(() => {
    setEditingName(node.title);
  }, [node.title]);

  const handleNameSave = useCallback(async () => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === node.title) return;
    await updateNodeContent(node.id, { title: trimmed });
    // Also update metadata group_name
    if (meta) {
      const updatedMeta = { ...meta, group_name: trimmed };
      await cmd.updateNode({ id: node.id, metadata: JSON.stringify(updatedMeta) });
    }
  }, [editingName, node.id, node.title, meta, updateNodeContent]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleNameSave();
        (e.target as HTMLInputElement).blur();
      }
    },
    [handleNameSave],
  );

  const handleUngroup = useCallback(async () => {
    await useGraphStore.getState().ungroupPapers(node.id);
  }, [node.id]);

  // Build set of all grouped paper IDs (any group)
  const allGroupedPaperIds = useRef(new Set<string>());
  allGroupedPaperIds.current = new Set<string>();
  for (const n of dbNodes) {
    if (n.node_type === "paper_group" && n.metadata) {
      try {
        const m = JSON.parse(n.metadata) as PaperGroupMetadata;
        for (const mid of m.member_node_ids) allGroupedPaperIds.current.add(mid);
      } catch { /* ignore */ }
    }
  }

  // Candidate papers: same layer, not grouped anywhere
  const candidates = dbNodes.filter(
    (n) =>
      n.node_type === "paper" &&
      n.layer_id === node.layer_id &&
      !allGroupedPaperIds.current.has(n.id),
  );

  const filteredCandidates = addQuery.trim()
    ? candidates.filter((c) => {
        const q = addQuery.toLowerCase();
        return (
          (c.display_id ?? "").toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q)
        );
      })
    : candidates;

  const handleAddPaper = useCallback(
    async (paperId: string) => {
      await addPaperToGroup(node.id, paperId);
      setAddQuery("");
      setAddDropdownOpen(false);
      setFocusedIdx(-1);
    },
    [addPaperToGroup, node.id],
  );

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setAddDropdownOpen(false);
        setFocusedIdx(-1);
        return;
      }
      if (!addDropdownOpen || filteredCandidates.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx((i) => Math.min(i + 1, filteredCandidates.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && focusedIdx >= 0) {
        e.preventDefault();
        handleAddPaper(filteredCandidates[focusedIdx].id);
      }
    },
    [addDropdownOpen, filteredCandidates, focusedIdx, handleAddPaper],
  );

  // Drop zone: show when a paper is being dragged and it's not already a member
  const showDropZone =
    draggingPaperNodeId !== null && !memberIds.includes(draggingPaperNodeId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
      {/* Group Name */}
      <div>
        <div style={pgvLabelStyle}>Group Name</div>
        <input
          type="text"
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          onBlur={handleNameSave}
          onKeyDown={handleNameKeyDown}
          style={pgvNameInputStyle}
        />
      </div>

      {/* Member Papers */}
      <div>
        <div style={pgvLabelStyle}>Members ({members.length})</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {members.map((m) => (
            <div key={m.id} style={pgvMemberItemStyle}>
              <span style={{ fontWeight: 700, fontSize: 11, fontFamily: "monospace", color: "#065f46" }}>
                {m.display_id ?? m.id.slice(0, 8)}
              </span>
              <span style={{ fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.title}
              </span>
            </div>
          ))}
          {members.length === 0 && (
            <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>No members</div>
          )}
        </div>
      </div>

      {/* Add Paper */}
      {candidates.length > 0 && (
        <div>
          <div style={pgvLabelStyle}>Add Paper</div>
          <div style={{ position: "relative" }}>
            <input
              ref={addInputRef}
              type="text"
              value={addQuery}
              onChange={(e) => {
                setAddQuery(e.target.value);
                setAddDropdownOpen(true);
                setFocusedIdx(-1);
              }}
              onFocus={() => setAddDropdownOpen(true)}
              onBlur={() => {
                // Delay close so click on dropdown item registers
                setTimeout(() => setAddDropdownOpen(false), 150);
              }}
              onKeyDown={handleAddKeyDown}
              placeholder="Search by ID or title..."
              style={pgvAddInputStyle}
            />
            {addDropdownOpen && filteredCandidates.length > 0 && (
              <div style={pgvDropdownStyle}>
                {filteredCandidates.slice(0, 20).map((c, i) => (
                  <div
                    key={c.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleAddPaper(c.id);
                    }}
                    style={{
                      ...pgvDropdownItemStyle,
                      background: i === focusedIdx ? "#f0fdf4" : "transparent",
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 11, fontFamily: "monospace", color: "#065f46", flexShrink: 0 }}>
                      {c.display_id ?? c.id.slice(0, 8)}
                    </span>
                    <span style={{ fontSize: 12, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Drop zone visual */}
      {showDropZone && (
        <div style={pgvDropZoneStyle}>
          Drop to add paper
        </div>
      )}

      {/* Ungroup Button */}
      <button onClick={handleUngroup} style={pgvUngroupBtnStyle}>
        Ungroup Papers
      </button>
    </div>
  );
}

const pgvLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const pgvNameInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  outline: "none",
  boxSizing: "border-box",
};

const pgvMemberItemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
  padding: "6px 10px",
  borderLeft: "3px solid #059669",
  background: "#f0fdf4",
  borderRadius: "0 4px 4px 0",
};

const pgvUngroupBtnStyle: React.CSSProperties = {
  marginTop: "auto",
  padding: "8px 16px",
  border: "1px solid #ef4444",
  borderRadius: 6,
  background: "transparent",
  color: "#ef4444",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const pgvAddInputStyle: React.CSSProperties = {
  width: "100%",
  padding: 6,
  border: "1px solid #d1d5db",
  borderRadius: 4,
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

const pgvDropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 4,
  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  maxHeight: 240,
  overflowY: "auto",
  zIndex: 10,
};

const pgvDropdownItemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
  padding: "6px 10px",
  cursor: "pointer",
};

const pgvDropZoneStyle: React.CSSProperties = {
  padding: "16px 12px",
  border: "2px dashed #059669",
  borderRadius: 6,
  background: "rgba(5,150,105,0.08)",
  color: "#059669",
  fontSize: 13,
  fontWeight: 600,
  textAlign: "center",
};

// ─── Helpers ───

function typeLabel(t: string): string {
  switch (t) {
    case "core":
      return "Core";
    case "paper":
      return "Paper";
    case "user_doc":
      return "Edit";
    case "agent_proposal":
      return "Suggestion";
    case "image":
      return "Image";
    case "agent":
      return "Agent";
    case "paper_group":
      return "Group";
    case "export":
      return "Export";
    case "compare":
      return "Compare";
    default:
      return t;
  }
}

function typeBadgeStyle(t: string): React.CSSProperties {
  const colors: Record<string, { bg: string; fg: string }> = {
    core: { bg: "#1e3a5f", fg: "#fff" },
    paper: { bg: "#059669", fg: "#fff" },
    user_doc: { bg: "#d97706", fg: "#fff" },
    agent_proposal: { bg: "#7c3aed", fg: "#fff" },
    image: { bg: "#0891b2", fg: "#fff" },
    agent: { bg: "#4338ca", fg: "#fff" },
    paper_group: { bg: "#059669", fg: "#fff" },
    export: { bg: "#e11d48", fg: "#fff" },
    compare: { bg: "#0284c7", fg: "#fff" },
  };
  const c = colors[t] ?? { bg: "#6b7280", fg: "#fff" };
  return {
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 4,
    background: c.bg,
    color: c.fg,
  };
}

// ─── Styles ───

const panelStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "#ffffff",
  display: "flex",
  flexDirection: "column",
  padding: 16,
  overflowY: "auto",
  boxSizing: "border-box",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
};

const detachBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 15,
  cursor: "pointer",
  color: "#9ca3af",
  lineHeight: 1,
  padding: "2px 4px",
  borderRadius: 4,
};

const closeBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 22,
  cursor: "pointer",
  color: "#9ca3af",
  lineHeight: 1,
  padding: "0 4px",
};

const deleteNodeBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 15,
  cursor: "pointer",
  color: "#dc2626",
  lineHeight: 1,
  padding: "2px 4px",
  borderRadius: 4,
};

const titleInputStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "8px 10px",
  width: "100%",
  boxSizing: "border-box",
};

const baseEditorStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 100,
  fontFamily: "monospace",
  lineHeight: 1.6,
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: 10,
  resize: "none",
  boxSizing: "border-box",
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 2,
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#1f2937",
  lineHeight: 1.4,
};

const saveBtnStyle: React.CSSProperties = {
  padding: "6px 18px",
  background: "#1e40af",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
};

const createLayerBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px 12px",
  fontSize: 12,
  color: "#6b7280",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  cursor: "pointer",
  width: "100%",
  marginTop: 8,
};

const ghostBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 6px",
  borderRadius: 4,
  background: "#7c3aed",
  color: "#ffffff",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const ghostTypeBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: "2px 6px",
  borderRadius: 4,
  background: "rgba(124, 58, 237, 0.15)",
  color: "#7c3aed",
  textTransform: "uppercase",
  letterSpacing: 0.3,
};

const ghostAcceptBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 0",
  background: "rgba(5, 150, 105, 0.1)",
  color: "#059669",
  border: "1.5px solid #059669",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const ghostDismissBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 0",
  background: "rgba(220, 38, 38, 0.1)",
  color: "#dc2626",
  border: "1.5px solid #dc2626",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const bibtexPreStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "monospace",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: 10,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  margin: 0,
};

const bibtexCopyBtnStyle: React.CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  padding: "2px 8px",
  fontSize: 10,
  fontWeight: 600,
  background: "#e5e7eb",
  color: "#374151",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};

// ─── Comment styles ───

function commentCardStyle(authorType: string): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #e5e7eb",
    background: authorType === "agent" ? "rgba(124, 58, 237, 0.04)" : "#ffffff",
  };
}

function authorBadgeStyle(authorType: string): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 3,
    background: authorType === "agent" ? "#7c3aed" : "#2563eb",
    color: "#ffffff",
  };
}

const commentIconBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12,
  padding: "2px 3px",
  color: "#9ca3af",
  lineHeight: 1,
};

const commentInputStyle: React.CSSProperties = {
  fontSize: 12,
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: 8,
  resize: "none",
  boxSizing: "border-box",
  width: "100%",
  fontFamily: "inherit",
};

const commentEditTextareaStyle: React.CSSProperties = {
  fontSize: 12,
  border: "1px solid #93c5fd",
  borderRadius: 6,
  padding: 8,
  resize: "none",
  boxSizing: "border-box",
  width: "100%",
  fontFamily: "inherit",
};

const addCommentBtnStyle: React.CSSProperties = {
  padding: "5px 14px",
  background: "#2563eb",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
};

const commentSaveBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  background: "#2563eb",
  color: "#ffffff",
  border: "none",
  borderRadius: 5,
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

const commentCancelBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  background: "#ffffff",
  color: "#6b7280",
  border: "1px solid #d1d5db",
  borderRadius: 5,
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
};

const imageActionBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "6px 12px",
  background: "rgba(8, 145, 178, 0.1)",
  color: "#0891b2",
  border: "1px solid #0891b2",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const imageRelinkBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "rgba(220, 38, 38, 0.1)",
  color: "#dc2626",
  border: "1px solid #dc2626",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const bibtexEditBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "#9ca3af",
  padding: "2px 4px",
  lineHeight: 1,
  borderRadius: 3,
};

const bibtexEditTextareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 140,
  fontSize: 11,
  fontFamily: "monospace",
  border: "1px solid #93c5fd",
  borderRadius: 6,
  padding: 10,
  resize: "vertical",
  boxSizing: "border-box",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

const bibtexSaveBtnStyle: React.CSSProperties = {
  padding: "4px 14px",
  background: "#059669",
  color: "#ffffff",
  border: "none",
  borderRadius: 5,
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

const bibtexCancelBtnStyle: React.CSSProperties = {
  padding: "4px 14px",
  background: "#ffffff",
  color: "#6b7280",
  border: "1px solid #d1d5db",
  borderRadius: 5,
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
};

// ─── Agent comment processing indicator ───

const AGENT_STATUS_ORDER: AgentCommentStatus[] = ["posting", "waiting", "receiving"];

function agentStatusCardStyle(status: AgentCommentStatus): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 6,
    border: status === "error"
      ? "1px solid rgba(220, 38, 38, 0.3)"
      : "1px dashed rgba(124, 58, 237, 0.3)",
    background: status === "error"
      ? "rgba(220, 38, 38, 0.04)"
      : "rgba(124, 58, 237, 0.04)",
  };
}

function AgentStatusStep({
  status,
  current,
  label,
}: {
  status: AgentCommentStatus;
  current: AgentCommentStatus;
  label: string;
}) {
  const statusIdx = AGENT_STATUS_ORDER.indexOf(status);
  const currentIdx = AGENT_STATUS_ORDER.indexOf(current);
  const isActive = status === current;
  const isDone = currentIdx > statusIdx;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 20 }}>
      {/* Status dot */}
      <div style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        flexShrink: 0,
        background: isDone ? "#7c3aed" : isActive ? "#7c3aed" : "#d1d5db",
        opacity: isDone ? 0.5 : 1,
        animation: isActive ? "agentCommentPulse 1.2s ease-in-out infinite" : "none",
      }} />
      {/* Label */}
      <span style={{
        fontSize: 11,
        color: isDone ? "#9ca3af" : isActive ? "#7c3aed" : "#d1d5db",
        fontWeight: isActive ? 600 : 400,
        textDecoration: isDone ? "line-through" : "none",
      }}>
        {label}
      </span>
      {/* Spinning icon for active step */}
      {isActive && (
        <SmartToyIcon sx={{
          fontSize: 13,
          color: "#7c3aed",
          animation: "agentCommentSpin 1.2s linear infinite",
        }} />
      )}
      {/* Checkmark for done */}
      {isDone && (
        <span style={{ fontSize: 11, color: "#9ca3af" }}>&#10003;</span>
      )}
    </div>
  );
}

// Inject CSS keyframes for agent comment status animations
if (typeof document !== "undefined") {
  const styleId = "agent-comment-status-keyframes";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes agentCommentPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.8); }
      }
      @keyframes agentCommentSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

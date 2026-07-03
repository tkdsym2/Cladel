import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import SendIcon from "@mui/icons-material/Send";
import EditNoteIcon from "@mui/icons-material/EditNote";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import SettingsIcon from "@mui/icons-material/Settings";
import { useGraphStore } from "../../store/graphStore";
import { useAgentNodeStore } from "../../store/agentNodeStore";
import { useSettingsStore } from "../../store/settingsStore";
import { emitNodeUpdated } from "../../lib/sync-events";
import * as cmd from "../../lib/tauri-commands";
import type { AgentNodeMessage, AgentErrorInfo, NodeData, EdgeData } from "../../types";

interface AgentNodeViewerProps {
  nodeId: string;
  layerId: string;
}

export function AgentNodeViewer({ nodeId, layerId }: AgentNodeViewerProps) {
  const storeDbNodes = useGraphStore((s) => s.dbNodes);
  const storeDbEdges = useGraphStore((s) => s.dbEdges);
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);
  const loadGraph = useGraphStore((s) => s.loadGraph);
  const setProcessing = useAgentNodeStore((s) => s.setProcessing);
  const setError = useAgentNodeStore((s) => s.setError);
  const agentEnabled = useSettingsStore((s) => s.agentCapabilities.agent_enabled);
  const apiKeyStatus = useSettingsStore((s) => s.apiKeyStatus);
  const geminiApiKeyStatus = useSettingsStore((s) => s.geminiApiKeyStatus);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const loadApiKeyStatus = useSettingsStore((s) => s.loadApiKeyStatus);
  const loadGeminiApiKeyStatus = useSettingsStore((s) => s.loadGeminiApiKeyStatus);
  const loadAgentCapabilities = useSettingsStore((s) => s.loadAgentCapabilities);

  // Detached window fallback for graph data
  const [fallbackNodes, setFallbackNodes] = useState<NodeData[]>([]);
  const [fallbackEdges, setFallbackEdges] = useState<EdgeData[]>([]);
  const dbNodes = storeDbNodes.length > 0 ? storeDbNodes : fallbackNodes;
  const dbEdges = storeDbEdges.length > 0 ? storeDbEdges : fallbackEdges;

  const node = dbNodes.find((n) => n.id === nodeId);
  const nodeIdRef = useRef(nodeId);

  // Messages
  const [messages, setMessages] = useState<AgentNodeMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mention autocomplete state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);
  const [mentionPos, setMentionPos] = useState({ x: 0, y: 0 });

  // Provider toggle
  const [provider, setProvider] = useState<"claude" | "gemini">("claude");

  // Output nodes section
  const [outputsExpanded, setOutputsExpanded] = useState(false);

  // Load API key status & capabilities on mount (needed for detached windows)
  useEffect(() => {
    loadApiKeyStatus();
    loadGeminiApiKeyStatus();
    loadAgentCapabilities();
  }, [loadApiKeyStatus, loadGeminiApiKeyStatus, loadAgentCapabilities]);

  // Fetch graph data from backend if store is empty (detached window)
  useEffect(() => {
    if (storeDbNodes.length > 0) return;
    let cancelled = false;
    Promise.all([
      cmd.getNodesByLayer(layerId),
      cmd.getEdgesByLayer(layerId),
    ]).then(([nodes, edges]) => {
      if (!cancelled) {
        setFallbackNodes(nodes);
        setFallbackEdges(edges);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [layerId, storeDbNodes.length]);

  // Reset when switching nodes
  useEffect(() => {
    nodeIdRef.current = nodeId;
    setInput("");
    setIsProcessing(false);
    setOutputsExpanded(false);
    setMentionOpen(false);
  }, [nodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const msgs = await cmd.getAgentNodeMessages(nodeId);
      setMessages(msgs);
    } catch (err) {
      console.error("Failed to fetch agent node messages:", err);
    }
  }, [nodeId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Auto-scroll when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mention candidates: connected nodes (excluding junction/deleted)
  const mentionCandidates = useMemo(() => {
    const connectedIds = new Set<string>();
    for (const e of dbEdges) {
      if (e.source_node_id === nodeId) connectedIds.add(e.target_node_id);
      if (e.target_node_id === nodeId) connectedIds.add(e.source_node_id);
    }
    const typePriority: Record<string, number> = {
      core: 0, paper: 1, user_doc: 2, agent: 3, image: 4,
    };
    return dbNodes
      .filter(
        (n) =>
          connectedIds.has(n.id) &&
          n.node_type !== "junction" &&
          n.node_type !== "deleted" &&
          n.display_id,
      )
      .sort(
        (a, b) =>
          (typePriority[a.node_type] ?? 9) - (typePriority[b.node_type] ?? 9),
      );
  }, [nodeId, dbNodes, dbEdges]);

  const filteredMentions = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase();
    return mentionCandidates.filter(
      (n) =>
        (n.display_id ?? "").toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q),
    );
  }, [mentionOpen, mentionQuery, mentionCandidates]);

  // Find output nodes produced by this agent
  const outputNodes = dbNodes.filter((n) => {
    if (!n.metadata) return false;
    try {
      const meta = JSON.parse(n.metadata);
      return meta.produced_by_agent_node_id === nodeId;
    } catch {
      return false;
    }
  });

  // Check if "Update Last" should be enabled
  const lastOutputMessage = [...messages]
    .reverse()
    .find((m) => m.role === "agent" && m.output_node_id);

  // Get display_id for an output_node_id
  const getOutputNodeLabel = useCallback(
    (outputNodeId: string): { label: string; deleted: boolean } => {
      const n = dbNodes.find((node) => node.id === outputNodeId);
      if (!n) return { label: "Node deleted", deleted: true };
      return { label: n.display_id ?? n.title, deleted: false };
    },
    [dbNodes],
  );

  const handleRun = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;

    setIsProcessing(true);
    setProcessing(nodeId, true);
    setErrorMessage(null);
    setError(nodeId, null);
    try {
      // Save user message
      await cmd.addAgentNodeMessage(nodeId, "user", trimmed);
      setInput("");
      await fetchMessages();

      // Invoke the agent
      const result = await cmd.invokeAgentNode(nodeId, trimmed, null, provider);

      // Save agent response with output node reference
      await cmd.addAgentNodeMessage(
        nodeId,
        "agent",
        result.agent_message,
        result.output_node_id,
      );

      await fetchMessages();

      // Refresh graph to show the new output node
      await loadGraph(layerId);

      // Notify detached windows about the new/updated output node
      if (result.output_node_id) {
        emitNodeUpdated(result.output_node_id);
      }
    } catch (err) {
      console.error("Failed to run agent:", err);
      const errorInfo = parseAgentError(err);
      const errorMsg = errorInfo?.message ?? "An unexpected error occurred.";
      setErrorMessage(errorMsg);
      setError(nodeId, errorMsg);
    } finally {
      setIsProcessing(false);
      setProcessing(nodeId, false);
    }
  }, [input, isProcessing, nodeId, fetchMessages, loadGraph, layerId, setProcessing, setError, provider]);

  const handleUpdateLast = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing || !lastOutputMessage) return;

    setIsProcessing(true);
    setProcessing(nodeId, true);
    setErrorMessage(null);
    setError(nodeId, null);
    try {
      // Save user message
      await cmd.addAgentNodeMessage(nodeId, "user", `[Update] ${trimmed}`);
      setInput("");
      await fetchMessages();

      // Invoke the agent with the update target
      const result = await cmd.invokeAgentNode(
        nodeId,
        trimmed,
        lastOutputMessage.output_node_id,
        provider,
      );

      // Save agent response with output node reference
      await cmd.addAgentNodeMessage(
        nodeId,
        "agent",
        result.agent_message,
        result.output_node_id,
      );

      await fetchMessages();

      // Refresh graph to update the output node content
      await loadGraph(layerId);

      // Notify detached windows about the updated output node
      if (result.output_node_id) {
        emitNodeUpdated(result.output_node_id);
      }
    } catch (err) {
      console.error("Failed to update:", err);
      const errorInfo = parseAgentError(err);
      const errorMsg = errorInfo?.message ?? "An unexpected error occurred.";
      setErrorMessage(errorMsg);
      setError(nodeId, errorMsg);
    } finally {
      setIsProcessing(false);
      setProcessing(nodeId, false);
    }
  }, [input, isProcessing, nodeId, lastOutputMessage, fetchMessages, loadGraph, layerId, setProcessing, setError, provider]);

  const insertMention = useCallback(
    (displayId: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const before = input.substring(0, mentionStartPos);
      const after = input.substring(ta.selectionStart);
      const inserted = `@${displayId} `;
      const newValue = before + inserted + after;
      setInput(newValue);
      setMentionOpen(false);
      const newPos = before.length + inserted.length;
      requestAnimationFrame(() => {
        ta.selectionStart = newPos;
        ta.selectionEnd = newPos;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 96) + "px";
      });
    },
    [input, mentionStartPos],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionOpen && filteredMentions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % filteredMentions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex(
            (i) => (i - 1 + filteredMentions.length) % filteredMentions.length,
          );
          return;
        }
        if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          const selected = filteredMentions[mentionIndex];
          if (selected?.display_id) insertMention(selected.display_id);
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const selected = filteredMentions[mentionIndex];
          if (selected?.display_id) insertMention(selected.display_id);
          return;
        }
      }
      if (mentionOpen && e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setMentionOpen(false);
        handleRun();
      }
    },
    [handleRun, mentionOpen, filteredMentions, mentionIndex, insertMention],
  );

  // Auto-resize textarea + mention detection
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setInput(val);
      const ta = e.target;
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 96) + "px";

      // Detect @ mention trigger
      const cursorPos = ta.selectionStart;
      const textBefore = val.substring(0, cursorPos);
      const match = textBefore.match(/(^|[\s])@([^\s]*)$/);
      if (match) {
        const atPos = textBefore.length - match[0].length + match[1].length;
        setMentionQuery(match[2]);
        setMentionStartPos(atPos);
        setMentionIndex(0);
        const rect = ta.getBoundingClientRect();
        setMentionPos({ x: rect.left + 10, y: rect.top });
        setMentionOpen(true);
      } else {
        setMentionOpen(false);
      }
    },
    [],
  );

  // Close mention on blur (with delay for popover click)
  const handleBlur = useCallback(() => {
    setTimeout(() => setMentionOpen(false), 150);
  }, []);

  // Current provider has a key?
  const hasActiveKey = provider === "gemini" ? !!geminiApiKeyStatus : !!apiKeyStatus;
  const hasAnyKey = !!apiKeyStatus || !!geminiApiKeyStatus;

  return (
    <div style={containerStyle}>
      {/* Header section */}
      <div style={sectionStyle}>
        {node?.display_id && (
          <div style={displayIdStyle}>{node.display_id}</div>
        )}
      </div>

      {/* Chat messages */}
      <div style={messagesContainerStyle}>
        {messages.length === 0 ? (
          <div style={emptyStateStyle}>
            <SmartToyIcon sx={{ fontSize: 32, color: "#c7d2fe", mb: 1 }} />
            <p style={{ margin: 0, fontWeight: 500, color: "#6366f1" }}>
              Ready
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>
              Send an instruction to start. The agent will analyze connected
              nodes and produce results.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              style={
                msg.role === "user"
                  ? userMessageStyle
                  : agentMessageStyle
              }
            >
              <div style={messageLabelStyle}>
                {msg.role === "user" ? (
                  <>
                    <PersonIcon sx={{ fontSize: 12 }} />
                    <span>You</span>
                  </>
                ) : (
                  <>
                    <SmartToyIcon sx={{ fontSize: 12 }} />
                    <span>Agent</span>
                  </>
                )}
                <span style={messageTimeStyle}>
                  {formatTime(msg.created_at)}
                </span>
              </div>
              <div style={messageContentStyle}>{msg.content}</div>
              {msg.output_node_id && (() => {
                const info = getOutputNodeLabel(msg.output_node_id);
                return info.deleted ? (
                  <span style={deletedOutputLinkStyle}>
                    → {info.label}
                  </span>
                ) : (
                  <button
                    onClick={() => setSelectedNodeId(msg.output_node_id!)}
                    style={outputLinkStyle}
                  >
                    → {info.label}
                  </button>
                );
              })()}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Output nodes section */}
      {outputNodes.length > 0 && (
        <div style={outputSectionStyle}>
          <button
            onClick={() => setOutputsExpanded((v) => !v)}
            style={outputToggleStyle}
          >
            {outputsExpanded ? (
              <ExpandLessIcon sx={{ fontSize: 16 }} />
            ) : (
              <ExpandMoreIcon sx={{ fontSize: 16 }} />
            )}
            <span>
              Output Nodes ({outputNodes.length})
            </span>
          </button>
          {outputsExpanded && (
            <div style={outputListStyle}>
              {outputNodes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setSelectedNodeId(n.id)}
                  style={outputItemStyle}
                >
                  <span style={outputItemIdStyle}>
                    {n.display_id ?? "—"}
                  </span>
                  <span style={outputItemTitleStyle}>
                    {n.title.length > 30
                      ? n.title.slice(0, 30) + "…"
                      : n.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {errorMessage && (
        <div style={errorBannerStyle}>
          <ErrorOutlineIcon sx={{ fontSize: 14, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{errorMessage}</span>
          <button
            onClick={() => { setErrorMessage(null); setError(nodeId, null); }}
            style={errorDismissStyle}
          >
            ×
          </button>
        </div>
      )}

      {/* Settings guard */}
      {!agentEnabled ? (
        <div style={settingsGuardStyle}>
          <SettingsIcon sx={{ fontSize: 14, flexShrink: 0, color: "#9ca3af" }} />
          <span>Agent is disabled.</span>
          <button onClick={openSettings} style={settingsLinkStyle}>
            Enable in Settings
          </button>
        </div>
      ) : !hasAnyKey ? (
        <div style={settingsGuardStyle}>
          <SettingsIcon sx={{ fontSize: 14, flexShrink: 0, color: "#9ca3af" }} />
          <span>API key not configured.</span>
          <button onClick={openSettings} style={settingsLinkStyle}>
            Add in Settings
          </button>
        </div>
      ) : null}

      {/* Provider toggle */}
      {agentEnabled && hasAnyKey && (
        <div style={providerToggleRowStyle}>
          <button
            onClick={() => setProvider("claude")}
            disabled={!apiKeyStatus}
            style={{
              ...providerBtnBase,
              ...(provider === "claude" ? providerBtnActiveClaude : providerBtnInactive),
              ...(!apiKeyStatus ? { opacity: 0.4, cursor: "not-allowed" } : {}),
            }}
          >
            Claude
          </button>
          <button
            onClick={() => setProvider("gemini")}
            disabled={!geminiApiKeyStatus}
            style={{
              ...providerBtnBase,
              ...(provider === "gemini" ? providerBtnActiveGemini : providerBtnInactive),
              ...(!geminiApiKeyStatus ? { opacity: 0.4, cursor: "not-allowed" } : {}),
            }}
          >
            Gemini
          </button>
        </div>
      )}

      {/* Input section */}
      <div style={inputSectionStyle}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={
            !agentEnabled
              ? "Agent is disabled"
              : !hasActiveKey
                ? "API key required for selected provider"
                : "Describe what you want the agent to do..."
          }
          rows={1}
          style={textareaStyle}
          disabled={isProcessing || !agentEnabled || !hasActiveKey}
        />
        <div style={buttonRowStyle}>
          <button
            onClick={handleRun}
            disabled={!input.trim() || isProcessing || !agentEnabled || !hasActiveKey}
            style={
              !input.trim() || isProcessing || !agentEnabled || !hasActiveKey
                ? { ...runBtnStyle, ...disabledBtnStyle }
                : runBtnStyle
            }
            title="Run — create new output (Cmd+Enter)"
          >
            {isProcessing ? (
              <span style={spinnerStyle} />
            ) : (
              <SendIcon sx={{ fontSize: 14 }} />
            )}
            <span>Run</span>
          </button>
          <button
            onClick={handleUpdateLast}
            disabled={!input.trim() || isProcessing || !lastOutputMessage || !agentEnabled || !hasActiveKey}
            style={
              !input.trim() || isProcessing || !lastOutputMessage || !agentEnabled || !hasActiveKey
                ? { ...updateBtnStyle, ...disabledBtnStyle }
                : updateBtnStyle
            }
            title="Update the most recent output node"
          >
            <EditNoteIcon sx={{ fontSize: 14 }} />
            <span>Update Last</span>
          </button>
        </div>
      </div>

      {/* Mention autocomplete popover */}
      {mentionOpen && filteredMentions.length > 0 && (
        <MentionPopover
          candidates={filteredMentions}
          focusIndex={mentionIndex}
          position={mentionPos}
          onSelect={(displayId) => insertMention(displayId)}
          onHover={(idx) => setMentionIndex(idx)}
        />
      )}
    </div>
  );
}

// ─── Helpers ───

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function parseAgentError(err: unknown): AgentErrorInfo | null {
  if (typeof err === "string") {
    try {
      return JSON.parse(err) as AgentErrorInfo;
    } catch {
      return { error_code: "unknown", message: err, retry_after_secs: null, recoverable: true };
    }
  }
  return null;
}

// ─── Mention Popover ───

const MENTION_COLORS: Record<string, string> = {
  core: "#1e40af",
  paper: "#059669",
  user_doc: "#d97706",
  agent: "#4338ca",
  image: "#0891b2",
};

const MENTION_LABELS: Record<string, string> = {
  core: "Core",
  paper: "Paper",
  user_doc: "Note",
  agent: "Agent",
  image: "Image",
};

interface MentionPopoverProps {
  candidates: NodeData[];
  focusIndex: number;
  position: { x: number; y: number };
  onSelect: (displayId: string) => void;
  onHover: (index: number) => void;
}

function MentionPopover({
  candidates,
  focusIndex,
  position,
  onSelect,
  onHover,
}: MentionPopoverProps) {
  const popoverWidth = 260;
  const maxHeight = 200;
  const margin = 8;
  const itemHeight = 34;
  const padding = 8;
  const estimatedHeight = Math.min(
    candidates.length * itemHeight + padding,
    maxHeight,
  );
  const clampedX = Math.min(
    Math.max(margin, position.x),
    window.innerWidth - popoverWidth - margin,
  );
  const clampedY = Math.max(margin, position.y - estimatedHeight);

  return (
    <div
      style={{
        position: "fixed",
        left: clampedX,
        top: clampedY,
        zIndex: 1000,
        width: popoverWidth,
        maxHeight,
        overflowY: "auto",
        background: "#1a1a2e",
        color: "#e0e0e0",
        borderRadius: 8,
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)",
        padding: "4px",
        userSelect: "none",
      }}
    >
      {candidates.map((node, idx) => {
        const focused = idx === focusIndex;
        const color = MENTION_COLORS[node.node_type] ?? "#6b7280";
        return (
          <div
            key={node.id}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(node.display_id!);
            }}
            onMouseEnter={() => onHover(idx)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 6,
              cursor: "pointer",
              background: focused
                ? "rgba(255,255,255,0.1)"
                : "transparent",
              transition: "background 0.1s",
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: "1px 5px",
                borderRadius: 3,
                background: color,
                color: "#fff",
                textTransform: "uppercase",
                letterSpacing: 0.3,
                flexShrink: 0,
              }}
            >
              {MENTION_LABELS[node.node_type] ?? node.node_type}
            </span>
            <span
              style={{
                fontSize: 12,
                fontFamily: "monospace",
                color: "rgba(255,255,255,0.7)",
                flexShrink: 0,
              }}
            >
              @{node.display_id}
            </span>
            {(node.node_type === "paper" || node.node_type === "title") && (
              <span
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.4)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {node.title.length > 20
                  ? node.title.slice(0, 20) + "\u2026"
                  : node.title}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Styles ───

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  overflow: "hidden",
};

const sectionStyle: React.CSSProperties = {
  paddingBottom: 8,
  borderBottom: "1px solid #e5e7eb",
  marginBottom: 8,
};

// The agent node's name (its display_id).
const displayIdStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  fontFamily: "monospace",
  color: "#1f2937",
};

const messagesContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "4px 0",
};

const emptyStateStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  flex: 1,
  textAlign: "center",
  padding: 24,
  color: "#6b7280",
  fontSize: 13,
};

const userMessageStyle: React.CSSProperties = {
  background: "#eef2ff",
  border: "1px solid #c7d2fe",
  borderRadius: 8,
  padding: "8px 10px",
};

const agentMessageStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "8px 10px",
};

const messageLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 10,
  fontWeight: 600,
  color: "#6b7280",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const messageTimeStyle: React.CSSProperties = {
  marginLeft: "auto",
  fontWeight: 400,
  fontSize: 10,
  color: "#9ca3af",
  textTransform: "none",
  letterSpacing: 0,
};

const messageContentStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#1f2937",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const outputLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  marginTop: 6,
  padding: "2px 8px",
  fontSize: 11,
  fontWeight: 500,
  fontFamily: "monospace",
  color: "#4338ca",
  background: "rgba(67,56,202,0.08)",
  border: "1px solid rgba(67,56,202,0.2)",
  borderRadius: 4,
  cursor: "pointer",
};

const outputSectionStyle: React.CSSProperties = {
  borderTop: "1px solid #e5e7eb",
  paddingTop: 4,
};

const outputToggleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  width: "100%",
  padding: "4px 2px",
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  background: "transparent",
  border: "none",
  cursor: "pointer",
};

const outputListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "2px 0 4px",
};

const outputItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "4px 8px",
  fontSize: 12,
  color: "#374151",
  background: "transparent",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  textAlign: "left",
};

const outputItemIdStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 10,
  color: "#6366f1",
  flexShrink: 0,
};

const outputItemTitleStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const inputSectionStyle: React.CSSProperties = {
  borderTop: "1px solid #e5e7eb",
  paddingTop: 8,
  marginTop: "auto",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  resize: "none",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 13,
  color: "#1f2937",
  background: "#fff",
  outline: "none",
  boxSizing: "border-box",
  lineHeight: 1.5,
  minHeight: 36,
  maxHeight: 96,
  overflow: "auto",
};

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginTop: 6,
};

const runBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "#fff",
  background: "#4338ca",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const updateBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "#4338ca",
  background: "rgba(67,56,202,0.08)",
  border: "1px solid rgba(67,56,202,0.2)",
  borderRadius: 6,
  cursor: "pointer",
};

const disabledBtnStyle: React.CSSProperties = {
  opacity: 0.4,
  cursor: "not-allowed",
};

const spinnerStyle: React.CSSProperties = {
  display: "inline-block",
  width: 14,
  height: 14,
  border: "2px solid rgba(255,255,255,0.3)",
  borderTopColor: "#fff",
  borderRadius: "50%",
  animation: "spin 0.6s linear infinite",
};

const deletedOutputLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  marginTop: 6,
  padding: "2px 8px",
  fontSize: 11,
  fontWeight: 500,
  fontFamily: "monospace",
  color: "#9ca3af",
  background: "rgba(156,163,175,0.08)",
  border: "1px solid rgba(156,163,175,0.2)",
  borderRadius: 4,
  fontStyle: "italic",
};

const settingsGuardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  fontSize: 12,
  color: "#6b7280",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  marginBottom: 4,
};

const settingsLinkStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#4338ca",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  padding: 0,
  textDecoration: "underline",
};

const errorBannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  padding: "8px 10px",
  fontSize: 12,
  color: "#dc2626",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 6,
  marginBottom: 4,
};

const errorDismissStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#dc2626",
  cursor: "pointer",
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1,
  padding: 0,
  flexShrink: 0,
};

const providerToggleRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: 6,
};

const providerBtnBase: React.CSSProperties = {
  padding: "3px 10px",
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 4,
  border: "1px solid transparent",
  cursor: "pointer",
  transition: "all 120ms ease",
};

const providerBtnActiveClaude: React.CSSProperties = {
  background: "#4338ca",
  color: "#fff",
  borderColor: "#4338ca",
};

const providerBtnActiveGemini: React.CSSProperties = {
  background: "#1a73e8",
  color: "#fff",
  borderColor: "#1a73e8",
};

const providerBtnInactive: React.CSSProperties = {
  background: "transparent",
  color: "#6b7280",
  borderColor: "#d1d5db",
};

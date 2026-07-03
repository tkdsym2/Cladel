import { useState, useEffect, useRef, useCallback } from "react";
import * as cmd from "../../lib/tauri-commands";

// ─── Types (exported for NoteEditorWithPull) ───

export interface ConnectedNodeInfo {
  id: string;
  node_type: string;
  title: string;
  display_id: string | null;
  content: string | null;
}

interface ContentOption {
  label: string;
  preview: string;
  text: string;
}

interface ContentPullPopoverProps {
  isOpen: boolean;
  position: { x: number; y: number };
  connectedNodes: ConnectedNodeInfo[];
  onSelect: (text: string) => void;
  onClose: () => void;
}

// ─── Constants ───

const NODE_COLORS: Record<string, string> = {
  core: "#1e40af",
  paper: "#059669",
  user_doc: "#d97706",
};

const NODE_LABELS: Record<string, string> = {
  core: "Core",
  paper: "Paper",
  user_doc: "Note",
};

// ─── Component ───

export function ContentPullPopover({
  isOpen,
  position,
  connectedNodes,
  onSelect,
  onClose,
}: ContentPullPopoverProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedNode, setSelectedNode] = useState<ConnectedNodeInfo | null>(
    null,
  );
  const [contentOptions, setContentOptions] = useState<ContentOption[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset state when popover opens/closes
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setFocusIndex(0);
      setSelectedNode(null);
      setContentOptions([]);
      setLoadingContent(false);
    }
  }, [isOpen]);

  // Build content options for the selected node (step 2)
  const loadContentOptions = useCallback(
    async (node: ConnectedNodeInfo) => {
      setLoadingContent(true);
      const options: ContentOption[] = [];

      if (node.node_type === "core") {
        // Core: only content — auto-select and insert immediately
        if (node.content) {
          onSelect(node.content);
          return;
        }
        // No content available
        setContentOptions([]);
        setLoadingContent(false);
        return;
      }

      // Add content option for paper (abstract) or user_doc (content)
      if (node.content) {
        const label = node.node_type === "paper" ? "Abstract" : "Content";
        options.push({
          label,
          preview: truncate(node.content, 100),
          text: node.content,
        });
      }

      // Fetch comments (lazy — only for the selected node)
      try {
        const comments = await cmd.getNodeComments(node.id);
        for (const c of comments) {
          const badge = c.author_type === "agent" ? "[AI] " : "[You] ";
          options.push({
            label: `Comment: ${truncate(c.content, 50)}`,
            preview: badge + truncate(c.content, 100),
            text: c.content,
          });
        }
      } catch {
        // Ignore comment fetch errors
      }

      setContentOptions(options);
      setFocusIndex(0);
      setLoadingContent(false);
    },
    [onSelect],
  );

  // Handle selecting a node in step 1
  const handleNodeSelect = useCallback(
    (node: ConnectedNodeInfo) => {
      setSelectedNode(node);
      setStep(2);
      loadContentOptions(node);
    },
    [loadContentOptions],
  );

  // Handle selecting content in step 2
  const handleContentSelect = useCallback(
    (option: ContentOption) => {
      onSelect(option.text);
    },
    [onSelect],
  );

  // Keyboard handling (capture phase)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const items = step === 1 ? connectedNodes : contentOptions;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          if (items.length > 0) {
            setFocusIndex((i) => (i + 1) % items.length);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          if (items.length > 0) {
            setFocusIndex((i) => (i - 1 + items.length) % items.length);
          }
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (step === 1 && connectedNodes[focusIndex]) {
            handleNodeSelect(connectedNodes[focusIndex]);
          } else if (step === 2 && contentOptions[focusIndex]) {
            handleContentSelect(contentOptions[focusIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          if (step === 2) {
            setStep(1);
            setFocusIndex(0);
            setSelectedNode(null);
            setContentOptions([]);
          } else {
            onClose();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    isOpen,
    step,
    focusIndex,
    connectedNodes,
    contentOptions,
    handleNodeSelect,
    handleContentSelect,
    onClose,
  ]);

  // Click-outside handling (50ms delay to prevent immediate trigger)
  useEffect(() => {
    if (!isOpen) return;

    const cleanupRef = { current: null as (() => void) | null };

    const timerId = window.setTimeout(() => {
      const handleMouseDown = (e: MouseEvent) => {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          onClose();
        }
      };
      window.addEventListener("mousedown", handleMouseDown);
      cleanupRef.current = () =>
        window.removeEventListener("mousedown", handleMouseDown);
    }, 50);

    return () => {
      window.clearTimeout(timerId);
      cleanupRef.current?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Clamp position to viewport bounds
  const popoverWidth = 280;
  const popoverMaxHeight = 320;
  const margin = 8;
  const clampedX = Math.min(
    Math.max(margin, position.x),
    window.innerWidth - popoverWidth - margin,
  );
  const clampedY = Math.min(
    Math.max(margin, position.y),
    window.innerHeight - popoverMaxHeight - margin,
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        left: clampedX,
        top: clampedY,
        zIndex: 1000,
        width: popoverWidth,
        maxHeight: popoverMaxHeight,
        background: "#ffffff",
        color: "#1f2937",
        borderRadius: 10,
        boxShadow:
          "0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)",
        userSelect: "none",
        animation: "contentPullIn 120ms ease-out",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{keyframesCSS}</style>

      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>
          {step === 1
            ? "Import Content From"
            : selectedNode
              ? truncate(selectedNode.display_id ?? selectedNode.title, 24)
              : "Select Content"}
        </span>
        {step === 2 && (
          <button
            onClick={() => {
              setStep(1);
              setFocusIndex(0);
              setSelectedNode(null);
              setContentOptions([]);
            }}
            style={backBtnStyle}
          >
            Back
          </button>
        )}
      </div>

      {/* Content area */}
      <div style={{ padding: "4px 6px", overflowY: "auto", flex: 1 }}>
        {step === 1 && (
          <>
            {connectedNodes.map((node, idx) => {
              const focused = idx === focusIndex;
              const color = NODE_COLORS[node.node_type] ?? "#6b7280";
              return (
                <div
                  key={node.id}
                  onClick={() => handleNodeSelect(node)}
                  onMouseEnter={() => setFocusIndex(idx)}
                  style={itemStyle(focused)}
                >
                  <div
                    style={{
                      width: 3,
                      height: 24,
                      borderRadius: 2,
                      background: color,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span style={nodeTypeBadge(color)}>
                        {NODE_LABELS[node.node_type] ?? node.node_type}
                      </span>
                      {node.display_id && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "#9ca3af",
                            fontFamily: "monospace",
                          }}
                        >
                          {node.display_id}
                        </span>
                      )}
                    </div>
                    {(node.node_type === "paper" || node.node_type === "title") && node.title && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "#4b5563",
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {node.title}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {step === 2 && loadingContent && (
          <div
            style={{
              padding: "16px 8px",
              textAlign: "center",
              fontSize: 12,
              color: "#9ca3af",
            }}
          >
            Loading...
          </div>
        )}

        {step === 2 && !loadingContent && contentOptions.length === 0 && (
          <div
            style={{
              padding: "16px 8px",
              textAlign: "center",
              fontSize: 12,
              color: "#9ca3af",
            }}
          >
            No content available
          </div>
        )}

        {step === 2 &&
          !loadingContent &&
          contentOptions.map((option, idx) => {
            const focused = idx === focusIndex;
            return (
              <div
                key={idx}
                onClick={() => handleContentSelect(option)}
                onMouseEnter={() => setFocusIndex(idx)}
                style={itemStyle(focused)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "#1f2937",
                      marginBottom: 2,
                    }}
                  >
                    {option.label}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#9ca3af",
                      lineHeight: 1.4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {option.preview}
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <span>{"\u2191\u2193"} Navigate</span>
        <span style={{ margin: "0 6px", opacity: 0.3 }}>{"\u00b7"}</span>
        <span>Enter Select</span>
        <span style={{ margin: "0 6px", opacity: 0.3 }}>{"\u00b7"}</span>
        <span>Esc {step === 2 ? "Back" : "Cancel"}</span>
      </div>
    </div>
  );
}

// ─── Helpers ───

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

// ─── Styles ───

const keyframesCSS = `
@keyframes contentPullIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
`;

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 14px 6px",
  borderBottom: "1px solid #e5e7eb",
};

const backBtnStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#6b7280",
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  borderRadius: 4,
  padding: "2px 8px",
  cursor: "pointer",
};

function itemStyle(focused: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 8px",
    borderRadius: 7,
    cursor: "pointer",
    background: focused ? "#f3f4f6" : "transparent",
    transition: "background 0.1s",
  };
}

function nodeTypeBadge(color: string): React.CSSProperties {
  return {
    fontSize: 9,
    fontWeight: 700,
    padding: "1px 5px",
    borderRadius: 3,
    background: color,
    color: "#ffffff",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  };
}

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "6px 14px 10px",
  borderTop: "1px solid #e5e7eb",
  fontSize: 10,
  color: "#9ca3af",
};

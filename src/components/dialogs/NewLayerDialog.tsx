import { useState, useEffect, useCallback } from "react";
import CloseIcon from "@mui/icons-material/Close";
import { useT, type Entry } from "../../lib/i18n";
import type { NodeData } from "../../types";

interface Props {
  open: boolean;
  nextLayerNumber: number;
  onClose: () => void;
  onCreate: (name: string, sourceNodeId?: string | null) => Promise<void>;
  /** Eligible non-core/junction/deleted nodes from current layer */
  eligibleNodes?: NodeData[];
  /** Pre-selected node (when opened from NodeDetailPanel button) */
  preSelectedNodeId?: string | null;
}

const NODE_TYPE_COLORS: Record<string, string> = {
  paper: "#059669",
  user_doc: "#d97706",
  agent_proposal: "#7c3aed",
  image: "#0891b2",
};

const NODE_TYPE_LABELS: Record<string, Entry> = {
  paper: { en: "Paper", ja: "論文" },
  user_doc: { en: "Note", ja: "ノート" },
  agent_proposal: { en: "Suggestion", ja: "提案" },
  image: { en: "Image", ja: "画像" },
};

export function NewLayerDialog({
  open,
  nextLayerNumber,
  onClose,
  onCreate,
  eligibleNodes = [],
  preSelectedNodeId,
}: Props) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<"core" | "node">(
    preSelectedNodeId ? "node" : "core",
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    preSelectedNodeId ?? null,
  );

  // Reset state when dialog opens or preSelectedNodeId changes
  useEffect(() => {
    if (open) {
      setSourceMode(preSelectedNodeId ? "node" : "core");
      setSelectedNodeId(preSelectedNodeId ?? null);
      setError(null);
    }
  }, [open, preSelectedNodeId]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const nodeId = sourceMode === "node" ? selectedNodeId : null;
      await onCreate(`Layer ${nextLayerNumber}`, nodeId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }, [nextLayerNumber, sourceMode, selectedNodeId, onCreate, onClose]);

  const handleClose = useCallback(() => {
    if (creating) return;
    setError(null);
    onClose();
  }, [creating, onClose]);

  const selectedNode =
    sourceMode === "node"
      ? eligibleNodes.find((n) => n.id === selectedNodeId)
      : null;

  const contentPreview = selectedNode?.content
    ? selectedNode.content.slice(0, 100) +
      (selectedNode.content.length > 100 ? "..." : "")
    : null;

  const hasEligibleNodes = eligibleNodes.length > 0;
  const canCreate =
    sourceMode === "core" || (sourceMode === "node" && selectedNodeId);

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: "#111827",
            }}
          >
            {t({ en: "Create New Layer", ja: "新規レイヤーを作成" })}
          </h2>
          <button onClick={handleClose} style={closeButtonStyle}>
            <CloseIcon sx={{ fontSize: 22 }} />
          </button>
        </div>

        {/* Layer info */}
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: "#374151" }}>
          {t({ en: "Layer {n}", ja: "レイヤー{n}" }, { n: nextLayerNumber })}
        </div>

        {/* Source selection: radio options */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Option 1: Inherit from Core */}
          <label
            style={{
              ...radioOptionStyle,
              borderColor: sourceMode === "core" ? "#1e40af" : "#e5e7eb",
              background: sourceMode === "core" ? "#eff6ff" : "#fff",
            }}
          >
            <input
              type="radio"
              name="sourceMode"
              checked={sourceMode === "core"}
              onChange={() => {
                setSourceMode("core");
                setSelectedNodeId(null);
              }}
              style={{ marginRight: 8, accentColor: "#1e40af" }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                {t({ en: "Inherit from current Core", ja: "現在のCoreから引き継ぐ" })}
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                {t({
                  en: "Snapshot the current Core node content as the starting point",
                  ja: "現在のCoreノードの内容を起点として複製します",
                })}
              </div>
            </div>
          </label>

          {/* Option 2: From existing node */}
          <label
            style={{
              ...radioOptionStyle,
              borderColor:
                sourceMode === "node" ? "#1e40af" : "#e5e7eb",
              background: sourceMode === "node" ? "#eff6ff" : "#fff",
              opacity: hasEligibleNodes ? 1 : 0.5,
              cursor: hasEligibleNodes ? "pointer" : "not-allowed",
            }}
          >
            <input
              type="radio"
              name="sourceMode"
              checked={sourceMode === "node"}
              disabled={!hasEligibleNodes}
              onChange={() => setSourceMode("node")}
              style={{ marginRight: 8, accentColor: "#1e40af" }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                {t({ en: "Start from existing node", ja: "既存のノードから始める" })}
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                {hasEligibleNodes
                  ? t({ en: "Use a node's content as the new Core", ja: "ノードの内容を新しいCoreとして使用します" })
                  : t({ en: "No eligible nodes in current layer", ja: "現在のレイヤーに利用可能なノードがありません" })}
              </div>
            </div>
          </label>
        </div>

        {/* Node selector (shown when "from node" is selected) */}
        {sourceMode === "node" && hasEligibleNodes && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
              {t({ en: "Select source node", ja: "ソースノードを選択" })}
            </div>
            <div style={nodeListStyle}>
              {eligibleNodes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setSelectedNodeId(n.id)}
                  style={{
                    ...nodeItemStyle,
                    borderColor: selectedNodeId === n.id ? "#1e40af" : "#e5e7eb",
                    background: selectedNodeId === n.id ? "#eff6ff" : "#fff",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: NODE_TYPE_COLORS[n.node_type] ?? "#6b7280",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace", flexShrink: 0 }}>
                    {n.display_id ??
                      (NODE_TYPE_LABELS[n.node_type] ? t(NODE_TYPE_LABELS[n.node_type]) : n.node_type)}
                  </span>
                  <span style={{ fontSize: 12, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {n.title.length > 40 ? n.title.slice(0, 40) + "..." : n.title}
                  </span>
                </button>
              ))}
            </div>

            {/* Content preview */}
            {selectedNode && (
              <div style={previewBoxStyle}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>
                  {t({ en: "Preview", ja: "プレビュー" })}
                </div>
                <div style={{ fontSize: 12, color: "#374151", fontWeight: 600, marginBottom: 2 }}>
                  {selectedNode.title}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.4 }}>
                  {contentPreview || (
                    <span style={{ fontStyle: "italic" }}>{t({ en: "No content", ja: "内容がありません" })}</span>
                  )}
                </div>
              </div>
            )}

            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 8, lineHeight: 1.4 }}>
              {t({
                en: "The selected node's title and content will initialize the new layer's Core node. The source node remains unchanged.",
                ja: "選択したノードのタイトルと内容で、新しいレイヤーのCoreノードを初期化します。ソースノードはそのまま残ります。",
              })}
            </div>
          </div>
        )}

        {error && <div style={errorStyle}>{error}</div>}

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            onClick={handleClose}
            disabled={creating}
            style={secondaryBtnStyle}
          >
            {t({ en: "Cancel", ja: "キャンセル" })}
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !canCreate}
            style={creating || !canCreate ? disabledBtnStyle : primaryBtnStyle}
          >
            {creating
              ? t({ en: "Creating...", ja: "作成中..." })
              : t({ en: "Create Layer", ja: "レイヤーを作成" })}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2000,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialogStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 24,
  width: 480,
  maxWidth: "90vw",
  maxHeight: "80vh",
  overflowY: "auto",
  boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  display: "flex",
  flexDirection: "column",
};

const radioOptionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  padding: "10px 12px",
  border: "1.5px solid #e5e7eb",
  borderRadius: 8,
  cursor: "pointer",
  transition: "border-color 0.15s, background 0.15s",
};

const nodeListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxHeight: 180,
  overflowY: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: 4,
};

const nodeItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  border: "1.5px solid #e5e7eb",
  borderRadius: 6,
  cursor: "pointer",
  background: "#fff",
  textAlign: "left",
  width: "100%",
  boxSizing: "border-box",
};

const previewBoxStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
};

const errorStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 12px",
  background: "#fef2f2",
  color: "#dc2626",
  borderRadius: 6,
  fontSize: 12,
};

const closeButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 24,
  cursor: "pointer",
  color: "#9ca3af",
  padding: "0 4px",
  lineHeight: 1,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "#1e40af",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "#f3f4f6",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const disabledBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  opacity: 0.5,
  cursor: "not-allowed",
};

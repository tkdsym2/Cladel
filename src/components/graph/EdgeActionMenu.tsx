import { useState, useCallback, useEffect } from "react";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { useGraphStore } from "../../store/graphStore";
import { useT } from "../../lib/i18n";

export function EdgeActionMenu({ onRequestDeleteEdge }: { onRequestDeleteEdge?: (edgeId: string) => void }) {
  const t = useT();
  const edgeActionMenu = useGraphStore((s) => s.edgeActionMenu);
  const closeEdgeActionMenu = useGraphStore((s) => s.closeEdgeActionMenu);
  const splitEdgeWithJunction = useGraphStore((s) => s.splitEdgeWithJunction);
  const getDbEdge = useGraphStore((s) => s.getDbEdge);
  const getDbNode = useGraphStore((s) => s.getDbNode);
  const updateEdgeData = useGraphStore((s) => s.updateEdgeData);
  const removeEdge = useGraphStore((s) => s.removeEdge);

  const [showProperties, setShowProperties] = useState(false);

  const edge = edgeActionMenu ? getDbEdge(edgeActionMenu.edgeId) : undefined;
  const sourceNode = edge ? getDbNode(edge.source_node_id) : undefined;
  const targetNode = edge ? getDbNode(edge.target_node_id) : undefined;

  const [weight, setWeight] = useState(edge?.weight ?? 3);

  // Reset local state when edge changes
  useEffect(() => {
    setShowProperties(false);
    if (edge) setWeight(edge.weight);
  }, [edge]);

  // Escape key closes the menu
  useEffect(() => {
    if (!edgeActionMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeEdgeActionMenu();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [edgeActionMenu, closeEdgeActionMenu]);

  const handleToggleProperties = useCallback(() => {
    setShowProperties((prev) => !prev);
  }, []);

  const handleSaveWeight = useCallback(async () => {
    if (!edgeActionMenu) return;
    await updateEdgeData({ id: edgeActionMenu.edgeId, weight });
  }, [edgeActionMenu, weight, updateEdgeData]);

  const handleDelete = useCallback(() => {
    if (!edgeActionMenu) return;
    if (onRequestDeleteEdge) {
      onRequestDeleteEdge(edgeActionMenu.edgeId);
      closeEdgeActionMenu();
    } else {
      removeEdge(edgeActionMenu.edgeId).then(() => closeEdgeActionMenu());
    }
  }, [edgeActionMenu, removeEdge, closeEdgeActionMenu, onRequestDeleteEdge]);

  const handleAddBranchPoint = useCallback(() => {
    if (!edgeActionMenu) return;
    splitEdgeWithJunction(edgeActionMenu.edgeId);
    closeEdgeActionMenu();
  }, [edgeActionMenu, splitEdgeWithJunction, closeEdgeActionMenu]);

  if (!edgeActionMenu || !edge) return null;

  const unknownLabel = t({ en: "Unknown", ja: "不明" });
  const sourceName = sourceNode?.title ?? unknownLabel;
  const targetName = targetNode?.title ?? unknownLabel;
  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 1) + "\u2026" : s;

  // Keep menu within viewport bounds
  const menuWidth = 220;
  const estimatedHeight = showProperties ? 280 : 190;
  const x = Math.min(edgeActionMenu.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(edgeActionMenu.y, window.innerHeight - estimatedHeight - 8);

  return (
    <div style={overlayStyle} onClick={closeEdgeActionMenu}>
      <div
        style={{ ...menuStyle, top: y, left: x }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Edge summary header */}
        <div style={headerStyle}>
          <span style={nodeNameStyle} title={sourceName}>
            {truncate(sourceName, 18)}
          </span>
          <ArrowForwardIcon sx={{ fontSize: 12, color: "#9ca3af", flexShrink: 0 }} />
          <span style={nodeNameStyle} title={targetName}>
            {truncate(targetName, 18)}
          </span>
        </div>

        <div style={separatorStyle} />

        {/* Action: Delete Connection */}
        <button
          onClick={handleDelete}
          style={actionBtnStyle}
          onMouseEnter={(e) =>
            Object.assign(e.currentTarget.style, { ...actionBtnStyle, background: "#fef2f2", color: "#dc2626" })
          }
          onMouseLeave={(e) =>
            Object.assign(e.currentTarget.style, actionBtnStyle)
          }
        >
          <DeleteOutlineIcon sx={{ fontSize: 14, mr: 1, flexShrink: 0, color: "inherit" }} />
          {t({ en: "Delete Connection", ja: "接続を削除" })}
        </button>

        {/* Action: Edge Properties (toggleable) */}
        <button
          onClick={handleToggleProperties}
          style={{
            ...actionBtnStyle,
            ...(showProperties ? { background: "#f3f4f6", fontWeight: 600 } : {}),
          }}
          onMouseEnter={(e) =>
            Object.assign(e.currentTarget.style, actionBtnHoverStyle)
          }
          onMouseLeave={(e) =>
            Object.assign(e.currentTarget.style, {
              ...actionBtnStyle,
              ...(showProperties ? { background: "#f3f4f6", fontWeight: 600 } : {}),
            })
          }
        >
          <InfoOutlinedIcon sx={{ fontSize: 14, mr: 1, flexShrink: 0, color: "#374151" }} />
          {t({ en: "Edge Properties", ja: "エッジのプロパティ" })}
          <ExpandMoreIcon sx={{
            fontSize: 14,
            ml: "auto",
            color: "#9ca3af",
            transform: showProperties ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }} />
        </button>

        {/* Expanded properties section */}
        {showProperties && (
          <div style={propertiesStyle}>
            {/* Weight slider */}
            <div style={{ marginBottom: 8 }}>
              <div style={propLabelStyle}>{t({ en: "Weight: {weight}", ja: "太さ: {weight}" }, { weight })}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "#9ca3af" }}>1</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={weight}
                  onChange={(e) => setWeight(Number(e.target.value))}
                  onMouseUp={handleSaveWeight}
                  onKeyUp={handleSaveWeight}
                  style={{ flex: 1, accentColor: "#1e40af" }}
                />
                <span style={{ fontSize: 10, color: "#9ca3af" }}>5</span>
              </div>
            </div>

            {/* Creation date */}
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              {t({ en: "Created: {date}", ja: "作成日: {date}" }, { date: formatDate(edge.created_at) })}
            </div>
          </div>
        )}

        {/* Action: Add Branch Point */}
        <button
          onClick={handleAddBranchPoint}
          style={actionBtnStyle}
          onMouseEnter={(e) =>
            Object.assign(e.currentTarget.style, actionBtnHoverStyle)
          }
          onMouseLeave={(e) =>
            Object.assign(e.currentTarget.style, actionBtnStyle)
          }
        >
          <FiberManualRecordIcon sx={{ fontSize: 14, mr: 1, flexShrink: 0, color: "#374151" }} />
          {t({ en: "Add Branch Point", ja: "分岐点を追加" })}
        </button>
      </div>
    </div>
  );
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return ts;
  }
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1200,
};

const menuStyle: React.CSSProperties = {
  position: "absolute",
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
  padding: "6px 0",
  width: 220,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 14px",
  fontSize: 11,
  color: "#6b7280",
};

const nodeNameStyle: React.CSSProperties = {
  fontWeight: 600,
  color: "#374151",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 80,
};

const separatorStyle: React.CSSProperties = {
  height: 1,
  background: "#e5e7eb",
  margin: "2px 0",
};

const actionBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "7px 14px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12,
  color: "#374151",
  textAlign: "left",
};

const actionBtnHoverStyle: React.CSSProperties = {
  ...actionBtnStyle,
  background: "#f3f4f6",
};

const propertiesStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderTop: "1px solid #f3f4f6",
  borderBottom: "1px solid #f3f4f6",
  background: "#fafafa",
};

const propLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 4,
};

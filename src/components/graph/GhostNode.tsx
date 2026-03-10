import { useCallback, type MouseEvent } from "react";
import { Handle, Position, NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { useGraphStore } from "../../store/graphStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import type { GhostData } from "../../types";

type GhostNodeData = {
  title: string;
  content: string | null;
  metadata: string | null;
  display_id?: string | null;
  [key: string]: unknown;
};

export function GhostNode({
  id,
  data,
  selected,
}: NodeProps<Node<GhostNodeData>>) {
  const acceptGhostNode = useGraphStore((s) => s.acceptGhostNode);
  const dismissGhostNode = useGraphStore((s) => s.dismissGhostNode);
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const displayId = (data.display_id as string) ?? null;
  const connectedRefs = useConnectedDisplayIds(id);

  let ghostData: GhostData | null = null;
  if (data.metadata) {
    try {
      ghostData = JSON.parse(data.metadata as string) as GhostData;
    } catch {
      /* ignore */
    }
  }

  const proposalType = ghostData?.proposal_type ?? "idea";
  const reason = ghostData?.reason;

  const handleAccept = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      acceptGhostNode(id);
    },
    [id, acceptGhostNode],
  );

  const handleDismiss = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      dismissGhostNode(id);
    },
    [id, dismissGhostNode],
  );

  const handleResizeEnd = useCallback(
    (_event: unknown, params: { x: number; y: number; width: number; height: number }) => {
      updateNodeSize(id, params.x, params.y, params.width, params.height);
    },
    [id, updateNodeSize],
  );

  return (
    <>
      <NodeResizer
        minWidth={200}
        minHeight={150}
        isVisible={selected}
        lineStyle={resizerLineStyle}
        handleStyle={resizerHandleStyle}
        onResizeEnd={handleResizeEnd}
      />
      <div
        style={{
          background: "rgba(124, 58, 237, 0.12)",
          border: selected ? "3px dashed #a78bfa" : "1px dashed #7c3aed",
          color: "#4c1d95",
          fontSize: "13px",
          minWidth: "200px",
          width: "100%",
          height: "100%",
          borderRadius: "8px",
          padding: "10px 14px",
          userSelect: "none",
          boxSizing: "border-box",
          overflow: "hidden",
          opacity: 0.85,
          display: "flex",
          flexDirection: "column",
          boxShadow: selected
            ? "0 0 0 3px rgba(167, 139, 250, 0.3)"
            : "0 1px 4px rgba(0,0,0,0.05)",
        }}
      >
        {displayId && <div style={displayIdLabelStyle}>{displayId}</div>}

        {/* AI suggested badge */}
        <div style={badgeRowStyle}>
          <span style={aiBadgeStyle}>AI suggested</span>
          <span style={typeBadgeStyle}>{proposalType}</span>
        </div>

        {/* Title */}
        <div style={{ fontWeight: 600, marginBottom: 3, lineHeight: 1.3, wordBreak: "break-word" }}>
          {data.title}
        </div>

        {/* Proposal body */}
        {proposalType === "paper" && ghostData && (
          <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: 4 }}>
            {ghostData.authors && ghostData.authors.length > 0 && (
              <div>
                {ghostData.authors.slice(0, 2).join(", ")}
                {ghostData.authors.length > 2 && " et al."}
                {ghostData.year != null && ` (${ghostData.year})`}
              </div>
            )}
          </div>
        )}

        {proposalType === "idea" && ghostData?.body && (
          <div style={ideaBodyStyle}>
            {ghostData.body.slice(0, 80)}
          </div>
        )}

        {/* Reason */}
        {reason && (
          <div style={reasonStyle}>
            {reason}
          </div>
        )}

        {/* Accept / Dismiss buttons */}
        <div style={buttonRowStyle}>
          <button
            onClick={handleAccept}
            style={acceptBtnStyle}
            title="Accept this suggestion"
          >
            <CheckIcon sx={{ fontSize: 14 }} />
          </button>
          <button
            onClick={handleDismiss}
            style={dismissBtnStyle}
            title="Dismiss this suggestion"
          >
            <CloseIcon sx={{ fontSize: 12 }} />
          </button>
        </div>

        {connectedRefs && <div style={connectedRefsStyle}>↔ {connectedRefs}</div>}

        <Handle type="source" position={Position.Right} id="right" style={handleStyle} />
        <Handle type="target" position={Position.Right} id="right-target" style={handleStyle} />
        <Handle type="source" position={Position.Left} id="left" style={handleStyle} />
        <Handle type="target" position={Position.Left} id="left-target" style={handleStyle} />
      </div>
    </>
  );
}

const handleStyle: React.CSSProperties = {
  width: 8,
  height: "40%",
  minHeight: 16,
  borderRadius: 4,
  background: "#7c3aed",
  border: "2px solid rgba(124, 58, 237, 0.15)",
};

const displayIdLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "monospace",
  color: "#a78bfa",
  lineHeight: 1,
  marginBottom: 2,
};

const badgeRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  marginBottom: 6,
};

const aiBadgeStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  padding: "1px 5px",
  borderRadius: 3,
  background: "#7c3aed",
  color: "#ffffff",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const typeBadgeStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  padding: "1px 5px",
  borderRadius: 3,
  background: "rgba(124, 58, 237, 0.15)",
  color: "#7c3aed",
  textTransform: "uppercase",
  letterSpacing: 0.3,
};

const ideaBodyStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "#6b7280",
  marginBottom: 4,
  overflow: "hidden",
  textOverflow: "ellipsis",
  wordBreak: "break-word",
};

const reasonStyle: React.CSSProperties = {
  fontSize: "10px",
  color: "#7c3aed",
  fontStyle: "italic",
  marginBottom: 6,
  lineHeight: 1.3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
};

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 6,
  marginTop: 4,
};

const connectedRefsStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: "monospace",
  color: "#a78bfa",
  borderTop: "1px solid rgba(124, 58, 237, 0.2)",
  marginTop: "auto",
  paddingTop: 3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const acceptBtnStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  border: "1.5px solid #059669",
  background: "rgba(5, 150, 105, 0.1)",
  color: "#059669",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  lineHeight: 1,
};

const dismissBtnStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  border: "1.5px solid #dc2626",
  background: "rgba(220, 38, 38, 0.1)",
  color: "#dc2626",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  lineHeight: 1,
};

const resizerLineStyle: React.CSSProperties = {
  borderColor: "rgba(124, 58, 237, 0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: "#7c3aed",
  border: "1px solid #6d28d9",
};

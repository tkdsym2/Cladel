import { useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import { useGraphStore } from "../../store/graphStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import { ProcessingIndicator } from "./ProcessingIndicator";

type CompareNodeData = {
  title: string;
  content: string | null;
  display_id?: string | null;
  commentCount?: number;
  [key: string]: unknown;
};

export function CompareNode({ id, data, selected }: NodeProps<Node<CompareNodeData>>) {
  const title = data.title;
  const displayId = (data.display_id as string) ?? null;
  const count = (data.commentCount as number) ?? 0;
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const connectedRefs = useConnectedDisplayIds(id);

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
          position: "relative",
          background: "rgba(2,132,199,0.08)",
          border: selected ? "3px solid #0284c7" : "1px solid #0284c7",
          color: "#1f2937",
          fontSize: "13px",
          minWidth: "200px",
          width: "100%",
          height: "100%",
          borderRadius: "8px",
          padding: "10px 14px",
          userSelect: "none",
          boxSizing: "border-box",
          overflow: "visible",
          display: "flex",
          flexDirection: "column",
          boxShadow: selected
            ? "0 0 0 3px rgba(2, 132, 199, 0.3)"
            : "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        <ProcessingIndicator nodeId={id} />
        {count > 0 && (
          <div style={badgeStyle}>
            {count}
          </div>
        )}

        <div style={headerStyle}>
          <CompareArrowsIcon sx={{ fontSize: 16, color: "#0284c7" }} />
          <span style={nameStyle}>{displayId ?? title}</span>
        </div>
        <div style={hintStyle}>
          Connect 2 Edit nodes
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
  background: "#0284c7",
  border: "2px solid rgba(2,132,199,0.15)",
};

const nameStyle: React.CSSProperties = {
  fontWeight: 600,
  fontFamily: "monospace",
  wordBreak: "break-word",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 4,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#0284c7",
  fontWeight: 500,
};

const badgeStyle: React.CSSProperties = {
  position: "absolute",
  top: -8,
  right: -8,
  minWidth: 18,
  height: 18,
  borderRadius: 9,
  background: "#2563eb",
  color: "#ffffff",
  fontSize: 10,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 4px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
  lineHeight: 1,
};

const connectedRefsStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: "monospace",
  color: "#9ca3af",
  borderTop: "1px solid rgba(0,0,0,0.08)",
  marginTop: "auto",
  paddingTop: 3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const resizerLineStyle: React.CSSProperties = {
  borderColor: "rgba(2,132,199,0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: "#0284c7",
  border: "1px solid #0369a1",
};

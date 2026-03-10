import { useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { useGraphStore } from "../../store/graphStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import { ProcessingIndicator } from "./ProcessingIndicator";

type ExportNodeData = {
  title: string;
  content: string | null;
  display_id?: string | null;
  commentCount?: number;
  metadata?: string | null;
  [key: string]: unknown;
};

export function ExportNode({ id, data, selected }: NodeProps<Node<ExportNodeData>>) {
  const title = data.title;
  const displayId = (data.display_id as string) ?? null;
  const count = (data.commentCount as number) ?? 0;
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const connectedRefs = useConnectedDisplayIds(id);

  // Parse section count from metadata
  let sectionCount = 0;
  try {
    const meta = data.metadata ? JSON.parse(data.metadata as string) : null;
    if (meta?.section_order) {
      sectionCount = meta.section_order.length;
    }
  } catch {
    // ignore
  }

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
          background: "rgba(225,29,72,0.08)",
          border: selected ? "3px solid #e11d48" : "1px solid #e11d48",
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
            ? "0 0 0 3px rgba(225, 29, 72, 0.3)"
            : "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        <ProcessingIndicator nodeId={id} />
        {count > 0 && (
          <div style={badgeStyle}>
            {count}
          </div>
        )}

        {displayId && <div style={displayIdLabelStyle}>{displayId}</div>}
        <div style={headerStyle}>
          <PictureAsPdfIcon sx={{ fontSize: 16, color: "#e11d48" }} />
          <span style={{ fontWeight: 600, wordBreak: "break-word" }}>{title}</span>
        </div>
        <div style={sectionCountStyle}>
          {sectionCount > 0 ? `${sectionCount} section${sectionCount !== 1 ? "s" : ""}` : "No sections"}
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
  background: "#e11d48",
  border: "2px solid rgba(225,29,72,0.15)",
};

const displayIdLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "monospace",
  color: "#9ca3af",
  lineHeight: 1,
  marginBottom: 2,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 4,
};

const sectionCountStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#e11d48",
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
  borderColor: "rgba(225,29,72,0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: "#e11d48",
  border: "1px solid #be123c",
};

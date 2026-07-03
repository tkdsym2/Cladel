import { useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import TitleIcon from "@mui/icons-material/Title";
import { useGraphStore } from "../../store/graphStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import type { ExportAuthor } from "../../types";

type TitleNodeData = {
  title: string;
  content: string | null;
  display_id?: string | null;
  metadata?: string | null;
  commentCount?: number;
  [key: string]: unknown;
};

export function TitleNode({ id, data, selected }: NodeProps<Node<TitleNodeData>>) {
  const title = data.title;
  const displayId = (data.display_id as string) ?? null;
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const connectedRefs = useConnectedDisplayIds(id);

  // Parse metadata for subtitle and authors
  let subtitle = "";
  let authorCount = 0;
  try {
    const meta = data.metadata ? JSON.parse(data.metadata as string) : null;
    if (meta?.subtitle) subtitle = meta.subtitle;
    if (meta?.authors) authorCount = (meta.authors as ExportAuthor[]).length;
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
          background: "rgba(120,113,108,0.08)",
          border: selected ? "3px solid #78716c" : "1px solid #78716c",
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
            ? "0 0 0 3px rgba(120, 113, 108, 0.3)"
            : "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        <div style={headerStyle}>
          <TitleIcon sx={{ fontSize: 16, color: "#78716c" }} />
          <span style={nameStyle}>{displayId ?? title}</span>
        </div>
        {displayId && title && (
          <div style={docTitleStyle}>
            {title.length > 60 ? title.slice(0, 60) + "..." : title}
          </div>
        )}
        {subtitle && (
          <div style={subtitleStyle}>
            {subtitle.length > 40 ? subtitle.slice(0, 40) + "..." : subtitle}
          </div>
        )}
        <div style={infoStyle}>
          {authorCount > 0
            ? `${authorCount} author${authorCount !== 1 ? "s" : ""}`
            : "No authors"}
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
  background: "#78716c",
  border: "2px solid rgba(120,113,108,0.15)",
};

const nameStyle: React.CSSProperties = {
  fontWeight: 600,
  fontFamily: "monospace",
  wordBreak: "break-word",
};

// Document title (export title page data) — shown as content under the id.
const docTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#44403c",
  lineHeight: 1.3,
  marginBottom: 2,
  wordBreak: "break-word",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 4,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
  fontStyle: "italic",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const infoStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#78716c",
  fontWeight: 500,
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
  borderColor: "rgba(120,113,108,0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: "#78716c",
  border: "1px solid #57534e",
};

import { useCallback } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { NodePorts } from "./NodePorts";
import LayersIcon from "@mui/icons-material/Layers";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import { useGraphStore } from "../../store/graphStore";
import { CreatorLabel } from "./CreatorLabel";
import type { PaperGroupMetadata } from "../../types";

type PaperGroupNodeData = {
  title: string;
  metadata: string | null;
  display_id?: string | null;
  creator_user_id?: string | null;
  creator_user_name?: string | null;
  [key: string]: unknown;
};

export function PaperGroupNode({ id, data, selected }: NodeProps<Node<PaperGroupNodeData>>) {
  const title = data.title;
  const displayId = (data.display_id as string) ?? null;
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const expandedGroupIds = useGraphStore((s) => s.expandedGroupIds);
  const collapseGroup = useGraphStore((s) => s.collapseGroup);

  const isExpanded = expandedGroupIds.has(id);

  let memberCount = 0;
  if (data.metadata) {
    try {
      const meta = JSON.parse(data.metadata as string) as PaperGroupMetadata;
      memberCount = meta.member_node_ids?.length ?? 0;
    } catch { /* ignore */ }
  }

  const handleResizeEnd = useCallback(
    (_event: unknown, params: { x: number; y: number; width: number; height: number }) => {
      updateNodeSize(id, params.x, params.y, params.width, params.height);
    },
    [id, updateNodeSize],
  );

  const handleCollapseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      collapseGroup(id);
    },
    [id, collapseGroup],
  );

  if (isExpanded) {
    return (
      <>
        <NodeResizer
          minWidth={300}
          minHeight={250}
          isVisible={selected}
          lineStyle={resizerLineStyle}
          handleStyle={resizerHandleStyle}
          onResizeEnd={handleResizeEnd}
        />
        <div style={{
          position: "relative",
          background: "rgba(5, 150, 105, 0.04)",
          border: selected ? "3px dashed #34d399" : "2px dashed #059669",
          color: "#1f2937",
          fontSize: "13px",
          width: "100%",
          height: "100%",
          borderRadius: "12px",
          padding: "10px 14px",
          userSelect: "none",
          boxSizing: "border-box",
          overflow: "visible",
          display: "flex",
          flexDirection: "column",
          boxShadow: selected
            ? "0 0 0 3px rgba(52, 211, 153, 0.3)"
            : "0 1px 4px rgba(0,0,0,0.05)",
        }}>
          <div style={expandedHeaderStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <LayersIcon sx={{ fontSize: 16, color: "#059669" }} />
              {displayId && <span style={displayIdLabelStyle}>{displayId}</span>}
              <span style={{ fontWeight: 600 }}>{title}</span>
              <span style={countBadgeStyle}>{memberCount}</span>
            </div>
            <button onClick={handleCollapseClick} style={collapseButtonStyle} title="Collapse group">
              <UnfoldLessIcon sx={{ fontSize: 14, color: "#059669" }} />
            </button>
          </div>

          <NodePorts accent="#059669" />
        </div>
      </>
    );
  }

  // Collapsed: rectangle shape
  return (
    <>
      <NodeResizer
        minWidth={110}
        minHeight={80}
        isVisible={selected}
        lineStyle={resizerLineStyle}
        handleStyle={resizerHandleStyle}
        onResizeEnd={handleResizeEnd}
      />
      <div style={{
        position: "relative",
        background: "rgba(5, 150, 105, 0.08)",
        border: selected ? "3px solid #34d399" : "2px solid #059669",
        color: "#1f2937",
        fontSize: "13px",
        width: "100%",
        height: "100%",
        borderRadius: "8px",
        userSelect: "none",
        boxSizing: "border-box",
        overflow: "visible",
        display: "flex",
        flexDirection: "column",
        boxShadow: selected
          ? "0 0 0 3px rgba(52, 211, 153, 0.3)"
          : "0 1px 4px rgba(0,0,0,0.08)",
      }}>
        {/* Display ID label in top-left corner */}
        {displayId && <div style={collapsedDisplayIdStyle}>{displayId}</div>}

        {/* Centered content */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          padding: "4px 8px",
        }}>
          <LayersIcon sx={{ fontSize: 18, color: "#059669" }} />
          <div style={{
            fontWeight: 600,
            fontSize: 12,
            textAlign: "center",
            maxWidth: "90%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {title}
          </div>
          <span style={countBadgeStyle}>{memberCount}</span>
        </div>
        <CreatorLabel nodeId={id} creatorUserId={data.creator_user_id} creatorUserName={data.creator_user_name} />

        <NodePorts accent="#059669" />
      </div>
    </>
  );
}

const displayIdLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "monospace",
  color: "#9ca3af",
  lineHeight: 1,
};

const collapsedDisplayIdStyle: React.CSSProperties = {
  position: "absolute",
  top: 4,
  left: 8,
  fontSize: 9,
  fontFamily: "monospace",
  color: "#059669",
  lineHeight: 1,
  opacity: 0.7,
};

const countBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "#059669",
  background: "rgba(5, 150, 105, 0.15)",
  borderRadius: 8,
  padding: "1px 6px",
  lineHeight: "16px",
};

const expandedHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
};

const collapseButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  border: "1px solid #059669",
  borderRadius: 4,
  background: "rgba(5,150,105,0.1)",
  cursor: "pointer",
  padding: 0,
};

const resizerLineStyle: React.CSSProperties = {
  borderColor: "rgba(5,150,105,0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: "#059669",
  border: "1px solid #047857",
};

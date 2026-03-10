import { useState, useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import { useGraphStore } from "../../store/graphStore";

type DeletedNodeData = {
  metadata: string | null;
  [key: string]: unknown;
};

export function DeletedNode({ id, data, selected }: NodeProps<Node<DeletedNodeData>>) {
  const [hovered, setHovered] = useState(false);
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);

  let originalTitle = "Unknown";
  if (data.metadata) {
    try {
      const meta = JSON.parse(data.metadata as string);
      if (meta.original_title) originalTitle = meta.original_title;
    } catch {
      /* ignore */
    }
  }

  const isHighlighted = selected || hovered;

  const handleResizeEnd = useCallback(
    (_event: unknown, params: { x: number; y: number; width: number; height: number }) => {
      updateNodeSize(id, params.x, params.y, params.width, params.height);
    },
    [id, updateNodeSize],
  );

  return (
    <>
      <NodeResizer
        minWidth={24}
        minHeight={24}
        isVisible={selected}
        lineStyle={resizerLineStyle}
        handleStyle={resizerHandleStyle}
        onResizeEnd={handleResizeEnd}
      />
      <div
        style={{
          ...containerStyle,
          width: "100%",
          height: "100%",
          opacity: isHighlighted ? 0.8 : 0.5,
          borderWidth: selected ? 3 : 1,
          borderColor: selected ? "#3b82f6" : "#d1d5db",
          boxShadow: selected ? "0 0 0 3px rgba(59,130,246,0.3)" : "none",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={iconStyle}>
          <DeleteOutlineIcon sx={{ fontSize: 14, color: selected ? "#3b82f6" : "#9ca3af" }} />
        </div>

        {selected && <DeleteButton nodeId={id} />}

        {hovered && !selected && (
          <div style={tooltipStyle}>
            Deleted: {originalTitle}
          </div>
        )}

        <Handle type="source" position={Position.Right} id="right" style={handleStyle} />
        <Handle type="target" position={Position.Right} id="right-target" style={handleStyle} />
        <Handle type="source" position={Position.Left} id="left" style={handleStyle} />
        <Handle type="target" position={Position.Left} id="left-target" style={handleStyle} />
      </div>
    </>
  );
}

/** Small X button that appears at top-right when the placeholder is selected. */
function DeleteButton({ nodeId }: { nodeId: string }) {
  const requestDeleteNode = useGraphStore((s) => s.requestDeleteNode);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      requestDeleteNode(nodeId);
    },
    [requestDeleteNode, nodeId],
  );

  return (
    <div
      onClick={handleClick}
      title="Remove placeholder"
      style={xButtonStyle}
    >
      <CloseIcon sx={{ fontSize: 10, color: "#fff" }} />
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 24,
  minHeight: 24,
  borderRadius: "50%",
  border: "1px dashed #d1d5db",
  background: "rgba(229, 231, 235, 0.3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: 0.5,
  userSelect: "none",
  cursor: "pointer",
  boxSizing: "border-box",
};

const iconStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const handleStyle: React.CSSProperties = {
  width: 6,
  height: "40%",
  minHeight: 10,
  borderRadius: 3,
  background: "#d1d5db",
  border: "1px solid #e5e7eb",
};

const xButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: -6,
  right: -6,
  width: 16,
  height: 16,
  borderRadius: 8,
  background: "#6b7280",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  zIndex: 10,
  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
};

const tooltipStyle: React.CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 6px)",
  left: "50%",
  transform: "translateX(-50%)",
  whiteSpace: "nowrap",
  fontSize: 11,
  color: "#4b5563",
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 4,
  padding: "3px 8px",
  boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
  pointerEvents: "none",
  zIndex: 10,
};

const resizerLineStyle: React.CSSProperties = {
  borderColor: "rgba(156, 163, 175, 0.5)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 2,
  backgroundColor: "#9ca3af",
  border: "1px solid #6b7280",
};

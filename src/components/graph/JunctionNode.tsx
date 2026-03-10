import { useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { useGraphStore } from "../../store/graphStore";

type JunctionNodeData = {
  [key: string]: unknown;
};

export function JunctionNode({ id, selected }: NodeProps<Node<JunctionNodeData>>) {
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);

  const handleResizeEnd = useCallback(
    (_event: unknown, params: { x: number; y: number; width: number; height: number }) => {
      updateNodeSize(id, params.x, params.y, params.width, params.height);
    },
    [id, updateNodeSize],
  );

  return (
    <>
      <NodeResizer
        minWidth={16}
        minHeight={16}
        isVisible={selected}
        lineStyle={resizerLineStyle}
        handleStyle={resizerHandleStyle}
        keepAspectRatio
        onResizeEnd={handleResizeEnd}
      />
      <div style={{ ...containerStyle, width: "100%", height: "100%" }}>
        <Handle type="source" position={Position.Left} id="left" style={handleStyle} />
        <Handle type="target" position={Position.Left} id="left-target" style={handleStyle} />
        <div style={dotStyle} />
        <Handle type="source" position={Position.Right} id="right" style={handleStyle} />
        <Handle type="target" position={Position.Right} id="right-target" style={handleStyle} />
      </div>
    </>
  );
}

const containerStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 16,
  minHeight: 16,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "grab",
  boxSizing: "border-box",
};

const dotStyle: React.CSSProperties = {
  width: "60%",
  height: "60%",
  borderRadius: "50%",
  background: "#4b5563",
  border: "2px solid #374151",
};

const handleStyle: React.CSSProperties = {
  width: 6,
  height: "40%",
  minHeight: 8,
  borderRadius: 3,
  background: "#6b7280",
  border: "1px solid #9ca3af",
};

const resizerLineStyle: React.CSSProperties = {
  borderColor: "rgba(107, 114, 128, 0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 2,
  backgroundColor: "#6b7280",
  border: "1px solid #4b5563",
};

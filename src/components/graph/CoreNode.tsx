import { useCallback } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { NodePorts } from "./NodePorts";
import { useGraphStore } from "../../store/graphStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { CreatorLabel } from "./CreatorLabel";

type CoreNodeData = {
  title: string;
  content: string | null;
  display_id?: string | null;
  creator_user_id?: string | null;
  creator_user_name?: string | null;
  [key: string]: unknown;
};

export function CoreNode({ id, data, selected }: NodeProps<Node<CoreNodeData>>) {
  const title = data.title;
  const content = data.content;
  const displayId = (data.display_id as string) ?? null;
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
      <div style={containerStyle(selected)}>
        <ProcessingIndicator nodeId={id} />
        <div style={nameStyle}>{displayId ?? title}</div>
        {content && (
          <div style={contentStyle}>
            {content.slice(0, 120)}
          </div>
        )}
        {connectedRefs && <div style={connectedRefsStyle}>↔ {connectedRefs}</div>}
        <CreatorLabel nodeId={id} creatorUserId={data.creator_user_id} creatorUserName={data.creator_user_name} dark />
        <NodePorts accent="#60a5fa" />
      </div>
    </>
  );
}

function containerStyle(selected: boolean | undefined): React.CSSProperties {
  return {
    position: "relative",
    background: "#1e3a5f",
    border: selected ? "4px solid #60a5fa" : "2px solid #1e40af",
    color: "#ffffff",
    fontSize: "16px",
    minWidth: "200px",
    width: "100%",
    height: "100%",
    borderRadius: "12px",
    padding: "16px 20px",
    userSelect: "none",
    boxSizing: "border-box",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    boxShadow: selected
      ? "0 0 0 3px rgba(96, 165, 250, 0.3)"
      : "0 2px 8px rgba(0,0,0,0.2)",
  };
}

const nameStyle: React.CSSProperties = {
  fontWeight: 700,
  fontFamily: "monospace",
  marginBottom: 4,
  wordBreak: "break-word",
};

const contentStyle: React.CSSProperties = {
  fontSize: "12px",
  opacity: 0.8,
  overflow: "hidden",
  textOverflow: "ellipsis",
  wordBreak: "break-word",
};

const connectedRefsStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: "monospace",
  color: "rgba(255,255,255,0.4)",
  borderTop: "1px solid rgba(255,255,255,0.15)",
  marginTop: "auto",
  paddingTop: 4,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const resizerLineStyle: React.CSSProperties = {
  borderColor: "rgba(96, 165, 250, 0.5)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: "#60a5fa",
  border: "1px solid #1e40af",
};

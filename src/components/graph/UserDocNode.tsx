import { useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import ReactMarkdown from "react-markdown";
import { useGraphStore } from "../../store/graphStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { CreatorLabel } from "./CreatorLabel";
import { getUserColor } from "../../lib/userColors";

type UserDocNodeData = {
  title: string;
  content: string | null;
  display_id?: string | null;
  commentCount?: number;
  creator_user_id?: string | null;
  creator_user_name?: string | null;
  [key: string]: unknown;
};

export function UserDocNode({ id, data, selected }: NodeProps<Node<UserDocNodeData>>) {
  const title = data.title;
  const content = data.content;
  const displayId = (data.display_id as string) ?? null;
  const count = (data.commentCount as number) ?? 0;
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const colorMode = useGraphStore((s) => s.colorMode);
  const connectedRefs = useConnectedDisplayIds(id);

  const userColor = colorMode === 'user' ? getUserColor(data.creator_user_id ?? null) : null;

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
          background: userColor ? userColor.bg : "#fffbeb",
          border: selected
            ? `3px solid ${userColor ? userColor.glow : "#fbbf24"}`
            : `1px solid ${userColor ? userColor.border : "#d97706"}`,
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
            ? `0 0 0 3px ${userColor ? userColor.glow + '4d' : "rgba(251, 191, 36, 0.3)"}`
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
        <div style={{ fontWeight: 600, marginBottom: 2, wordBreak: "break-word" }}>{title}</div>
        {content && (
          <div style={contentStyle}>
            <ReactMarkdown
              allowedElements={["p", "h1", "h2", "h3", "strong", "em", "del", "code", "ul", "ol", "li", "br"]}
              unwrapDisallowed
              components={{
                p: ({ children }) => <span>{children} </span>,
                h1: ({ children }) => <span style={{ fontWeight: 700, fontSize: "1.1em" }}>{children} </span>,
                h2: ({ children }) => <span style={{ fontWeight: 700, fontSize: "1.05em" }}>{children} </span>,
                h3: ({ children }) => <span style={{ fontWeight: 600 }}>{children} </span>,
              }}
            >
              {content.length > 120 ? content.slice(0, 120) + "..." : content}
            </ReactMarkdown>
          </div>
        )}
        {connectedRefs && <div style={connectedRefsStyle}>↔ {connectedRefs}</div>}
        <CreatorLabel nodeId={id} creatorUserId={data.creator_user_id} creatorUserName={data.creator_user_name} />
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
  background: "#d97706",
  border: "2px solid #fffbeb",
};

const displayIdLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "monospace",
  color: "#9ca3af",
  lineHeight: 1,
  marginBottom: 2,
};

const contentStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#92400e",
  overflow: "hidden",
  textOverflow: "ellipsis",
  wordBreak: "break-word",
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
  borderColor: "rgba(217, 119, 6, 0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: "#d97706",
  border: "1px solid #b45309",
};

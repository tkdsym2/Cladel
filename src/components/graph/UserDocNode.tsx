import { useCallback } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { NodePorts } from "./NodePorts";
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

        <div style={nameStyle}>{displayId ?? title}</div>
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
        <NodePorts accent={userColor ? userColor.border : "#d97706"} />
      </div>
    </>
  );
}

const nameStyle: React.CSSProperties = {
  fontWeight: 600,
  fontFamily: "monospace",
  marginBottom: 2,
  wordBreak: "break-word",
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
  top: -12,
  right: -12,
  minWidth: 30,
  height: 30,
  borderRadius: 15,
  background: "#2563eb",
  color: "#ffffff",
  fontSize: 15,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 8px",
  boxShadow: "0 1px 5px rgba(0,0,0,0.3)",
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

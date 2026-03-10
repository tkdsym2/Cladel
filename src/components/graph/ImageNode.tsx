import { useState, useEffect, useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import BrokenImageIcon from "@mui/icons-material/BrokenImage";
import { useGraphStore } from "../../store/graphStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { CreatorLabel } from "./CreatorLabel";
import { getUserColor } from "../../lib/userColors";
import * as cmd from "../../lib/tauri-commands";

type ImageNodeData = {
  title: string;
  metadata: string | null;
  display_id?: string | null;
  commentCount?: number;
  creator_user_id?: string | null;
  creator_user_name?: string | null;
  [key: string]: unknown;
};

export function ImageNode({ id, data, selected }: NodeProps<Node<ImageNodeData>>) {
  const title = data.title;
  const displayId = (data.display_id as string) ?? null;
  const count = (data.commentCount as number) ?? 0;
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const colorMode = useGraphStore((s) => s.colorMode);
  const connectedRefs = useConnectedDisplayIds(id);

  const userColor = colorMode === 'user' ? getUserColor(data.creator_user_id ?? null) : null;

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [fileExists, setFileExists] = useState(true);
  const [loading, setLoading] = useState(true);

  // Extract file_path from metadata
  let filePath: string | null = null;
  if (data.metadata) {
    try {
      const meta = JSON.parse(data.metadata as string);
      filePath = meta.file_path ?? null;
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!filePath) {
      setFileExists(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const exists = await cmd.checkFileExists(filePath!);
        if (cancelled) return;
        if (exists) {
          setFileExists(true);
          setImageSrc(convertFileSrc(filePath!));
        } else {
          setFileExists(false);
          setImageSrc(null);
        }
      } catch {
        if (!cancelled) {
          setFileExists(false);
          setImageSrc(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath]);

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
          background: userColor ? userColor.bg : (fileExists ? "#f0fdfa" : "#fef2f2"),
          border: selected
            ? `3px solid ${userColor ? userColor.glow : "#06b6d4"}`
            : userColor
              ? `1px solid ${userColor.border}`
              : fileExists
                ? "1px solid #0891b2"
                : "1px solid #dc2626",
          color: "#1f2937",
          fontSize: "13px",
          minWidth: "200px",
          width: "100%",
          height: "100%",
          borderRadius: "8px",
          padding: "6px",
          userSelect: "none",
          boxSizing: "border-box",
          overflow: "visible",
          display: "flex",
          flexDirection: "column",
          boxShadow: selected
            ? `0 0 0 3px ${userColor ? userColor.glow + '4d' : "rgba(6, 182, 212, 0.3)"}`
            : "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        <ProcessingIndicator nodeId={id} />
        {/* Comment count badge */}
        {count > 0 && <div style={badgeStyle}>{count}</div>}

        {displayId && <div style={displayIdLabelStyle}>{displayId}</div>}

        {/* Image area */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderRadius: 4,
            minHeight: 0,
          }}
        >
          {loading ? (
            <div style={{ fontSize: 11, color: "#9ca3af" }}>Loading...</div>
          ) : fileExists && imageSrc ? (
            <img
              src={imageSrc}
              alt={title}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: 4,
              }}
              draggable={false}
            />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                color: "#dc2626",
              }}
            >
              <BrokenImageIcon sx={{ fontSize: 28 }} />
              <div style={{ fontSize: 10 }}>Image not found</div>
            </div>
          )}
        </div>

        {/* Title */}
        <div
          style={{
            fontWeight: 600,
            fontSize: 12,
            marginTop: 4,
            lineHeight: 1.3,
            wordBreak: "break-word",
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {title}
        </div>

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
  background: "#0891b2",
  border: "2px solid #f0fdfa",
};

const displayIdLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "monospace",
  color: "#9ca3af",
  lineHeight: 1,
  marginBottom: 2,
  textAlign: "center",
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
  zIndex: 1,
};

const connectedRefsStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: "monospace",
  color: "#9ca3af",
  borderTop: "1px solid rgba(0,0,0,0.08)",
  marginTop: 4,
  paddingTop: 3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "center",
  flexShrink: 0,
};

const resizerLineStyle: React.CSSProperties = {
  borderColor: "rgba(8, 145, 178, 0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: "#0891b2",
  border: "1px solid #0e7490",
};

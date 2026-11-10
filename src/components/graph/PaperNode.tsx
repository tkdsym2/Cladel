import { useState, useEffect, useCallback } from "react";
import { NodeResizer, useStore, type NodeProps, type Node } from "@xyflow/react";
import { NodePorts } from "./NodePorts";
import WarningIcon from "@mui/icons-material/Warning";
import { useGraphStore } from "../../store/graphStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import { ProcessingIndicator } from "./ProcessingIndicator";
import { CreatorLabel } from "./CreatorLabel";
import { getUserColor } from "../../lib/userColors";
import * as cmd from "../../lib/tauri-commands";

type PaperNodeData = {
  title: string;
  metadata: string | null;
  pdf_path?: string | null;
  display_id?: string | null;
  commentCount?: number;
  creator_user_id?: string | null;
  creator_user_name?: string | null;
  [key: string]: unknown;
};

export function PaperNode({ id, data, selected }: NodeProps<Node<PaperNodeData>>) {
  const title = data.title;
  const displayId = (data.display_id as string) ?? null;
  let meta: { authors?: string[]; year?: string; journal?: string } = {};
  if (data.metadata) {
    try {
      meta = JSON.parse(data.metadata);
    } catch {
      /* ignore */
    }
  }

  const pdfPath = (data.pdf_path as string) ?? null;
  const count = (data.commentCount as number) ?? 0;
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const colorMode = useGraphStore((s) => s.colorMode);
  const connectedRefs = useConnectedDisplayIds(id);
  const parentId = useStore((s) => s.nodeLookup.get(id)?.parentId);
  const expandedGroupIds = useGraphStore((s) => s.expandedGroupIds);
  const isCollapsedChild = !!parentId && !expandedGroupIds.has(parentId);

  const userColor = colorMode === 'user' ? getUserColor(data.creator_user_id ?? null) : null;

  // Check if PDF file exists (lightweight, only on mount / data change)
  const [pdfBroken, setPdfBroken] = useState(false);
  useEffect(() => {
    if (!pdfPath) {
      setPdfBroken(false);
      return;
    }
    let cancelled = false;
    cmd.checkFileExists(pdfPath).then((exists) => {
      if (!cancelled) setPdfBroken(!exists);
    }).catch(() => {
      if (!cancelled) setPdfBroken(true);
    });
    return () => { cancelled = true; };
  }, [pdfPath]);

  const handleResizeEnd = useCallback(
    (_event: unknown, params: { x: number; y: number; width: number; height: number }) => {
      updateNodeSize(id, params.x, params.y, params.width, params.height);
    },
    [id, updateNodeSize],
  );

  // Compact mode: inside a collapsed paper group
  if (isCollapsedChild) {
    return (
      <div style={compactStyle}>
        <div style={compactIdStyle}>{displayId ?? title}</div>
        <NodePorts accent="#059669" compact />
      </div>
    );
  }

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
          background: userColor ? userColor.bg : "#f0fdf4",
          border: selected
            ? `3px solid ${userColor ? userColor.glow : "#34d399"}`
            : `1px solid ${userColor ? userColor.border : "#059669"}`,
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
            ? `0 0 0 3px ${userColor ? userColor.glow + '4d' : "rgba(52, 211, 153, 0.3)"}`
            : "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        <ProcessingIndicator nodeId={id} />
        {/* Comment count badge */}
        {count > 0 && (
          <div style={badgeStyle}>
            {count}
          </div>
        )}

        <div style={nameStyle}>{displayId ?? title}</div>
        {displayId && title && (
          <div style={paperTitleStyle}>
            {title}
          </div>
        )}
        {meta.authors && meta.authors.length > 0 && (
          <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: 1 }}>
            {meta.authors.slice(0, 2).join(", ")}
            {meta.authors.length > 2 && " et al."}
          </div>
        )}
        {(meta.year || meta.journal) && (
          <div style={{ fontSize: "11px", color: "#9ca3af" }}>
            {[meta.year, meta.journal].filter(Boolean).join(" · ")}
          </div>
        )}
        {/* PDF broken path warning */}
        {pdfBroken && (
          <div style={pdfWarningStyle} title="PDF file not found">
            <WarningIcon sx={{ fontSize: 14, color: "#d97706" }} />
          </div>
        )}
        {connectedRefs && <div style={connectedRefsStyle}>↔ {connectedRefs}</div>}
        <CreatorLabel nodeId={id} creatorUserId={data.creator_user_id} creatorUserName={data.creator_user_name} />
        <NodePorts accent={userColor ? userColor.border : "#059669"} />
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

// Bibliographic paper title (from BibTeX) — shown as metadata under the id.
const paperTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#374151",
  lineHeight: 1.3,
  marginBottom: 2,
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

const pdfWarningStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 4,
  left: 4,
  lineHeight: 1,
  opacity: 0.85,
};

const compactStyle: React.CSSProperties = {
  background: "#f0fdf4",
  border: "1px solid #059669",
  borderRadius: 4,
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  overflow: "hidden",
  userSelect: "none",
};

const compactIdStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  fontFamily: "monospace",
  color: "#065f46",
  textAlign: "center",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  padding: "0 4px",
  maxWidth: "100%",
};

const resizerLineStyle: React.CSSProperties = {
  borderColor: "rgba(5, 150, 105, 0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: "#059669",
  border: "1px solid #047857",
};

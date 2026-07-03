import { useCallback } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import { NodePorts } from "./NodePorts";
import PreviewIcon from "@mui/icons-material/Preview";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useGraphStore } from "../../store/graphStore";
import { useRenderStore, EMPTY_RENDER_STATE, type RenderStatus } from "../../store/renderStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import { useT, type Entry } from "../../lib/i18n";

const ACCENT = "#9333ea";

type RenderNodeData = {
  title: string;
  display_id?: string | null;
  [key: string]: unknown;
};

const STATUS_LABEL: Record<RenderStatus, Entry> = {
  idle: { en: "Not rendered", ja: "未レンダー" },
  rendering: { en: "Rendering…", ja: "レンダー中…" },
  ok: { en: "Ready", ja: "完了" },
  error: { en: "Error", ja: "エラー" },
};

export function RenderNode({ id, data, selected }: NodeProps<Node<RenderNodeData>>) {
  const title = data.title;
  const displayId = (data.display_id as string) ?? null;
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const render = useRenderStore((s) => s.byNode[id]) ?? EMPTY_RENDER_STATE;
  const connectedRefs = useConnectedDisplayIds(id);
  const t = useT();

  const handleResizeEnd = useCallback(
    (_event: unknown, params: { x: number; y: number; width: number; height: number }) => {
      updateNodeSize(id, params.x, params.y, params.width, params.height);
    },
    [id, updateNodeSize],
  );

  const firstPage = render.pages[0];

  return (
    <>
      <NodeResizer
        minWidth={200}
        minHeight={160}
        isVisible={selected}
        lineStyle={resizerLineStyle}
        handleStyle={resizerHandleStyle}
        onResizeEnd={handleResizeEnd}
      />
      <div
        style={{
          position: "relative",
          background: "rgba(147,51,234,0.08)",
          border: selected ? `3px solid ${ACCENT}` : `1px solid ${ACCENT}`,
          color: "#1f2937",
          fontSize: "13px",
          minWidth: "200px",
          width: "100%",
          height: "100%",
          borderRadius: "8px",
          padding: "10px 14px",
          userSelect: "none",
          boxSizing: "border-box",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: selected
            ? "0 0 0 3px rgba(147,51,234,0.3)"
            : "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        <div style={headerStyle}>
          <PreviewIcon sx={{ fontSize: 16, color: ACCENT }} />
          <span style={nameStyle}>{displayId ?? title}</span>
          <span style={badgeStyle}>{t(STATUS_LABEL[render.status])}</span>
        </div>

        <div style={previewWrapStyle}>
          {firstPage ? (
            <img src={convertFileSrc(firstPage)} alt="preview" style={thumbStyle} />
          ) : (
            <div
              style={{
                ...hintStyle,
                color: render.status === "error" ? "#dc2626" : "#6b7280",
              }}
            >
              {render.status === "error"
                ? render.error ?? t({ en: "Render failed", ja: "レンダー失敗" })
                : render.status === "rendering"
                  ? t({ en: "Rendering preview…", ja: "プレビュー生成中…" })
                  : t({
                      en: "Connect Note nodes and open this node to render a PDF preview.",
                      ja: "ノートを接続し、このノードを開くとPDFプレビューを生成します。",
                    })}
            </div>
          )}
        </div>

        {render.pageCount > 0 && (
          <div style={infoStyle}>
            {render.pageCount} {render.pageCount === 1 ? t({ en: "page", ja: "ページ" }) : t({ en: "pages", ja: "ページ" })}
          </div>
        )}
        {connectedRefs && <div style={connectedRefsStyle}>↔ {connectedRefs}</div>}

        <NodePorts accent={ACCENT} />
      </div>
    </>
  );
}

const nameStyle: React.CSSProperties = {
  fontWeight: 600,
  fontFamily: "monospace",
  wordBreak: "break-word",
  flex: 1,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 4,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  color: ACCENT,
  background: "rgba(147,51,234,0.12)",
  borderRadius: 4,
  padding: "1px 5px",
  whiteSpace: "nowrap",
};

const previewWrapStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  marginBottom: 4,
  background: "#fff",
  borderRadius: 4,
  border: "1px solid rgba(147,51,234,0.18)",
};

const thumbStyle: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
  objectFit: "contain",
  display: "block",
};

const infoStyle: React.CSSProperties = {
  fontSize: 11,
  color: ACCENT,
  fontWeight: 500,
};

const hintStyle: React.CSSProperties = {
  padding: "0 6px",
  textAlign: "center",
  fontSize: 11,
  lineHeight: 1.4,
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
  borderColor: "rgba(147,51,234,0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: ACCENT,
  border: "1px solid #6b21a8",
};

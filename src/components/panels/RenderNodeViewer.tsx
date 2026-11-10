import { useCallback, useEffect } from "react";
import RefreshIcon from "@mui/icons-material/Refresh";
import PreviewIcon from "@mui/icons-material/Preview";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { NodeData } from "../../types";
import { useRenderStore, EMPTY_RENDER_STATE } from "../../store/renderStore";
import { renderTypstPreview } from "../../lib/tauri-commands";
import { useT } from "../../lib/i18n";

const ACCENT = "#9333ea";

interface RenderNodeViewerProps {
  node: NodeData;
}

export function RenderNodeViewer({ node }: RenderNodeViewerProps) {
  const t = useT();
  const render = useRenderStore((s) => s.byNode[node.id]) ?? EMPTY_RENDER_STATE;
  const update = useRenderStore((s) => s.update);

  const doRender = useCallback(async () => {
    update(node.id, { status: "rendering", error: null });
    try {
      const res = await renderTypstPreview(node.id);
      update(node.id, {
        status: "ok",
        pages: res.pages,
        pageCount: res.page_count,
        error: null,
        renderedAt: Date.now(),
      });
    } catch (e) {
      update(node.id, { status: "error", error: String(e), pages: [], pageCount: 0 });
    }
  }, [node.id, update]);

  // Render a fresh preview whenever this node is opened.
  useEffect(() => {
    void doRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const isRendering = render.status === "rendering";
  const cacheBust = render.renderedAt ?? 0;

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <PreviewIcon sx={{ fontSize: 18, color: ACCENT }} />
        <span style={{ fontWeight: 600, fontFamily: "monospace", flex: 1 }}>
          {node.display_id ?? node.title}
        </span>
      </div>

      <div style={toolbarStyle}>
        <button onClick={() => void doRender()} disabled={isRendering} style={renderButtonStyle}>
          <RefreshIcon sx={{ fontSize: 16, ...(isRendering ? spinSx : {}) }} />
          {isRendering
            ? t({ en: "Rendering…", ja: "レンダー中…" })
            : t({ en: "Re-render preview", ja: "プレビュー再生成" })}
        </button>
        <span style={infoTextStyle}>
          {render.pageCount > 0
            ? t(
                { en: "{n} page(s)", ja: "{n} ページ" },
                { n: render.pageCount },
              )
            : ""}
        </span>
      </div>

      {render.status === "error" ? (
        <div style={errorBoxStyle}>
          <div style={errorHeaderStyle}>
            <ErrorOutlineIcon sx={{ fontSize: 16 }} />
            {t({ en: "Typst compile error", ja: "Typst コンパイルエラー" })}
          </div>
          <pre style={errorTextStyle}>{render.error}</pre>
        </div>
      ) : render.pages.length > 0 ? (
        <div style={pagesWrapStyle}>
          {render.pages.map((p, i) => (
            <img
              key={p}
              src={`${convertFileSrc(p)}?v=${cacheBust}`}
              alt={`page ${i + 1}`}
              style={pageImageStyle}
            />
          ))}
        </div>
      ) : (
        <div style={emptyStyle}>
          {isRendering
            ? t({ en: "Rendering preview…", ja: "プレビューを生成中…" })
            : t({
                en: "No connected Note nodes. Connect Note (Typst) nodes to this render node to preview them.",
                ja: "接続されたノートがありません。ノート(Typst)をこのレンダーノードに接続するとプレビューできます。",
              })}
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 14px 8px",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 14px 10px",
  borderBottom: "1px solid #eee",
};

const renderButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: ACCENT,
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const infoTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
};

const pagesWrapStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 14,
  background: "#f3f4f6",
};

const pageImageStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 600,
  boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
  background: "#fff",
};

const errorBoxStyle: React.CSSProperties = {
  margin: 14,
  border: "1px solid #fecaca",
  borderRadius: 8,
  background: "#fef2f2",
  overflow: "hidden",
};

const errorHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
  background: "#fee2e2",
  color: "#b91c1c",
  fontWeight: 600,
  fontSize: 13,
};

const errorTextStyle: React.CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  fontSize: 12,
  fontFamily: "monospace",
  color: "#7f1d1d",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 280,
  overflowY: "auto",
};

const emptyStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: 24,
  color: "#6b7280",
  fontSize: 13,
  lineHeight: 1.5,
};

const spinSx = {
  animation: "spin 1s linear infinite",
  "@keyframes spin": { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
} as const;

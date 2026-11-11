import { useCallback, useEffect, useMemo, useRef } from "react";
import { NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import TranslateIcon from "@mui/icons-material/Translate";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import DownloadIcon from "@mui/icons-material/Download";
import { NodePorts } from "./NodePorts";
import { useGraphStore } from "../../store/graphStore";
import { useTranslateStore, EMPTY_TRANSLATE_STATE, type TranslateStatus } from "../../store/translateStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import { useT, type Entry } from "../../lib/i18n";
import { langBadge } from "../../lib/translateLangs";
import { cancelTranslate, openTranslationSettings, parseTranslateModel, runTranslate } from "../../lib/translateRunner";
import { syncCounts, useSyncPlan } from "../../lib/translateSync";
import { countsLabel } from "../panels/TranslateSyncSection";

export const TRANSLATE_ACCENT = "#ea580c";
const BG = "#ffedd5";

type TranslateNodeData = {
  title: string;
  display_id?: string | null;
  metadata?: string | null;
  [key: string]: unknown;
};

const STATUS_LABEL: Record<TranslateStatus, Entry> = {
  idle: { en: "Ready", ja: "待機" },
  loading: { en: "Loading model…", ja: "モデル読込中…" },
  translating: { en: "Translating…", ja: "翻訳中…" },
  done: { en: "Done", ja: "完了" },
  cancelled: { en: "Stopped", ja: "中止" },
  error: { en: "Error", ja: "エラー" },
};

export function TranslateNode({ id, data, selected }: NodeProps<Node<TranslateNodeData>>) {
  const t = useT();
  const displayId = (data.display_id as string) ?? null;
  const model = useMemo(() => parseTranslateModel(data.metadata as string | null), [data.metadata]);
  const run = useTranslateStore((s) => s.byNode[id]) ?? EMPTY_TRANSLATE_STATE;
  const modelStatus = useTranslateStore((s) => s.modelStatus);
  const refreshModelStatus = useTranslateStore((s) => s.refreshModelStatus);
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const connectedRefs = useConnectedDisplayIds(id);
  const textRef = useRef<HTMLDivElement>(null);
  const syncPlan = useSyncPlan(id);

  useEffect(() => {
    if (!modelStatus.checked) void refreshModelStatus();
  }, [modelStatus.checked, refreshModelStatus]);

  const busy = run.status === "loading" || run.status === "translating";
  // While running (or right after) show the stream; otherwise the saved output.
  const text = busy || run.status === "cancelled" || (run.status === "done" && run.live) ? run.live : model.output;

  // Keep the newest streamed text in view.
  useEffect(() => {
    if (busy && textRef.current) textRef.current.scrollTop = textRef.current.scrollHeight;
  }, [busy, run.live]);

  const handleResizeEnd = useCallback(
    (_e: unknown, p: { x: number; y: number; width: number; height: number }) => updateNodeSize(id, p.x, p.y, p.width, p.height),
    [id, updateNodeSize],
  );

  const unsupported = modelStatus.checked && !modelStatus.supported;
  const noModel = modelStatus.checked && !modelStatus.hasModel;
  const errorText =
    run.status === "error"
      ? run.error === "NO_INPUT"
        ? t({ en: "Connect a Note (or enter text in the panel) first.", ja: "先にノートを接続するか、パネルで原文を入力してください。" })
        : run.error?.replace(/^(NO_MODEL|UNSUPPORTED_PLATFORM):\s*/, "") ?? ""
      : null;

  return (
    <>
      <NodeResizer
        minWidth={220}
        minHeight={150}
        isVisible={selected}
        lineStyle={{ borderColor: "rgba(234,88,12,0.4)" }}
        handleStyle={resizerHandleStyle}
        onResizeEnd={handleResizeEnd}
      />
      <div
        style={{
          position: "relative",
          background: BG,
          border: selected ? `3px solid ${TRANSLATE_ACCENT}` : `1px solid ${TRANSLATE_ACCENT}`,
          color: "#1f2937",
          fontSize: 13,
          width: "100%",
          height: "100%",
          borderRadius: 8,
          padding: "10px 12px",
          boxSizing: "border-box",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: selected ? "0 0 0 3px rgba(234,88,12,0.3)" : "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        <div style={headerStyle}>
          <TranslateIcon sx={{ fontSize: 16, color: TRANSLATE_ACCENT }} />
          <span style={nameStyle}>{displayId ?? data.title}</span>
          <span style={langStyle}>
            {langBadge(model.source_lang)} → {langBadge(model.target_lang)}
          </span>
          <span style={badgeStyle}>
            {t(STATUS_LABEL[run.status])}
            {run.status === "translating" && run.chunkCount > 1 ? ` ${run.chunkIndex + 1}/${run.chunkCount}` : ""}
          </span>
        </div>

        {unsupported ? (
          <div style={ctaWrapStyle}>
            <div style={hintStyle}>{t({ en: "Local translation currently runs on macOS only.", ja: "ローカル翻訳は現在 macOS でのみ利用できます。" })}</div>
          </div>
        ) : noModel ? (
          <div style={ctaWrapStyle}>
            <div style={hintStyle}>
              {t({ en: "No translation model is installed.", ja: "翻訳モデルがインストールされていません。" })}
            </div>
            <button
              className="nodrag"
              onClick={(e) => {
                e.stopPropagation();
                openTranslationSettings();
              }}
              style={ctaBtnStyle}
            >
              <DownloadIcon sx={{ fontSize: 14 }} />
              {t({ en: "Download model", ja: "モデルをダウンロード" })}
            </button>
          </div>
        ) : (
          <div ref={textRef} className="nowheel" style={outputStyle}>
            {text ? (
              text
            ) : (
              <span style={hintStyle}>
                {t({
                  en: "Connect Note nodes to the left port and press ▶ to translate.",
                  ja: "左のポートにノートを接続し、▶ で翻訳します。",
                })}
              </span>
            )}
          </div>
        )}

        {errorText && <div style={errorStyle}>{errorText}</div>}
        {run.truncated && run.status === "done" && (
          <div style={errorStyle}>{t({ en: "Output may be cut short.", ja: "出力が途中で切れている可能性があります。" })}</div>
        )}

        {syncPlan.sync && (
          <div
            style={{
              ...syncLineStyle,
              color: !syncPlan.valid ? "#dc2626" : syncPlan.items?.length ? TRANSLATE_ACCENT : "#059669",
            }}
          >
            ⇄{" "}
            {!syncPlan.valid
              ? t({ en: "Synced note disconnected", ja: "同期ノートが未接続" })
              : syncPlan.items === null
                ? "…"
                : syncPlan.items.length === 0
                  ? t({ en: "In sync", ja: "同期済み" })
                  : countsLabel(
                      t,
                      syncCounts(syncPlan.items),
                      langBadge(syncPlan.sync.source_lang),
                      langBadge(syncPlan.sync.target_lang),
                    )}
          </div>
        )}

        <div style={footerStyle}>
          {connectedRefs ? <span style={refsStyle}>↔ {connectedRefs}</span> : <span style={{ flex: 1 }} />}
          {!noModel && !unsupported &&
            (busy ? (
              <button
                className="nodrag"
                onClick={(e) => {
                  e.stopPropagation();
                  void cancelTranslate(id);
                }}
                style={runBtnStyle}
                title={t({ en: "Stop", ja: "停止" })}
              >
                <StopIcon sx={{ fontSize: 14 }} />
              </button>
            ) : (
              <button
                className="nodrag"
                onClick={(e) => {
                  e.stopPropagation();
                  void runTranslate(id);
                }}
                style={runBtnStyle}
                title={t({ en: "Translate", ja: "翻訳" })}
              >
                <PlayArrowIcon sx={{ fontSize: 14 }} />
              </button>
            ))}
        </div>
      </div>
      <NodePorts accent={TRANSLATE_ACCENT} />
    </>
  );
}

const syncLineStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  marginTop: 4,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const headerStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, marginBottom: 6 };
const nameStyle: React.CSSProperties = {
  fontWeight: 600,
  fontFamily: "monospace",
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const langStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  fontFamily: "monospace",
  color: TRANSLATE_ACCENT,
  whiteSpace: "nowrap",
};
const badgeStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  color: TRANSLATE_ACCENT,
  background: "rgba(234,88,12,0.12)",
  borderRadius: 4,
  padding: "1px 5px",
  whiteSpace: "nowrap",
};
const outputStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  background: "#fff",
  border: "1px solid rgba(234,88,12,0.2)",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  userSelect: "text",
};
const ctaWrapStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
};
const ctaBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  border: `1px solid ${TRANSLATE_ACCENT}`,
  background: TRANSLATE_ACCENT,
  color: "#fff",
  cursor: "pointer",
};
const hintStyle: React.CSSProperties = { fontSize: 11, color: "#6b7280", textAlign: "center", lineHeight: 1.4 };
const errorStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: "#dc2626",
  marginTop: 4,
  overflow: "hidden",
  textOverflow: "ellipsis",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
};
const footerStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, marginTop: 6 };
const refsStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 9,
  fontFamily: "monospace",
  color: "#9ca3af",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const runBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 22,
  borderRadius: 5,
  border: `1px solid ${TRANSLATE_ACCENT}`,
  background: "#fff",
  color: TRANSLATE_ACCENT,
  cursor: "pointer",
  padding: 0,
};
const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: TRANSLATE_ACCENT,
  border: "1px solid #9a3412",
};

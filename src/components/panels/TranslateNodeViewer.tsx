import { useEffect, useMemo, useRef, useState } from "react";
import TranslateIcon from "@mui/icons-material/Translate";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import type { GlossaryEntry, JaForm, NodeData, TranslateLang } from "../../types";
import { useGraphStore } from "../../store/graphStore";
import { useTranslateStore, EMPTY_TRANSLATE_STATE } from "../../store/translateStore";
import { useLang, useT } from "../../lib/i18n";
import { TRANSLATE_LANGS } from "../../lib/translateLangs";
import {
  cancelTranslate,
  linkedOutputNote,
  openTranslationSettings,
  parseTranslateModel,
  patchTranslateModel,
  runTranslate,
  translateInputNodes,
  writeTranslationToNote,
} from "../../lib/translateRunner";
import { TranslateSyncSection } from "./TranslateSyncSection";

const ACCENT = "#ea580c";

interface Props {
  node: NodeData;
}

export function TranslateNodeViewer({ node }: Props) {
  const t = useT();
  const lang = useLang();
  const model = useMemo(() => parseTranslateModel(node.metadata), [node.metadata]);
  const run = useTranslateStore((s) => s.byNode[node.id]) ?? EMPTY_TRANSLATE_STATE;
  const modelStatus = useTranslateStore((s) => s.modelStatus);
  const refreshModelStatus = useTranslateStore((s) => s.refreshModelStatus);
  const dbNodes = useGraphStore((s) => s.dbNodes);
  const dbEdges = useGraphStore((s) => s.dbEdges);

  // Local drafts for free-text fields (saved debounced).
  const [glossary, setGlossary] = useState<GlossaryEntry[]>(model.glossary);
  const [inputText, setInputText] = useState(model.input_text);
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGlossary(model.glossary);
    setInputText(model.input_text);
    // Back to the top (run button, Input/Output) when another node is selected.
    if (containerRef.current) containerRef.current.scrollTop = 0;
    // Re-sync only when switching nodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  useEffect(() => {
    void refreshModelStatus();
  }, [refreshModelStatus]);

  const sources = useMemo(
    () => translateInputNodes(node.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.id, dbNodes, dbEdges],
  );
  const outputNote = useMemo(
    () => linkedOutputNote(node.id, model.output_node_id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.id, model.output_node_id, dbNodes, dbEdges],
  );

  const saveDebounced = (partial: Parameters<typeof patchTranslateModel>[1]) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void patchTranslateModel(node.id, partial), 500);
  };

  const busy = run.status === "loading" || run.status === "translating";
  const output = busy || run.status === "cancelled" || (run.status === "done" && run.live) ? run.live : model.output;
  const langName = (code: string) => {
    const l = TRANSLATE_LANGS.find((x) => x.code === code);
    return l ? (lang === "ja" ? l.ja : l.en) : code;
  };

  const updateGlossary = (next: GlossaryEntry[]) => {
    setGlossary(next);
    saveDebounced({ glossary: next });
  };

  const statusText =
    run.status === "loading"
      ? t({ en: "Starting the translation engine / loading the model…", ja: "翻訳エンジンを起動し、モデルを読み込んでいます…" })
      : run.status === "translating"
        ? t({ en: "Translating…", ja: "翻訳中…" }) + (run.chunkCount > 1 ? ` (${run.chunkIndex + 1}/${run.chunkCount})` : "")
        : run.status === "cancelled"
          ? t({ en: "Stopped.", ja: "停止しました。" })
          : null;

  const runDisabled = modelStatus.checked && (!modelStatus.hasModel || !modelStatus.supported);
  const handleRun = async () => {
    // Flush pending edits before translating.
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await patchTranslateModel(node.id, { glossary, input_text: inputText });
    }
    void runTranslate(node.id);
  };
  const inputPreview = sources
    .map((s) => (s.content ?? "").trim())
    .filter(Boolean)
    .join("\n\n");

  return (
    <div ref={containerRef} style={containerStyle}>
      {/* ── Header + run ── */}
      <div style={titleRowStyle}>
        <TranslateIcon sx={{ fontSize: 18, color: ACCENT }} />
        <span style={{ fontWeight: 600, fontFamily: "monospace", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.display_id ?? node.title}
        </span>
        {busy ? (
          <button onClick={() => void cancelTranslate(node.id)} style={secondaryBtnStyle}>
            <StopIcon sx={{ fontSize: 15 }} /> {t({ en: "Stop", ja: "停止" })}
          </button>
        ) : (
          <button
            onClick={() => void handleRun()}
            disabled={runDisabled}
            style={{ ...primaryBtnStyle, opacity: runDisabled ? 0.45 : 1, cursor: runDisabled ? "default" : "pointer" }}
            title={t({ en: "Run translation", ja: "翻訳を実行" })}
          >
            <PlayArrowIcon sx={{ fontSize: 16 }} /> {t({ en: "Translate", ja: "翻訳" })} → {langName(model.target_lang)}
          </button>
        )}
      </div>
      {statusText && <div style={mutedStyle}>{statusText}</div>}
      {run.status === "error" && (
        <div style={errorStyle}>
          {run.error === "NO_INPUT"
            ? t({ en: "There is no text to translate.", ja: "翻訳するテキストがありません。" })
            : run.error}
        </div>
      )}

      {/* ── Model ── */}
      {modelStatus.checked && !modelStatus.supported ? (
        <div style={ctaBoxStyle}>
          <div style={{ fontSize: 12.5 }}>{t({ en: "Local translation currently runs on macOS only.", ja: "ローカル翻訳は現在 macOS でのみ利用できます。" })}</div>
        </div>
      ) : modelStatus.checked && !modelStatus.hasModel ? (
        <div style={ctaBoxStyle}>
          <div style={{ fontSize: 12.5 }}>
            {t({
              en: "No translation model is installed. Download PLaMo 3 Translate (runs locally) to use this node.",
              ja: "翻訳モデルがありません。このノードを使うには PLaMo 3 Translate（ローカル実行）をダウンロードしてください。",
            })}
          </div>
          <button onClick={openTranslationSettings} style={primaryBtnStyle}>
            <DownloadIcon sx={{ fontSize: 15 }} />
            {t({ en: "Download model", ja: "モデルをダウンロード" })}
          </button>
        </div>
      ) : (
        <div style={modelRowStyle}>
          <span style={mutedStyle}>{t({ en: "Model", ja: "モデル" })}:</span>
          <span style={monoStyle}>{modelStatus.activeName ?? "…"}</span>
          <button onClick={openTranslationSettings} style={linkBtnStyle}>
            {t({ en: "Change", ja: "変更" })}
          </button>
        </div>
      )}

      {/* ── Input / Output columns ── */}
      <div style={columnsStyle}>
        <div style={columnStyle}>
          <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1 }}>Input</span>
            <span style={{ ...mutedStyle, textTransform: "none", fontWeight: 400 }}>
              {model.source_lang ? langName(model.source_lang) : t({ en: "Auto-detect", ja: "自動判定" })}
            </span>
          </div>
          {sources.length > 0 ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {sources.map((s) => (
                  <span key={s.id} style={sourceChipStyle} title={`${(s.content ?? "").trim().length} ${t({ en: "chars", ja: "文字" })}`}>
                    <span style={monoStyle}>{s.display_id ?? s.title}</span>
                    {s.node_type === "paper" && <span style={mutedStyle}>({t({ en: "abstract", ja: "アブストラクト" })})</span>}
                  </span>
                ))}
              </div>
              <div style={inputPreviewStyle}>{inputPreview || <span style={mutedStyle}>—</span>}</div>
            </>
          ) : (
            <textarea
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                saveDebounced({ input_text: e.target.value });
              }}
              placeholder={t({
                en: "Type text here, or connect Note nodes to the left port.",
                ja: "ここに原文を入力するか、左のポートにノートを接続してください。",
              })}
              style={textareaStyle}
            />
          )}
        </div>

        <div style={columnStyle}>
          <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1 }}>Output</span>
            <span style={{ ...mutedStyle, textTransform: "none", fontWeight: 400 }}>{langName(model.target_lang)}</span>
          </div>
          <div style={outputStyle}>{output || <span style={mutedStyle}>—</span>}</div>
          {output && !busy && (
            <div style={creditRowStyle}>
              <span style={creditStyle}>Translated by PLaMo</span>
              {model.translated_at && run.status !== "cancelled" && (
                <span style={{ ...mutedStyle, fontSize: 10.5 }}>{new Date(model.translated_at).toLocaleString()}</span>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button
              disabled={!model.output || busy}
              onClick={async () => {
                await navigator.clipboard.writeText(model.output);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              style={{ ...secondaryBtnStyle, opacity: !model.output || busy ? 0.5 : 1 }}
            >
              <ContentCopyIcon sx={{ fontSize: 14 }} /> {copied ? t("common.copied") : t("common.copy")}
            </button>
            <button
              disabled={!model.output || busy}
              onClick={() => void writeTranslationToNote(node.id)}
              style={{ ...secondaryBtnStyle, opacity: !model.output || busy ? 0.5 : 1 }}
            >
              <NoteAddIcon sx={{ fontSize: 14 }} />
              {outputNote
                ? t({ en: "Update {id}", ja: "{id} を更新" }, { id: outputNote.display_id ?? "note" })
                : t({ en: "Write to new Note", ja: "新しいノートに書き出す" })}
            </button>
          </div>
        </div>
      </div>

      {run.keptOriginal.length > 0 && run.status === "done" && (
        <div style={errorStyle}>
          {t(
            {
              en: "{n} paragraph(s) were left untranslated because their Typst markup could not be preserved:",
              ja: "{n} 個の段落は Typst の記法を保てなかったため、原文のまま残しました：",
            },
            { n: run.keptOriginal.length },
          )}
          {run.keptOriginal.map((k, i) => (
            <div key={i} style={{ fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>· {k}…</div>
          ))}
        </div>
      )}
      {run.truncated && run.status === "done" && (
        <div style={errorStyle}>
          {t({ en: "Part of the output hit the length limit and may be cut short.", ja: "一部の出力が長さの上限に達し、途中で切れている可能性があります。" })}
        </div>
      )}
      {outputNote && (
        <div style={mutedStyle}>
          {t(
            model.sync
              ? {
                  en: "Linked to {id}. “Update” replaces its whole text with this translation (hand edits there are overwritten) and restarts syncing — to carry over only changed paragraphs, use the sync below.",
                  ja: "{id} と連動しています。「更新」はノート全体をこの訳文で置き換え（手直しは上書きされます）、同期もやり直します。変わった段落だけを反映するには、下の同期を使ってください。",
                }
              : {
                  en: "Linked to {id}. Press “Update” to replace its text with this translation (your edits there will be overwritten).",
                  ja: "{id} と連動しています。「更新」を押すとこの訳文で置き換えます（そのノートでの手直しは上書きされます）。",
                },
            { id: outputNote.display_id ?? "note" },
          )}
        </div>
      )}
      {sources.length > 0 && (
        <div style={mutedStyle}>
          {t({
            en: "Connected nodes are translated top to bottom. In Notes only the prose (incl. figure captions) is translated; code, math, references and labels are kept. A line with only {{@image_N}} is written out as an adjustable #figure(image(\"@image_N\", width: 80%), …) with the caption translated.",
            ja: "接続されたノードを上から順に翻訳します。ノートは本文と図のキャプションだけを訳し、コード・数式・参照・ラベルはそのまま残します。{{@image_N}} だけの行は、大きさや位置を調整できる #figure(image(\"@image_N\", width: 80%), …) の形に書き出し、キャプションも訳します。",
          })}
        </div>
      )}

      {/* ── Languages ── */}
      <div style={sectionStyle}>
        <div style={labelStyle}>{t({ en: "Languages", ja: "言語" })}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <select
            value={model.source_lang ?? ""}
            onChange={(e) => void patchTranslateModel(node.id, { source_lang: (e.target.value || null) as TranslateLang | null })}
            style={selectStyle}
            title={t({ en: "Source language", ja: "原文の言語" })}
          >
            <option value="">{t({ en: "Auto-detect", ja: "自動判定" })}</option>
            {TRANSLATE_LANGS.map((l) => (
              <option key={l.code} value={l.code}>{lang === "ja" ? l.ja : l.en}</option>
            ))}
          </select>
          <button
            onClick={() =>
              model.source_lang &&
              void patchTranslateModel(node.id, { source_lang: model.target_lang, target_lang: model.source_lang })
            }
            disabled={!model.source_lang}
            style={{ ...iconBtnStyle, opacity: model.source_lang ? 1 : 0.35 }}
            title={t({ en: "Swap languages", ja: "言語を入れ替え" })}
          >
            <SwapHorizIcon sx={{ fontSize: 18 }} />
          </button>
          <select
            value={model.target_lang}
            onChange={(e) => void patchTranslateModel(node.id, { target_lang: e.target.value as TranslateLang })}
            style={selectStyle}
            title={t({ en: "Target language", ja: "翻訳先の言語" })}
          >
            {TRANSLATE_LANGS.map((l) => (
              <option key={l.code} value={l.code}>{lang === "ja" ? l.ja : l.en}</option>
            ))}
          </select>
        </div>

        {model.target_lang === "ja" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, fontSize: 12.5, flexWrap: "wrap" }}>
            <span style={mutedStyle}>{t({ en: "Style", ja: "文体" })}:</span>
            {([
              [null, { en: "Default", ja: "指定なし" }],
              ["plain", { en: "Plain (da/dearu)", ja: "常体（だ・である）" }],
              ["polite", { en: "Polite (desu/masu)", ja: "敬体（です・ます）" }],
            ] as [JaForm | null, { en: string; ja: string }][]).map(([value, label]) => (
              <label key={value ?? "none"} style={radioLabelStyle}>
                <input
                  type="radio"
                  name={`form-${node.id}`}
                  checked={model.form === value}
                  onChange={() => void patchTranslateModel(node.id, { form: value })}
                />
                {t(label)}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* ── Glossary ── */}
      <div style={sectionStyle}>
        <div style={labelStyle}>{t({ en: "Glossary", ja: "用語集" })}</div>
        {glossary.map((g, i) => (
          <div key={i} style={glossaryRowStyle}>
            <input
              value={g.src}
              placeholder={t({ en: "Source term", ja: "原語" })}
              onChange={(e) => updateGlossary(glossary.map((x, j) => (j === i ? { ...x, src: e.target.value } : x)))}
              style={inputStyle}
            />
            <span style={mutedStyle}>→</span>
            <input
              value={g.dst}
              placeholder={t({ en: "Translation", ja: "訳語" })}
              onChange={(e) => updateGlossary(glossary.map((x, j) => (j === i ? { ...x, dst: e.target.value } : x)))}
              style={inputStyle}
            />
            <button onClick={() => updateGlossary(glossary.filter((_, j) => j !== i))} style={iconBtnStyle}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </button>
          </div>
        ))}
        <button onClick={() => updateGlossary([...glossary, { src: "", dst: "" }])} style={linkBtnStyle}>
          <AddIcon sx={{ fontSize: 14 }} /> {t({ en: "Add term", ja: "用語を追加" })}
        </button>
      </div>

      <TranslateSyncSection nodeId={node.id} />

      <div style={footnoteStyle}>
        Built with PLaMo ·{" "}
        {t({ en: "Runs locally; no text leaves this computer.", ja: "ローカルで実行され、テキストは外部に送信されません。" })}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
  fontSize: 13,
  color: "#1f2937",
};
const titleRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const sectionStyle: React.CSSProperties = {};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 6,
};
const mutedStyle: React.CSSProperties = { fontSize: 11.5, color: "#6b7280" };
const monoStyle: React.CSSProperties = { fontFamily: "monospace", fontSize: 11.5, color: "#374151" };
const modelRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
const ctaBoxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  alignItems: "flex-start",
  padding: 12,
  borderRadius: 8,
  background: "#fff7ed",
  border: "1px solid #fdba74",
};
const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "6px 8px",
  fontSize: 12.5,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  background: "#fff",
};
const radioLabelStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" };
const glossaryRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 };
const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "5px 8px",
  fontSize: 12.5,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  outline: "none",
};
const columnsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 10,
  alignItems: "start",
};
const columnStyle: React.CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0 };
const sourceChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 7px",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 999,
};
const inputPreviewStyle: React.CSSProperties = {
  height: 180,
  overflowY: "auto",
  padding: 10,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  lineHeight: 1.6,
  fontSize: 12.5,
  color: "#374151",
  userSelect: "text",
  boxSizing: "border-box",
};
const creditRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 6,
  marginTop: 4,
  flexWrap: "wrap",
};
const creditStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  fontStyle: "italic",
  color: "#9a3412",
};
const textareaStyle: React.CSSProperties = {
  width: "100%",
  height: 180,
  boxSizing: "border-box",
  padding: 8,
  fontSize: 12.5,
  lineHeight: 1.5,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  resize: "vertical",
  fontFamily: "inherit",
  outline: "none",
};
const outputStyle: React.CSSProperties = {
  height: 180,
  boxSizing: "border-box",
  fontSize: 12.5,
  overflowY: "auto",
  padding: 10,
  border: "1px solid #fed7aa",
  background: "#fffaf5",
  borderRadius: 6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  lineHeight: 1.6,
  userSelect: "text",
};
const errorStyle: React.CSSProperties = { fontSize: 12, color: "#dc2626", wordBreak: "break-word" };
const footnoteStyle: React.CSSProperties = { fontSize: 10.5, color: "#9ca3af", marginTop: 4 };
const primaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  borderRadius: 6,
  border: `1px solid ${ACCENT}`,
  background: ACCENT,
  color: "#fff",
  cursor: "pointer",
};
const secondaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "5px 12px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#374151",
  cursor: "pointer",
};
const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  background: "none",
  border: "none",
  color: "#6b7280",
  cursor: "pointer",
  padding: 2,
};
const linkBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  background: "none",
  border: "none",
  padding: 0,
  color: "#2563eb",
  fontSize: 12,
  cursor: "pointer",
};

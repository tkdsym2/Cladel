import { useMemo } from "react";
import SyncIcon from "@mui/icons-material/Sync";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { SyncAction, SyncItem, TranslateSync } from "../../types";
import { useGraphStore } from "../../store/graphStore";
import { useTranslateStore, EMPTY_SYNC_STATE } from "../../store/translateStore";
import { useLang, useT } from "../../lib/i18n";
import { TRANSLATE_LANGS, langBadge } from "../../lib/translateLangs";
import { openTranslationSettings } from "../../lib/translateRunner";
import {
  applyAllSync,
  applySyncItem,
  cancelSync,
  defaultAction,
  startSync,
  stopSync,
  syncCandidates,
  syncCounts,
  syncNotes,
  useSyncPlan,
} from "../../lib/translateSync";

const ACCENT = "#ea580c";

/** "Bilingual sync" part of the Translate node panel: lists paragraphs that
 *  changed in either note since the last sync and applies them on request. */
export function TranslateSyncSection({ nodeId }: { nodeId: string }) {
  const t = useT();
  const lang = useLang();
  const { sync, valid, items } = useSyncPlan(nodeId);
  const state = useTranslateStore((s) => s.syncByNode[nodeId]) ?? EMPTY_SYNC_STATE;
  const dbNodes = useGraphStore((s) => s.dbNodes);
  const dbEdges = useGraphStore((s) => s.dbEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const candidates = useMemo(() => syncCandidates(nodeId), [nodeId, dbNodes, dbEdges, sync]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx = useMemo(() => syncNotes(nodeId), [nodeId, dbNodes, dbEdges, sync]);

  const langName = (code: string) => {
    const l = TRANSLATE_LANGS.find((x) => x.code === code);
    return l ? (lang === "ja" ? l.ja : l.en) : code;
  };

  const title = (
    <div style={labelStyle}>
      <SyncIcon sx={{ fontSize: 13, verticalAlign: "-2px", mr: 0.5 }} />
      {t({ en: "Bilingual sync", ja: "対訳ノートの同期" })}
    </div>
  );

  if (!sync) {
    return (
      <div>
        {title}
        <div style={mutedStyle}>
          {candidates
            ? t(
                {
                  en: "Keep {src} and {dst} in step: later edits to either note are listed here paragraph by paragraph and translated into the other one only when you apply them.",
                  ja: "{src} と {dst} を対応させておくと、どちらかのノートを後から編集したとき、変わった段落だけをここに一覧し、反映を押したものだけを相手側へ訳して書き込みます。",
                },
                { src: candidates.src.display_id ?? "note", dst: candidates.dst.display_id ?? "note" },
              )
            : t({
                en: "Connect exactly one Note as input and write the translation to a Note (“Write to new Note”) — both notes are then kept in sync paragraph by paragraph.",
                ja: "入力にノートを1つだけつなぎ、訳文をノートに書き出す（「新しいノートに書き出す」）と、2つのノートを段落ごとに同期できるようになります。",
              })}
        </div>
        {candidates && (
          <button style={{ ...secondaryBtnStyle, marginTop: 6 }} onClick={() => void startSync(nodeId)}>
            <SyncIcon sx={{ fontSize: 14 }} />
            {t({ en: "Start syncing (pair paragraphs in order)", ja: "同期を開始（段落を順番に対応付け）" })}
          </button>
        )}
      </div>
    );
  }

  if (!valid || !ctx) {
    return (
      <div>
        {title}
        <div style={errorStyle}>
          {t({
            en: "The synced notes are no longer connected to this node (a note was deleted or a wire removed).",
            ja: "同期していたノートがこのノードにつながっていません（ノートの削除か、線の切断）。",
          })}
        </div>
        <button style={{ ...linkBtnStyle, marginTop: 4 }} onClick={() => void stopSync(nodeId)}>
          {t({ en: "Stop syncing", ja: "同期を解除" })}
        </button>
      </div>
    );
  }

  const side = (s: "src" | "dst") => langBadge(s === "src" ? sync.source_lang : sync.target_lang);
  const counts = syncCounts(items);
  const busy = state.busyKey !== null;
  const applicable = (items ?? []).filter((i) => defaultAction(i)).length;

  return (
    <div>
      {title}
      <div style={pairRowStyle}>
        <span style={monoStyle}>{ctx.src.display_id}</span>
        <span style={mutedStyle}>({langName(sync.source_lang)})</span>
        <span style={{ color: "#9ca3af" }}>⇄</span>
        <span style={monoStyle}>{ctx.dst.display_id}</span>
        <span style={mutedStyle}>({langName(sync.target_lang)})</span>
      </div>

      <div style={{ marginTop: 6, fontSize: 12.5 }}>
        {items === null ? (
          <span style={mutedStyle}>{t({ en: "Checking…", ja: "確認中…" })}</span>
        ) : items.length === 0 ? (
          <span style={{ color: "#059669", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <CheckCircleIcon sx={{ fontSize: 15 }} />
            {t({ en: "In sync", ja: "同期済み" })}
          </span>
        ) : (
          <span>{countsLabel(t, counts, side("src"), side("dst"))}</span>
        )}
      </div>

      {items && items.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            disabled={busy || applicable === 0}
            onClick={() => void applyAllSync(nodeId)}
            style={{ ...primaryBtnStyle, opacity: busy || applicable === 0 ? 0.5 : 1 }}
          >
            <SyncIcon sx={{ fontSize: 15 }} />
            {t({ en: "Apply all except conflicts ({n})", ja: "競合以外をすべて反映（{n}件）" }, { n: applicable })}
          </button>
          {busy && (
            <button onClick={() => void cancelSync(nodeId)} style={secondaryBtnStyle}>
              {t({ en: "Stop", ja: "停止" })}
            </button>
          )}
          {busy && (
            <span style={mutedStyle}>
              {t({ en: "Translating…", ja: "翻訳中…" })} {state.progress ?? ""}
            </span>
          )}
        </div>
      )}

      {state.error && (
        <div style={{ ...errorStyle, marginTop: 6 }}>
          {state.error === "STALE"
            ? t({
                en: "A note changed while translating, so nothing was written. Check the list again.",
                ja: "翻訳中にノートが編集されたため、書き込みを中止しました。一覧を確認してやり直してください。",
              })
            : state.error.startsWith("NO_MODEL") ? (
                <>
                  {t({ en: "No translation model is installed.", ja: "翻訳モデルがインストールされていません。" })}{" "}
                  <button style={linkBtnStyle} onClick={openTranslationSettings}>
                    {t({ en: "Download model", ja: "モデルをダウンロード" })}
                  </button>
                </>
              )
            : state.error}
        </div>
      )}
      {state.warning && (
        <div style={{ ...mutedStyle, color: "#b45309", marginTop: 6 }}>
          {t({
            en: "Some text was left untranslated because its Typst markup could not be preserved:",
            ja: "一部は Typst の記法を保てなかったため、原文のまま書き込みました：",
          })}{" "}
          <span style={monoStyle}>{state.warning.slice(0, 160)}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
        {(items ?? []).map((item) => (
          <SyncItemCard
            key={item.key}
            item={item}
            sync={sync}
            busy={busy}
            running={state.busyKey === item.key}
            onApply={(action) => void applySyncItem(nodeId, item, action)}
          />
        ))}
      </div>

      <div style={{ ...mutedStyle, marginTop: 8 }}>
        {t({
          en: "Only paragraphs you apply are rewritten; everything else in both notes (incl. hand-adjusted figures) stays as it is. “Ignore” marks a change as synced without translating it.",
          ja: "書き換わるのは反映した段落だけで、両方のノートのそれ以外の部分（手で調整した図なども）はそのまま残ります。「無視」は訳さずに同期済みとして扱います。",
        })}{" "}
        <button style={linkBtnStyle} disabled={busy} onClick={() => void stopSync(nodeId)}>
          {t({ en: "Stop syncing", ja: "同期を解除" })}
        </button>
      </div>
    </div>
  );
}

type TFn = ReturnType<typeof useT>;

export function countsLabel(t: TFn, c: ReturnType<typeof syncCounts>, src: string, dst: string): string {
  const parts: string[] = [];
  if (c.toDst) parts.push(`${src}→${dst} ${c.toDst}`);
  if (c.toSrc) parts.push(`${dst}→${src} ${c.toSrc}`);
  if (c.conflicts) parts.push(t({ en: "conflicts {n}", ja: "競合 {n}" }, { n: c.conflicts }));
  const n = c.toDst + c.toSrc + c.conflicts;
  return t({ en: "{n} change(s) ({parts})", ja: "変更 {n}件（{parts}）" }, { n, parts: parts.join(" · ") });
}

function SyncItemCard({
  item,
  sync,
  busy,
  running,
  onApply,
}: {
  item: SyncItem;
  sync: TranslateSync;
  busy: boolean;
  running: boolean;
  onApply: (action: SyncAction) => void;
}) {
  const t = useT();
  const L = { src: langBadge(sync.source_lang), dst: langBadge(sync.target_lang) };
  const other = item.side === "src" ? "dst" : "src";
  const write = (to: "src" | "dst"): SyncAction => (to === "dst" ? "write_dst" : "write_src");
  const conflict = item.kind.startsWith("conflict");

  let heading: string;
  let blocks: { label: string; text: string | null; strike?: boolean }[];
  let actions: { label: string; action: SyncAction; primary?: boolean }[];
  const ignore = { label: t({ en: "Ignore", ja: "無視" }), action: "ignore" as SyncAction };

  switch (item.kind) {
    case "modified":
      heading = t({ en: "{a} → {b} · edited", ja: "{a} → {b} · 変更" }, { a: L[item.side], b: L[other] });
      blocks = [
        { label: t({ en: "Edited {a}", ja: "変更後の {a}" }, { a: L[item.side] }), text: textOf(item, item.side) },
        { label: t({ en: "{b} to be replaced", ja: "置き換わる {b}" }, { b: L[other] }), text: textOf(item, other), strike: true },
      ];
      actions = [
        { label: t({ en: "Translate into {b}", ja: "{b} に訳して反映" }, { b: L[other] }), action: write(other), primary: true },
        ignore,
      ];
      break;
    case "added":
      heading = t({ en: "{a} → {b} · added", ja: "{a} → {b} · 追加" }, { a: L[item.side], b: L[other] });
      blocks = [{ label: t({ en: "New in {a}", ja: "{a} に追加" }, { a: L[item.side] }), text: textOf(item, item.side) }];
      actions = [
        { label: t({ en: "Translate into {b}", ja: "{b} に訳して追加" }, { b: L[other] }), action: write(other), primary: true },
        { ...ignore, label: t({ en: "Ignore ({a} only)", ja: "無視（{a} だけに残す）" }, { a: L[item.side] }) },
      ];
      break;
    case "deleted":
      heading = t({ en: "{a} → {b} · deleted", ja: "{a} → {b} · 削除" }, { a: L[item.side], b: L[other] });
      blocks = [
        { label: t({ en: "Deleted from {a}", ja: "{a} から削除" }, { a: L[item.side] }), text: oldOf(item, item.side), strike: true },
        { label: t({ en: "Still in {b}", ja: "{b} に残っている段落" }, { b: L[other] }), text: textOf(item, other) },
      ];
      actions = [
        { label: t({ en: "Delete from {b} too", ja: "{b} からも削除" }, { b: L[other] }), action: "delete", primary: true },
        { ...ignore, label: t({ en: "Ignore (keep in {b})", ja: "無視（{b} に残す）" }, { b: L[other] }) },
      ];
      break;
    case "conflict_modified":
      heading = t({ en: "Conflict · edited in both", ja: "競合 · 両方で変更" });
      blocks = [
        { label: L.src, text: item.src_text },
        { label: L.dst, text: item.dst_text },
      ];
      actions = [
        { label: t({ en: "Use {a} (translate into {b})", ja: "{a} を採用（{b} に訳す）" }, { a: L.src, b: L.dst }), action: "write_dst" },
        { label: t({ en: "Use {a} (translate into {b})", ja: "{a} を採用（{b} に訳す）" }, { a: L.dst, b: L.src }), action: "write_src" },
        { ...ignore, label: t({ en: "Keep both as is", ja: "両方そのまま" }) },
      ];
      break;
    case "conflict_deleted":
      heading = t(
        { en: "Conflict · deleted in {b}, edited in {a}", ja: "競合 · {b} で削除、{a} で変更" },
        { a: L[item.side], b: L[other] },
      );
      blocks = [
        { label: t({ en: "Edited {a}", ja: "変更後の {a}" }, { a: L[item.side] }), text: textOf(item, item.side) },
        { label: t({ en: "Deleted from {b}", ja: "{b} から削除" }, { b: L[other] }), text: oldOf(item, other), strike: true },
      ];
      actions = [
        { label: t({ en: "Keep it (translate back into {b})", ja: "残す（{b} に訳して戻す）" }, { b: L[other] }), action: write(other) },
        { label: t({ en: "Delete from {a} too", ja: "{a} からも削除" }, { a: L[item.side] }), action: "delete" },
        { ...ignore, label: t({ en: "Keep {a} only", ja: "{a} だけに残す" }, { a: L[item.side] }) },
      ];
      break;
  }

  return (
    <div style={{ ...cardStyle, borderColor: conflict ? "#fca5a5" : "#fed7aa" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: conflict ? "#b91c1c" : "#9a3412" }}>
        {conflict && <WarningAmberIcon sx={{ fontSize: 14 }} />}
        {heading}
      </div>
      {blocks.map((b, i) => (
        <div key={i} style={{ marginTop: 6 }}>
          <div style={{ fontSize: 10.5, color: "#9ca3af", marginBottom: 2 }}>{b.label}</div>
          <div style={{ ...blockTextStyle, ...(b.strike ? { color: "#9ca3af", textDecoration: "line-through" } : {}) }}>
            {b.text ?? "—"}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        {actions.map((a) => (
          <button
            key={a.action + a.label}
            disabled={busy}
            onClick={() => onApply(a.action)}
            style={{ ...(a.primary ? smallPrimaryStyle : secondaryBtnStyle), opacity: busy ? 0.5 : 1 }}
          >
            {a.label}
          </button>
        ))}
        {running && <span style={mutedStyle}>{t({ en: "Translating…", ja: "翻訳中…" })}</span>}
      </div>
    </div>
  );
}

function textOf(item: SyncItem, side: "src" | "dst"): string | null {
  return side === "src" ? item.src_text : item.dst_text;
}
function oldOf(item: SyncItem, side: "src" | "dst"): string | null {
  return side === "src" ? item.old_src : item.old_dst;
}

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
const errorStyle: React.CSSProperties = { fontSize: 12, color: "#dc2626", wordBreak: "break-word" };
const pairRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" };
const cardStyle: React.CSSProperties = {
  padding: 10,
  border: "1px solid #fed7aa",
  borderRadius: 8,
  background: "#fffaf5",
};
const blockTextStyle: React.CSSProperties = {
  maxHeight: 120,
  overflowY: "auto",
  padding: "6px 8px",
  background: "#fff",
  border: "1px solid #f3f4f6",
  borderRadius: 4,
  fontFamily: "monospace",
  fontSize: 11.5,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  userSelect: "text",
};
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
const smallPrimaryStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  padding: "4px 10px",
  fontSize: 12,
};
const secondaryBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#374151",
  cursor: "pointer",
};
const linkBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: ACCENT,
  fontSize: 11.5,
  cursor: "pointer",
  textDecoration: "underline",
};

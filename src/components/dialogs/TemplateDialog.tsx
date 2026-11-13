import { useCallback, useEffect, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import { useT, type Entry } from "../../lib/i18n";
import { useFileStore } from "../../store/fileStore";
import sampleDoublePage1 from "../../assets/templates/sample-double-1.png";
import sampleDoublePage2 from "../../assets/templates/sample-double-2.png";
import acmDoublePage from "../../assets/templates/acm-double-1.png";
import acmSinglePage from "../../assets/templates/acm-single-1.png";

interface TemplateItem {
  /** Backend id (`open_template_as_new`), "blank", or "basic-sample" for the bundled demo project. */
  id: string;
  kind: "blank" | "sample" | "template";
  name: Entry;
  description: Entry;
  /** Rendered page previews (empty for the demo project). */
  pages: string[];
}

const ITEMS: TemplateItem[] = [
  {
    id: "blank",
    kind: "blank",
    name: { en: "Blank document", ja: "白紙のドキュメント" },
    description: {
      en: "Start from an empty canvas with only the Core node.",
      ja: "Core ノードだけの空のキャンバスから始めます。",
    },
    pages: [],
  },
  {
    id: "chi-uist-sample",
    kind: "sample",
    name: { en: "CHI / UIST paper (two-column)", ja: "CHI / UIST 論文（2カラム）" },
    description: {
      en: "A two-page sample paper in the ACM conference style with a teaser figure, a chart, a table, an equation and references. Rendered from notes, image, table and paper nodes.",
      ja: "ACM カンファレンス形式の2ページのサンプル論文。ティザー画像・グラフ・表・数式・参考文献を含み、ノート／画像／テーブル／論文ノードからレンダリングされます。",
    },
    pages: [sampleDoublePage1, sampleDoublePage2],
  },
  {
    id: "acm-double",
    kind: "template",
    name: { en: "CHI / UIST two-column", ja: "CHI / UIST 2カラム" },
    description: {
      en: "Blank ACM two-column paper (camera-ready layout): a note with the template skeleton connected to render and export nodes.",
      ja: "ACM 2カラム（カメラレディ形式）の空のひな形。テンプレート設定済みのノートが Render / Export ノードに接続されています。",
    },
    pages: [acmDoublePage],
  },
  {
    id: "acm-single",
    kind: "template",
    name: { en: "CHI / UIST single-column (review)", ja: "CHI / UIST シングルカラム（査読用）" },
    description: {
      en: "Blank ACM single-column manuscript with line numbers, the layout used for review submissions.",
      ja: "行番号付きの ACM シングルカラム原稿（査読投稿用の形式）の空のひな形。",
    },
    pages: [acmSinglePage],
  },
  {
    id: "basic-sample",
    kind: "sample",
    name: { en: "Filonex demo project", ja: "Filonex デモプロジェクト" },
    description: {
      en: "The introductory demo graph: papers, notes, compare, agent, table and export nodes.",
      ja: "入門用のデモグラフ。論文・ノート・比較・エージェント・テーブル・Export ノードを含みます。",
    },
    pages: [],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a template was opened in a new tab. */
  onOpened: () => void;
  /** Create the blank document (the caller decides: new tab, or keep the fresh untitled one). */
  onBlank: () => void | Promise<void>;
}

/** "New File" chooser: a blank document, or a built-in template / sample. Each opens as a new untitled tab. */
export function TemplateDialog({ open, onClose, onOpened, onBlank }: Props) {
  const t = useT();
  const [selectedId, setSelectedId] = useState(ITEMS[0].id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = ITEMS.find((i) => i.id === selectedId) ?? ITEMS[0];

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelectedId(ITEMS[0].id); // always start on "Blank document"
  }, [open]);

  const handleOpen = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const store = useFileStore.getState();
      if (selected.id === "blank") {
        await onBlank();
      } else {
        if (selected.id === "basic-sample") await store.openSample();
        else await store.openTemplate(selected.id);
        onOpened();
      }
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loading, selected, onOpened, onBlank, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        handleOpen();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const i = ITEMS.findIndex((x) => x.id === selectedId);
        const next = (i + (e.key === "ArrowDown" ? 1 : ITEMS.length - 1)) % ITEMS.length;
        setSelectedId(ITEMS[next].id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, handleOpen, selectedId]);

  if (!open) return null;

  const kindLabel = (kind: TemplateItem["kind"]) =>
    kind === "blank"
      ? t({ en: "Blank", ja: "白紙" })
      : kind === "sample"
        ? t({ en: "Sample", ja: "サンプル" })
        : t({ en: "Template", ja: "テンプレート" });

  return (
    <div style={overlayStyle} onMouseDown={onClose}>
      <div style={dialogStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
            {t({ en: "New File", ja: "新規ファイル" })}
          </span>
          <button onClick={onClose} style={closeBtnStyle} aria-label="Close">
            <CloseIcon sx={{ fontSize: 18 }} />
          </button>
        </div>

        <div style={bodyStyle}>
          {/* List */}
          <div style={listStyle}>
            {ITEMS.map((item) => {
              const active = item.id === selected.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  onDoubleClick={handleOpen}
                  style={{
                    ...itemStyle,
                    borderColor: active ? "#2563eb" : "#e5e7eb",
                    background: active ? "#eff6ff" : "#fff",
                  }}
                >
                  <span
                    style={{
                      ...badgeStyle,
                      ...BADGE_COLORS[item.kind],
                    }}
                  >
                    {kindLabel(item.kind)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", textAlign: "left" }}>
                    {t(item.name)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Preview */}
          <div style={previewStyle}>
            <div style={pagesStyle}>
              {selected.pages.length > 0 ? (
                selected.pages.map((src) => (
                  <img key={src} src={src} alt="" style={pageImgStyle(selected.pages.length)} draggable={false} />
                ))
              ) : selected.kind === "blank" ? (
                <div style={blankPageStyle}>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{t({ en: "Blank", ja: "白紙" })}</span>
                </div>
              ) : (
                <span style={{ fontSize: 12, color: "#9ca3af" }}>
                  {t({ en: "No page preview (graph-only project)", ja: "ページプレビューなし（グラフのみのプロジェクト）" })}
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.6, color: "#4b5563", margin: "12px 0 0" }}>
              {t(selected.description)}
            </p>
          </div>
        </div>

        <div style={footerStyle}>
          <span style={{ flex: 1, fontSize: 11, color: error ? "#dc2626" : "#9ca3af" }}>
            {error ??
              (selected.kind === "blank"
                ? t({ en: "Opens as a new untitled document.", ja: "新しい無題のドキュメントとして開きます。" })
                : selected.id === "basic-sample"
                  ? t({ en: "Opens as a new untitled document.", ja: "新しい無題のドキュメントとして開きます。" })
                  : t({
                en: "Opens as a new untitled document. Unofficial approximation of the ACM format: check the venue's submission rules.",
                ja: "新しい無題のドキュメントとして開きます。ACM 形式を模した非公式テンプレートです。投稿時は会議の規定を確認してください。",
              }))}
          </span>
          <button onClick={onClose} style={cancelBtnStyle}>
            {t({ en: "Cancel", ja: "キャンセル" })}
          </button>
          <button onClick={handleOpen} disabled={loading} style={{ ...openBtnStyle, opacity: loading ? 0.6 : 1 }}>
            {loading ? t({ en: "Creating...", ja: "作成中..." }) : t({ en: "Create", ja: "作成" })}
          </button>
        </div>
      </div>
    </div>
  );
}

const BADGE_COLORS: Record<TemplateItem["kind"], React.CSSProperties> = {
  blank: { background: "#f3f4f6", color: "#374151" },
  sample: { background: "#dbeafe", color: "#1e40af" },
  template: { background: "#f3e8ff", color: "#7e22ce" },
};

const blankPageStyle: React.CSSProperties = {
  height: "100%",
  aspectRatio: "8.5 / 11",
  maxWidth: "100%",
  background: "#fff",
  border: "1px solid #d1d5db",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10500,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialogStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  width: 860,
  maxWidth: "94vw",
  height: 600,
  maxHeight: "92vh",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 20px",
  borderBottom: "1px solid #e5e7eb",
};

const closeBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "#6b7280",
  display: "flex",
  padding: 4,
};

const bodyStyle: React.CSSProperties = { flex: 1, display: "flex", minHeight: 0 };

const listStyle: React.CSSProperties = {
  flex: "0 0 270px",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  borderRight: "1px solid #e5e7eb",
  overflowY: "auto",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 6,
  padding: "10px 12px",
  border: "2px solid #e5e7eb",
  borderRadius: 8,
  cursor: "pointer",
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 7px",
  borderRadius: 999,
  letterSpacing: 0.2,
};

const previewStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  background: "#f8fafc",
};

const pagesStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  gap: 12,
  alignItems: "center",
  justifyContent: "center",
};

const pageImgStyle = (count: number): React.CSSProperties => ({
  maxHeight: "100%",
  maxWidth: count > 1 ? `calc(${100 / count}% - 6px)` : "100%",
  objectFit: "contain",
  background: "#fff",
  border: "1px solid #d1d5db",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
});

const footerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 20px",
  borderTop: "1px solid #e5e7eb",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "7px 18px",
  background: "#f3f4f6",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const openBtnStyle: React.CSSProperties = {
  padding: "7px 22px",
  background: "#1e40af",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

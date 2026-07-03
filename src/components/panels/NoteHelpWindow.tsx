import { useEffect } from "react";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import { useT, type Entry } from "../../lib/i18n";
import { useSettingsStore } from "../../store/settingsStore";
import { onSettingsChanged } from "../../lib/sync-events";

const ACCENT = "#d97706";

/**
 * Help / documentation for Note (Typst) nodes, rendered as a standalone
 * window (route `/note-help`) so it can stay open next to the main window
 * while writing. Covers: Typst basics + preview, pulling content from
 * connected nodes (/import, @mention), citing papers, inserting images, and
 * referencing table cells. All text is bilingual (EN/JP).
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={paragraphStyle}>{children}</p>;
}

/** Inline code chip. */
function C({ children }: { children: React.ReactNode }) {
  return <code style={inlineCodeStyle}>{children}</code>;
}

/** Multi-line code example block. */
function CodeBlock({ children }: { children: string }) {
  return <pre style={codeBlockStyle}>{children}</pre>;
}

export function NoteHelpWindow() {
  const t = useT();

  // This window has its own JS context / Zustand instance: load UI prefs
  // (language) and follow changes made in the main window's Settings.
  useEffect(() => {
    useSettingsStore.getState().loadUiPreferences();
    const unlisten = onSettingsChanged(() => {
      useSettingsStore.getState().loadUiPreferences();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const T: Record<string, Entry> = {
    title: { en: "Writing Notes (Typst)", ja: "ノートの書き方 (Typst)" },
    basics: { en: "Basics & preview", ja: "基本とプレビュー" },
    basicsBody: {
      en: "Note content is raw Typst source. To see the typeset result, connect the note to a Render node (Tab menu → “0. Render”) and open it — a PDF preview is generated. Connect Render node(s) to an Export node to produce the final PDF.",
      ja: "ノート本文はTypstソースとして書きます。組版結果を見るには、ノートをレンダーノード（Tabメニュー →「0. Render」）に接続して開くと、PDFプレビューが生成されます。レンダーノードをExportノードにつなぐと最終PDFを出力できます。",
    },
    pull: { en: "Pulling info from connected nodes", ja: "接続ノードの情報を取り込む" },
    pullSlash: {
      en: "On an empty line, type / and choose /import — the content, abstract, or comments of nodes connected by an edge (Core, Paper, Note) can be inserted at the cursor.",
      ja: "空行で / を入力して /import を選ぶと、エッジで接続されたノード（Core・Paper・Note）の本文・アブストラクト・コメントをカーソル位置に取り込めます。",
    },
    pullMention: {
      en: "Type @ to open the mention list — insert the ID of a nearby node (within 5 hops) as a reference.",
      ja: "@ を入力するとメンション候補が開き、近くのノード（5ホップ以内）のIDを参照として挿入できます。",
    },
    cite: { en: "Citing papers", ja: "文献を引用する" },
    citeBody: {
      en: "Reference a Paper node by its ID (= BibTeX citation key). At render time it becomes a citation number and a bibliography (IEEE/APA, per the render node's setting) is appended.",
      ja: "PaperノードのID（= BibTeX引用キー）で参照します。レンダー時に引用番号に変換され、末尾に参考文献リスト（IEEE/APA、レンダーノードの設定に従う）が生成されます。",
    },
    citeMulti: { en: "Multiple citations:", ja: "複数引用:" },
    images: { en: "Inserting images", ja: "画像を挿入する" },
    imagesImport: {
      en: "Import: drag & drop an image file onto the canvas, or create an Image node via Tab menu → “3. Image” / right-click → “Import File”.",
      ja: "取り込み: 画像ファイルをキャンバスへドラッグ&ドロップ、またはTabメニュー →「3. Image」/ 右クリック →「Import File」でImageノードを作成します。",
    },
    imagesInsert: {
      en: "Insert with double braces — the image becomes a figure; its caption comes from the Image node's “Caption” field in the detail panel.",
      ja: "二重波括弧で挿入すると図として配置されます。キャプションにはImageノード詳細パネルの「Caption」欄が使われます。",
    },
    tables: { en: "Using table values", ja: "テーブルの値を使う" },
    tablesImport: {
      en: "Import: create a Table node via Tab menu → “9. Table”, then load a CSV / XLSX / ODS file in the detail panel (or edit the grid manually). “Reload latest” re-reads the file.",
      ja: "取り込み: Tabメニュー →「9. Table」でTableノードを作成し、詳細パネルでCSV / XLSX / ODSファイルを読み込みます（手動編集も可能）。「最新状態に更新」でファイルを再読込できます。",
    },
    tablesRef: {
      en: "Reference a single cell as {@id[row,col]} (0-based). Selecting a cell in the Table panel shows the reference code ready to copy.",
      ja: "セル1つを {@ID[行,列]}（0始まり）で参照できます。Tableパネルでセルを選択すると、コピー用の参照コードが表示されます。",
    },
    note: {
      en: "References resolve by node ID (the node's name) within the current layer, and are converted to real values in the render preview / PDF export.",
      ja: "参照は同じレイヤー内のノードID（ノード名）で解決され、レンダープレビュー / PDF出力時に実際の値へ変換されます。",
    },
  };

  return (
    <div style={windowStyle}>
      <div style={headerStyle}>
        <MenuBookIcon sx={{ fontSize: 18, color: ACCENT }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{t(T.title)}</span>
      </div>

      <div style={bodyStyle}>
        <Section title={t(T.basics)}>
          <P>{t(T.basicsBody)}</P>
          <CodeBlock>{`= Heading
== Subheading
*bold*  _italic_
- list item
$ E = m c^2 $`}</CodeBlock>
        </Section>

        <Section title={t(T.pull)}>
          <P>
            <C>/</C> — {t(T.pullSlash)}
          </P>
          <P>
            <C>@</C> — {t(T.pullMention)}
          </P>
        </Section>

        <Section title={t(T.cite)}>
          <P>{t(T.citeBody)}</P>
          <CodeBlock>{`{@smith2020}`}</CodeBlock>
          <P>
            {t(T.citeMulti)} <C>{"{@smith2020; @tanaka2023}"}</C>
          </P>
        </Section>

        <Section title={t(T.images)}>
          <P>{t(T.imagesImport)}</P>
          <P>{t(T.imagesInsert)}</P>
          <CodeBlock>{`{{@image_1}}`}</CodeBlock>
        </Section>

        <Section title={t(T.tables)}>
          <P>{t(T.tablesImport)}</P>
          <P>{t(T.tablesRef)}</P>
          <CodeBlock>{`{@table_1[0,1]}`}</CodeBlock>
        </Section>

        <div style={footNoteStyle}>{t(T.note)}</div>
      </div>
    </div>
  );
}

const windowStyle: React.CSSProperties = {
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  background: "#ffffff",
  color: "#1f2937",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 16px",
  borderBottom: "1px solid #f3f4f6",
  flexShrink: 0,
};

const bodyStyle: React.CSSProperties = {
  padding: "14px 16px",
  overflowY: "auto",
  fontSize: 13,
  lineHeight: 1.6,
  flex: 1,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: ACCENT,
  marginBottom: 4,
};

const paragraphStyle: React.CSSProperties = {
  margin: "0 0 6px",
  color: "#374151",
};

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 12,
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  borderRadius: 4,
  padding: "1px 5px",
  whiteSpace: "nowrap",
};

const codeBlockStyle: React.CSSProperties = {
  margin: "4px 0 6px",
  padding: "8px 10px",
  fontFamily: "monospace",
  fontSize: 12,
  lineHeight: 1.6,
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  whiteSpace: "pre",
  overflowX: "auto",
};

const footNoteStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  background: "#fffbeb",
  border: "1px solid #fde68a",
  borderRadius: 6,
  padding: "8px 10px",
  marginBottom: 8,
};

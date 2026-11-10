import { useState, useEffect, useCallback, useRef } from "react";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import TableChartIcon from "@mui/icons-material/TableChart";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { open } from "@tauri-apps/plugin-dialog";
import type { NodeData, TableModel, TableSource } from "../../types";
import { useGraphStore } from "../../store/graphStore";
import { importTableFile } from "../../lib/tauri-commands";
import { useT } from "../../lib/i18n";

const ACCENT = "#0f766e";
const BLANK_ROWS = 3;
const BLANK_COLS = 3;
const FILE_FILTERS = [
  { name: "Table", extensions: ["csv", "tsv", "xlsx", "xlsm", "xls", "ods"] },
];

interface TableNodeViewerProps {
  node: NodeData;
}

function parseModel(node: NodeData): TableModel {
  try {
    const m = node.metadata ? (JSON.parse(node.metadata) as TableModel) : null;
    if (m && (m.mode === "manual" || m.mode === "imported" || m.mode === "unconfigured")) {
      return {
        kind: "table",
        mode: m.mode,
        rows: Array.isArray(m.rows)
          ? m.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : []))
          : [],
        source: m.source ?? null,
      };
    }
    // Legacy / unknown metadata with rows → treat as manual.
    if (m && Array.isArray(m.rows)) {
      return { kind: "table", mode: "manual", rows: m.rows, source: m.source ?? null };
    }
  } catch {
    // ignore
  }
  return { kind: "table", mode: "unconfigured", rows: [], source: null };
}

function rectangularize(rows: string[][]): string[][] {
  const cols = rows.reduce((max, r) => Math.max(max, r.length), 0) || 1;
  return rows.map((r) => {
    const copy = [...r];
    while (copy.length < cols) copy.push("");
    return copy;
  });
}

export function TableNodeViewer({ node }: TableNodeViewerProps) {
  const updateNodeContent = useGraphStore((s) => s.updateNodeContent);
  const t = useT();

  const [model, setModel] = useState<TableModel>(() => parseModel(node));
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setModel(parseModel(node));
    setSelected(null);
    setError(null);
  }, [node.id, node.metadata]);

  const mode = model.mode;
  const displayId = node.display_id ?? "table";
  const rows = model.rows;
  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);

  // ── Persistence ──
  // Debounced (manual cell edits)
  const saveModelDebounced = useCallback(
    (next: TableModel) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateNodeContent(node.id, { metadata: JSON.stringify(next) });
      }, 800);
    },
    [node.id, updateNodeContent],
  );

  // Immediate (structural / mode changes / imports)
  const persistModel = useCallback(
    (next: TableModel, newTitle?: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setModel(next);
      const fields: { metadata: string; title?: string } = { metadata: JSON.stringify(next) };
      if (newTitle !== undefined) {
        fields.title = newTitle;
      }
      updateNodeContent(node.id, fields);
    },
    [node.id, updateNodeContent],
  );

  const commit = useCallback(
    (nextRows: string[][]) => {
      const next: TableModel = { ...model, rows: rectangularize(nextRows) };
      setModel(next);
      saveModelDebounced(next);
    },
    [model, saveModelDebounced],
  );

  // ── Mode selection (unconfigured) ──
  const chooseManual = useCallback(() => {
    const blank: string[][] = Array.from({ length: BLANK_ROWS }, () =>
      Array.from({ length: BLANK_COLS }, () => ""),
    );
    persistModel({ kind: "table", mode: "manual", rows: blank, source: null });
  }, [persistModel]);

  // ── Import / reload from file ──
  const doImport = useCallback(
    async (path: string, updateTitle: boolean) => {
      setError(null);
      setBusy(true);
      try {
        const result = await importTableFile(path);
        const source: TableSource = {
          format: result.format,
          filename: result.filename,
          path,
          sheet: result.sheet,
        };
        const next: TableModel = { kind: "table", mode: "imported", rows: result.rows, source };
        persistModel(next, updateTitle ? result.filename : undefined);
        setSelected(null);
      } catch (err) {
        console.error("Table import failed:", err);
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [persistModel],
  );

  const pickAndImport = useCallback(
    async (updateTitle: boolean) => {
      try {
        const path = await open({ multiple: false, filters: FILE_FILTERS });
        if (typeof path !== "string") return;
        await doImport(path, updateTitle);
      } catch (err) {
        console.error("File pick failed:", err);
        setError(String(err));
      }
    },
    [doImport],
  );

  const reloadSamePath = useCallback(() => {
    const path = model.source?.path;
    if (!path) return;
    doImport(path, false);
  }, [model.source, doImport]);

  // ── Copy citation reference for the selected cell ──
  const handleCopyRef = useCallback(async () => {
    if (!selected) return;
    const ref = `{@${displayId}[${selected.r},${selected.c}]}`;
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [selected, displayId]);

  // ── Render: unconfigured chooser ──
  if (mode === "unconfigured") {
    return (
      <div style={containerStyle}>
        <div style={sectionStyle}>
          <div style={displayIdLineStyle}>{displayId}</div>
        </div>

        <p style={chooserHintStyle}>{t("table.chooser.hint")}</p>
        <div style={choicesStyle}>
          <button onClick={chooseManual} style={choiceBtnStyle} disabled={busy}>
            <TableChartIcon sx={{ fontSize: 28, color: ACCENT }} />
            <span style={choiceLabelStyle}>{t("table.chooser.createNew")}</span>
            <span style={choiceDescStyle}>{t("table.chooser.createNewDesc", { rows: BLANK_ROWS, cols: BLANK_COLS })}</span>
          </button>
          <button onClick={() => pickAndImport(true)} style={choiceBtnStyle} disabled={busy}>
            <UploadFileIcon sx={{ fontSize: 28, color: ACCENT }} />
            <span style={choiceLabelStyle}>{busy ? t("common.loading") : t("table.chooser.importFile")}</span>
            <span style={choiceDescStyle}>{t("table.chooser.importFileDesc")}</span>
          </button>
        </div>
        {error && <div style={errorStyle}>{error}</div>}
      </div>
    );
  }

  const isManual = mode === "manual";

  return (
    <div style={containerStyle}>
      {/* Node id */}
      <div style={sectionStyle}>
        <div style={displayIdLineStyle}>{displayId}</div>
      </div>

      {/* Mode / source info */}
      <div style={metaRowStyle}>
        <span style={modeBadgeStyle}>{isManual ? t("table.mode.manualEditable") : t("table.mode.importedReadonly")}</span>
        {model.source && (
          <span style={sourceTextStyle} title={model.source.path}>
            {model.source.filename}
            {model.source.sheet ? ` · ${model.source.sheet}` : ""}
          </span>
        )}
      </div>

      {/* Imported: reload / replace controls */}
      {!isManual && (
        <div style={importActionsStyle}>
          <button
            onClick={reloadSamePath}
            style={controlBtnStyle}
            disabled={busy || !model.source?.path}
            title={model.source?.path ?? t("table.tip.noStoredPath")}
          >
            <RefreshIcon sx={{ fontSize: 14 }} /> {busy ? t("common.loading") : t("table.action.reload")}
          </button>
          <button onClick={() => pickAndImport(true)} style={controlBtnStyle} disabled={busy}>
            <SwapHorizIcon sx={{ fontSize: 14 }} /> {t("table.action.replaceFile")}
          </button>
        </div>
      )}
      {error && <div style={errorStyle}>{error}</div>}

      {/* Selected cell reference */}
      <div style={refBarStyle}>
        {selected ? (
          <>
            <code style={refCodeStyle}>{`{@${displayId}[${selected.r},${selected.c}]}`}</code>
            <button onClick={handleCopyRef} style={copyBtnStyle} title={t("table.action.copyRefTitle")}>
              <ContentCopyIcon sx={{ fontSize: 13 }} />
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </>
        ) : (
          <span style={refHintStyle}>{t("table.refHint", { id: displayId })}</span>
        )}
      </div>

      {/* Grid */}
      <div style={gridScrollStyle}>
        <table style={gridTableStyle}>
          <thead>
            <tr>
              <th style={cornerCellStyle}></th>
              {Array.from({ length: colCount }).map((_, ci) => (
                <th key={ci} style={indexHeaderStyle}>
                  <span>{ci}</span>
                  {isManual && colCount > 1 && (
                    <button
                      onClick={() => removeColumn(ci)}
                      style={miniDeleteBtnStyle}
                      title={t("table.action.deleteColumn")}
                    >
                      <CloseIcon sx={{ fontSize: 10 }} />
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <th style={indexHeaderStyle}>
                  <span>{ri}</span>
                  {isManual && rows.length > 1 && (
                    <button
                      onClick={() => removeRow(ri)}
                      style={miniDeleteBtnStyle}
                      title={t("table.action.deleteRow")}
                    >
                      <CloseIcon sx={{ fontSize: 10 }} />
                    </button>
                  )}
                </th>
                {Array.from({ length: colCount }).map((_, ci) => {
                  const isSel = selected?.r === ri && selected?.c === ci;
                  const value = row[ci] ?? "";
                  return (
                    <td key={ci} style={{ ...dataCellStyle, ...(isSel ? selectedCellStyle : null) }}>
                      {isManual ? (
                        <input
                          type="text"
                          value={value}
                          onChange={(e) => handleCellChange(ri, ci, e.target.value)}
                          onFocus={() => setSelected({ r: ri, c: ci })}
                          style={cellInputStyle}
                        />
                      ) : (
                        <div
                          onClick={() => setSelected({ r: ri, c: ci })}
                          style={readonlyCellStyle}
                          title={value}
                        >
                          {value}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Manual: structural controls */}
      {isManual && (
        <div style={controlsRowStyle}>
          <button onClick={addRow} style={controlBtnStyle}>
            <AddIcon sx={{ fontSize: 14 }} /> {t("table.action.addRow")}
          </button>
          <button onClick={addColumn} style={controlBtnStyle}>
            <AddIcon sx={{ fontSize: 14 }} /> {t("table.action.addColumn")}
          </button>
        </div>
      )}
    </div>
  );

  // ── Cell / structure handlers (manual only) ──
  function handleCellChange(r: number, c: number, value: string) {
    const next = rows.map((rowArr) => [...rowArr]);
    next[r][c] = value;
    commit(next);
  }
  function addRow() {
    const cols = colCount || 1;
    commit([...rows.map((r) => [...r]), Array.from({ length: cols }, () => "")]);
  }
  function addColumn() {
    commit(rows.map((r) => [...r, ""]));
  }
  function removeRow(idx: number) {
    if (rows.length <= 1) return;
    commit(rows.filter((_, i) => i !== idx));
  }
  function removeColumn(idx: number) {
    if (colCount <= 1) return;
    commit(rows.map((r) => r.filter((_, i) => i !== idx)));
  }
}

// ─── Styles ───

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "8px 0",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

// Node id — the table's name; also what {@id[r,c]} references use.
const displayIdLineStyle: React.CSSProperties = {
  fontSize: 13,
  fontFamily: "monospace",
  color: "#0f766e",
};

const chooserHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "#4b5563",
};

const choicesStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
};

const choiceBtnStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  padding: "18px 12px",
  background: "rgba(15,118,110,0.04)",
  border: `1px solid ${ACCENT}`,
  borderRadius: 8,
  cursor: "pointer",
  textAlign: "center",
};

const choiceLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#111827",
};

const choiceDescStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
};

const metaRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const modeBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: ACCENT,
  background: "rgba(15,118,110,0.12)",
  borderRadius: 4,
  padding: "2px 8px",
};

const sourceTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
  fontFamily: "monospace",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "100%",
};

const importActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const refBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 28,
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "4px 8px",
};

const refCodeStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: "monospace",
  color: ACCENT,
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const copyBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  fontWeight: 600,
  color: "#fff",
  background: ACCENT,
  border: "none",
  borderRadius: 4,
  padding: "4px 8px",
  cursor: "pointer",
  flexShrink: 0,
};

const refHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
};

const gridScrollStyle: React.CSSProperties = {
  overflow: "auto",
  maxHeight: 360,
  border: "1px solid #e5e7eb",
  borderRadius: 6,
};

const gridTableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "max-content",
  minWidth: "100%",
};

const cornerCellStyle: React.CSSProperties = {
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  width: 32,
  position: "sticky",
  left: 0,
  zIndex: 1,
};

const indexHeaderStyle: React.CSSProperties = {
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  fontSize: 10,
  fontFamily: "monospace",
  color: "#6b7280",
  fontWeight: 600,
  padding: "2px 4px",
  textAlign: "center",
  minWidth: 28,
  whiteSpace: "nowrap",
};

const miniDeleteBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#9ca3af",
  padding: 0,
  marginLeft: 2,
  verticalAlign: "middle",
};

const dataCellStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  padding: 0,
};

const selectedCellStyle: React.CSSProperties = {
  outline: `2px solid ${ACCENT}`,
  outlineOffset: -2,
};

const cellInputStyle: React.CSSProperties = {
  border: "none",
  outline: "none",
  fontSize: 12,
  padding: "4px 6px",
  width: 110,
  background: "transparent",
  boxSizing: "border-box",
};

const readonlyCellStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 6px",
  minWidth: 80,
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const controlsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
};

const controlBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  fontWeight: 500,
  color: "#374151",
  background: "#fff",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#dc2626",
  wordBreak: "break-word",
};

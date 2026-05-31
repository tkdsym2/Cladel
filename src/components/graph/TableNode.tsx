import { useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import TableChartIcon from "@mui/icons-material/TableChart";
import { useGraphStore } from "../../store/graphStore";
import { useConnectedDisplayIds } from "./useConnectedDisplayIds";
import { useT } from "../../lib/i18n";
import type { TableModel } from "../../types";

const ACCENT = "#0f766e";

type TableNodeData = {
  title: string;
  content: string | null;
  display_id?: string | null;
  metadata?: string | null;
  commentCount?: number;
  [key: string]: unknown;
};

function parseModel(metadata: string | null | undefined): TableModel | null {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata) as TableModel;
    if (m && Array.isArray(m.rows)) return m;
  } catch {
    // ignore
  }
  return null;
}

export function TableNode({ id, data, selected }: NodeProps<Node<TableNodeData>>) {
  const title = data.title;
  const displayId = (data.display_id as string) ?? null;
  const updateNodeSize = useGraphStore((s) => s.updateNodeSize);
  const connectedRefs = useConnectedDisplayIds(id);
  const t = useT();

  const model = parseModel(data.metadata as string | null | undefined);
  const rows = model?.rows ?? [];
  const rowCount = rows.length;
  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const mode = model?.mode ?? "manual";

  // Small preview grid: first 4 rows × 4 columns
  const previewRows = rows.slice(0, 4);
  const previewCols = Math.min(colCount, 4);

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
          background: "rgba(15,118,110,0.08)",
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
            ? "0 0 0 3px rgba(15,118,110,0.3)"
            : "0 1px 4px rgba(0,0,0,0.1)",
        }}
      >
        {displayId && <div style={displayIdLabelStyle}>{displayId}</div>}
        <div style={headerStyle}>
          <TableChartIcon sx={{ fontSize: 16, color: ACCENT }} />
          <span style={{ fontWeight: 600, wordBreak: "break-word", flex: 1 }}>{title}</span>
          <span style={modeBadgeStyle}>
            {mode === "imported"
              ? t("table.badge.imported")
              : mode === "manual"
                ? t("table.badge.manual")
                : t("table.badge.unconfigured")}
          </span>
        </div>

        {mode === "unconfigured" ? (
          <div style={hintStyle}>{t("table.node.unconfiguredHint")}</div>
        ) : previewRows.length > 0 && previewCols > 0 ? (
          <div style={previewWrapStyle}>
            <table style={previewTableStyle}>
              <tbody>
                {previewRows.map((row, ri) => (
                  <tr key={ri}>
                    {Array.from({ length: previewCols }).map((_, ci) => (
                      <td key={ci} style={previewCellStyle}>
                        {(row[ci] ?? "").slice(0, 12)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={infoStyle}>Empty table</div>
        )}

        {mode !== "unconfigured" && (
          <div style={infoStyle}>
            {rowCount} × {colCount}
          </div>
        )}
        {connectedRefs && <div style={connectedRefsStyle}>↔ {connectedRefs}</div>}

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
  background: ACCENT,
  border: "2px solid rgba(15,118,110,0.15)",
};

const displayIdLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "monospace",
  color: "#9ca3af",
  lineHeight: 1,
  marginBottom: 2,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 4,
};

const modeBadgeStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  color: ACCENT,
  background: "rgba(15,118,110,0.12)",
  borderRadius: 4,
  padding: "1px 5px",
  whiteSpace: "nowrap",
};

const previewWrapStyle: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
  marginBottom: 4,
};

const previewTableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  tableLayout: "fixed",
};

const previewCellStyle: React.CSSProperties = {
  border: "1px solid rgba(15,118,110,0.25)",
  fontSize: 9,
  padding: "1px 3px",
  color: "#374151",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 0,
};

const infoStyle: React.CSSProperties = {
  fontSize: 11,
  color: ACCENT,
  fontWeight: 500,
};

const hintStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  fontSize: 11,
  color: "#6b7280",
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
  borderColor: "rgba(15,118,110,0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: ACCENT,
  border: "1px solid #115e59",
};

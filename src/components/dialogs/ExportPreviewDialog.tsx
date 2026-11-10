import { useMemo } from "react";
import CloseIcon from "@mui/icons-material/Close";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { convertFileSrc } from "@tauri-apps/api/core";
import * as cmd from "../../lib/tauri-commands";

interface ExportPreviewDialogProps {
  open: boolean;
  /** Absolute path of the preview PDF in the app temp dir. */
  pdfPath: string | null;
  /** Cache-buster — bump on every regeneration so the embed reloads. */
  version: number;
  /** True while a PDF generation (save) is running. */
  saving: boolean;
  onClose: () => void;
  /** Ask the user for a destination and write the final PDF. */
  onSave: () => void;
}

/**
 * Modal preview of the exported PDF, shown before the user commits to saving.
 * The PDF itself is rendered by the WebView's native viewer via the asset
 * protocol; "Open externally" is the fallback if inline rendering fails.
 */
export function ExportPreviewDialog({
  open,
  pdfPath,
  version,
  saving,
  onClose,
  onSave,
}: ExportPreviewDialogProps) {
  const src = useMemo(
    () => (pdfPath ? `${convertFileSrc(pdfPath)}?v=${version}` : null),
    [pdfPath, version],
  );

  if (!open || !src) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <PictureAsPdfIcon sx={{ fontSize: 18, color: "#e11d48" }} />
          <span style={titleStyle}>PDF Preview</span>
          <button onClick={onClose} style={iconBtnStyle} title="Close">
            <CloseIcon sx={{ fontSize: 18 }} />
          </button>
        </div>

        <div style={bodyStyle}>
          <embed key={src} src={src} type="application/pdf" style={embedStyle} />
        </div>

        <div style={footerStyle}>
          <span style={hintStyle}>Preview only — nothing has been saved yet.</span>
          <button
            onClick={() => {
              if (pdfPath) void cmd.openFileExternal(pdfPath);
            }}
            style={secondaryBtnStyle}
            title="Open the preview PDF in the system viewer"
          >
            <OpenInNewIcon sx={{ fontSize: 14 }} />
            Open externally
          </button>
          <button onClick={onSave} disabled={saving} style={primaryBtnStyle}>
            <PictureAsPdfIcon sx={{ fontSize: 15 }} />
            {saving ? "Saving..." : "Save PDF..."}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const panelStyle: React.CSSProperties = {
  width: "min(92vw, 900px)",
  height: "90vh",
  background: "#ffffff",
  borderRadius: 10,
  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderBottom: "1px solid #e5e7eb",
};

const titleStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 14,
  fontWeight: 600,
  color: "#111827",
};

const iconBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#6b7280",
  padding: 4,
  borderRadius: 4,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  background: "#f3f4f6",
  display: "flex",
};

const embedStyle: React.CSSProperties = {
  flex: 1,
  width: "100%",
  height: "100%",
  border: "none",
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 14px",
  borderTop: "1px solid #e5e7eb",
};

const hintStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 12,
  color: "#6b7280",
};

const secondaryBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  background: "none",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "7px 12px",
  fontSize: 12,
  fontWeight: 500,
  color: "#374151",
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  background: "#e11d48",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

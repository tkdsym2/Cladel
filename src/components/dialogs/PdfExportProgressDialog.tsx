import { useEffect, useRef } from "react";
import { useExportStore } from "../../store/exportStore";

// ─── Progress Dialog (shown in the window that initiated the export) ───

interface PdfExportProgressDialogProps {
  open: boolean;
  onDone: () => void;
}

export function PdfExportProgressDialog({ open, onDone }: PdfExportProgressDialogProps) {
  const progress = useExportStore((s) => s.progress);
  const exportError = useExportStore((s) => s.exportError);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss after "done" stage
  useEffect(() => {
    if (!open) return;
    if (progress.stage === "done" && !exportError) {
      doneTimerRef.current = setTimeout(onDone, 600);
      return () => {
        if (doneTimerRef.current) {
          clearTimeout(doneTimerRef.current);
          doneTimerRef.current = null;
        }
      };
    }
  }, [open, progress.stage, exportError, onDone]);

  if (!open) return null;

  const displayError = exportError != null;
  const isDone = progress.stage === "done";

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <div style={headerStyle}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>
            {displayError ? "Export Failed" : isDone ? "Export Complete" : "Exporting PDF..."}
          </span>
        </div>

        <div style={bodyStyle}>
          <div style={trackStyle}>
            <div
              style={{
                ...barStyle,
                width: `${displayError ? 100 : progress.percent}%`,
                background: displayError
                  ? "#ef4444"
                  : isDone
                    ? "#10b981"
                    : "#3b82f6",
                transition: "width 0.3s ease, background 0.3s ease",
              }}
            />
          </div>

          <div style={messageStyle}>
            {displayError ? (
              <span style={{ color: "#ef4444" }}>{exportError}</span>
            ) : (
              <>
                <span style={{ color: "#374151" }}>{progress.message}</span>
                <span style={{ color: "#9ca3af", marginLeft: 8 }}>
                  {progress.percent}%
                </span>
              </>
            )}
          </div>

          {displayError && (
            <button onClick={onDone} style={closeBtnStyle}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Blocking Overlay (shown in windows that did NOT initiate the export) ───

export function ExportBlockingOverlay() {
  return (
    <div style={overlayStyle}>
      <div style={blockingDialogStyle}>
        <div style={spinnerStyle} />
        <span style={{ fontSize: 14, color: "#e5e7eb", marginTop: 12 }}>
          PDF export in progress...
        </span>
      </div>
    </div>
  );
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10000,
};

const dialogStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 12,
  width: 420,
  maxWidth: "90vw",
  boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  padding: "16px 20px 12px",
};

const bodyStyle: React.CSSProperties = {
  padding: "0 20px 20px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const trackStyle: React.CSSProperties = {
  width: "100%",
  height: 8,
  background: "#e5e7eb",
  borderRadius: 4,
  overflow: "hidden",
};

const barStyle: React.CSSProperties = {
  height: "100%",
  borderRadius: 4,
  minWidth: 0,
};

const messageStyle: React.CSSProperties = {
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  minHeight: 20,
};

const closeBtnStyle: React.CSSProperties = {
  alignSelf: "flex-end",
  padding: "6px 16px",
  fontSize: 13,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  background: "#f9fafb",
  cursor: "pointer",
  color: "#374151",
};

const blockingDialogStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

const spinnerStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: "3px solid rgba(255,255,255,0.2)",
  borderTopColor: "#ffffff",
  borderRadius: "50%",
  animation: "export-spin 1s linear infinite",
};

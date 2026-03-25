import { useState, useEffect, useCallback, useRef } from "react";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

type UpdateState =
  | { phase: "checking" }
  | { phase: "available"; version: string; body: string }
  | { phase: "downloading"; version: string; progress: number }
  | { phase: "installing"; version: string }
  | { phase: "done"; version: string }
  | { phase: "error"; message: string };

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UpdateDialog({ open, onClose }: Props) {
  const [state, setState] = useState<UpdateState>({ phase: "checking" });
  const updateRef = useRef<Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>> | null>(null);

  // Check for updates on mount
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (cancelled) return;

        if (update) {
          updateRef.current = update;
          setState({
            phase: "available",
            version: update.version,
            body: update.body ?? "",
          });
        } else {
          // No update — close silently
          onClose();
        }
      } catch (err) {
        if (cancelled) return;
        setState({ phase: "error", message: String(err) });
      }
    })();

    return () => { cancelled = true; };
  }, [open, onClose]);

  const handleUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    const version = update.version;
    setState({ phase: "downloading", version, progress: 0 });

    try {
      let contentLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = (event.data as { contentLength?: number }).contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += (event.data as { chunkLength: number }).chunkLength;
          const pct = contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0;
          setState({ phase: "downloading", version, progress: pct });
        } else if (event.event === "Finished") {
          setState({ phase: "installing", version });
        }
      });

      setState({ phase: "done", version });
    } catch (err) {
      setState({ phase: "error", message: String(err) });
    }
  }, []);

  const handleRestart = useCallback(async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      // Fallback: just inform the user
      setState({ phase: "error", message: "Please restart the application manually." });
    }
  }, []);

  if (!open) return null;

  // While checking, don't show anything visible (silent check)
  if (state.phase === "checking") return null;

  return (
    <div style={overlayStyle} onClick={state.phase === "available" || state.phase === "error" ? onClose : undefined}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        {/* Available state */}
        {state.phase === "available" && (
          <>
            <div style={headerStyle}>
              <SystemUpdateAltIcon sx={{ fontSize: 36, color: "#1e40af" }} />
              <div style={titleStyle}>Update Available</div>
              <div style={versionStyle}>v{state.version}</div>
            </div>

            {state.body && (
              <div style={bodyContainerStyle}>
                <div style={bodyLabelStyle}>Release Notes</div>
                <div style={bodyStyle}>{state.body}</div>
              </div>
            )}

            <div style={buttonRowStyle}>
              <button onClick={onClose} style={laterButtonStyle}>
                Later
              </button>
              <button onClick={handleUpdate} style={updateButtonStyle}>
                Update Now
              </button>
            </div>
          </>
        )}

        {/* Downloading state */}
        {state.phase === "downloading" && (
          <>
            <div style={headerStyle}>
              <SystemUpdateAltIcon sx={{ fontSize: 36, color: "#1e40af" }} />
              <div style={titleStyle}>Downloading v{state.version}</div>
              <div style={subtextStyle}>{state.progress}%</div>
            </div>

            <div style={progressContainerStyle}>
              <div style={progressTrackStyle}>
                <div style={{ ...progressBarStyle, width: `${state.progress}%` }} />
              </div>
            </div>

            <div style={{ ...subtextStyle, textAlign: "center", marginTop: 8 }}>
              Please wait while the update is downloaded...
            </div>
          </>
        )}

        {/* Installing state */}
        {state.phase === "installing" && (
          <div style={headerStyle}>
            <SystemUpdateAltIcon sx={{ fontSize: 36, color: "#1e40af" }} />
            <div style={titleStyle}>Installing v{state.version}</div>
            <div style={subtextStyle}>Please wait...</div>
            <div style={progressContainerStyle}>
              <div style={progressTrackStyle}>
                <div style={{ ...progressBarStyle, width: "100%", animation: "pulse 1.5s ease-in-out infinite" }} />
              </div>
            </div>
          </div>
        )}

        {/* Done state */}
        {state.phase === "done" && (
          <>
            <div style={headerStyle}>
              <CheckCircleOutlineIcon sx={{ fontSize: 36, color: "#059669" }} />
              <div style={titleStyle}>Update Installed</div>
              <div style={subtextStyle}>v{state.version} is ready. Restart to apply.</div>
            </div>

            <div style={buttonRowStyle}>
              <button onClick={onClose} style={laterButtonStyle}>
                Later
              </button>
              <button onClick={handleRestart} style={updateButtonStyle}>
                Restart Now
              </button>
            </div>
          </>
        )}

        {/* Error state */}
        {state.phase === "error" && (
          <>
            <div style={headerStyle}>
              <ErrorOutlineIcon sx={{ fontSize: 36, color: "#dc2626" }} />
              <div style={titleStyle}>Update Failed</div>
              <div style={errorTextStyle}>{state.message}</div>
            </div>

            <div style={buttonRowStyle}>
              <button onClick={onClose} style={laterButtonStyle}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 4000,
  background: "rgba(0,0,0,0.3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 16,
  padding: "32px 36px 28px",
  width: 440,
  maxWidth: "90vw",
  boxShadow: "0 8px 40px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)",
};

const headerStyle: React.CSSProperties = {
  textAlign: "center",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  marginBottom: 20,
};

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: "#111827",
};

const versionStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#1e40af",
};

const subtextStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
};

const bodyContainerStyle: React.CSSProperties = {
  marginBottom: 20,
};

const bodyLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 6,
};

const bodyStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#4b5563",
  lineHeight: 1.6,
  maxHeight: 180,
  overflowY: "auto",
  padding: "10px 12px",
  background: "#f9fafb",
  borderRadius: 8,
  border: "1px solid #f3f4f6",
  whiteSpace: "pre-wrap",
};

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
};

const laterButtonStyle: React.CSSProperties = {
  padding: "9px 20px",
  background: "#f3f4f6",
  color: "#374151",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const updateButtonStyle: React.CSSProperties = {
  padding: "9px 20px",
  background: "#1e40af",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const progressContainerStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 4,
};

const progressTrackStyle: React.CSSProperties = {
  width: "100%",
  height: 6,
  background: "#e5e7eb",
  borderRadius: 3,
  overflow: "hidden",
};

const progressBarStyle: React.CSSProperties = {
  height: "100%",
  background: "#1e40af",
  borderRadius: 3,
  transition: "width 0.3s ease",
};

const errorTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#dc2626",
  maxHeight: 80,
  overflowY: "auto",
  wordBreak: "break-word",
};

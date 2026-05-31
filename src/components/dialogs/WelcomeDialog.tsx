import { useState, useEffect, useCallback } from "react";
import NoteAddOutlinedIcon from "@mui/icons-material/NoteAddOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import CloseIcon from "@mui/icons-material/Close";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import * as cmd from "../../lib/tauri-commands";
import { useFileStore } from "../../store/fileStore";
import { useTabStore } from "../../store/tabStore";
import { useUserStore } from "../../store/userStore";
import type { RecentFile } from "../../types";

interface Props {
  open: boolean;
  onNewFile: () => void;
  onFileOpened: () => void;
  /** If provided, dialog is dismissible (shows close button, click-outside closes). */
  onClose?: () => void;
  /** If provided, shows a Quit button to close the application. */
  onQuit?: () => void;
}

export function WelcomeDialog({ open, onNewFile, onFileOpened, onClose, onQuit }: Props) {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const openFilePath = useFileStore((s) => s.openFilePath);
  const openFile = useFileStore((s) => s.openFile);
  const openSample = useFileStore((s) => s.openSample);
  const tabs = useTabStore((s) => s.tabs);

  // User registration state
  const isRegistered = useUserStore((s) => s.isRegistered);
  const [regName, setRegName] = useState("");
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  const handleRegister = useCallback(async () => {
    const trimmed = regName.trim();
    if (!trimmed) {
      setRegError("Please enter your name.");
      return;
    }
    setRegLoading(true);
    setRegError("");
    try {
      const identity = await cmd.registerUser(trimmed);
      useUserStore.getState().setUser(identity.user_id!, identity.user_name!);
    } catch (err) {
      setRegError(String(err));
    } finally {
      setRegLoading(false);
    }
  }, [regName]);

  // Set of file paths currently open in tabs
  const openFilePaths = new Set(
    tabs.map((t) => t.file_path).filter((p): p is string => p !== null),
  );

  useEffect(() => {
    if (!open) return;
    cmd.getRecentFiles().then(setRecentFiles).catch(() => {});
  }, [open]);

  const handleOpenSample = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Open the sample as a read-only template (untitled → first save is Save As).
      await openSample();
      onFileOpened();
    } catch (err) {
      console.error("Failed to open sample file:", err);
    } finally {
      setLoading(false);
    }
  }, [loading, openSample, onFileOpened]);

  const handleOpenRecent = useCallback(
    async (file: RecentFile) => {
      if (loading) return;
      setLoading(true);
      setFileErrors((prev) => {
        const next = { ...prev };
        delete next[file.path];
        return next;
      });
      try {
        await openFilePath(file.path);
        onFileOpened();
      } catch {
        setFileErrors((prev) => ({ ...prev, [file.path]: "File not found" }));
        cmd.removeRecentFile(file.path).catch(() => {});
        setRecentFiles((prev) => prev.filter((f) => f.path !== file.path));
      } finally {
        setLoading(false);
      }
    },
    [loading, openFilePath, onFileOpened],
  );

  const handleBrowse = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await openFile();
      const path = useFileStore.getState().currentFilePath;
      if (path) {
        onFileOpened();
      }
    } catch {
      // User cancelled or error
    } finally {
      setLoading(false);
    }
  }, [loading, openFile, onFileOpened]);

  if (!open) return null;

  const dismissible = !!onClose;

  return (
    <div
      style={{
        ...overlayStyle,
        ...(dismissible ? { background: "rgba(0,0,0,0.3)", cursor: "pointer" } : {}),
      }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        style={cardStyle}
        onClick={dismissible ? (e) => e.stopPropagation() : undefined}
      >
        {/* Header */}
        <div style={{ ...headerStyle, position: "relative" }}>
          <span style={logoStyle}>Cladel</span>
          <span style={subtitleStyle}>Research Thought-Mapping</span>
          {dismissible && (
            <button
              onClick={onClose}
              style={dialogCloseButtonStyle}
              title="Close"
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </button>
          )}
          {onQuit && (
            <button
              onClick={onQuit}
              style={quitButtonStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#fee2e2";
                e.currentTarget.style.borderColor = "#fca5a5";
                e.currentTarget.style.color = "#dc2626";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#f9fafb";
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.color = "#6b7280";
              }}
            >
              Quit
            </button>
          )}
        </div>

        {/* Registration step (shown if user is not registered) */}
        {!isRegistered ? (
          <div style={registrationStyle}>
            <PersonOutlineIcon sx={{ fontSize: 36, color: "#1e40af", mb: "4px" }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: "#111827", marginBottom: 4 }}>
              Welcome to Cladel!
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>
              Please enter your name to get started.
            </div>
            <input
              type="text"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleRegister(); }}
              placeholder="Your name"
              disabled={regLoading}
              style={regInputStyle}
              autoFocus
            />
            {regError && (
              <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{regError}</div>
            )}
            <button
              onClick={handleRegister}
              disabled={regLoading || !regName.trim()}
              style={{
                ...regButtonStyle,
                opacity: regLoading || !regName.trim() ? 0.6 : 1,
              }}
            >
              {regLoading ? "Registering..." : "Get Started"}
            </button>
          </div>
        ) : (
        /* Main layout */
        <div style={panelsStyle}>
          {/* Left panel: Open Sample + Create New */}
          <div style={leftPanelStyle}>
            <button
              onClick={handleOpenSample}
              disabled={loading}
              style={sampleButtonStyle}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.borderColor = "#1e40af";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#93c5fd";
              }}
            >
              <ScienceOutlinedIcon sx={{ fontSize: 32, color: "#1e40af", mb: "4px" }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#1e40af" }}>
                Open Sample
              </span>
              <span style={{ fontSize: 11, color: "#6b7280", marginTop: 2, textAlign: "center" }}>
                Explore the demo project
              </span>
            </button>

            <button
              onClick={onNewFile}
              disabled={loading}
              style={newFilePanelStyle}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.borderColor = "#1e40af";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#d1d5db";
              }}
            >
              <NoteAddOutlinedIcon sx={{ fontSize: 32, color: "#6b7280", mb: "4px" }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>
                Create New File
              </span>
              <span style={{ fontSize: 11, color: "#9ca3af", marginTop: 2, textAlign: "center" }}>
                Start a fresh project
              </span>
            </button>
          </div>

          {/* Right panel: Recent Files */}
          <div style={recentPanelStyle}>
            <div style={recentHeaderStyle}>Recent Files</div>

            {recentFiles.length === 0 ? (
              <div style={emptyStateStyle}>
                <span style={{ color: "#9ca3af", fontSize: 13 }}>
                  No recent files
                </span>
                <span style={{ color: "#d1d5db", fontSize: 11, marginTop: 4 }}>
                  Open or create a file to get started
                </span>
              </div>
            ) : (
              <div style={recentListStyle}>
                {recentFiles.map((file) => {
                  const isAlreadyOpen = openFilePaths.has(file.path);
                  return (
                    <button
                      key={file.path}
                      onClick={() => !isAlreadyOpen && handleOpenRecent(file)}
                      disabled={loading || isAlreadyOpen}
                      style={{
                        ...recentItemStyle,
                        ...(isAlreadyOpen ? { opacity: 0.55, cursor: "default" } : {}),
                      }}
                      onMouseEnter={(e) => {
                        if (!loading && !isAlreadyOpen) e.currentTarget.style.background = "#f9fafb";
                      }}
                      onMouseLeave={(e) => {
                        if (!isAlreadyOpen) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <InsertDriveFileOutlinedIcon
                        sx={{ fontSize: 18, color: "#6b7280", flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <div style={fileNameStyle}>{file.name}</div>
                        <div style={filePathStyle} title={file.path}>
                          {abbreviatePath(file.path)}
                        </div>
                        {fileErrors[file.path] && (
                          <div style={fileErrorStyle}>{fileErrors[file.path]}</div>
                        )}
                      </div>
                      {isAlreadyOpen ? (
                        <div style={alreadyOpenBadgeStyle}>Open</div>
                      ) : (
                        <div style={fileDateStyle}>{formatDate(file.last_opened)}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Browse button */}
            <button
              onClick={handleBrowse}
              disabled={loading}
              style={browseButtonStyle}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.background = "#f3f4f6";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <FolderOpenOutlinedIcon sx={{ fontSize: 16, color: "#6b7280" }} />
              <span>Browse Other File...</span>
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ───

function abbreviatePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const home = normalized.match(/^\/Users\/[^/]+/)?.[0];
  if (home) {
    return "~" + normalized.slice(home.length);
  }
  return normalized;
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: now.getFullYear() !== date.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "";
  }
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 3000,
  background: "#f1f5f9",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 16,
  padding: "36px 40px 32px",
  width: 640,
  maxWidth: "92vw",
  boxShadow: "0 8px 40px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)",
};

const headerStyle: React.CSSProperties = {
  textAlign: "center",
  marginBottom: 28,
};

const logoStyle: React.CSSProperties = {
  display: "block",
  fontSize: 24,
  fontWeight: 800,
  color: "#1e40af",
  letterSpacing: -0.5,
};

const subtitleStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#9ca3af",
  marginTop: 4,
  letterSpacing: 0.3,
};

const panelsStyle: React.CSSProperties = {
  display: "flex",
  gap: 20,
  minHeight: 260,
};

const leftPanelStyle: React.CSSProperties = {
  flex: "0 0 200px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const sampleButtonStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  border: "2px solid #93c5fd",
  borderRadius: 12,
  background: "#eff6ff",
  cursor: "pointer",
  transition: "border-color 0.15s",
  padding: "16px 12px",
};

const newFilePanelStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  border: "2px dashed #d1d5db",
  borderRadius: 12,
  background: "#fafbfc",
  cursor: "pointer",
  transition: "border-color 0.15s",
  padding: "16px 12px",
};

const recentPanelStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};

const recentHeaderStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 8,
};

const emptyStateStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  border: "1px solid #f3f4f6",
  padding: 24,
};

const recentListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  maxHeight: 220,
  borderRadius: 8,
  border: "1px solid #f3f4f6",
};

const recentItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "10px 12px",
  border: "none",
  borderBottom: "1px solid #f3f4f6",
  background: "transparent",
  cursor: "pointer",
  transition: "background 0.1s",
  textAlign: "left",
};

const fileNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "#111827",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const filePathStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  marginTop: 1,
};

const fileErrorStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#dc2626",
  marginTop: 2,
};

const fileDateStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#d1d5db",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const alreadyOpenBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#6b7280",
  background: "#f3f4f6",
  borderRadius: 4,
  padding: "2px 6px",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const dialogCloseButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: -8,
  right: -24,
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  color: "#9ca3af",
  padding: 0,
};

const quitButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: -8,
  left: -24,
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  fontSize: 12,
  fontWeight: 600,
  color: "#6b7280",
  cursor: "pointer",
  padding: "4px 12px",
  borderRadius: 6,
  transition: "all 0.15s",
};

const browseButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  marginTop: 8,
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "transparent",
  cursor: "pointer",
  fontSize: 13,
  color: "#6b7280",
  fontWeight: 500,
  transition: "background 0.1s",
};

const registrationStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 200,
  padding: "24px 40px",
};

const regInputStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 280,
  padding: "10px 14px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
  textAlign: "center",
};

const regButtonStyle: React.CSSProperties = {
  marginTop: 16,
  padding: "10px 32px",
  background: "#1e40af",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  transition: "opacity 0.15s",
};

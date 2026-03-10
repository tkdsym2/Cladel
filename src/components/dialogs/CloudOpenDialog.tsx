import { useState, useCallback } from "react";
import CloudDownloadOutlinedIcon from "@mui/icons-material/CloudDownloadOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LinkIcon from "@mui/icons-material/Link";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { useSyncStore } from "../../store/syncStore";
import type { RemoteFileInfo, SyncStatusResult } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  remoteFile: RemoteFileInfo | null;
  onFileReady: (localPath: string) => void;
}

type OptionType = "save_new" | "link_existing";
type DiffAction = "upload" | "download" | null;

export function CloudOpenDialog({ open, onClose, remoteFile, onFileReady }: Props) {
  const [selectedOption, setSelectedOption] = useState<OptionType>("save_new");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Link flow: diff state
  const [linkStatus, setLinkStatus] = useState<SyncStatusResult | null>(null);
  const [linkPath, setLinkPath] = useState<string | null>(null);
  const [diffAction, setDiffAction] = useState<DiffAction>(null);

  const isSyncing = useSyncStore((s) => s.isSyncing);
  const downloadFile = useSyncStore((s) => s.downloadFile);
  const uploadFile = useSyncStore((s) => s.uploadFile);
  const checkSyncStatus = useSyncStore((s) => s.checkSyncStatus);

  const resetState = useCallback(() => {
    setSelectedOption("save_new");
    setProcessing(false);
    setError(null);
    setLinkStatus(null);
    setLinkPath(null);
    setDiffAction(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleConfirm = useCallback(async () => {
    if (!remoteFile) return;
    setError(null);
    setProcessing(true);

    try {
      if (selectedOption === "save_new") {
        const chosenPath = await saveFileDialog({
          defaultPath: remoteFile.name,
          filters: [{ name: "Cladel Document", extensions: ["cld", "klv", "tmgx"] }],
        });
        if (!chosenPath) {
          setProcessing(false);
          return;
        }
        let finalPath = chosenPath;
        if (!finalPath.toLowerCase().endsWith(".cld") && !finalPath.toLowerCase().endsWith(".klv") && !finalPath.toLowerCase().endsWith(".tmgx")) {
          finalPath += ".cld";
        }
        const success = await downloadFile(remoteFile.name, finalPath);
        if (success) {
          resetState();
          onFileReady(finalPath);
        } else {
          setError(
            useSyncStore.getState().lastSyncError ?? "Download failed",
          );
        }
      } else {
        // link_existing
        const chosenPath = await openFileDialog({
          multiple: false,
          filters: [{ name: "Cladel Document", extensions: ["cld", "klv", "tmgx"] }],
        });
        if (!chosenPath) {
          setProcessing(false);
          return;
        }
        setLinkPath(chosenPath);
        const result = await checkSyncStatus(chosenPath);
        if (!result) {
          setError(
            useSyncStore.getState().lastSyncError ?? "Failed to check status",
          );
          setProcessing(false);
          return;
        }
        if (result.is_in_sync) {
          // Already in sync — just open
          resetState();
          onFileReady(chosenPath);
          return;
        }
        // Show diff for resolution
        setLinkStatus(result);
      }
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    }
    setProcessing(false);
  }, [
    remoteFile,
    selectedOption,
    downloadFile,
    checkSyncStatus,
    resetState,
    onFileReady,
  ]);

  const handleDiffResolve = useCallback(async () => {
    if (!remoteFile || !linkPath || !diffAction) return;
    setProcessing(true);
    setError(null);
    try {
      if (diffAction === "upload") {
        const success = await uploadFile(linkPath);
        if (!success) {
          setError(useSyncStore.getState().lastSyncError ?? "Upload failed");
          setProcessing(false);
          return;
        }
      } else {
        const success = await downloadFile(remoteFile.name, linkPath);
        if (!success) {
          setError(useSyncStore.getState().lastSyncError ?? "Download failed");
          setProcessing(false);
          return;
        }
      }
      resetState();
      onFileReady(linkPath);
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
      setProcessing(false);
    }
  }, [remoteFile, linkPath, diffAction, uploadFile, downloadFile, resetState, onFileReady]);

  if (!open || !remoteFile) return null;

  // If we're in diff resolution mode for link flow
  if (linkStatus && linkPath && !linkStatus.is_in_sync) {
    return (
      <div style={overlayStyle} onClick={handleClose}>
        <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
          <div style={headerStyle}>
            <LinkIcon sx={{ fontSize: 20, color: "#1e40af" }} />
            <span style={titleStyle}>Resolve Differences</span>
          </div>

          <p style={descStyle}>
            The local file and cloud file have diverged. Choose which version to
            keep:
          </p>

          {linkStatus.local && linkStatus.remote && (
            <DiffTable local={linkStatus.local} remote={linkStatus.remote} />
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <label style={radioCardStyle(diffAction === "upload")}>
              <input
                type="radio"
                name="diff-action"
                checked={diffAction === "upload"}
                onChange={() => setDiffAction("upload")}
                style={{ display: "none" }}
              />
              <CloudUploadOutlinedIcon
                sx={{ fontSize: 18, color: diffAction === "upload" ? "#1e40af" : "#9ca3af" }}
              />
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                Upload local to cloud
              </span>
            </label>
            <label style={radioCardStyle(diffAction === "download")}>
              <input
                type="radio"
                name="diff-action"
                checked={diffAction === "download"}
                onChange={() => setDiffAction("download")}
                style={{ display: "none" }}
              />
              <CloudDownloadOutlinedIcon
                sx={{ fontSize: 18, color: diffAction === "download" ? "#1e40af" : "#9ca3af" }}
              />
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                Download cloud to local
              </span>
            </label>
          </div>

          {error && <div style={errorTextStyle}>{error}</div>}

          <div style={footerStyle}>
            <button style={cancelButtonStyle} onClick={handleClose}>
              Cancel
            </button>
            <button
              style={{
                ...confirmButtonStyle,
                opacity: !diffAction || processing || isSyncing ? 0.5 : 1,
              }}
              onClick={handleDiffResolve}
              disabled={!diffAction || processing || isSyncing}
            >
              {processing || isSyncing ? (
                <div style={buttonSpinnerStyle} />
              ) : null}
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <CloudDownloadOutlinedIcon sx={{ fontSize: 20, color: "#1e40af" }} />
          <span style={titleStyle}>
            Open from Cloud
          </span>
        </div>

        {/* File info */}
        <div style={fileInfoStyle}>
          <InsertDriveFileOutlinedIcon
            sx={{ fontSize: 16, color: "#6b7280" }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
            {remoteFile.name}
          </span>
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>
            {formatSize(remoteFile.size)}
          </span>
        </div>
        {remoteFile.updated_at && (
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>
            Last updated: {formatDate(remoteFile.updated_at)}
          </div>
        )}

        {/* Options */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={radioCardStyle(selectedOption === "save_new")}>
            <input
              type="radio"
              name="cloud-open-option"
              checked={selectedOption === "save_new"}
              onChange={() => setSelectedOption("save_new")}
              style={{ display: "none" }}
            />
            <CloudDownloadOutlinedIcon
              sx={{
                fontSize: 20,
                color: selectedOption === "save_new" ? "#1e40af" : "#9ca3af",
              }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                Save as new local file
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                Download and save to a new location on this machine.
              </div>
            </div>
          </label>

          <label style={radioCardStyle(selectedOption === "link_existing")}>
            <input
              type="radio"
              name="cloud-open-option"
              checked={selectedOption === "link_existing"}
              onChange={() => setSelectedOption("link_existing")}
              style={{ display: "none" }}
            />
            <LinkIcon
              sx={{
                fontSize: 20,
                color: selectedOption === "link_existing" ? "#1e40af" : "#9ca3af",
              }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                Link to existing local file
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                This file already exists on this machine. Select it to sync.
              </div>
            </div>
          </label>
        </div>

        {error && <div style={errorTextStyle}>{error}</div>}

        {/* Footer */}
        <div style={footerStyle}>
          <button style={cancelButtonStyle} onClick={handleClose}>
            Cancel
          </button>
          <button
            style={{
              ...confirmButtonStyle,
              opacity: processing || isSyncing ? 0.5 : 1,
            }}
            onClick={handleConfirm}
            disabled={processing || isSyncing}
          >
            {processing || isSyncing ? (
              <div style={buttonSpinnerStyle} />
            ) : null}
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DiffTable (shared layout) ───

function DiffTable({
  local,
  remote,
}: {
  local: { updated_at: string; size: number; node_count: number; edge_count: number };
  remote: { updated_at: string; size: number; node_count: number; edge_count: number };
}) {
  const localDate = new Date(local.updated_at).getTime();
  const remoteDate = new Date(remote.updated_at).getTime();
  const localNewer = localDate > remoteDate;
  const remoteNewer = remoteDate > localDate;
  const newerBg = "rgba(245, 158, 11, 0.08)";

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}></th>
          <th style={{ ...thStyle, ...(localNewer ? { background: newerBg } : {}) }}>
            Local {localNewer && <span style={newerBadgeStyle}>newer</span>}
          </th>
          <th style={{ ...thStyle, ...(remoteNewer ? { background: newerBg } : {}) }}>
            Cloud {remoteNewer && <span style={newerBadgeStyle}>newer</span>}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={labelCellStyle}>Last updated</td>
          <td style={{ ...cellStyle, ...(localNewer ? { background: newerBg } : {}) }}>
            {formatDate(local.updated_at)}
          </td>
          <td style={{ ...cellStyle, ...(remoteNewer ? { background: newerBg } : {}) }}>
            {formatDate(remote.updated_at)}
          </td>
        </tr>
        <tr>
          <td style={labelCellStyle}>File size</td>
          <td style={{ ...cellStyle, ...(localNewer ? { background: newerBg } : {}) }}>
            {formatSize(local.size)}
          </td>
          <td style={{ ...cellStyle, ...(remoteNewer ? { background: newerBg } : {}) }}>
            {formatSize(remote.size)}
          </td>
        </tr>
        <tr>
          <td style={labelCellStyle}>Nodes</td>
          <td style={{ ...cellStyle, ...(localNewer ? { background: newerBg } : {}) }}>
            {local.node_count}
          </td>
          <td style={{ ...cellStyle, ...(remoteNewer ? { background: newerBg } : {}) }}>
            {remote.node_count}
          </td>
        </tr>
        <tr>
          <td style={labelCellStyle}>Edges</td>
          <td style={{ ...cellStyle, ...(localNewer ? { background: newerBg } : {}) }}>
            {local.edge_count}
          </td>
          <td style={{ ...cellStyle, ...(remoteNewer ? { background: newerBg } : {}) }}>
            {remote.edge_count}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ─── Helpers ───

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 3000,
  background: "rgba(0,0,0,0.3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialogStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 12,
  padding: "24px 28px 20px",
  width: 480,
  maxWidth: "92vw",
  boxShadow: "0 8px 40px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 16,
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "#111827",
};

const fileInfoStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 10px",
  background: "#f9fafb",
  borderRadius: 8,
  marginBottom: 8,
};

const descStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  marginBottom: 12,
  marginTop: 0,
};

const radioCardStyle = (selected: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "12px 14px",
  border: `1.5px solid ${selected ? "#1e40af" : "#e5e7eb"}`,
  borderRadius: 10,
  cursor: "pointer",
  background: selected ? "rgba(30,64,175,0.03)" : "#fff",
  transition: "border-color 0.15s, background 0.15s",
});

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
};

const cancelButtonStyle: React.CSSProperties = {
  padding: "7px 16px",
  background: "#f3f4f6",
  color: "#374151",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const confirmButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 20px",
  background: "#1e40af",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const buttonSpinnerStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  border: "2px solid rgba(255,255,255,0.3)",
  borderTopColor: "#fff",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};

const errorTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#dc2626",
  marginTop: 10,
  padding: "6px 10px",
  background: "#fef2f2",
  borderRadius: 6,
  wordBreak: "break-word",
};

// Table styles

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: 12,
  color: "#6b7280",
  borderBottom: "2px solid #e5e7eb",
};

const cellStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid #f3f4f6",
  color: "#111827",
};

const labelCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 500,
  color: "#6b7280",
  width: 110,
};

const newerBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#d97706",
  background: "rgba(245,158,11,0.15)",
  borderRadius: 4,
  padding: "1px 5px",
  marginLeft: 4,
};

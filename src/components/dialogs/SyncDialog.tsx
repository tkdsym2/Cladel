import { useState, useEffect, useCallback } from "react";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import CloudDownloadOutlinedIcon from "@mui/icons-material/CloudDownloadOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useSyncStore } from "../../store/syncStore";
import type { SyncStatusResult } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  localPath: string;
  onSyncComplete?: () => void;
}

export function SyncDialog({ open, onClose, localPath, onSyncComplete }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SyncStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSyncing = useSyncStore((s) => s.isSyncing);
  const checkSyncStatus = useSyncStore((s) => s.checkSyncStatus);
  const uploadFile = useSyncStore((s) => s.uploadFile);
  const downloadFile = useSyncStore((s) => s.downloadFile);

  const loadStatus = useCallback(async () => {
    if (!localPath) return;
    setLoading(true);
    setError(null);
    const result = await checkSyncStatus(localPath);
    if (result) {
      setStatus(result);
    } else {
      setError(useSyncStore.getState().lastSyncError ?? "Failed to check sync status");
    }
    setLoading(false);
  }, [localPath, checkSyncStatus]);

  useEffect(() => {
    if (open) {
      setStatus(null);
      setError(null);
      loadStatus();
    }
  }, [open, loadStatus]);

  const handleUpload = useCallback(async () => {
    const success = await uploadFile(localPath);
    if (success) {
      onSyncComplete?.();
      onClose();
    } else {
      setError(useSyncStore.getState().lastSyncError ?? "Upload failed");
    }
  }, [localPath, uploadFile, onSyncComplete, onClose]);

  const handleDownload = useCallback(async () => {
    if (!status?.remote) return;
    const success = await downloadFile(status.remote.name, localPath);
    if (success) {
      onSyncComplete?.();
      onClose();
    } else {
      setError(useSyncStore.getState().lastSyncError ?? "Download failed");
    }
  }, [status, localPath, downloadFile, onSyncComplete, onClose]);

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <CloudSyncIcon sx={{ fontSize: 22, color: "#1e40af" }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
            Cloud Sync
          </span>
        </div>

        {/* Content */}
        <div style={contentStyle}>
          {loading ? (
            <div style={centerStyle}>
              <div style={spinnerStyle} />
              <span style={{ fontSize: 13, color: "#6b7280", marginTop: 12 }}>
                Checking sync status...
              </span>
            </div>
          ) : error ? (
            <div style={centerStyle}>
              <ErrorOutlineIcon sx={{ fontSize: 32, color: "#dc2626" }} />
              <span
                style={{
                  fontSize: 13,
                  color: "#dc2626",
                  marginTop: 8,
                  textAlign: "center",
                  maxWidth: 360,
                  wordBreak: "break-word",
                }}
              >
                {error}
              </span>
              <button style={retryButtonStyle} onClick={loadStatus}>
                Retry
              </button>
            </div>
          ) : status && !status.has_remote ? (
            // No remote file
            <div style={centerStyle}>
              <CloudUploadOutlinedIcon
                sx={{ fontSize: 36, color: "#6b7280" }}
              />
              <span
                style={{
                  fontSize: 14,
                  color: "#374151",
                  marginTop: 8,
                  textAlign: "center",
                }}
              >
                This file has not been synced to the cloud yet.
              </span>
              <button
                style={primaryButtonStyle}
                onClick={handleUpload}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <div style={buttonSpinnerStyle} />
                ) : (
                  <CloudUploadOutlinedIcon sx={{ fontSize: 16 }} />
                )}
                Upload to Cloud
              </button>
            </div>
          ) : status?.is_in_sync ? (
            // In sync
            <div style={centerStyle}>
              <CheckCircleOutlineIcon
                sx={{ fontSize: 36, color: "#059669" }}
              />
              <span
                style={{ fontSize: 14, fontWeight: 600, color: "#059669", marginTop: 8 }}
              >
                In sync
              </span>
              {status.remote && (
                <span style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                  Last synced: {formatDate(status.remote.updated_at)}
                </span>
              )}
              <button style={secondaryButtonStyle} onClick={onClose}>
                Close
              </button>
            </div>
          ) : status?.local && status?.remote ? (
            // Diff view
            <div>
              <DiffTable local={status.local} remote={status.remote} />
              <div style={actionRowStyle}>
                <button
                  style={primaryButtonStyle}
                  onClick={handleUpload}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <div style={buttonSpinnerStyle} />
                  ) : (
                    <CloudUploadOutlinedIcon sx={{ fontSize: 16 }} />
                  )}
                  Upload Local to Cloud
                </button>
                <button
                  style={secondaryActionButtonStyle}
                  onClick={handleDownload}
                  disabled={isSyncing}
                >
                  {isSyncing ? (
                    <div style={buttonSpinnerStyle} />
                  ) : (
                    <CloudDownloadOutlinedIcon sx={{ fontSize: 16 }} />
                  )}
                  Download Cloud to Local
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── DiffTable ───

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
  width: 520,
  maxWidth: "92vw",
  boxShadow: "0 8px 40px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 20,
};

const contentStyle: React.CSSProperties = {
  minHeight: 160,
};

const centerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 160,
  gap: 0,
};

const spinnerStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "3px solid #e5e7eb",
  borderTopColor: "#1e40af",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};

const buttonSpinnerStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  border: "2px solid rgba(255,255,255,0.3)",
  borderTopColor: "#fff",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};

const primaryButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 20px",
  marginTop: 16,
  background: "#1e40af",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  transition: "background 0.15s",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: "#f3f4f6",
  color: "#374151",
};

const secondaryActionButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 20px",
  background: "#f9fafb",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  transition: "background 0.15s",
};

const retryButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  marginTop: 12,
  color: "#dc2626",
  background: "#fef2f2",
  border: "1px solid #fecaca",
};

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "center",
  marginTop: 16,
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
  width: 120,
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

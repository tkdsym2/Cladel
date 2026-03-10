import type { AgentCapabilities, SyncStatusResult } from "../types";
import CloudDoneIcon from "@mui/icons-material/CloudDone";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import CloudOffIcon from "@mui/icons-material/CloudOff";

const statusBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 16px",
  background: "#f9fafb",
  borderTop: "1px solid #e5e7eb",
  fontSize: 12,
  color: "#6b7280",
};

const apiStatusBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "none",
  border: "none",
  padding: "2px 4px",
  borderRadius: 4,
  fontSize: 12,
  color: "#6b7280",
  cursor: "pointer",
};

const apiDotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  flexShrink: 0,
};

export function StatusBar({
  nodeCount,
  edgeCount,
  apiKeyStatus,
  agentCapabilities,
  syncIsConfigured,
  syncStatus,
  currentFilePath,
  onOpenSettings,
  onOpenSyncDialog,
}: {
  nodeCount: number;
  edgeCount: number;
  apiKeyStatus: string | null;
  agentCapabilities: AgentCapabilities;
  syncIsConfigured: boolean;
  syncStatus: SyncStatusResult | null;
  currentFilePath: string | null;
  onOpenSettings: () => void;
  onOpenSyncDialog: () => void;
}) {
  return (
    <div style={statusBarStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <span>Nodes: {nodeCount}</span>
        <span>Edges: {edgeCount}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button
          onClick={onOpenSettings}
          style={apiStatusBtnStyle}
          title={apiKeyStatus ? "Claude API key configured" : "Click to set up API key"}
        >
          <span
            style={{
              ...apiDotStyle,
              background: apiKeyStatus ? "#059669" : "#d1d5db",
            }}
          />
          <span>
            Claude API: {apiKeyStatus ? "Connected" : "Not configured"}
          </span>
        </button>
        <button
          onClick={onOpenSettings}
          style={apiStatusBtnStyle}
          title={
            !agentCapabilities.agent_enabled
              ? "Agent is off — click to configure"
              : agentCapabilities.autonomous_enabled
                ? "Agent on with auto-suggest"
                : "Agent on, auto-suggest off — click to configure"
          }
        >
          <span
            style={{
              ...apiDotStyle,
              background: !agentCapabilities.agent_enabled
                ? "#d1d5db"
                : agentCapabilities.autonomous_enabled
                  ? "#7c3aed"
                  : "#059669",
            }}
          />
          <span>
            {!agentCapabilities.agent_enabled
              ? "Agent: Off"
              : agentCapabilities.autonomous_enabled
                ? "Agent: On \u00b7 Auto"
                : "Agent: On"}
          </span>
        </button>
        {/* Cloud sync indicator */}
        {syncIsConfigured && currentFilePath && (
          <button
            onClick={onOpenSyncDialog}
            style={apiStatusBtnStyle}
            title="Cloud sync status — click to manage"
          >
            {!syncStatus ? (
              <>
                <CloudSyncIcon sx={{ fontSize: 14, color: "#9ca3af" }} />
                <span>Checking...</span>
              </>
            ) : syncStatus.is_in_sync ? (
              <>
                <CloudDoneIcon sx={{ fontSize: 14, color: "#059669" }} />
                <span style={{ color: "#059669" }}>In sync</span>
              </>
            ) : !syncStatus.has_remote ? (
              <>
                <CloudUploadIcon sx={{ fontSize: 14, color: "#d97706" }} />
                <span style={{ color: "#d97706" }}>Not uploaded</span>
              </>
            ) : (
              <>
                <CloudSyncIcon sx={{ fontSize: 14, color: "#d97706" }} />
                <span style={{ color: "#d97706" }}>Out of sync</span>
              </>
            )}
          </button>
        )}
        {!syncIsConfigured && (
          <button
            onClick={onOpenSettings}
            style={apiStatusBtnStyle}
            title="Cloud sync not configured"
          >
            <CloudOffIcon sx={{ fontSize: 14, color: "#d1d5db" }} />
          </button>
        )}
      </div>
    </div>
  );
}

import type { AgentCapabilities, SyncStatusResult } from "../types";
import { useT } from "../lib/i18n";
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
  const t = useT();
  return (
    <div style={statusBarStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <span>{t({ en: "Nodes: {n}", ja: "ノード: {n}" }, { n: nodeCount })}</span>
        <span>{t({ en: "Edges: {n}", ja: "エッジ: {n}" }, { n: edgeCount })}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button
          onClick={onOpenSettings}
          style={apiStatusBtnStyle}
          title={
            apiKeyStatus
              ? t({ en: "Claude API key configured", ja: "Claude APIキーが設定済み" })
              : t({ en: "Click to set up API key", ja: "クリックしてAPIキーを設定" })
          }
        >
          <span
            style={{
              ...apiDotStyle,
              background: apiKeyStatus ? "#059669" : "#d1d5db",
            }}
          />
          <span>
            {apiKeyStatus
              ? t({ en: "Claude API: Connected", ja: "Claude API: 接続済み" })
              : t({ en: "Claude API: Not configured", ja: "Claude API: 未設定" })}
          </span>
        </button>
        <button
          onClick={onOpenSettings}
          style={apiStatusBtnStyle}
          title={
            !agentCapabilities.agent_enabled
              ? t({ en: "Agent is off — click to configure", ja: "エージェントはオフ — クリックして設定" })
              : agentCapabilities.autonomous_enabled
                ? t({ en: "Agent on with auto-suggest", ja: "エージェントはオン・自動提案あり" })
                : t({ en: "Agent on, auto-suggest off — click to configure", ja: "エージェントはオン・自動提案オフ — クリックして設定" })
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
              ? t({ en: "Agent: Off", ja: "\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8: \u30aa\u30d5" })
              : agentCapabilities.autonomous_enabled
                ? t({ en: "Agent: On \u00b7 Auto", ja: "\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8: \u30aa\u30f3 \u00b7 \u81ea\u52d5" })
                : t({ en: "Agent: On", ja: "\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8: \u30aa\u30f3" })}
          </span>
        </button>
        {/* Cloud sync indicator */}
        {syncIsConfigured && currentFilePath && (
          <button
            onClick={onOpenSyncDialog}
            style={apiStatusBtnStyle}
            title={t({ en: "Cloud sync status — click to manage", ja: "クラウド同期の状態 — クリックして管理" })}
          >
            {!syncStatus ? (
              <>
                <CloudSyncIcon sx={{ fontSize: 14, color: "#9ca3af" }} />
                <span>{t({ en: "Checking...", ja: "確認中..." })}</span>
              </>
            ) : syncStatus.is_in_sync ? (
              <>
                <CloudDoneIcon sx={{ fontSize: 14, color: "#059669" }} />
                <span style={{ color: "#059669" }}>{t({ en: "In sync", ja: "同期済み" })}</span>
              </>
            ) : !syncStatus.has_remote ? (
              <>
                <CloudUploadIcon sx={{ fontSize: 14, color: "#d97706" }} />
                <span style={{ color: "#d97706" }}>{t({ en: "Not uploaded", ja: "未アップロード" })}</span>
              </>
            ) : (
              <>
                <CloudSyncIcon sx={{ fontSize: 14, color: "#d97706" }} />
                <span style={{ color: "#d97706" }}>{t({ en: "Out of sync", ja: "未同期" })}</span>
              </>
            )}
          </button>
        )}
        {!syncIsConfigured && (
          <button
            onClick={onOpenSettings}
            style={apiStatusBtnStyle}
            title={t({ en: "Cloud sync not configured", ja: "クラウド同期が未設定" })}
          >
            <CloudOffIcon sx={{ fontSize: 14, color: "#d1d5db" }} />
          </button>
        )}
      </div>
    </div>
  );
}

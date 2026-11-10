import type { AgentCapabilities } from "../types";
import { useT } from "../lib/i18n";

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
  onOpenSettings,
}: {
  nodeCount: number;
  edgeCount: number;
  apiKeyStatus: string | null;
  agentCapabilities: AgentCapabilities;
  onOpenSettings: () => void;
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
      </div>
    </div>
  );
}

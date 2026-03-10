import { useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
import CloseIcon from "@mui/icons-material/Close";
import DescriptionIcon from "@mui/icons-material/Description";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import LinkIcon from "@mui/icons-material/Link";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LockIcon from "@mui/icons-material/Lock";
import BlockIcon from "@mui/icons-material/Block";
import ErrorIcon from "@mui/icons-material/Error";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useAgentStore } from "../../store/agentStore";
import { useGraphStore } from "../../store/graphStore";
import { useLayerStore } from "../../store/layerStore";
import { useSettingsStore } from "../../store/settingsStore";
import type {
  AgentInvocationType,
  AgentSuggestion,
  AgentErrorInfo,
  PaperResult,
} from "../../types";

const INVOCATION_TYPES: { value: AgentInvocationType; label: string; capKey?: keyof ReturnType<typeof useSettingsStore.getState>["agentCapabilities"] }[] = [
  { value: "search_papers", label: "Search Papers", capKey: "search_papers_enabled" },
  { value: "suggest_connections", label: "Suggest Connections", capKey: "suggest_connections_enabled" },
  { value: "suggest_ideas", label: "Suggest Ideas", capKey: "suggest_ideas_enabled" },
  { value: "general", label: "General" },
];

export function AgentPanel() {
  const status = useAgentStore((s) => s.status);
  const suggestions = useAgentStore((s) => s.suggestions);
  const history = useAgentStore((s) => s.history);
  const currentQuery = useAgentStore((s) => s.currentQuery);
  const currentInvocationType = useAgentStore((s) => s.currentInvocationType);
  const errorInfo = useAgentStore((s) => s.errorInfo);
  const thinkingStartedAt = useAgentStore((s) => s.thinkingStartedAt);
  const lastResponseMessage = useAgentStore((s) => s.lastResponseMessage);
  const isAutonomousQuery = useAgentStore((s) => s.isAutonomousQuery);
  const submitQuery = useAgentStore((s) => s.submitQuery);
  const cancelQuery = useAgentStore((s) => s.cancelQuery);
  const retryLastQuery = useAgentStore((s) => s.retryLastQuery);
  const setCurrentQuery = useAgentStore((s) => s.setCurrentQuery);
  const setCurrentInvocationType = useAgentStore(
    (s) => s.setCurrentInvocationType,
  );
  const setPanelOpen = useAgentStore((s) => s.setPanelOpen);
  const agentProvider = useAgentStore((s) => s.provider);
  const setAgentProvider = useAgentStore((s) => s.setProvider);

  const apiKeyStatus = useSettingsStore((s) => s.apiKeyStatus);
  const geminiApiKeyStatus = useSettingsStore((s) => s.geminiApiKeyStatus);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const agentCapabilities = useSettingsStore((s) => s.agentCapabilities);
  const hasActiveKey = agentProvider === "gemini" ? !!geminiApiKeyStatus : !!apiKeyStatus;
  const hasAnyKey = !!apiKeyStatus || !!geminiApiKeyStatus;
  const agentEnabled = agentCapabilities.agent_enabled;

  // Determine which invocation types are enabled
  const typeStates = useMemo(() => {
    return INVOCATION_TYPES.map((t) => {
      const enabled = !t.capKey || (agentCapabilities[t.capKey] as boolean);
      return { ...t, enabled };
    });
  }, [agentCapabilities]);

  const enabledTypes = useMemo(() => typeStates.filter((t) => t.enabled), [typeStates]);
  const allSpecificDisabled = enabledTypes.length === 0;

  // Auto-fallback: if current type is disabled, switch to first enabled one
  useEffect(() => {
    if (!agentEnabled) return;
    const currentTypeState = typeStates.find((t) => t.value === currentInvocationType);
    if (currentTypeState && !currentTypeState.enabled && enabledTypes.length > 0) {
      setCurrentInvocationType(enabledTypes[0].value);
    }
  }, [agentEnabled, typeStates, enabledTypes, currentInvocationType, setCurrentInvocationType]);

  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Whether the form area should be interactive
  const formActive = hasActiveKey && agentEnabled && !allSpecificDisabled;

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const q = currentQuery.trim();
      if (!q || status === "thinking" || !formActive) return;
      submitQuery(q, currentInvocationType);
    },
    [currentQuery, currentInvocationType, status, submitQuery, formActive],
  );

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#1f2937" }}>
            Research Assistant
          </span>
          <StatusBadge status={status} />
        </div>
        <button
          onClick={() => setPanelOpen(false)}
          style={closeBtnStyle}
          title="Close agent panel"
        >
          <CloseIcon sx={{ fontSize: 20 }} />
        </button>
      </div>

      {/* Agent disabled banner */}
      {!agentEnabled && (
        <div style={agentDisabledBannerStyle}>
          <div style={agentDisabledTextStyle}>
            <InfoOutlinedIcon sx={{ fontSize: 14, color: "#6b7280", flexShrink: 0, mt: "1px" }} />
            <span>Research Agent is disabled</span>
          </div>
          <button onClick={openSettings} style={agentDisabledBtnStyle}>
            Enable in Settings
          </button>
        </div>
      )}

      {/* API key missing banner */}
      {agentEnabled && !hasAnyKey && (
        <div style={apiKeyBannerStyle}>
          <div style={apiKeyBannerTextStyle}>
            <LockIcon sx={{ fontSize: 14, color: "#92400e", flexShrink: 0, mt: "1px" }} />
            <span>Set up your API key to enable the research assistant</span>
          </div>
          <button onClick={openSettings} style={apiKeyBannerBtnStyle}>
            Open Settings
          </button>
        </div>
      )}

      {/* All specific capabilities disabled */}
      {agentEnabled && hasAnyKey && allSpecificDisabled && (
        <div style={noCapsBannerStyle}>
          <div style={noCapsTextStyle}>
            <BlockIcon sx={{ fontSize: 14, color: "#6b7280", flexShrink: 0, mt: "1px" }} />
            <span>No capabilities enabled. Enable them in Settings.</span>
          </div>
          <button onClick={openSettings} style={agentDisabledBtnStyle}>
            Open Settings
          </button>
        </div>
      )}

      {/* Provider toggle */}
      {agentEnabled && hasAnyKey && (
        <div style={providerToggleRowStyle}>
          <button
            type="button"
            onClick={() => setAgentProvider("claude")}
            disabled={!apiKeyStatus}
            style={{
              ...providerBtnBase,
              ...(agentProvider === "claude" ? providerBtnActiveClaude : providerBtnInactive),
              ...(!apiKeyStatus ? { opacity: 0.4, cursor: "not-allowed" } : {}),
            }}
          >
            Claude
          </button>
          <button
            type="button"
            onClick={() => setAgentProvider("gemini")}
            disabled={!geminiApiKeyStatus}
            style={{
              ...providerBtnBase,
              ...(agentProvider === "gemini" ? providerBtnActiveGemini : providerBtnInactive),
              ...(!geminiApiKeyStatus ? { opacity: 0.4, cursor: "not-allowed" } : {}),
            }}
          >
            Gemini
          </button>
        </div>
      )}

      {/* Manual invocation area */}
      <form onSubmit={handleSubmit} style={{
        ...invokeAreaStyle,
        ...(!formActive ? { opacity: 0.5, pointerEvents: "none" as const } : {}),
      }}>
        <div style={typeRowStyle}>
          {typeStates.map((t) => {
            const isActive = currentInvocationType === t.value;
            const isDisabled = !t.enabled;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  if (!isDisabled) setCurrentInvocationType(t.value);
                }}
                disabled={isDisabled}
                style={{
                  ...typeChipStyle,
                  ...(isActive && !isDisabled ? typeChipActiveStyle : {}),
                  ...(isDisabled ? typeChipDisabledStyle : {}),
                }}
                title={isDisabled ? `${t.label} is disabled in Settings` : undefined}
              >
                {t.label}
                {isDisabled && <span style={disabledSuffixStyle}>(off)</span>}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={currentQuery}
            onChange={(e) => setCurrentQuery(e.target.value)}
            placeholder="Ask the research assistant..."
            style={queryInputStyle}
            disabled={status === "thinking" || !formActive}
          />
          <button
            type="submit"
            disabled={!currentQuery.trim() || status === "thinking" || !formActive}
            style={{
              ...submitBtnStyle,
              opacity:
                !currentQuery.trim() || status === "thinking" || !formActive ? 0.5 : 1,
              cursor:
                !currentQuery.trim() || status === "thinking" || !formActive
                  ? "default"
                  : "pointer",
            }}
          >
            {status === "thinking" ? (
              <span style={spinnerStyle} />
            ) : (
              "Ask"
            )}
          </button>
        </div>
      </form>

      {/* Thinking state with elapsed time and cancel */}
      {status === "thinking" && (
        <div style={thinkingBarStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={spinnerSmallPurpleStyle} />
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              {isAutonomousQuery ? "Analyzing your graph..." : "Asking Claude..."}
            </span>
            <ElapsedTime startedAt={thinkingStartedAt} />
          </div>
          <button
            onClick={cancelQuery}
            style={cancelBtnStyle}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error message with contextual actions */}
      {status === "error" && errorInfo && (
        <ErrorBar errorInfo={errorInfo} onRetry={retryLastQuery} onOpenSettings={openSettings} />
      )}

      {/* Response message */}
      {status === "done" && lastResponseMessage && (
        <div style={responseMessageStyle}>
          {isAutonomousQuery && (
            <span style={autoTagStyle}>Auto</span>
          )}
          {lastResponseMessage}
        </div>
      )}

      {/* Suggestions list */}
      <div style={suggestionsAreaStyle}>
        {suggestions.length === 0 && status !== "thinking" && status !== "error" ? (
          <div style={emptyStateStyle}>
            <AutoAwesomeIcon sx={{ fontSize: 32, color: "#d1d5db" }} />
            <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.5, textAlign: "center" }}>
              Ask the research assistant for help, or it will offer suggestions
              as you work.
            </div>
          </div>
        ) : (
          suggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} />
          ))
        )}
      </div>

      {/* History section */}
      {history.length > 0 && (
        <div style={historySectionStyle}>
          <button
            onClick={() => setHistoryExpanded((v) => !v)}
            style={historyToggleStyle}
          >
            {historyExpanded
              ? <ExpandMoreIcon sx={{ fontSize: 14 }} />
              : <ChevronRightIcon sx={{ fontSize: 14 }} />
            }
            <span>History ({history.length})</span>
          </button>
          {historyExpanded && (
            <div style={historyListStyle}>
              {history.map((h) => (
                <div key={h.id} style={historyEntryStyle}>
                  <div style={historyQueryStyle}>
                    <span style={historyTypeBadge}>{h.invocationType.replace("_", " ")}</span>
                    {h.query}
                  </div>
                  <div style={historyResponseStyle}>{h.response}</div>
                  <div style={historyTimestampStyle}>
                    {new Date(h.timestamp).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Elapsed Time Component ───

function ElapsedTime({ startedAt }: { startedAt: number | null }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }

    setElapsed(Math.floor((Date.now() - startedAt) / 1000));

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt]);

  if (!startedAt || elapsed < 1) return null;

  return (
    <span style={{ fontSize: 11, color: "#9ca3af" }}>
      ({elapsed}s)
    </span>
  );
}

// ─── Error Bar Component ───

function ErrorBar({
  errorInfo,
  onRetry,
  onOpenSettings,
}: {
  errorInfo: AgentErrorInfo;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const needsSettings =
    errorInfo.error_code === "api_key_missing" ||
    errorInfo.error_code === "api_key_invalid" ||
    errorInfo.error_code === "agent_disabled" ||
    errorInfo.error_code === "capability_disabled";

  return (
    <div style={errorBarStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, flex: 1 }}>
        <ErrorIcon sx={{ fontSize: 14, color: "#dc2626", flexShrink: 0, mt: "1px" }} />
        <span style={{ fontSize: 12, color: "#dc2626", lineHeight: 1.4 }}>
          {errorInfo.message}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4, flexShrink: 0 }}>
        {needsSettings ? (
          <button onClick={onOpenSettings} style={errorActionBtnStyle}>
            Open Settings
          </button>
        ) : errorInfo.recoverable ? (
          <button onClick={onRetry} style={errorActionBtnStyle}>
            {errorInfo.retry_after_secs
              ? `Retry (wait ${errorInfo.retry_after_secs}s)`
              : "Retry"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Suggestion Card ───

function SuggestionCard({ suggestion }: { suggestion: AgentSuggestion }) {
  const createGhostNode = useGraphStore((s) => s.createGhostNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const setSuggestionActioned = useAgentStore((s) => s.setSuggestionActioned);
  const currentLayer = useLayerStore((s) => s.currentLayer);
  const dbNodes = useGraphStore((s) => s.dbNodes);

  const handleAction = useCallback(async () => {
    if (suggestion.actioned || !currentLayer) return;

    try {
      if (suggestion.type === "paper") {
        const paper = suggestion.data as PaperResult;
        // Position near existing nodes with offset
        const maxY = dbNodes.length > 0
          ? Math.max(...dbNodes.map((n) => n.position_y))
          : 0;
        await createGhostNode({
          layer_id: currentLayer.id,
          proposal_type: "paper",
          title: suggestion.title,
          reason: suggestion.description,
          paper_id: paper.paper_id,
          authors: paper.authors,
          year: paper.year,
          abstract_text: paper.abstract_text,
          url: paper.url,
          position_x: 200 + Math.random() * 200,
          position_y: maxY + 150,
        });
      } else if (suggestion.type === "idea") {
        const idea = suggestion.data as { body: string };
        const maxY = dbNodes.length > 0
          ? Math.max(...dbNodes.map((n) => n.position_y))
          : 0;
        await createGhostNode({
          layer_id: currentLayer.id,
          proposal_type: "idea",
          title: suggestion.title,
          reason: suggestion.description,
          body: idea.body,
          position_x: 200 + Math.random() * 200,
          position_y: maxY + 150,
        });
      } else if (suggestion.type === "connection") {
        const conn = suggestion.data as {
          sourceNodeId: string;
          targetNodeId: string;
          reason: string;
        };
        await addEdge({
          layer_id: currentLayer.id,
          source_node_id: conn.sourceNodeId,
          target_node_id: conn.targetNodeId,
          weight: 3,
          comment: conn.reason,
        });
      }

      setSuggestionActioned(suggestion.id);
    } catch (err) {
      console.error("Failed to action suggestion:", err);
    }
  }, [
    suggestion,
    currentLayer,
    dbNodes,
    createGhostNode,
    addEdge,
    setSuggestionActioned,
  ]);

  const typeIcon =
    suggestion.type === "paper"
      ? <DescriptionIcon sx={{ fontSize: 16, color: "#059669" }} />
      : suggestion.type === "idea"
        ? <LightbulbIcon sx={{ fontSize: 16, color: "#d97706" }} />
        : <LinkIcon sx={{ fontSize: 16, color: "#7c3aed" }} />;

  const actionLabel =
    suggestion.type === "connection" ? "Add Edge" : "Add to Graph";

  return (
    <div
      style={{
        ...cardStyle,
        opacity: suggestion.actioned ? 0.5 : 1,
        animation: "agent-fade-in 0.2s ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", lineHeight: 1, flexShrink: 0 }}>
          {typeIcon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={cardTitleStyle}>{suggestion.title}</div>
          <div style={cardDescStyle}>{suggestion.description}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
        <button
          onClick={handleAction}
          disabled={suggestion.actioned}
          style={{
            ...cardActionBtnStyle,
            opacity: suggestion.actioned ? 0.4 : 1,
            cursor: suggestion.actioned ? "default" : "pointer",
          }}
        >
          {suggestion.actioned ? "Added" : actionLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Status Badge ───

function StatusBadge({ status }: { status: string }) {
  const conf: Record<string, { bg: string; fg: string; label: string }> = {
    idle: { bg: "#f3f4f6", fg: "#6b7280", label: "Idle" },
    thinking: { bg: "#ede9fe", fg: "#7c3aed", label: "Thinking" },
    done: { bg: "#ecfdf5", fg: "#059669", label: "Done" },
    error: { bg: "#fef2f2", fg: "#dc2626", label: "Error" },
  };
  const c = conf[status] ?? conf.idle;

  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 7px",
        borderRadius: 10,
        background: c.bg,
        color: c.fg,
        textTransform: "uppercase",
        letterSpacing: 0.3,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {status === "thinking" && <span style={spinnerSmallStyle} />}
      {c.label}
    </span>
  );
}

// ─── Styles ───

const providerToggleRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: "0 12px 6px",
};

const providerBtnBase: React.CSSProperties = {
  padding: "3px 10px",
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 4,
  border: "1px solid transparent",
  cursor: "pointer",
  transition: "all 120ms ease",
};

const providerBtnActiveClaude: React.CSSProperties = {
  background: "#4338ca",
  color: "#fff",
  borderColor: "#4338ca",
};

const providerBtnActiveGemini: React.CSSProperties = {
  background: "#1a73e8",
  color: "#fff",
  borderColor: "#1a73e8",
};

const providerBtnInactive: React.CSSProperties = {
  background: "transparent",
  color: "#6b7280",
  borderColor: "#d1d5db",
};

const panelStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "#ffffff",
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: "1px solid #f3f4f6",
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 22,
  cursor: "pointer",
  color: "#9ca3af",
  lineHeight: 1,
  padding: "0 4px",
};

const invokeAreaStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #f3f4f6",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  flexShrink: 0,
};

const typeRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

const typeChipStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  padding: "3px 8px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  color: "#6b7280",
  cursor: "pointer",
};

const typeChipActiveStyle: React.CSSProperties = {
  background: "#7c3aed",
  color: "#ffffff",
  borderColor: "#7c3aed",
};

const typeChipDisabledStyle: React.CSSProperties = {
  opacity: 0.45,
  cursor: "default",
  color: "#9ca3af",
  background: "#f9fafb",
};

const disabledSuffixStyle: React.CSSProperties = {
  fontSize: 9,
  marginLeft: 3,
  fontWeight: 400,
  opacity: 0.7,
};

const queryInputStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 13,
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "7px 10px",
  boxSizing: "border-box",
};

const submitBtnStyle: React.CSSProperties = {
  padding: "7px 14px",
  background: "#7c3aed",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  minWidth: 52,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const thinkingBarStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#faf5ff",
  borderBottom: "1px solid #ede9fe",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexShrink: 0,
};

const cancelBtnStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: "2px 6px",
  textDecoration: "underline",
};

const errorBarStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#fef2f2",
  borderBottom: "1px solid #fecaca",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  flexShrink: 0,
};

const errorActionBtnStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#3b82f6",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: 0,
  textDecoration: "underline",
};

const responseMessageStyle: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: 12,
  color: "#374151",
  background: "#f0fdf4",
  borderBottom: "1px solid #d1fae5",
  lineHeight: 1.5,
  flexShrink: 0,
};

const autoTagStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: 9,
  fontWeight: 700,
  padding: "1px 5px",
  borderRadius: 3,
  background: "#ede9fe",
  color: "#7c3aed",
  textTransform: "uppercase",
  letterSpacing: 0.3,
  marginRight: 6,
  verticalAlign: "middle",
};

const suggestionsAreaStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const emptyStateStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "40px 20px",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "10px 12px",
  background: "#fafafa",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#1f2937",
  lineHeight: 1.3,
  marginBottom: 2,
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
  lineHeight: 1.4,
  overflow: "hidden",
  textOverflow: "ellipsis",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
};

const cardActionBtnStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 4,
  border: "1px solid #7c3aed",
  background: "rgba(124, 58, 237, 0.08)",
  color: "#7c3aed",
  cursor: "pointer",
};

const historySectionStyle: React.CSSProperties = {
  borderTop: "1px solid #e5e7eb",
  flexShrink: 0,
};

const historyToggleStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "10px 16px",
  border: "none",
  background: "#f9fafb",
  color: "#6b7280",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "left",
};

const historyListStyle: React.CSSProperties = {
  maxHeight: 200,
  overflowY: "auto",
  padding: "0 16px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const historyEntryStyle: React.CSSProperties = {
  borderLeft: "2px solid #e5e7eb",
  paddingLeft: 10,
};

const historyQueryStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 2,
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const historyTypeBadge: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  padding: "1px 5px",
  borderRadius: 3,
  background: "#f3f4f6",
  color: "#6b7280",
  textTransform: "uppercase",
  flexShrink: 0,
};

const historyResponseStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
  lineHeight: 1.4,
};

const historyTimestampStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#9ca3af",
  marginTop: 2,
};

const spinnerStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  border: "2px solid rgba(255,255,255,0.3)",
  borderTopColor: "#ffffff",
  borderRadius: "50%",
  animation: "agent-spin 0.6s linear infinite",
  display: "inline-block",
};

const apiKeyBannerStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#fffbeb",
  borderBottom: "1px solid #fde68a",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  flexShrink: 0,
};

const apiKeyBannerTextStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  fontSize: 12,
  color: "#92400e",
  lineHeight: 1.4,
  fontWeight: 500,
};

const apiKeyBannerBtnStyle: React.CSSProperties = {
  padding: "5px 12px",
  background: "#ffffff",
  color: "#92400e",
  border: "1px solid #fbbf24",
  borderRadius: 5,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  alignSelf: "flex-start",
};

const agentDisabledBannerStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#f3f4f6",
  borderBottom: "1px solid #e5e7eb",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  flexShrink: 0,
};

const agentDisabledTextStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  fontSize: 12,
  color: "#6b7280",
  lineHeight: 1.4,
  fontWeight: 500,
};

const agentDisabledBtnStyle: React.CSSProperties = {
  padding: "5px 12px",
  background: "#ffffff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 5,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  alignSelf: "flex-start",
};

const noCapsBannerStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  flexShrink: 0,
};

const noCapsTextStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  fontSize: 12,
  color: "#6b7280",
  lineHeight: 1.4,
  fontWeight: 500,
};

const spinnerSmallStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  border: "1.5px solid rgba(124,58,237,0.2)",
  borderTopColor: "#7c3aed",
  borderRadius: "50%",
  animation: "agent-spin 0.6s linear infinite",
  display: "inline-block",
};

const spinnerSmallPurpleStyle: React.CSSProperties = {
  width: 12,
  height: 12,
  border: "2px solid rgba(124,58,237,0.2)",
  borderTopColor: "#7c3aed",
  borderRadius: "50%",
  animation: "agent-spin 0.6s linear infinite",
  display: "inline-block",
  flexShrink: 0,
};

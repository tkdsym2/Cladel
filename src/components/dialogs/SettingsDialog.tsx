import { useState, useCallback, useEffect } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PsychologyIcon from "@mui/icons-material/Psychology";
import LockIcon from "@mui/icons-material/Lock";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import GridViewIcon from "@mui/icons-material/GridView";
import DataUsageIcon from "@mui/icons-material/DataUsage";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import PersonIcon from "@mui/icons-material/Person";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import * as cmd from "../../lib/tauri-commands";
import { useSettingsStore } from "../../store/settingsStore";
import { useSyncStore } from "../../store/syncStore";
import { useUserStore } from "../../store/userStore";
import { useFileStore } from "../../store/fileStore";
import type { AgentCapabilities, UIPreferences, UsageSummary, UsageLogEntry } from "../../types";
import { SYSTEM_DEFAULTS } from "../../types";

const CONSOLE_URL = "https://console.anthropic.com/settings/keys";
const GEMINI_CONSOLE_URL = "https://aistudio.google.com/apikey";

// ─── Toggle Switch ───

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onChange(!checked);
      }
    },
    [checked, onChange, disabled],
  );

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={handleKeyDown}
      style={{
        ...toggleTrackStyle,
        background: disabled
          ? "#e5e7eb"
          : checked
            ? "#2563eb"
            : "#d1d5db",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          ...toggleThumbStyle,
          transform: checked ? "translateX(16px)" : "translateX(0)",
        }}
      />
    </button>
  );
}

const toggleTrackStyle: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  width: 36,
  height: 20,
  borderRadius: 10,
  border: "none",
  padding: 2,
  transition: "background 150ms ease",
  flexShrink: 0,
  outline: "none",
  boxSizing: "border-box",
};

const toggleThumbStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  background: "#ffffff",
  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
  transition: "transform 150ms ease",
  pointerEvents: "none",
};

// ─── Capability Row ───

function CapabilityRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  children,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div style={capRowWrapperStyle}>
      <div style={capRowStyle}>
        <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            ...capLabelStyle,
            color: disabled ? "#9ca3af" : "#374151",
          }}>
            {label}
          </div>
          <div style={{
            ...capDescStyle,
            color: disabled ? "#c4c9d1" : "#9ca3af",
          }}>
            {description}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

const capRowWrapperStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const capRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
};

const capLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1.3,
};

const capDescStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.4,
  marginTop: 1,
};

// ─── Node Size Row ───

function NodeSizeRow({
  label,
  color,
  width,
  height,
  onWidthChange,
  onHeightChange,
}: {
  label: string;
  color: string;
  width: number;
  height: number;
  onWidthChange: (v: number) => void;
  onHeightChange: (v: number) => void;
}) {
  return (
    <div style={nodeSizeRowStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 70 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={nodeSizeLabelStyle}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={uiInputGroupStyle}>
          <span style={uiDimLabelStyle}>W</span>
          <input
            type="number"
            min={100}
            max={600}
            step={10}
            value={width}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 100 && v <= 600) onWidthChange(v);
            }}
            style={uiNumberInputSmallStyle}
          />
        </div>
        <div style={uiInputGroupStyle}>
          <span style={uiDimLabelStyle}>H</span>
          <input
            type="number"
            min={80}
            max={800}
            step={10}
            value={height}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 80 && v <= 800) onHeightChange(v);
            }}
            style={uiNumberInputSmallStyle}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Settings Dialog ───

type SettingsTab = "profile" | "api_keys" | "agent" | "ui_layout" | "usage_sync";

export function SettingsDialog() {
  const isOpen = useSettingsStore((s) => s.isSettingsOpen);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const apiKeyStatus = useSettingsStore((s) => s.apiKeyStatus);
  const geminiApiKeyStatus = useSettingsStore((s) => s.geminiApiKeyStatus);
  const agentCapabilities = useSettingsStore((s) => s.agentCapabilities);
  const saveAgentCapabilitiesAction = useSettingsStore((s) => s.saveAgentCapabilities);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [keyInput, setKeyInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Gemini key state
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [geminiSuccessMsg, setGeminiSuccessMsg] = useState<string | null>(null);

  // Paper summary prompt state
  const [summaryPrompt, setSummaryPrompt] = useState("");
  const [summaryPromptOriginal, setSummaryPromptOriginal] = useState("");
  const [summaryPromptSaving, setSummaryPromptSaving] = useState(false);
  const [summaryPromptMsg, setSummaryPromptMsg] = useState<string | null>(null);

  // Local copy of agent capabilities for editing
  const [localCaps, setLocalCaps] = useState<AgentCapabilities>(agentCapabilities);

  // UI Preferences
  const uiPreferences = useSettingsStore((s) => s.uiPreferences);
  const saveUiPreferencesAction = useSettingsStore((s) => s.saveUiPreferences);
  const [localUiPrefs, setLocalUiPrefs] = useState<UIPreferences>(uiPreferences);

  // Usage tracking
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [usageHistory, setUsageHistory] = useState<UsageLogEntry[]>([]);
  const [usageExpanded, setUsageExpanded] = useState(false);
  const [usageClearing, setUsageClearing] = useState(false);

  // Supabase cloud sync
  const supabaseConfigured = useSyncStore((s) => s.isConfigured);
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState("");
  const [supabaseSaving, setSupabaseSaving] = useState(false);
  const [supabaseMsg, setSupabaseMsg] = useState<string | null>(null);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [showAnonKey, setShowAnonKey] = useState(false);

  // Profile
  const userStoreId = useUserStore((s) => s.userId);
  const userStoreName = useUserStore((s) => s.userName);
  const [profileName, setProfileName] = useState(userStoreName ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  // Restore sample file
  const [restoringSample, setRestoringSample] = useState(false);
  const [restoreSampleMsg, setRestoreSampleMsg] = useState<string | null>(null);

  // Refresh status when dialog opens
  useEffect(() => {
    if (isOpen) {
      useSettingsStore.getState().loadApiKeyStatus();
      useSettingsStore.getState().loadGeminiApiKeyStatus();
      useSettingsStore.getState().loadAgentCapabilities();
      useSettingsStore.getState().loadUiPreferences();
      setKeyInput("");
      setError(null);
      setSuccessMsg(null);
      setGeminiKeyInput("");
      setGeminiError(null);
      setGeminiSuccessMsg(null);

      // Load usage data
      cmd.getUsageSummary().then(setUsageSummary).catch(() => setUsageSummary(null));
      cmd.getUsageHistory(20).then(setUsageHistory).catch(() => setUsageHistory([]));

      // Load paper summary prompt
      cmd.getPaperSummaryPrompt().then((p) => {
        setSummaryPrompt(p);
        setSummaryPromptOriginal(p);
      }).catch(console.error);
      setSummaryPromptMsg(null);

      // Load Supabase config
      useSyncStore.getState().loadConfig();
      cmd.getSupabaseConfig().then(([url, key]) => {
        setSupabaseUrl(url);
        setSupabaseAnonKey(key);
      }).catch(() => {});
      setSupabaseMsg(null);
      setSupabaseError(null);
      setShowAnonKey(false);

      // Load profile
      useUserStore.getState().loadUser();
      setProfileName(useUserStore.getState().userName ?? "");
      setProfileMsg(null);
    }
  }, [isOpen]);

  // Sync profile name when store changes
  useEffect(() => {
    setProfileName(userStoreName ?? "");
  }, [userStoreName]);

  // Sync local capabilities when store changes
  useEffect(() => {
    setLocalCaps(agentCapabilities);
  }, [agentCapabilities]);

  // Sync local UI preferences when store changes
  useEffect(() => {
    setLocalUiPrefs(uiPreferences);
  }, [uiPreferences]);

  const handleCapsChange = useCallback(
    (update: Partial<AgentCapabilities>) => {
      const next = { ...localCaps, ...update };
      setLocalCaps(next);
      saveAgentCapabilitiesAction(next);
    },
    [localCaps, saveAgentCapabilitiesAction],
  );

  const handleUiPrefsChange = useCallback(
    (update: Partial<UIPreferences>) => {
      const next = { ...localUiPrefs, ...update };
      setLocalUiPrefs(next);
      saveUiPreferencesAction(next);
    },
    [localUiPrefs, saveUiPreferencesAction],
  );

  const handleResetUiPrefs = useCallback(() => {
    setLocalUiPrefs({ ...SYSTEM_DEFAULTS });
    saveUiPreferencesAction({ ...SYSTEM_DEFAULTS });
  }, [saveUiPreferencesAction]);

  const handleClearUsage = useCallback(async () => {
    if (!window.confirm("This will delete all usage history for this project. Continue?")) {
      return;
    }
    setUsageClearing(true);
    try {
      await cmd.clearUsageLog();
      const summary = await cmd.getUsageSummary();
      setUsageSummary(summary);
      setUsageHistory([]);
      setUsageExpanded(false);
    } catch (e) {
      console.error("Failed to clear usage log:", e);
    } finally {
      setUsageClearing(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    setError(null);
    setSuccessMsg(null);

    if (!keyInput.startsWith("sk-ant-")) {
      setError("API key must start with \"sk-ant-\"");
      return;
    }
    if (keyInput.length < 20) {
      setError("API key is too short");
      return;
    }

    setSaving(true);
    try {
      await cmd.saveApiKey(keyInput);
      await useSettingsStore.getState().loadApiKeyStatus();
      setKeyInput("");
      setSuccessMsg("API key saved successfully");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [keyInput]);

  const handleRemove = useCallback(async () => {
    setError(null);
    setSuccessMsg(null);
    try {
      await cmd.deleteApiKey();
      await useSettingsStore.getState().loadApiKeyStatus();
      setSuccessMsg("API key removed");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !saving && keyInput.trim()) {
        handleSave();
      }
    },
    [handleSave, saving, keyInput],
  );

  const handleOpenConsole = useCallback(() => {
    shellOpen(CONSOLE_URL).catch((err) =>
      console.error("Failed to open URL:", err),
    );
  }, []);

  // ─── Gemini key handlers ───

  const handleGeminiSave = useCallback(async () => {
    setGeminiError(null);
    setGeminiSuccessMsg(null);

    if (geminiKeyInput.length < 10) {
      setGeminiError("API key is too short");
      return;
    }

    setGeminiSaving(true);
    try {
      await cmd.saveGeminiApiKey(geminiKeyInput);
      await useSettingsStore.getState().loadGeminiApiKeyStatus();
      setGeminiKeyInput("");
      setGeminiSuccessMsg("Gemini API key saved successfully");
    } catch (e) {
      setGeminiError(String(e));
    } finally {
      setGeminiSaving(false);
    }
  }, [geminiKeyInput]);

  const handleGeminiRemove = useCallback(async () => {
    setGeminiError(null);
    setGeminiSuccessMsg(null);
    try {
      await cmd.deleteGeminiApiKey();
      await useSettingsStore.getState().loadGeminiApiKeyStatus();
      setGeminiSuccessMsg("Gemini API key removed");
    } catch (e) {
      setGeminiError(String(e));
    }
  }, []);

  const handleGeminiKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !geminiSaving && geminiKeyInput.trim()) {
        handleGeminiSave();
      }
    },
    [handleGeminiSave, geminiSaving, geminiKeyInput],
  );

  const handleOpenGeminiConsole = useCallback(() => {
    shellOpen(GEMINI_CONSOLE_URL).catch((err) =>
      console.error("Failed to open URL:", err),
    );
  }, []);

  if (!isOpen) return null;

  const hasKey = apiKeyStatus !== null;
  const masterOn = localCaps.agent_enabled;

  const settingsTabs: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { key: "profile", label: "Profile", icon: <PersonIcon sx={{ fontSize: 14 }} /> },
    { key: "api_keys", label: "API Keys", icon: <LockIcon sx={{ fontSize: 14 }} /> },
    { key: "agent", label: "Agent", icon: <AutoAwesomeIcon sx={{ fontSize: 14 }} /> },
    { key: "ui_layout", label: "UI Layout", icon: <GridViewIcon sx={{ fontSize: 14 }} /> },
    { key: "usage_sync", label: "Usage & Sync", icon: <DataUsageIcon sx={{ fontSize: 14 }} /> },
  ];

  return (
    <div style={overlayStyle} onClick={closeSettings}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={titleStyle}>Settings</h2>
          <button onClick={closeSettings} style={closeButtonStyle}>
            <CloseIcon sx={{ fontSize: 22 }} />
          </button>
        </div>

        {/* Tab Bar */}
        <div style={tabBarStyle}>
          {settingsTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                ...tabButtonStyle,
                ...(activeTab === tab.key ? tabButtonActiveStyle : {}),
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={tabContentStyle}>

        {/* ── Profile Tab ── */}
        {activeTab === "profile" && (
          <>
            <div style={sectionStyle}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 12 }}>Profile</div>

              {/* User ID (read-only) */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: "#6b7280", display: "block", marginBottom: 4 }}>User ID</label>
                <div
                  style={{
                    fontSize: 13,
                    fontFamily: "monospace",
                    color: "#6b7280",
                    padding: "8px 12px",
                    background: "#f9fafb",
                    borderRadius: 6,
                    border: "1px solid #e5e7eb",
                    cursor: "default",
                  }}
                  title={userStoreId ?? "Not registered"}
                >
                  {userStoreId ? userStoreId.slice(0, 8) + "..." : "Not registered"}
                </div>
              </div>

              {/* User Name (editable) */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: "#6b7280", display: "block", marginBottom: 4 }}>Display Name</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="text"
                    value={profileName}
                    onChange={(e) => { setProfileName(e.target.value); setProfileMsg(null); }}
                    placeholder="Your name"
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                  <button
                    disabled={profileSaving || !profileName.trim() || profileName.trim() === userStoreName}
                    onClick={async () => {
                      setProfileSaving(true);
                      setProfileMsg(null);
                      try {
                        await useUserStore.getState().updateUserName(profileName.trim());
                        setProfileMsg("Saved");
                        setTimeout(() => setProfileMsg(null), 2000);
                      } catch {
                        setProfileMsg("Failed to save");
                      } finally {
                        setProfileSaving(false);
                      }
                    }}
                    style={{
                      padding: "8px 16px",
                      background: "#1e40af",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      opacity: profileSaving || !profileName.trim() || profileName.trim() === userStoreName ? 0.5 : 1,
                    }}
                  >
                    {profileSaving ? "..." : "Save"}
                  </button>
                </div>
                {profileMsg && (
                  <div style={{ fontSize: 11, color: profileMsg === "Saved" ? "#059669" : "#dc2626", marginTop: 4 }}>
                    {profileMsg}
                  </div>
                )}
              </div>
            </div>

            {/* Open Sample File (read-only template) */}
            <div style={sectionStyle}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Sample File</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
                Open the built-in sample as a new untitled document. Saving prompts for a new location — the built-in sample is never overwritten.
              </div>
              <button
                disabled={restoringSample}
                onClick={async () => {
                  setRestoringSample(true);
                  setRestoreSampleMsg(null);
                  try {
                    await useFileStore.getState().openSample();
                    closeSettings();
                  } catch (err) {
                    setRestoreSampleMsg("Failed to open sample: " + String(err));
                  } finally {
                    setRestoringSample(false);
                  }
                }}
                style={{
                  padding: "8px 20px",
                  background: "#f9fafb",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: restoringSample ? "default" : "pointer",
                  opacity: restoringSample ? 0.6 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                {restoringSample ? "Opening..." : "Open Sample"}
              </button>
              {restoreSampleMsg && (
                <div style={{
                  fontSize: 11,
                  color: restoreSampleMsg.startsWith("Failed") ? "#dc2626" : "#059669",
                  marginTop: 8,
                }}>
                  {restoreSampleMsg}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── API Keys Tab ── */}
        {activeTab === "api_keys" && (
          <>
            {/* Anthropic API Key */}
            <div style={sectionStyle}>
              {hasKey ? (
                <>
                  <div style={connectedHeaderStyle}>
                    <CheckCircleIcon sx={{ fontSize: 18, color: "#059669", flexShrink: 0 }} />
                    <span style={connectedTitleStyle}>API Key Connected</span>
                  </div>
                  <div style={keyDisplayStyle}>
                    <div style={maskedKeyStyle}>
                      <span style={keyLabelStyle}>Current key</span>
                      <code style={keyCodeStyle}>{apiKeyStatus}</code>
                    </div>
                    <button onClick={handleRemove} style={removeBtnStyle}>
                      Remove Key
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={onboardingHeaderStyle}>
                    <PsychologyIcon sx={{ fontSize: 18, color: "#1e40af", flexShrink: 0 }} />
                    <span style={onboardingTitleStyle}>Connect to Claude API</span>
                  </div>
                  <div style={onboardingDescStyle}>
                    Cladel uses Claude to power its research assistant. You'll need
                    an Anthropic API key to enable AI features.
                  </div>
                  <div style={stepsContainerStyle}>
                    <div style={stepStyle}>
                      <span style={stepNumberStyle}>1</span>
                      <div style={stepContentStyle}>
                        <span style={stepTextStyle}>
                          Visit the Anthropic Console to create your API key
                        </span>
                        <button onClick={handleOpenConsole} style={consoleBtnStyle}>
                          <span>Open Anthropic Console</span>
                          <OpenInNewIcon sx={{ fontSize: 12, flexShrink: 0 }} />
                        </button>
                      </div>
                    </div>
                    <div style={stepStyle}>
                      <span style={stepNumberStyle}>2</span>
                      <span style={stepTextStyle}>
                        Copy your API key (starts with{" "}
                        <code style={inlineCodeStyle}>sk-ant-</code>)
                      </span>
                    </div>
                    <div style={stepStyle}>
                      <span style={stepNumberStyle}>3</span>
                      <span style={stepTextStyle}>Paste it below</span>
                    </div>
                  </div>
                  <div style={keyInputRowStyle}>
                    <input
                      type="password"
                      value={keyInput}
                      onChange={(e) => {
                        setKeyInput(e.target.value);
                        setError(null);
                        setSuccessMsg(null);
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder="sk-ant-api03-..."
                      style={inputStyle}
                      autoFocus
                    />
                    <button
                      onClick={handleSave}
                      disabled={saving || !keyInput.trim()}
                      style={saving || !keyInput.trim() ? disabledSaveBtnStyle : saveBtnStyle}
                    >
                      {saving ? "Saving..." : "Save Key"}
                    </button>
                  </div>
                </>
              )}
              {error && <div style={errorStyle}>{error}</div>}
              {successMsg && <div style={successStyle}>{successMsg}</div>}
              <div style={securityNoteStyle}>
                <LockIcon sx={{ fontSize: 12, color: "#9ca3af", flexShrink: 0, mt: "1px" }} />
                <span>
                  Your key is stored securely in your system's keychain and never
                  sent anywhere except Anthropic's API.
                </span>
              </div>
            </div>

            <div style={dividerStyle} />

            {/* Gemini API Key */}
            <div style={sectionStyle}>
              {geminiApiKeyStatus ? (
                <>
                  <div style={connectedHeaderStyle}>
                    <CheckCircleIcon sx={{ fontSize: 18, color: "#1a73e8", flexShrink: 0 }} />
                    <span style={connectedTitleStyle}>Gemini API Key Connected</span>
                  </div>
                  <div style={keyDisplayStyle}>
                    <div style={maskedKeyStyle}>
                      <span style={keyLabelStyle}>Current key</span>
                      <code style={keyCodeStyle}>{geminiApiKeyStatus}</code>
                    </div>
                    <button onClick={handleGeminiRemove} style={removeBtnStyle}>
                      Remove Key
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={onboardingHeaderStyle}>
                    <PsychologyIcon sx={{ fontSize: 18, color: "#1a73e8", flexShrink: 0 }} />
                    <span style={onboardingTitleStyle}>Connect to Gemini API</span>
                  </div>
                  <div style={onboardingDescStyle}>
                    Optionally add a Google Gemini API key to use Gemini as an
                    alternative AI provider in Agent nodes and the Agent panel.
                  </div>
                  <div style={stepsContainerStyle}>
                    <div style={stepStyle}>
                      <span style={stepNumberStyle}>1</span>
                      <div style={stepContentStyle}>
                        <span style={stepTextStyle}>
                          Visit Google AI Studio to create your API key
                        </span>
                        <button onClick={handleOpenGeminiConsole} style={consoleBtnStyle}>
                          <span>Open Google AI Studio</span>
                          <OpenInNewIcon sx={{ fontSize: 12, flexShrink: 0 }} />
                        </button>
                      </div>
                    </div>
                    <div style={stepStyle}>
                      <span style={stepNumberStyle}>2</span>
                      <span style={stepTextStyle}>Copy your API key</span>
                    </div>
                    <div style={stepStyle}>
                      <span style={stepNumberStyle}>3</span>
                      <span style={stepTextStyle}>Paste it below</span>
                    </div>
                  </div>
                  <div style={keyInputRowStyle}>
                    <input
                      type="password"
                      value={geminiKeyInput}
                      onChange={(e) => {
                        setGeminiKeyInput(e.target.value);
                        setGeminiError(null);
                        setGeminiSuccessMsg(null);
                      }}
                      onKeyDown={handleGeminiKeyDown}
                      placeholder="AIza..."
                      style={inputStyle}
                    />
                    <button
                      onClick={handleGeminiSave}
                      disabled={geminiSaving || !geminiKeyInput.trim()}
                      style={geminiSaving || !geminiKeyInput.trim() ? disabledSaveBtnStyle : saveBtnStyle}
                    >
                      {geminiSaving ? "Saving..." : "Save Key"}
                    </button>
                  </div>
                </>
              )}
              {geminiError && <div style={errorStyle}>{geminiError}</div>}
              {geminiSuccessMsg && <div style={successStyle}>{geminiSuccessMsg}</div>}
              <div style={securityNoteStyle}>
                <LockIcon sx={{ fontSize: 12, color: "#9ca3af", flexShrink: 0, mt: "1px" }} />
                <span>
                  Your key is stored locally and only sent to Google's Gemini API.
                </span>
              </div>
            </div>
          </>
        )}

        {/* ── Agent Tab ── */}
        {activeTab === "agent" && (
          <>
            {/* Agent capabilities */}
            <div style={sectionStyle}>
              <CapabilityRow
                label="Enable Research Agent"
                description="AI-powered research assistant that helps with literature search, idea generation, and graph analysis"
                checked={masterOn}
                onChange={(v) => handleCapsChange({ agent_enabled: v })}
              />
              <div style={dividerStyle} />
              <div style={{
                opacity: masterOn ? 1 : 0.5,
                pointerEvents: masterOn ? "auto" : "none",
                transition: "opacity 150ms ease",
              }}>
                <div style={subHeadingStyle}>Capabilities</div>
                <div style={capsListStyle}>
                  <div style={indentedCapStyle}>
                    <CapabilityRow
                      label="Autonomous Analysis"
                      description="Automatically analyze your graph during idle time"
                      checked={localCaps.autonomous_enabled}
                      onChange={(v) => handleCapsChange({ autonomous_enabled: v })}
                      disabled={!masterOn}
                    >
                      <div style={{
                        overflow: "hidden",
                        maxHeight: localCaps.autonomous_enabled && masterOn ? 140 : 0,
                        opacity: localCaps.autonomous_enabled && masterOn ? 1 : 0,
                        transition: "max-height 200ms ease, opacity 150ms ease",
                        marginTop: localCaps.autonomous_enabled && masterOn ? 8 : 0,
                        paddingLeft: 46,
                      }}>
                        <div style={sliderRowStyle}>
                          <div style={sliderLabelRowStyle}>
                            <span style={sliderLabelStyle}>Idle time before trigger</span>
                            <span style={sliderValueStyle}>{localCaps.autonomous_idle_seconds}s</span>
                          </div>
                          <input
                            type="range" min={15} max={120} step={5}
                            value={localCaps.autonomous_idle_seconds}
                            onChange={(e) => handleCapsChange({ autonomous_idle_seconds: Number(e.target.value) })}
                            style={sliderStyle}
                          />
                          <div style={sliderHintRowStyle}><span>15s</span><span>120s</span></div>
                        </div>
                        <div style={sliderRowStyle}>
                          <div style={sliderLabelRowStyle}>
                            <span style={sliderLabelStyle}>Cooldown between triggers</span>
                            <span style={sliderValueStyle}>{localCaps.autonomous_cooldown_seconds}s</span>
                          </div>
                          <input
                            type="range" min={30} max={300} step={10}
                            value={localCaps.autonomous_cooldown_seconds}
                            onChange={(e) => handleCapsChange({ autonomous_cooldown_seconds: Number(e.target.value) })}
                            style={sliderStyle}
                          />
                          <div style={sliderHintRowStyle}><span>30s</span><span>300s</span></div>
                        </div>
                      </div>
                    </CapabilityRow>
                  </div>
                  <div style={indentedCapStyle}>
                    <CapabilityRow label="Paper Search" description="Search and suggest relevant papers"
                      checked={localCaps.search_papers_enabled}
                      onChange={(v) => handleCapsChange({ search_papers_enabled: v })} disabled={!masterOn} />
                  </div>
                  <div style={indentedCapStyle}>
                    <CapabilityRow label="Suggest Connections" description="Propose connections between existing nodes"
                      checked={localCaps.suggest_connections_enabled}
                      onChange={(v) => handleCapsChange({ suggest_connections_enabled: v })} disabled={!masterOn} />
                  </div>
                  <div style={indentedCapStyle}>
                    <CapabilityRow label="Suggest Ideas" description="Generate new research ideas and perspectives"
                      checked={localCaps.suggest_ideas_enabled}
                      onChange={(v) => handleCapsChange({ suggest_ideas_enabled: v })} disabled={!masterOn} />
                  </div>
                </div>
              </div>
            </div>

            <div style={dividerStyle} />

            {/* Paper Summary Prompt */}
            <div style={sectionStyle}>
              <div style={agentSectionHeaderStyle}>
                <PsychologyIcon sx={{ fontSize: 16, color: "#1a73e8", flexShrink: 0 }} />
                <span style={agentSectionTitleStyle}>Paper Summary Prompt Template</span>
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
                This prompt is sent with the PDF to Gemini for summarization.
              </div>
              <textarea
                value={summaryPrompt}
                onChange={(e) => { setSummaryPrompt(e.target.value); setSummaryPromptMsg(null); }}
                rows={8}
                style={{
                  width: "100%", padding: "8px 10px", fontSize: 12,
                  border: "1px solid #d1d5db", borderRadius: 6, resize: "vertical",
                  outline: "none", fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={async () => {
                    setSummaryPromptSaving(true); setSummaryPromptMsg(null);
                    try {
                      await cmd.savePaperSummaryPrompt(summaryPrompt);
                      setSummaryPromptOriginal(summaryPrompt); setSummaryPromptMsg("Saved");
                    } catch { setSummaryPromptMsg("Failed to save"); }
                    finally { setSummaryPromptSaving(false); }
                  }}
                  disabled={summaryPrompt === summaryPromptOriginal || summaryPromptSaving}
                  style={{
                    padding: "5px 14px", fontSize: 12, fontWeight: 500,
                    color: summaryPrompt === summaryPromptOriginal ? "#9ca3af" : "#fff",
                    background: summaryPrompt === summaryPromptOriginal ? "#e5e7eb" : "#1a73e8",
                    border: "none", borderRadius: 5,
                    cursor: summaryPrompt === summaryPromptOriginal ? "not-allowed" : "pointer",
                  }}
                >
                  {summaryPromptSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={async () => {
                    setSummaryPromptSaving(true); setSummaryPromptMsg(null);
                    try {
                      await cmd.resetPaperSummaryPrompt();
                      const fresh = await cmd.getPaperSummaryPrompt();
                      setSummaryPrompt(fresh); setSummaryPromptOriginal(fresh);
                      setSummaryPromptMsg("Reset to default");
                    } catch { setSummaryPromptMsg("Failed to reset"); }
                    finally { setSummaryPromptSaving(false); }
                  }}
                  disabled={summaryPromptSaving}
                  style={{
                    padding: "5px 14px", fontSize: 12, fontWeight: 500, color: "#374151",
                    background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 5,
                    cursor: summaryPromptSaving ? "not-allowed" : "pointer",
                  }}
                >
                  Reset to Default
                </button>
              </div>
              {summaryPromptMsg && (
                <div style={{ fontSize: 11, color: summaryPromptMsg.includes("Failed") ? "#dc2626" : "#059669", marginTop: 6 }}>
                  {summaryPromptMsg}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── UI Layout Tab ── */}
        {activeTab === "ui_layout" && (
          <div style={sectionStyle}>
            <div style={subHeadingStyle}>Language</div>
            <div style={uiRowStyle}>
              <span style={uiFieldLabelStyle}>Display language</span>
              <div style={{ display: "flex", gap: 6 }}>
                {(["en", "ja"] as const).map((lng) => {
                  const active = localUiPrefs.language === lng;
                  return (
                    <button
                      key={lng}
                      onClick={() => handleUiPrefsChange({ language: lng })}
                      style={{
                        padding: "5px 14px",
                        fontSize: 13,
                        fontWeight: 600,
                        borderRadius: 6,
                        cursor: "pointer",
                        border: active ? "1px solid #2563eb" : "1px solid #d1d5db",
                        background: active ? "#2563eb" : "#fff",
                        color: active ? "#fff" : "#374151",
                      }}
                    >
                      {lng === "en" ? "English" : "日本語"}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={dividerStyle} />

            <div style={subHeadingStyle}>Default Node Sizes</div>
            <div style={uiGridStyle}>
              <NodeSizeRow label="Core" color="#1e40af"
                width={localUiPrefs.core_default_width} height={localUiPrefs.core_default_height}
                onWidthChange={(v) => handleUiPrefsChange({ core_default_width: v })}
                onHeightChange={(v) => handleUiPrefsChange({ core_default_height: v })} />
              <NodeSizeRow label="Paper" color="#059669"
                width={localUiPrefs.paper_default_width} height={localUiPrefs.paper_default_height}
                onWidthChange={(v) => handleUiPrefsChange({ paper_default_width: v })}
                onHeightChange={(v) => handleUiPrefsChange({ paper_default_height: v })} />
              <NodeSizeRow label="Note" color="#d97706"
                width={localUiPrefs.user_doc_default_width} height={localUiPrefs.user_doc_default_height}
                onWidthChange={(v) => handleUiPrefsChange({ user_doc_default_width: v })}
                onHeightChange={(v) => handleUiPrefsChange({ user_doc_default_height: v })} />
              <NodeSizeRow label="Ghost" color="#7c3aed"
                width={localUiPrefs.ghost_default_width} height={localUiPrefs.ghost_default_height}
                onWidthChange={(v) => handleUiPrefsChange({ ghost_default_width: v })}
                onHeightChange={(v) => handleUiPrefsChange({ ghost_default_height: v })} />
              <NodeSizeRow label="Image" color="#0891b2"
                width={localUiPrefs.image_default_width} height={localUiPrefs.image_default_height}
                onWidthChange={(v) => handleUiPrefsChange({ image_default_width: v })}
                onHeightChange={(v) => handleUiPrefsChange({ image_default_height: v })} />
            </div>

            <div style={dividerStyle} />

            <div style={subHeadingStyle}>Sidebar</div>
            <div style={uiRowStyle}>
              <span style={uiFieldLabelStyle}>Default width</span>
              <div style={uiInputGroupStyle}>
                <input type="number" min={280} max={800} step={10}
                  value={localUiPrefs.sidebar_default_width}
                  onChange={(e) => { const v = Number(e.target.value); if (v >= 280 && v <= 800) handleUiPrefsChange({ sidebar_default_width: v }); }}
                  style={uiNumberInputStyle} />
                <span style={uiUnitStyle}>px</span>
              </div>
            </div>

            <div style={dividerStyle} />

            <div style={subHeadingStyle}>Canvas</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={uiRowStyle}>
                <span style={uiFieldLabelStyle}>Background color</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="color" value={localUiPrefs.canvas_background}
                    onChange={(e) => handleUiPrefsChange({ canvas_background: e.target.value })}
                    style={colorInputStyle} />
                  <code style={colorCodeStyle}>{localUiPrefs.canvas_background}</code>
                </div>
              </div>
              <div style={uiRowStyle}>
                <span style={uiFieldLabelStyle}>Show grid</span>
                <ToggleSwitch checked={localUiPrefs.canvas_grid_enabled}
                  onChange={(v) => handleUiPrefsChange({ canvas_grid_enabled: v })} />
              </div>
              <div style={{
                ...uiRowStyle,
                opacity: localUiPrefs.canvas_grid_enabled ? 1 : 0.5,
                pointerEvents: localUiPrefs.canvas_grid_enabled ? "auto" : "none",
              }}>
                <span style={uiFieldLabelStyle}>Grid size</span>
                <div style={uiInputGroupStyle}>
                  <input type="number" min={10} max={100} step={5}
                    value={localUiPrefs.canvas_grid_size}
                    onChange={(e) => { const v = Number(e.target.value); if (v >= 10 && v <= 100) handleUiPrefsChange({ canvas_grid_size: v }); }}
                    style={uiNumberInputStyle} />
                  <span style={uiUnitStyle}>px</span>
                </div>
              </div>
            </div>

            <div style={dividerStyle} />

            <div style={subHeadingStyle}>Editor</div>
            <div style={uiRowStyle}>
              <span style={uiFieldLabelStyle}>Font size</span>
              <div style={uiInputGroupStyle}>
                <input type="number" min={1} step={1}
                  value={localUiPrefs.editor_font_size}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const v = Number(raw);
                    if (raw !== "" && !isNaN(v) && v > 0) handleUiPrefsChange({ editor_font_size: v });
                  }}
                  style={uiNumberInputStyle} />
                <span style={uiUnitStyle}>px</span>
              </div>
            </div>

            <div style={dividerStyle} />

            <button onClick={handleResetUiPrefs} style={resetBtnStyle}>
              Reset to Defaults
            </button>
          </div>
        )}

        {/* ── Usage & Sync Tab ── */}
        {activeTab === "usage_sync" && (
          <>
            {/* API Usage */}
            <div style={sectionStyle}>
              <div style={agentSectionHeaderStyle}>
                <DataUsageIcon sx={{ fontSize: 16, color: "#3b82f6", flexShrink: 0 }} />
                <span style={agentSectionTitleStyle}>API Usage</span>
              </div>

              {usageSummary && usageSummary.total_calls > 0 ? (
                <>
                  <div style={usageCardsRowStyle}>
                    <div style={usageCardStyle}>
                      <div style={usageCardValueStyle}>{usageSummary.total_calls}</div>
                      <div style={usageCardLabelStyle}>Total Calls</div>
                    </div>
                    <div style={usageCardStyle}>
                      <div style={usageCardValueStyle}>{formatTokens(usageSummary.total_tokens)}</div>
                      <div style={usageCardLabelStyle}>Tokens Used</div>
                    </div>
                    <div style={usageCardStyle}>
                      <div style={{ ...usageCardValueStyle, color: "#059669" }}>
                        ${usageSummary.estimated_cost_usd.toFixed(2)}
                      </div>
                      <div style={usageCardLabelStyle}>Est. Cost</div>
                    </div>
                    <div style={usageCardStyle}>
                      <div style={usageCardValueStyle}>{usageSummary.calls_today}</div>
                      <div style={usageCardLabelStyle}>Today</div>
                      <div style={usageCardSubStyle}>{formatTokens(usageSummary.tokens_today)} tok</div>
                    </div>
                  </div>

                  {(usageSummary.by_invocation_type.length > 0 || usageSummary.by_model.length > 0) && (
                    <div style={usageBreakdownRowStyle}>
                      {usageSummary.by_invocation_type.length > 0 && (
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={usageTableHeaderStyle}>By Type</div>
                          <table style={usageTableStyle}><tbody>
                            {usageSummary.by_invocation_type.map((t) => (
                              <tr key={t.invocation_type}>
                                <td style={usageTdStyle}>{formatInvocationType(t.invocation_type)}</td>
                                <td style={usageTdRightStyle}>{t.count}</td>
                                <td style={usageTdRightStyle}>{formatTokens(t.total_tokens)}</td>
                              </tr>
                            ))}
                          </tbody></table>
                        </div>
                      )}
                      {usageSummary.by_model.length > 0 && (
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={usageTableHeaderStyle}>By Model</div>
                          <table style={usageTableStyle}><tbody>
                            {usageSummary.by_model.map((m) => (
                              <tr key={m.model}>
                                <td style={usageTdStyle}>{formatModelName(m.model)}</td>
                                <td style={usageTdRightStyle}>{m.count}</td>
                                <td style={usageTdRightStyle}>{formatTokens(m.total_tokens)}</td>
                              </tr>
                            ))}
                          </tbody></table>
                        </div>
                      )}
                    </div>
                  )}

                  <button onClick={() => setUsageExpanded((v) => !v)} style={usageExpandBtnStyle}>
                    <span>Recent API Calls</span>
                    {usageExpanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
                  </button>

                  {usageExpanded && usageHistory.length > 0 && (
                    <div style={usageHistoryContainerStyle}>
                      {usageHistory.map((entry) => (
                        <div key={entry.id} style={usageHistoryRowStyle}>
                          <span style={usageHistoryTimeStyle}>{formatRelativeTime(entry.created_at)}</span>
                          <span style={usageTypeBadgeStyle}>{formatInvocationType(entry.invocation_type)}</span>
                          <span style={usageHistoryTokensStyle}>
                            {formatTokens(entry.input_tokens)}↓ {formatTokens(entry.output_tokens)}↑
                          </span>
                          {entry.success
                            ? <CheckCircleOutlineIcon sx={{ fontSize: 14, color: "#059669" }} />
                            : <ErrorOutlineIcon sx={{ fontSize: 14, color: "#dc2626" }} />}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={dividerStyle} />

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <button onClick={handleClearUsage} disabled={usageClearing} style={usageClearBtnStyle}>
                      {usageClearing ? "Clearing..." : "Clear Usage Data"}
                    </button>
                    <span style={usageFootnoteStyle}>Usage is tracked per project file.</span>
                  </div>
                </>
              ) : (
                <div style={usageEmptyStyle}>
                  No API usage recorded yet. Usage will appear here after agent calls.
                </div>
              )}
            </div>

            <div style={dividerStyle} />

            {/* Cloud Sync */}
            <div style={sectionStyle}>
              <div style={agentSectionHeaderStyle}>
                <CloudSyncIcon sx={{ fontSize: 16, color: "#0891b2", flexShrink: 0 }} />
                <span style={agentSectionTitleStyle}>Cloud Sync</span>
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>
                Connect your own Supabase project to sync .cld files across devices.
                Each user provides their own Supabase project credentials.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                  background: supabaseConfigured ? "#059669" : "#d1d5db",
                }} />
                <span style={{ fontSize: 12, color: supabaseConfigured ? "#059669" : "#9ca3af" }}>
                  {supabaseConfigured ? "Connected" : "Not configured"}
                </span>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={cloudFieldLabelStyle}>Supabase Project URL</label>
                <input type="text" value={supabaseUrl}
                  onChange={(e) => setSupabaseUrl(e.target.value)}
                  placeholder="https://xxxx.supabase.co" style={inputStyle} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={cloudFieldLabelStyle}>Supabase Anon Key</label>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input type={showAnonKey ? "text" : "password"} value={supabaseAnonKey}
                    onChange={(e) => setSupabaseAnonKey(e.target.value)}
                    placeholder="eyJhbGci..." style={{ ...inputStyle, flex: 1 }} />
                  <button onClick={() => setShowAnonKey((v) => !v)}
                    style={cloudToggleVisStyle} title={showAnonKey ? "Hide" : "Show"}>
                    {showAnonKey ? <VisibilityOffIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={async () => {
                    setSupabaseMsg(null); setSupabaseError(null); setSupabaseSaving(true);
                    try {
                      await cmd.saveSupabaseConfig(supabaseUrl.trim(), supabaseAnonKey.trim());
                      await useSyncStore.getState().loadConfig();
                      setSupabaseMsg("Supabase config saved.");
                    } catch (e) { setSupabaseError(String(e)); }
                    finally { setSupabaseSaving(false); }
                  }}
                  disabled={supabaseSaving || !supabaseUrl.trim() || !supabaseAnonKey.trim()}
                  style={supabaseSaving || !supabaseUrl.trim() || !supabaseAnonKey.trim() ? disabledSaveBtnStyle : saveBtnStyle}
                >
                  {supabaseSaving ? "Saving..." : "Save"}
                </button>
                {supabaseConfigured && (
                  <button
                    onClick={async () => {
                      setSupabaseMsg(null); setSupabaseError(null);
                      try {
                        await cmd.deleteSupabaseConfig();
                        await useSyncStore.getState().loadConfig();
                        setSupabaseUrl(""); setSupabaseAnonKey("");
                        setSupabaseMsg("Supabase disconnected.");
                      } catch (e) { setSupabaseError(String(e)); }
                    }}
                    style={removeBtnStyle}
                  >
                    Disconnect
                  </button>
                )}
              </div>
              {supabaseMsg && (
                <div style={cloudSuccessStyle}>
                  <CheckCircleOutlineIcon sx={{ fontSize: 14 }} />{supabaseMsg}
                </div>
              )}
              {supabaseError && (
                <div style={cloudErrorStyle}>
                  <ErrorOutlineIcon sx={{ fontSize: 14 }} />{supabaseError}
                </div>
              )}
              <button
                onClick={() => shellOpen("https://supabase.com/docs/guides/api").catch(console.error)}
                style={cloudHelpLinkStyle}
              >
                How to get your Supabase credentials
                <OpenInNewIcon sx={{ fontSize: 12 }} />
              </button>
            </div>
          </>
        )}

        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <button onClick={closeSettings} style={doneBtnStyle}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Usage helpers ───

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatInvocationType(t: string): string {
  switch (t) {
    case "general": return "Manual";
    case "autonomous": return "Auto";
    case "search_papers": return "Search";
    case "suggest_connections": return "Connect";
    case "suggest_ideas": return "Ideas";
    default: return t;
  }
}

function formatModelName(model: string): string {
  if (model.includes("opus")) return "Opus 4";
  if (model.includes("haiku")) return "Haiku 4.5";
  if (model.includes("sonnet")) return "Sonnet 4";
  return model;
}

function formatRelativeTime(isoStr: string): string {
  try {
    const date = new Date(isoStr + "Z"); // SQLite datetime is UTC without Z
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  } catch {
    return isoStr;
  }
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 3500,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialogStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 24,
  width: 480,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflow: "hidden",
  boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 0,
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  gap: 0,
  borderBottom: "1px solid #e5e7eb",
  marginBottom: 16,
  marginTop: 4,
  flexShrink: 0,
};

const tabButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  padding: "8px 14px",
  fontSize: 12,
  fontWeight: 500,
  color: "#6b7280",
  background: "none",
  border: "none",
  borderBottom: "2px solid transparent",
  cursor: "pointer",
  transition: "color 100ms ease, border-color 100ms ease",
  whiteSpace: "nowrap",
};

const tabButtonActiveStyle: React.CSSProperties = {
  color: "#1e40af",
  borderBottomColor: "#1e40af",
  fontWeight: 600,
};

const tabContentStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  color: "#111827",
};

const closeButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 24,
  cursor: "pointer",
  color: "#9ca3af",
  padding: "0 4px",
  lineHeight: 1,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 20,
};

// ── Connected state styles ──

const connectedHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
};

const connectedTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#059669",
};

const keyDisplayStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
};

const maskedKeyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const keyLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
  fontWeight: 500,
};

const keyCodeStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#374151",
  fontFamily: "monospace",
};

const removeBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "#fef2f2",
  color: "#dc2626",
  border: "1px solid #fecaca",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  flexShrink: 0,
};

// ── Onboarding state styles ──

const onboardingHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 6,
};

const onboardingTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#111827",
};

const onboardingDescStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  lineHeight: 1.5,
  marginBottom: 14,
};

const stepsContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  marginBottom: 14,
};

const stepStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
};

const stepNumberStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: "50%",
  background: "#eff6ff",
  color: "#1e40af",
  fontSize: 11,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  marginTop: 1,
};

const stepContentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const stepTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#374151",
  lineHeight: 1.4,
};

const inlineCodeStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: "monospace",
  background: "#f3f4f6",
  padding: "1px 4px",
  borderRadius: 3,
  color: "#4b5563",
};

const consoleBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  background: "#ffffff",
  color: "#1e40af",
  border: "1px solid #93c5fd",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  width: "fit-content",
};

const keyInputRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  fontSize: 13,
  fontFamily: "monospace",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  outline: "none",
  boxSizing: "border-box",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "#1e40af",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  flexShrink: 0,
};

const disabledSaveBtnStyle: React.CSSProperties = {
  ...saveBtnStyle,
  opacity: 0.5,
  cursor: "not-allowed",
};

// ── Shared styles ──

const securityNoteStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  marginTop: 12,
  fontSize: 11,
  color: "#9ca3af",
  lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 12px",
  background: "#fef2f2",
  color: "#dc2626",
  borderRadius: 6,
  fontSize: 12,
};

const successStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 12px",
  background: "#f0fdf4",
  color: "#059669",
  borderRadius: 6,
  fontSize: 12,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};

const doneBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "#f3f4f6",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

// ── Agent section styles ──

const agentSectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 14,
};

const agentSectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#111827",
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: "#e5e7eb",
  margin: "14px 0",
};

const subHeadingStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 10,
};

const capsListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const indentedCapStyle: React.CSSProperties = {
  paddingLeft: 8,
};

const sliderRowStyle: React.CSSProperties = {
  marginBottom: 8,
};

const sliderLabelRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 3,
};

const sliderLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
};

const sliderValueStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#374151",
  fontFamily: "monospace",
};

const sliderStyle: React.CSSProperties = {
  width: "100%",
  accentColor: "#7c3aed",
  cursor: "pointer",
};

const sliderHintRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 9,
  color: "#c4c9d1",
};

// ── UI Layout styles ──

const uiGridStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const nodeSizeRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "4px 8px",
};

const nodeSizeLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "#374151",
};

const uiRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "2px 8px",
};

const uiFieldLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#374151",
};

const uiInputGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const uiDimLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
  fontWeight: 500,
};

const uiNumberInputSmallStyle: React.CSSProperties = {
  width: 60,
  padding: "4px 6px",
  fontSize: 12,
  fontFamily: "monospace",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  outline: "none",
  boxSizing: "border-box",
  textAlign: "right",
};

const uiNumberInputStyle: React.CSSProperties = {
  width: 72,
  padding: "4px 8px",
  fontSize: 12,
  fontFamily: "monospace",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  outline: "none",
  boxSizing: "border-box",
  textAlign: "right",
};

const uiUnitStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
};

const colorInputStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  border: "1px solid #d1d5db",
  borderRadius: 4,
  cursor: "pointer",
  background: "none",
};

const colorCodeStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: "monospace",
  color: "#6b7280",
};

const resetBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "#f9fafb",
  color: "#6b7280",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  width: "fit-content",
};

// ── API Usage styles ──

const usageCardsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginBottom: 14,
};

const usageCardStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 8px",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  textAlign: "center",
  minWidth: 0,
};

const usageCardValueStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "#111827",
  lineHeight: 1.2,
  fontFamily: "monospace",
};

const usageCardLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#9ca3af",
  fontWeight: 500,
  marginTop: 2,
};

const usageCardSubStyle: React.CSSProperties = {
  fontSize: 9,
  color: "#c4c9d1",
  marginTop: 1,
};

const usageBreakdownRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  marginBottom: 14,
};

const usageTableHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
};

const usageTableStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 11,
  borderCollapse: "collapse",
};

const usageTdStyle: React.CSSProperties = {
  padding: "3px 4px",
  color: "#374151",
  borderBottom: "1px solid #f3f4f6",
};

const usageTdRightStyle: React.CSSProperties = {
  padding: "3px 4px",
  color: "#6b7280",
  borderBottom: "1px solid #f3f4f6",
  textAlign: "right",
  fontFamily: "monospace",
  fontSize: 10,
};

const usageExpandBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  padding: "6px 8px",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  color: "#374151",
  cursor: "pointer",
  marginBottom: 8,
};

const usageHistoryContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  maxHeight: 200,
  overflowY: "auto",
  marginBottom: 8,
  padding: "4px 0",
};

const usageHistoryRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 8px",
  fontSize: 11,
  borderBottom: "1px solid #f3f4f6",
};

const usageHistoryTimeStyle: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: 10,
  minWidth: 50,
  flexShrink: 0,
};

const usageTypeBadgeStyle: React.CSSProperties = {
  padding: "1px 6px",
  background: "#eff6ff",
  color: "#1e40af",
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  flexShrink: 0,
};

const usageHistoryTokensStyle: React.CSSProperties = {
  flex: 1,
  color: "#6b7280",
  fontFamily: "monospace",
  fontSize: 10,
  textAlign: "right",
};

const usageClearBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "#fef2f2",
  color: "#dc2626",
  border: "1px solid #fecaca",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
};

const usageFootnoteStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#c4c9d1",
};

const usageEmptyStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#9ca3af",
  textAlign: "center",
  padding: "16px 0",
};

// ── Cloud Sync styles ──

const cloudFieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 500,
  color: "#6b7280",
  marginBottom: 4,
};

const cloudToggleVisStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  background: "none",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  cursor: "pointer",
  color: "#6b7280",
  padding: 0,
  flexShrink: 0,
};

const cloudSuccessStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color: "#059669",
  marginTop: 8,
};

const cloudErrorStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color: "#dc2626",
  marginTop: 8,
};

const cloudHelpLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "none",
  border: "none",
  padding: 0,
  marginTop: 12,
  fontSize: 12,
  color: "#1e40af",
  cursor: "pointer",
  textDecoration: "underline",
};

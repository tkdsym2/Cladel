import { create } from "zustand";
import type { AgentCapabilities, UIPreferences } from "../types";
import { SYSTEM_DEFAULTS } from "../types";
import * as cmd from "../lib/tauri-commands";
import { emitSettingsChanged } from "../lib/sync-events";

const DEFAULT_CAPABILITIES: AgentCapabilities = {
  agent_enabled: false,
  autonomous_enabled: true,
  search_papers_enabled: true,
  suggest_connections_enabled: true,
  suggest_ideas_enabled: true,
  autonomous_idle_seconds: 45,
  autonomous_cooldown_seconds: 120,
};

interface SettingsStore {
  apiKeyStatus: string | null;
  geminiApiKeyStatus: string | null;
  isSettingsOpen: boolean;
  agentCapabilities: AgentCapabilities;
  uiPreferences: UIPreferences;

  loadApiKeyStatus: () => Promise<void>;
  loadGeminiApiKeyStatus: () => Promise<void>;
  openSettings: () => void;
  closeSettings: () => void;
  loadAgentCapabilities: () => Promise<void>;
  saveAgentCapabilities: (capabilities: AgentCapabilities) => Promise<void>;
  loadUiPreferences: () => Promise<void>;
  saveUiPreferences: (preferences: UIPreferences) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  apiKeyStatus: null,
  geminiApiKeyStatus: null,
  isSettingsOpen: false,
  agentCapabilities: DEFAULT_CAPABILITIES,
  uiPreferences: { ...SYSTEM_DEFAULTS },

  loadApiKeyStatus: async () => {
    try {
      const status = await cmd.getApiKeyStatus();
      set({ apiKeyStatus: status });
    } catch (err) {
      console.error("Failed to load API key status:", err);
    }
  },

  loadGeminiApiKeyStatus: async () => {
    try {
      const status = await cmd.getGeminiApiKeyStatus();
      set({ geminiApiKeyStatus: status });
    } catch (err) {
      console.error("Failed to load Gemini API key status:", err);
    }
  },

  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),

  loadAgentCapabilities: async () => {
    try {
      const capabilities = await cmd.getAgentCapabilities();
      set({ agentCapabilities: capabilities });
    } catch (err) {
      console.error("Failed to load agent capabilities:", err);
    }
  },

  saveAgentCapabilities: async (capabilities) => {
    try {
      await cmd.saveAgentCapabilities(capabilities);
      set({ agentCapabilities: capabilities });
    } catch (err) {
      console.error("Failed to save agent capabilities:", err);
    }
  },

  loadUiPreferences: async () => {
    try {
      const preferences = await cmd.getUiPreferences();
      set({ uiPreferences: preferences });
    } catch (err) {
      console.error("Failed to load UI preferences:", err);
    }
  },

  saveUiPreferences: async (preferences) => {
    set({ uiPreferences: preferences });
    try {
      await cmd.saveUiPreferences(preferences);
      emitSettingsChanged();
    } catch (err) {
      console.error("Failed to save UI preferences:", err);
    }
  },
}));

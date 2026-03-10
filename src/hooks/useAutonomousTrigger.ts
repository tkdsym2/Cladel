import { useCallback } from "react";
import { useSettingsStore } from "../store/settingsStore";
import { useAgentStore } from "../store/agentStore";
import { useIdleDetector } from "./useIdleDetector";

/**
 * Orchestrates autonomous agent triggers based on user idle time.
 *
 * - Reads agent capabilities from settingsStore
 * - Uses useIdleDetector to detect inactivity
 * - Respects shared cooldown (via agentStore.lastAutonomousTriggerTime)
 * - Prevents triggering if agent is already thinking or API key missing
 */
export function useAutonomousTrigger() {
  const agentCapabilities = useSettingsStore((s) => s.agentCapabilities);
  const apiKeyStatus = useSettingsStore((s) => s.apiKeyStatus);

  const enabled =
    agentCapabilities.agent_enabled &&
    agentCapabilities.autonomous_enabled &&
    apiKeyStatus !== null;

  const handleIdle = useCallback(() => {
    const { status, lastAutonomousTriggerTime } = useAgentStore.getState();
    const { apiKeyStatus: key, agentCapabilities: caps } = useSettingsStore.getState();

    // Guard: don't trigger if agent is busy, no API key, or disabled
    if (status === "thinking" || !key || !caps.agent_enabled || !caps.autonomous_enabled) {
      return;
    }

    // Guard: respect shared cooldown
    const now = Date.now();
    const elapsed = (now - lastAutonomousTriggerTime) / 1000;
    if (elapsed < caps.autonomous_cooldown_seconds) {
      return;
    }

    // Submit an autonomous query
    useAgentStore
      .getState()
      .submitQuery(
        "Analyze my research graph and proactively offer helpful suggestions.",
        "autonomous",
      );
  }, []);

  useIdleDetector(
    agentCapabilities.autonomous_idle_seconds,
    enabled,
    handleIdle,
  );
}

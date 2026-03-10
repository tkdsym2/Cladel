import { useEffect, useRef } from "react";
import { useGraphStore } from "../store/graphStore";
import { useAgentStore } from "../store/agentStore";
import { useSettingsStore } from "../store/settingsStore";

interface StructureTriggerOptions {
  enabled: boolean;
}

/**
 * Watches graph structure (node/edge counts) for changes and triggers
 * autonomous agent analysis when significant structural anomalies are detected.
 *
 * - Debounces 3 seconds after a structure change before analyzing
 * - Performs lightweight frontend-side anomaly detection:
 *   a) Isolated nodes (degree <= 1, excluding core)
 *   b) Disconnected nodes (unreachable from core via BFS)
 * - Respects shared cooldown via agentStore.lastAutonomousTriggerTime
 * - Skips very small graphs (active nodes <= 3)
 */
export function useStructureTrigger({ enabled }: StructureTriggerOptions) {
  const dbNodes = useGraphStore((s) => s.dbNodes);
  const dbEdges = useGraphStore((s) => s.dbEdges);

  const prevCountsRef = useRef<{ nodes: number; edges: number }>({
    nodes: 0,
    edges: 0,
  });
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Clear any pending timer when disabled
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      return;
    }

    const currentNodeCount = dbNodes.length;
    const currentEdgeCount = dbEdges.length;
    const prev = prevCountsRef.current;

    // Check if counts actually changed
    if (prev.nodes === currentNodeCount && prev.edges === currentEdgeCount) {
      return;
    }

    // Update previous counts
    prevCountsRef.current = { nodes: currentNodeCount, edges: currentEdgeCount };

    // Clear any existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce 3 seconds before analyzing
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      analyzeAndTrigger();
    }, 3000);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [enabled, dbNodes, dbEdges]);

  function analyzeAndTrigger() {
    // Re-read latest state at trigger time
    const { dbNodes: nodes, dbEdges: edges } = useGraphStore.getState();
    const { status, lastAutonomousTriggerTime } = useAgentStore.getState();
    const { agentCapabilities: caps, apiKeyStatus } = useSettingsStore.getState();

    // Guard: capabilities must be enabled
    if (!caps.agent_enabled || !caps.autonomous_enabled) return;

    // Guard: need API key
    if (!apiKeyStatus) return;

    // Guard: agent must not be busy
    if (status === "thinking") return;

    // Guard: respect shared cooldown
    const now = Date.now();
    const elapsed = (now - lastAutonomousTriggerTime) / 1000;
    if (elapsed < caps.autonomous_cooldown_seconds) return;

    // Filter active analyzable nodes (exclude deleted, junction)
    const activeNodes = nodes.filter(
      (n) => n.node_type !== "deleted" && n.node_type !== "junction" && n.status === "active",
    );

    // Guard: skip very small graphs
    if (activeNodes.length <= 3) return;

    // Build degree map
    const degree = new Map<string, number>();
    for (const n of activeNodes) {
      degree.set(n.id, 0);
    }
    for (const e of edges) {
      if (degree.has(e.source_node_id)) {
        degree.set(e.source_node_id, (degree.get(e.source_node_id) ?? 0) + 1);
      }
      if (degree.has(e.target_node_id)) {
        degree.set(e.target_node_id, (degree.get(e.target_node_id) ?? 0) + 1);
      }
    }

    // Count isolated nodes (degree <= 1, not core)
    let isolatedCount = 0;
    for (const n of activeNodes) {
      if (n.node_type !== "core" && (degree.get(n.id) ?? 0) <= 1) {
        isolatedCount++;
      }
    }

    // BFS from core to find disconnected nodes
    const coreNode = activeNodes.find((n) => n.node_type === "core");
    let disconnectedCount = 0;

    if (coreNode) {
      // Build adjacency list
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        if (!adj.has(e.source_node_id)) adj.set(e.source_node_id, []);
        if (!adj.has(e.target_node_id)) adj.set(e.target_node_id, []);
        adj.get(e.source_node_id)!.push(e.target_node_id);
        adj.get(e.target_node_id)!.push(e.source_node_id);
      }

      // BFS from core
      const visited = new Set<string>();
      const queue: string[] = [coreNode.id];
      visited.add(coreNode.id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        const neighbors = adj.get(current) ?? [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      // Count unreachable active non-core/non-deleted/non-junction nodes
      for (const n of activeNodes) {
        if (n.node_type !== "core" && !visited.has(n.id)) {
          disconnectedCount++;
        }
      }
    }

    // Determine if anomalies are significant enough to trigger
    const significant = isolatedCount >= 2 || disconnectedCount >= 1;

    if (!significant) return;

    // All guards passed and significant anomaly found → trigger autonomous query
    useAgentStore
      .getState()
      .submitQuery(
        "Analyze my research graph and proactively offer helpful suggestions.",
        "autonomous",
      );
  }
}

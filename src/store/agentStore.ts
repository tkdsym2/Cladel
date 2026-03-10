import { create } from "zustand";
import type {
  AgentStatus,
  AgentInvocationType,
  AgentSuggestion,
  AgentHistoryEntry,
  AgentContext,
  AgentSuggestionData,
  AgentErrorInfo,
  NodeSummary,
  EdgeSummary,
  GraphStats,
  NodeData,
} from "../types";
import * as cmd from "../lib/tauri-commands";
import { useGraphStore } from "./graphStore";
import { useLayerStore } from "./layerStore";
import { useSettingsStore } from "./settingsStore";

// ─── Helpers ───

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

function buildContentPreview(n: NodeData): string | null {
  if (n.node_type === "paper") {
    // For paper nodes: use title + authors + year instead of raw content/bibtex
    const parts: string[] = [n.title];
    if (n.metadata) {
      try {
        const meta = JSON.parse(n.metadata);
        if (Array.isArray(meta.authors) && meta.authors.length > 0) {
          parts.push(meta.authors.join(", "));
        }
        if (meta.year) parts.push(String(meta.year));
      } catch {
        // ignore parse errors
      }
    }
    return truncate(parts.join(" — "), 200);
  }
  if (!n.content) return null;
  return truncate(n.content, 200);
}

function buildContext(): AgentContext {
  const { dbNodes, dbEdges, edgeCommentCounts } = useGraphStore.getState();
  const currentLayer = useLayerStore.getState().currentLayer;

  // Filter out deleted and junction nodes (they add noise)
  const activeNodes = dbNodes.filter(
    (n) => n.node_type !== "deleted" && n.node_type !== "junction",
  );

  // Build node title lookup: id → title
  const nodeTitleMap = new Map<string, string>();
  for (const n of dbNodes) {
    nodeTitleMap.set(n.id, n.title);
  }

  // Build connection counts and connected_to per node
  const connectionCounts = new Map<string, number>();
  const connectedTitles = new Map<string, string[]>();
  for (const e of dbEdges) {
    // Source side
    connectionCounts.set(e.source_node_id, (connectionCounts.get(e.source_node_id) ?? 0) + 1);
    const targetTitle = nodeTitleMap.get(e.target_node_id) ?? "?";
    const srcList = connectedTitles.get(e.source_node_id) ?? [];
    srcList.push(targetTitle);
    connectedTitles.set(e.source_node_id, srcList);

    // Target side
    connectionCounts.set(e.target_node_id, (connectionCounts.get(e.target_node_id) ?? 0) + 1);
    const sourceTitle = nodeTitleMap.get(e.source_node_id) ?? "?";
    const tgtList = connectedTitles.get(e.target_node_id) ?? [];
    tgtList.push(sourceTitle);
    connectedTitles.set(e.target_node_id, tgtList);
  }

  // Build node summaries (send all — backend applies relevance-based selection)
  const nodeSummaries: NodeSummary[] = activeNodes.map((n) => ({
    id: n.id,
    node_type: n.node_type,
    title: n.title,
    content_preview: buildContentPreview(n),
    connection_count: connectionCounts.get(n.id) ?? 0,
    connected_to: (connectedTitles.get(n.id) ?? []).slice(0, 5),
  }));

  // Build edge summaries (comments are fetched server-side from DB)
  const edgeSummaries: EdgeSummary[] = dbEdges.map((e) => ({
    id: e.id,
    source_id: e.source_node_id,
    target_id: e.target_node_id,
    source_node_title: nodeTitleMap.get(e.source_node_id) ?? "?",
    target_node_title: nodeTitleMap.get(e.target_node_id) ?? "?",
    weight: e.weight,
    comment: e.comment,
    comment_count: edgeCommentCounts[e.id] ?? 0,
    comments: [],
  }));

  // Build graph stats
  const nodeTypeCounts: Record<string, number> = {};
  for (const n of activeNodes) {
    nodeTypeCounts[n.node_type] = (nodeTypeCounts[n.node_type] ?? 0) + 1;
  }
  let isolatedCount = 0;
  for (const n of activeNodes) {
    if ((connectionCounts.get(n.id) ?? 0) === 0) {
      isolatedCount++;
    }
  }
  const graphStats: GraphStats = {
    total_nodes: activeNodes.length,
    total_edges: dbEdges.length,
    node_type_counts: nodeTypeCounts,
    isolated_node_count: isolatedCount,
  };

  // Core content preview
  const coreNode = dbNodes.find((n) => n.node_type === "core");
  const coreContentPreview = coreNode?.content
    ? truncate(coreNode.content, 500)
    : null;

  return {
    current_layer_id: currentLayer?.id ?? "",
    core_content_preview: coreContentPreview,
    graph_stats: graphStats,
    node_summaries: nodeSummaries,
    edge_summaries: edgeSummaries,
  };
}

function parseErrorInfo(err: unknown): AgentErrorInfo {
  const raw = typeof err === "string" ? err : String(err);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.error_code === "string") {
      return parsed as AgentErrorInfo;
    }
  } catch {
    // Not JSON — wrap as unknown
  }
  return {
    error_code: "unknown",
    message: raw,
    retry_after_secs: null,
    recoverable: true,
  };
}

function convertSuggestion(s: AgentSuggestionData): AgentSuggestion {
  const id = crypto.randomUUID();

  if (s.suggestion_type === "paper" && s.paper_data) {
    return {
      id,
      type: "paper",
      title: s.title,
      description: s.description,
      data: s.paper_data,
      actioned: false,
    };
  }

  if (s.suggestion_type === "connection" && s.connection) {
    return {
      id,
      type: "connection",
      title: s.title,
      description: s.description,
      data: {
        sourceNodeId: s.connection.source_node_id,
        targetNodeId: s.connection.target_node_id,
        reason: s.connection.reason,
      },
      actioned: false,
    };
  }

  // idea or fallback
  return {
    id,
    type: "idea",
    title: s.title,
    description: s.description,
    data: { body: s.idea_body ?? s.description },
    actioned: false,
  };
}

// ─── Store ───

interface AgentStore {
  // State
  status: AgentStatus;
  suggestions: AgentSuggestion[];
  history: AgentHistoryEntry[];
  currentQuery: string;
  currentInvocationType: AgentInvocationType;
  errorInfo: AgentErrorInfo | null;
  panelOpen: boolean;
  thinkingStartedAt: number | null;
  queryId: number;
  lastQuery: string;
  lastInvocationType: AgentInvocationType;
  lastResponseMessage: string | null;
  isAutonomousQuery: boolean;
  lastAutonomousTriggerTime: number;
  provider: "claude" | "gemini";

  // Actions
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setCurrentQuery: (query: string) => void;
  setCurrentInvocationType: (type: AgentInvocationType) => void;
  setProvider: (provider: "claude" | "gemini") => void;
  submitQuery: (query: string, type: AgentInvocationType) => void;
  cancelQuery: () => void;
  retryLastQuery: () => void;
  addSuggestions: (suggestions: AgentSuggestion[]) => void;
  clearSuggestions: () => void;
  setSuggestionActioned: (id: string) => void;
  setStatus: (status: AgentStatus) => void;
  setError: (info: AgentErrorInfo) => void;
  setLastAutonomousTriggerTime: (time: number) => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  status: "idle",
  suggestions: [],
  history: [],
  currentQuery: "",
  currentInvocationType: "general",
  errorInfo: null,
  panelOpen: false,
  thinkingStartedAt: null,
  queryId: 0,
  lastQuery: "",
  lastInvocationType: "general",
  lastResponseMessage: null,
  isAutonomousQuery: false,
  lastAutonomousTriggerTime: 0,
  provider: "claude",

  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  setCurrentQuery: (query) => set({ currentQuery: query }),
  setCurrentInvocationType: (type) => set({ currentInvocationType: type }),
  setProvider: (provider) => set({ provider }),

  submitQuery: (query, type) => {
    // Guard: check if agent is enabled before calling backend
    const { agentCapabilities } = useSettingsStore.getState();
    if (!agentCapabilities.agent_enabled) {
      set({
        status: "error",
        errorInfo: {
          error_code: "agent_disabled",
          message: "Agent is currently disabled. Enable it in Settings.",
          retry_after_secs: null,
          recoverable: false,
        },
      });
      return;
    }

    const currentQueryId = get().queryId + 1;
    set({
      status: "thinking",
      currentQuery: query,
      currentInvocationType: type,
      errorInfo: null,
      thinkingStartedAt: Date.now(),
      queryId: currentQueryId,
      lastQuery: query,
      lastInvocationType: type,
      lastResponseMessage: null,
      isAutonomousQuery: type === "autonomous",
    });

    const context = buildContext();
    const currentProvider = get().provider;

    cmd
      .invokeAgent(query, type, context, currentProvider)
      .then((response) => {
        // Ignore if query was cancelled or superseded
        if (get().queryId !== currentQueryId) return;

        const suggestions = response.suggestions.map(convertSuggestion);

        const entry: AgentHistoryEntry = {
          id: crypto.randomUUID(),
          query,
          invocationType: type,
          response: response.message,
          timestamp: new Date().toISOString(),
        };

        const updates: Partial<AgentStore> = {
          status: "done",
          suggestions: [...suggestions, ...get().suggestions],
          history: [entry, ...get().history],
          currentQuery: "",
          thinkingStartedAt: null,
          lastResponseMessage: response.message,
        };

        // Track autonomous trigger time for shared cooldown
        if (type === "autonomous") {
          updates.lastAutonomousTriggerTime = Date.now();
        }

        set(updates);
      })
      .catch((err) => {
        // Ignore if query was cancelled or superseded
        if (get().queryId !== currentQueryId) return;

        const errorInfo = parseErrorInfo(err);

        const entry: AgentHistoryEntry = {
          id: crypto.randomUUID(),
          query,
          invocationType: type,
          response: `Error: ${errorInfo.message}`,
          timestamp: new Date().toISOString(),
        };

        set((s) => ({
          status: "error",
          errorInfo,
          history: [entry, ...s.history],
          thinkingStartedAt: null,
        }));
      });
  },

  cancelQuery: () => {
    set((s) => ({
      queryId: s.queryId + 1,
      status: "idle",
      thinkingStartedAt: null,
      errorInfo: null,
    }));
  },

  retryLastQuery: () => {
    const { lastQuery, lastInvocationType } = get();
    if (lastQuery) {
      get().submitQuery(lastQuery, lastInvocationType);
    }
  },

  addSuggestions: (newSuggestions) => {
    set((s) => ({
      suggestions: [...newSuggestions, ...s.suggestions],
    }));
  },

  clearSuggestions: () => set({ suggestions: [] }),

  setSuggestionActioned: (id) => {
    set((s) => ({
      suggestions: s.suggestions.map((sg) =>
        sg.id === id ? { ...sg, actioned: true } : sg,
      ),
    }));
  },

  setStatus: (status) => set({ status, errorInfo: null }),

  setError: (info) => set({ status: "error", errorInfo: info }),

  setLastAutonomousTriggerTime: (time) => set({ lastAutonomousTriggerTime: time }),
}));

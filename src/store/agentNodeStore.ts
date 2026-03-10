import { create } from "zustand";

interface AgentNodeState {
  /** Set of agent node IDs currently processing */
  processingNodes: Set<string>;
  /** Error messages per agent node ID */
  errors: Map<string, string>;

  setProcessing: (nodeId: string, processing: boolean) => void;
  setError: (nodeId: string, error: string | null) => void;
  isProcessing: (nodeId: string) => boolean;
  getError: (nodeId: string) => string | null;
}

export const useAgentNodeStore = create<AgentNodeState>((set, get) => ({
  processingNodes: new Set(),
  errors: new Map(),

  setProcessing: (nodeId, processing) =>
    set((state) => {
      const next = new Set(state.processingNodes);
      if (processing) {
        next.add(nodeId);
      } else {
        next.delete(nodeId);
      }
      return { processingNodes: next };
    }),

  setError: (nodeId, error) =>
    set((state) => {
      const next = new Map(state.errors);
      if (error) {
        next.set(nodeId, error);
      } else {
        next.delete(nodeId);
      }
      return { errors: next };
    }),

  isProcessing: (nodeId) => get().processingNodes.has(nodeId),

  getError: (nodeId) => get().errors.get(nodeId) ?? null,
}));

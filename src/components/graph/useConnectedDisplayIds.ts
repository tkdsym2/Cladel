import { useMemo } from "react";
import { useGraphStore } from "../../store/graphStore";

/**
 * Returns a comma-separated string of display_ids for nodes connected to the given nodeId.
 * Skips junction and deleted nodes.
 */
export function useConnectedDisplayIds(nodeId: string): string {
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);

  return useMemo(() => {
    const connectedIds = new Set<string>();
    for (const e of edges) {
      if (e.source === nodeId) connectedIds.add(e.target);
      if (e.target === nodeId) connectedIds.add(e.source);
    }

    const displayIds: string[] = [];
    for (const n of nodes) {
      if (!connectedIds.has(n.id)) continue;
      const nodeType = n.data?.node_type as string;
      if (nodeType === "junction" || nodeType === "deleted") continue;
      const did = n.data?.display_id as string;
      if (did) displayIds.push(did);
    }

    return displayIds.join(", ");
  }, [nodeId, edges, nodes]);
}

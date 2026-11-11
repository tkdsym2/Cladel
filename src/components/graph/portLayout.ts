import type { EdgeData, NodeData } from "../../types";

/**
 * Shared geometry for the outline-style ports (NodePorts) and the wires
 * that plug into them (AnnotatedEdge). Both sides MUST use these helpers so
 * the notch height and the per-wire vertical offsets agree.
 *
 * - Input (left side) = a notch cut into the node outline. Every wire
 *   attached to a node's left side ends on the notch's back wall; several
 *   wires are fanned out vertically (WIRE_GAP apart, ordered by the other
 *   end's y so they don't cross) and the notch grows to fit them.
 * - Output (right side) = a small tab pushed out of the outline; all wires
 *   leave from its outer face center.
 */
export interface PortDims {
  /** How far the input notch is cut into the node (px). */
  notchDepth: number;
  /** Minimum notch height (px), for 0–1 wires. */
  notchMinH: number;
  /** Vertical distance between fanned-out wires in the notch (px). */
  wireGap: number;
  /** Notch padding above the first / below the last wire (px). */
  notchPad: number;
  /** How far the output tab sticks out of the node (px). */
  tabOut: number;
  /** Output tab height (px, inside its outline). */
  tabH: number;
}

export const PORT_DIMS: PortDims = {
  notchDepth: 8,
  notchMinH: 20,
  wireGap: 8,
  notchPad: 6,
  tabOut: 7,
  tabH: 14,
};

/** Mini nodes (junction dot, deleted placeholder, collapsed papers). */
export const PORT_DIMS_COMPACT: PortDims = {
  notchDepth: 3,
  notchMinH: 7,
  wireGap: 0,
  notchPad: 0,
  tabOut: 3,
  tabH: 6,
};

/** Node types that render compact ports (keep in sync with `<NodePorts compact>`). */
const COMPACT_NODE_TYPES = new Set(["junction", "deleted"]);

export function portDimsForNodeType(nodeType: string | undefined): PortDims {
  return nodeType && COMPACT_NODE_TYPES.has(nodeType) ? PORT_DIMS_COMPACT : PORT_DIMS;
}

/** Notch height for `wireCount` wires attached to the left side. */
export function notchHeight(dims: PortDims, wireCount: number): number {
  return Math.max(dims.notchMinH, (wireCount - 1) * dims.wireGap + 2 * dims.notchPad);
}

/** Handle ids on the left side are "left" (source) and "left-target" (target). */
export function isLeftHandle(handleId: string | null | undefined): boolean {
  return !!handleId && handleId.startsWith("left");
}

/** Number of edges attached to the node's left (notch) side. */
export function countLeftWires(nodeId: string, edges: EdgeData[]): number {
  let n = 0;
  for (const e of edges) {
    if (e.target_node_id === nodeId && isLeftHandle(e.target_handle)) n++;
    if (e.source_node_id === nodeId && isLeftHandle(e.source_handle)) n++;
  }
  return n;
}

/**
 * Vertical offset (px, relative to the notch center) of `edgeId`'s end on
 * `nodeId`'s left side. Wires are ordered top→bottom by the y of the node
 * at their other end (ties: edge id), then spread `wireGap` apart around 0.
 */
export function leftWireOffset(
  nodeId: string,
  edgeId: string,
  edges: EdgeData[],
  nodes: NodeData[],
  dims: PortDims,
): number {
  if (dims.wireGap === 0) return 0;
  const attached: { id: string; y: number }[] = [];
  for (const e of edges) {
    let otherId: string | null = null;
    if (e.target_node_id === nodeId && isLeftHandle(e.target_handle)) otherId = e.source_node_id;
    else if (e.source_node_id === nodeId && isLeftHandle(e.source_handle)) otherId = e.target_node_id;
    if (otherId === null) continue;
    const other = nodes.find((n) => n.id === otherId);
    const y = other ? other.position_y + (other.height ?? 0) / 2 : 0;
    attached.push({ id: e.id, y });
  }
  if (attached.length < 2) return 0;
  attached.sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const idx = attached.findIndex((a) => a.id === edgeId);
  if (idx < 0) return 0;
  return (idx - (attached.length - 1) / 2) * dims.wireGap;
}

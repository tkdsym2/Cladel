import { Handle, Position } from "@xyflow/react";

/**
 * TouchDesigner-style connection ports: rounded tabs protruding from the
 * node's left (input) and right (output) edges. Geometry, protrusion, and
 * hover/connecting effects live in index.css (`.td-port`); each node passes
 * only its accent color.
 *
 * Each side stacks a source + target handle at the SAME spot (source first,
 * target on top) — GraphCanvas normalizes swapped directions via
 * `connectingFrom`, and the handle ids (right / right-target / left /
 * left-target) are persisted in the DB, so both the order and the ids must
 * stay exactly as they are.
 */
interface NodePortsProps {
  /** Port fill color — usually the node's border accent. */
  accent: string;
  /** Smaller ports for mini nodes (junction, deleted, collapsed papers). */
  compact?: boolean;
}

export function NodePorts({ accent, compact = false }: NodePortsProps) {
  const cls = compact ? "td-port td-port-sm" : "td-port";
  const style: React.CSSProperties = { background: accent };
  return (
    <>
      <Handle type="source" position={Position.Right} id="right" className={cls} style={style} />
      <Handle type="target" position={Position.Right} id="right-target" className={cls} style={style} />
      <Handle type="source" position={Position.Left} id="left" className={cls} style={style} />
      <Handle type="target" position={Position.Left} id="left-target" className={cls} style={style} />
    </>
  );
}

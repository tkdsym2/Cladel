import { useId } from "react";
import { Handle, Position } from "@xyflow/react";

/**
 * Connector-style ports drawn as custom SVG shapes, both in the node's
 * accent color:
 *
 * - Right (output): an angular arrow-pentagon tab (凸) protruding from the
 *   edge in the flow direction, accent-filled.
 * - Left (input): a rectangular slot of the same mouth height sunk INTO the
 *   node (凹), filled with the darkened accent — the left handle box sits
 *   inside the node edge, and the cavity covers the node border at the
 *   mouth, so the node itself looks carved open. Edge arrowheads land
 *   inside the cavity ("plugged in").
 *
 * The Handle divs are invisible geometry/hit containers (positioning, hover
 * and hit-area rules in index.css `.td-port`); the SVG child is purely
 * visual (pointer-events: none).
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

// 10x22 viewBox (the compact 7x14 variant just scales the viewBox).
// Output tab: angular arrow pentagon (rectangular body + pointed tip) —
// points outward in the flow direction; x=0 sits 3px inside the node, so
// it looks attached.
const OUT_D = "M0 4.5 H5 L9.5 11 L5 17.5 H0 Z";
// Input slot: rectangle of the same mouth height sunk into the node. In the
// left handle (which sits inside the node) x=3 falls exactly on the node
// edge, so the cavity opens flush at the border. CAVITY is the filled hole,
// WALLS the rim (open path — the mouth face must stay open).
const IN_CAVITY_D = "M3 4.5 H9.5 V17.5 H3 Z";
const IN_WALLS_D = "M3 4.5 H9.5 V17.5 H3";

/** Output arrow tab: accent fill with an inset white rim (stroke clipped inside). */
function OutShape({ clipId }: { clipId: string }) {
  return (
    <svg viewBox="0 0 10 22" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <path d={OUT_D} />
        </clipPath>
      </defs>
      <path
        d={OUT_D}
        fill="currentColor"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={3}
        clipPath={`url(#${clipId})`}
      />
    </svg>
  );
}

/**
 * Input slot: recessed cavity in the node's accent color — the accent fill
 * darkened by a black overlay, with brighter accent walls for depth.
 */
function InShape() {
  return (
    <svg viewBox="0 0 10 22" aria-hidden="true">
      <path d={IN_CAVITY_D} fill="currentColor" />
      <path d={IN_CAVITY_D} fill="rgba(0, 0, 0, 0.42)" />
      <path d={IN_WALLS_D} fill="none" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}

export function NodePorts({ accent, compact = false }: NodePortsProps) {
  const cls = compact ? "td-port td-port-sm" : "td-port";
  // The SVG picks the accent up via currentColor.
  const style: React.CSSProperties = { color: accent };
  // clipPath ids are document-global — make them unique per instance, and
  // strip useId's delimiter chars, which break url(#...) references.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <>
      <Handle type="source" position={Position.Right} id="right" className={cls} style={style}>
        <OutShape clipId={`port-out-s-${uid}`} />
      </Handle>
      <Handle type="target" position={Position.Right} id="right-target" className={cls} style={style}>
        <OutShape clipId={`port-out-t-${uid}`} />
      </Handle>
      <Handle type="source" position={Position.Left} id="left" className={cls} style={style}>
        <InShape />
      </Handle>
      <Handle type="target" position={Position.Left} id="left-target" className={cls} style={style}>
        <InShape />
      </Handle>
    </>
  );
}

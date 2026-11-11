import { useLayoutEffect, useRef, useState } from "react";
import { Handle, Position, useNodeId } from "@xyflow/react";
import { useGraphStore } from "../../store/graphStore";
import { PORT_DIMS, PORT_DIMS_COMPACT, countLeftWires, notchHeight } from "./portLayout";

/**
 * Outline-style ports: the connectors are part of the node's own silhouette,
 * drawn in the node's actual border color / width and background.
 *
 * - Left (input): a rectangular NOTCH cut into the node — the outline turns
 *   inward, runs down the notch's back wall and back out; inside the notch
 *   you see the canvas. Wires end on the back wall (AnnotatedEdge re-draws
 *   the bit inside the notch above the node). With several wires on the
 *   left side the notch grows and the wires are fanned out vertically
 *   (portLayout.ts).
 * - Right (output): a small TAB pushed out of the outline (node background,
 *   outlined on its three outer sides); wires leave from its outer face.
 *
 * Border width/color and background are read from the node card's computed
 * style after every render, so selection (thicker border, glow color) and
 * User Color Mode are followed automatically; `accent` is only the fallback
 * when the card has no border (e.g. the junction dot).
 *
 * NodePorts is rendered as a sibling AFTER the node card (directly under the
 * React Flow node wrapper) in full-size nodes, so offsets are measured from
 * the node's outer edge.
 *
 * Each side stacks a source + target handle at the SAME spot (source first,
 * target on top) — GraphCanvas normalizes swapped directions via
 * `connectingFrom`, and the handle ids (right / right-target / left /
 * left-target) are persisted in the DB, so both the order and the ids must
 * stay exactly as they are.
 */
interface NodePortsProps {
  /** Fallback outline color when the node card has no border. */
  accent: string;
  /** Smaller ports for mini nodes (junction, deleted, collapsed papers). */
  compact?: boolean;
}

interface Outline {
  bw: number;
  border: string;
  bg: string;
}

/** Width of the (invisible) left handle box sitting on the notch's back wall. */
const IN_HANDLE_W = 4;
/** Canvas fill painted this far out in front of the notch mouth (px); keep in sync with NOTCH_WIRE_EXT in AnnotatedEdge. */
const MOUTH_EXT = 6;
/** The tab's fill reaches this far into the card at its root (px). */
const TAB_ROOT_EXT = 1.5;

function findCard(handleEl: HTMLElement): HTMLElement | null {
  const parent = handleEl.parentElement;
  if (!parent) return null;
  if (!parent.classList.contains("react-flow__node")) return parent; // ports inside the card
  for (const child of Array.from(parent.children)) {
    const el = child as HTMLElement;
    if (el.classList.contains("react-flow__handle")) continue;
    if (el.classList.contains("react-flow__resize-control")) continue;
    return el;
  }
  return null;
}

export function NodePorts({ accent, compact = false }: NodePortsProps) {
  const dims = compact ? PORT_DIMS_COMPACT : PORT_DIMS;
  const nodeId = useNodeId();
  const wireCount = useGraphStore((s) => (nodeId ? countLeftWires(nodeId, s.dbEdges) : 0));
  const h = notchHeight(dims, wireCount);

  const probeRef = useRef<HTMLDivElement>(null);
  const [outline, setOutline] = useState<Outline>({ bw: 1, border: accent, bg: "#ffffff" });

  // Follow the card's real outline (selection / color mode change it).
  useLayoutEffect(() => {
    const el = probeRef.current;
    const card = el && findCard(el);
    if (!card) return;
    const cs = getComputedStyle(card);
    const w = parseFloat(cs.borderLeftWidth) || 0;
    const hasBorder = cs.borderLeftStyle !== "none" && w > 0;
    const next: Outline = {
      bw: hasBorder ? w : 1,
      border: hasBorder ? cs.borderLeftColor : accent,
      bg: cs.backgroundColor,
    };
    if (next.bw !== outline.bw || next.border !== outline.border || next.bg !== outline.bg) {
      setOutline(next);
    }
  });

  const { bw, border, bg } = outline;
  const { notchDepth: d, tabOut, tabH } = dims;

  // Left handle box: IN_HANDLE_W wide, starting ON the back wall (x = d), so
  // React Flow attaches the wire there. RF centers left handles on `left`.
  const inStyle: React.CSSProperties = {
    width: IN_HANDLE_W,
    height: h,
    left: d + IN_HANDLE_W / 2,
  };
  // Notch drawing, placed relative to the handle box (overflow visible).
  // The canvas fill also reaches MOUTH_EXT px OUT of the mouth: it paints
  // over the card's box-shadow / anti-aliased border right in front of the
  // notch, which would otherwise show as a faint line across the mouth.
  const notchW = MOUTH_EXT + d + bw;
  const notchH = h + 2 * bw;
  const notchSvgStyle: React.CSSProperties = {
    position: "absolute",
    left: -d - MOUTH_EXT,
    top: -bw,
    width: notchW,
    height: notchH,
  };

  // Right handle box = the tab: from the inner side of the card's right
  // border (x = W - bw) to the tab's outer face (x = W + tabOut). RF centers
  // right handles at W - right.
  const tabW = bw + tabOut;
  const tabTotalH = tabH + 2 * bw;
  const outStyle: React.CSSProperties = {
    width: tabW,
    height: tabTotalH,
    right: -(tabOut - bw) / 2,
  };

  const notch = (
    <svg
      style={notchSvgStyle}
      width={notchW}
      height={notchH}
      viewBox={`0 0 ${notchW} ${notchH}`}
      aria-hidden="true"
    >
      {/* the cut-out: canvas shows through */}
      <rect x={0} y={bw} width={MOUTH_EXT + d} height={h} fill="var(--canvas-bg, #f8fafc)" />
      {/* outline turning inward: top wall, back wall, bottom wall */}
      <rect className="td-wall" x={MOUTH_EXT} y={0} width={d + bw} height={bw} fill={border} />
      <rect className="td-wall" x={MOUTH_EXT + d} y={0} width={bw} height={notchH} fill={border} />
      <rect className="td-wall" x={MOUTH_EXT} y={h + bw} width={d + bw} height={bw} fill={border} />
    </svg>
  );

  // The tab's fill starts TAB_ROOT_EXT px inside the card (over the card's
  // own background) so no anti-aliased sliver of the card's border shows
  // through at the tab's root.
  const tabSvgW = TAB_ROOT_EXT + tabW;
  const tab = (
    <svg
      style={{ marginLeft: -TAB_ROOT_EXT }}
      width={tabSvgW}
      height={tabTotalH}
      viewBox={`0 0 ${tabSvgW} ${tabTotalH}`}
      aria-hidden="true"
    >
      {/* canvas first so a translucent node background composites like the card */}
      <rect x={0} y={bw} width={tabSvgW} height={tabTotalH - 2 * bw} fill="var(--canvas-bg, #f8fafc)" />
      <rect x={0} y={bw} width={tabSvgW} height={tabTotalH - 2 * bw} fill={bg} />
      {/* outline on the three outer sides (covers the card's border at the root) */}
      <rect className="td-wall" x={TAB_ROOT_EXT} y={0} width={tabW} height={bw} fill={border} />
      <rect className="td-wall" x={tabSvgW - bw} y={0} width={bw} height={tabTotalH} fill={border} />
      <rect className="td-wall" x={TAB_ROOT_EXT} y={tabTotalH - bw} width={tabW} height={bw} fill={border} />
    </svg>
  );

  const cls = compact ? "td-port td-port-sm" : "td-port";
  return (
    <>
      <Handle type="source" position={Position.Right} id="right" className={cls} style={outStyle}>
        {tab}
      </Handle>
      <Handle type="target" position={Position.Right} id="right-target" className={cls} style={outStyle}>
        {tab}
      </Handle>
      <Handle ref={probeRef} type="source" position={Position.Left} id="left" className={cls} style={inStyle}>
        {notch}
      </Handle>
      <Handle type="target" position={Position.Left} id="left-target" className={cls} style={inStyle}>
        {notch}
      </Handle>
    </>
  );
}

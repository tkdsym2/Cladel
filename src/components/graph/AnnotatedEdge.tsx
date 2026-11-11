import { useState, useCallback } from "react";
import {
  BaseEdge,
  Position,
  ViewportPortal,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useGraphStore } from "../../store/graphStore";
import { leftWireOffset, portDimsForNodeType } from "./portLayout";

/**
 * Bezier curvature used for ALL edge paths. GraphCanvas recomputes edge
 * geometry (drop-on-edge hit test, Tab-create preview wire) and must use the
 * same value, or the math drifts from what is rendered.
 */
export const EDGE_CURVATURE = 0.32;

/**
 * Evaluate a cubic bezier curve at parameter t (0..1).
 * Returns [x, y] at that point on the curve.
 */
export function bezierPoint(
  t: number,
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
): [number, number] {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return [
    uuu * p0x + 3 * uu * t * p1x + 3 * u * tt * p2x + ttt * p3x,
    uuu * p0y + 3 * uu * t * p1y + 3 * u * tt * p2y + ttt * p3y,
  ];
}

/**
 * Parse all 4 points from a cubic bezier SVG path string.
 * Format: "M{sx},{sy} C{cx1},{cy1} {cx2},{cy2} {ex},{ey}"
 */
export function parseBezierPath(pathD: string): {
  sx: number; sy: number;
  cx1: number; cy1: number;
  cx2: number; cy2: number;
  ex: number; ey: number;
} | null {
  const m = pathD.match(
    /M([\d.\-e]+),([\d.\-e]+)\s*C([\d.\-e]+),([\d.\-e]+)\s+([\d.\-e]+),([\d.\-e]+)\s+([\d.\-e]+),([\d.\-e]+)/
  );
  if (!m) return null;
  return {
    sx: parseFloat(m[1]), sy: parseFloat(m[2]),
    cx1: parseFloat(m[3]), cy1: parseFloat(m[4]),
    cx2: parseFloat(m[5]), cy2: parseFloat(m[6]),
    ex: parseFloat(m[7]), ey: parseFloat(m[8]),
  };
}

/** How far before the notch mouth the re-drawn wire starts (≥ NodePorts MOUTH_EXT). */
const NOTCH_WIRE_EXT = 7;

/** Clipped copy of the wire inside an input notch, drawn ABOVE the nodes. */
function NotchWire({
  clipId,
  path,
  endX,
  endY,
  depth,
  style,
}: {
  clipId: string;
  path: string;
  endX: number;
  endY: number;
  depth: number;
  style: React.CSSProperties;
}) {
  // The notch spans [endX - depth, endX] horizontally (endX = back wall).
  // Start NOTCH_WIRE_EXT px before the mouth: NodePorts paints canvas over
  // the card's shadow in front of the mouth, so the wire must be on top
  // there too, or a faint seam shows across it.
  const half = 12;
  return (
    <svg
      style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", zIndex: 3000 }}
      width={1}
      height={1}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={endX - depth - NOTCH_WIRE_EXT} y={endY - half} width={depth + NOTCH_WIRE_EXT} height={half * 2} />
        </clipPath>
      </defs>
      <path d={path} fill="none" clipPath={`url(#${clipId})`} style={style} />
    </svg>
  );
}

export function AnnotatedEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);

  const d = (data ?? {}) as Record<string, unknown>;
  const weight = (d.weight as number) ?? 3;
  const createdBy = (d.created_by as string) ?? "user";

  // Derive hasDeletedEndpoint from current node types (not cached edge data)
  const hasDeletedEndpoint = useGraphStore((s) =>
    s.dbNodes.some(
      (n) =>
        (n.id === source || n.id === target) && n.node_type === "deleted",
    ),
  );

  // Ends on a node's LEFT side plug into its input notch: they land on the
  // notch's back wall and are fanned out vertically (portLayout.ts).
  const sourceIsNotch = sourcePosition === Position.Left;
  const targetIsNotch = targetPosition === Position.Left;
  const sourceDims = useGraphStore((s) =>
    portDimsForNodeType(s.dbNodes.find((n) => n.id === source)?.node_type),
  );
  const targetDims = useGraphStore((s) =>
    portDimsForNodeType(s.dbNodes.find((n) => n.id === target)?.node_type),
  );
  const sourceOffset = useGraphStore((s) =>
    sourceIsNotch ? leftWireOffset(source, id, s.dbEdges, s.dbNodes, sourceDims) : 0,
  );
  const targetOffset = useGraphStore((s) =>
    targetIsNotch ? leftWireOffset(target, id, s.dbEdges, s.dbNodes, targetDims) : 0,
  );
  const sy = sourceY + sourceOffset;
  const ty = targetY + targetOffset;

  // Weight 1..5 → 1.6..4.0px: thinner wires than before, still distinct steps.
  const strokeWidth = 1 + weight * 0.6;
  const isAgent = createdBy === "agent";

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY: sy,
    targetX,
    targetY: ty,
    sourcePosition,
    targetPosition,
    curvature: EDGE_CURVATURE, // slightly stronger S-curve, TouchDesigner-style wires
  });

  const baseColor = hasDeletedEndpoint
    ? "#9ca3af"
    : selected
      ? "#3b82f6"
      : hovered
        ? "#2563eb"
        : isAgent
          ? "#7c3aed"
          : "#94a3b8";
  const edgeOpacity = hasDeletedEndpoint ? 0.5 : 1;

  const wireStyle: React.CSSProperties = {
    stroke: baseColor,
    strokeWidth,
    strokeLinecap: "round",
    strokeDasharray: isAgent ? "7 4" : undefined,
    opacity: edgeOpacity,
    transition: "stroke 90ms ease",
  };

  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);

  // No arrowheads: direction reads from the ports (wires leave output tabs
  // on the right and plug into input notches on the left).
  return (
    <>
      {/* Invisible wide hit area for hover detection and easier clicking */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={25}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ pointerEvents: "stroke" }}
      />
      {/* Hover / selection glow halo */}
      {(hovered || selected) && !hasDeletedEndpoint && (
        <path
          d={edgePath}
          fill="none"
          stroke={selected ? "#3b82f6" : "#2563eb"}
          strokeWidth={strokeWidth + 5}
          strokeLinecap="round"
          opacity={selected ? 0.18 : 0.12}
          style={{ pointerEvents: "none" }}
        />
      )}
      <BaseEdge id={id} path={edgePath} style={wireStyle} />
      {/* Edges render below nodes, so the stretch inside an input notch
          (which overlaps the node box) is re-drawn above the nodes. */}
      {(sourceIsNotch || targetIsNotch) && (
        <ViewportPortal>
          {sourceIsNotch && (
            <NotchWire
              clipId={`notch-wire-${id}-s`}
              path={edgePath}
              endX={sourceX}
              endY={sy}
              depth={sourceDims.notchDepth}
              style={wireStyle}
            />
          )}
          {targetIsNotch && (
            <NotchWire
              clipId={`notch-wire-${id}-t`}
              path={edgePath}
              endX={targetX}
              endY={ty}
              depth={targetDims.notchDepth}
              style={wireStyle}
            />
          )}
        </ViewportPortal>
      )}
    </>
  );
}

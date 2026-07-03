import { useState, useCallback, useMemo } from "react";
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useGraphStore } from "../../store/graphStore";

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

function computeArrowPoints(
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  arrowSize: number,
): string {
  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const px = -ny;
  const py = nx;
  const baseX = tipX - nx * arrowSize;
  const baseY = tipY - ny * arrowSize;
  // Slim arrowhead (narrower than equilateral) for a sleeker wire look.
  const halfW = arrowSize * 0.42;
  return `${tipX},${tipY} ${baseX + px * halfW},${baseY + py * halfW} ${baseX - px * halfW},${baseY - py * halfW}`;
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

  const targetNode = useGraphStore((s) => s.dbNodes.find((n) => n.id === target));
  const sourceNode = useGraphStore((s) => s.dbNodes.find((n) => n.id === source));

  // Weight 1..5 → 1.6..4.0px: thinner wires than before, still distinct steps.
  const strokeWidth = 1 + weight * 0.6;
  const isAgent = createdBy === "agent";

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
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

  const arrowSize = Math.max(9, strokeWidth * 2.7);
  const arrowPoints = useMemo(() => {
    if (!targetNode || !sourceNode) return "0,0 0,0 0,0";

    const parsed = parseBezierPath(edgePath);
    if (!parsed) return "0,0 0,0 0,0";

    const { sx, sy, cx1, cy1, cx2, cy2, ex, ey } = parsed;

    // Determine which end of the bezier path is near the actual target node
    const tw = targetNode.width ?? 180;
    const th = targetNode.height ?? 260;
    const targetCenterX = targetNode.position_x + tw / 2;
    const targetCenterY = targetNode.position_y + th / 2;

    const sw = sourceNode.width ?? 180;
    const sh = sourceNode.height ?? 260;
    const sourceCenterX = sourceNode.position_x + sw / 2;
    const sourceCenterY = sourceNode.position_y + sh / 2;

    const endDistToTarget = Math.hypot(ex - targetCenterX, ey - targetCenterY);
    const endDistToSource = Math.hypot(ex - sourceCenterX, ey - sourceCenterY);

    let tipX: number, tipY: number, nearTipX: number, nearTipY: number;

    if (endDistToTarget <= endDistToSource) {
      tipX = ex;
      tipY = ey;
      [nearTipX, nearTipY] = bezierPoint(0.92, sx, sy, cx1, cy1, cx2, cy2, ex, ey);
    } else {
      tipX = sx;
      tipY = sy;
      [nearTipX, nearTipY] = bezierPoint(0.08, sx, sy, cx1, cy1, cx2, cy2, ex, ey);
    }

    return computeArrowPoints(tipX, tipY, nearTipX, nearTipY, arrowSize);
  }, [edgePath, sourceNode, targetNode, arrowSize]);

  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);

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
      {/* Main edge path — no markerEnd (WebKit breaks SVG markers across <svg> elements) */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: baseColor,
          strokeWidth,
          strokeLinecap: "round",
          strokeDasharray: isAgent ? "7 4" : undefined,
          opacity: edgeOpacity,
          transition: "stroke 90ms ease",
        }}
      />
      {/* Manual arrowhead at TARGET endpoint */}
      <polygon
        points={arrowPoints}
        fill={baseColor}
        stroke={baseColor}
        strokeWidth={0.5}
        strokeLinejoin="round"
        opacity={edgeOpacity}
        style={{ pointerEvents: "none" }}
      />
    </>
  );
}

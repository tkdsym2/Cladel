import { useMemo } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { useGraphStore } from "../../store/graphStore";

const NODE_COLORS: Record<string, string> = {
  core: "#1e40af",
  paper: "#059669",
  user_doc: "#d97706",
  agent_proposal: "#7c3aed",
  deleted: "#9ca3af",
  junction: "#4b5563",
  image: "#0891b2",
  agent: "#4338ca",
  paper_group: "#059669",
  export: "#e11d48",
  compare: "#0284c7",
  title: "#78716c",
};

const MAP_WIDTH = 160;
const MAP_HEIGHT = 120;
const PADDING = 8;

interface Props {
  width?: number;
  height?: number;
}

export function CustomMiniMap({
  width = MAP_WIDTH,
  height = MAP_HEIGHT,
}: Props) {
  const dbNodes = useGraphStore((s) => s.dbNodes);
  const dbEdges = useGraphStore((s) => s.dbEdges);

  // Subscribe to viewport changes via React Flow's internal store
  const viewport = useStore((s) => ({
    x: s.transform[0],
    y: s.transform[1],
    zoom: s.transform[2],
  }));
  const { getNodes } = useReactFlow();

  // Use React Flow nodes for current measured dimensions
  const rfNodes = getNodes();

  const { svgNodes, svgEdges, viewRect } = useMemo(() => {
    if (dbNodes.length === 0) {
      return { svgNodes: [], svgEdges: [], viewRect: null };
    }

    // Build a map from dbNode id to RF node for measured width/height
    const rfMap = new Map(rfNodes.map((n) => [n.id, n]));

    // Collect IDs of child nodes (inside a group) — they have relative positions
    // and should not be rendered independently in the minimap
    const childNodeIds = new Set<string>();
    for (const rfn of rfNodes) {
      if (rfn.parentId) childNodeIds.add(rfn.id);
    }

    // Filter to top-level nodes only
    const topLevelNodes = dbNodes.filter((n) => !childNodeIds.has(n.id));

    // Compute bounding box of all nodes
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const n of topLevelNodes) {
      const rf = rfMap.get(n.id);
      const w = rf?.measured?.width ?? n.width ?? 160;
      const h = rf?.measured?.height ?? n.height ?? 100;
      minX = Math.min(minX, n.position_x);
      minY = Math.min(minY, n.position_y);
      maxX = Math.max(maxX, n.position_x + w);
      maxY = Math.max(maxY, n.position_y + h);
    }

    // Add some padding around the bounding box
    const pad = 100;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;

    const worldW = maxX - minX || 1;
    const worldH = maxY - minY || 1;

    // Scale to fit within the minimap
    const drawW = width - PADDING * 2;
    const drawH = height - PADDING * 2;
    const scale = Math.min(drawW / worldW, drawH / worldH);

    // Center the content
    const scaledW = worldW * scale;
    const scaledH = worldH * scale;
    const offsetX = PADDING + (drawW - scaledW) / 2;
    const offsetY = PADDING + (drawH - scaledH) / 2;

    const toMapX = (wx: number) => offsetX + (wx - minX) * scale;
    const toMapY = (wy: number) => offsetY + (wy - minY) * scale;

    // Build node position lookup for edges
    const nodePositions = new Map<
      string,
      { cx: number; cy: number }
    >();

    const svgN = topLevelNodes.map((n) => {
      const rf = rfMap.get(n.id);
      const w = rf?.measured?.width ?? n.width ?? 160;
      const h = rf?.measured?.height ?? n.height ?? 100;
      const mx = toMapX(n.position_x);
      const my = toMapY(n.position_y);
      const mw = Math.max(w * scale, 3);
      const mh = Math.max(h * scale, 3);
      const color = NODE_COLORS[n.node_type] ?? "#6b7280";

      nodePositions.set(n.id, {
        cx: mx + mw / 2,
        cy: my + mh / 2,
      });

      return {
        id: n.id,
        x: mx,
        y: my,
        w: mw,
        h: mh,
        color,
        type: n.node_type,
      };
    });

    const svgE = dbEdges
      .map((e) => {
        const src = nodePositions.get(e.source_node_id);
        const tgt = nodePositions.get(e.target_node_id);
        if (!src || !tgt) return null;
        return {
          id: e.id,
          x1: src.cx,
          y1: src.cy,
          x2: tgt.cx,
          y2: tgt.cy,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }>;

    // Viewport rect: convert screen coords to minimap coords
    // viewport.x/y are the translate values, viewport.zoom is the scale
    // The visible area in flow coords is:
    //   flow_left = -viewport.x / viewport.zoom
    //   flow_top  = -viewport.y / viewport.zoom
    // We need the ReactFlow container size — approximate from window
    const containerEl = document.querySelector(".react-flow");
    const containerW = containerEl?.clientWidth ?? window.innerWidth;
    const containerH = containerEl?.clientHeight ?? window.innerHeight;

    const flowLeft = -viewport.x / viewport.zoom;
    const flowTop = -viewport.y / viewport.zoom;
    const flowRight = flowLeft + containerW / viewport.zoom;
    const flowBottom = flowTop + containerH / viewport.zoom;

    const vr = {
      x: toMapX(flowLeft),
      y: toMapY(flowTop),
      w: (flowRight - flowLeft) * scale,
      h: (flowBottom - flowTop) * scale,
    };

    return { svgNodes: svgN, svgEdges: svgE, viewRect: vr };
  }, [dbNodes, dbEdges, rfNodes, viewport, width, height]);

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block" }}
      viewBox={`0 0 ${width} ${height}`}
    >
      {/* Background */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="rgba(255,255,255,0.95)"
        rx={6}
        ry={6}
      />

      {/* Edges */}
      {svgEdges.map((e) => (
        <line
          key={e.id}
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
          stroke="#cbd5e1"
          strokeWidth={1}
        />
      ))}

      {/* Nodes */}
      {svgNodes.map((n) =>
        n.type === "junction" || n.type === "deleted" ? (
          <circle
            key={n.id}
            cx={n.x + n.w / 2}
            cy={n.y + n.h / 2}
            r={Math.max(n.w, n.h) / 2}
            fill={n.color}
            opacity={n.type === "deleted" ? 0.4 : 1}
          />
        ) : (
          <rect
            key={n.id}
            x={n.x}
            y={n.y}
            width={n.w}
            height={n.h}
            fill={n.color}
            rx={1.5}
            ry={1.5}
            opacity={n.type === "agent_proposal" ? 0.5 : 1}
          />
        ),
      )}

      {/* Viewport indicator */}
      {viewRect && (
        <rect
          x={viewRect.x}
          y={viewRect.y}
          width={viewRect.w}
          height={viewRect.h}
          fill="rgba(59,130,246,0.08)"
          stroke="#3b82f6"
          strokeWidth={1.5}
          rx={2}
          ry={2}
        />
      )}
    </svg>
  );
}

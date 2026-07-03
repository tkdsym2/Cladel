import { useState, useEffect, useRef, useMemo } from "react";

// ─── Types ───

export interface MentionItem {
  display_id: string;
  node_type: string;
  title: string;
  group_name?: string;
  distance?: number; // BFS hop count from current node (1 = direct, 2+ = multi-hop)
}

interface MentionPopoverProps {
  isOpen: boolean;
  position: { x: number; y: number };
  items: MentionItem[];
  filter: string;
  onSelect: (display_id: string, node_type: string) => void;
  onClose: () => void;
}

// ─── Constants ───

const NODE_COLORS: Record<string, string> = {
  paper: "#059669",
  image: "#0891b2",
};

const NODE_LABELS: Record<string, string> = {
  paper: "Paper",
  image: "Image",
};

// ─── Component ───

export function MentionPopover({
  isOpen,
  position,
  items,
  filter,
  onSelect,
  onClose,
}: MentionPopoverProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [distanceLevel, setDistanceLevel] = useState(0); // index into availableDistances (0 = first)
  const containerRef = useRef<HTMLDivElement>(null);

  // Collect sorted unique distances from items
  const availableDistances = useMemo(() => {
    const dists = new Set(items.map((i) => i.distance ?? 1));
    return Array.from(dists).sort((a, b) => a - b);
  }, [items]);

  // Current active distance
  const currentDistance = availableDistances[distanceLevel] ?? availableDistances[0] ?? 1;

  // Filter items by text filter AND distance level
  const filtered = useMemo(() => {
    return items.filter((item) => {
      const matchesText = item.display_id
        .toLowerCase()
        .includes(filter.toLowerCase());
      const matchesDist = (item.distance ?? 1) === currentDistance;
      return matchesText && matchesDist;
    });
  }, [items, filter, currentDistance]);

  // Reset focus when filter, distance, or items change
  useEffect(() => {
    setFocusIndex(0);
  }, [filter, distanceLevel, items]);

  // Reset distance level when popover opens
  useEffect(() => {
    if (isOpen) {
      setDistanceLevel(0);
    }
  }, [isOpen]);

  // Keyboard handling (capture phase)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          if (filtered.length > 0) {
            setFocusIndex((i) => (i + 1) % filtered.length);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          if (filtered.length > 0) {
            setFocusIndex((i) => (i - 1 + filtered.length) % filtered.length);
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          e.stopPropagation();
          if (availableDistances.length > 1) {
            setDistanceLevel((prev) =>
              prev < availableDistances.length - 1 ? prev + 1 : prev,
            );
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          e.stopPropagation();
          if (availableDistances.length > 1) {
            setDistanceLevel((prev) => (prev > 0 ? prev - 1 : prev));
          }
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (filtered[focusIndex]) {
            onSelect(filtered[focusIndex].display_id, filtered[focusIndex].node_type);
          }
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
        case " ":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, focusIndex, filtered, availableDistances, onSelect, onClose]);

  // Click-outside handling (50ms delay)
  useEffect(() => {
    if (!isOpen) return;

    const cleanupRef = { current: null as (() => void) | null };

    const timerId = window.setTimeout(() => {
      const handleMouseDown = (e: MouseEvent) => {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          onClose();
        }
      };
      window.addEventListener("mousedown", handleMouseDown);
      cleanupRef.current = () =>
        window.removeEventListener("mousedown", handleMouseDown);
    }, 50);

    return () => {
      window.clearTimeout(timerId);
      cleanupRef.current?.();
    };
  }, [isOpen, onClose]);

  // Scroll focused item into view
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen || !scrollRef.current) return;
    const el = scrollRef.current.children[focusIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [isOpen, focusIndex]);

  if (!isOpen) return null;

  // Clamp position to viewport bounds
  const popoverWidth = 300;
  const popoverMaxHeight = 360;
  const margin = 8;
  const clampedX = Math.min(
    Math.max(margin, position.x),
    window.innerWidth - popoverWidth - margin,
  );
  const clampedY = Math.min(
    Math.max(margin, position.y),
    window.innerHeight - popoverMaxHeight - margin,
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        left: clampedX,
        top: clampedY,
        zIndex: 1000,
        width: popoverWidth,
        maxHeight: popoverMaxHeight,
        background: "#f5f5f5",
        color: "#1f2937",
        borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.08)",
        userSelect: "none",
        animation: "mentionPopIn 120ms ease-out",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{keyframesCSS}</style>

      {/* Header with distance level tabs */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {availableDistances.map((d, idx) => {
            const active = idx === distanceLevel;
            const count = items.filter((i) => (i.distance ?? 1) === d).length;
            return (
              <span
                key={d}
                onClick={() => setDistanceLevel(idx)}
                style={distTabStyle(active, d)}
              >
                {d === 1 ? "Direct" : `${d} hops`}
                <span style={{ marginLeft: 3, opacity: 0.7 }}>{count}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Items */}
      <div ref={scrollRef} style={{ padding: "4px 6px", overflowY: "auto", flex: 1 }}>
        {filtered.length === 0 && (
          <div
            style={{
              padding: "12px 8px",
              textAlign: "center",
              fontSize: 11,
              color: "#9ca3af",
            }}
          >
            No matching items
          </div>
        )}
        {filtered.map((item, idx) => {
          const focused = idx === focusIndex;
          const color = NODE_COLORS[item.node_type] ?? "#6b7280";
          return (
            <div
              key={item.display_id + (item.group_name ?? "")}
              onClick={() => onSelect(item.display_id, item.node_type)}
              onMouseEnter={() => setFocusIndex(idx)}
              style={itemStyle(focused)}
            >
              <div
                style={{
                  width: 3,
                  height: 24,
                  borderRadius: 2,
                  background: color,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={nodeTypeBadge(color)}>
                    {NODE_LABELS[item.node_type] ?? item.node_type}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: "monospace",
                      color: "#374151",
                      fontWeight: 500,
                    }}
                  >
                    {item.display_id}
                  </span>
                </div>
                {(((item.node_type === "paper" || item.node_type === "title") && item.title) || item.group_name) && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#6b7280",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {(item.node_type === "paper" || item.node_type === "title") && item.title}
                    {item.group_name && (
                      <span style={{ color: "#9ca3af", marginLeft: 4, fontSize: 10 }}>
                        in: {item.group_name}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <span>{"\u2191\u2193"} Navigate</span>
        <span style={dotSep}>{"\u00b7"}</span>
        <span>{"\u2190\u2192"} Distance</span>
        <span style={dotSep}>{"\u00b7"}</span>
        <span>Enter Select</span>
        <span style={dotSep}>{"\u00b7"}</span>
        <span>Esc Cancel</span>
      </div>
    </div>
  );
}

// ─── Styles ───

const keyframesCSS = `
@keyframes mentionPopIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
`;

const headerStyle: React.CSSProperties = {
  padding: "8px 10px 6px",
  borderBottom: "1px solid rgba(0,0,0,0.06)",
};

const DIST_COLORS = ["#3b82f6", "#6366f1", "#8b5cf6", "#a78bfa", "#9ca3af"];

function distTabStyle(active: boolean, dist: number): React.CSSProperties {
  const color = dist === 1 ? "#374151" : DIST_COLORS[Math.min(dist - 2, DIST_COLORS.length - 1)] ?? "#9ca3af";
  return {
    fontSize: 9,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 4,
    cursor: "pointer",
    background: active ? color : "rgba(0,0,0,0.04)",
    color: active ? "#ffffff" : "#6b7280",
    transition: "all 0.12s",
    letterSpacing: 0.3,
  };
}

function itemStyle(focused: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 8px",
    borderRadius: 6,
    cursor: "pointer",
    background: focused ? "rgba(59,130,246,0.08)" : "transparent",
    transition: "background 0.1s",
  };
}

function nodeTypeBadge(color: string): React.CSSProperties {
  return {
    fontSize: 8,
    fontWeight: 700,
    padding: "1px 4px",
    borderRadius: 3,
    background: color,
    color: "#ffffff",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  };
}

const dotSep: React.CSSProperties = { margin: "0 5px", opacity: 0.3 };

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "5px 10px 7px",
  borderTop: "1px solid rgba(0,0,0,0.06)",
  fontSize: 10,
  color: "#9ca3af",
};

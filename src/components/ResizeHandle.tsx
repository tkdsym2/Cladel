import { useState, type MouseEvent } from "react";

export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: MouseEvent) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 5,
        cursor: "col-resize",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
        background: hovered ? "rgba(59, 130, 246, 0.15)" : "transparent",
        borderLeft: hovered ? "2px solid #3b82f6" : "1px solid #e5e7eb",
        transition: "background 0.15s, border-color 0.15s",
      }}
    />
  );
}

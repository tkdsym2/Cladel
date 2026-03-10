import { useState, useEffect, useRef, useCallback, type MouseEvent } from "react";
import { NodeDetailPanel } from "./NodeDetailPanel";

function FloatingResizeHandle({
  mode,
  onResizeStart,
}: {
  mode: "left" | "bottom" | "corner";
  onResizeStart: (e: MouseEvent, mode: "left" | "bottom" | "corner") => void;
}) {
  const [hovered, setHovered] = useState(false);
  const posStyle: React.CSSProperties =
    mode === "left"
      ? { position: "absolute", left: -4, top: 8, bottom: 8, width: 8, cursor: "ew-resize", zIndex: 12 }
      : mode === "bottom"
        ? { position: "absolute", left: 8, right: 8, bottom: -4, height: 8, cursor: "ns-resize", zIndex: 12 }
        : { position: "absolute", left: -4, bottom: -4, width: 14, height: 14, cursor: "nesw-resize", zIndex: 13 };
  const hoverBg =
    mode === "corner"
      ? "rgba(59, 130, 246, 0.35)"
      : "rgba(59, 130, 246, 0.25)";
  return (
    <div
      onMouseDown={(e) => onResizeStart(e, mode)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...posStyle,
        borderRadius: mode === "corner" ? 4 : mode === "left" ? "4px 0 0 4px" : "0 0 4px 4px",
        background: hovered ? hoverBg : "transparent",
        transition: "background 0.15s",
      }}
    />
  );
}

export function FloatingDetailPanel({
  onDeleteNode,
  onCreateLayerFromNode,
}: {
  onDeleteNode: (nodeId: string) => void;
  onCreateLayerFromNode: (nodeId: string) => void;
}) {
  const [size, setSize] = useState({ width: 480, height: 320 });
  const sizeRef = useRef(size);
  useEffect(() => { sizeRef.current = size; }, [size]);

  const handleResize = useCallback((e: MouseEvent, mode: "left" | "bottom" | "corner") => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = sizeRef.current.width;
    const startH = sizeRef.current.height;
    document.body.style.cursor = mode === "left" ? "ew-resize" : mode === "bottom" ? "ns-resize" : "nesw-resize";
    document.body.style.userSelect = "none";
    const onMouseMove = (ev: globalThis.MouseEvent) => {
      const dx = startX - ev.clientX;
      const dy = ev.clientY - startY;
      setSize({
        width: mode !== "bottom" ? Math.max(320, Math.min(startW + dx, window.innerWidth * 0.7)) : startW,
        height: mode !== "left" ? Math.max(200, Math.min(startH + dy, window.innerHeight - 100)) : startH,
      });
    };
    const onMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        width: size.width,
        height: size.height,
        zIndex: 10,
      }}
    >
      {/* Resize handles — outside overflow:hidden so they're always interactive */}
      <FloatingResizeHandle mode="left" onResizeStart={handleResize} />
      <FloatingResizeHandle mode="bottom" onResizeStart={handleResize} />
      <FloatingResizeHandle mode="corner" onResizeStart={handleResize} />

      {/* Content area with clipping for border-radius */}
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <NodeDetailPanel onDeleteNode={onDeleteNode} onCreateLayerFromNode={onCreateLayerFromNode} />
      </div>
    </div>
  );
}

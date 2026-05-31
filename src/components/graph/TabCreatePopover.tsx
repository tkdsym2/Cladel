import { useEffect, useRef, useState, useCallback } from "react";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import TitleIcon from "@mui/icons-material/Title";
import TableChartIcon from "@mui/icons-material/TableChart";
import type { TabNodeType, TabDirection } from "../../types";
import { useT, type Entry } from "../../lib/i18n";

interface TabCreatePopoverProps {
  isOpen: boolean;
  position: { x: number; y: number };
  direction: TabDirection;
  onSelect: (nodeType: TabNodeType) => void;
  onClose: () => void;
}

const GRID_COLS = 3;

const ITEMS: { type: TabNodeType; label: Entry; key: string; color: string; bg: string }[] = [
  { type: "user_doc", label: { en: "Edit", ja: "\u7de8\u96c6(Edit)" }, key: "1", color: "#d97706", bg: "#fffbeb" },
  { type: "paper", label: { en: "Paper", ja: "\u8ad6\u6587(Paper)" }, key: "2", color: "#059669", bg: "#f0fdf4" },
  { type: "image", label: { en: "Image", ja: "\u753b\u50cf(Image)" }, key: "3", color: "#0891b2", bg: "#f0fdfa" },
  { type: "agent", label: { en: "Agent", ja: "\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8(Agent)" }, key: "4", color: "#4338ca", bg: "rgba(67,56,202,0.08)" },
  { type: "import", label: { en: "Import", ja: "\u30a4\u30f3\u30dd\u30fc\u30c8(Import)" }, key: "5", color: "#6b7280", bg: "#f3f4f6" },
  { type: "export", label: { en: "Export", ja: "\u30a8\u30af\u30b9\u30dd\u30fc\u30c8(Export)" }, key: "6", color: "#e11d48", bg: "rgba(225,29,72,0.08)" },
  { type: "compare", label: { en: "Compare", ja: "\u6bd4\u8f03(Compare)" }, key: "7", color: "#0284c7", bg: "rgba(2,132,199,0.08)" },
  { type: "title", label: { en: "Title", ja: "\u30bf\u30a4\u30c8\u30eb(Title)" }, key: "8", color: "#78716c", bg: "rgba(120,113,108,0.08)" },
  { type: "table", label: { en: "Table", ja: "\u30c6\u30fc\u30d6\u30eb(Table)" }, key: "9", color: "#0f766e", bg: "rgba(15,118,110,0.08)" },
];

const DIRECTION_LABELS: Record<TabDirection, Entry> = {
  right: { en: "\u2192 Right", ja: "\u2192 \u53f3" },
  left: { en: "\u2190 Left", ja: "\u2190 \u5de6" },
};

const ICONS = [NoteAddIcon, PictureAsPdfIcon, AddPhotoAlternateIcon, SmartToyIcon, FileUploadIcon, SaveAltIcon, CompareArrowsIcon, TitleIcon, TableChartIcon];

export function TabCreatePopover({
  isOpen,
  position,
  direction,
  onSelect,
  onClose,
}: TabCreatePopoverProps) {
  const t = useT();
  const [focusIndex, setFocusIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset focus and clear any browser text selection when popover opens
  useEffect(() => {
    if (isOpen) {
      setFocusIndex(0);
      window.getSelection()?.removeAllRanges();
    }
  }, [isOpen]);

  // Keyboard handling (capture phase)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          setFocusIndex((i) => (i + 1) % ITEMS.length);
          break;
        case "ArrowLeft":
          e.preventDefault();
          setFocusIndex((i) => (i - 1 + ITEMS.length) % ITEMS.length);
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocusIndex((i) => Math.min(i + GRID_COLS, ITEMS.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusIndex((i) => Math.max(i - GRID_COLS, 0));
          break;
        case "Enter":
          e.preventDefault();
          onSelect(ITEMS[focusIndex].type);
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "7":
        case "6":
        case "8":
        case "9": {
          e.preventDefault();
          const idx = Number(e.key) - 1;
          if (idx < ITEMS.length) onSelect(ITEMS[idx].type);
          break;
        }
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "Tab":
          e.preventDefault();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, focusIndex, onSelect, onClose]);

  // Click-outside handling (50ms delay to prevent immediate trigger)
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

  const handleItemClick = useCallback(
    (type: TabNodeType) => {
      onSelect(type);
    },
    [onSelect],
  );

  if (!isOpen) return null;

  // Clamp position to viewport bounds
  const popoverWidth = 280;
  const popoverHeight = 340;
  const margin = 8;
  const clampedX = Math.min(
    Math.max(margin, position.x),
    window.innerWidth - popoverWidth - margin,
  );
  const clampedY = Math.min(
    Math.max(margin, position.y),
    window.innerHeight - popoverHeight - margin,
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        left: clampedX,
        top: clampedY,
        zIndex: 1000,
        minWidth: popoverWidth,
        background: "#f5f5f5",
        color: "#1f2937",
        borderRadius: 10,
        border: "1px solid #d1d5db",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        userSelect: "none",
        animation: "tabPopoverIn 120ms ease-out",
      }}
    >
      <style>{keyframesCSS}</style>

      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>{t({ en: "Create Node", ja: "ノードを作成" })}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>
          {t(DIRECTION_LABELS[direction])}
        </span>
      </div>

      {/* Items Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
        gap: 6,
        padding: "6px 10px",
      }}>
        {ITEMS.map((item, idx) => {
          const Icon = ICONS[idx];
          const focused = idx === focusIndex;
          return (
            <div
              key={item.type}
              onClick={() => handleItemClick(item.type)}
              onMouseEnter={() => setFocusIndex(idx)}
              style={gridItemStyle(focused, item)}
            >
              <div style={gridIconBoxStyle(item)}>
                <Icon sx={{ fontSize: 20, color: item.color }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, color: "#374151" }}>{t(item.label)}</span>
              <span style={badgeStyle}>{item.key}</span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <span>{t({ en: "\u2190\u2191\u2193\u2192 Navigate", ja: "\u2190\u2191\u2193\u2192 \u79fb\u52d5" })}</span>
        <span style={{ margin: "0 6px", opacity: 0.3 }}>\u00b7</span>
        <span>{t({ en: "Enter Select", ja: "Enter \u9078\u629e" })}</span>
        <span style={{ margin: "0 6px", opacity: 0.3 }}>\u00b7</span>
        <span>{t({ en: "Esc Cancel", ja: "Esc \u30ad\u30e3\u30f3\u30bb\u30eb" })}</span>
      </div>
    </div>
  );
}

// ─── Styles ───

const keyframesCSS = `
@keyframes tabPopoverIn {
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
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 14px 6px",
  borderBottom: "1px solid #e5e7eb",
};

function gridItemStyle(focused: boolean, item: typeof ITEMS[number]): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    padding: "10px 4px 6px",
    borderRadius: 8,
    cursor: "pointer",
    background: focused ? item.bg : "transparent",
    border: focused ? `1.5px solid ${item.color}` : "1.5px solid transparent",
    transition: "all 0.12s ease",
  };
}

function gridIconBoxStyle(item: typeof ITEMS[number]): React.CSSProperties {
  return {
    width: 36,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    background: item.bg,
    border: `1px solid ${item.color}30`,
    flexShrink: 0,
  };
}

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  fontFamily: "monospace",
  color: "#9ca3af",
  background: "rgba(0,0,0,0.06)",
  padding: "2px 6px",
  borderRadius: 4,
  lineHeight: 1,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "6px 14px 10px",
  borderTop: "1px solid #e5e7eb",
  fontSize: 10,
  color: "#9ca3af",
};

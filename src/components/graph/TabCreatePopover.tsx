import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import TitleIcon from "@mui/icons-material/Title";
import TableChartIcon from "@mui/icons-material/TableChart";
import PreviewIcon from "@mui/icons-material/Preview";
import TranslateIcon from "@mui/icons-material/Translate";
import SearchIcon from "@mui/icons-material/Search";
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

type Item = { type: TabNodeType; label: Entry; aliases: string[]; color: string; bg: string; Icon: typeof NoteAddIcon };

const ITEMS: Item[] = [
  { type: "user_doc", label: { en: "Edit", ja: "\u7de8\u96c6(Edit)" }, aliases: ["note", "doc", "typst"], color: "#d97706", bg: "#fffbeb", Icon: NoteAddIcon },
  { type: "paper", label: { en: "Paper", ja: "\u8ad6\u6587(Paper)" }, aliases: ["pdf", "literature"], color: "#059669", bg: "#f0fdf4", Icon: PictureAsPdfIcon },
  { type: "image", label: { en: "Image", ja: "\u753b\u50cf(Image)" }, aliases: ["picture", "figure", "photo"], color: "#0891b2", bg: "#f0fdfa", Icon: AddPhotoAlternateIcon },
  { type: "agent", label: { en: "Agent", ja: "\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8(Agent)" }, aliases: ["ai", "chat", "bot"], color: "#4338ca", bg: "rgba(67,56,202,0.08)", Icon: SmartToyIcon },
  { type: "import", label: { en: "Import", ja: "\u30a4\u30f3\u30dd\u30fc\u30c8(Import)" }, aliases: ["file", "open"], color: "#6b7280", bg: "#f3f4f6", Icon: FileUploadIcon },
  { type: "export", label: { en: "Export", ja: "\u30a8\u30af\u30b9\u30dd\u30fc\u30c8(Export)" }, aliases: ["pdf", "output"], color: "#e11d48", bg: "rgba(225,29,72,0.08)", Icon: SaveAltIcon },
  { type: "compare", label: { en: "Compare", ja: "\u6bd4\u8f03(Compare)" }, aliases: ["diff"], color: "#0284c7", bg: "rgba(2,132,199,0.08)", Icon: CompareArrowsIcon },
  { type: "title", label: { en: "Title", ja: "\u30bf\u30a4\u30c8\u30eb(Title)" }, aliases: ["author", "cover"], color: "#78716c", bg: "rgba(120,113,108,0.08)", Icon: TitleIcon },
  { type: "table", label: { en: "Table", ja: "\u30c6\u30fc\u30d6\u30eb(Table)" }, aliases: ["csv", "xlsx", "sheet", "grid"], color: "#0f766e", bg: "rgba(15,118,110,0.08)", Icon: TableChartIcon },
  { type: "render", label: { en: "Render", ja: "\u30ec\u30f3\u30c0\u30fc(Render)" }, aliases: ["preview", "typst"], color: "#9333ea", bg: "rgba(147,51,234,0.08)", Icon: PreviewIcon },
  { type: "translate", label: { en: "Translate", ja: "\u7ffb\u8a33(Translate)" }, aliases: ["plamo", "language"], color: "#ea580c", bg: "rgba(234,88,12,0.08)", Icon: TranslateIcon },
];

/** Items whose English name (or an alias) contains the query; name-prefix
 *  matches first, then alias-prefix, then substring. Empty query = all items. */
function filterItems(query: string): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return ITEMS;
  const scored: { item: Item; rank: number }[] = [];
  for (const item of ITEMS) {
    const name = item.label.en.toLowerCase();
    const names = [name, item.type.replace("_", ""), ...item.aliases];
    let rank = -1;
    if (name.startsWith(q)) rank = 0;
    else if (names.some((n) => n.startsWith(q))) rank = 1;
    else if (names.some((n) => n.includes(q))) rank = 2;
    if (rank >= 0) scored.push({ item, rank });
  }
  return scored.sort((a, b) => a.rank - b.rank).map((x) => x.item);
}

/** The ASCII character a key press types, independent of the active input
 *  method: the query only ever takes English letters/digits. With a Japanese
 *  IME on, `e.key` may be "Process" or kana, so fall back to the physical key. */
function asciiCharFor(e: KeyboardEvent): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (/^[a-zA-Z0-9_-]$/.test(e.key)) return e.key.toLowerCase();
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code);
  if (m) return (m[1] ?? m[2]).toLowerCase();
  if (e.code === "Minus") return e.shiftKey ? "_" : "-";
  return null;
}

const DIRECTION_LABELS: Record<TabDirection, Entry> = {
  right: { en: "\u2192 Right", ja: "\u2192 \u53f3" },
  left: { en: "\u2190 Left", ja: "\u2190 \u5de6" },
};

export function TabCreatePopover({
  isOpen,
  position,
  direction,
  onSelect,
  onClose,
}: TabCreatePopoverProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => filterItems(query), [query]);

  // Reset query/focus, clear any browser text selection, and put the cursor
  // in the search field when the popover opens.
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setFocusIndex(0);
    window.getSelection()?.removeAllRanges();
    searchRef.current?.focus();
  }, [isOpen]);

  // The best match is always the one Enter picks after typing.
  useEffect(() => {
    setFocusIndex(0);
  }, [query]);

  // Keyboard handling (capture phase). Every key is consumed here so canvas
  // shortcuts (V/G/C, Delete, …) never fire while the popover is open.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      const n = items.length;
      switch (e.key) {
        case "ArrowRight":
          consume();
          if (n) setFocusIndex((i) => (i + 1) % n);
          return;
        case "ArrowLeft":
          consume();
          if (n) setFocusIndex((i) => (i - 1 + n) % n);
          return;
        case "ArrowDown":
          consume();
          if (n) setFocusIndex((i) => Math.min(i + GRID_COLS, n - 1));
          return;
        case "ArrowUp":
          consume();
          setFocusIndex((i) => Math.max(i - GRID_COLS, 0));
          return;
        case "Enter":
          consume();
          if (items[focusIndex]) onSelect(items[focusIndex].type);
          return;
        case "Escape":
          consume();
          if (query) setQuery("");
          else onClose();
          return;
        case "Tab":
          consume();
          searchRef.current?.focus();
          return;
        case "Backspace":
        case "Delete":
          consume();
          searchRef.current?.focus();
          if (e.metaKey || e.altKey || e.ctrlKey) setQuery("");
          else setQuery((q) => q.slice(0, -1));
          return;
      }
      // Let app-level shortcuts with modifiers (Cmd+S, Cmd+W, …) through.
      if (e.metaKey || e.ctrlKey) return;
      consume();
      const ch = asciiCharFor(e);
      if (ch) {
        searchRef.current?.focus();
        setQuery((q) => (q + ch).slice(0, 32));
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, items, focusIndex, query, onSelect, onClose]);

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
  const popoverHeight = 440;
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

      {/* Search field (English only; typing anywhere in the popover lands here) */}
      <div style={{ padding: "8px 10px 2px" }}>
        <div
          ref={searchRef}
          tabIndex={0}
          role="searchbox"
          aria-label={t({ en: "Search node types", ja: "ノードの種類を検索" })}
          onMouseDown={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
          style={searchBoxStyle}
        >
          <SearchIcon sx={{ fontSize: 15, color: "#9ca3af" }} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", display: "flex", alignItems: "center" }}>
            <span style={{ fontFamily: "monospace", fontSize: 12.5, color: "#111827" }}>{query}</span>
            <span className="tab-popover-caret" />
            {!query && (
              <span style={{ fontSize: 11.5, color: "#9ca3af", marginLeft: 4 }}>
                {t({ en: "Type a node name (English)", ja: "ノード名を英字で入力" })}
              </span>
            )}
          </span>
          <span style={kbdStyle}>A–Z</span>
        </div>
      </div>

      {/* Items Grid */}
      {items.length === 0 ? (
        <div style={{ padding: "18px 10px", textAlign: "center", fontSize: 11.5, color: "#9ca3af" }}>
          {t({ en: "No node type matches “{q}”", ja: "「{q}」に一致するノードはありません" }, { q: query })}
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
          gap: 6,
          padding: "6px 10px",
        }}>
          {items.map((item, idx) => {
            const Icon = item.Icon;
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
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={footerStyle}>
        <span>{t({ en: "Type to filter", ja: "\u5165\u529b\u3067\u7d5e\u308a\u8fbc\u307f" })}</span>
        <span style={{ margin: "0 6px", opacity: 0.3 }}>{"\u00b7"}</span>
        <span>{t({ en: "\u2190\u2191\u2193\u2192 Navigate", ja: "\u2190\u2191\u2193\u2192 \u79fb\u52d5" })}</span>
        <span style={{ margin: "0 6px", opacity: 0.3 }}>{"\u00b7"}</span>
        <span>{t({ en: "Enter Select", ja: "Enter \u9078\u629e" })}</span>
        <span style={{ margin: "0 6px", opacity: 0.3 }}>{"\u00b7"}</span>
        <span>{t({ en: "Esc Cancel", ja: "Esc \u30ad\u30e3\u30f3\u30bb\u30eb" })}</span>
      </div>
    </div>
  );
}

// ─── Styles ───

const keyframesCSS = `
@keyframes tabPopoverCaret {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
.tab-popover-caret {
  display: inline-block;
  width: 1.5px;
  height: 14px;
  margin-left: 1px;
  background: #2563eb;
  animation: tabPopoverCaret 1s step-end infinite;
}
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

const searchBoxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 8px",
  borderRadius: 7,
  background: "#fff",
  border: "1.5px solid #3b82f6",
  boxShadow: "0 0 0 3px rgba(59,130,246,0.15)",
  cursor: "text",
  outline: "none",
};

const kbdStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 600,
  fontFamily: "monospace",
  color: "#9ca3af",
  background: "rgba(0,0,0,0.05)",
  padding: "2px 5px",
  borderRadius: 4,
  lineHeight: 1,
  flexShrink: 0,
};

function gridItemStyle(focused: boolean, item: Item): React.CSSProperties {
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

function gridIconBoxStyle(item: Item): React.CSSProperties {
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


const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "6px 14px 10px",
  borderTop: "1px solid #e5e7eb",
  fontSize: 10,
  color: "#9ca3af",
};

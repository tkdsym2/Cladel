import { useState } from "react";
import NearMeIcon from "@mui/icons-material/NearMe";
import HighlightAltIcon from "@mui/icons-material/HighlightAlt";
import PaletteIcon from "@mui/icons-material/Palette";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { useGraphStore } from "../../store/graphStore";
import { useT } from "../../lib/i18n";

export type CursorMode = "normal" | "select";

const BAR_H = 28;

export function CursorModeIndicator({ mode }: { mode: CursorMode }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const isSelect = mode === "select";
  const colorMode = useGraphStore((s) => s.colorMode);
  const toggleColorMode = useGraphStore((s) => s.toggleColorMode);
  const isUserColor = colorMode === "user";

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        zIndex: 5,
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        height: BAR_H,
        gap: 0,
        userSelect: "none",
      }}
    >
      {/* Toggle arrow */}
      <button
        onClick={() => setExpanded((v) => !v)}
        title={expanded
          ? t({ en: "Hide shortcut help", ja: "ショートカットヘルプを隠す" })
          : t({ en: "Show shortcut help", ja: "ショートカットヘルプを表示" })}
        style={{
          width: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff",
          border: "1px solid #d1d5db",
          borderRadius: "4px 0 0 4px",
          borderRight: "none",
          cursor: "pointer",
          padding: 0,
          boxSizing: "border-box",
        }}
      >
        <KeyboardArrowRightIcon
          sx={{
            fontSize: 14,
            color: "#6b7280",
            transition: "transform 0.15s",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {/* Mode pills */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          background: "#fff",
          border: "1px solid #d1d5db",
          borderRadius: 0,
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {/* Normal mode pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "0 8px",
            background: !isSelect ? "#3b82f6" : "transparent",
            color: !isSelect ? "#fff" : "#6b7280",
            fontSize: 11,
            fontWeight: 500,
            transition: "background 0.15s, color 0.15s",
          }}
        >
          <NearMeIcon
            sx={{
              fontSize: 13,
              transform: "scaleX(-1)",
            }}
          />
          <span>{t({ en: "Move", ja: "移動" })}</span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, alignSelf: "center", height: 16, background: "#e5e7eb" }} />

        {/* Select mode pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "0 8px",
            background: isSelect ? "#3b82f6" : "transparent",
            color: isSelect ? "#fff" : "#6b7280",
            fontSize: 11,
            fontWeight: 500,
            transition: "background 0.15s, color 0.15s",
          }}
        >
          <HighlightAltIcon sx={{ fontSize: 13 }} />
          <span>{t({ en: "Select", ja: "選択" })}</span>
        </div>
      </div>

      {/* Color mode toggle */}
      <button
        onClick={toggleColorMode}
        title={isUserColor
          ? t({ en: "Color: User (press C to toggle)", ja: "カラー: ユーザー (Cキーで切替)" })
          : t({ en: "Color: Type (press C to toggle)", ja: "カラー: タイプ (Cキーで切替)" })}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 8px",
          background: isUserColor ? "#6366f1" : "#fff",
          color: isUserColor ? "#fff" : "#6b7280",
          border: "1px solid #d1d5db",
          borderLeft: "none",
          borderRadius: expanded ? "0" : "0 4px 4px 0",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 500,
          boxSizing: "border-box",
          transition: "background 0.15s, color 0.15s",
        }}
      >
        {isUserColor ? (
          <PaletteIcon sx={{ fontSize: 13 }} />
        ) : (
          <PaletteOutlinedIcon sx={{ fontSize: 13 }} />
        )}
        <span>{isUserColor ? t({ en: "User", ja: "ユーザー" }) : t({ en: "Type", ja: "タイプ" })}</span>
      </button>

      {/* Expanded help panel */}
      {expanded && (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            background: "#fff",
            border: "1px solid #d1d5db",
            borderLeft: "none",
            borderRadius: "0 4px 4px 0",
            padding: "0 10px",
            gap: 12,
            fontSize: 11,
            color: "#4b5563",
            boxSizing: "border-box",
          }}
        >
          <span>
            <kbd style={kbdStyle}>V</kbd> {t({ en: "Move", ja: "移動" })}
          </span>
          <span>
            <kbd style={kbdStyle}>G</kbd> {t({ en: "Select", ja: "選択" })}
          </span>
          <span>
            <kbd style={kbdStyle}>C</kbd> {t({ en: "Color", ja: "カラー" })}
          </span>
        </div>
      )}
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 5px",
  fontSize: 10,
  fontFamily: "monospace",
  fontWeight: 600,
  lineHeight: "16px",
  color: "#374151",
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: 3,
  marginRight: 3,
};

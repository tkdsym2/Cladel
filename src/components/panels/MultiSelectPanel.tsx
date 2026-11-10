import SelectAllIcon from "@mui/icons-material/SelectAll";
import { useT } from "../../lib/i18n";

export function MultiSelectPanel({ count }: { count: number }) {
  const t = useT();
  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <SelectAllIcon sx={{ fontSize: 20, color: "#3b82f6" }} />
        <span>{t({ en: "{count} nodes selected", ja: "{count}件のノードを選択中" }, { count })}</span>
      </div>
      <div style={hintStyle}>
        {t({ en: "Multi-selection actions will appear here.", ja: "複数選択時の操作はここに表示されます。" })}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  height: "100%",
  background: "#f8fafc",
  borderLeft: "1px solid #e5e7eb",
  padding: "20px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 600,
  fontSize: 15,
  color: "#1f2937",
};

const hintStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#9ca3af",
};

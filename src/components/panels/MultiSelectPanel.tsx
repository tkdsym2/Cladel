import SelectAllIcon from "@mui/icons-material/SelectAll";

export function MultiSelectPanel({ count }: { count: number }) {
  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <SelectAllIcon sx={{ fontSize: 20, color: "#3b82f6" }} />
        <span>{count} nodes selected</span>
      </div>
      <div style={hintStyle}>
        Multi-selection actions will appear here.
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

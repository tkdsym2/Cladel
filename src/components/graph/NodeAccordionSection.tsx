import { type ReactNode } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

interface Props {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** When true, the section takes flex:1 to fill remaining space (for editors) */
  flex?: boolean;
  /** When true, always show content without accordion header (detached window mode) */
  detached?: boolean;
}

export function AccordionSection({ label, expanded, onToggle, children, flex, detached }: Props) {
  if (detached) {
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={detachedLabelStyle}>{label}</div>
        <div>{children}</div>
      </div>
    );
  }

  return (
    <div
      style={
        flex && expanded
          ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }
          : undefined
      }
    >
      <div onClick={onToggle} style={headerStyle}>
        <ExpandMoreIcon
          sx={{
            fontSize: 16,
            color: "#9ca3af",
            transition: "transform 0.15s",
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        />
        <span style={labelStyle}>{label}</span>
      </div>
      {expanded && (
        <div
          style={
            flex
              ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", paddingBottom: 4 }
              : { paddingBottom: 8 }
          }
        >
          {children}
        </div>
      )}
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "6px 0",
  cursor: "pointer",
  userSelect: "none",
  borderBottom: "1px solid #f3f4f6",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const detachedLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  paddingBottom: 4,
  borderBottom: "1px solid #f3f4f6",
  marginBottom: 6,
};

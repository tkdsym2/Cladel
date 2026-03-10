import { useCallback } from "react";
import DescriptionIcon from "@mui/icons-material/Description";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import SettingsIcon from "@mui/icons-material/Settings";
import DvrIcon from "@mui/icons-material/Dvr";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import type { TabInfo } from "../store/tabStore";

interface Props {
  tabs: TabInfo[];
  activeTabId: string | null;
  onSwitchTab: (tabId: string) => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onOpenConsole: () => void;
  onOpenManual: () => void;
  onOpenSettings: () => void;
}

export function FileTabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onNewTab,
  onCloseTab,
  onOpenConsole,
  onOpenManual,
  onOpenSettings,
}: Props) {
  const handleCloseTab = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      onCloseTab(tabId);
    },
    [onCloseTab],
  );

  return (
    <div style={barStyle}>
      <div style={tabsContainerStyle}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => onSwitchTab(tab.id)}
              style={{
                ...tabStyle,
                ...(isActive ? activeTabStyle : inactiveTabStyle),
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = "#e5e7eb";
              }}
              onMouseLeave={(e) => {
                if (!isActive)
                  e.currentTarget.style.background = inactiveTabStyle.background as string;
              }}
              title={tab.file_path ?? "Untitled"}
            >
              <DescriptionIcon sx={{ fontSize: 14, color: isActive ? "#1e40af" : "#9ca3af", flexShrink: 0 }} />
              <span style={tabNameStyle}>
                {tab.display_name}
                {tab.is_dirty && (
                  <span style={{ color: "#9ca3af", marginLeft: 1 }}>*</span>
                )}
              </span>
              <span
                onClick={(e) => handleCloseTab(e, tab.id)}
                style={closeButtonStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <CloseIcon sx={{ fontSize: 12 }} />
              </span>
            </button>
          );
        })}
        <button
          onClick={onNewTab}
          style={newTabButtonStyle}
          title="New Tab (Cmd+N)"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#e5e7eb";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <AddIcon sx={{ fontSize: 16 }} />
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button
          onClick={onOpenConsole}
          style={settingsButtonStyle}
          title="Agent Console"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#e5e7eb";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <DvrIcon sx={{ fontSize: 15, color: "#6b7280" }} />
        </button>
        <button
          onClick={onOpenManual}
          style={settingsButtonStyle}
          title="Manual"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#e5e7eb";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <MenuBookIcon sx={{ fontSize: 15, color: "#6b7280" }} />
        </button>
        <button
          onClick={onOpenSettings}
          style={settingsButtonStyle}
          title="Settings (Cmd+,)"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#e5e7eb";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <SettingsIcon sx={{ fontSize: 15, color: "#6b7280" }} />
        </button>
      </div>
    </div>
  );
}

// ─── Styles ───

const barStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "#e5e7eb",
  borderBottom: "1px solid #d1d5db",
  height: 34,
  minHeight: 34,
  paddingLeft: 4,
  paddingRight: 8,
  zIndex: 10,
  userSelect: "none",
};

const tabsContainerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 1,
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  height: "100%",
};

const tabStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  padding: "0 10px",
  height: 30,
  marginTop: 4,
  border: "none",
  borderRadius: "6px 6px 0 0",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
  maxWidth: 180,
  minWidth: 0,
  transition: "background 0.1s",
};

const activeTabStyle: React.CSSProperties = {
  background: "#ffffff",
  color: "#111827",
  borderBottom: "2px solid #1e40af",
};

const inactiveTabStyle: React.CSSProperties = {
  background: "#f3f4f6",
  color: "#6b7280",
  borderBottom: "2px solid transparent",
};

const tabNameStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  flex: 1,
  minWidth: 0,
  textAlign: "left",
};

const closeButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  borderRadius: 4,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "#9ca3af",
  flexShrink: 0,
  transition: "background 0.1s",
};

const newTabButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  border: "none",
  borderRadius: 4,
  background: "transparent",
  cursor: "pointer",
  color: "#6b7280",
  flexShrink: 0,
  marginLeft: 4,
  marginBottom: 2,
  transition: "background 0.1s",
};

const settingsButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  border: "none",
  borderRadius: 4,
  background: "transparent",
  cursor: "pointer",
  flexShrink: 0,
  transition: "background 0.1s",
};

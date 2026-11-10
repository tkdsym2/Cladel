import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { useAgentStore } from "../../store/agentStore";
import { useGraphStore } from "../../store/graphStore";
import { CustomMiniMap } from "./CustomMiniMap";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import MapIcon from "@mui/icons-material/Map";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import { useT } from "../../lib/i18n";

const ctrlBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#fff",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  cursor: "pointer",
  padding: 0,
};

export function CanvasControls({
  minimapVisible,
  onToggleMinimap,
}: {
  minimapVisible: boolean;
  onToggleMinimap: () => void;
}) {
  const t = useT();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const agentPanelOpen = useAgentStore((s) => s.panelOpen);
  const toggleAgentPanel = useAgentStore((s) => s.togglePanel);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);

  const handleToggleAgent = useCallback(() => {
    if (!agentPanelOpen && selectedNodeId) {
      useGraphStore.getState().setSelectedNodeId(null);
    }
    toggleAgentPanel();
  }, [agentPanelOpen, selectedNodeId, toggleAgentPanel]);

  return (
    <div
      style={{
        position: "absolute",
        left: 10,
        bottom: 10,
        zIndex: 5,
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 8,
      }}
    >
      {/* Left column: zoom controls + agent + map toggle, stacked vertically */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <button
          onClick={() => zoomIn()}
          title={t({ en: "Zoom in", ja: "拡大" })}
          style={ctrlBtnStyle}
        >
          <AddIcon sx={{ fontSize: 16, color: "#374151" }} />
        </button>
        <button
          onClick={() => zoomOut()}
          title={t({ en: "Zoom out", ja: "縮小" })}
          style={ctrlBtnStyle}
        >
          <RemoveIcon sx={{ fontSize: 16, color: "#374151" }} />
        </button>
        <button
          onClick={() => fitView({ padding: 0.3 })}
          title={t({ en: "Fit to view", ja: "全体表示" })}
          style={ctrlBtnStyle}
        >
          <FitScreenIcon sx={{ fontSize: 16, color: "#374151" }} />
        </button>
        <div style={{ height: 4 }} />
        <button
          onClick={handleToggleAgent}
          title={t({ en: "Research Assistant", ja: "リサーチアシスタント" })}
          style={{
            ...ctrlBtnStyle,
            ...(agentPanelOpen ? { background: "#7c3aed" } : {}),
          }}
        >
          <AutoAwesomeIcon sx={{ fontSize: 16, color: agentPanelOpen ? "#fff" : "#374151" }} />
        </button>
        <button
          onClick={onToggleMinimap}
          title={minimapVisible
            ? t({ en: "Hide minimap", ja: "ミニマップを隠す" })
            : t({ en: "Show minimap", ja: "ミニマップを表示" })}
          style={{
            ...ctrlBtnStyle,
            opacity: minimapVisible ? 1 : 0.5,
          }}
        >
          {minimapVisible ? (
            <MapIcon sx={{ fontSize: 16, color: "#374151" }} />
          ) : (
            <MapOutlinedIcon sx={{ fontSize: 16, color: "#374151" }} />
          )}
        </button>
      </div>

      {/* Right side: minimap (only when visible) */}
      {minimapVisible && (
        <div
          style={{
            border: "1px solid #d1d5db",
            borderRadius: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            overflow: "hidden",
          }}
        >
          <CustomMiniMap />
        </div>
      )}

    </div>
  );
}

import { useCallback, type ReactNode } from "react";
import { useReactFlow } from "@xyflow/react";
import AddIcon from "@mui/icons-material/Add";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import { useGraphStore } from "../../store/graphStore";
import { useLayerStore } from "../../store/layerStore";
import { useAgentStore } from "../../store/agentStore";
import { useSettingsStore } from "../../store/settingsStore";

interface Props {
  onImportPdf: () => void;
  onImportImage: () => void;
}

export function GraphToolbar({ onImportPdf, onImportImage }: Props) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const addNode = useGraphStore((s) => s.addNode);
  const currentLayer = useLayerStore((s) => s.currentLayer);
  const agentPanelOpen = useAgentStore((s) => s.panelOpen);
  const toggleAgentPanel = useAgentStore((s) => s.togglePanel);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);

  const handleAddNote = useCallback(async () => {
    if (!currentLayer) return;
    // Place at viewport center
    const container = document.querySelector(".react-flow");
    const rect = container?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const pos = screenToFlowPosition({ x: centerX, y: centerY });
    const prefs = useSettingsStore.getState().uiPreferences;
    await addNode({
      layer_id: currentLayer.id,
      node_type: "user_doc",
      title: "New Note",
      content: "",
      position_x: pos.x,
      position_y: pos.y,
      width: prefs.user_doc_default_width,
      height: prefs.user_doc_default_height,
    });
  }, [currentLayer, addNode, screenToFlowPosition]);

  const handleAddAgentNode = useCallback(async () => {
    if (!currentLayer) return;
    const container = document.querySelector(".react-flow");
    const rect = container?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const pos = screenToFlowPosition({ x: centerX, y: centerY });
    await addNode({
      layer_id: currentLayer.id,
      node_type: "agent",
      title: "Agent",
      content: "",
      position_x: pos.x,
      position_y: pos.y,
      width: 280,
      height: 210,
    });
  }, [currentLayer, addNode, screenToFlowPosition]);

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.3, duration: 300 });
  }, [fitView]);

  const handleToggleAgent = useCallback(() => {
    if (!agentPanelOpen && selectedNodeId) {
      useGraphStore.getState().setSelectedNodeId(null);
    }
    toggleAgentPanel();
  }, [agentPanelOpen, selectedNodeId, toggleAgentPanel]);

  return (
    <div style={toolbarStyle}>
      <ToolbarButton
        onClick={handleAddNote}
        icon={<AddIcon sx={{ fontSize: 16 }} />}
        label="Add Note"
        title="Add a note node at viewport center"
      />
      <Separator />
      <ToolbarButton
        onClick={onImportPdf}
        icon={<MenuBookIcon sx={{ fontSize: 16 }} />}
        label="Import Paper"
        title="Import paper from PDF"
      />
      <Separator />
      <ToolbarButton
        onClick={onImportImage}
        icon={<AddPhotoAlternateIcon sx={{ fontSize: 16 }} />}
        label="Import Image"
        title="Import image file"
      />
      <Separator />
      <ToolbarButton
        onClick={handleAddAgentNode}
        icon={<SmartToyIcon sx={{ fontSize: 16 }} />}
        label="Agent Node"
        title="Add an agent node at viewport center"
      />
      <Separator />
      <ToolbarButton
        onClick={handleToggleAgent}
        icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />}
        label="Agent"
        title="Open Research Assistant"
        active={agentPanelOpen}
      />
      <Separator />
      <ToolbarButton
        onClick={handleFitView}
        icon={<FitScreenIcon sx={{ fontSize: 16 }} />}
        label="Fit"
        title="Zoom to fit all nodes"
      />
    </div>
  );
}

function ToolbarButton({
  onClick,
  icon,
  label,
  title,
  active,
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        ...btnStyle,
        ...(active ? activeBtnStyle : {}),
      }}
    >
      <span style={{ display: "flex", alignItems: "center", lineHeight: 1 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function Separator() {
  return <div style={separatorStyle} />;
}

const toolbarStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  zIndex: 5,
  display: "flex",
  alignItems: "center",
  gap: 2,
  padding: 4,
  background: "rgba(255, 255, 255, 0.85)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  borderRadius: 10,
  boxShadow: "0 1px 6px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04)",
};

const btnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 500,
  color: "#374151",
  background: "transparent",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const activeBtnStyle: React.CSSProperties = {
  background: "#7c3aed",
  color: "#ffffff",
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 18,
  background: "#e5e7eb",
  flexShrink: 0,
};

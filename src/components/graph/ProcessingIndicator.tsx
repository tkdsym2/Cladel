import SmartToyIcon from "@mui/icons-material/SmartToy";
import { useAgentNodeStore } from "../../store/agentNodeStore";

export function ProcessingIndicator({ nodeId }: { nodeId: string }) {
  const processing = useAgentNodeStore((s) => s.processingNodes.has(nodeId));
  if (!processing) return null;

  return (
    <>
      <style>{spinKeyframes}</style>
      <div style={containerStyle}>
        <SmartToyIcon sx={{ fontSize: 14, color: "#f59e0b", animation: "agentSpin 1.2s linear infinite" }} />
      </div>
    </>
  );
}

const spinKeyframes = `
@keyframes agentSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

const containerStyle: React.CSSProperties = {
  position: "absolute",
  top: 6,
  left: 6,
  width: 22,
  height: 22,
  borderRadius: "50%",
  background: "rgba(245, 158, 11, 0.15)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2,
};

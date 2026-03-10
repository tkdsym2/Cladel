import PersonIcon from "@mui/icons-material/Person";
import { useUserStore } from "../../store/userStore";
import { useAgentNodeStore } from "../../store/agentNodeStore";

interface Props {
  nodeId: string;
  creatorUserId: string | null | undefined;
  creatorUserName: string | null | undefined;
  dark?: boolean;
}

export function CreatorLabel({ nodeId, creatorUserId, creatorUserName, dark }: Props) {
  const userId = useUserStore((s) => s.userId);
  const processing = useAgentNodeStore((s) => s.processingNodes.has(nodeId));

  // Hide during agent processing to avoid overlap with ProcessingIndicator
  if (processing) return null;

  let displayName = "Unknown";
  if (creatorUserId && userId && creatorUserId === userId) {
    displayName = "You";
  } else if (creatorUserName) {
    displayName = creatorUserName;
  }

  const color = dark ? "rgba(255,255,255,0.4)" : "#9ca3af";

  return (
    <div style={{ ...creatorStyle, color }}>
      <PersonIcon sx={{ fontSize: 12, color }} />
      <span>{displayName}</span>
    </div>
  );
}

const creatorStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 2,
  fontSize: 10,
  marginTop: 2,
  lineHeight: 1,
  pointerEvents: "none",
  flexShrink: 0,
};

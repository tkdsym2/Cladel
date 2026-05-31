import { useState, useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import LayersIcon from "@mui/icons-material/Layers";
import { useGraphStore } from "../../store/graphStore";
import { GroupNamePopover } from "./GroupNamePopover";
import { useT } from "../../lib/i18n";

export function GroupingButton() {
  const t = useT();
  const nodes = useGraphStore((s) => s.nodes);
  const { flowToScreenPosition } = useReactFlow();
  const [showPopover, setShowPopover] = useState(false);

  const selectedPaperNodes = useMemo(
    () => nodes.filter((n) => n.selected && n.type === "paper" && !n.parentId),
    [nodes],
  );

  const screenPos = useMemo(() => {
    if (selectedPaperNodes.length < 2) return null;
    // Find rightmost selected paper
    let maxX = -Infinity;
    let avgY = 0;
    for (const n of selectedPaperNodes) {
      const w = n.measured?.width ?? n.width ?? 280;
      const right = n.position.x + w;
      if (right > maxX) maxX = right;
      avgY += n.position.y + (n.measured?.height ?? n.height ?? 210) / 2;
    }
    avgY /= selectedPaperNodes.length;
    return flowToScreenPosition({ x: maxX + 20, y: avgY - 16 });
  }, [selectedPaperNodes, flowToScreenPosition]);

  if (selectedPaperNodes.length < 2 || !screenPos) return null;

  const memberIds = selectedPaperNodes.map((n) => n.id);

  return (
    <>
      <button
        onClick={() => setShowPopover(true)}
        style={{
          position: "fixed",
          left: screenPos.x,
          top: screenPos.y,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 12px",
          background: "#059669",
          color: "#fff",
          border: "none",
          borderRadius: 16,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          whiteSpace: "nowrap",
        }}
      >
        <LayersIcon sx={{ fontSize: 14 }} />
        {t({ en: "Group ({count})", ja: "グループ化 ({count})" }, { count: selectedPaperNodes.length })}
      </button>

      {showPopover && (
        <GroupNamePopover
          position={{ x: screenPos.x, y: screenPos.y + 40 }}
          memberIds={memberIds}
          onClose={() => setShowPopover(false)}
        />
      )}
    </>
  );
}

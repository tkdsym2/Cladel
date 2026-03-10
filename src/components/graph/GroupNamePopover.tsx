import { useState, useCallback, useRef, useEffect } from "react";
import { useGraphStore } from "../../store/graphStore";
import { useLayerStore } from "../../store/layerStore";

interface GroupNamePopoverProps {
  position: { x: number; y: number };
  memberIds: string[];
  onClose: () => void;
}

export function GroupNamePopover({ position, memberIds, onClose }: GroupNamePopoverProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const createPaperGroup = useGraphStore((s) => s.createPaperGroup);
  const currentLayer = useLayerStore((s) => s.currentLayer);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleConfirm = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || !currentLayer) return;
    await createPaperGroup(currentLayer.id, trimmed, memberIds);
    onClose();
  }, [name, currentLayer, memberIds, createPaperGroup, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [handleConfirm, onClose],
  );

  return (
    <div
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 51,
        background: "#f5f5f5",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        padding: 12,
        minWidth: 200,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
        Group Name
      </div>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter group name..."
        style={{
          width: "100%",
          padding: "6px 8px",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          fontSize: 13,
          outline: "none",
          boxSizing: "border-box",
          marginBottom: 8,
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button onClick={onClose} style={cancelBtnStyle}>
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!name.trim()}
          style={{
            ...confirmBtnStyle,
            opacity: name.trim() ? 1 : 0.5,
          }}
        >
          Create Group
        </button>
      </div>
    </div>
  );
}

const cancelBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  background: "#fff",
  fontSize: 12,
  cursor: "pointer",
  color: "#374151",
};

const confirmBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  border: "none",
  borderRadius: 4,
  background: "#059669",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

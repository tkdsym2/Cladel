import { useRef, useEffect, useState, useCallback, type MouseEvent } from "react";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import type { LayerData } from "../../types";

interface Props {
  layers: LayerData[];
  currentLayer: LayerData | null;
  onSwitchLayer: (layerId: string) => void;
  onNewLayer: () => void;
  onDeleteLayer: (layerId: string) => void;
  onExportBibtex: () => void;
  onClose?: () => void;
}

export function LayerBar({
  layers,
  currentLayer,
  onSwitchLayer,
  onNewLayer,
  onDeleteLayer,
  onExportBibtex,
  onClose,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [confirmLayerId, setConfirmLayerId] = useState<string | null>(null);

  // Scroll the active card into view when it changes
  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [currentLayer?.id]);

  const confirmLayer = confirmLayerId
    ? layers.find((l) => l.id === confirmLayerId)
    : null;

  const handleDeleteClick = useCallback((e: MouseEvent, layerId: string) => {
    e.stopPropagation();
    setConfirmLayerId(layerId);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (confirmLayerId) {
      onDeleteLayer(confirmLayerId);
      setConfirmLayerId(null);
    }
  }, [confirmLayerId, onDeleteLayer]);

  // Reverse layers so highest layer_number is at the top
  const sortedLayers = [...layers].sort(
    (a, b) => b.layer_number - a.layer_number,
  );

  return (
    <>
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ ...headerStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={headerLabelStyle}>Layers</span>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "#9ca3af",
                padding: "0 2px",
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
              }}
              title="Hide layers"
            >
              <CloseIcon sx={{ fontSize: 14 }} />
            </button>
          )}
        </div>

        {/* Add Layer button */}
        <button onClick={onNewLayer} style={addLayerBtnStyle} title="Create new layer">
          <AddIcon sx={{ fontSize: 14, mr: "2px" }} /> Add Layer
        </button>

        {/* Scrollable layer list */}
        <div ref={scrollRef} style={listContainerStyle}>
          {sortedLayers.map((layer) => {
            const isActive = currentLayer?.id === layer.id;
            return (
              <button
                key={layer.id}
                ref={isActive ? activeRef : undefined}
                onClick={() => onSwitchLayer(layer.id)}
                style={{
                  ...cardStyle,
                  ...(isActive ? activeCardStyle : inactiveCardStyle),
                }}
                title={`Layer ${layer.layer_number} — created ${new Date(layer.created_at).toLocaleDateString()}`}
              >
                <span style={cardLabelStyle}>Layer {layer.layer_number}</span>
                {layer.layer_number !== 1 && (
                  <span
                    onClick={(e) => handleDeleteClick(e, layer.id)}
                    style={deleteIconStyle}
                    title="Delete layer"
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Divider + Export */}
        <div style={exportSectionStyle}>
          <div style={dividerStyle} />
          <button onClick={onExportBibtex} style={exportBtnStyle} title="Export BibTeX references">
            Export .bib
          </button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {confirmLayer && (
        <div style={overlayStyle} onClick={() => setConfirmLayerId(null)}>
          <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
              Delete Layer {confirmLayer.layer_number}?
            </div>
            <div style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.5, marginBottom: 16 }}>
              All nodes and edges in this layer will be permanently deleted. This cannot be undone.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setConfirmLayerId(null)}
                style={cancelBtnStyle}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                style={deleteBtnStyle}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const panelStyle: React.CSSProperties = {
  width: 160,
  minWidth: 160,
  maxWidth: 160,
  display: "flex",
  flexDirection: "column",
  background: "#f9fafb",
  borderRight: "1px solid #e5e7eb",
  flexShrink: 0,
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  padding: "10px 12px 6px",
  flexShrink: 0,
};

const headerLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const addLayerBtnStyle: React.CSSProperties = {
  margin: "0 10px 8px",
  padding: "6px 0",
  fontSize: 12,
  fontWeight: 500,
  color: "#1e40af",
  background: "transparent",
  border: "1px dashed #93c5fd",
  borderRadius: 6,
  cursor: "pointer",
  flexShrink: 0,
};

const listContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "0 10px 10px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const cardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "7px 10px",
  fontSize: 12,
  fontWeight: 500,
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
  boxSizing: "border-box",
};

const activeCardStyle: React.CSSProperties = {
  background: "#ffffff",
  color: "#1e40af",
  fontWeight: 600,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 0 0 1px rgba(30,64,175,0.15)",
};

const inactiveCardStyle: React.CSSProperties = {
  background: "transparent",
  color: "#6b7280",
};

const cardLabelStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  flex: 1,
};

const deleteIconStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1,
  color: "#9ca3af",
  cursor: "pointer",
  padding: "0 2px",
  borderRadius: 3,
  flexShrink: 0,
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 10,
  padding: "20px 24px",
  width: 380,
  boxShadow: "0 8px 30px rgba(0, 0, 0, 0.15)",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 500,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  background: "#ffffff",
  color: "#374151",
  cursor: "pointer",
};

const deleteBtnStyle: React.CSSProperties = {
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 600,
  border: "none",
  borderRadius: 6,
  background: "#dc2626",
  color: "#ffffff",
  cursor: "pointer",
};

const exportSectionStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "0 10px 10px",
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: "#e5e7eb",
  marginBottom: 8,
};

const exportBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 0",
  fontSize: 12,
  fontWeight: 500,
  color: "#374151",
  background: "#ffffff",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  cursor: "pointer",
};

import { useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps, type Node } from "@xyflow/react";
import FileUploadIcon from "@mui/icons-material/FileUpload";

type ImportNodeData = {
  [key: string]: unknown;
};

export function ImportNode({ id, selected }: NodeProps<Node<ImportNodeData>>) {
  // Only the center button (or a drag-and-drop onto the canvas) triggers the import
  // dialog. The node body itself stays draggable / selectable / resizable like any
  // other node, so it can be moved, resized, and deleted.
  const handleSelectFile = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selectedPath = await open({
          title: "Select file to import",
          filters: [
            {
              name: "Supported Files",
              extensions: [
                "pdf",
                "png", "jpg", "jpeg", "svg", "gif", "webp", "bmp", "tiff", "tif", "ico",
              ],
            },
          ],
          multiple: false,
        });
        if (selectedPath) {
          window.dispatchEvent(
            new CustomEvent("import-node-file-selected", {
              detail: { nodeId: id, filePath: selectedPath },
            }),
          );
        }
      } catch (err) {
        console.error("File dialog error:", err);
      }
    },
    [id],
  );

  return (
    <>
      <NodeResizer
        minWidth={180}
        minHeight={135}
        isVisible={selected}
        lineStyle={resizerLineStyle}
        handleStyle={resizerHandleStyle}
      />
      <div style={containerStyle(selected)}>
        <div style={contentStyle}>
          <FileUploadIcon sx={{ fontSize: 28, color: "#9ca3af" }} />
          <button
            type="button"
            className="nodrag"
            onClick={handleSelectFile}
            style={buttonStyle}
          >
            Select file
          </button>
          <span style={hintStyle}>or drag &amp; drop a PDF / Image</span>
        </div>
        <Handle type="source" position={Position.Right} id="right" style={handleStyle} />
        <Handle type="target" position={Position.Right} id="right-target" style={handleStyle} />
        <Handle type="source" position={Position.Left} id="left" style={handleStyle} />
        <Handle type="target" position={Position.Left} id="left-target" style={handleStyle} />
      </div>
    </>
  );
}

function containerStyle(selected: boolean | undefined): React.CSSProperties {
  return {
    background: "rgba(156,163,175,0.06)",
    border: selected ? "2px dashed #6b7280" : "2px dashed #9ca3af",
    color: "#6b7280",
    fontSize: "13px",
    minWidth: "180px",
    width: "100%",
    height: "100%",
    borderRadius: "8px",
    padding: "10px 14px",
    userSelect: "none",
    boxSizing: "border-box",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    cursor: "default",
    boxShadow: selected
      ? "0 0 0 2px rgba(107,114,128,0.3)"
      : "0 1px 4px rgba(0,0,0,0.05)",
  };
}

const contentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
};

const buttonStyle: React.CSSProperties = {
  cursor: "pointer",
  background: "#fff",
  border: "1px solid #9ca3af",
  borderRadius: 6,
  padding: "6px 16px",
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#9ca3af",
};

const handleStyle: React.CSSProperties = {
  width: 8,
  height: "40%",
  minHeight: 16,
  borderRadius: 4,
  background: "#9ca3af",
  border: "2px solid rgba(156,163,175,0.15)",
};

const resizerLineStyle: React.CSSProperties = {
  borderColor: "rgba(107,114,128,0.4)",
};

const resizerHandleStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 2,
  backgroundColor: "#6b7280",
  border: "1px solid #4b5563",
};

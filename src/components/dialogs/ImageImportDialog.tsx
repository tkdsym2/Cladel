import { useState, useCallback, useRef } from "react";
import CloseIcon from "@mui/icons-material/Close";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useLayerStore } from "../../store/layerStore";
import { useGraphStore } from "../../store/graphStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUserStore } from "../../store/userStore";
import * as cmd from "../../lib/tauri-commands";
import type { ImageFileInfo } from "../../types";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "svg", "gif", "webp", "bmp", "tif", "tiff", "ico"];

interface ImageImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-filled file path from drag-and-drop */
  dropFilePath?: string | null;
  /** Override the default node placement position */
  positionOverride?: { x: number; y: number } | null;
  /** Called after the image node is successfully created, with the new node ID */
  onImportSuccess?: (nodeId: string) => void;
}

type DialogState = "drop" | "preview";

export function ImageImportDialog({ open, onClose, dropFilePath, positionOverride, onImportSuccess }: ImageImportDialogProps) {
  const [state, setState] = useState<DialogState>(dropFilePath ? "preview" : "drop");
  const [imageInfo, setImageInfo] = useState<ImageFileInfo | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const initializedRef = useRef(false);

  const currentLayer = useLayerStore((s) => s.currentLayer);
  const loadGraph = useGraphStore((s) => s.loadGraph);

  // Handle drop file path on open
  if (dropFilePath && !initializedRef.current) {
    initializedRef.current = true;
    validateAndPreview(dropFilePath);
  }

  async function validateAndPreview(filePath: string) {
    setError(null);
    try {
      const info = await cmd.validateImageFile(filePath);
      setImageInfo(info);
      setPreviewSrc(convertFileSrc(filePath));
      // Default title: filename without extension
      const nameWithoutExt = info.original_filename.replace(/\.[^.]+$/, "");
      setTitle(nameWithoutExt);
      setDescription("");
      setState("preview");
    } catch (err) {
      setError(String(err));
    }
  }

  const handleBrowse = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "Select an image file",
        filters: [
          {
            name: "Images",
            extensions: IMAGE_EXTENSIONS,
          },
        ],
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        await validateAndPreview(selected);
      }
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!imageInfo || !currentLayer || creating) return;
    setCreating(true);
    setError(null);
    try {
      const prefs = useSettingsStore.getState().uiPreferences;
      const posX = positionOverride?.x ?? 200;
      const posY = positionOverride?.y ?? 200;
      const newNodeId = await cmd.createImageNode(
        currentLayer.id,
        title || imageInfo.original_filename,
        description || null,
        posX,
        posY,
        prefs.image_default_width,
        prefs.image_default_height,
        imageInfo.file_path,
        imageInfo.mime_type,
        imageInfo.original_filename,
        imageInfo.image_width,
        imageInfo.image_height,
        useUserStore.getState().userId,
        useUserStore.getState().userName,
      );
      onImportSuccess?.(newNodeId);
      // Reload graph to show new node
      await loadGraph(currentLayer.id);
      handleClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }, [imageInfo, currentLayer, title, description, creating, loadGraph, positionOverride, onImportSuccess]);

  const handleClose = useCallback(() => {
    setState("drop");
    setImageInfo(null);
    setPreviewSrc(null);
    setTitle("");
    setDescription("");
    setError(null);
    setCreating(false);
    setDragOver(false);
    initializedRef.current = false;
    onClose();
  }, [onClose]);

  const handleBack = useCallback(() => {
    setState("drop");
    setImageInfo(null);
    setPreviewSrc(null);
    setTitle("");
    setDescription("");
    setError(null);
  }, []);

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Import Image</span>
          <button onClick={handleClose} style={closeBtnStyle}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={errorStyle}>{error}</div>
        )}

        {/* Drop zone state */}
        {state === "drop" && (
          <div
            style={{
              ...dropZoneStyle,
              borderColor: dragOver ? "#0891b2" : "#d1d5db",
              background: dragOver ? "rgba(8, 145, 178, 0.05)" : "#fafafa",
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
          >
            <AddPhotoAlternateIcon sx={{ fontSize: 40, color: "#9ca3af", mb: 1 }} />
            <div style={{ fontSize: 14, fontWeight: 500, color: "#6b7280", marginBottom: 4 }}>
              Drag & drop an image here
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 12 }}>
              PNG, JPEG, SVG, GIF, WebP, BMP, TIFF, ICO
            </div>
            <button onClick={handleBrowse} style={browseBtnStyle}>
              Browse Files
            </button>
          </div>
        )}

        {/* Preview state */}
        {state === "preview" && imageInfo && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Image preview */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                maxHeight: 200,
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                overflow: "hidden",
                background: "#f9fafb",
              }}
            >
              {previewSrc && (
                <img
                  src={previewSrc}
                  alt="Preview"
                  style={{ maxWidth: "100%", maxHeight: 200, objectFit: "contain" }}
                />
              )}
            </div>

            {/* File info */}
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              {imageInfo.original_filename}
              {imageInfo.image_width && imageInfo.image_height && (
                <span> ({imageInfo.image_width} x {imageInfo.image_height})</span>
              )}
            </div>

            {/* Title input */}
            <div>
              <label style={labelStyle}>Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={inputStyle}
                placeholder="Image title"
              />
            </div>

            {/* Description input */}
            <div>
              <label style={labelStyle}>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={textareaStyle}
                placeholder="Optional description..."
                rows={2}
              />
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={handleBack} style={backBtnStyle}>
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={creating}
                style={{
                  ...confirmBtnStyle,
                  opacity: creating ? 0.6 : 1,
                  cursor: creating ? "default" : "pointer",
                }}
              >
                {creating ? "Adding..." : "Add to Graph"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2000,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialogStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 12,
  boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  width: 440,
  maxHeight: "80vh",
  overflow: "auto",
  padding: 20,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
};

const closeBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "#9ca3af",
  lineHeight: 1,
  padding: 2,
};

const errorStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "#fef2f2",
  color: "#dc2626",
  borderRadius: 6,
  fontSize: 12,
  marginBottom: 12,
};

const dropZoneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "40px 20px",
  border: "2px dashed #d1d5db",
  borderRadius: 10,
  cursor: "default",
  transition: "border-color 0.15s, background 0.15s",
};

const browseBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "#0891b2",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "8px 10px",
  boxSizing: "border-box",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: 8,
  boxSizing: "border-box",
  resize: "none",
  fontFamily: "inherit",
};

const backBtnStyle: React.CSSProperties = {
  padding: "8px 18px",
  background: "#ffffff",
  color: "#6b7280",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const confirmBtnStyle: React.CSSProperties = {
  padding: "8px 18px",
  background: "#0891b2",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

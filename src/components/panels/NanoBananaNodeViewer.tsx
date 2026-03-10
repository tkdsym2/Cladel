import { useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import type { NodeData, NanoBananaMetadata } from "../../types";
import { useGraphStore } from "../../store/graphStore";
import { useAgentNodeStore } from "../../store/agentNodeStore";
import { useSettingsStore } from "../../store/settingsStore";
import * as cmd from "../../lib/tauri-commands";

interface NanoBananaNodeViewerProps {
  node: NodeData;
}

const ASPECT_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"] as const;

function parseMeta(node: NodeData): NanoBananaMetadata {
  try {
    return node.metadata ? JSON.parse(node.metadata) : {};
  } catch {
    return {};
  }
}

export function NanoBananaNodeViewer({ node }: NanoBananaNodeViewerProps) {
  const updateNodeContent = useGraphStore((s) => s.updateNodeContent);
  const setProcessing = useAgentNodeStore((s) => s.setProcessing);
  const setError = useAgentNodeStore((s) => s.setError);
  const geminiApiKeyStatus = useSettingsStore((s) => s.geminiApiKeyStatus);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const loadGeminiApiKeyStatus = useSettingsStore((s) => s.loadGeminiApiKeyStatus);

  const meta = parseMeta(node);

  const [prompt, setPrompt] = useState(meta.prompt ?? "");
  const [aspectRatio, setAspectRatio] = useState(meta.aspect_ratio ?? "1:1");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setLocalError] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  // Load Gemini API key status on mount
  useEffect(() => {
    loadGeminiApiKeyStatus();
  }, [loadGeminiApiKeyStatus]);

  // Sync prompt/aspect from node metadata when node changes
  useEffect(() => {
    const m = parseMeta(node);
    setPrompt(m.prompt ?? "");
    setAspectRatio(m.aspect_ratio ?? "1:1");
  }, [node.id, node.metadata]);

  // Load image preview
  useEffect(() => {
    if (!meta.file_path) {
      setImageSrc(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const exists = await cmd.checkFileExists(meta.file_path!);
        if (cancelled) return;
        if (exists) {
          setImageSrc(convertFileSrc(meta.file_path!));
        } else {
          setImageSrc(null);
        }
      } catch {
        if (!cancelled) setImageSrc(null);
      }
    })();
    return () => { cancelled = true; };
  }, [meta.file_path]);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setLocalError(null);
    setProcessing(node.id, true);
    setError(node.id, null);

    try {
      const result = await cmd.generateNanoBananaImage(
        node.id,
        node.layer_id,
        prompt.trim(),
        aspectRatio,
      );

      // The backend already updated node metadata in DB.
      // Update the frontend store to reflect the change.
      const newMeta: NanoBananaMetadata = {
        prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
        model: "gemini-2.5-flash-image",
        generated_at: new Date().toISOString(),
        file_path: result.file_path,
        description: result.description ?? undefined,
      };
      await updateNodeContent(node.id, { metadata: JSON.stringify(newMeta) });

      // Update local image preview
      setImageSrc(convertFileSrc(result.file_path));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(msg);
      setError(node.id, msg);
    } finally {
      setIsGenerating(false);
      setProcessing(node.id, false);
    }
  };

  const hasApiKey = geminiApiKeyStatus !== null;

  return (
    <div style={containerStyle}>
      {/* Image Preview */}
      <div style={previewAreaStyle}>
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={node.title}
            style={previewImageStyle}
            draggable={false}
          />
        ) : (
          <div style={emptyStateStyle}>
            <span style={{ fontSize: 40 }}>{"\uD83C\uDF4C"}</span>
            <span style={{ fontSize: 13, color: "#78716c" }}>
              No image generated yet. Enter a prompt below to get started.
            </span>
          </div>
        )}
      </div>

      {/* API Key Missing State */}
      {!hasApiKey ? (
        <div style={apiKeyMissingStyle}>
          <div style={{ fontSize: 13, color: "#78716c", marginBottom: 8 }}>
            Gemini API key is required for Nano Banana image generation.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => window.open("https://aistudio.google.com/apikey", "_blank")}
              style={secondaryBtnStyle}
            >
              {"Get API Key \u2192"}
            </button>
            <button onClick={openSettings} style={secondaryBtnStyle}>
              Open Settings
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Prompt Input */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to generate..."
              rows={3}
              style={textareaStyle}
              disabled={isGenerating}
            />
          </div>

          {/* Aspect Ratio Selector */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Aspect Ratio</label>
            <div style={ratioRowStyle}>
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r}
                  onClick={() => setAspectRatio(r)}
                  style={aspectRatio === r ? ratioActiveStyle : ratioStyle}
                  disabled={isGenerating}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            style={!prompt.trim() || isGenerating ? generateBtnDisabledStyle : generateBtnStyle}
          >
            {isGenerating ? (
              <>
                <AutoAwesomeIcon sx={{ fontSize: 16, animation: "spin 1.2s linear infinite" }} />
                Generating...
              </>
            ) : (
              <>
                <AutoAwesomeIcon sx={{ fontSize: 16 }} />
                Generate Image
              </>
            )}
          </button>

          {/* Error */}
          {error && <div style={errorStyle}>{error}</div>}
        </>
      )}

      {/* Generation Info */}
      {meta.generated_at && (
        <div style={infoStyle}>
          <div style={infoRowStyle}>
            <span style={infoLabelStyle}>Model</span>
            <span>{meta.model ?? "gemini-2.5-flash-image"}</span>
          </div>
          <div style={infoRowStyle}>
            <span style={infoLabelStyle}>Aspect Ratio</span>
            <span>{meta.aspect_ratio ?? "1:1"}</span>
          </div>
          <div style={infoRowStyle}>
            <span style={infoLabelStyle}>Generated</span>
            <span>{new Date(meta.generated_at).toLocaleString()}</span>
          </div>
          {meta.description && (
            <div style={{ marginTop: 6 }}>
              <span style={infoLabelStyle}>Description</span>
              <div style={{ fontSize: 12, color: "#374151", marginTop: 2 }}>
                {meta.description}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Styles ───

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "8px 0",
};

const previewAreaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 180,
  background: "#fefce8",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
};

const previewImageStyle: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: 400,
  objectFit: "contain",
};

const emptyStateStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  padding: 24,
  textAlign: "center",
};

const apiKeyMissingStyle: React.CSSProperties = {
  background: "#fffbeb",
  border: "1px solid #fbbf24",
  borderRadius: 8,
  padding: 16,
  textAlign: "center",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
  resize: "vertical",
  outline: "none",
  boxSizing: "border-box",
};

const ratioRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

const ratioStyle: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  border: "1px solid #d1d5db",
  borderRadius: 4,
  background: "#fff",
  cursor: "pointer",
  color: "#374151",
};

const ratioActiveStyle: React.CSSProperties = {
  ...ratioStyle,
  border: "1px solid #ca8a04",
  background: "#fefce8",
  fontWeight: 600,
  color: "#92400e",
};

const generateBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "8px 16px",
  background: "#ca8a04",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const generateBtnDisabledStyle: React.CSSProperties = {
  ...generateBtnStyle,
  background: "#d1d5db",
  cursor: "not-allowed",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
  color: "#374151",
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#dc2626",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: 6,
  padding: "6px 10px",
};

const infoStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 11,
  color: "#6b7280",
};

const infoRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 2,
};

const infoLabelStyle: React.CSSProperties = {
  fontWeight: 600,
  color: "#9ca3af",
};

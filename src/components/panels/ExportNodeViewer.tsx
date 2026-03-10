import { useState, useEffect, useCallback, useRef } from "react";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DescriptionIcon from "@mui/icons-material/Description";
import ImageIcon from "@mui/icons-material/Image";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import TuneIcon from "@mui/icons-material/Tune";
import TitleIcon from "@mui/icons-material/Title";
import type { NodeData, ExportPreview, ExportStyleConfig } from "../../types";
import { DEFAULT_EXPORT_STYLE } from "../../types";
import { useGraphStore } from "../../store/graphStore";
import { useExportStore, type ExportProgress } from "../../store/exportStore";
import * as cmd from "../../lib/tauri-commands";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { ExportStyleConfigDialog } from "../dialogs/ExportStyleConfigDialog";
import { emitExportStarted, emitExportFinished } from "../../lib/sync-events";

interface ExportNodeViewerProps {
  node: NodeData;
}

export function ExportNodeViewer({ node }: ExportNodeViewerProps) {
  const updateNodeContent = useGraphStore((s) => s.updateNodeContent);

  const [title, setTitle] = useState(node.title);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [citationStyle, setCitationStyle] = useState("ieee");
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  const [styleDialogOpen, setStyleDialogOpen] = useState(false);
  const [styleConfig, setStyleConfig] = useState<ExportStyleConfig>(DEFAULT_EXPORT_STYLE);

  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load preview on mount and when node changes
  useEffect(() => {
    loadPreview();
  }, [node.id]);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cmd.getExportSections(node.id);
      setPreview(result);
      setCitationStyle(result.citation_style);
      setLanguage(result.language);
      setStyleConfig(result.style_config ?? DEFAULT_EXPORT_STYLE);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [node.id]);

  // Title change with debounce
  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      titleTimerRef.current = setTimeout(() => {
        updateNodeContent(node.id, { title: newTitle });
      }, 800);
    },
    [node.id, updateNodeContent],
  );

  // Update title when node changes externally
  useEffect(() => {
    setTitle(node.title);
  }, [node.title]);

  // Citation style change
  const handleStyleChange = useCallback(
    async (style: string) => {
      setCitationStyle(style);
      try {
        await cmd.updateExportCitationStyle(node.id, style);
        loadPreview();
      } catch (err) {
        console.error("Failed to update citation style:", err);
      }
    },
    [node.id, loadPreview],
  );

  // Language change
  const handleLanguageChange = useCallback(
    async (lang: string) => {
      setLanguage(lang);
      try {
        await cmd.updateExportLanguage(node.id, lang);
      } catch (err) {
        console.error("Failed to update language:", err);
      }
    },
    [node.id],
  );

  // Reorder sections
  const handleMoveSection = useCallback(
    async (index: number, direction: "up" | "down") => {
      if (!preview) return;
      const sections = [...preview.sections];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= sections.length) return;

      // Swap
      [sections[index], sections[targetIndex]] = [sections[targetIndex], sections[index]];

      const newOrder = sections.map((s) => s.node_id);
      try {
        await cmd.updateExportSectionOrder(node.id, newOrder);
        setPreview({ ...preview, sections });
      } catch (err) {
        console.error("Failed to reorder sections:", err);
      }
    },
    [node.id, preview],
  );

  // Generate PDF
  const handleGeneratePdf = useCallback(async () => {
    setError(null);
    try {
      const path = await save({
        title: "Export PDF",
        defaultPath: `${title || "export"}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!path) return;

      setGenerating(true);

      // 1. Show overlay IMMEDIATELY via synchronous Zustand update (same window)
      useExportStore.getState().startSelfExport();

      // 2. Notify other windows via cross-window event
      emitExportStarted();

      // 3. Register progress listener (fire-and-forget, no await)
      //    The listener IPC registers faster than generateExportPdf's
      //    IPC round-trip, so no progress events are missed.
      const progressUnlistenRef: { current: (() => void) | null } = { current: null };
      listen<ExportProgress>("export-progress", (event) => {
        useExportStore.getState().setProgress(event.payload);
      }).then((fn) => { progressUnlistenRef.current = fn; });

      // 4. Start generation — first await point, React renders overlay here
      let exportErr: string | null = null;
      try {
        const result = await cmd.generateExportPdf(node.id, path);
        setLastExportPath(result);
        // Ensure progress shows done even if the event arrived before listener
        useExportStore.getState().finishSelfExport(null);
      } catch (err) {
        exportErr = String(err);
        setError(exportErr);
        useExportStore.getState().finishSelfExport(exportErr);
      } finally {
        if (progressUnlistenRef.current) progressUnlistenRef.current();
        emitExportFinished(exportErr);
        setGenerating(false);
      }
    } catch (err) {
      // save dialog error (unlikely)
      setError(String(err));
    }
  }, [node.id, title]);

  const handleOpenExported = useCallback(async () => {
    if (lastExportPath) {
      try {
        await cmd.openFileExternal(lastExportPath);
      } catch (err) {
        console.error("Failed to open file:", err);
      }
    }
  }, [lastExportPath]);

  return (
    <div style={containerStyle}>
      {/* Title editor */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          style={inputStyle}
          placeholder="Export document title"
        />
      </div>

      {/* Connected Title Node indicator */}
      {preview && preview.title_page && preview.title_page.authors.length > 0 && (
        <div style={titleNodeInfoStyle}>
          <TitleIcon sx={{ fontSize: 14, color: "#78716c" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Title node connected</span>
            {preview.title_page.subtitle && (
              <div style={{ fontSize: 11, color: "#6b7280" }}>{preview.title_page.subtitle}</div>
            )}
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              {preview.title_page.authors.map((a) => a.name).join(", ")}
            </div>
          </div>
        </div>
      )}

      {/* Citation style */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Citation Style</label>
        <div style={radioGroupStyle}>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="citationStyle"
              value="ieee"
              checked={citationStyle === "ieee"}
              onChange={() => handleStyleChange("ieee")}
            />
            <span>IEEE [1]</span>
          </label>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="citationStyle"
              value="apa"
              checked={citationStyle === "apa"}
              onChange={() => handleStyleChange("apa")}
            />
            <span>APA (Author, Year)</span>
          </label>
        </div>
      </div>

      {/* Language */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Language</label>
        <div style={radioGroupStyle}>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="language"
              value="en"
              checked={language === "en"}
              onChange={() => handleLanguageChange("en")}
            />
            <span>English</span>
          </label>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="language"
              value="ja"
              checked={language === "ja"}
              onChange={() => handleLanguageChange("ja")}
            />
            <span>日本語</span>
          </label>
        </div>
      </div>

      {/* PDF Style Settings */}
      <div style={sectionStyle}>
        <button
          onClick={() => setStyleDialogOpen(true)}
          style={styleSettingsBtnStyle}
        >
          <TuneIcon sx={{ fontSize: 14 }} />
          PDF Style Settings
        </button>
      </div>

      {/* Sections */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <label style={labelStyle}>Sections</label>
          <button onClick={loadPreview} style={refreshBtnStyle} title="Refresh">
            ↻
          </button>
        </div>
        {loading && <div style={emptyStyle}>Loading...</div>}
        {!loading && preview && preview.sections.length === 0 && (
          <div style={emptyStyle}>
            No Edit nodes connected. Connect Edit nodes to define sections.
          </div>
        )}
        {!loading && preview && preview.sections.length > 0 && (
          <div style={listStyle}>
            {preview.sections.map((section, idx) => (
              <div key={section.node_id} style={sectionItemStyle}>
                <div style={sectionItemHeaderStyle}>
                  <span style={sectionNumStyle}>{idx + 1}.</span>
                  <div style={sectionInfoStyle}>
                    <span style={sectionTitleStyle}>{section.title}</span>
                    {section.display_id && (
                      <span style={sectionIdStyle}>{section.display_id}</span>
                    )}
                  </div>
                  <div style={arrowBtnGroupStyle}>
                    <button
                      onClick={() => handleMoveSection(idx, "up")}
                      disabled={idx === 0}
                      style={arrowBtnStyle}
                      title="Move up"
                    >
                      <ArrowUpwardIcon sx={{ fontSize: 14 }} />
                    </button>
                    <button
                      onClick={() => handleMoveSection(idx, "down")}
                      disabled={idx === preview.sections.length - 1}
                      style={arrowBtnStyle}
                      title="Move down"
                    >
                      <ArrowDownwardIcon sx={{ fontSize: 14 }} />
                    </button>
                  </div>
                </div>
                <div style={sectionPreviewStyle}>
                  {section.content.slice(0, 80)}
                  {section.content.length > 80 ? "..." : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* References summary */}
      {preview && preview.all_cited_papers.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>
            <DescriptionIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: "middle" }} />
            References ({preview.all_cited_papers.length})
          </label>
          <div style={listStyle}>
            {preview.all_cited_papers.map((paper) => (
              <div key={paper.node_id} style={refItemStyle}>
                <span style={refIdStyle}>{paper.display_id}</span>
                <span style={refTitleStyle}>{paper.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Images summary */}
      {preview && preview.all_referenced_images.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>
            <ImageIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: "middle" }} />
            Images ({preview.all_referenced_images.length})
          </label>
          <div style={listStyle}>
            {preview.all_referenced_images.map((img) => (
              <div key={img.node_id} style={refItemStyle}>
                <span style={refIdStyle}>{img.display_id}</span>
                <span style={refTitleStyle}>{img.title}</span>
                {!img.file_exists && (
                  <WarningAmberIcon
                    sx={{ fontSize: 14, color: "#f59e0b", ml: 0.5 }}
                    titleAccess="File not found"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={errorStyle}>{error}</div>
      )}

      {/* Generate PDF button */}
      <div style={sectionStyle}>
        <button
          onClick={handleGeneratePdf}
          disabled={generating || !preview || preview.sections.length === 0}
          style={generateBtnStyle}
        >
          {generating ? (
            "Generating..."
          ) : (
            <>
              <PictureAsPdfIcon sx={{ fontSize: 16, mr: 0.5 }} />
              Generate PDF
            </>
          )}
        </button>
      </div>

      {/* Last export path */}
      {lastExportPath && (
        <div style={successStyle}>
          <span style={{ fontSize: 12, color: "#059669" }}>PDF saved</span>
          <button onClick={handleOpenExported} style={openBtnStyle} title="Open exported file">
            <FolderOpenIcon sx={{ fontSize: 14 }} />
            Open
          </button>
        </div>
      )}

      {/* Style Config Dialog */}
      <ExportStyleConfigDialog
        open={styleDialogOpen}
        onClose={() => setStyleDialogOpen(false)}
        exportNodeId={node.id}
        preview={preview}
        styleConfig={styleConfig}
        onStyleChange={setStyleConfig}
      />
    </div>
  );
}

// ─── Styles ───

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: "8px 0",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  display: "flex",
  alignItems: "center",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  outline: "none",
  boxSizing: "border-box",
};

const radioGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 16,
};

const radioLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 13,
  cursor: "pointer",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const sectionItemStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "#f9fafb",
  borderRadius: 6,
  border: "1px solid #e5e7eb",
};

const sectionItemHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const sectionNumStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#e11d48",
  minWidth: 18,
};

const sectionInfoStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const sectionIdStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "monospace",
  color: "#9ca3af",
};

const sectionPreviewStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
  marginTop: 4,
  lineHeight: 1.4,
};

const arrowBtnGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
};

const arrowBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 2,
  borderRadius: 3,
  color: "#6b7280",
  display: "flex",
  alignItems: "center",
};

const refItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
  background: "#f9fafb",
  borderRadius: 4,
  fontSize: 12,
};

const refIdStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 10,
  color: "#e11d48",
  fontWeight: 600,
  flexShrink: 0,
};

const refTitleStyle: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#374151",
};

const emptyStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#9ca3af",
  fontStyle: "italic",
  padding: "8px 0",
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#dc2626",
  background: "#fef2f2",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #fecaca",
};

const generateBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  padding: "10px 16px",
  background: "#e11d48",
  color: "#ffffff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const successStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 10px",
  background: "#f0fdf4",
  borderRadius: 6,
  border: "1px solid #bbf7d0",
};

const openBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  background: "none",
  border: "1px solid #059669",
  borderRadius: 4,
  padding: "4px 8px",
  fontSize: 12,
  color: "#059669",
  cursor: "pointer",
};

const styleSettingsBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 500,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  background: "#f9fafb",
  cursor: "pointer",
  color: "#374151",
  width: "100%",
  justifyContent: "center",
};

const refreshBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 16,
  color: "#6b7280",
  padding: "2px 6px",
  borderRadius: 4,
};

const titleNodeInfoStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "8px 10px",
  background: "rgba(120,113,108,0.06)",
  borderRadius: 6,
  border: "1px solid rgba(120,113,108,0.2)",
};

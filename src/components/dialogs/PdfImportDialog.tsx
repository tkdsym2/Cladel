import { useState, useCallback, useEffect } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import CloseIcon from "@mui/icons-material/Close";
import DescriptionIcon from "@mui/icons-material/Description";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import EditNoteIcon from "@mui/icons-material/EditNote";
import * as cmd from "../../lib/tauri-commands";
import { useGraphStore } from "../../store/graphStore";
import { useLayerStore } from "../../store/layerStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { PdfMetadata } from "../../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** When provided, extraction starts immediately (e.g. from drag-and-drop) */
  initialFilePath?: string | null;
  /** Override the default node placement position */
  positionOverride?: { x: number; y: number } | null;
  /** Called after the paper node is successfully created, with the new node ID */
  onImportSuccess?: (nodeId: string) => void;
}

type DialogPhase = "idle" | "extracting" | "preview" | "success" | "error" | "manual-bibtex";

export function PdfImportDialog({ isOpen, onClose, initialFilePath, positionOverride, onImportSuccess }: Props) {
  const [phase, setPhase] = useState<DialogPhase>("idle");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<PdfMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [claudeExtracting, setClaudeExtracting] = useState(false);
  const [manualBibtex, setManualBibtex] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const addNode = useGraphStore((s) => s.addNode);
  const currentLayer = useLayerStore((s) => s.currentLayer);

  // If opened with a pre-selected file path (drag-drop), start extraction immediately
  useEffect(() => {
    if (isOpen && initialFilePath) {
      setFilePath(initialFilePath);
      doExtraction(initialFilePath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialFilePath]);

  const doExtraction = async (path: string) => {
    setPhase("extracting");
    setError(null);
    try {
      const result = await cmd.importPdf(path);
      setMetadata(result);
      setPhase("preview");
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  };

  const handleAskClaude = useCallback(async () => {
    if (!filePath) return;
    setClaudeExtracting(true);
    setError(null);
    try {
      const result = await cmd.extractPdfWithClaude(filePath);
      setMetadata(result);
      setPhase("preview");
    } catch (e) {
      setError(String(e));
    } finally {
      setClaudeExtracting(false);
    }
  }, [filePath]);

  const handleManualBibtexSubmit = useCallback(async () => {
    setManualError(null);
    const trimmed = manualBibtex.trim();
    if (!trimmed) {
      setManualError("Please paste a BibTeX entry");
      return;
    }
    try {
      const entries = await cmd.parseBibtex(trimmed);
      if (entries.length === 0) {
        setManualError("Could not parse any BibTeX entries. Check the format.");
        return;
      }
      const entry = entries[0];
      if (!entry.title && !entry.cite_key) {
        setManualError("BibTeX entry is missing both title and citation key.");
        return;
      }
      // Convert BibtexEntry → PdfMetadata for the preview phase
      const meta: PdfMetadata = {
        title: entry.title || entry.cite_key,
        authors: entry.authors,
        year: entry.year ?? null,
        abstract_text: entry.abstract_text ?? null,
        journal: entry.journal ?? entry.booktitle ?? null,
        doi: entry.doi ?? null,
        bibtex: entry.raw,
        extraction_method: "manual_bibtex",
      };
      setMetadata(meta);
      setPhase("preview");
    } catch (e) {
      setManualError(String(e));
    }
  }, [manualBibtex]);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        title: "Select PDF file",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        setFilePath(selected);
        doExtraction(selected);
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleAddToGraph = useCallback(async () => {
    if (!metadata || !currentLayer) return;
    setImporting(true);
    setError(null);
    try {
      let posX: number;
      let posY: number;
      if (positionOverride) {
        posX = positionOverride.x;
        posY = positionOverride.y;
      } else {
        const existingNodes = useGraphStore.getState().dbNodes;
        posX = 100;
        posY = 200;
        if (existingNodes.length > 0) {
          const maxY = Math.max(...existingNodes.map((n) => n.position_y));
          posY = maxY + 220;
        }
      }

      const nodeMetadata = JSON.stringify({
        authors: metadata.authors,
        year: metadata.year,
        journal: metadata.journal,
        doi: metadata.doi,
        extraction_method: metadata.extraction_method,
      });

      const prefs = useSettingsStore.getState().uiPreferences;
      const nodeData = await addNode({
        layer_id: currentLayer.id,
        node_type: "paper",
        title: metadata.title || "Untitled Paper",
        content: metadata.abstract_text,
        bibtex: metadata.bibtex,
        metadata: nodeMetadata,
        position_x: posX,
        position_y: posY,
        width: prefs.paper_default_width,
        height: prefs.paper_default_height,
      });

      // Store the PDF file path on the newly created node
      if (filePath) {
        await cmd.setPaperPdfPath(nodeData.id, filePath);
        // Re-fetch so the store has the updated pdf_path
        await useGraphStore.getState().refreshNode(nodeData.id);
      }

      onImportSuccess?.(nodeData.id);
      setPhase("success");
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }, [metadata, currentLayer, addNode, positionOverride, onImportSuccess]);

  const handleClose = useCallback(() => {
    setPhase("idle");
    setFilePath(null);
    setMetadata(null);
    setError(null);
    setImporting(false);
    setClaudeExtracting(false);
    setManualBibtex("");
    setManualError(null);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  // ── Success screen ──
  if (phase === "success") {
    return (
      <div style={overlayStyle}>
        <div style={{ ...dialogStyle, width: 420 }}>
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <CheckCircleIcon sx={{ fontSize: 40, mb: "12px", color: "#059669" }} />
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "#111827",
                marginBottom: 8,
              }}
            >
              Paper Imported
            </div>
            <div
              style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}
            >
              A new Paper node has been added to your graph.
            </div>
            <button onClick={handleClose} style={primaryBtnStyle}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: "#111827",
            }}
          >
            Import Paper (PDF)
          </h2>
          <button onClick={handleClose} style={closeButtonStyle}>
            <CloseIcon sx={{ fontSize: 22 }} />
          </button>
        </div>

        {/* ── Idle: file selection ── */}
        {phase === "idle" && (
          <>
            <div style={dropZoneStyle}>
              <DescriptionIcon sx={{ fontSize: 36, mb: "12px", color: "#9ca3af" }} />
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "#374151",
                  marginBottom: 4,
                }}
              >
                Select a PDF file to import
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "#9ca3af",
                  marginBottom: 16,
                }}
              >
                Metadata will be extracted automatically via DOI lookup and AI
              </div>
              <button onClick={handleBrowse} style={primaryBtnStyle}>
                Browse PDF...
              </button>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#9ca3af",
                marginTop: 12,
                textAlign: "center",
              }}
            >
              You can also drag and drop a PDF onto the graph canvas
            </div>
            {error && <div style={errorStyle}>{error}</div>}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 12,
              }}
            >
              <button onClick={handleClose} style={secondaryBtnStyle}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ── Extracting ── */}
        {phase === "extracting" && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div style={spinnerStyle} />
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "#374151",
                marginTop: 16,
                marginBottom: 6,
              }}
            >
              Extracting metadata...
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>
              {filePath ? filePath.split("/").pop() : "Processing PDF"}
            </div>
            <div
              style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}
            >
              Looking up DOI, querying Semantic Scholar / CrossRef...
            </div>
          </div>
        )}

        {/* ── Error recovery ── */}
        {phase === "error" && (
          <>
            <div style={errorStyle}>{error}</div>
            <div style={{ fontSize: 13, color: "#374151", marginTop: 12, marginBottom: 16 }}>
              Automatic extraction failed. You can try one of these alternatives:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                onClick={handleAskClaude}
                disabled={claudeExtracting}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  background: claudeExtracting ? "#f3f4f6" : "rgba(124, 58, 237, 0.08)",
                  color: claudeExtracting ? "#9ca3af" : "#7c3aed",
                  border: `1px solid ${claudeExtracting ? "#d1d5db" : "#7c3aed"}`,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: claudeExtracting ? "not-allowed" : "pointer",
                  textAlign: "left",
                }}
              >
                {claudeExtracting ? (
                  <div style={{ ...spinnerStyle, width: 16, height: 16, borderWidth: 2, borderTopColor: "#7c3aed" }} />
                ) : (
                  <AutoAwesomeIcon sx={{ fontSize: 18 }} />
                )}
                <div>
                  <div>{claudeExtracting ? "Extracting with Claude..." : "Ask Claude to extract metadata"}</div>
                  <div style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af", marginTop: 2 }}>
                    Requires API key configured in Settings
                  </div>
                </div>
              </button>
              <button
                onClick={() => {
                  setManualBibtex("");
                  setManualError(null);
                  setPhase("manual-bibtex");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  background: "rgba(5, 150, 105, 0.08)",
                  color: "#059669",
                  border: "1px solid #059669",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <EditNoteIcon sx={{ fontSize: 18 }} />
                <div>
                  <div>Enter BibTeX manually</div>
                  <div style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af", marginTop: 2 }}>
                    Paste a BibTeX entry to create the Paper node
                  </div>
                </div>
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={handleClose} style={secondaryBtnStyle}>Cancel</button>
            </div>
          </>
        )}

        {/* ── Manual BibTeX entry ── */}
        {phase === "manual-bibtex" && (
          <>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>
              Paste a BibTeX entry below. The metadata will be extracted automatically.
            </div>
            <textarea
              value={manualBibtex}
              onChange={(e) => setManualBibtex(e.target.value)}
              placeholder={'@article{key,\n  title = {Paper Title},\n  author = {Author Name},\n  year = {2024},\n  journal = {Journal Name},\n}'}
              style={{
                width: "100%",
                minHeight: 180,
                fontSize: 12,
                fontFamily: "monospace",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 12,
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
            {manualError && <div style={errorStyle}>{manualError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={() => setPhase("error")} style={secondaryBtnStyle}>
                Back
              </button>
              <button
                onClick={handleManualBibtexSubmit}
                disabled={!manualBibtex.trim()}
                style={!manualBibtex.trim() ? disabledBtnStyle : primaryBtnStyle}
              >
                Parse & Preview
              </button>
            </div>
          </>
        )}

        {/* ── Preview ── */}
        {phase === "preview" && metadata && (
          <>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              Extracted via:{" "}
              <span style={methodBadgeStyle}>
                {metadata.extraction_method}
              </span>
            </div>
            <div style={previewContainerStyle}>
              {/* Title */}
              <div style={fieldStyle}>
                <div style={fieldLabelStyle}>Title</div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#111827",
                  }}
                >
                  {metadata.title || "(no title)"}
                </div>
              </div>

              {/* Authors */}
              {metadata.authors.length > 0 && (
                <div style={fieldStyle}>
                  <div style={fieldLabelStyle}>Authors</div>
                  <div style={{ fontSize: 13, color: "#374151" }}>
                    {metadata.authors.join(", ")}
                  </div>
                </div>
              )}

              {/* Year + Journal */}
              <div style={{ display: "flex", gap: 24, ...fieldStyle }}>
                {metadata.year && (
                  <div>
                    <div style={fieldLabelStyle}>Year</div>
                    <div style={{ fontSize: 13, color: "#374151" }}>
                      {metadata.year}
                    </div>
                  </div>
                )}
                {metadata.journal && (
                  <div style={{ flex: 1 }}>
                    <div style={fieldLabelStyle}>Journal</div>
                    <div style={{ fontSize: 13, color: "#374151" }}>
                      {metadata.journal}
                    </div>
                  </div>
                )}
              </div>

              {/* DOI */}
              {metadata.doi && (
                <div style={fieldStyle}>
                  <div style={fieldLabelStyle}>DOI</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      fontFamily: "monospace",
                    }}
                  >
                    {metadata.doi}
                  </div>
                </div>
              )}

              {/* Abstract */}
              {metadata.abstract_text && (
                <div style={fieldStyle}>
                  <div style={fieldLabelStyle}>Abstract</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#374151",
                      lineHeight: 1.5,
                      maxHeight: 120,
                      overflow: "auto",
                    }}
                  >
                    {metadata.abstract_text}
                  </div>
                </div>
              )}

              {/* BibTeX */}
              {metadata.bibtex && (
                <div style={fieldStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div style={fieldLabelStyle}>BibTeX</div>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(metadata.bibtex || "")
                      }
                      style={{
                        fontSize: 11,
                        color: "#6b7280",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <pre style={bibtexPreStyle}>{metadata.bibtex}</pre>
                </div>
              )}
            </div>

            {error && <div style={errorStyle}>{error}</div>}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 12,
              }}
            >
              <button onClick={handleClose} style={secondaryBtnStyle}>
                Cancel
              </button>
              <button
                onClick={handleAddToGraph}
                disabled={importing}
                style={importing ? disabledBtnStyle : primaryBtnStyle}
              >
                {importing ? "Adding..." : "Add to Graph"}
              </button>
            </div>
          </>
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
  background: "#fff",
  borderRadius: 12,
  padding: 24,
  width: 560,
  maxWidth: "90vw",
  maxHeight: "85vh",
  boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  display: "flex",
  flexDirection: "column",
};

const dropZoneStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "40px 24px",
  border: "2px dashed #d1d5db",
  borderRadius: 10,
  background: "#f9fafb",
};

const previewContainerStyle: React.CSSProperties = {
  maxHeight: 400,
  overflowY: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 16,
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 12,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
};

const methodBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 600,
  padding: "1px 8px",
  borderRadius: 4,
  background: "#e5e7eb",
  color: "#374151",
};

const bibtexPreStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "monospace",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: 10,
  maxHeight: 100,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  margin: 0,
};

const spinnerStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: "3px solid #e5e7eb",
  borderTopColor: "#1e40af",
  borderRadius: "50%",
  animation: "pdf-spin 0.8s linear infinite",
  margin: "0 auto",
};

const errorStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 12px",
  background: "#fef2f2",
  color: "#dc2626",
  borderRadius: 6,
  fontSize: 12,
};

const closeButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 24,
  cursor: "pointer",
  color: "#9ca3af",
  padding: "0 4px",
  lineHeight: 1,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "#1e40af",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  background: "#f3f4f6",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const disabledBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  opacity: 0.5,
  cursor: "not-allowed",
};

import { useState, useCallback, useEffect, useRef } from "react";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import * as cmd from "../../lib/tauri-commands";
import type { LayerPaperGroup } from "../../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function ExportBibtexDialog({ isOpen, onClose }: Props) {
  const [groups, setGroups] = useState<LayerPaperGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successPath, setSuccessPath] = useState<string | null>(null);

  // Load paper data when dialog opens
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSuccessPath(null);
    setCopied(false);
    cmd
      .getPaperNodesByLayers()
      .then((data) => {
        setGroups(data);
        // Select all by default
        const allIds = new Set<string>();
        for (const g of data) {
          for (const p of g.papers) {
            allIds.add(p.node_id);
          }
        }
        setSelectedIds(allIds);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const totalPapers = groups.reduce((sum, g) => sum + g.papers.length, 0);
  const selectedCount = selectedIds.size;

  // ── Selection helpers ──

  const togglePaper = useCallback((nodeId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const toggleLayer = useCallback(
    (group: LayerPaperGroup) => {
      const layerIds = group.papers.map((p) => p.node_id);
      const allSelected = layerIds.every((id) => selectedIds.has(id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (allSelected) {
          for (const id of layerIds) next.delete(id);
        } else {
          for (const id of layerIds) next.add(id);
        }
        return next;
      });
    },
    [selectedIds],
  );

  const toggleAll = useCallback(() => {
    if (selectedCount === totalPapers) {
      setSelectedIds(new Set());
    } else {
      const allIds = new Set<string>();
      for (const g of groups) {
        for (const p of g.papers) {
          allIds.add(p.node_id);
        }
      }
      setSelectedIds(allIds);
    }
  }, [selectedCount, totalPapers, groups]);

  // ── Export actions ──

  const handleExportToFile = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const path = await cmd.exportBibtexToFile(ids);
      setSuccessPath(path);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("cancelled")) setError(msg);
    } finally {
      setExporting(false);
    }
  }, [selectedIds]);

  const handleCopyToClipboard = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setError(null);
    try {
      const content = await cmd.exportBibtexSelected(ids);
      if (!content.trim()) {
        setError("No BibTeX content generated");
        return;
      }
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(String(e));
    }
  }, [selectedIds]);

  const handleClose = useCallback(() => {
    setGroups([]);
    setSelectedIds(new Set());
    setError(null);
    setSuccessPath(null);
    setCopied(false);
    setExporting(false);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  // ── Success screen ──
  if (successPath) {
    return (
      <div style={overlayStyle}>
        <div style={{ ...dialogStyle, width: 420 }}>
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <CheckCircleIcon sx={{ fontSize: 40, mb: "12px", color: "#059669" }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: "#111827", marginBottom: 8 }}>
              BibTeX Exported
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 20, wordBreak: "break-all" }}>
              Saved to: {successPath}
            </div>
            <button onClick={handleClose} style={primaryBtnStyle}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasSelected = selectedCount > 0;

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827" }}>
            Export BibTeX
          </h2>
          <button onClick={handleClose} style={closeButtonStyle}>
            <CloseIcon sx={{ fontSize: 22 }} />
          </button>
        </div>

        {loading ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
            Loading papers...
          </div>
        ) : totalPapers === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <div style={{ color: "#d97706", fontSize: 13, marginBottom: 8 }}>
              No paper nodes found in any layer.
            </div>
            <div style={{ color: "#9ca3af", fontSize: 12 }}>
              Import papers first, then export their BibTeX references here.
            </div>
          </div>
        ) : (
          <>
            {/* Select All */}
            <div style={{ marginBottom: 8 }}>
              <TriCheckbox
                checked={selectedCount === totalPapers}
                indeterminate={selectedCount > 0 && selectedCount < totalPapers}
                onChange={toggleAll}
                label={`Select All (${totalPapers} paper${totalPapers !== 1 ? "s" : ""})`}
                bold
              />
            </div>

            {/* Scrollable checkbox tree */}
            <div style={treeContainerStyle}>
              {groups.map((group) => {
                if (group.papers.length === 0) return null;
                const layerIds = group.papers.map((p) => p.node_id);
                const layerSelectedCount = layerIds.filter((id) => selectedIds.has(id)).length;
                const allLayerSelected = layerSelectedCount === layerIds.length;
                const someLayerSelected = layerSelectedCount > 0 && !allLayerSelected;

                return (
                  <div key={group.layer_id} style={{ marginBottom: 8 }}>
                    {/* Layer-level checkbox */}
                    <TriCheckbox
                      checked={allLayerSelected}
                      indeterminate={someLayerSelected}
                      onChange={() => toggleLayer(group)}
                      label={`Layer ${group.layer_number}${group.layer_name ? ` \u2014 ${group.layer_name}` : ""} (${group.papers.length})`}
                      bold
                    />

                    {/* Paper-level checkboxes */}
                    <div style={{ paddingLeft: 22 }}>
                      {group.papers.map((paper) => (
                        <label key={paper.node_id} style={paperRowStyle}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(paper.node_id)}
                            onChange={() => togglePaper(paper.node_id)}
                            style={{ accentColor: "#1e40af", flexShrink: 0 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={paperTitleStyle}>{paper.title}</div>
                            {(paper.authors || paper.year) && (
                              <div style={paperMetaStyle}>
                                {paper.authors}
                                {paper.authors && paper.year ? " \u00b7 " : ""}
                                {paper.year}
                              </div>
                            )}
                          </div>
                          {!paper.has_bibtex && (
                            <span style={generatedBadgeStyle} title="BibTeX will be generated from metadata">
                              gen
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected count */}
            <div style={infoBoxStyle}>
              <strong>{selectedCount}</strong> paper{selectedCount !== 1 ? "s" : ""} selected for export
            </div>
          </>
        )}

        {error && <div style={errorStyle}>{error}</div>}

        {/* Buttons */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={handleClose} style={secondaryBtnStyle}>
            Cancel
          </button>
          <button
            onClick={handleCopyToClipboard}
            disabled={!hasSelected}
            style={!hasSelected ? disabledSecondaryBtnStyle : secondaryBtnStyle}
            title="Copy selected BibTeX entries to clipboard"
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
          <button
            onClick={handleExportToFile}
            disabled={!hasSelected || exporting}
            style={!hasSelected || exporting ? disabledBtnStyle : primaryBtnStyle}
          >
            {exporting ? "Saving..." : "Export .bib File"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tri-state checkbox ───

function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  bold,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
  bold?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <label style={{ ...triLabelStyle, fontWeight: bold ? 600 : 400 }}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ accentColor: "#1e40af", flexShrink: 0 }}
      />
      <span>{label}</span>
    </label>
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
  width: 520,
  maxWidth: "90vw",
  maxHeight: "80vh",
  boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  display: "flex",
  flexDirection: "column",
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

const treeContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  maxHeight: 320,
  marginBottom: 12,
  padding: "4px 0",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  paddingLeft: 12,
  paddingRight: 12,
};

const triLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "#374151",
  cursor: "pointer",
  padding: "4px 0",
};

const paperRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "4px 0",
  fontSize: 12,
  color: "#374151",
  cursor: "pointer",
};

const paperTitleStyle: React.CSSProperties = {
  fontWeight: 500,
  lineHeight: 1.3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const paperMetaStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
  lineHeight: 1.3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const generatedBadgeStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  color: "#d97706",
  background: "#fffbeb",
  border: "1px solid #fde68a",
  borderRadius: 3,
  padding: "1px 4px",
  flexShrink: 0,
  alignSelf: "center",
};

const infoBoxStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  fontSize: 13,
  color: "#374151",
};

const errorStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 12px",
  background: "#fef2f2",
  color: "#dc2626",
  borderRadius: 6,
  fontSize: 12,
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

const disabledSecondaryBtnStyle: React.CSSProperties = {
  ...secondaryBtnStyle,
  opacity: 0.5,
  cursor: "not-allowed",
};

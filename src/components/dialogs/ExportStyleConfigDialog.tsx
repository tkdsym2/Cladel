import { useState, useCallback, useRef, useEffect } from "react";
import type { ExportStyleConfig, ExportPreview } from "../../types";
import { DEFAULT_EXPORT_STYLE } from "../../types";
import * as cmd from "../../lib/tauri-commands";

interface ExportStyleConfigDialogProps {
  open: boolean;
  onClose: () => void;
  exportNodeId: string;
  preview: ExportPreview | null;
  styleConfig: ExportStyleConfig;
  onStyleChange: (config: ExportStyleConfig) => void;
}

const EN_FONT_PRESETS = [
  { value: "times_new_roman", label: "Times New Roman", cssFamily: "'Times New Roman', 'Liberation Serif', serif" },
  { value: "computer_modern", label: "Computer Modern", cssFamily: "'CMU Serif', 'Liberation Serif', serif" },
];

const JP_FONT_PRESETS = [
  { value: "ms_mincho", label: "MS 明朝", cssFamily: "'MS Mincho', 'Noto Serif JP', serif" },
  { value: "yu_mincho", label: "游明朝", cssFamily: "'Yu Mincho', 'Hiragino Mincho ProN', serif" },
];

const LINE_SPACING_OPTIONS = [
  { value: 0.8, label: "0.8x Compact" },
  { value: 1.0, label: "1.0x Normal" },
  { value: 1.2, label: "1.2x Relaxed" },
  { value: 1.5, label: "1.5x Wide" },
  { value: 2.0, label: "2.0x Double" },
];

export function ExportStyleConfigDialog({
  open,
  onClose,
  exportNodeId,
  preview,
  styleConfig,
  onStyleChange,
}: ExportStyleConfigDialogProps) {
  const [config, setConfig] = useState<ExportStyleConfig>(styleConfig);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setConfig(styleConfig);
  }, [styleConfig]);

  const updateField = useCallback(
    <K extends keyof ExportStyleConfig>(key: K, value: ExportStyleConfig[K]) => {
      setConfig((prev) => {
        const next = { ...prev, [key]: value };
        // Debounce save
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          cmd.updateExportStyleConfig(exportNodeId, next).catch(console.error);
          onStyleChange(next);
        }, 500);
        return next;
      });
    },
    [exportNodeId, onStyleChange],
  );

  const handleReset = useCallback(() => {
    setConfig(DEFAULT_EXPORT_STYLE);
    cmd.updateExportStyleConfig(exportNodeId, DEFAULT_EXPORT_STYLE).catch(console.error);
    onStyleChange(DEFAULT_EXPORT_STYLE);
  }, [exportNodeId, onStyleChange]);

  if (!open) return null;

  const enFontPreset = EN_FONT_PRESETS.find((f) => f.value === config.en_font_preset) ?? EN_FONT_PRESETS[0];
  const jpFontPreset = JP_FONT_PRESETS.find((f) => f.value === config.jp_font_preset) ?? JP_FONT_PRESETS[0];
  const sampleSections = preview?.sections?.slice(0, 2) ?? [];

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>PDF Style Settings</span>
          <button onClick={onClose} style={closeBtnStyle}>
            &times;
          </button>
        </div>

        <div style={bodyStyle}>
          {/* Settings panel */}
          <div style={settingsPanelStyle}>
            {/* EN Font */}
            <div style={fieldStyle}>
              <label style={labelStyle}>English Font</label>
              <select
                value={config.en_font_preset}
                onChange={(e) => updateField("en_font_preset", e.target.value)}
                style={selectStyle}
              >
                {EN_FONT_PRESETS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {/* JP Font */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Japanese Font</label>
              <select
                value={config.jp_font_preset}
                onChange={(e) => updateField("jp_font_preset", e.target.value)}
                style={selectStyle}
              >
                {JP_FONT_PRESETS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Font Sizes */}
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Font Sizes (pt)</label>
              <div style={sizeGridStyle}>
                <SizeInput label="Title" value={config.title_size} min={10} max={36}
                  onChange={(v) => updateField("title_size", v)} />
                <SizeInput label="Section" value={config.section_heading_size} min={8} max={28}
                  onChange={(v) => updateField("section_heading_size", v)} />
                <SizeInput label="Subsection" value={config.subsection_heading_size} min={8} max={24}
                  onChange={(v) => updateField("subsection_heading_size", v)} />
                <SizeInput label="Body" value={config.body_size} min={8} max={18}
                  onChange={(v) => updateField("body_size", v)} />
              </div>
            </div>

            {/* Line Spacing */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Line Spacing</label>
              <select
                value={config.line_spacing}
                onChange={(e) => updateField("line_spacing", parseFloat(e.target.value))}
                style={selectStyle}
              >
                {LINE_SPACING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Section Numbering */}
            <div style={fieldStyle}>
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={config.section_numbering}
                  onChange={(e) => updateField("section_numbering", e.target.checked)}
                  style={{ margin: 0 }}
                />
                Section Numbering (1, 1.1, 1.1.1)
              </label>
            </div>

            {/* Title Alignment */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Title Alignment</label>
              <div style={radioRowStyle}>
                <label style={radioItemStyle}>
                  <input
                    type="radio"
                    name="titleAlignment"
                    value="left"
                    checked={config.title_alignment === "left"}
                    onChange={() => updateField("title_alignment", "left")}
                  />
                  <span>Left</span>
                </label>
                <label style={radioItemStyle}>
                  <input
                    type="radio"
                    name="titleAlignment"
                    value="center"
                    checked={config.title_alignment === "center"}
                    onChange={() => updateField("title_alignment", "center")}
                  />
                  <span>Center</span>
                </label>
              </div>
            </div>

            {/* Affiliation Marker */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Affiliation Marker</label>
              <div style={radioRowStyle}>
                <label style={radioItemStyle}>
                  <input
                    type="radio"
                    name="affiliationMarker"
                    value="number"
                    checked={config.affiliation_marker === "number"}
                    onChange={() => updateField("affiliation_marker", "number")}
                  />
                  <span>Numbers (¹²³)</span>
                </label>
                <label style={radioItemStyle}>
                  <input
                    type="radio"
                    name="affiliationMarker"
                    value="dagger"
                    checked={config.affiliation_marker === "dagger"}
                    onChange={() => updateField("affiliation_marker", "dagger")}
                  />
                  <span>Daggers (†‡§)</span>
                </label>
              </div>
            </div>

            {/* Line Numbers */}
            <div style={fieldStyle}>
              <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={config.show_line_numbers}
                  onChange={(e) => updateField("show_line_numbers", e.target.checked)}
                  style={{ margin: 0 }}
                />
                Line Numbers
              </label>
            </div>

            {/* Margins */}
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Margins (mm)</label>
              <div style={marginGridStyle}>
                <MarginInput label="Top" value={config.margin_top}
                  onChange={(v) => updateField("margin_top", v)} />
                <MarginInput label="Bottom" value={config.margin_bottom}
                  onChange={(v) => updateField("margin_bottom", v)} />
                <MarginInput label="Left" value={config.margin_left}
                  onChange={(v) => updateField("margin_left", v)} />
                <MarginInput label="Right" value={config.margin_right}
                  onChange={(v) => updateField("margin_right", v)} />
              </div>
            </div>

            {/* Reset */}
            <button onClick={handleReset} style={resetBtnStyle}>
              Reset to Defaults
            </button>
          </div>

          {/* Preview panel */}
          <div style={previewPanelStyle}>
            <label style={{ ...labelStyle, marginBottom: 8 }}>Preview</label>
            <PdfPreview
              config={config}
              enFontFamily={enFontPreset.cssFamily}
              jpFontFamily={jpFontPreset.cssFamily}
              sections={sampleSections}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Preview Component ───

interface PdfPreviewProps {
  config: ExportStyleConfig;
  enFontFamily: string;
  jpFontFamily: string;
  sections: { title: string; content: string }[];
}

function PdfPreview({ config, enFontFamily, jpFontFamily, sections }: PdfPreviewProps) {
  // A4 ratio: 210mm x 297mm. Scale to fit ~320px wide
  const pageW = 320;
  const pageH = Math.round(pageW * (297 / 210));
  const scale = pageW / 210; // mm to px

  const mt = config.margin_top * scale;
  const mb = config.margin_bottom * scale;
  const ml = config.margin_left * scale;
  const mr = config.margin_right * scale;

  const contentW = pageW - ml - mr;

  // Font size scaling: PDF pt ~= 1/3 px at this scale
  const ptScale = scale * 0.38;
  const titleFs = config.title_size * ptScale;
  const sectionFs = config.section_heading_size * ptScale;
  const bodyFs = config.body_size * ptScale;
  const lineH = config.line_spacing;

  const sampleBodyEn =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";

  const sampleBodyMixed =
    "研究の背景と目的について述べる。本研究では knowledge graph を用いた思考整理手法の有効性を検証する。";

  return (
    <div style={previewContainerStyle}>
      <div
        style={{
          width: pageW,
          height: pageH,
          background: "#fff",
          border: "1px solid #d1d5db",
          borderRadius: 2,
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}
      >
        {/* Margin guides */}
        <div
          style={{
            position: "absolute",
            top: mt,
            left: ml,
            right: mr,
            bottom: mb,
            border: "1px dashed rgba(59,130,246,0.2)",
            pointerEvents: "none",
          }}
        />

        {/* Content area */}
        <div
          style={{
            position: "absolute",
            top: mt,
            left: ml,
            width: contentW,
            bottom: mb,
            fontFamily: enFontFamily,
            overflow: "hidden",
          }}
        >
          {/* Title page (printed only when a Title node is connected) */}
          <div
            style={{
              fontSize: titleFs,
              fontWeight: 700,
              lineHeight: 1.3,
              marginBottom: 6 * lineH,
              color: "#111827",
              wordBreak: "break-word",
              textAlign: config.title_alignment === "center" ? "center" : "left",
            }}
          >
            Title (Title node)
          </div>

          {/* Section 1 - English */}
          <div style={{ display: "flex" }}>
            {config.show_line_numbers && (
              <div style={{ width: 12, flexShrink: 0, fontSize: bodyFs * 0.75, color: "#9ca3af", textAlign: "right", paddingRight: 3, paddingTop: 1 }}>1</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: sectionFs,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  marginBottom: 3 * lineH,
                  color: "#1f2937",
                }}
              >
                1. {sections[0]?.title || "Introduction"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex" }}>
            {config.show_line_numbers && (
              <div style={{ width: 12, flexShrink: 0, fontSize: bodyFs * 0.75, color: "#9ca3af", textAlign: "right", paddingRight: 3, paddingTop: 1 }}>2</div>
            )}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: bodyFs,
                lineHeight: 1.2 + lineH * 0.3,
                color: "#374151",
                marginBottom: 4 * lineH,
              }}
            >
              {sampleBodyEn}
            </div>
          </div>

          {/* Section 2 - Mixed JP/EN */}
          <div style={{ display: "flex" }}>
            {config.show_line_numbers && (
              <div style={{ width: 12, flexShrink: 0, fontSize: bodyFs * 0.75, color: "#9ca3af", textAlign: "right", paddingRight: 3, paddingTop: 1 }}>5</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: sectionFs,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  marginBottom: 3 * lineH,
                  color: "#1f2937",
                  fontFamily: jpFontFamily,
                }}
              >
                2. {sections[1]?.title || "背景"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex" }}>
            {config.show_line_numbers && (
              <div style={{ width: 12, flexShrink: 0, fontSize: bodyFs * 0.75, color: "#9ca3af", textAlign: "right", paddingRight: 3, paddingTop: 1 }}>6</div>
            )}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: bodyFs,
                lineHeight: 1.2 + lineH * 0.3,
                color: "#374151",
                marginBottom: 4 * lineH,
                fontFamily: jpFontFamily,
              }}
            >
              {sampleBodyMixed}
            </div>
          </div>

          {/* References placeholder */}
          <div
            style={{
              fontSize: sectionFs,
              fontWeight: 700,
              lineHeight: 1.3,
              marginTop: 6 * lineH,
              color: "#1f2937",
              marginBottom: 3 * lineH,
            }}
          >
            References
          </div>
          <div style={{ fontSize: bodyFs * 0.9, color: "#6b7280", lineHeight: 1.4 }}>
            [1] Author, A. &ldquo;Sample paper title,&rdquo; Journal, 2024.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Small Input Components ───

function SizeInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={sizeItemStyle}>
      <span style={sizeItemLabelStyle}>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={0.5}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= min && v <= max) onChange(v);
        }}
        style={numberInputStyle}
      />
    </div>
  );
}

function MarginInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={sizeItemStyle}>
      <span style={sizeItemLabelStyle}>{label}</span>
      <input
        type="number"
        value={value}
        min={5}
        max={50}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v) && v >= 5 && v <= 50) onChange(v);
        }}
        style={numberInputStyle}
      />
    </div>
  );
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const dialogStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 12,
  width: 720,
  maxWidth: "90vw",
  maxHeight: "85vh",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 20px",
  borderBottom: "1px solid #e5e7eb",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 22,
  cursor: "pointer",
  color: "#6b7280",
  padding: "0 4px",
  lineHeight: 1,
};

const bodyStyle: React.CSSProperties = {
  display: "flex",
  gap: 20,
  padding: 20,
  overflow: "auto",
  flex: 1,
};

const settingsPanelStyle: React.CSSProperties = {
  flex: "0 0 300px",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const previewPanelStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  minWidth: 0,
};

const previewContainerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: "4px 0",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const fieldGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 13,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  outline: "none",
  background: "#fff",
  cursor: "pointer",
};

const sizeGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
};

const marginGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 6,
};

const sizeItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
  background: "#f9fafb",
  borderRadius: 4,
  border: "1px solid #e5e7eb",
};

const sizeItemLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
  flex: 1,
  minWidth: 0,
};

const numberInputStyle: React.CSSProperties = {
  width: 48,
  padding: "4px 6px",
  fontSize: 13,
  border: "1px solid #d1d5db",
  borderRadius: 4,
  outline: "none",
  textAlign: "center",
};

const radioRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 14,
};

const radioItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  cursor: "pointer",
};

const resetBtnStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 12,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  background: "#f9fafb",
  cursor: "pointer",
  color: "#6b7280",
  marginTop: 4,
};

import { useState, useEffect, useCallback, useRef } from "react";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import type { NodeData, ExportAuthor } from "../../types";
import { useGraphStore } from "../../store/graphStore";

interface TitleNodeViewerProps {
  node: NodeData;
}

interface TitleNodeMeta {
  subtitle: string;
  authors: ExportAuthor[];
}

function parseMeta(node: NodeData): TitleNodeMeta {
  try {
    const m = node.metadata ? JSON.parse(node.metadata) : null;
    return {
      subtitle: m?.subtitle ?? "",
      authors: (m?.authors ?? []).map((a: ExportAuthor) => ({
        name: a.name ?? "",
        affiliations: Array.isArray(a.affiliations) ? a.affiliations : [],
      })),
    };
  } catch {
    return { subtitle: "", authors: [] };
  }
}

export function TitleNodeViewer({ node }: TitleNodeViewerProps) {
  const updateNodeContent = useGraphStore((s) => s.updateNodeContent);

  const [title, setTitle] = useState(node.title);
  const [meta, setMeta] = useState<TitleNodeMeta>(() => parseMeta(node));

  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(node.title);
    setMeta(parseMeta(node));
  }, [node.id, node.title, node.metadata]);

  // Debounced save of title
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

  // Debounced save of metadata
  const saveMeta = useCallback(
    (newMeta: TitleNodeMeta) => {
      if (metaTimerRef.current) clearTimeout(metaTimerRef.current);
      metaTimerRef.current = setTimeout(() => {
        updateNodeContent(node.id, {
          metadata: JSON.stringify(newMeta),
        });
      }, 800);
    },
    [node.id, updateNodeContent],
  );

  const handleSubtitleChange = useCallback(
    (value: string) => {
      const updated = { ...meta, subtitle: value };
      setMeta(updated);
      saveMeta(updated);
    },
    [meta, saveMeta],
  );

  // Author CRUD
  const handleAddAuthor = useCallback(() => {
    const updated = { ...meta, authors: [...meta.authors, { name: "", affiliations: [""] }] };
    setMeta(updated);
    saveMeta(updated);
  }, [meta, saveMeta]);

  const handleRemoveAuthor = useCallback(
    (index: number) => {
      const updated = { ...meta, authors: meta.authors.filter((_, i) => i !== index) };
      setMeta(updated);
      saveMeta(updated);
    },
    [meta, saveMeta],
  );

  const handleAuthorNameChange = useCallback(
    (index: number, value: string) => {
      const newAuthors = [...meta.authors];
      newAuthors[index] = { ...newAuthors[index], name: value };
      const updated = { ...meta, authors: newAuthors };
      setMeta(updated);
      saveMeta(updated);
    },
    [meta, saveMeta],
  );

  // Affiliation CRUD per author
  const handleAddAffiliation = useCallback(
    (authorIndex: number) => {
      const newAuthors = [...meta.authors];
      newAuthors[authorIndex] = {
        ...newAuthors[authorIndex],
        affiliations: [...newAuthors[authorIndex].affiliations, ""],
      };
      const updated = { ...meta, authors: newAuthors };
      setMeta(updated);
      saveMeta(updated);
    },
    [meta, saveMeta],
  );

  const handleRemoveAffiliation = useCallback(
    (authorIndex: number, affilIndex: number) => {
      const newAuthors = [...meta.authors];
      newAuthors[authorIndex] = {
        ...newAuthors[authorIndex],
        affiliations: newAuthors[authorIndex].affiliations.filter((_, i) => i !== affilIndex),
      };
      const updated = { ...meta, authors: newAuthors };
      setMeta(updated);
      saveMeta(updated);
    },
    [meta, saveMeta],
  );

  const handleAffiliationChange = useCallback(
    (authorIndex: number, affilIndex: number, value: string) => {
      const newAuthors = [...meta.authors];
      const newAffils = [...newAuthors[authorIndex].affiliations];
      newAffils[affilIndex] = value;
      newAuthors[authorIndex] = { ...newAuthors[authorIndex], affiliations: newAffils };
      const updated = { ...meta, authors: newAuthors };
      setMeta(updated);
      saveMeta(updated);
    },
    [meta, saveMeta],
  );

  return (
    <div style={containerStyle}>
      {/* Node id */}
      {node.display_id && (
        <div style={{ fontSize: 13, fontFamily: "monospace", color: "#78716c" }}>
          {node.display_id}
        </div>
      )}

      {/* Document title (printed on the exported PDF's title page) */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Document Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          style={inputStyle}
          placeholder="Document title"
        />
      </div>

      {/* Subtitle */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Subtitle</label>
        <input
          type="text"
          value={meta.subtitle}
          onChange={(e) => handleSubtitleChange(e.target.value)}
          style={inputStyle}
          placeholder="Optional subtitle"
        />
      </div>

      {/* Authors */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <label style={labelStyle}>Authors</label>
          <button onClick={handleAddAuthor} style={addBtnStyle} title="Add author">
            <AddIcon sx={{ fontSize: 14 }} />
          </button>
        </div>
        {meta.authors.length === 0 && (
          <div style={emptyStyle}>No authors added.</div>
        )}
        {meta.authors.map((author, aIdx) => (
          <div key={aIdx} style={authorItemStyle}>
            <div style={authorContentStyle}>
              {/* Author name */}
              <div style={authorNameRowStyle}>
                <input
                  type="text"
                  value={author.name}
                  onChange={(e) => handleAuthorNameChange(aIdx, e.target.value)}
                  style={authorNameInputStyle}
                  placeholder="Author name"
                />
                <button
                  onClick={() => handleRemoveAuthor(aIdx)}
                  style={removeBtnStyle}
                  title="Remove author"
                >
                  <CloseIcon sx={{ fontSize: 12 }} />
                </button>
              </div>

              {/* Affiliations */}
              <div style={affiliationsStyle}>
                {author.affiliations.map((affil, afIdx) => (
                  <div key={afIdx} style={affiliationRowStyle}>
                    <input
                      type="text"
                      value={affil}
                      onChange={(e) => handleAffiliationChange(aIdx, afIdx, e.target.value)}
                      style={affiliationInputStyle}
                      placeholder="Affiliation"
                    />
                    <button
                      onClick={() => handleRemoveAffiliation(aIdx, afIdx)}
                      style={removeBtnStyle}
                      title="Remove affiliation"
                    >
                      <CloseIcon sx={{ fontSize: 10 }} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => handleAddAffiliation(aIdx)}
                  style={addAffiliationBtnStyle}
                >
                  + Affiliation
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
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

const emptyStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#9ca3af",
  fontStyle: "italic",
  padding: "8px 0",
};

const addBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  padding: 2,
  cursor: "pointer",
  color: "#6b7280",
};

const authorItemStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "#f9fafb",
  borderRadius: 6,
  border: "1px solid #e5e7eb",
};

const authorContentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const authorNameRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const authorNameInputStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 8px",
  fontSize: 13,
  border: "1px solid #d1d5db",
  borderRadius: 4,
  outline: "none",
  boxSizing: "border-box",
  fontWeight: 500,
};

const removeBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#9ca3af",
  padding: 2,
  borderRadius: 4,
  flexShrink: 0,
};

const affiliationsStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  paddingLeft: 8,
};

const affiliationRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 3,
};

const affiliationInputStyle: React.CSSProperties = {
  flex: 1,
  padding: "3px 6px",
  fontSize: 11,
  border: "1px solid #e5e7eb",
  borderRadius: 3,
  outline: "none",
  boxSizing: "border-box",
  color: "#6b7280",
};

const addAffiliationBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 10,
  color: "#9ca3af",
  padding: "2px 0",
  textAlign: "left",
};

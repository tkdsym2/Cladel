import { useState, useEffect, useCallback } from "react";
import CloseIcon from "@mui/icons-material/Close";
import * as cmd from "../../lib/tauri-commands";
import { useGraphStore } from "../../store/graphStore";
import type { CoreVersionData, NoteVersionData } from "../../types";

type VersionEntry = CoreVersionData | NoteVersionData;

interface Props {
  nodeId: string | null;
  onClose: () => void;
}

export function CoreHistoryPanel({ nodeId, onClose }: Props) {
  const dbNodes = useGraphStore((s) => s.dbNodes);
  const node = nodeId ? dbNodes.find((n) => n.id === nodeId) : null;

  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<VersionEntry | null>(null);
  const [diffView, setDiffView] = useState<{ prev: string; curr: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const isCore = node?.node_type === "core";
  const title = isCore ? "Core Version History" : `Note Version History`;

  useEffect(() => {
    if (nodeId && node) {
      setLoading(true);
      const fetchVersions = isCore
        ? cmd.getCoreVersions(nodeId)
        : cmd.getNoteVersions(nodeId);
      fetchVersions
        .then((v) => {
          setVersions(v);
          setSelectedVersion(null);
          setDiffView(null);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      setVersions([]);
      setSelectedVersion(null);
      setDiffView(null);
    }
  }, [nodeId, node, isCore]);

  const handleSelectVersion = useCallback(
    (version: VersionEntry) => {
      setSelectedVersion(version);
      // Find previous version for diff
      const idx = versions.findIndex((v) => v.id === version.id);
      // versions are ordered DESC by version_number, so previous is idx+1
      const prevVersion = versions[idx + 1];
      if (prevVersion) {
        setDiffView({ prev: prevVersion.content, curr: version.content });
      } else {
        setDiffView(null);
      }
    },
    [versions],
  );

  if (!nodeId) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#111827" }}>
              {title}
            </h2>
            {node && (
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                {node.title}
              </div>
            )}
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
            <CloseIcon sx={{ fontSize: 22 }} />
          </button>
        </div>

        {!node && (
          <div style={{ padding: 20, color: "#6b7280", fontSize: 13 }}>
            Node not found.
          </div>
        )}

        {loading && (
          <div style={{ padding: 20, color: "#6b7280", fontSize: 13 }}>
            Loading versions...
          </div>
        )}

        {node && !loading && (
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {/* Version list */}
            <div style={versionListStyle}>
              {versions.length === 0 && (
                <div style={{ padding: 12, color: "#9ca3af", fontSize: 12 }}>
                  No versions saved yet.
                </div>
              )}
              {versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => handleSelectVersion(v)}
                  style={{
                    ...versionItemStyle,
                    background: selectedVersion?.id === v.id ? "#eff6ff" : "transparent",
                    borderLeft: selectedVersion?.id === v.id
                      ? "3px solid #1e40af"
                      : "3px solid transparent",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1f2937" }}>
                    Version {v.version_number}
                  </div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>
                    {formatTimestamp(v.created_at)}
                  </div>
                </button>
              ))}
            </div>

            {/* Version content / diff */}
            <div style={contentAreaStyle}>
              {!selectedVersion ? (
                <div style={{ color: "#9ca3af", fontSize: 13, padding: 16 }}>
                  Select a version to view its content.
                </div>
              ) : (
                <>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", fontSize: 13, color: "#6b7280" }}>
                    Version {selectedVersion.version_number} &middot;{" "}
                    {formatTimestamp(selectedVersion.created_at)}
                  </div>
                  {diffView ? (
                    <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                      <DiffDisplay prev={diffView.prev} curr={diffView.curr} />
                    </div>
                  ) : (
                    <pre style={versionContentStyle}>
                      {selectedVersion.content}
                    </pre>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Simple line-level diff display ───

function DiffDisplay({ prev, curr }: { prev: string; curr: string }) {
  const prevLines = prev.split("\n");
  const currLines = curr.split("\n");
  const maxLen = Math.max(prevLines.length, currLines.length);

  const diffLines: { text: string; type: "same" | "add" | "remove" }[] = [];

  // Simple LCS-based diff
  const lcs = computeLCS(prevLines, currLines);
  let pi = 0;
  let ci = 0;
  let li = 0;

  while (pi < prevLines.length || ci < currLines.length) {
    if (li < lcs.length && pi < prevLines.length && ci < currLines.length && prevLines[pi] === lcs[li] && currLines[ci] === lcs[li]) {
      diffLines.push({ text: currLines[ci], type: "same" });
      pi++;
      ci++;
      li++;
    } else if (li < lcs.length && ci < currLines.length && currLines[ci] === lcs[li]) {
      // prev line not in LCS → removed
      if (pi < prevLines.length) {
        diffLines.push({ text: prevLines[pi], type: "remove" });
        pi++;
      }
    } else if (li < lcs.length && pi < prevLines.length && prevLines[pi] === lcs[li]) {
      // curr line not in LCS → added
      if (ci < currLines.length) {
        diffLines.push({ text: currLines[ci], type: "add" });
        ci++;
      }
    } else {
      // Neither matches LCS
      if (pi < prevLines.length && (ci >= currLines.length || pi < prevLines.length)) {
        diffLines.push({ text: prevLines[pi], type: "remove" });
        pi++;
      }
      if (ci < currLines.length && pi >= prevLines.length) {
        diffLines.push({ text: currLines[ci], type: "add" });
        ci++;
      }
      if (pi < prevLines.length && ci < currLines.length && li >= lcs.length) {
        // Both remaining, alternate
        diffLines.push({ text: prevLines[pi], type: "remove" });
        diffLines.push({ text: currLines[ci], type: "add" });
        pi++;
        ci++;
      }
    }

    // Safety: prevent infinite loop for edge cases
    if (pi + ci > maxLen * 3) break;
  }

  if (diffLines.every((l) => l.type === "same")) {
    return (
      <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>
        No changes from previous version.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.8 }}>
      {diffLines.map((line, i) => (
        <div
          key={i}
          style={{
            padding: "1px 8px",
            background:
              line.type === "add"
                ? "#dcfce7"
                : line.type === "remove"
                  ? "#fee2e2"
                  : "transparent",
            color:
              line.type === "add"
                ? "#166534"
                : line.type === "remove"
                  ? "#991b1b"
                  : "#374151",
            borderLeft:
              line.type === "add"
                ? "3px solid #22c55e"
                : line.type === "remove"
                  ? "3px solid #ef4444"
                  : "3px solid transparent",
          }}
        >
          <span style={{ display: "inline-block", width: 18, color: "#9ca3af", userSelect: "none" }}>
            {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
          </span>
          {line.text || "\u00A0"}
        </div>
      ))}
    </div>
  );
}

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2000,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const panelStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  width: 720,
  maxWidth: "95vw",
  height: 520,
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
  padding: "16px 20px",
  borderBottom: "1px solid #e5e7eb",
};

const closeBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 24,
  cursor: "pointer",
  color: "#9ca3af",
  lineHeight: 1,
  padding: "0 4px",
};

const versionListStyle: React.CSSProperties = {
  width: 200,
  borderRight: "1px solid #e5e7eb",
  overflowY: "auto",
};

const versionItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  border: "none",
  cursor: "pointer",
  borderBottom: "1px solid #f3f4f6",
  background: "transparent",
};

const contentAreaStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};

const versionContentStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 16,
  margin: 0,
  fontFamily: "monospace",
  fontSize: 13,
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

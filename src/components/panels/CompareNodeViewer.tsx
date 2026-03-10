import { useState, useEffect, useMemo, useCallback } from "react";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { useGraphStore } from "../../store/graphStore";
import * as cmd from "../../lib/tauri-commands";
import type { NodeData, EdgeData } from "../../types";

interface CompareNodeViewerProps {
  node: NodeData;
}

// ─── Word-level diff types ───

interface WordSpan {
  type: "equal" | "added" | "removed";
  text: string;
}

// ─── LCS helper for string arrays ───

function lcs<T>(a: T[], b: T[]): { type: "equal" | "added" | "removed"; value: T }[] {
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
  const stack: { type: "equal" | "added" | "removed"; value: T }[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ type: "equal", value: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "added", value: b[j - 1] });
      j--;
    } else {
      stack.push({ type: "removed", value: a[i - 1] });
      i--;
    }
  }
  stack.reverse();
  return stack;
}

// ─── Tokenize a line into words preserving whitespace ───

function tokenize(text: string): string[] {
  return text.match(/\S+|\s+/g) || [];
}

// ─── Compute word-level diff between two lines ───

function wordDiff(oldLine: string, newLine: string): WordSpan[] {
  const oldTokens = tokenize(oldLine);
  const newTokens = tokenize(newLine);
  const raw = lcs(oldTokens, newTokens);

  // Merge consecutive spans of the same type
  const merged: WordSpan[] = [];
  for (const item of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === item.type) {
      last.text += item.value;
    } else {
      merged.push({ type: item.type, text: item.value });
    }
  }
  return merged;
}

// ─── High-level diff result ───

interface DiffEntry {
  kind: "equal" | "added" | "removed" | "modified";
  text: string;           // used for equal/added/removed
  oldText?: string;       // used for modified
  newText?: string;       // used for modified
  wordSpans?: WordSpan[]; // used for modified — inline word diff
}

function computeDiff(oldText: string, newText: string): DiffEntry[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Line-level LCS
  const rawLines = lcs(oldLines, newLines);

  // Group into DiffEntry, pairing adjacent removed+added as "modified"
  const entries: DiffEntry[] = [];
  const pending: { type: "removed" | "added"; value: string }[] = [];

  function flushPending() {
    if (pending.length === 0) return;
    const removed = pending.filter((p) => p.type === "removed");
    const added = pending.filter((p) => p.type === "added");

    // Pair removed/added lines into modified entries
    const pairCount = Math.min(removed.length, added.length);
    for (let k = 0; k < pairCount; k++) {
      const spans = wordDiff(removed[k].value, added[k].value);
      entries.push({
        kind: "modified",
        text: "",
        oldText: removed[k].value,
        newText: added[k].value,
        wordSpans: spans,
      });
    }
    // Leftover unpaired lines
    for (let k = pairCount; k < removed.length; k++) {
      entries.push({ kind: "removed", text: removed[k].value });
    }
    for (let k = pairCount; k < added.length; k++) {
      entries.push({ kind: "added", text: added[k].value });
    }
    pending.length = 0;
  }

  for (const item of rawLines) {
    if (item.type === "equal") {
      flushPending();
      entries.push({ kind: "equal", text: item.value });
    } else {
      pending.push(item as { type: "removed" | "added"; value: string });
    }
  }
  flushPending();

  return entries.length > 0 ? entries : [{ kind: "equal", text: "(both empty)" }];
}

export function CompareNodeViewer({ node }: CompareNodeViewerProps) {
  const storeNodes = useGraphStore((s) => s.dbNodes);
  const storeEdges = useGraphStore((s) => s.dbEdges);

  // In detached windows the store is empty — fetch from backend
  const [fetchedNodes, setFetchedNodes] = useState<NodeData[]>([]);
  const [fetchedEdges, setFetchedEdges] = useState<EdgeData[]>([]);

  const isStoreEmpty = storeNodes.length === 0;

  useEffect(() => {
    if (!isStoreEmpty) return;
    let cancelled = false;
    async function load() {
      try {
        const [nodes, edges] = await Promise.all([
          cmd.getNodesByLayer(node.layer_id),
          cmd.getEdgesByLayer(node.layer_id),
        ]);
        if (!cancelled) {
          setFetchedNodes(nodes);
          setFetchedEdges(edges);
        }
      } catch (e) {
        console.error("CompareNodeViewer: failed to fetch data:", e);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [isStoreEmpty, node.layer_id, node.id]);

  const dbNodes = isStoreEmpty ? fetchedNodes : storeNodes;
  const dbEdges = isStoreEmpty ? fetchedEdges : storeEdges;

  // Find connected Edit (user_doc) nodes
  const connectedEditNodes = useMemo(() => {
    const connectedIds = new Set<string>();
    for (const edge of dbEdges) {
      if (edge.source_node_id === node.id) connectedIds.add(edge.target_node_id);
      if (edge.target_node_id === node.id) connectedIds.add(edge.source_node_id);
    }
    return dbNodes.filter(
      (n) => connectedIds.has(n.id) && n.node_type === "user_doc" && n.status === "active"
    );
  }, [node.id, dbNodes, dbEdges]);

  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);

  // Auto-assign when connected nodes change
  useEffect(() => {
    if (connectedEditNodes.length >= 2) {
      if (!beforeId || !connectedEditNodes.find((n) => n.id === beforeId)) {
        setBeforeId(connectedEditNodes[0].id);
      }
      if (!afterId || !connectedEditNodes.find((n) => n.id === afterId)) {
        setAfterId(connectedEditNodes[1].id);
      }
    } else if (connectedEditNodes.length === 1) {
      if (!beforeId || !connectedEditNodes.find((n) => n.id === beforeId)) {
        setBeforeId(connectedEditNodes[0].id);
      }
      setAfterId(null);
    } else {
      setBeforeId(null);
      setAfterId(null);
    }
  }, [connectedEditNodes]);

  const beforeNode = useMemo(() => connectedEditNodes.find((n) => n.id === beforeId), [connectedEditNodes, beforeId]);
  const afterNode = useMemo(() => connectedEditNodes.find((n) => n.id === afterId), [connectedEditNodes, afterId]);

  const handleSwap = useCallback(() => {
    setBeforeId(afterId);
    setAfterId(beforeId);
  }, [beforeId, afterId]);

  const diffEntries = useMemo(() => {
    if (!beforeNode || !afterNode) return null;
    return computeDiff(beforeNode.content ?? "", afterNode.content ?? "");
  }, [beforeNode, afterNode]);

  const stats = useMemo(() => {
    if (!diffEntries) return null;
    let added = 0;
    let removed = 0;
    let modified = 0;
    for (const entry of diffEntries) {
      if (entry.kind === "added") added++;
      if (entry.kind === "removed") removed++;
      if (entry.kind === "modified") modified++;
    }
    return { added, removed, modified };
  }, [diffEntries]);

  if (connectedEditNodes.length < 2) {
    return (
      <div style={{ padding: "8px 0" }}>
        <div style={instructionStyle}>
          Connect 2 Edit nodes to this Compare node to see the diff.
        </div>
        <div style={instructionSubStyle}>
          Currently connected: {connectedEditNodes.length} Edit node{connectedEditNodes.length !== 1 ? "s" : ""}
        </div>
        {connectedEditNodes.length === 1 && (
          <div style={{ ...instructionSubStyle, marginTop: 4 }}>
            Before: <strong>{connectedEditNodes[0].display_id ?? connectedEditNodes[0].title}</strong>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0", flex: 1, minHeight: 0 }}>
      {/* Node selectors */}
      <div style={selectorRowStyle}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Before (old)</label>
          <select
            value={beforeId ?? ""}
            onChange={(e) => setBeforeId(e.target.value || null)}
            style={selectStyle}
          >
            {connectedEditNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.display_id ?? n.title}
              </option>
            ))}
          </select>
        </div>
        <button onClick={handleSwap} style={swapBtnStyle} title="Swap before/after">
          <SwapHorizIcon sx={{ fontSize: 18 }} />
        </button>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>After (new)</label>
          <select
            value={afterId ?? ""}
            onChange={(e) => setAfterId(e.target.value || null)}
            style={selectStyle}
          >
            {connectedEditNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.display_id ?? n.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={statsStyle}>
          <span style={{ color: "#2563eb", fontWeight: 600 }}>+{stats.added} added</span>
          <span style={{ color: "#9ca3af" }}>&middot;</span>
          <span style={{ color: "#dc2626", fontWeight: 600 }}>-{stats.removed} removed</span>
          {stats.modified > 0 && (
            <>
              <span style={{ color: "#9ca3af" }}>&middot;</span>
              <span style={{ color: "#d97706", fontWeight: 600 }}>~{stats.modified} modified</span>
            </>
          )}
        </div>
      )}

      {/* Diff view */}
      {diffEntries && (
        <div style={diffContainerStyle}>
          {diffEntries.map((entry, idx) => {
            if (entry.kind === "equal") {
              return (
                <div key={idx} style={lineStyle("equal")}>
                  <span style={prefixStyle("equal")}>{" "}</span>
                  <span style={textStyle}>{entry.text || "\u00A0"}</span>
                </div>
              );
            }
            if (entry.kind === "removed") {
              return (
                <div key={idx} style={lineStyle("removed")}>
                  <span style={prefixStyle("removed")}>{"-"}</span>
                  <span style={textStyle}>{entry.text || "\u00A0"}</span>
                </div>
              );
            }
            if (entry.kind === "added") {
              return (
                <div key={idx} style={lineStyle("added")}>
                  <span style={prefixStyle("added")}>{"+"}</span>
                  <span style={textStyle}>{entry.text || "\u00A0"}</span>
                </div>
              );
            }
            // modified — show word-level inline diff
            return (
              <div key={idx} style={lineStyle("modified")}>
                <span style={prefixStyle("modified")}>{"~"}</span>
                <span style={textStyle}>
                  {entry.wordSpans!.map((span, si) => (
                    <span key={si} style={wordSpanStyle(span.type)}>
                      {span.text}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Styles ───

const instructionStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  textAlign: "center",
  padding: "24px 8px 8px",
};

const instructionSubStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#9ca3af",
  textAlign: "center",
};

const selectorRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 8,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  marginBottom: 4,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 12,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  background: "#f9fafb",
  color: "#1f2937",
  outline: "none",
};

const swapBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  background: "#f9fafb",
  cursor: "pointer",
  color: "#6b7280",
  flexShrink: 0,
};

const statsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  fontSize: 12,
  padding: "4px 0",
};

const diffContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  background: "#fafafa",
  fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
  fontSize: 12,
  lineHeight: 1.6,
};

const textStyle: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

function lineStyle(kind: "equal" | "added" | "removed" | "modified"): React.CSSProperties {
  const bgMap = {
    equal: "transparent",
    added: "rgba(37, 99, 235, 0.08)",
    removed: "rgba(220, 38, 38, 0.08)",
    modified: "rgba(217, 119, 6, 0.06)",
  };
  const borderMap = {
    equal: "3px solid transparent",
    added: "3px solid #2563eb",
    removed: "3px solid #dc2626",
    modified: "3px solid #d97706",
  };
  return {
    display: "flex",
    padding: "1px 8px",
    background: bgMap[kind],
    borderLeft: borderMap[kind],
  };
}

function prefixStyle(kind: "equal" | "added" | "removed" | "modified"): React.CSSProperties {
  const colorMap = {
    equal: "#d1d5db",
    added: "#2563eb",
    removed: "#dc2626",
    modified: "#d97706",
  };
  return {
    display: "inline-block",
    width: 16,
    flexShrink: 0,
    fontWeight: 700,
    color: colorMap[kind],
    userSelect: "none",
  };
}

function wordSpanStyle(type: "equal" | "added" | "removed"): React.CSSProperties {
  if (type === "removed") {
    return {
      background: "rgba(220, 38, 38, 0.18)",
      color: "#dc2626",
      textDecoration: "line-through",
      borderRadius: 2,
    };
  }
  if (type === "added") {
    return {
      background: "rgba(37, 99, 235, 0.18)",
      color: "#2563eb",
      borderRadius: 2,
    };
  }
  return {};
}

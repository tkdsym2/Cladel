import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import { useConsoleStore, type ConsoleEntry } from "../../store/consoleStore";

interface AgentLogPayload {
  level: string;
  source: string;
  message: string;
  detail: string | null;
  timestamp: string;
}

/** Standalone agent console window — listens for backend agent-console-log events. */
export function AgentConsole() {
  const entries = useConsoleStore((s) => s.entries);
  const addEntry = useConsoleStore((s) => s.addEntry);
  const clear = useConsoleStore((s) => s.clear);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Listen for backend events
  useEffect(() => {
    const unlisten = listen<AgentLogPayload>("agent-console-log", (event) => {
      const p = event.payload;
      addEntry({
        level: (p.level as ConsoleEntry["level"]) || "info",
        source: p.source,
        message: p.message,
        detail: p.detail ?? undefined,
        timestamp: p.timestamp,
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addEntry]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries.length, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  return (
    <div style={shellStyle}>
      {/* Title bar */}
      <div style={titleBarStyle}>
        <span style={{ fontWeight: 600, fontSize: 12, color: "#a78bfa" }}>
          Agent Console
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#6b7280" }}>
            {entries.length} entries
          </span>
          <button
            onClick={clear}
            style={clearBtnStyle}
            title="Clear console"
            onMouseEnter={(e) => { e.currentTarget.style.background = "#374151"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <DeleteSweepIcon sx={{ fontSize: 14, color: "#9ca3af" }} />
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div
        ref={containerRef}
        style={logContainerStyle}
        onScroll={handleScroll}
      >
        {entries.length === 0 && (
          <div style={{ color: "#6b7280", fontSize: 12, padding: "20px 12px", textAlign: "center" }}>
            No agent activity yet. Logs will appear here when the Agent processes requests.
          </div>
        )}
        {entries.map((entry) => (
          <LogLine key={entry.id} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: ConsoleEntry }) {
  const [expanded, setExpanded] = useState(false);
  const ts = formatTimestamp(entry.timestamp);
  const levelColor = LEVEL_COLORS[entry.level] || "#d1d5db";
  const sourceColor = SOURCE_COLORS[entry.source] || "#9ca3af";

  return (
    <div
      style={logLineStyle}
      onClick={() => entry.detail && setExpanded((v) => !v)}
      title={entry.detail ? "Click to expand" : undefined}
    >
      <span style={{ color: "#6b7280", fontSize: 10, flexShrink: 0, minWidth: 72, fontFamily: "monospace" }}>
        {ts}
      </span>
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        color: levelColor,
        flexShrink: 0,
        minWidth: 32,
        textTransform: "uppercase",
        fontFamily: "monospace",
      }}>
        {entry.level === "info" ? "INF" : entry.level === "warn" ? "WRN" : "ERR"}
      </span>
      <span style={{
        fontSize: 10,
        color: sourceColor,
        flexShrink: 0,
        minWidth: 100,
        fontFamily: "monospace",
      }}>
        [{entry.source}]
      </span>
      <span style={{
        fontSize: 11,
        color: entry.level === "error" ? "#f87171" : "#e5e7eb",
        flex: 1,
        fontFamily: "monospace",
        wordBreak: "break-word",
      }}>
        {entry.message}
        {entry.detail && !expanded && (
          <span style={{ color: "#6b7280", marginLeft: 4 }}>▸</span>
        )}
      </span>
      {expanded && entry.detail && (
        <div style={detailStyle}>{entry.detail}</div>
      )}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  } catch {
    return "??:??:??";
  }
}

const LEVEL_COLORS: Record<string, string> = {
  info: "#60a5fa",
  warn: "#fbbf24",
  error: "#f87171",
};

const SOURCE_COLORS: Record<string, string> = {
  global_agent: "#a78bfa",
  agent_node: "#34d399",
  comment_agent: "#fbbf24",
  paper_chat: "#38bdf8",
};

// ─── Styles ───

const shellStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  background: "#111827",
  color: "#e5e7eb",
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
};

const titleBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 12px",
  background: "#1f2937",
  borderBottom: "1px solid #374151",
  flexShrink: 0,
};

const clearBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  border: "none",
  borderRadius: 4,
  background: "transparent",
  cursor: "pointer",
  transition: "background 0.1s",
};

const logContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "4px 0",
};

const logLineStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "3px 12px",
  cursor: "default",
  flexWrap: "wrap",
  borderBottom: "1px solid rgba(55, 65, 81, 0.3)",
};

const detailStyle: React.CSSProperties = {
  width: "100%",
  paddingLeft: 120,
  paddingTop: 2,
  paddingBottom: 2,
  fontSize: 10,
  color: "#9ca3af",
  fontFamily: "monospace",
  wordBreak: "break-word",
  whiteSpace: "pre-wrap",
};

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useGraphStore } from "../../store/graphStore";
import * as cmd from "../../lib/tauri-commands";
import { onGraphChanged } from "../../lib/sync-events";
import {
  ContentPullPopover,
  type ConnectedNodeInfo,
} from "./ContentPullPopover";
import { MentionPopover, type MentionItem } from "./MentionPopover";
import { MarkdownPreview } from "./MarkdownPreview";
import type { NodeData, EdgeData, PaperGroupMetadata } from "../../types";

type EditorMode = "write" | "preview";

// ─── Slash command definitions ───

interface SlashCommand {
  id: string;
  label: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: "import", label: "/import", description: "Import content from connected node" },
];

interface NoteEditorWithPullProps {
  nodeId: string;
  layerId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

/**
 * A textarea with slash commands (/import), @ Mention autocomplete,
 * and Markdown preview toggle.
 *
 * Works in both the main window (reads graphStore) and detached windows
 * (falls back to fetching nodes/edges from the backend).
 */
export function NoteEditorWithPull({
  nodeId,
  layerId,
  value,
  onChange,
  placeholder,
  style,
}: NoteEditorWithPullProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("write");

  // Auto-resize textarea to fit content on every value change + mount
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Reset to auto so scrollHeight reflects true content height
    ta.style.height = "auto";
    ta.style.height = Math.max(ta.scrollHeight, 200) + "px";
  }, []);

  // Run on value change
  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  // Also run once on mount (after DOM paint) for pre-existing content
  useEffect(() => {
    requestAnimationFrame(adjustHeight);
  }, [adjustHeight]);

  // Find bar state (Cmd+F / Ctrl+F)
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  const findMatches = useMemo(() => {
    if (!findQuery) return [];
    const matches: number[] = [];
    const lower = value.toLowerCase();
    const q = findQuery.toLowerCase();
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(q, pos);
      if (idx === -1) break;
      matches.push(idx);
      pos = idx + 1;
    }
    return matches;
  }, [value, findQuery]);

  // Navigate to current match
  const navigateToMatch = useCallback((matches: number[], index: number, queryLen: number) => {
    const textarea = textareaRef.current;
    if (!textarea || matches.length === 0 || queryLen === 0) return;
    const safeIndex = ((index % matches.length) + matches.length) % matches.length;
    const matchPos = matches[safeIndex];
    textarea.focus();
    textarea.setSelectionRange(matchPos, matchPos + queryLen);
    const textBefore = value.substring(0, matchPos);
    const lineNumber = textBefore.split("\n").length;
    const computedFontSize = style?.fontSize ?? 13;
    const lineHeight = (typeof computedFontSize === "number" ? computedFontSize : 13) * 1.6;
    const desiredScroll = Math.max(0, (lineNumber - 3) * lineHeight);
    textarea.scrollTop = desiredScroll;
  }, [value, style?.fontSize]);

  useEffect(() => {
    if (findOpen && findMatches.length > 0) {
      navigateToMatch(findMatches, findIndex, findQuery.length);
    }
  }, [findOpen, findMatches, findIndex, findQuery.length, navigateToMatch]);

  useEffect(() => {
    setFindIndex(0);
  }, [findQuery]);

  // Slash command popover state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashPos, setSlashPos] = useState({ x: 0, y: 0 });
  const [slashFocusIndex, setSlashFocusIndex] = useState(0);

  // Content Pull popover state (opened after /import command)
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const cursorPosRef = useRef<number>(0);

  // @ Mention state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionPos, setMentionPos] = useState({ x: 0, y: 0 });
  const [mentionFilter, setMentionFilter] = useState("");
  const mentionStartRef = useRef<number>(-1);

  // Empty-line hint state
  const [showSlashHint, setShowSlashHint] = useState(false);
  const [slashHintPos, setSlashHintPos] = useState({ top: 0, left: 0 });

  // Graph data: prefer store, fall back to backend for detached windows
  const storeDbNodes = useGraphStore((s) => s.dbNodes);
  const storeDbEdges = useGraphStore((s) => s.dbEdges);
  const [fallbackNodes, setFallbackNodes] = useState<NodeData[]>([]);
  const [fallbackEdges, setFallbackEdges] = useState<EdgeData[]>([]);

  const fetchFallback = useCallback(() => {
    Promise.all([
      cmd.getNodesByLayer(layerId),
      cmd.getEdgesByLayer(layerId),
    ]).then(([nodes, edges]) => {
      setFallbackNodes(nodes);
      setFallbackEdges(edges);
    }).catch(() => {});
  }, [layerId]);

  useEffect(() => {
    if (storeDbNodes.length > 0) return;
    fetchFallback();
  }, [layerId, storeDbNodes.length, fetchFallback]);

  useEffect(() => {
    if (storeDbNodes.length > 0) return;
    const unlisten = onGraphChanged(() => {
      fetchFallback();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [storeDbNodes.length, fetchFallback]);

  const dbNodes = storeDbNodes.length > 0 ? storeDbNodes : fallbackNodes;
  const dbEdges = storeDbEdges.length > 0 ? storeDbEdges : fallbackEdges;

  // Compute eligible connected nodes for Content Pull
  const getConnectedNodes = useCallback((): ConnectedNodeInfo[] => {
    const connectedIds = new Set<string>();
    for (const e of dbEdges) {
      if (e.source_node_id === nodeId) connectedIds.add(e.target_node_id);
      if (e.target_node_id === nodeId) connectedIds.add(e.source_node_id);
    }

    const eligible: ConnectedNodeInfo[] = [];
    for (const n of dbNodes) {
      if (!connectedIds.has(n.id)) continue;
      if (
        n.node_type !== "core" &&
        n.node_type !== "paper" &&
        n.node_type !== "user_doc"
      )
        continue;
      eligible.push({
        id: n.id,
        node_type: n.node_type,
        title: n.title,
        display_id: n.display_id,
        content: n.content,
      });
    }

    const order: Record<string, number> = { core: 0, paper: 1, user_doc: 2 };
    eligible.sort(
      (a, b) => (order[a.node_type] ?? 9) - (order[b.node_type] ?? 9),
    );

    return eligible;
  }, [nodeId, dbNodes, dbEdges]);

  // Compute mention items via BFS
  const getMentionItems = useCallback((): MentionItem[] => {
    const MAX_HOPS = 5;

    const adj = new Map<string, string[]>();
    for (const e of dbEdges) {
      if (!adj.has(e.source_node_id)) adj.set(e.source_node_id, []);
      if (!adj.has(e.target_node_id)) adj.set(e.target_node_id, []);
      adj.get(e.source_node_id)!.push(e.target_node_id);
      adj.get(e.target_node_id)!.push(e.source_node_id);
    }

    const distanceMap = new Map<string, number>();
    const queue: [string, number][] = [[nodeId, 0]];
    distanceMap.set(nodeId, 0);

    while (queue.length > 0) {
      const [currentId, dist] = queue.shift()!;
      if (dist >= MAX_HOPS) continue;
      const neighbors = adj.get(currentId) ?? [];
      for (const nId of neighbors) {
        if (!distanceMap.has(nId)) {
          distanceMap.set(nId, dist + 1);
          queue.push([nId, dist + 1]);
        }
      }
    }

    const nodeById = new Map(dbNodes.map((n) => [n.id, n]));

    const items: MentionItem[] = [];
    const seenDisplayIds = new Set<string>();
    const allowedTypes = new Set(["paper", "image"]);

    for (const [nId, dist] of distanceMap) {
      if (dist === 0) continue;
      const n = nodeById.get(nId);
      if (!n || !n.display_id) continue;
      if (!allowedTypes.has(n.node_type) && n.node_type !== "paper_group") continue;

      if (allowedTypes.has(n.node_type) && !seenDisplayIds.has(n.display_id)) {
        seenDisplayIds.add(n.display_id);
        items.push({
          display_id: n.display_id,
          node_type: n.node_type,
          title: n.title,
          distance: dist,
        });
      }

      if (n.node_type === "paper_group" && n.metadata) {
        try {
          const meta = JSON.parse(n.metadata) as PaperGroupMetadata;
          const groupName = meta.group_name || n.title;
          for (const memberId of meta.member_node_ids) {
            const memberNode = nodeById.get(memberId);
            if (
              memberNode?.node_type === "paper" &&
              memberNode.display_id &&
              !seenDisplayIds.has(memberNode.display_id)
            ) {
              seenDisplayIds.add(memberNode.display_id);
              items.push({
                display_id: memberNode.display_id,
                node_type: memberNode.node_type,
                title: memberNode.title,
                group_name: groupName,
                distance: dist,
              });
            }
          }
        } catch {
          // Ignore metadata parse errors
        }
      }
    }

    items.sort((a, b) => {
      const da = a.distance ?? 1;
      const db = b.distance ?? 1;
      if (da !== db) return da - db;
      return a.display_id.localeCompare(b.display_id);
    });

    return items;
  }, [nodeId, dbNodes, dbEdges]);

  // Close popovers when switching nodes
  useEffect(() => {
    setPopoverOpen(false);
    setSlashOpen(false);
    setMentionOpen(false);
  }, [nodeId]);

  // Calculate popover position from textarea cursor
  const calcPopoverPos = useCallback((textarea: HTMLTextAreaElement, cursorPos: number) => {
    const rect = textarea.getBoundingClientRect();
    const textBefore = textarea.value.substring(0, cursorPos);
    const lineNumber = textBefore.split("\n").length;
    const computedFontSize = style?.fontSize ?? 13;
    const lineHeight = (typeof computedFontSize === "number" ? computedFontSize : 13) * 1.6;
    const cursorY = rect.top + Math.min(lineNumber * lineHeight, rect.height - 20);
    return { x: rect.left + 20, y: cursorY };
  }, [style?.fontSize]);

  // Check if cursor is on an empty line and update hint visibility
  const updateSlashHint = useCallback((textarea: HTMLTextAreaElement) => {
    if (slashOpen || popoverOpen || mentionOpen) {
      setShowSlashHint(false);
      return;
    }

    const val = textarea.value;
    const cursorPos = textarea.selectionStart;
    const lineStart = val.lastIndexOf("\n", cursorPos - 1) + 1;
    const lineEnd = val.indexOf("\n", cursorPos);
    const currentLine = val.substring(lineStart, lineEnd === -1 ? val.length : lineEnd);

    if (currentLine.length === 0) {
      // Calculate position relative to the textarea, accounting for border + padding
      const textBefore = val.substring(0, cursorPos);
      const lineNumber = textBefore.split("\n").length;
      const computedFontSize = style?.fontSize ?? 13;
      const fSize = typeof computedFontSize === "number" ? computedFontSize : 13;
      const lineHeight = fSize * 1.6;
      const computedStyles = window.getComputedStyle(textarea);
      const borderTop = parseFloat(computedStyles.borderTopWidth) || 0;
      const paddingTop = parseFloat(computedStyles.paddingTop) || 0;
      const borderLeft = parseFloat(computedStyles.borderLeftWidth) || 0;
      const paddingLeft = parseFloat(computedStyles.paddingLeft) || 0;
      const top = borderTop + paddingTop + (lineNumber - 1) * lineHeight - textarea.scrollTop;
      const left = borderLeft + paddingLeft;
      setSlashHintPos({ top, left });
      setShowSlashHint(true);
    } else {
      setShowSlashHint(false);
    }
  }, [slashOpen, popoverOpen, mentionOpen, style?.fontSize]);

  // Slash key handler + Cmd+F find
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd+F / Ctrl+F → open find bar
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setFindOpen(true);
        const textarea = e.currentTarget;
        const sel = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
        if (sel) setFindQuery(sel);
        requestAnimationFrame(() => findInputRef.current?.select());
        return;
      }

      // While slash popover is open, prevent character input into textarea
      // (navigation keys are handled by the window-level capture handler)
      if (slashOpen) {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter" && e.key !== "Escape") {
          e.preventDefault();
        }
        return;
      }

      // Don't handle / when another popover is open
      if (popoverOpen || mentionOpen) return;
      if (e.key !== "/") return;

      const textarea = e.currentTarget;
      const val = textarea.value;
      const cursorPos = textarea.selectionStart;

      // Determine current line boundaries
      const lineStart = val.lastIndexOf("\n", cursorPos - 1) + 1;
      const lineEnd = val.indexOf("\n", cursorPos);
      const currentLine = val.substring(
        lineStart,
        lineEnd === -1 ? val.length : lineEnd,
      );

      // Only trigger on completely empty lines
      if (currentLine.length !== 0) return;

      // Prevent "/" insertion
      e.preventDefault();

      cursorPosRef.current = cursorPos;
      const pos = calcPopoverPos(textarea, cursorPos);
      setSlashPos(pos);
      setSlashFocusIndex(0);
      setSlashOpen(true);
      setShowSlashHint(false);
    },
    [popoverOpen, mentionOpen, slashOpen, calcPopoverPos],
  );

  // Handle slash command selection
  const handleSlashSelect = useCallback(
    (command: SlashCommand) => {
      setSlashOpen(false);

      if (command.id === "import") {
        const eligible = getConnectedNodes();
        if (eligible.length === 0) return;
        setPopoverPos(slashPos);
        setPopoverOpen(true);
      }
    },
    [getConnectedNodes, slashPos],
  );

  // Slash command keyboard navigation
  useEffect(() => {
    if (!slashOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSlashFocusIndex((i) => (i + 1) % SLASH_COMMANDS.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSlashFocusIndex((i) => (i - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length);
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          handleSlashSelect(SLASH_COMMANDS[slashFocusIndex]);
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          setSlashOpen(false);
          requestAnimationFrame(() => textareaRef.current?.focus());
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [slashOpen, slashFocusIndex, handleSlashSelect]);

  // Click-outside for slash command popover
  const slashContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!slashOpen) return;

    const cleanupRef = { current: null as (() => void) | null };
    const timerId = window.setTimeout(() => {
      const handleMouseDown = (e: MouseEvent) => {
        if (slashContainerRef.current && !slashContainerRef.current.contains(e.target as Node)) {
          setSlashOpen(false);
        }
      };
      window.addEventListener("mousedown", handleMouseDown);
      cleanupRef.current = () => window.removeEventListener("mousedown", handleMouseDown);
    }, 50);

    return () => {
      window.clearTimeout(timerId);
      cleanupRef.current?.();
    };
  }, [slashOpen]);

  // Handle textarea onChange: detect @ trigger and update mention filter
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      const textarea = e.target;
      const cursorPos = textarea.selectionStart;

      if (mentionOpen) {
        const atPos = mentionStartRef.current;
        if (atPos >= 0 && cursorPos > atPos) {
          const filterText = newValue.substring(atPos + 1, cursorPos);
          if (/[\s\n]/.test(filterText) || cursorPos <= atPos) {
            setMentionOpen(false);
            mentionStartRef.current = -1;
          } else {
            setMentionFilter(filterText);
          }
        } else {
          setMentionOpen(false);
          mentionStartRef.current = -1;
        }
        return;
      }

      // Check if '@' was just typed
      if (cursorPos > 0 && newValue[cursorPos - 1] === "@") {
        if (cursorPos === 1 || !/[a-zA-Z0-9_]/.test(newValue[cursorPos - 2])) {
          const items = getMentionItems();
          if (items.length > 0) {
            mentionStartRef.current = cursorPos - 1;
            setMentionFilter("");
            setMentionPos(calcPopoverPos(textarea, cursorPos));
            setMentionOpen(true);
          }
        }
      }

      // Update slash hint after value change
      requestAnimationFrame(() => updateSlashHint(textarea));
    },
    [onChange, mentionOpen, getMentionItems, calcPopoverPos, updateSlashHint],
  );

  // Update hint on cursor position change (click, arrow keys)
  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) updateSlashHint(textarea);
  }, [updateSlashHint]);

  // Handle content selection from Content Pull popover
  const handlePullSelect = useCallback(
    (text: string) => {
      setPopoverOpen(false);

      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = cursorPosRef.current;

      const newValue =
        value.substring(0, cursorPos) + text + value.substring(cursorPos);
      const newCursorPos = cursorPos + text.length;

      onChange(newValue);

      requestAnimationFrame(() => {
        textarea.selectionStart = newCursorPos;
        textarea.selectionEnd = newCursorPos;
        textarea.focus();
      });
    },
    [value, onChange],
  );

  const handlePullClose = useCallback(() => {
    setPopoverOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  // Handle mention selection — {@displayId} for papers/edits, {{@displayId}} for images
  const handleMentionSelect = useCallback(
    (displayId: string, nodeType: string) => {
      setMentionOpen(false);

      const textarea = textareaRef.current;
      if (!textarea) return;

      const atPos = mentionStartRef.current;
      if (atPos < 0) return;

      const cursorPos = textarea.selectionStart;
      const before = value.substring(0, atPos);
      const after = value.substring(cursorPos);

      const isInsideCiteGroup = (() => {
        let depth = 0;
        for (let i = atPos - 1; i >= 0; i--) {
          if (value[i] === '}') depth++;
          else if (value[i] === '{') {
            if (depth > 0) {
              depth--;
            } else {
              const between = value.substring(i + 1, atPos);
              return between.includes('@');
            }
          }
        }
        return false;
      })();

      let insertion: string;
      if (isInsideCiteGroup) {
        insertion = "@" + displayId;
      } else if (nodeType === "image") {
        insertion = "{{@" + displayId + "}}";
      } else {
        insertion = "{@" + displayId + "}";
      }

      const newValue = before + insertion + after;
      const newCursorPos = before.length + insertion.length;

      mentionStartRef.current = -1;
      onChange(newValue);

      requestAnimationFrame(() => {
        textarea.selectionStart = newCursorPos;
        textarea.selectionEnd = newCursorPos;
        textarea.focus();
      });
    },
    [value, onChange],
  );

  const handleMentionClose = useCallback(() => {
    setMentionOpen(false);
    mentionStartRef.current = -1;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const handleFindKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setFindOpen(false);
      textareaRef.current?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        setFindIndex((i) => i - 1);
      } else {
        setFindIndex((i) => i + 1);
      }
    }
  }, []);

  const displayIndex = findMatches.length > 0
    ? ((findIndex % findMatches.length) + findMatches.length) % findMatches.length + 1
    : 0;

  const editorFontSize = typeof style?.fontSize === "number" ? style.fontSize : 13;

  // Clamp slash command popover position
  const slashPopoverWidth = 260;
  const slashPopoverMaxHeight = 200;
  const slashMargin = 8;
  const slashClampedX = Math.min(
    Math.max(slashMargin, slashPos.x),
    window.innerWidth - slashPopoverWidth - slashMargin,
  );
  const slashClampedY = Math.min(
    Math.max(slashMargin, slashPos.y),
    window.innerHeight - slashPopoverMaxHeight - slashMargin,
  );

  return (
    <div style={{ position: "relative" }}>
      {/* Write / Preview toggle */}
      <div style={modeToggleBarStyle}>
        <button
          onClick={() => setEditorMode("write")}
          style={editorMode === "write" ? modeTabActiveStyle : modeTabStyle}
        >
          Write
        </button>
        <button
          onClick={() => setEditorMode("preview")}
          style={editorMode === "preview" ? modeTabActiveStyle : modeTabStyle}
        >
          Preview
        </button>
      </div>

      {editorMode === "write" && (
        <>
          {findOpen && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0",
              fontSize: 12,
            }}>
              <input
                ref={findInputRef}
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={handleFindKeyDown}
                placeholder="Find..."
                style={{
                  flex: 1, padding: "3px 6px", fontSize: 12,
                  border: "1px solid #cbd5e1", borderRadius: 3,
                  outline: "none", minWidth: 0,
                }}
              />
              <span style={{ color: "#64748b", whiteSpace: "nowrap", fontSize: 11 }}>
                {findQuery ? `${displayIndex}/${findMatches.length}` : ""}
              </span>
              <button
                onClick={() => setFindIndex((i) => i - 1)}
                disabled={findMatches.length === 0}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: 14, color: "#475569", opacity: findMatches.length === 0 ? 0.3 : 1 }}
                title="Previous (Shift+Enter)"
              >&#9650;</button>
              <button
                onClick={() => setFindIndex((i) => i + 1)}
                disabled={findMatches.length === 0}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: 14, color: "#475569", opacity: findMatches.length === 0 ? 0.3 : 1 }}
                title="Next (Enter)"
              >&#9660;</button>
              <button
                onClick={() => { setFindOpen(false); textareaRef.current?.focus(); }}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: 14, color: "#475569" }}
                title="Close (Esc)"
              >&#10005;</button>
            </div>
          )}
          <div style={{ position: "relative" }}>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onSelect={handleSelect}
              onFocus={() => {
                requestAnimationFrame(() => {
                  if (textareaRef.current) updateSlashHint(textareaRef.current);
                });
              }}
              onBlur={() => setShowSlashHint(false)}
              placeholder={placeholder}
              style={{
                ...style,
                width: "100%",
                boxSizing: "border-box",
                overflow: "hidden",
                resize: "none",
                minHeight: 200,
                height: "auto",
                flex: "none",
              }}
            />
            {/* Empty-line slash hint overlay */}
            {showSlashHint && (
              <div
                style={{
                  position: "absolute",
                  top: slashHintPos.top,
                  left: slashHintPos.left,
                  pointerEvents: "none",
                  fontSize: editorFontSize,
                  lineHeight: 1.6,
                  color: "#c0c0c0",
                  whiteSpace: "nowrap",
                  fontFamily: style?.fontFamily ?? "inherit",
                }}
              >
                Type / for commands
              </div>
            )}
          </div>

          {/* Slash command popover */}
          {slashOpen && (
            <div
              ref={slashContainerRef}
              style={{
                position: "fixed",
                left: slashClampedX,
                top: slashClampedY,
                zIndex: 1000,
                width: slashPopoverWidth,
                maxHeight: slashPopoverMaxHeight,
                background: "#ffffff",
                color: "#1f2937",
                borderRadius: 10,
                boxShadow: "0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)",
                userSelect: "none",
                animation: "contentPullIn 120ms ease-out",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <style>{`
                @keyframes contentPullIn {
                  from { opacity: 0; transform: scale(0.95) translateY(-4px); }
                  to { opacity: 1; transform: scale(1) translateY(0); }
                }
              `}</style>
              <div style={{
                padding: "10px 14px 6px",
                borderBottom: "1px solid #e5e7eb",
                fontWeight: 600,
                fontSize: 12,
                color: "#6b7280",
              }}>
                Commands
              </div>
              <div style={{ padding: "4px 6px" }}>
                {SLASH_COMMANDS.map((cmd, idx) => (
                  <div
                    key={cmd.id}
                    onClick={() => handleSlashSelect(cmd)}
                    onMouseEnter={() => setSlashFocusIndex(idx)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 7,
                      cursor: "pointer",
                      background: idx === slashFocusIndex ? "#f3f4f6" : "transparent",
                      transition: "background 0.1s",
                    }}
                  >
                    <span style={{
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      color: "#d97706",
                    }}>
                      {cmd.label}
                    </span>
                    <span style={{
                      fontSize: 11,
                      color: "#9ca3af",
                    }}>
                      {cmd.description}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                padding: "6px 14px 10px",
                borderTop: "1px solid #e5e7eb",
                fontSize: 10,
                color: "#9ca3af",
              }}>
                <span>{"\u2191\u2193"} Navigate</span>
                <span style={{ margin: "0 6px", opacity: 0.3 }}>{"\u00b7"}</span>
                <span>Enter Select</span>
                <span style={{ margin: "0 6px", opacity: 0.3 }}>{"\u00b7"}</span>
                <span>Esc Cancel</span>
              </div>
            </div>
          )}

          <ContentPullPopover
            isOpen={popoverOpen}
            position={popoverPos}
            connectedNodes={getConnectedNodes()}
            onSelect={handlePullSelect}
            onClose={handlePullClose}
          />
          <MentionPopover
            isOpen={mentionOpen}
            position={mentionPos}
            items={getMentionItems()}
            filter={mentionFilter}
            onSelect={handleMentionSelect}
            onClose={handleMentionClose}
          />
        </>
      )}

      {editorMode === "preview" && (
        <div style={{
          flex: 1, minHeight: 0, overflow: "auto",
          padding: "8px 12px",
          border: "1px solid #e2e8f0",
          borderRadius: 4,
          background: "#fff",
        }}>
          {value ? (
            <MarkdownPreview content={value} fontSize={editorFontSize} />
          ) : (
            <span style={{ color: "#9ca3af", fontStyle: "italic", fontSize: editorFontSize }}>
              Nothing to preview
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const modeToggleBarStyle: React.CSSProperties = {
  display: "flex",
  gap: 0,
  borderBottom: "1px solid #e2e8f0",
  marginBottom: 4,
};

const modeTabStyle: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: 12,
  fontWeight: 500,
  border: "none",
  background: "transparent",
  color: "#6b7280",
  cursor: "pointer",
  borderBottom: "2px solid transparent",
};

const modeTabActiveStyle: React.CSSProperties = {
  ...modeTabStyle,
  color: "#d97706",
  borderBottom: "2px solid #d97706",
  fontWeight: 600,
};

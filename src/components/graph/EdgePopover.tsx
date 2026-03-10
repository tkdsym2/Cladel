import { useState, useEffect, useCallback, useRef } from "react";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SendIcon from "@mui/icons-material/Send";
import { useGraphStore } from "../../store/graphStore";
import { useUserStore } from "../../store/userStore";
import type { EdgeComment } from "../../types";
import * as cmd from "../../lib/tauri-commands";

export function EdgePopover() {
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId);
  const getDbEdge = useGraphStore((s) => s.getDbEdge);
  const updateEdgeData = useGraphStore((s) => s.updateEdgeData);
  const removeEdge = useGraphStore((s) => s.removeEdge);
  const setSelectedEdgeId = useGraphStore((s) => s.setSelectedEdgeId);
  const updateEdgeCommentCount = useGraphStore(
    (s) => s.updateEdgeCommentCount,
  );

  const edge = selectedEdgeId ? getDbEdge(selectedEdgeId) : undefined;

  const [weight, setWeight] = useState(3);
  const [comments, setComments] = useState<EdgeComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);

  // Load edge data and comments when edge changes
  useEffect(() => {
    if (edge) {
      setWeight(edge.weight);
      setLoading(true);
      cmd
        .getEdgeComments(edge.id)
        .then((c) => setComments(c))
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      setComments([]);
    }
  }, [edge]);

  // Auto-scroll to bottom when comments change
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [comments]);

  const handleSaveWeight = useCallback(async () => {
    if (!selectedEdgeId) return;
    await updateEdgeData({ id: selectedEdgeId, weight });
  }, [selectedEdgeId, weight, updateEdgeData]);

  const handleDelete = useCallback(async () => {
    if (!selectedEdgeId) return;
    await removeEdge(selectedEdgeId);
  }, [selectedEdgeId, removeEdge]);

  const handleAddComment = useCallback(async () => {
    if (!selectedEdgeId || !newComment.trim()) return;
    try {
      const u = useUserStore.getState();
      const comment = await cmd.addEdgeComment(
        selectedEdgeId,
        newComment.trim(),
        "user",
        u.userId,
        u.userName,
      );
      setComments((prev) => [...prev, comment]);
      setNewComment("");
      updateEdgeCommentCount(selectedEdgeId, 1);
    } catch (err) {
      console.error("Failed to add comment:", err);
    }
  }, [selectedEdgeId, newComment, updateEdgeCommentCount]);

  const handleEditComment = useCallback(
    async (commentId: string) => {
      if (!editContent.trim() || !selectedEdgeId) return;
      try {
        const updated = await cmd.updateEdgeComment(
          commentId,
          editContent.trim(),
        );
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? updated : c)),
        );
        setEditingId(null);
        setEditContent("");
      } catch (err) {
        console.error("Failed to update comment:", err);
      }
    },
    [editContent, selectedEdgeId],
  );

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      if (!selectedEdgeId) return;
      try {
        await cmd.deleteEdgeComment(commentId);
        setComments((prev) => prev.filter((c) => c.id !== commentId));
        updateEdgeCommentCount(selectedEdgeId, -1);
      } catch (err) {
        console.error("Failed to delete comment:", err);
      }
    },
    [selectedEdgeId, updateEdgeCommentCount],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleAddComment();
      }
    },
    [handleAddComment],
  );

  if (!edge) return null;

  return (
    <div style={overlayStyle} onClick={() => setSelectedEdgeId(null)}>
      <div style={popoverStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              color: "#111827",
            }}
          >
            Edit Connection
          </h3>
          <button
            onClick={() => setSelectedEdgeId(null)}
            style={closeBtnStyle}
          >
            <CloseIcon sx={{ fontSize: 20 }} />
          </button>
        </div>

        {/* Delete connection — prominent at top */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 14,
            paddingBottom: 10,
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          <button onClick={handleDelete} style={deleteBtnStyle}>
            Delete Connection
          </button>
        </div>

        {/* Weight slider */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Weight: {weight}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>1</span>
            <input
              type="range"
              min={1}
              max={5}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              onMouseUp={handleSaveWeight}
              onKeyUp={handleSaveWeight}
              style={{ flex: 1, accentColor: "#1e40af" }}
            />
            <span style={{ fontSize: 11, color: "#9ca3af" }}>5</span>
          </div>
          <div style={{ display: "flex", gap: 2, marginTop: 6 }}>
            {[1, 2, 3, 4, 5].map((w) => (
              <div
                key={w}
                style={{
                  flex: 1,
                  height: w * 2,
                  background: w <= weight ? "#1e40af" : "#e5e7eb",
                  borderRadius: 1,
                }}
              />
            ))}
          </div>
        </div>

        {/* Conversation thread */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>
            Thread{" "}
            <span style={{ fontWeight: 400, color: "#9ca3af" }}>
              ({comments.length})
            </span>
          </label>
          <div ref={threadRef} style={threadContainerStyle}>
            {loading && (
              <div
                style={{
                  padding: 12,
                  textAlign: "center",
                  color: "#9ca3af",
                  fontSize: 12,
                }}
              >
                Loading...
              </div>
            )}
            {!loading && comments.length === 0 && (
              <div
                style={{
                  padding: 16,
                  textAlign: "center",
                  color: "#9ca3af",
                  fontSize: 12,
                }}
              >
                No comments yet. Start a conversation about this connection.
              </div>
            )}
            {comments.map((c) => (
              <div key={c.id} style={commentCardStyle(c.author_type)}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={authorBadgeStyle(c.author_type)}>
                      {c.author_type === "agent"
                        ? "AI"
                        : c.creator_user_id && c.creator_user_id === useUserStore.getState().userId
                          ? "You"
                          : c.creator_user_name || "You"}
                    </span>
                    <span style={{ fontSize: 10, color: "#9ca3af" }}>
                      {formatTimestamp(c.created_at)}
                    </span>
                  </div>
                  {c.author_type === "user" && editingId !== c.id && (
                    <div style={{ display: "flex", gap: 2 }}>
                      <button
                        onClick={() => {
                          setEditingId(c.id);
                          setEditContent(c.content);
                        }}
                        style={iconBtnStyle}
                        title="Edit"
                      >
                        <EditIcon sx={{ fontSize: 12 }} />
                      </button>
                      <button
                        onClick={() => handleDeleteComment(c.id)}
                        style={iconBtnStyle}
                        title="Delete"
                      >
                        <DeleteIcon sx={{ fontSize: 12 }} />
                      </button>
                    </div>
                  )}
                </div>
                {editingId === c.id ? (
                  <div>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={2}
                      style={editTextareaStyle}
                      autoFocus
                    />
                    <div
                      style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}
                    >
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditContent("");
                        }}
                        style={cancelBtnStyle}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleEditComment(c.id)}
                        style={saveBtnStyle}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#374151",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.4,
                    }}
                  >
                    {c.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* New comment input */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ position: "relative" }}>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment... (Enter to send)"
              rows={2}
              style={inputTextareaStyle}
            />
            <button
              onClick={handleAddComment}
              disabled={!newComment.trim()}
              style={{
                ...sendBtnStyle,
                opacity: newComment.trim() ? 1 : 0.4,
              }}
              title="Send"
            >
              <SendIcon sx={{ fontSize: 12 }} />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }) +
      " " +
      d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
  } catch {
    return ts;
  }
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1500,
  background: "rgba(0,0,0,0.2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const popoverStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 10,
  padding: 20,
  width: 380,
  maxWidth: "90vw",
  maxHeight: "90vh",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};

const closeBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 22,
  cursor: "pointer",
  color: "#9ca3af",
  lineHeight: 1,
  padding: "0 4px",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 6,
};

const threadContainerStyle: React.CSSProperties = {
  maxHeight: 260,
  overflowY: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "#fafafa",
};

function commentCardStyle(authorType: string): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderBottom: "1px solid #f3f4f6",
    background: authorType === "agent" ? "#f5f3ff" : "transparent",
  };
}

function authorBadgeStyle(authorType: string): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 4,
    background: authorType === "user" ? "#dbeafe" : "#ede9fe",
    color: authorType === "user" ? "#2563eb" : "#7c3aed",
  };
}

const iconBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12,
  padding: "2px 4px",
  color: "#9ca3af",
  lineHeight: 1,
};

const editTextareaStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 12,
  padding: 6,
  border: "1px solid #d1d5db",
  borderRadius: 4,
  resize: "vertical",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "3px 10px",
  background: "#f3f4f6",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  fontSize: 11,
  cursor: "pointer",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "3px 10px",
  background: "#1e40af",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

const inputTextareaStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 12,
  padding: "8px 36px 8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  resize: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const sendBtnStyle: React.CSSProperties = {
  position: "absolute",
  right: 6,
  bottom: 6,
  border: "none",
  background: "#1e40af",
  color: "#fff",
  width: 24,
  height: 24,
  borderRadius: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
};

const deleteBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "#fef2f2",
  color: "#dc2626",
  border: "1px solid #fecaca",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
};

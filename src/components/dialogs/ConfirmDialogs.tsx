import { type MouseEvent } from "react";

// ─── Shared styles ───

const confirmOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2000,
  background: "rgba(0,0,0,0.3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const confirmDialogStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 10,
  padding: 24,
  width: 400,
  maxWidth: "90vw",
  boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
};

const confirmCancelBtnStyle: React.CSSProperties = {
  padding: "7px 18px",
  background: "#f3f4f6",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const confirmDeleteBtnStyle: React.CSSProperties = {
  padding: "7px 18px",
  background: "#dc2626",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const unsavedSaveBtnStyle: React.CSSProperties = {
  padding: "7px 18px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

// ─── Dialogs ───

export function DeleteConfirmDialog({
  nodeTitle,
  onConfirm,
  onCancel,
}: {
  nodeTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={confirmOverlayStyle} onClick={onCancel}>
      <div style={confirmDialogStyle} onClick={(e: MouseEvent) => e.stopPropagation()}>
        <h3
          style={{
            margin: "0 0 12px",
            fontSize: 15,
            fontWeight: 700,
            color: "#111827",
          }}
        >
          Delete Node
        </h3>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "#4b5563",
            lineHeight: 1.5,
          }}
        >
          {`Delete \u201C${nodeTitle}\u201D? You can undo with \u2318Z.`}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={confirmCancelBtnStyle}>
            Cancel
          </button>
          <button onClick={onConfirm} style={confirmDeleteBtnStyle}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export function BatchDeleteConfirmDialog({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={confirmOverlayStyle} onClick={onCancel}>
      <div style={confirmDialogStyle} onClick={(e: MouseEvent) => e.stopPropagation()}>
        <h3
          style={{
            margin: "0 0 12px",
            fontSize: 15,
            fontWeight: 700,
            color: "#111827",
          }}
        >
          Delete {count} Nodes
        </h3>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "#4b5563",
            lineHeight: 1.5,
          }}
        >
          Delete {count} selected nodes? You can undo with {"\u2318"}Z.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={confirmCancelBtnStyle}>
            Cancel
          </button>
          <button onClick={onConfirm} style={confirmDeleteBtnStyle}>
            Delete All
          </button>
        </div>
      </div>
    </div>
  );
}

export function EdgeDeleteConfirmDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={confirmOverlayStyle} onClick={onCancel}>
      <div style={confirmDialogStyle} onClick={(e: MouseEvent) => e.stopPropagation()}>
        <h3
          style={{
            margin: "0 0 12px",
            fontSize: 15,
            fontWeight: 700,
            color: "#111827",
          }}
        >
          Delete Connection
        </h3>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "#4b5563",
            lineHeight: 1.5,
          }}
        >
          Delete this connection and its annotations? You can undo with {"\u2318"}Z.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={confirmCancelBtnStyle}>
            Cancel
          </button>
          <button onClick={onConfirm} style={confirmDeleteBtnStyle}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export function UnsavedChangesDialog({
  onSave,
  onDontSave,
  onCancel,
}: {
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={confirmOverlayStyle} onClick={onCancel}>
      <div style={confirmDialogStyle} onClick={(e: MouseEvent) => e.stopPropagation()}>
        <h3
          style={{
            margin: "0 0 12px",
            fontSize: 15,
            fontWeight: 700,
            color: "#111827",
          }}
        >
          Unsaved Changes
        </h3>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "#4b5563",
            lineHeight: 1.5,
          }}
        >
          You have unsaved changes. Would you like to save before continuing?
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={confirmCancelBtnStyle}>
            Cancel
          </button>
          <button onClick={onDontSave} style={confirmCancelBtnStyle}>
            Don't Save
          </button>
          <button onClick={onSave} style={unsavedSaveBtnStyle}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

import { type MouseEvent } from "react";
import { useT } from "../../lib/i18n";

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
  const t = useT();
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
          {t({ en: "Delete Node", ja: "\u30CE\u30FC\u30C9\u3092\u524A\u9664" })}
        </h3>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "#4b5563",
            lineHeight: 1.5,
          }}
        >
          {t(
            {
              en: "Delete \u201C{name}\u201D? You can undo with \u2318Z.",
              ja: "\u300C{name}\u300D\u3092\u524A\u9664\u3057\u307E\u3059\u304B?\u2318Z\u3067\u53D6\u308A\u6D88\u305B\u307E\u3059\u3002",
            },
            { name: nodeTitle },
          )}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={confirmCancelBtnStyle}>
            {t({ en: "Cancel", ja: "\u30AD\u30E3\u30F3\u30BB\u30EB" })}
          </button>
          <button onClick={onConfirm} style={confirmDeleteBtnStyle}>
            {t({ en: "Delete", ja: "\u524A\u9664" })}
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
  const t = useT();
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
          {t({ en: "Delete {count} Nodes", ja: "{count}\u500b\u306e\u30ce\u30fc\u30c9\u3092\u524a\u9664" }, { count })}
        </h3>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "#4b5563",
            lineHeight: 1.5,
          }}
        >
          {t(
            {
              en: "Delete {count} selected nodes? You can undo with \u2318Z.",
              ja: "\u9078\u629e\u3057\u305f{count}\u500b\u306e\u30ce\u30fc\u30c9\u3092\u524a\u9664\u3057\u307e\u3059\u304b?\u2318Z\u3067\u53d6\u308a\u6d88\u305b\u307e\u3059\u3002",
            },
            { count },
          )}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={confirmCancelBtnStyle}>
            {t({ en: "Cancel", ja: "\u30ad\u30e3\u30f3\u30bb\u30eb" })}
          </button>
          <button onClick={onConfirm} style={confirmDeleteBtnStyle}>
            {t({ en: "Delete All", ja: "\u3059\u3079\u3066\u524a\u9664" })}
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
  const t = useT();
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
          {t({ en: "Delete Connection", ja: "\u63a5\u7d9a\u3092\u524a\u9664" })}
        </h3>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "#4b5563",
            lineHeight: 1.5,
          }}
        >
          {t({
            en: "Delete this connection and its annotations? You can undo with \u2318Z.",
            ja: "\u3053\u306e\u63a5\u7d9a\u3068\u6ce8\u91c8\u3092\u524a\u9664\u3057\u307e\u3059\u304b?\u2318Z\u3067\u53d6\u308a\u6d88\u305b\u307e\u3059\u3002",
          })}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={confirmCancelBtnStyle}>
            {t({ en: "Cancel", ja: "\u30ad\u30e3\u30f3\u30bb\u30eb" })}
          </button>
          <button onClick={onConfirm} style={confirmDeleteBtnStyle}>
            {t({ en: "Delete", ja: "\u524a\u9664" })}
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
  const t = useT();
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
          {t({ en: "Unsaved Changes", ja: "未保存の変更" })}
        </h3>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "#4b5563",
            lineHeight: 1.5,
          }}
        >
          {t({
            en: "You have unsaved changes. Would you like to save before continuing?",
            ja: "未保存の変更があります。続行する前に保存しますか?",
          })}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={confirmCancelBtnStyle}>
            {t({ en: "Cancel", ja: "キャンセル" })}
          </button>
          <button onClick={onDontSave} style={confirmCancelBtnStyle}>
            {t({ en: "Don't Save", ja: "保存しない" })}
          </button>
          <button onClick={onSave} style={unsavedSaveBtnStyle}>
            {t({ en: "Save", ja: "保存" })}
          </button>
        </div>
      </div>
    </div>
  );
}

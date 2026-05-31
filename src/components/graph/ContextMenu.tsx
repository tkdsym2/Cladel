import { useCallback } from "react";
import AddIcon from "@mui/icons-material/Add";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import DeleteIcon from "@mui/icons-material/Delete";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import CloseIcon from "@mui/icons-material/Close";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import LayersClearIcon from "@mui/icons-material/LayersClear";
import { useT } from "../../lib/i18n";

interface ContextMenuProps {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  onClose: () => void;
  onAddNoteNode: (x: number, y: number) => void;
  onAddAgentNode: (x: number, y: number) => void;
  onAddExportNode: (x: number, y: number) => void;
  onImportFile: (x: number, y: number) => void;
  /** If set, the context menu was opened on a specific node */
  nodeId?: string | null;
  nodeType?: string | null;
  onDeleteNode?: (nodeId: string) => void;
  /** If set, the context menu was opened on a specific edge */
  edgeId?: string | null;
  onSplitEdge?: (edgeId: string) => void;
  /** Junction-specific: dissolve a junction node */
  onDissolveJunction?: (nodeId: string) => void;
  /** Junction-specific: hard-delete a junction node */
  onDeleteJunction?: (nodeId: string) => void;
  /** Paper group operations */
  isGroupExpanded?: boolean;
  onExpandGroup?: (nodeId: string) => void;
  onCollapseGroup?: (nodeId: string) => void;
  onUngroupPapers?: (nodeId: string) => void;
}

export function ContextMenu({
  x,
  y,
  flowX,
  flowY,
  onClose,
  onAddNoteNode,
  onAddAgentNode,
  onAddExportNode,
  onImportFile,
  nodeId,
  nodeType,
  onDeleteNode,
  edgeId,
  onSplitEdge,
  onDissolveJunction,
  onDeleteJunction,
  isGroupExpanded,
  onExpandGroup,
  onCollapseGroup,
  onUngroupPapers,
}: ContextMenuProps) {
  const t = useT();

  const handleAddNote = useCallback(() => {
    onAddNoteNode(flowX, flowY);
    onClose();
  }, [flowX, flowY, onAddNoteNode, onClose]);

  const handleAddAgentNode = useCallback(() => {
    onAddAgentNode(flowX, flowY);
    onClose();
  }, [flowX, flowY, onAddAgentNode, onClose]);

  const handleAddExportNode = useCallback(() => {
    onAddExportNode(flowX, flowY);
    onClose();
  }, [flowX, flowY, onAddExportNode, onClose]);

  const handleImportFile = useCallback(() => {
    onImportFile(flowX, flowY);
    onClose();
  }, [flowX, flowY, onImportFile, onClose]);

  const handleDelete = useCallback(() => {
    if (nodeId && onDeleteNode) {
      onDeleteNode(nodeId);
    }
    onClose();
  }, [nodeId, onDeleteNode, onClose]);

  const handleSplitEdge = useCallback(() => {
    if (edgeId && onSplitEdge) {
      onSplitEdge(edgeId);
    }
    onClose();
  }, [edgeId, onSplitEdge, onClose]);

  const handleDissolveJunction = useCallback(() => {
    if (nodeId && onDissolveJunction) {
      onDissolveJunction(nodeId);
    }
    onClose();
  }, [nodeId, onDissolveJunction, onClose]);

  const handleDeleteJunction = useCallback(() => {
    if (nodeId && onDeleteJunction) {
      onDeleteJunction(nodeId);
    }
    onClose();
  }, [nodeId, onDeleteJunction, onClose]);

  const handleExpandGroup = useCallback(() => {
    if (nodeId && onExpandGroup) onExpandGroup(nodeId);
    onClose();
  }, [nodeId, onExpandGroup, onClose]);

  const handleCollapseGroup = useCallback(() => {
    if (nodeId && onCollapseGroup) onCollapseGroup(nodeId);
    onClose();
  }, [nodeId, onCollapseGroup, onClose]);

  const handleUngroupPapers = useCallback(() => {
    if (nodeId && onUngroupPapers) onUngroupPapers(nodeId);
    onClose();
  }, [nodeId, onUngroupPapers, onClose]);

  const isDeletable = nodeType === "paper" || nodeType === "user_doc" || nodeType === "image" || nodeType === "agent" || nodeType === "export" || nodeType === "compare" || nodeType === "title" || nodeType === "table";
  const isDeletedPlaceholder = nodeType === "deleted";
  const isJunction = nodeType === "junction";

  return (
    <div
      style={{
        position: "fixed",
        top: y,
        left: x,
        zIndex: 1000,
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        padding: "4px 0",
        minWidth: "180px",
      }}
      onMouseLeave={onClose}
    >
      <button
        onClick={handleAddNote}
        style={itemStyle}
        onMouseEnter={(e) =>
          Object.assign(e.currentTarget.style, itemHoverStyle)
        }
        onMouseLeave={(e) =>
          Object.assign(e.currentTarget.style, itemStyle)
        }
      >
        <AddIcon sx={{ fontSize: 16, mr: 1 }} />
        {t({ en: "Add Edit Node", ja: "編集ノードを追加" })}
      </button>
      <button
        onClick={handleImportFile}
        style={itemStyle}
        onMouseEnter={(e) =>
          Object.assign(e.currentTarget.style, itemHoverStyle)
        }
        onMouseLeave={(e) =>
          Object.assign(e.currentTarget.style, itemStyle)
        }
      >
        <FileUploadIcon sx={{ fontSize: 16, mr: 1 }} />
        {t({ en: "Import File", ja: "ファイルをインポート" })}
      </button>
      <button
        onClick={handleAddAgentNode}
        style={itemStyle}
        onMouseEnter={(e) =>
          Object.assign(e.currentTarget.style, itemHoverStyle)
        }
        onMouseLeave={(e) =>
          Object.assign(e.currentTarget.style, itemStyle)
        }
      >
        <SmartToyIcon sx={{ fontSize: 16, mr: 1 }} />
        {t({ en: "Add Agent Node", ja: "エージェントノードを追加" })}
      </button>
      <button
        onClick={handleAddExportNode}
        style={itemStyle}
        onMouseEnter={(e) =>
          Object.assign(e.currentTarget.style, itemHoverStyle)
        }
        onMouseLeave={(e) =>
          Object.assign(e.currentTarget.style, itemStyle)
        }
      >
        <SaveAltIcon sx={{ fontSize: 16, mr: 1 }} />
        {t({ en: "Add Export Node", ja: "エクスポートノードを追加" })}
      </button>
      {isDeletable && (
        <>
          <div style={separatorStyle} />
          <button
            onClick={handleDelete}
            style={deleteItemStyle}
            onMouseEnter={(e) =>
              Object.assign(e.currentTarget.style, deleteItemHoverStyle)
            }
            onMouseLeave={(e) =>
              Object.assign(e.currentTarget.style, deleteItemStyle)
            }
          >
            <DeleteIcon sx={{ fontSize: 16, mr: 1 }} />
            {t({ en: "Delete Node", ja: "ノードを削除" })}
          </button>
        </>
      )}
      {isDeletedPlaceholder && (
        <>
          <div style={separatorStyle} />
          <button
            onClick={handleDelete}
            style={deleteItemStyle}
            onMouseEnter={(e) =>
              Object.assign(e.currentTarget.style, deleteItemHoverStyle)
            }
            onMouseLeave={(e) =>
              Object.assign(e.currentTarget.style, deleteItemStyle)
            }
          >
            <DeleteIcon sx={{ fontSize: 16, mr: 1 }} />
            {t({ en: "Remove Completely", ja: "完全に削除" })}
          </button>
        </>
      )}
      {edgeId && onSplitEdge && (
        <>
          <div style={separatorStyle} />
          <button
            onClick={handleSplitEdge}
            style={itemStyle}
            onMouseEnter={(e) =>
              Object.assign(e.currentTarget.style, itemHoverStyle)
            }
            onMouseLeave={(e) =>
              Object.assign(e.currentTarget.style, itemStyle)
            }
          >
            <FiberManualRecordIcon sx={{ fontSize: 16, mr: 1 }} />
            {t({ en: "Add branch point", ja: "分岐点を追加" })}
          </button>
        </>
      )}
      {isJunction && nodeId && onDissolveJunction && (
        <>
          <div style={separatorStyle} />
          <button
            onClick={handleDissolveJunction}
            style={itemStyle}
            onMouseEnter={(e) =>
              Object.assign(e.currentTarget.style, itemHoverStyle)
            }
            onMouseLeave={(e) =>
              Object.assign(e.currentTarget.style, itemStyle)
            }
          >
            <CloseIcon sx={{ fontSize: 16, mr: 1 }} />
            {t({ en: "Dissolve junction", ja: "分岐点を解除" })}
          </button>
        </>
      )}
      {isJunction && nodeId && onDeleteJunction && (
        <button
          onClick={handleDeleteJunction}
          style={deleteItemStyle}
          onMouseEnter={(e) =>
            Object.assign(e.currentTarget.style, deleteItemHoverStyle)
          }
          onMouseLeave={(e) =>
            Object.assign(e.currentTarget.style, deleteItemStyle)
          }
        >
          <DeleteIcon sx={{ fontSize: 16, mr: 1 }} />
          {t({ en: "Remove junction", ja: "分岐点を削除" })}
        </button>
      )}
      {nodeType === "paper_group" && nodeId && (
        <>
          <div style={separatorStyle} />
          {!isGroupExpanded && onExpandGroup && (
            <button
              onClick={handleExpandGroup}
              style={itemStyle}
              onMouseEnter={(e) => Object.assign(e.currentTarget.style, itemHoverStyle)}
              onMouseLeave={(e) => Object.assign(e.currentTarget.style, itemStyle)}
            >
              <UnfoldMoreIcon sx={{ fontSize: 16, mr: 1 }} />
              {t({ en: "Expand Group", ja: "グループを展開" })}
            </button>
          )}
          {isGroupExpanded && onCollapseGroup && (
            <button
              onClick={handleCollapseGroup}
              style={itemStyle}
              onMouseEnter={(e) => Object.assign(e.currentTarget.style, itemHoverStyle)}
              onMouseLeave={(e) => Object.assign(e.currentTarget.style, itemStyle)}
            >
              <UnfoldLessIcon sx={{ fontSize: 16, mr: 1 }} />
              {t({ en: "Collapse Group", ja: "グループを折りたたむ" })}
            </button>
          )}
          {onUngroupPapers && (
            <button
              onClick={handleUngroupPapers}
              style={itemStyle}
              onMouseEnter={(e) => Object.assign(e.currentTarget.style, itemHoverStyle)}
              onMouseLeave={(e) => Object.assign(e.currentTarget.style, itemStyle)}
            >
              <LayersClearIcon sx={{ fontSize: 16, mr: 1 }} />
              {t({ en: "Ungroup Papers", ja: "グループを解除" })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "8px 16px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: "13px",
  color: "#374151",
  textAlign: "left",
};

const itemHoverStyle: React.CSSProperties = {
  ...itemStyle,
  background: "#f3f4f6",
};

const deleteItemStyle: React.CSSProperties = {
  ...itemStyle,
  color: "#dc2626",
};

const deleteItemHoverStyle: React.CSSProperties = {
  ...deleteItemStyle,
  background: "#fef2f2",
};

const separatorStyle: React.CSSProperties = {
  height: 1,
  background: "#e5e7eb",
  margin: "4px 0",
};

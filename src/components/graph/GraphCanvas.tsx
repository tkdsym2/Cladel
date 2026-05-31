import { useState, useEffect, useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  useReactFlow,
  getBezierPath,
  Position,
  type NodeMouseHandler,
  type OnNodeDrag,
  type EdgeMouseHandler,
  type Edge,
  type Connection,
  type OnConnectStart,
  type OnConnectEnd,
  SelectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useLayerStore } from "../../store/layerStore";
import { useGraphStore, setShiftHeld } from "../../store/graphStore";
import { useSettingsStore } from "../../store/settingsStore";

import { CoreNode } from "./CoreNode";
import { PaperNode } from "./PaperNode";
import { UserDocNode } from "./UserDocNode";
import { GhostNode } from "./GhostNode";
import { DeletedNode } from "./DeletedNode";
import { JunctionNode } from "./JunctionNode";
import { ImageNode } from "./ImageNode";
import { AgentNode } from "./AgentNode";
import { ExportNode } from "./ExportNode";
import { CompareNode } from "./CompareNode";
import { TitleNode } from "./TitleNode";
import { NanoBananaNode } from "./NanoBananaNode";
import { PaperGroupNode } from "./PaperGroupNode";
import { ImportNode } from "./ImportNode";
import { AnnotatedEdge, bezierPoint, parseBezierPath } from "./AnnotatedEdge";
import { EdgeActionMenu } from "./EdgeActionMenu";
import { TabCreatePopover } from "./TabCreatePopover";
import { GroupingButton } from "./GroupingButton";
import { CanvasControls } from "./CanvasControls";
import { CursorModeIndicator, type CursorMode } from "./CursorModeIndicator";
import { TAB_HANDLE_MAP } from "../../types";
import type { TabNodeType, TabDirection, NodeType, NodeData, EdgeData } from "../../types";
import { PdfImportDialog } from "../dialogs/PdfImportDialog";
import { ImageImportDialog } from "../dialogs/ImageImportDialog";
import DescriptionIcon from "@mui/icons-material/Description";
import { listen } from "@tauri-apps/api/event";

const nodeTypes = {
  core: CoreNode,
  paper: PaperNode,
  user_doc: UserDocNode,
  agent_proposal: GhostNode,
  deleted: DeletedNode,
  junction: JunctionNode,
  image: ImageNode,
  agent: AgentNode,
  paper_group: PaperGroupNode,
  export: ExportNode,
  compare: CompareNode,
  title: TitleNode,
  nano_banana: NanoBananaNode,
  import: ImportNode,
};

const edgeTypes = {
  annotated: AnnotatedEdge,
};

// ─── Copy/Paste clipboard ───

interface ClipboardNode {
  originalId: string;
  node_type: NodeType;
  title: string;
  content: string | null;
  bibtex: string | null;
  metadata: string | null;
  position_x: number;
  position_y: number;
  width: number | null;
  height: number | null;
}

interface ClipboardEdge {
  originalSourceId: string;
  originalTargetId: string;
  weight: number;
  comment: string;
  source_handle: string | null;
  target_handle: string | null;
}

interface ClipboardData {
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
  sourceLayerId: string;
}

let _clipboard: ClipboardData | null = null;

const COPYABLE_TYPES = new Set(["paper", "user_doc", "image", "agent", "export", "compare", "nano_banana"]);

// ─── Edge proximity detection for drop-on-edge ───

function getHandlePos(
  node: NodeData,
  handleId: string | null,
): { x: number; y: number; position: Position } {
  const w = node.width ?? 280;
  const h = node.height ?? 210;
  const dir = (handleId ?? "right").replace("-target", "");
  switch (dir) {
    case "left":
      return { x: node.position_x, y: node.position_y + h / 2, position: Position.Left };
    default:
      return { x: node.position_x + w, y: node.position_y + h / 2, position: Position.Right };
  }
}

function findEdgeNearPoint(
  flowX: number,
  flowY: number,
  dbEdges: EdgeData[],
  dbNodes: NodeData[],
  threshold: number,
): EdgeData | null {
  let nearestEdge: EdgeData | null = null;
  let nearestDist = threshold;

  for (const edge of dbEdges) {
    const sourceNode = dbNodes.find((n) => n.id === edge.source_node_id);
    const targetNode = dbNodes.find((n) => n.id === edge.target_node_id);
    if (!sourceNode || !targetNode) continue;
    if (sourceNode.node_type === "deleted" || targetNode.node_type === "deleted") continue;

    const src = getHandlePos(sourceNode, edge.source_handle);
    const tgt = getHandlePos(targetNode, edge.target_handle);

    const [pathD] = getBezierPath({
      sourceX: src.x,
      sourceY: src.y,
      sourcePosition: src.position,
      targetX: tgt.x,
      targetY: tgt.y,
      targetPosition: tgt.position,
    });

    const parsed = parseBezierPath(pathD);
    if (!parsed) continue;

    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const [px, py] = bezierPoint(
        t,
        parsed.sx, parsed.sy,
        parsed.cx1, parsed.cy1,
        parsed.cx2, parsed.cy2,
        parsed.ex, parsed.ey,
      );
      const dist = Math.hypot(px - flowX, py - flowY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEdge = edge;
      }
    }
  }

  return nearestEdge;
}

// ─── Drag-and-drop overlay styles ───

const dragOverlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 50,
  background: "rgba(30, 64, 175, 0.08)",
  border: "3px dashed #3b82f6",
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
};

const dragOverlayContentStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "24px 32px",
  background: "rgba(255, 255, 255, 0.9)",
  borderRadius: 12,
  boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
};

// ─── GraphCanvas component ───

export function GraphCanvas({
  onRequestDeleteNode,
  onRequestBatchDelete,
  onRequestDeleteEdge,
}: {
  onRequestDeleteNode: (nodeId: string) => void;
  onRequestBatchDelete: (nodeIds: string[]) => void;
  onRequestDeleteEdge: (edgeId: string) => void;
}) {
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const onNodesChange = useGraphStore((s) => s.onNodesChange);
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange);
  const onConnect = useGraphStore((s) => s.onConnect);
  const addNode = useGraphStore((s) => s.addNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const updateNodePosition = useGraphStore((s) => s.updateNodePosition);
  const setSelectedNodeId = useGraphStore((s) => s.setSelectedNodeId);
  const openEdgeActionMenu = useGraphStore((s) => s.openEdgeActionMenu);
  const closeEdgeActionMenu = useGraphStore((s) => s.closeEdgeActionMenu);
  const reconnectEdge = useGraphStore((s) => s.reconnectEdge);
  const splitEdgeWithJunction = useGraphStore((s) => s.splitEdgeWithJunction);

  const currentLayer = useLayerStore((s) => s.currentLayer);

  // UI preferences for canvas
  const canvasBackground = useSettingsStore((s) => s.uiPreferences.canvas_background);
  const canvasGridEnabled = useSettingsStore((s) => s.uiPreferences.canvas_grid_enabled);
  const canvasGridSize = useSettingsStore((s) => s.uiPreferences.canvas_grid_size);

  // Cursor mode: "normal" = pan on drag, "select" = range selection on drag
  const [cursorMode, setCursorMode] = useState<CursorMode>("normal");

  // Right-click drag selection state
  const rightDragRef = useRef<{
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null>(null);
  const [selectionRect, setSelectionRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const screenToFlowPosRef = useRef(screenToFlowPosition);
  screenToFlowPosRef.current = screenToFlowPosition;

  // PDF import dialog state
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfDropFilePath, setPdfDropFilePath] = useState<string | null>(null);
  // Image import dialog state
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [imageDropFilePath, setImageDropFilePath] = useState<string | null>(null);
  // ── Pending import state (for ImportNode lifecycle) ──
  const [pendingImport, setPendingImport] = useState<{
    tempNodeId: string;
    position: { x: number; y: number };
    edgeInfo?: {
      sourceNodeId: string;
      sourceHandle: string;
      targetHandle: string;
    };
  } | null>(null);
  const pendingImportRef = useRef(pendingImport);
  pendingImportRef.current = pendingImport;

  // Drag-and-drop overlay
  const [dragOverlay, setDragOverlay] = useState(false);
  const [dragOverlayText, setDragOverlayText] = useState("Drop PDF to import");
  // MiniMap visibility
  const [minimapVisible, setMinimapVisible] = useState(true);

  // ── Tab-to-Create popover state ──
  const [tabPopover, setTabPopover] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    direction: TabDirection;
    sourceNodeId: string | null;
    sourceHandleId?: string;
    handleType?: string;
  } | null>(null);
  const tabPopoverRef = useRef(tabPopover);
  tabPopoverRef.current = tabPopover;

  // ── Edge merge/replace dialog state ──
  const [edgeMergeDialog, setEdgeMergeDialog] = useState<{
    position: { x: number; y: number };
    sourceNodeId: string;
    sourceHandleId: string;
    targetEdgeId: string;
    dropFlowPosition: { x: number; y: number };
  } | null>(null);

  // ── Connection drag tracking (for Tab-during-drag) ──
  const [connectingFrom, setConnectingFrom] = useState<{
    nodeId: string;
    handleId: string;
    handleType: string;
  } | null>(null);
  const connectingFromRef = useRef(connectingFrom);
  connectingFromRef.current = connectingFrom;
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseMoveCleanupRef = useRef<(() => void) | null>(null);

  // Track Shift key state so graphStore can protect multi-selection from
  // React Flow's stale multiSelectionActive bug.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    // Also reset on blur (e.g. user switches windows while Shift held)
    const blur = () => setShiftHeld(false);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Canvas container ref (used for keyboard shortcut scoping + drag-to-group)
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Helper: returns true only when the graph canvas area is active
  // (i.e. user is NOT typing in a sidebar panel, dialog, or any text input)
  const isGraphAreaActive = useCallback(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return false;
    if (el instanceof HTMLElement && el.isContentEditable) return false;
    if (canvasContainerRef.current && !canvasContainerRef.current.contains(el)) return false;
    return true;
  }, []);

  // Cursor mode keyboard handler: G = select, V = normal
  useEffect(() => {
    const handleCursorModeKey = (e: KeyboardEvent) => {
      if (!isGraphAreaActive()) return;

      if (e.key === "g" || e.key === "G") {
        setCursorMode("select");
      } else if (e.key === "v" || e.key === "V") {
        setCursorMode("normal");
      } else if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey) {
        useGraphStore.getState().toggleColorMode();
      }
    };
    document.addEventListener("keydown", handleCursorModeKey);
    return () => document.removeEventListener("keydown", handleCursorModeKey);
  }, [isGraphAreaActive]);

  // Tab keydown handler (capture phase to fire before browser focus cycling)
  useEffect(() => {
    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (!isGraphAreaActive()) return;

      // Don't re-open if already open (read from ref to avoid stale closure)
      if (tabPopoverRef.current) return;

      // ── Path 1: Connection drag in progress (TouchDesigner-style) ──
      const connecting = connectingFromRef.current;
      if (connecting) {
        e.preventDefault();
        e.stopPropagation();

        // Determine direction from the handle being dragged
        const hid = connecting.handleId.toLowerCase();
        let direction: TabDirection;
        if (hid.includes("left")) direction = "left";
        else direction = "right";

        // Show popover at current mouse position
        setTabPopover({
          isOpen: true,
          position: { x: lastMousePos.current.x, y: lastMousePos.current.y },
          direction,
          sourceNodeId: connecting.nodeId,
          sourceHandleId: connecting.handleId,
          handleType: connecting.handleType,
        });

        // Clear connection state (we're taking over the drag)
        setConnectingFrom(null);
        mouseMoveCleanupRef.current?.();
        mouseMoveCleanupRef.current = null;
        return;
      }

      // ── Path 2: No connection drag — standalone creation at cursor ──
      e.preventDefault();
      e.stopPropagation();
      setTabPopover({
        isOpen: true,
        position: { x: lastMousePos.current.x, y: lastMousePos.current.y },
        direction: "right",
        sourceNodeId: null,
      });
    };

    window.addEventListener("keydown", handleTabKey, true);
    return () => window.removeEventListener("keydown", handleTabKey, true);
  }, [flowToScreenPosition, isGraphAreaActive]);

  // Tab-to-Create selection handler
  // Resolve default dimensions and title for a new node type
  const getNodeDefaults = useCallback((nodeType: TabNodeType) => {
    const prefs = useSettingsStore.getState().uiPreferences;
    switch (nodeType) {
      case "user_doc":
        return { width: prefs.user_doc_default_width, height: prefs.user_doc_default_height, title: "New Note" };
      case "paper":
        return { width: prefs.paper_default_width, height: prefs.paper_default_height, title: "New Paper" };
      case "image":
        return { width: prefs.image_default_width, height: prefs.image_default_height, title: "New Image" };
      case "agent":
        return { width: 280, height: 210, title: "Agent" };
      case "import":
        return { width: 180, height: 135, title: "Import" };
      case "export":
        return { width: 280, height: 210, title: "Export" };
      case "compare":
        return { width: 280, height: 210, title: "Compare" };
      case "title":
        return { width: 280, height: 210, title: "Title" };
      case "nano_banana":
        return { width: 280, height: 210, title: "Nano Banana" };
    }
  }, []);

  const handleTabCreateSelect = useCallback(
    async (nodeType: TabNodeType) => {
      if (!tabPopover || !currentLayer) return;
      const { sourceNodeId, direction, position } = tabPopover;
      setTabPopover(null);

      const defaults = getNodeDefaults(nodeType);

      // ── Import node: create temporary React-only node ──
      if (nodeType === "import") {
        let flowPos: { x: number; y: number };
        let edgeInfo: { sourceNodeId: string; sourceHandle: string; targetHandle: string } | undefined;

        if (!sourceNodeId) {
          flowPos = screenToFlowPosition(position);
        } else {
          // If triggered from connection drag (sourceHandleId present), use cursor position
          if (tabPopover.sourceHandleId) {
            flowPos = screenToFlowPosition(position);
          } else {
            const state = useGraphStore.getState();
            const sourceNode = state.nodes.find((n) => n.id === sourceNodeId);
            const sourceW = sourceNode?.measured?.width ?? (typeof sourceNode?.style?.width === "number" ? sourceNode.style.width : 280);

            switch (direction) {
              case "right":
                flowPos = { x: (sourceNode?.position.x ?? 0) + (sourceW as number) + 100, y: sourceNode?.position.y ?? 0 };
                break;
              case "left":
                flowPos = { x: (sourceNode?.position.x ?? 0) - defaults.width - 100, y: sourceNode?.position.y ?? 0 };
                break;
            }
          }

          edgeInfo = {
            sourceNodeId,
            sourceHandle: TAB_HANDLE_MAP[direction].sourceHandle,
            targetHandle: TAB_HANDLE_MAP[direction].targetHandle,
          };
        }

        const tempId = `temp-import-${crypto.randomUUID()}`;
        setPendingImport({ tempNodeId: tempId, position: flowPos, edgeInfo });

        // Inject temporary node into React Flow (not persisted to DB)
        useGraphStore.setState((s) => ({
          nodes: [
            ...s.nodes,
            {
              id: tempId,
              type: "import",
              position: flowPos,
              data: {},
              style: { width: defaults.width, height: defaults.height },
              selected: false,
            },
          ],
        }));
        return;
      }

      // ── Standalone creation (no source node) ──
      if (!sourceNodeId) {
        const flowPos = screenToFlowPosition(position);
        try {
          const newNode = await addNode({
            layer_id: currentLayer.id,
            node_type: nodeType,
            title: defaults.title,
            content: "",
            position_x: flowPos.x,
            position_y: flowPos.y,
            width: defaults.width,
            height: defaults.height,
          });
          setSelectedNodeId(newNode.id);
          useGraphStore.setState((s) => ({
            nodes: s.nodes.map((n) => ({
              ...n,
              selected: n.id === newNode.id,
            })),
          }));
        } catch (err) {
          console.error("Tab-to-Create (standalone) failed:", err);
        }
        return;
      }

      // ── Connected creation (source node exists) ──
      const state = useGraphStore.getState();
      const sourceNode = state.nodes.find((n) => n.id === sourceNodeId);
      if (!sourceNode) return;

      // Calculate new node position based on direction
      let newX: number;
      let newY: number;

      // If triggered from connection drag (sourceHandleId present), use cursor position
      if (tabPopover.sourceHandleId) {
        const flowPos = screenToFlowPosition(position);
        newX = flowPos.x;
        newY = flowPos.y;
      } else {
        const sourceW =
          sourceNode.measured?.width ??
          (typeof sourceNode.style?.width === "number"
            ? sourceNode.style.width
            : 280);
        switch (direction) {
          case "right":
            newX = sourceNode.position.x + sourceW + 100;
            newY = sourceNode.position.y;
            break;
          case "left":
            newX = sourceNode.position.x - defaults.width - 100;
            newY = sourceNode.position.y;
            break;
        }
      }

      const edgeSourceHandle = TAB_HANDLE_MAP[direction].sourceHandle;
      const edgeTargetHandle = TAB_HANDLE_MAP[direction].targetHandle;

      try {
        const newNode = await addNode({
          layer_id: currentLayer.id,
          node_type: nodeType,
          title: defaults.title,
          content: "",
          position_x: newX,
          position_y: newY,
          width: defaults.width,
          height: defaults.height,
        });

        await addEdge({
          layer_id: currentLayer.id,
          source_node_id: sourceNodeId,
          target_node_id: newNode.id,
          weight: 3,
          comment: "",
          source_handle: edgeSourceHandle,
          target_handle: edgeTargetHandle,
        });

        // Select the new node in both graphStore and React Flow's visual state
        setSelectedNodeId(newNode.id);
        useGraphStore.setState((s) => ({
          nodes: s.nodes.map((n) => ({
            ...n,
            selected: n.id === newNode.id,
          })),
        }));
      } catch (err) {
        console.error("Tab-to-Create failed:", err);
      }
    },
    [tabPopover, currentLayer, addNode, addEdge, setSelectedNodeId, screenToFlowPosition, getNodeDefaults],
  );

  // ── Right-click drag selection ──
  const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      rightDragRef.current = { startX: e.clientX, startY: e.clientY, isDragging: false };
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const rd = rightDragRef.current;
      if (!rd) return;
      const dx = e.clientX - rd.startX;
      const dy = e.clientY - rd.startY;
      if (!rd.isDragging && Math.hypot(dx, dy) > 5) {
        rd.isDragging = true;
      }
      if (rd.isDragging) {
        setSelectionRect({
          x: Math.min(rd.startX, e.clientX),
          y: Math.min(rd.startY, e.clientY),
          width: Math.abs(dx),
          height: Math.abs(dy),
        });
      }
    };

    const handleMouseUp = (e: globalThis.MouseEvent) => {
      if (e.button !== 2) return;
      const rd = rightDragRef.current;
      if (!rd) return;
      if (rd.isDragging) {
        const rectLeft = Math.min(rd.startX, e.clientX);
        const rectTop = Math.min(rd.startY, e.clientY);
        const rectRight = Math.max(rd.startX, e.clientX);
        const rectBottom = Math.max(rd.startY, e.clientY);
        const flowTopLeft = screenToFlowPosRef.current({ x: rectLeft, y: rectTop });
        const flowBottomRight = screenToFlowPosRef.current({ x: rectRight, y: rectBottom });

        const { nodes: allNodes, onNodesChange: applyChanges } = useGraphStore.getState();
        const changes = allNodes.map((n) => {
          const nw = n.measured?.width ?? n.width ?? 280;
          const nh = n.measured?.height ?? n.height ?? 210;
          const intersects =
            n.position.x < flowBottomRight.x &&
            n.position.x + nw > flowTopLeft.x &&
            n.position.y < flowBottomRight.y &&
            n.position.y + nh > flowTopLeft.y;
          return { id: n.id, type: "select" as const, selected: intersects };
        });
        applyChanges(changes);
      }
      rightDragRef.current = null;
      setSelectionRect(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
    closeEdgeActionMenu();
    setEdgeMergeDialog(null);
    // Collapse any expanded paper groups
    const { expandedGroupIds, collapseGroup } = useGraphStore.getState();
    for (const gid of expandedGroupIds) {
      collapseGroup(gid);
    }
  }, [setSelectedNodeId, closeEdgeActionMenu]);

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "junction" || node.type === "deleted") return;
      if (node.type === "paper_group") {
        const { expandedGroupIds } = useGraphStore.getState();
        if (expandedGroupIds.has(node.id)) return;
        useGraphStore.getState().expandGroup(node.id);
        return;
      }
      if (!currentLayer) return;
      const title = (node.data as { title?: string }).title ?? "Node";
      import("../../lib/detached-window").then(({ openNodeDetailWindow }) =>
        openNodeDetailWindow(node.id, currentLayer.id, title),
      );
      setSelectedNodeId(null);
    },
    [currentLayer, setSelectedNodeId],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "junction") return;
      // If the node is already open in a detached window, focus that instead
      if (useGraphStore.getState().isNodeDetached(node.id)) {
        import("../../lib/detached-window").then(({ focusDetachedWindow }) =>
          focusDetachedWindow(node.id),
        );
        return;
      }
      // Selection → selectedNodeId sync is handled inside graphStore.onNodesChange
    },
    [],
  );

  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (event, edge) => {
      openEdgeActionMenu(edge.id, event.clientX, event.clientY);
    },
    [openEdgeActionMenu],
  );

  // ── Drag-to-group: track pre-drag positions + canvas ref ──
  const preDragPositionRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const handleNodeDragStart: OnNodeDrag = useCallback(
    (_event, _node, nodes) => {
      const map = new Map<string, { x: number; y: number }>();
      for (const n of nodes) {
        map.set(n.id, { x: n.position.x, y: n.position.y });
      }
      preDragPositionRef.current = map;
      // If dragging a single paper node, set it for sidebar drop zone visual
      if (nodes.length === 1 && nodes[0].type === "paper" && !nodes[0].parentId) {
        useGraphStore.getState().setDraggingPaperNodeId(nodes[0].id);
      }
    },
    [],
  );

  const handleNodeDragStop: OnNodeDrag = useCallback(
    (_event, node, nodes) => {
      // Clear dragging state
      useGraphStore.getState().setDraggingPaperNodeId(null);

      // Check if dropped into sidebar area (past canvas right edge)
      const canvasEl = canvasContainerRef.current;
      if (
        canvasEl &&
        nodes.length === 1 &&
        node.type === "paper" &&
        !node.parentId
      ) {
        const canvasRect = canvasEl.getBoundingClientRect();
        const mouseX = (_event as unknown as React.MouseEvent).clientX;
        if (mouseX > canvasRect.right) {
          // Check if a paper_group is selected in the sidebar
          const state = useGraphStore.getState();
          const selectedId = state.selectedNodeId;
          const selectedDb = selectedId ? state.dbNodes.find((n) => n.id === selectedId) : null;
          if (selectedDb?.node_type === "paper_group") {
            // Revert paper position, then add to group
            const orig = preDragPositionRef.current.get(node.id);
            if (orig) {
              useGraphStore.setState((s) => ({
                nodes: s.nodes.map((fn) =>
                  fn.id === node.id ? { ...fn, position: orig } : fn,
                ),
              }));
            }
            state.addPaperToGroup(selectedDb.id, node.id);
            preDragPositionRef.current.clear();
            return;
          }
        }
      }

      // Normal position update
      for (const n of nodes) {
        if (n.type === "import") {
          // Temp React-only node: keep the pending import target position in sync,
          // but don't persist to the DB (there is no row for it yet).
          setPendingImport((prev) =>
            prev && prev.tempNodeId === n.id ? { ...prev, position: n.position } : prev,
          );
          continue;
        }
        updateNodePosition(n.id, n.position.x, n.position.y);
      }
      preDragPositionRef.current.clear();
    },
    [updateNodePosition],
  );


  const handlePdfDialogClose = useCallback(() => {
    setPdfDialogOpen(false);
    setPdfDropFilePath(null);
    // If closing without successful import, clean up the temp node
    const pending = pendingImportRef.current;
    if (pending) {
      useGraphStore.setState((s) => ({
        nodes: s.nodes.filter((n) => n.id !== pending.tempNodeId),
      }));
      setPendingImport(null);
    }
  }, []);

  const handleImageDialogClose = useCallback(() => {
    setImageDialogOpen(false);
    setImageDropFilePath(null);
    // If closing without successful import, clean up the temp node
    const pending = pendingImportRef.current;
    if (pending) {
      useGraphStore.setState((s) => ({
        nodes: s.nodes.filter((n) => n.id !== pending.tempNodeId),
      }));
      setPendingImport(null);
    }
  }, []);

  // ── Drag-and-drop: listen for PDF/image files dragged onto the window ──
  const imageExtensions = [".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".ico"];

  useEffect(() => {
    const unlistenEnter = listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-enter",
      (event) => {
        const paths = event.payload.paths ?? [];
        const hasPdf = paths.some((p) => p.toLowerCase().endsWith(".pdf"));
        const hasImage = paths.some((p) => {
          const lower = p.toLowerCase();
          return imageExtensions.some((ext) => lower.endsWith(ext));
        });
        if (hasPdf) {
          setDragOverlayText("Drop PDF to import");
          setDragOverlay(true);
        } else if (hasImage) {
          setDragOverlayText("Drop image to import");
          setDragOverlay(true);
        }
      },
    );
    const unlistenLeave = listen("tauri://drag-leave", () => {
      setDragOverlay(false);
    });
    const unlistenDrop = listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-drop",
      (event) => {
        setDragOverlay(false);
        const paths = event.payload.paths ?? [];
        const pdfPath = paths.find((p) => p.toLowerCase().endsWith(".pdf"));
        if (pdfPath) {
          setPdfDropFilePath(pdfPath);
          setPdfDialogOpen(true);
          return;
        }
        const imagePath = paths.find((p) => {
          const lower = p.toLowerCase();
          return imageExtensions.some((ext) => lower.endsWith(ext));
        });
        if (imagePath) {
          setImageDropFilePath(imagePath);
          setImageDialogOpen(true);
        }
      },
    );
    return () => {
      unlistenEnter.then((fn) => fn());
      unlistenLeave.then((fn) => fn());
      unlistenDrop.then((fn) => fn());
    };
  }, []);

  // ── ImportNode file-selected event handler ──
  const handleImportNodeFile = useCallback(
    (filePath: string) => {
      const pending = pendingImportRef.current;
      if (!pending) return;

      const ext = filePath.toLowerCase().split(".").pop() ?? "";
      const isPdf = ext === "pdf";
      const isImage = ["png", "jpg", "jpeg", "svg", "gif", "webp", "bmp", "tif", "tiff", "ico"].includes(ext);

      if (isPdf) {
        setPdfDropFilePath(filePath);
        setPdfDialogOpen(true);
      } else if (isImage) {
        setImageDropFilePath(filePath);
        setImageDialogOpen(true);
      }
    },
    [],
  );

  // Called after dialog creates the real node — create edge if needed, remove temp node
  const handleImportSuccess = useCallback(
    async (newNodeId: string) => {
      const pending = pendingImportRef.current;
      if (!pending) return;

      // Create edge from source node to the newly imported node
      if (pending.edgeInfo && currentLayer) {
        try {
          await addEdge({
            layer_id: currentLayer.id,
            source_node_id: pending.edgeInfo.sourceNodeId,
            target_node_id: newNodeId,
            weight: 3,
            comment: "",
            source_handle: pending.edgeInfo.sourceHandle,
            target_handle: pending.edgeInfo.targetHandle,
          });
        } catch (err) {
          console.error("Failed to create edge for import:", err);
        }
      }

      // Remove the temporary import node from React Flow
      useGraphStore.setState((s) => ({
        nodes: s.nodes.filter((n) => n.id !== pending.tempNodeId),
      }));
      setPendingImport(null);
    },
    [currentLayer, addEdge],
  );

  // Listen for custom DOM events from ImportNode components
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string; filePath: string }>).detail;
      handleImportNodeFile(detail.filePath);
    };
    window.addEventListener("import-node-file-selected", handler);
    return () => window.removeEventListener("import-node-file-selected", handler);
  }, [handleImportNodeFile]);

  // Keyboard delete handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!isGraphAreaActive()) return;

      const state = useGraphStore.getState();

      // Check if an edge is selected (via action menu or React Flow selection)
      if (state.edgeActionMenu) {
        e.preventDefault();
        onRequestDeleteEdge(state.edgeActionMenu.edgeId);
        return;
      }
      const selectedEdge = state.edges.find((ed) => ed.selected);
      if (selectedEdge) {
        e.preventDefault();
        onRequestDeleteEdge(selectedEdge.id);
        return;
      }

      // Temp import node (React-only): remove it locally without touching the backend.
      const selectedImport = state.nodes.find((n) => n.selected && n.type === "import");
      if (selectedImport) {
        e.preventDefault();
        useGraphStore.setState((s) => ({
          nodes: s.nodes.filter((nn) => nn.id !== selectedImport.id),
        }));
        setPendingImport((prev) =>
          prev && prev.tempNodeId === selectedImport.id ? null : prev,
        );
        return;
      }

      // Collect deletable selected nodes (React Flow multi-select + store single-select)
      const selectedNodes = state.nodes.filter((n) => n.selected);
      const deletableTypes = new Set(["paper", "user_doc", "image", "agent", "junction", "paper_group", "export"]);
      const toDelete = selectedNodes.filter((n) => n.type && deletableTypes.has(n.type));

      // Fall back to single-selection if no multi-selected nodes
      if (toDelete.length === 0 && state.selectedNodeId) {
        const node = state.dbNodes.find((n) => n.id === state.selectedNodeId);
        if (node && deletableTypes.has(node.node_type)) {
          e.preventDefault();
          onRequestDeleteNode(node.id);
          return;
        }
        return;
      }

      if (toDelete.length === 0) return;
      e.preventDefault();

      if (toDelete.length === 1) {
        onRequestDeleteNode(toDelete[0].id);
      } else {
        onRequestBatchDelete(toDelete.map((n) => n.id));
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onRequestDeleteNode, onRequestBatchDelete, onRequestDeleteEdge, isGraphAreaActive]);

  // Undo handler (Cmd+Z / Ctrl+Z)
  useEffect(() => {
    const handleUndo = (e: KeyboardEvent) => {
      if (e.key !== "z" || !(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (!isGraphAreaActive()) return;

      const { undoStack } = useGraphStore.getState();
      if (undoStack.length === 0) return;

      e.preventDefault();
      e.stopPropagation();
      useGraphStore.getState().undo().catch((err: unknown) =>
        console.error("Undo failed:", err),
      );
    };

    document.addEventListener("keydown", handleUndo, true);
    return () => document.removeEventListener("keydown", handleUndo, true);
  }, [isGraphAreaActive]);

  // ─── Copy/Paste handlers ───

  const handleCopy = useCallback(() => {
    const state = useGraphStore.getState();
    const layerId = useLayerStore.getState().currentLayer?.id;
    if (!layerId) return;

    // Gather selected nodes: multi-select or single selection
    let selectedNodes = state.nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0 && state.selectedNodeId) {
      const single = state.nodes.find((n) => n.id === state.selectedNodeId);
      if (single) selectedNodes = [single];
    }

    // Filter to copyable types
    const copyable = selectedNodes.filter((n) => n.type && COPYABLE_TYPES.has(n.type));
    if (copyable.length === 0) return;

    const copyableIds = new Set(copyable.map((n) => n.id));

    // Map to clipboard nodes using dbNode data
    const clipboardNodes: ClipboardNode[] = [];
    for (const flowNode of copyable) {
      const dbNode = state.dbNodes.find((n) => n.id === flowNode.id);
      if (!dbNode) continue;
      clipboardNodes.push({
        originalId: dbNode.id,
        node_type: dbNode.node_type,
        title: dbNode.title,
        content: dbNode.content,
        bibtex: dbNode.bibtex,
        metadata: dbNode.metadata,
        position_x: flowNode.position.x,
        position_y: flowNode.position.y,
        width: dbNode.width ?? null,
        height: dbNode.height ?? null,
      });
    }

    // Capture internal edges (both endpoints in copied set)
    const clipboardEdges: ClipboardEdge[] = state.dbEdges
      .filter(
        (e) =>
          copyableIds.has(e.source_node_id) && copyableIds.has(e.target_node_id),
      )
      .map((e) => ({
        originalSourceId: e.source_node_id,
        originalTargetId: e.target_node_id,
        weight: e.weight,
        comment: e.comment ?? "",
        source_handle: e.source_handle ?? null,
        target_handle: e.target_handle ?? null,
      }));

    _clipboard = {
      nodes: clipboardNodes,
      edges: clipboardEdges,
      sourceLayerId: layerId,
    };
  }, []);

  const handlePaste = useCallback(async () => {
    if (!_clipboard || _clipboard.nodes.length === 0) return;
    const layerId = useLayerStore.getState().currentLayer?.id;
    if (!layerId) return;

    const isSameLayer = _clipboard.sourceLayerId === layerId;
    const idMap = new Map<string, string>();

    // Determine existing titles in this layer to decide suffix
    const existingTitles = new Set(
      useGraphStore.getState().dbNodes.map((n) => n.title),
    );

    // Create pasted nodes
    for (const clipNode of _clipboard.nodes) {
      let title = clipNode.title;
      if (isSameLayer && existingTitles.has(title)) {
        title = title + "_copy";
      }

      try {
        const newNode = await addNode({
          layer_id: layerId,
          node_type: clipNode.node_type as NodeType,
          title,
          content: clipNode.content,
          bibtex: clipNode.bibtex,
          metadata: clipNode.metadata,
          position_x: clipNode.position_x + 30,
          position_y: clipNode.position_y + 30,
          width: clipNode.width,
          height: clipNode.height,
        });
        idMap.set(clipNode.originalId, newNode.id);
      } catch (err) {
        console.error("Failed to paste node:", err);
      }
    }

    // Recreate internal edges with remapped IDs
    for (const clipEdge of _clipboard.edges) {
      const newSource = idMap.get(clipEdge.originalSourceId);
      const newTarget = idMap.get(clipEdge.originalTargetId);
      if (!newSource || !newTarget) continue;

      try {
        await addEdge({
          layer_id: layerId,
          source_node_id: newSource,
          target_node_id: newTarget,
          weight: clipEdge.weight,
          comment: clipEdge.comment || null,
          source_handle: clipEdge.source_handle,
          target_handle: clipEdge.target_handle,
        });
      } catch (err) {
        console.error("Failed to paste edge:", err);
      }
    }

    // Select all newly pasted nodes
    const newIds = new Set(idMap.values());
    useGraphStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({
        ...n,
        selected: newIds.has(n.id),
      })),
    }));
  }, [addNode, addEdge]);

  // Copy/Paste keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isGraphAreaActive()) return;

      const modKey = navigator.platform.toUpperCase().includes("MAC")
        ? e.metaKey
        : e.ctrlKey;

      if (modKey && e.key === "c") {
        e.preventDefault();
        handleCopy();
      } else if (modKey && e.key === "v") {
        e.preventDefault();
        handlePaste();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleCopy, handlePaste, isGraphAreaActive]);

  // ─── Connection drag tracking (Tab-during-drag) ───

  const handleConnectStart: OnConnectStart = useCallback(
    (_event, params) => {
      if (params.nodeId && params.handleId && params.handleType) {
        setConnectingFrom({
          nodeId: params.nodeId,
          handleId: params.handleId,
          handleType: params.handleType,
        });
        // Track mouse position for popover placement
        const trackMouse = (ev: globalThis.MouseEvent) => {
          lastMousePos.current = { x: ev.clientX, y: ev.clientY };
        };
        window.addEventListener("mousemove", trackMouse);
        mouseMoveCleanupRef.current = () =>
          window.removeEventListener("mousemove", trackMouse);
      }
    },
    [],
  );

  const handleConnectEnd: OnConnectEnd = useCallback(
    (event) => {
      const dragOrigin = connectingFromRef.current;

      // Check for drop-on-edge (only when connection failed — dragOrigin still set)
      if (dragOrigin && !tabPopoverRef.current?.isOpen) {
        const clientX = event instanceof globalThis.MouseEvent ? event.clientX : (event as TouchEvent).touches?.[0]?.clientX ?? 0;
        const clientY = event instanceof globalThis.MouseEvent ? event.clientY : (event as TouchEvent).touches?.[0]?.clientY ?? 0;
        const flowPos = screenToFlowPosRef.current({ x: clientX, y: clientY });

        const { dbEdges, dbNodes } = useGraphStore.getState();

        // Guard: source must not be an agent node (agent edges are dashed output edges)
        const sourceNode = dbNodes.find((n) => n.id === dragOrigin.nodeId);
        if (sourceNode && sourceNode.node_type !== "agent") {
          const hitEdge = findEdgeNearPoint(flowPos.x, flowPos.y, dbEdges, dbNodes, 30);
          if (hitEdge) {
            // Don't show dialog if the edge already connects to the source node
            if (hitEdge.source_node_id !== dragOrigin.nodeId && hitEdge.target_node_id !== dragOrigin.nodeId) {
              setEdgeMergeDialog({
                position: { x: clientX, y: clientY },
                sourceNodeId: dragOrigin.nodeId,
                sourceHandleId: (dragOrigin.handleId ?? "right").replace("-target", ""),
                targetEdgeId: hitEdge.id,
                dropFlowPosition: flowPos,
              });
              // Don't clear connectingFrom yet — dialog needs it
              mouseMoveCleanupRef.current?.();
              mouseMoveCleanupRef.current = null;
              setConnectingFrom(null);
              return;
            }
          }
        }
      }

      // Clear connection state (unless Tab popover already took over)
      setConnectingFrom(null);
      mouseMoveCleanupRef.current?.();
      mouseMoveCleanupRef.current = null;
    },
    [],
  );

  // Also clear connectingFrom when a successful connection is made
  const handleConnect = useCallback(
    (connection: Connection) => {
      // Read connectingFrom BEFORE clearing it
      const dragOrigin = connectingFromRef.current;

      setConnectingFrom(null);
      mouseMoveCleanupRef.current?.();
      mouseMoveCleanupRef.current = null;

      // Normalize: if the user dragged from node A but React Flow reports
      // connection.source as a different node, source/target are swapped.
      // This happens when the user grabs a target-type handle (rendered on top
      // due to DOM order), causing React Flow to flip the connection.
      // We reconstruct proper handle IDs from the drag direction rather than
      // blindly swapping, because sourceHandle must reference a type="source"
      // handle (no -target suffix) and targetHandle must reference a type="target"
      // handle (with -target suffix).
      let normalizedConnection = connection;

      if (dragOrigin && dragOrigin.nodeId && dragOrigin.nodeId !== connection.source) {
        // Determine the direction from the original handle (strip -target suffix)
        const rawDirection = (dragOrigin.handleId ?? "right").replace("-target", "");

        const opposites: Record<string, string> = {
          right: "left",
          left: "right",
        };
        const oppositeDirection = opposites[rawDirection] ?? "left";

        // The target node is whichever node in the connection is NOT the drag origin
        const targetNodeId =
          connection.source === dragOrigin.nodeId
            ? connection.target
            : connection.source;

        normalizedConnection = {
          source: dragOrigin.nodeId,                    // true origin node
          target: targetNodeId,                          // true destination node
          sourceHandle: rawDirection,                    // source-type handle (no -target suffix)
          targetHandle: oppositeDirection + "-target",   // target-type handle (with -target suffix)
        };
      }

      onConnect(normalizedConnection);
    },
    [onConnect],
  );

  // ─── Edge reconnection ───
  // Track the edge being reconnected so we can revert on failure
  const reconnectingEdgeRef = useRef<Edge | null>(null);

  const handleReconnectStart = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      reconnectingEdgeRef.current = edge;
    },
    [],
  );

  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      // Attempt reconnection (async, but we fire-and-forget here;
      // revert on failure is handled in onReconnectEnd via the ref).
      reconnectEdge(
        oldEdge.id,
        newConnection.source,
        newConnection.target,
        newConnection.sourceHandle,
        newConnection.targetHandle,
      ).then(
        (success) => {
          if (!success) {
            // Revert the flow edge to its original state
            const orig = reconnectingEdgeRef.current;
            if (orig) {
              useGraphStore.setState((s) => ({
                edges: s.edges.map((e) =>
                  e.id === orig.id
                    ? { ...e, source: orig.source, target: orig.target }
                    : e,
                ),
              }));
            }
          }
          reconnectingEdgeRef.current = null;
        },
      );
    },
    [reconnectEdge],
  );

  const handleReconnectEnd = useCallback(
    (_event: globalThis.MouseEvent | globalThis.TouchEvent, _edge: Edge, _handleType: string, connectionState: { isValid: boolean | null }) => {
      // If the drop was not on a valid target, revert
      if (!connectionState.isValid) {
        const orig = reconnectingEdgeRef.current;
        if (orig) {
          useGraphStore.setState((s) => ({
            edges: s.edges.map((e) =>
              e.id === orig.id
                ? { ...e, source: orig.source, target: orig.target }
                : e,
            ),
          }));
        }
        reconnectingEdgeRef.current = null;
      }
    },
    [],
  );

  // ─── Edge merge/replace handlers ───

  const handleEdgeMergeJunction = useCallback(async () => {
    if (!edgeMergeDialog) return;
    const { sourceNodeId, sourceHandleId, targetEdgeId, dropFlowPosition } = edgeMergeDialog;
    setEdgeMergeDialog(null);

    try {
      // 1. Split the target edge at the drop point to create a junction
      await splitEdgeWithJunction(targetEdgeId);

      // 2. Find the newly created junction node (the most recent junction near drop point)
      const { dbNodes } = useGraphStore.getState();
      const junctionNode = dbNodes
        .filter((n) => n.node_type === "junction")
        .reduce<NodeData | null>((nearest, n) => {
          const dist = Math.hypot(n.position_x - dropFlowPosition.x, n.position_y - dropFlowPosition.y);
          if (!nearest) return n;
          const nearestDist = Math.hypot(nearest.position_x - dropFlowPosition.x, nearest.position_y - dropFlowPosition.y);
          return dist < nearestDist ? n : nearest;
        }, null);

      if (!junctionNode) return;

      // 3. Determine target handle on the junction based on the source direction
      const opposites: Record<string, string> = { right: "left", left: "right" };
      const targetHandleDir = opposites[sourceHandleId] ?? "left";

      // 4. Create edge from source node to the junction
      const firstNode = dbNodes[0];
      if (!firstNode) return;
      await addEdge({
        layer_id: firstNode.layer_id,
        source_node_id: sourceNodeId,
        target_node_id: junctionNode.id,
        weight: 3,
        comment: "",
        source_handle: sourceHandleId,
        target_handle: targetHandleDir + "-target",
      });
    } catch (err) {
      console.error("Edge merge (junction) failed:", err);
    }
  }, [edgeMergeDialog, splitEdgeWithJunction, addEdge]);

  const handleEdgeMergeReplace = useCallback(async () => {
    if (!edgeMergeDialog) return;
    const { sourceNodeId, sourceHandleId, targetEdgeId } = edgeMergeDialog;
    setEdgeMergeDialog(null);

    try {
      const { dbEdges } = useGraphStore.getState();
      const targetEdge = dbEdges.find((e) => e.id === targetEdgeId);
      if (!targetEdge) return;

      // Determine target handle: keep the existing target handle
      const opposites: Record<string, string> = { right: "left", left: "right" };
      const newTargetHandle = targetEdge.target_handle ?? (opposites[sourceHandleId] + "-target");

      // Replace: update the edge source to the new node
      await reconnectEdge(
        targetEdgeId,
        sourceNodeId,
        targetEdge.target_node_id,
        sourceHandleId,
        newTargetHandle,
      );
    } catch (err) {
      console.error("Edge replace failed:", err);
    }
  }, [edgeMergeDialog, reconnectEdge]);

  return (
    <div
      ref={canvasContainerRef}
      style={{ width: "100%", height: "100%", background: canvasBackground }}
      onMouseDown={handleRightMouseDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onMouseMove={(e: React.MouseEvent) => {
          lastMousePos.current = { x: e.clientX, y: e.clientY };
        }}
        onEdgeClick={handleEdgeClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: "annotated" }}
        connectionRadius={40}
        edgesReconnectable
        onReconnectStart={handleReconnectStart}
        onReconnect={handleReconnect}
        onReconnectEnd={handleReconnectEnd}
        minZoom={0.05}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        panOnDrag={cursorMode === "normal"}
        selectionOnDrag={cursorMode === "select"}
        multiSelectionKeyCode="Shift"
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={null}
        style={{
          background: canvasBackground,
          cursor: cursorMode === "select" ? "crosshair" : undefined,
        }}
      >
        {canvasGridEnabled && <Background gap={canvasGridSize} />}
        {/* Top-left cursor mode indicator */}
        <CursorModeIndicator mode={cursorMode} />
        {/* Bottom-left control group: zoom buttons + minimap toggle | minimap */}
        <CanvasControls
          minimapVisible={minimapVisible}
          onToggleMinimap={() => setMinimapVisible((v) => !v)}
        />
      </ReactFlow>

      {/* Temporary connection line while Tab popover is open from drag */}
      {tabPopover?.sourceHandleId && tabPopover.sourceNodeId && (() => {
        const dbNode = useGraphStore.getState().dbNodes.find((n) => n.id === tabPopover.sourceNodeId);
        if (!dbNode) return null;
        const handlePos = getHandlePos(dbNode, tabPopover.sourceHandleId ?? null);
        const screenStart = flowToScreenPosition({ x: handlePos.x, y: handlePos.y });
        const screenEnd = tabPopover.position;
        // Curve the preview branch like a real edge (bezier), not a straight line.
        const [previewPath] = getBezierPath({
          sourceX: screenStart.x,
          sourceY: screenStart.y,
          sourcePosition: handlePos.position,
          targetX: screenEnd.x,
          targetY: screenEnd.y,
          targetPosition:
            handlePos.position === Position.Left ? Position.Right : Position.Left,
        });
        return (
          <svg
            style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1100 }}
            width="100%"
            height="100%"
          >
            <path
              d={previewPath}
              fill="none"
              stroke="#6b7280"
              strokeWidth={2}
              strokeDasharray="6 3"
            />
          </svg>
        );
      })()}

      {/* Right-click drag selection rectangle */}
      {selectionRect && (
        <div
          style={{
            position: "fixed",
            left: selectionRect.x,
            top: selectionRect.y,
            width: selectionRect.width,
            height: selectionRect.height,
            border: "2px dashed #3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            pointerEvents: "none",
            zIndex: 999,
          }}
        />
      )}

      <EdgeActionMenu onRequestDeleteEdge={onRequestDeleteEdge} />

      {/* Edge merge/replace dialog */}
      {edgeMergeDialog && (
        <>
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
            }}
            onClick={() => setEdgeMergeDialog(null)}
          />
          <div
            style={{
              position: "fixed",
              left: edgeMergeDialog.position.x,
              top: edgeMergeDialog.position.y,
              transform: "translate(-50%, -50%)",
              zIndex: 1001,
              background: "#fff",
              borderRadius: 10,
              boxShadow: "0 4px 20px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.1)",
              padding: "8px 4px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              minWidth: 160,
            }}
          >
            <button
              onClick={handleEdgeMergeJunction}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                border: "none",
                borderRadius: 7,
                background: "transparent",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                color: "#1f2937",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ fontSize: 16 }}>&#9678;</span>
              Junction (Merge)
            </button>
            <button
              onClick={handleEdgeMergeReplace}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                border: "none",
                borderRadius: 7,
                background: "transparent",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                color: "#1f2937",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ fontSize: 16 }}>&#8644;</span>
              Replace (Switch)
            </button>
          </div>
        </>
      )}

      <PdfImportDialog
        isOpen={pdfDialogOpen}
        onClose={handlePdfDialogClose}
        initialFilePath={pdfDropFilePath}
        positionOverride={pendingImport?.position ?? null}
        onImportSuccess={handleImportSuccess}
      />

      <ImageImportDialog
        open={imageDialogOpen}
        onClose={handleImageDialogClose}
        dropFilePath={imageDropFilePath}
        positionOverride={pendingImport?.position ?? null}
        onImportSuccess={handleImportSuccess}
      />

      {/* Drag-and-drop overlay */}
      {dragOverlay && (
        <div style={dragOverlayStyle}>
          <div style={dragOverlayContentStyle}>
            <DescriptionIcon sx={{ fontSize: 40, mb: 1 }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1e40af" }}>
              {dragOverlayText}
            </div>
          </div>
        </div>
      )}

      {/* Paper group button */}
      <GroupingButton />

      {/* Tab-to-Create popover */}
      {tabPopover && (
        <TabCreatePopover
          isOpen={true}
          position={tabPopover.position}
          direction={tabPopover.direction}
          onSelect={handleTabCreateSelect}
          onClose={() => setTabPopover(null)}
        />
      )}
    </div>
  );
}

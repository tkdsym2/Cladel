import { create } from "zustand";
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import type {
  NodeData,
  EdgeData,
  CreateNodeInput,
  CreateEdgeInput,
  UpdateEdgeInput,
  CreateGhostNodeInput,
  GhostData,
  PaperGroupMetadata,
} from "../types";
import * as cmd from "../lib/tauri-commands";
import type { RestoreNodeInput, RestoreEdgeInput } from "../lib/tauri-commands";
import { emitNodeUpdated, emitNodeDeleted, emitGraphChanged } from "../lib/sync-events";
import { useSettingsStore } from "./settingsStore";
import { useUserStore } from "./userStore";

// ─── Undo types ───

interface UndoDeleteNode {
  type: "delete_node";
  node: NodeData;
  edges: EdgeData[];
  flowNodePosition: { x: number; y: number };
}

interface UndoDeleteEdge {
  type: "delete_edge";
  edge: EdgeData;
}

interface UndoBatchDelete {
  type: "batch_delete";
  nodes: { node: NodeData; edges: EdgeData[]; flowNodePosition: { x: number; y: number } }[];
}

type UndoEntry = UndoDeleteNode | UndoDeleteEdge | UndoBatchDelete;

const MAX_UNDO_STACK = 30;

// ─── Shift-key tracking (module-level, outside React lifecycle) ───
// React Flow's internal multiSelectionActive is set via useEffect (async),
// so it can be stale during synchronous click handling. We track Shift
// ourselves and use it in onNodesChange to protect multi-selection.
let _shiftHeld = false;
export function setShiftHeld(v: boolean) {
  _shiftHeld = v;
}

// ─── Default node sizes (reads from UI preferences) ───

function getDefaultNodeSizes(): Record<string, { width: number; height: number }> {
  const prefs = useSettingsStore.getState().uiPreferences;
  return {
    core: { width: prefs.core_default_width, height: prefs.core_default_height },
    paper: { width: prefs.paper_default_width, height: prefs.paper_default_height },
    user_doc: { width: prefs.user_doc_default_width, height: prefs.user_doc_default_height },
    agent_proposal: { width: prefs.ghost_default_width, height: prefs.ghost_default_height },
    image: { width: prefs.image_default_width, height: prefs.image_default_height },
    agent: { width: 280, height: 210 },
    paper_group: { width: 200, height: 200 },
    export: { width: 280, height: 210 },
    nano_banana: { width: 280, height: 210 },
  };
}

// ─── Collapsed grid layout helper ───
// Arrange N items in a grid: cols ≈ rows, prefer more columns when unequal.
const COLLAPSED_NODE_W = 90;
const COLLAPSED_NODE_H = 32;
const COLLAPSED_GAP_X = 4;
const COLLAPSED_GAP_Y = 4;
const COLLAPSED_PAD_X = 10;
const COLLAPSED_PAD_Y = 8;

function collapsedGridLayout(count: number) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.push({
      x: COLLAPSED_PAD_X + col * (COLLAPSED_NODE_W + COLLAPSED_GAP_X),
      y: COLLAPSED_PAD_Y + row * (COLLAPSED_NODE_H + COLLAPSED_GAP_Y),
    });
  }
  const groupW = Math.max(110, COLLAPSED_PAD_X * 2 + cols * COLLAPSED_NODE_W + (cols - 1) * COLLAPSED_GAP_X);
  const groupH = Math.max(80, COLLAPSED_PAD_Y * 2 + rows * COLLAPSED_NODE_H + (rows - 1) * COLLAPSED_GAP_Y);
  return { positions, groupW, groupH };
}

// ─── Helpers: convert between DB models and React Flow models ───

export function dbNodeToFlow(n: NodeData): Node {
  const node: Node = {
    id: n.id,
    type: n.node_type,
    position: { x: n.position_x, y: n.position_y },
    selected: false,
    data: {
      label: n.title,
      title: n.title,
      content: n.content,
      bibtex: n.bibtex,
      metadata: n.metadata,
      pdf_path: n.pdf_path,
      display_id: n.display_id,
      status: n.status,
      created_by: n.created_by,
      creator_user_id: n.creator_user_id,
      creator_user_name: n.creator_user_name,
      node_type: n.node_type,
      layer_id: n.layer_id,
    },
  };
  // Apply stored dimensions so nodes restore their user-set size.
  // Set style (CSS), top-level width/height, AND measured so that
  // NodeResizer handles align immediately on first render without
  // waiting for the async ResizeObserver to populate measured.
  if (n.width != null && n.height != null) {
    node.width = n.width;
    node.height = n.height;
    node.measured = { width: n.width, height: n.height };
    node.style = { width: n.width, height: n.height };
  } else {
    // Apply default landscape (4:3) dimensions for main node types
    const defaultSizes = getDefaultNodeSizes();
    const defaults = defaultSizes[n.node_type];
    if (defaults) {
      node.width = defaults.width;
      node.height = defaults.height;
      node.measured = { width: defaults.width, height: defaults.height };
      node.style = { width: defaults.width, height: defaults.height };
    }
  }
  return node;
}

function dbNodeToFlowWithCount(n: NodeData, commentCount: number): Node {
  const flowNode = dbNodeToFlow(n);
  flowNode.data.commentCount = commentCount;
  return flowNode;
}

export function dbEdgeToFlow(e: EdgeData): Edge {
  return {
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    sourceHandle: e.source_handle ?? undefined,
    targetHandle: e.target_handle ?? undefined,
    type: "annotated",
    data: {
      weight: e.weight,
      comment: e.comment,
      created_by: e.created_by,
    },
  };
}

function dbEdgeToFlowWithCount(e: EdgeData, commentCount: number): Edge {
  const flowEdge = dbEdgeToFlow(e);
  flowEdge.data = { ...flowEdge.data, commentCount };
  return flowEdge;
}

// ─── Store ───

interface GraphStore {
  nodes: Node[];
  edges: Edge[];
  dbNodes: NodeData[];
  dbEdges: EdgeData[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  pendingDeleteNodeId: string | null;
  edgeActionMenu: { edgeId: string; x: number; y: number } | null;
  commentCounts: Record<string, number>;
  edgeCommentCounts: Record<string, number>;
  mutationVersion: number;

  // React Flow event handlers
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  // Data operations
  loadGraph: (layerId: string) => Promise<void>;
  addNode: (input: CreateNodeInput) => Promise<NodeData>;
  removeNode: (nodeId: string) => Promise<void>;
  hardDeleteNode: (nodeId: string) => Promise<void>;
  updateNodePosition: (nodeId: string, x: number, y: number) => Promise<void>;
  updateNodeSize: (nodeId: string, x: number, y: number, width: number, height: number) => Promise<void>;
  updateNodeContent: (
    nodeId: string,
    fields: { title?: string; content?: string; metadata?: string },
  ) => Promise<void>;
  addEdge: (input: CreateEdgeInput) => Promise<EdgeData>;
  removeEdge: (edgeId: string) => Promise<void>;
  updateEdgeData: (input: UpdateEdgeInput) => Promise<void>;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  openEdgeActionMenu: (edgeId: string, x: number, y: number) => void;
  closeEdgeActionMenu: () => void;
  requestDeleteNode: (nodeId: string) => void;
  getDbNode: (nodeId: string) => NodeData | undefined;
  getDbEdge: (edgeId: string) => EdgeData | undefined;
  fetchCommentCounts: () => Promise<void>;
  updateCommentCount: (nodeId: string, delta: number) => void;
  fetchEdgeCommentCounts: () => Promise<void>;
  updateEdgeCommentCount: (edgeId: string, delta: number) => void;

  // Edge reconnection
  reconnectEdge: (
    edgeId: string,
    newSource: string,
    newTarget: string,
    newSourceHandle?: string | null,
    newTargetHandle?: string | null,
  ) => Promise<boolean>;

  // Junction operations
  splitEdgeWithJunction: (edgeId: string) => Promise<void>;
  dissolveJunction: (nodeId: string) => Promise<void>;

  // Ghost node lifecycle
  createGhostNode: (input: CreateGhostNodeInput) => Promise<NodeData>;
  acceptGhostNode: (nodeId: string) => Promise<void>;
  dismissGhostNode: (nodeId: string) => Promise<void>;

  // Cross-window sync
  refreshNode: (nodeId: string) => Promise<void>;

  // Paper group operations
  expandedGroupIds: Set<string>;
  createPaperGroup: (layerId: string, groupName: string, memberNodeIds: string[]) => Promise<void>;
  expandGroup: (groupNodeId: string) => Promise<void>;
  collapseGroup: (groupNodeId: string) => Promise<void>;
  ungroupPapers: (groupNodeId: string) => Promise<void>;
  addPaperToGroup: (groupNodeId: string, paperNodeId: string) => Promise<void>;

  // Drag tracking for paper-to-group drop
  draggingPaperNodeId: string | null;
  setDraggingPaperNodeId: (id: string | null) => void;

  // Detached window tracking
  detachedNodeIds: Set<string>;
  addDetachedNode: (nodeId: string) => void;
  removeDetachedNode: (nodeId: string) => void;
  isNodeDetached: (nodeId: string) => boolean;

  // Undo stack
  undoStack: UndoEntry[];
  undo: () => Promise<void>;

  // Color mode
  colorMode: 'type' | 'user';
  toggleColorMode: () => void;
}

// Helper: increment mutation version to signal dirty state to fileStore
const bumpMutation = (set: (fn: (s: GraphStore) => Partial<GraphStore>) => void) =>
  set((s) => ({ mutationVersion: s.mutationVersion + 1 }));

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  dbNodes: [],
  dbEdges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  pendingDeleteNodeId: null,
  edgeActionMenu: null,
  commentCounts: {},
  edgeCommentCounts: {},
  mutationVersion: 0,
  expandedGroupIds: new Set<string>(),
  draggingPaperNodeId: null,
  detachedNodeIds: new Set<string>(),
  undoStack: [],
  colorMode: 'type',
  toggleColorMode: () => set((s) => ({ colorMode: s.colorMode === 'type' ? 'user' : 'type' })),

  onNodesChange: (changes) => {
    // ── Guard against React Flow's stale multiSelectionActive bug ──
    // When Shift is held and the user clicks an unselected node, React Flow's
    // internal handleNodeClick may take the single-select path (because
    // multiSelectionActive is set via useEffect and can be stale). That path
    // emits select changes that deselect ALL other nodes and select only the
    // clicked one. We detect this pattern and strip out the deselections.
    let filteredChanges = changes;
    if (_shiftHeld) {
      const selectChanges = changes.filter(
        (c): c is { type: "select"; id: string; selected: boolean } =>
          c.type === "select",
      );
      if (selectChanges.length > 1) {
        const hasSelect = selectChanges.some((c) => c.selected);
        const hasDeselect = selectChanges.some((c) => !c.selected);
        if (hasSelect && hasDeselect) {
          // Strip deselections — keep the new selection + all non-select changes
          filteredChanges = changes.filter(
            (c) => c.type !== "select" || (c.type === "select" && c.selected),
          );
        }
      }
    }

    const newNodes = applyNodeChanges(filteredChanges, get().nodes);

    // When selection changes, sync selectedNodeId in the SAME set() call
    // to avoid an extra render cycle (which caused intermittent multi-select bugs).
    if (filteredChanges.some((c) => c.type === "select")) {
      const selected = newNodes.filter((n) => n.selected);
      let newSelectedNodeId: string | null = null;
      if (selected.length === 1) {
        const n = selected[0];
        if (
          n.type !== "junction" &&
          n.type !== "deleted" &&
          !get().detachedNodeIds.has(n.id)
        ) {
          newSelectedNodeId = n.id;
        }
      }
      set({
        nodes: newNodes,
        selectedNodeId: newSelectedNodeId,
        selectedEdgeId: null,
        edgeActionMenu: null,
      });
    } else {
      set({ nodes: newNodes });
    }
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: async (connection) => {
    const { dbEdges } = get();
    const firstDbNode = get().dbNodes[0];
    if (!firstDbNode) return;

    const input: CreateEdgeInput = {
      layer_id: firstDbNode.layer_id,
      source_node_id: connection.source,
      target_node_id: connection.target,
      weight: 3,
      comment: "",
      source_handle: connection.sourceHandle ?? null,
      target_handle: connection.targetHandle ?? null,
    };

    try {
      const edgeData = await cmd.createEdge(input);
      set({
        edges: [...get().edges, dbEdgeToFlow(edgeData)],
        dbEdges: [...dbEdges, edgeData],
      });
      bumpMutation(set);
      emitGraphChanged();
    } catch (err) {
      console.error("Failed to create edge:", err);
    }
  },

  loadGraph: async (layerId: string) => {
    const [dbNodes, dbEdges] = await Promise.all([
      cmd.getNodesByLayer(layerId),
      cmd.getEdgesByLayer(layerId),
    ]);
    // Fetch comment counts for paper, user_doc, and image nodes
    const commentableIds = dbNodes
      .filter((n) => n.node_type === "paper" || n.node_type === "user_doc" || n.node_type === "image")
      .map((n) => n.id);
    let counts: Record<string, number> = {};
    if (commentableIds.length > 0) {
      const result = await cmd.getNodeCommentCounts(commentableIds);
      for (const r of result) {
        counts[r.node_id] = r.count;
      }
    }
    // Fetch edge comment counts
    const edgeIds = dbEdges.map((e) => e.id);
    let edgeCounts: Record<string, number> = {};
    if (edgeIds.length > 0) {
      const result = await cmd.getEdgeCommentCounts(edgeIds);
      for (const r of result) {
        edgeCounts[r.edge_id] = r.count;
      }
    }
    // Build flow nodes and apply paper_group parentId relationships
    let flowNodes = dbNodes.map((n) => dbNodeToFlowWithCount(n, counts[n.id] ?? 0));

    // Scan for paper_group nodes and set up parentId on members
    const memberToGroup = new Map<string, string>();
    for (const n of dbNodes) {
      if (n.node_type === "paper_group" && n.metadata) {
        try {
          const meta = JSON.parse(n.metadata) as PaperGroupMetadata;
          for (const memberId of meta.member_node_ids) {
            memberToGroup.set(memberId, n.id);
          }
        } catch { /* ignore */ }
      }
    }

    if (memberToGroup.size > 0) {
      flowNodes = flowNodes.map((fn) => {
        const groupId = memberToGroup.get(fn.id);
        if (groupId) {
          return { ...fn, parentId: groupId, extent: "parent" as const };
        }
        return fn;
      });
      // Sort: group nodes must come before their children
      flowNodes.sort((a, b) => {
        const aIsGroup = a.type === "paper_group" ? 0 : 1;
        const bIsGroup = b.type === "paper_group" ? 0 : 1;
        return aIsGroup - bIsGroup;
      });
    }

    set({
      dbNodes,
      dbEdges,
      nodes: flowNodes,
      edges: dbEdges.map((e) =>
        dbEdgeToFlowWithCount(e, edgeCounts[e.id] ?? 0),
      ),
      commentCounts: counts,
      edgeCommentCounts: edgeCounts,
      selectedNodeId: null,
      selectedEdgeId: null,
      edgeActionMenu: null,
      pendingDeleteNodeId: null,
      expandedGroupIds: new Set<string>(),
      undoStack: [],
    });
  },

  addNode: async (input: CreateNodeInput) => {
    if (!input.creator_user_id) {
      const u = useUserStore.getState();
      input.creator_user_id = u.userId;
      input.creator_user_name = u.userName;
    }
    const nodeData = await cmd.createNode(input);
    set((s) => ({
      dbNodes: [...s.dbNodes, nodeData],
      nodes: [...s.nodes, dbNodeToFlow(nodeData)],
    }));
    bumpMutation(set);
    emitGraphChanged();
    return nodeData;
  },

  removeNode: async (nodeId: string) => {
    await cmd.deleteNode(nodeId);
    set((s) => ({
      dbNodes: s.dbNodes.filter((n) => n.id !== nodeId),
      dbEdges: s.dbEdges.filter(
        (e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId,
      ),
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId,
      ),
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
    }));
    bumpMutation(set);
    emitNodeDeleted(nodeId);
  },

  hardDeleteNode: async (nodeId: string) => {
    // Capture undo data before deletion
    const { dbNodes, dbEdges, nodes } = get();
    const nodeData = dbNodes.find((n) => n.id === nodeId);
    const flowNode = nodes.find((n) => n.id === nodeId);
    const connectedEdges = dbEdges.filter(
      (e) => e.source_node_id === nodeId || e.target_node_id === nodeId,
    );

    await cmd.deleteNode(nodeId);
    set((s) => ({
      dbNodes: s.dbNodes.filter((n) => n.id !== nodeId),
      dbEdges: s.dbEdges.filter(
        (e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId,
      ),
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId,
      ),
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
      undoStack: nodeData
        ? [...s.undoStack, {
            type: "delete_node" as const,
            node: nodeData,
            edges: connectedEdges,
            flowNodePosition: flowNode?.position ?? { x: nodeData.position_x, y: nodeData.position_y },
          }].slice(-MAX_UNDO_STACK)
        : s.undoStack,
    }));
    bumpMutation(set);
    emitNodeDeleted(nodeId);
  },

  updateNodePosition: async (nodeId: string, x: number, y: number) => {
    await cmd.updateNode({ id: nodeId, position_x: x, position_y: y });
    set((s) => ({
      dbNodes: s.dbNodes.map((n) =>
        n.id === nodeId ? { ...n, position_x: x, position_y: y } : n,
      ),
    }));
    bumpMutation(set);
  },

  updateNodeSize: async (nodeId: string, x: number, y: number, width: number, height: number) => {
    await cmd.updateNode({ id: nodeId, position_x: x, position_y: y, width, height });
    set((s) => ({
      dbNodes: s.dbNodes.map((n) =>
        n.id === nodeId ? { ...n, position_x: x, position_y: y, width, height } : n,
      ),
    }));
    bumpMutation(set);
  },

  updateNodeContent: async (nodeId, fields) => {
    await cmd.updateNode({ id: nodeId, ...fields });
    set((s) => {
      const updatedDbNodes = s.dbNodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              ...(fields.title !== undefined && { title: fields.title }),
              ...(fields.content !== undefined && { content: fields.content }),
              ...(fields.metadata !== undefined && { metadata: fields.metadata }),
            }
          : n,
      );
      const updatedNodes = s.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                ...(fields.title !== undefined && {
                  title: fields.title,
                  label: fields.title,
                }),
                ...(fields.content !== undefined && {
                  content: fields.content,
                }),
                ...(fields.metadata !== undefined && {
                  metadata: fields.metadata,
                }),
              },
            }
          : n,
      );
      return { dbNodes: updatedDbNodes, nodes: updatedNodes };
    });
    bumpMutation(set);
    emitNodeUpdated(nodeId);
  },

  addEdge: async (input: CreateEdgeInput) => {
    const edgeData = await cmd.createEdge(input);
    set((s) => ({
      dbEdges: [...s.dbEdges, edgeData],
      edges: [...s.edges, dbEdgeToFlow(edgeData)],
    }));
    bumpMutation(set);
    return edgeData;
  },

  removeEdge: async (edgeId: string) => {
    const { dbEdges, dbNodes } = get();
    const deletedEdge = dbEdges.find((e) => e.id === edgeId);

    await cmd.deleteEdge(edgeId);
    set((s) => ({
      dbEdges: s.dbEdges.filter((e) => e.id !== edgeId),
      edges: s.edges.filter((e) => e.id !== edgeId),
      selectedEdgeId: s.selectedEdgeId === edgeId ? null : s.selectedEdgeId,
      undoStack: deletedEdge
        ? [...s.undoStack, { type: "delete_edge" as const, edge: deletedEdge }].slice(-MAX_UNDO_STACK)
        : s.undoStack,
    }));
    bumpMutation(set);

    // Auto-cleanup orphaned junction nodes:
    // If either endpoint of the deleted edge is a junction, check remaining connections.
    // If the junction has fewer than 2 remaining edges, hard-delete it.
    if (deletedEdge) {
      const endpointIds = [deletedEdge.source_node_id, deletedEdge.target_node_id];
      for (const nodeId of endpointIds) {
        const node = dbNodes.find((n) => n.id === nodeId);
        if (!node || node.node_type !== "junction") continue;

        const remainingEdges = get().dbEdges.filter(
          (e) => e.source_node_id === nodeId || e.target_node_id === nodeId,
        );
        if (remainingEdges.length < 2) {
          try {
            await cmd.deleteNode(nodeId);
            set((s) => ({
              dbNodes: s.dbNodes.filter((n) => n.id !== nodeId),
              dbEdges: s.dbEdges.filter(
                (e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId,
              ),
              nodes: s.nodes.filter((n) => n.id !== nodeId),
              edges: s.edges.filter(
                (e) => e.source !== nodeId && e.target !== nodeId,
              ),
              selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
            }));
            bumpMutation(set);
          } catch (err) {
            console.error("Failed to auto-cleanup orphaned junction:", err);
          }
        }
      }
    }
  },

  updateEdgeData: async (input: UpdateEdgeInput) => {
    const updated = await cmd.updateEdge(input);
    set((s) => ({
      dbEdges: s.dbEdges.map((e) => (e.id === input.id ? updated : e)),
      edges: s.edges.map((e) =>
        e.id === input.id ? dbEdgeToFlow(updated) : e,
      ),
    }));
    bumpMutation(set);
  },

  setSelectedNodeId: (id) => {
    set({ selectedNodeId: id, selectedEdgeId: null });
  },

  setSelectedEdgeId: (id) => {
    set({ selectedEdgeId: id, selectedNodeId: null, edgeActionMenu: null });
  },

  openEdgeActionMenu: (edgeId, x, y) => {
    set({ edgeActionMenu: { edgeId, x, y }, selectedNodeId: null, selectedEdgeId: null });
  },

  closeEdgeActionMenu: () => {
    set({ edgeActionMenu: null });
  },

  requestDeleteNode: (nodeId) => {
    set({ pendingDeleteNodeId: nodeId });
  },

  getDbNode: (nodeId) => {
    return get().dbNodes.find((n) => n.id === nodeId);
  },

  getDbEdge: (edgeId) => {
    return get().dbEdges.find((e) => e.id === edgeId);
  },

  fetchCommentCounts: async () => {
    const commentableIds = get()
      .dbNodes.filter((n) => n.node_type === "paper" || n.node_type === "user_doc" || n.node_type === "image")
      .map((n) => n.id);
    if (commentableIds.length === 0) {
      set({ commentCounts: {} });
      return;
    }
    const result = await cmd.getNodeCommentCounts(commentableIds);
    const counts: Record<string, number> = {};
    for (const r of result) {
      counts[r.node_id] = r.count;
    }
    set((s) => ({
      commentCounts: counts,
      nodes: s.nodes.map((n) =>
        n.type === "paper" || n.type === "user_doc" || n.type === "image"
          ? { ...n, data: { ...n.data, commentCount: counts[n.id] ?? 0 } }
          : n,
      ),
    }));
  },

  updateCommentCount: (nodeId, delta) => {
    set((s) => {
      const prev = s.commentCounts[nodeId] ?? 0;
      const next = Math.max(0, prev + delta);
      const newCounts = { ...s.commentCounts, [nodeId]: next };
      return {
        commentCounts: newCounts,
        nodes: s.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, commentCount: next } }
            : n,
        ),
      };
    });
  },

  fetchEdgeCommentCounts: async () => {
    const edgeIds = get().dbEdges.map((e) => e.id);
    if (edgeIds.length === 0) {
      set({ edgeCommentCounts: {} });
      return;
    }
    const result = await cmd.getEdgeCommentCounts(edgeIds);
    const counts: Record<string, number> = {};
    for (const r of result) {
      counts[r.edge_id] = r.count;
    }
    set((s) => ({
      edgeCommentCounts: counts,
      edges: s.edges.map((e) => ({
        ...e,
        data: { ...e.data, commentCount: counts[e.id] ?? 0 },
      })),
    }));
  },

  updateEdgeCommentCount: (edgeId, delta) => {
    set((s) => {
      const prev = s.edgeCommentCounts[edgeId] ?? 0;
      const next = Math.max(0, prev + delta);
      const newCounts = { ...s.edgeCommentCounts, [edgeId]: next };
      return {
        edgeCommentCounts: newCounts,
        edges: s.edges.map((e) =>
          e.id === edgeId
            ? { ...e, data: { ...e.data, commentCount: next } }
            : e,
        ),
      };
    });
  },

  // ─── Edge reconnection ───

  reconnectEdge: async (edgeId, newSource, newTarget, newSourceHandle, newTargetHandle) => {
    // Validation: no self-loops
    if (newSource === newTarget) return false;

    const { dbEdges } = get();
    const oldEdge = dbEdges.find((e) => e.id === edgeId);
    if (!oldEdge) return false;

    // Validation: no duplicate edges (same source-target pair, excluding this edge)
    const duplicate = dbEdges.some(
      (e) =>
        e.id !== edgeId &&
        e.source_node_id === newSource &&
        e.target_node_id === newTarget,
    );
    if (duplicate) return false;

    // Determine which endpoint(s) changed
    const sourceChanged = oldEdge.source_node_id !== newSource;
    const targetChanged = oldEdge.target_node_id !== newTarget;
    if (!sourceChanged && !targetChanged) return true; // no change

    // Optimistic update: immediately update flow edges so the edge
    // renders at its new position with correct styling before the
    // API round-trip completes.
    set((s) => ({
      edges: s.edges.map((e) =>
        e.id === edgeId
          ? {
              ...e,
              source: newSource,
              target: newTarget,
              sourceHandle: newSourceHandle ?? undefined,
              targetHandle: newTargetHandle ?? undefined,
            }
          : e,
      ),
    }));

    // Persist to database
    try {
      const updated = await cmd.updateEdge({
        id: edgeId,
        ...(sourceChanged ? { source_node_id: newSource } : {}),
        ...(targetChanged ? { target_node_id: newTarget } : {}),
        source_handle: newSourceHandle ?? null,
        target_handle: newTargetHandle ?? null,
      });

      // Sync dbEdges with the server response
      set((s) => ({
        dbEdges: s.dbEdges.map((e) => (e.id === edgeId ? updated : e)),
      }));

      // Cleanup orphaned deleted placeholders.
      // Check the old endpoint(s) that were disconnected.
      const disconnectedNodeIds: string[] = [];
      if (sourceChanged) disconnectedNodeIds.push(oldEdge.source_node_id);
      if (targetChanged) disconnectedNodeIds.push(oldEdge.target_node_id);

      for (const nodeId of disconnectedNodeIds) {
        const node = get().dbNodes.find((n) => n.id === nodeId);
        if (!node || node.node_type !== "deleted") continue;

        // Check if the placeholder still has any edges
        const hasEdges = get().dbEdges.some(
          (e) => e.source_node_id === nodeId || e.target_node_id === nodeId,
        );
        if (!hasEdges) {
          // Auto-remove orphaned placeholder
          await cmd.deleteNode(nodeId);
          set((s) => ({
            dbNodes: s.dbNodes.filter((n) => n.id !== nodeId),
            nodes: s.nodes.filter((n) => n.id !== nodeId),
          }));
        }
      }

      bumpMutation(set);
      return true;
    } catch (err) {
      console.error("Failed to reconnect edge:", err);
      // Revert optimistic update on failure
      set((s) => ({
        edges: s.edges.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                source: oldEdge.source_node_id,
                target: oldEdge.target_node_id,
              }
            : e,
        ),
      }));
      return false;
    }
  },

  // ─── Junction operations ───

  splitEdgeWithJunction: async (edgeId: string) => {
    const { dbEdges, dbNodes, edgeCommentCounts } = get();

    const dbEdge = dbEdges.find((e) => e.id === edgeId);
    if (!dbEdge) return;

    // Calculate midpoint from source and target node positions
    const sourceNode = dbNodes.find((n) => n.id === dbEdge.source_node_id);
    const targetNode = dbNodes.find((n) => n.id === dbEdge.target_node_id);
    if (!sourceNode || !targetNode) return;

    const midX = (sourceNode.position_x + targetNode.position_x) / 2;
    const midY = (sourceNode.position_y + targetNode.position_y) / 2;

    try {
      const result = await cmd.splitEdgeAtJunction(edgeId, midX, midY);

      // Carry over the comment count from the old edge to edge_a
      const oldCommentCount = edgeCommentCounts[edgeId] ?? 0;

      set((s) => ({
        // Remove old edge, add two new edges
        dbEdges: [
          ...s.dbEdges.filter((e) => e.id !== edgeId),
          result.edge_a,
          result.edge_b,
        ],
        edges: [
          ...s.edges.filter((e) => e.id !== edgeId),
          dbEdgeToFlowWithCount(result.edge_a, oldCommentCount),
          dbEdgeToFlowWithCount(result.edge_b, 0),
        ],
        // Add junction node
        dbNodes: [...s.dbNodes, result.junction_node],
        nodes: [...s.nodes, dbNodeToFlow(result.junction_node)],
        // Update edge comment counts
        edgeCommentCounts: {
          ...s.edgeCommentCounts,
          [result.edge_a.id]: oldCommentCount,
          [result.edge_b.id]: 0,
        },
        // Clear selection
        selectedEdgeId: null,
      }));
      bumpMutation(set);
    } catch (err) {
      console.error("Failed to split edge at junction:", err);
    }
  },

  dissolveJunction: async (nodeId: string) => {
    try {
      // Gather comment counts from the edges connected to this junction
      const { dbEdges, edgeCommentCounts } = get();
      const connectedEdges = dbEdges.filter(
        (e) => e.source_node_id === nodeId || e.target_node_id === nodeId,
      );
      const totalComments = connectedEdges.reduce(
        (sum, e) => sum + (edgeCommentCounts[e.id] ?? 0),
        0,
      );

      const result = await cmd.dissolveJunction(nodeId);

      set((s) => ({
        // Remove junction node
        dbNodes: s.dbNodes.filter((n) => n.id !== nodeId),
        nodes: s.nodes.filter((n) => n.id !== nodeId),
        // Remove old edges connected to junction, add merged edge
        dbEdges: [
          ...s.dbEdges.filter(
            (e) =>
              e.source_node_id !== nodeId && e.target_node_id !== nodeId,
          ),
          result.merged_edge,
        ],
        edges: [
          ...s.edges.filter(
            (e) => e.source !== nodeId && e.target !== nodeId,
          ),
          dbEdgeToFlowWithCount(result.merged_edge, totalComments),
        ],
        // Update edge comment counts
        edgeCommentCounts: {
          ...Object.fromEntries(
            Object.entries(s.edgeCommentCounts).filter(
              ([id]) => !connectedEdges.some((e) => e.id === id),
            ),
          ),
          [result.merged_edge.id]: totalComments,
        },
        // Clear selection if junction was selected
        selectedNodeId:
          s.selectedNodeId === nodeId ? null : s.selectedNodeId,
      }));
      bumpMutation(set);
    } catch (err) {
      console.error("Failed to dissolve junction:", err);
    }
  },

  // ─── Ghost node lifecycle ───

  createGhostNode: async (input: CreateGhostNodeInput) => {
    const ghostData: GhostData = {
      proposal_type: input.proposal_type,
      reason: input.reason,
      paper_id: input.paper_id,
      authors: input.authors,
      year: input.year,
      abstract_text: input.abstract_text,
      url: input.url,
      body: input.body,
      suggested_edges: input.suggested_edges,
    };

    const content =
      input.proposal_type === "idea"
        ? input.body ?? null
        : input.abstract_text ?? null;

    const ghostSizes = getDefaultNodeSizes().agent_proposal;
    const nodeData = await cmd.createNode({
      layer_id: input.layer_id,
      node_type: "agent_proposal",
      title: input.title,
      content,
      metadata: JSON.stringify(ghostData),
      position_x: input.position_x,
      position_y: input.position_y,
      width: ghostSizes.width,
      height: ghostSizes.height,
      created_by: "agent",
    });

    set((s) => ({
      dbNodes: [...s.dbNodes, nodeData],
      nodes: [...s.nodes, dbNodeToFlow(nodeData)],
    }));
    bumpMutation(set);

    return nodeData;
  },

  acceptGhostNode: async (nodeId: string) => {
    const ghostNode = get().dbNodes.find((n) => n.id === nodeId);
    if (!ghostNode || ghostNode.node_type !== "agent_proposal") return;

    let ghostData: GhostData | null = null;
    if (ghostNode.metadata) {
      try {
        ghostData = JSON.parse(ghostNode.metadata) as GhostData;
      } catch {
        /* ignore parse errors */
      }
    }

    const proposalType = ghostData?.proposal_type ?? "idea";
    let newNode: NodeData;

    const sizes = getDefaultNodeSizes();
    if (proposalType === "paper") {
      // Convert to paper node
      const paperMeta = JSON.stringify({
        authors: ghostData?.authors ?? [],
        year: ghostData?.year,
        paper_id: ghostData?.paper_id,
        url: ghostData?.url,
      });
      newNode = await cmd.createNode({
        layer_id: ghostNode.layer_id,
        node_type: "paper",
        title: ghostNode.title,
        content: ghostData?.abstract_text ?? ghostNode.content,
        metadata: paperMeta,
        position_x: ghostNode.position_x,
        position_y: ghostNode.position_y,
        width: sizes.paper.width,
        height: sizes.paper.height,
        creator_user_id: useUserStore.getState().userId,
        creator_user_name: useUserStore.getState().userName,
      });
    } else {
      // Convert to user_doc node (for "idea" and "connection" proposals)
      newNode = await cmd.createNode({
        layer_id: ghostNode.layer_id,
        node_type: "user_doc",
        title: ghostNode.title,
        content: ghostData?.body ?? ghostNode.content,
        position_x: ghostNode.position_x,
        position_y: ghostNode.position_y,
        width: sizes.user_doc.width,
        height: sizes.user_doc.height,
        creator_user_id: useUserStore.getState().userId,
        creator_user_name: useUserStore.getState().userName,
      });
    }

    // Create suggested edges if any
    const suggestedEdges = ghostData?.suggested_edges ?? [];
    const createdEdges: EdgeData[] = [];
    for (const se of suggestedEdges) {
      try {
        const edge = await cmd.createEdge({
          layer_id: ghostNode.layer_id,
          source_node_id: newNode.id,
          target_node_id: se.target_node_id,
          weight: 3,
          comment: se.comment,
        });
        createdEdges.push(edge);
      } catch {
        // Skip edges that fail (e.g., target no longer exists)
      }
    }

    // Delete the ghost node
    await cmd.deleteNode(nodeId);

    // Update store in one batch
    set((s) => ({
      dbNodes: [
        ...s.dbNodes.filter((n) => n.id !== nodeId),
        newNode,
      ],
      dbEdges: [...s.dbEdges, ...createdEdges],
      nodes: [
        ...s.nodes.filter((n) => n.id !== nodeId),
        dbNodeToFlow(newNode),
      ],
      edges: [
        ...s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
        ...createdEdges.map(dbEdgeToFlow),
      ],
      selectedNodeId:
        s.selectedNodeId === nodeId ? newNode.id : s.selectedNodeId,
    }));
    bumpMutation(set);
  },

  dismissGhostNode: async (nodeId: string) => {
    await cmd.deleteNode(nodeId);
    set((s) => ({
      dbNodes: s.dbNodes.filter((n) => n.id !== nodeId),
      dbEdges: s.dbEdges.filter(
        (e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId,
      ),
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId,
      ),
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
    }));
    bumpMutation(set);
  },

  // ─── Cross-window sync ───

  refreshNode: async (nodeId: string) => {
    // Find the node's layer from current store data
    const existing = get().dbNodes.find((n) => n.id === nodeId);
    if (!existing) return; // node not in current graph
    try {
      const nodes = await cmd.getNodesByLayer(existing.layer_id);
      const updated = nodes.find((n: NodeData) => n.id === nodeId);
      if (!updated) return;
      const commentCount = get().commentCounts[nodeId] ?? 0;
      set((s) => ({
        dbNodes: s.dbNodes.map((n) => (n.id === nodeId ? updated : n)),
        nodes: s.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const flow = dbNodeToFlowWithCount(updated, commentCount);
          // Preserve ALL React Flow internal state (position, measured, selected,
          // internals/handleBounds, width, height, style, dragging, etc.) from the
          // existing node. Only update `data` so the component re-renders with fresh
          // DB values (title, content, metadata, pdf_path, display_id, etc.).
          // Replacing the full node object would strip internals and force React Flow
          // to re-compute handle bounds, which misaligns NodeResizer handles.
          return {
            ...n,
            data: flow.data,
          };
        }),
      }));
    } catch (err) {
      console.error("refreshNode failed:", err);
    }
  },

  // ─── Paper group operations ───

  createPaperGroup: async (layerId: string, groupName: string, memberNodeIds: string[]) => {
    const { dbNodes, nodes: flowNodes } = get();

    // Compute centroid of member papers
    let sumX = 0, sumY = 0;
    const origPositions: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const mid of memberNodeIds) {
      const dbn = dbNodes.find((n) => n.id === mid);
      const fn = flowNodes.find((n) => n.id === mid);
      if (!dbn) continue;
      const w = fn?.measured?.width ?? dbn.width ?? 280;
      const h = fn?.measured?.height ?? dbn.height ?? 210;
      sumX += dbn.position_x;
      sumY += dbn.position_y;
      origPositions[mid] = { x: dbn.position_x, y: dbn.position_y, width: w, height: h };
    }
    const cx = sumX / memberNodeIds.length;
    const cy = sumY / memberNodeIds.length;
    const { positions: gridPositions, groupW, groupH } = collapsedGridLayout(memberNodeIds.length);

    const meta: PaperGroupMetadata = {
      group_name: groupName,
      member_node_ids: memberNodeIds,
      original_positions: origPositions,
      collapsed_size: { width: groupW, height: groupH },
      expanded: false,
    };

    // Create group node in DB
    const groupNode = await cmd.createNode({
      layer_id: layerId,
      node_type: "paper_group",
      title: groupName,
      metadata: JSON.stringify(meta),
      position_x: cx - groupW / 2,
      position_y: cy - groupH / 2,
      width: groupW,
      height: groupH,
      creator_user_id: useUserStore.getState().userId,
    });

    // Update member papers: convert to relative positions, resize to small
    for (let i = 0; i < memberNodeIds.length; i++) {
      const mid = memberNodeIds[i];
      const pos = gridPositions[i];
      await cmd.updateNode({
        id: mid,
        position_x: pos.x,
        position_y: pos.y,
        width: COLLAPSED_NODE_W,
        height: COLLAPSED_NODE_H,
      });
    }

    // Rebuild flow nodes
    const groupFlowNode = dbNodeToFlow(groupNode);
    const updatedFlowNodes: typeof flowNodes = [];
    // Add group first (parent must come before children)
    updatedFlowNodes.push(groupFlowNode);

    for (const fn of flowNodes) {
      const idx = memberNodeIds.indexOf(fn.id);
      if (idx >= 0) {
        const pos = gridPositions[idx];
        updatedFlowNodes.push({
          ...fn,
          parentId: groupNode.id,
          extent: "parent" as const,
          position: pos,
          width: COLLAPSED_NODE_W,
          height: COLLAPSED_NODE_H,
          measured: { width: COLLAPSED_NODE_W, height: COLLAPSED_NODE_H },
          style: { width: COLLAPSED_NODE_W, height: COLLAPSED_NODE_H },
        });
      } else {
        updatedFlowNodes.push(fn);
      }
    }

    // Update dbNodes
    const updatedDbNodes = [...dbNodes, groupNode].map((n) => {
      const idx = memberNodeIds.indexOf(n.id);
      if (idx >= 0) {
        const pos = gridPositions[idx];
        return {
          ...n,
          position_x: pos.x,
          position_y: pos.y,
          width: COLLAPSED_NODE_W,
          height: COLLAPSED_NODE_H,
        };
      }
      return n;
    });

    set({
      dbNodes: updatedDbNodes,
      nodes: updatedFlowNodes,
      selectedNodeId: groupNode.id,
    });
    bumpMutation(set);
  },

  expandGroup: async (groupNodeId: string) => {
    const { dbNodes, nodes: flowNodes, expandedGroupIds } = get();
    const groupDb = dbNodes.find((n) => n.id === groupNodeId);
    if (!groupDb?.metadata) return;

    let meta: PaperGroupMetadata;
    try {
      meta = JSON.parse(groupDb.metadata) as PaperGroupMetadata;
    } catch { return; }

    const memberIds = meta.member_node_ids;
    const FULL_W = 280;
    const FULL_H = 210;
    const COLS = Math.ceil(Math.sqrt(memberIds.length));
    const GAP_X = FULL_W + 40;
    const GAP_Y = FULL_H + 40;
    const PADDING = 60;

    // Save current collapsed size before expanding
    const groupFlowNode = flowNodes.find((fn) => fn.id === groupNodeId);
    const collapsedW = groupFlowNode?.measured?.width ?? groupFlowNode?.width ?? groupDb.width ?? 110;
    const collapsedH = groupFlowNode?.measured?.height ?? groupFlowNode?.height ?? groupDb.height ?? 80;
    const expandMeta = { ...meta, collapsed_size: { width: collapsedW, height: collapsedH } };

    // Layout members in a grid
    const memberPositions: Record<string, { x: number; y: number }> = {};
    for (let i = 0; i < memberIds.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      memberPositions[memberIds[i]] = {
        x: PADDING + col * GAP_X,
        y: PADDING + 30 + row * GAP_Y, // 30 for header
      };
    }

    const rows = Math.ceil(memberIds.length / COLS);
    const expandedW = PADDING * 2 + COLS * GAP_X - 40;
    const expandedH = PADDING * 2 + 30 + rows * GAP_Y - 40;

    // Update group size in DB
    await cmd.updateNode({
      id: groupNodeId,
      width: expandedW,
      height: expandedH,
      metadata: JSON.stringify({ ...expandMeta, expanded: true }),
    });

    // Update member positions and sizes in DB
    for (const mid of memberIds) {
      const pos = memberPositions[mid];
      const orig = meta.original_positions[mid];
      await cmd.updateNode({
        id: mid,
        position_x: pos.x,
        position_y: pos.y,
        width: orig?.width ?? FULL_W,
        height: orig?.height ?? FULL_H,
      });
    }

    const expandedMetaStr = JSON.stringify({ ...expandMeta, expanded: true });

    // Update flow nodes
    const newFlowNodes = flowNodes.map((fn) => {
      if (fn.id === groupNodeId) {
        return {
          ...fn,
          width: expandedW,
          height: expandedH,
          measured: { width: expandedW, height: expandedH },
          style: { width: expandedW, height: expandedH },
          data: { ...fn.data, metadata: expandedMetaStr },
        };
      }
      const pos = memberPositions[fn.id];
      if (pos) {
        const orig = expandMeta.original_positions[fn.id];
        const w = orig?.width ?? FULL_W;
        const h = orig?.height ?? FULL_H;
        return {
          ...fn,
          position: pos,
          width: w,
          height: h,
          measured: { width: w, height: h },
          style: { width: w, height: h },
        };
      }
      return fn;
    });

    const newDbNodes = dbNodes.map((n) => {
      if (n.id === groupNodeId) {
        return { ...n, width: expandedW, height: expandedH, metadata: expandedMetaStr };
      }
      const pos = memberPositions[n.id];
      if (pos) {
        const orig = expandMeta.original_positions[n.id];
        return { ...n, position_x: pos.x, position_y: pos.y, width: orig?.width ?? FULL_W, height: orig?.height ?? FULL_H };
      }
      return n;
    });

    const next = new Set(expandedGroupIds);
    next.add(groupNodeId);
    set({ nodes: newFlowNodes, dbNodes: newDbNodes, expandedGroupIds: next });
    bumpMutation(set);
  },

  collapseGroup: async (groupNodeId: string) => {
    const { dbNodes, nodes: flowNodes, expandedGroupIds } = get();
    const groupDb = dbNodes.find((n) => n.id === groupNodeId);
    if (!groupDb?.metadata) return;

    let meta: PaperGroupMetadata;
    try {
      meta = JSON.parse(groupDb.metadata) as PaperGroupMetadata;
    } catch { return; }

    const memberIds = meta.member_node_ids;
    const { positions: gridPositions, groupW: restoreW, groupH: restoreH } = collapsedGridLayout(memberIds.length);

    // Update group size and metadata in DB
    await cmd.updateNode({
      id: groupNodeId,
      width: restoreW,
      height: restoreH,
      metadata: JSON.stringify({ ...meta, expanded: false }),
    });

    // Update member positions (grid) and sizes in DB
    for (let i = 0; i < memberIds.length; i++) {
      const pos = gridPositions[i];
      await cmd.updateNode({
        id: memberIds[i],
        position_x: pos.x,
        position_y: pos.y,
        width: COLLAPSED_NODE_W,
        height: COLLAPSED_NODE_H,
      });
    }

    const collapsedMetaStr = JSON.stringify({ ...meta, expanded: false, collapsed_size: { width: restoreW, height: restoreH } });

    // Update flow nodes
    const newFlowNodes = flowNodes.map((fn) => {
      if (fn.id === groupNodeId) {
        return {
          ...fn,
          width: restoreW,
          height: restoreH,
          measured: { width: restoreW, height: restoreH },
          style: { width: restoreW, height: restoreH },
          data: { ...fn.data, metadata: collapsedMetaStr },
        };
      }
      const idx = memberIds.indexOf(fn.id);
      if (idx >= 0) {
        const pos = gridPositions[idx];
        return {
          ...fn,
          position: pos,
          width: COLLAPSED_NODE_W,
          height: COLLAPSED_NODE_H,
          measured: { width: COLLAPSED_NODE_W, height: COLLAPSED_NODE_H },
          style: { width: COLLAPSED_NODE_W, height: COLLAPSED_NODE_H },
        };
      }
      return fn;
    });

    const newDbNodes = dbNodes.map((n) => {
      if (n.id === groupNodeId) {
        return { ...n, width: restoreW, height: restoreH, metadata: collapsedMetaStr };
      }
      const idx = memberIds.indexOf(n.id);
      if (idx >= 0) {
        const pos = gridPositions[idx];
        return { ...n, position_x: pos.x, position_y: pos.y, width: COLLAPSED_NODE_W, height: COLLAPSED_NODE_H };
      }
      return n;
    });

    const next = new Set(expandedGroupIds);
    next.delete(groupNodeId);
    set({ nodes: newFlowNodes, dbNodes: newDbNodes, expandedGroupIds: next });
    bumpMutation(set);
  },

  ungroupPapers: async (groupNodeId: string) => {
    const { dbNodes, nodes: flowNodes } = get();
    const groupDb = dbNodes.find((n) => n.id === groupNodeId);
    if (!groupDb?.metadata) return;

    let meta: PaperGroupMetadata;
    try {
      meta = JSON.parse(groupDb.metadata) as PaperGroupMetadata;
    } catch { return; }

    const memberIds = new Set(meta.member_node_ids);
    const groupX = groupDb.position_x;
    const groupY = groupDb.position_y;

    // Restore member papers to absolute positions
    for (const mid of memberIds) {
      const dbn = dbNodes.find((n) => n.id === mid);
      if (!dbn) continue;
      const orig = meta.original_positions[mid];
      const absX = orig?.x ?? (groupX + dbn.position_x);
      const absY = orig?.y ?? (groupY + dbn.position_y);
      const w = orig?.width ?? 280;
      const h = orig?.height ?? 210;
      await cmd.updateNode({
        id: mid,
        position_x: absX,
        position_y: absY,
        width: w,
        height: h,
      });
    }

    // Delete group node from DB
    await cmd.deleteNode(groupNodeId);

    // Rebuild flow nodes: remove parentId from members, remove group node
    const newFlowNodes = flowNodes
      .filter((fn) => fn.id !== groupNodeId)
      .map((fn) => {
        if (memberIds.has(fn.id)) {
          const dbn = dbNodes.find((n) => n.id === fn.id);
          const orig = meta.original_positions[fn.id];
          const absX = orig?.x ?? (groupX + (dbn?.position_x ?? 0));
          const absY = orig?.y ?? (groupY + (dbn?.position_y ?? 0));
          const w = orig?.width ?? 280;
          const h = orig?.height ?? 210;
          const { parentId: _p, extent: _e, ...rest } = fn;
          return {
            ...rest,
            position: { x: absX, y: absY },
            width: w,
            height: h,
            measured: { width: w, height: h },
            style: { width: w, height: h },
          };
        }
        return fn;
      });

    const newDbNodes = dbNodes
      .filter((n) => n.id !== groupNodeId)
      .map((n) => {
        if (memberIds.has(n.id)) {
          const orig = meta.original_positions[n.id];
          return {
            ...n,
            position_x: orig?.x ?? (groupX + n.position_x),
            position_y: orig?.y ?? (groupY + n.position_y),
            width: orig?.width ?? 280,
            height: orig?.height ?? 210,
          };
        }
        return n;
      });

    set((s) => ({
      dbNodes: newDbNodes,
      dbEdges: s.dbEdges.filter(
        (e) => e.source_node_id !== groupNodeId && e.target_node_id !== groupNodeId,
      ),
      nodes: newFlowNodes,
      edges: s.edges.filter(
        (e) => e.source !== groupNodeId && e.target !== groupNodeId,
      ),
      selectedNodeId: s.selectedNodeId === groupNodeId ? null : s.selectedNodeId,
      expandedGroupIds: (() => {
        const next = new Set(s.expandedGroupIds);
        next.delete(groupNodeId);
        return next;
      })(),
    }));
    bumpMutation(set);
  },

  setDraggingPaperNodeId: (id: string | null) => {
    set({ draggingPaperNodeId: id });
  },

  addPaperToGroup: async (groupNodeId: string, paperNodeId: string) => {
    const { dbNodes, nodes: flowNodes, expandedGroupIds } = get();

    const groupDb = dbNodes.find((n) => n.id === groupNodeId);
    const paperDb = dbNodes.find((n) => n.id === paperNodeId);
    if (!groupDb?.metadata || !paperDb || paperDb.node_type !== "paper") return;

    let meta: PaperGroupMetadata;
    try {
      meta = JSON.parse(groupDb.metadata) as PaperGroupMetadata;
    } catch { return; }

    // Already a member of this group
    if (meta.member_node_ids.includes(paperNodeId)) return;

    // Already a member of another group — skip
    for (const n of dbNodes) {
      if (n.id !== groupNodeId && n.node_type === "paper_group" && n.metadata) {
        try {
          const otherMeta = JSON.parse(n.metadata) as PaperGroupMetadata;
          if (otherMeta.member_node_ids.includes(paperNodeId)) return;
        } catch { /* ignore */ }
      }
    }

    // Save original position/size
    const paperFlow = flowNodes.find((fn) => fn.id === paperNodeId);
    const origW = paperFlow?.measured?.width ?? paperDb.width ?? 280;
    const origH = paperFlow?.measured?.height ?? paperDb.height ?? 210;
    meta.original_positions[paperNodeId] = {
      x: paperDb.position_x,
      y: paperDb.position_y,
      width: origW,
      height: origH,
    };
    meta.member_node_ids.push(paperNodeId);

    const isExpanded = expandedGroupIds.has(groupNodeId);
    const memberIds = meta.member_node_ids;

    if (isExpanded) {
      // Recalculate grid layout for all members
      const FULL_W = 280;
      const FULL_H = 210;
      const COLS = Math.ceil(Math.sqrt(memberIds.length));
      const GAP_X = FULL_W + 40;
      const GAP_Y = FULL_H + 40;
      const PADDING = 60;

      const memberPositions: Record<string, { x: number; y: number }> = {};
      for (let i = 0; i < memberIds.length; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        memberPositions[memberIds[i]] = {
          x: PADDING + col * GAP_X,
          y: PADDING + 30 + row * GAP_Y,
        };
      }

      const rows = Math.ceil(memberIds.length / COLS);
      const expandedW = PADDING * 2 + COLS * GAP_X - 40;
      const expandedH = PADDING * 2 + 30 + rows * GAP_Y - 40;

      const updatedMeta = { ...meta, expanded: true };
      const metaStr = JSON.stringify(updatedMeta);

      // Update DB: group size/metadata + new paper position
      await cmd.updateNode({ id: groupNodeId, width: expandedW, height: expandedH, metadata: metaStr });
      for (const mid of memberIds) {
        const pos = memberPositions[mid];
        const orig = meta.original_positions[mid];
        await cmd.updateNode({
          id: mid,
          position_x: pos.x,
          position_y: pos.y,
          width: orig?.width ?? FULL_W,
          height: orig?.height ?? FULL_H,
        });
      }

      // Rebuild flow nodes
      const newFlowNodes: typeof flowNodes = [];
      for (const fn of flowNodes) {
        if (fn.id === groupNodeId) {
          newFlowNodes.push({
            ...fn,
            width: expandedW,
            height: expandedH,
            measured: { width: expandedW, height: expandedH },
            style: { width: expandedW, height: expandedH },
            data: { ...fn.data, metadata: metaStr },
          });
        } else if (fn.id === paperNodeId) {
          // New member — attach to group
          const pos = memberPositions[paperNodeId];
          newFlowNodes.push({
            ...fn,
            parentId: groupNodeId,
            extent: "parent" as const,
            position: pos,
            width: origW,
            height: origH,
            measured: { width: origW, height: origH },
            style: { width: origW, height: origH },
          });
        } else {
          const pos = memberPositions[fn.id];
          if (pos) {
            const orig = meta.original_positions[fn.id];
            const w = orig?.width ?? FULL_W;
            const h = orig?.height ?? FULL_H;
            newFlowNodes.push({ ...fn, position: pos, width: w, height: h, measured: { width: w, height: h }, style: { width: w, height: h } });
          } else {
            newFlowNodes.push(fn);
          }
        }
      }
      // Ensure parent-before-child ordering
      newFlowNodes.sort((a, b) => {
        const aIsGroup = a.type === "paper_group" ? 0 : 1;
        const bIsGroup = b.type === "paper_group" ? 0 : 1;
        return aIsGroup - bIsGroup;
      });

      const newDbNodes = dbNodes.map((n) => {
        if (n.id === groupNodeId) return { ...n, width: expandedW, height: expandedH, metadata: metaStr };
        const pos = memberPositions[n.id];
        if (pos) {
          const orig = meta.original_positions[n.id];
          return { ...n, position_x: pos.x, position_y: pos.y, width: orig?.width ?? FULL_W, height: orig?.height ?? FULL_H };
        }
        return n;
      });

      set({ nodes: newFlowNodes, dbNodes: newDbNodes });
    } else {
      // Collapsed: re-layout all members in grid
      const { positions: gridPositions, groupW, groupH } = collapsedGridLayout(memberIds.length);
      meta.collapsed_size = { width: groupW, height: groupH };
      const metaStr = JSON.stringify({ ...meta, expanded: false });

      await cmd.updateNode({ id: groupNodeId, width: groupW, height: groupH, metadata: metaStr });
      // Update all members to new grid positions
      for (let i = 0; i < memberIds.length; i++) {
        const pos = gridPositions[i];
        await cmd.updateNode({ id: memberIds[i], position_x: pos.x, position_y: pos.y, width: COLLAPSED_NODE_W, height: COLLAPSED_NODE_H });
      }

      // Rebuild flow nodes
      const newFlowNodes: typeof flowNodes = [];
      for (const fn of flowNodes) {
        if (fn.id === groupNodeId) {
          newFlowNodes.push({
            ...fn,
            width: groupW,
            height: groupH,
            measured: { width: groupW, height: groupH },
            style: { width: groupW, height: groupH },
            data: { ...fn.data, metadata: metaStr },
          });
        } else {
          const idx = memberIds.indexOf(fn.id);
          if (idx >= 0) {
            const pos = gridPositions[idx];
            newFlowNodes.push({
              ...fn,
              parentId: groupNodeId,
              extent: "parent" as const,
              position: pos,
              width: COLLAPSED_NODE_W,
              height: COLLAPSED_NODE_H,
              measured: { width: COLLAPSED_NODE_W, height: COLLAPSED_NODE_H },
              style: { width: COLLAPSED_NODE_W, height: COLLAPSED_NODE_H },
            });
          } else {
            newFlowNodes.push(fn);
          }
        }
      }
      newFlowNodes.sort((a, b) => {
        const aIsGroup = a.type === "paper_group" ? 0 : 1;
        const bIsGroup = b.type === "paper_group" ? 0 : 1;
        return aIsGroup - bIsGroup;
      });

      const newDbNodes = dbNodes.map((n) => {
        if (n.id === groupNodeId) return { ...n, width: groupW, height: groupH, metadata: metaStr };
        const idx = memberIds.indexOf(n.id);
        if (idx >= 0) {
          const pos = gridPositions[idx];
          return { ...n, position_x: pos.x, position_y: pos.y, width: COLLAPSED_NODE_W, height: COLLAPSED_NODE_H };
        }
        return n;
      });

      set({ nodes: newFlowNodes, dbNodes: newDbNodes });
    }
    bumpMutation(set);
  },

  // ─── Detached window tracking ───

  addDetachedNode: (nodeId: string) => {
    set((s) => {
      const next = new Set(s.detachedNodeIds);
      next.add(nodeId);
      return { detachedNodeIds: next };
    });
  },

  removeDetachedNode: (nodeId: string) => {
    set((s) => {
      const next = new Set(s.detachedNodeIds);
      next.delete(nodeId);
      return { detachedNodeIds: next };
    });
  },

  isNodeDetached: (nodeId: string) => {
    return get().detachedNodeIds.has(nodeId);
  },

  undo: async () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;

    const entry = undoStack[undoStack.length - 1];
    set((s) => ({ undoStack: s.undoStack.slice(0, -1) }));

    const restoreOneNode = async (
      nodeData: NodeData,
      connectedEdges: EdgeData[],
      position: { x: number; y: number },
    ) => {
      const input: RestoreNodeInput = {
        id: nodeData.id,
        layer_id: nodeData.layer_id,
        node_type: nodeData.node_type,
        title: nodeData.title,
        content: nodeData.content,
        bibtex: nodeData.bibtex,
        metadata: nodeData.metadata,
        pdf_path: nodeData.pdf_path,
        display_id: nodeData.display_id,
        position_x: position.x,
        position_y: position.y,
        width: nodeData.width,
        height: nodeData.height,
        status: nodeData.status,
        created_by: nodeData.created_by,
        creator_user_id: nodeData.creator_user_id,
        creator_user_name: nodeData.creator_user_name,
      };
      const restored = await cmd.restoreNode(input);
      set((s) => ({
        dbNodes: [...s.dbNodes, restored],
        nodes: [...s.nodes, dbNodeToFlow(restored)],
      }));

      // Restore connected edges
      for (const edgeData of connectedEdges) {
        // Only restore if both endpoints exist
        const { dbNodes } = get();
        const srcExists = dbNodes.some((n) => n.id === edgeData.source_node_id);
        const tgtExists = dbNodes.some((n) => n.id === edgeData.target_node_id);
        if (!srcExists || !tgtExists) continue;
        // Don't restore if already exists (edge might connect two deleted nodes restored separately)
        if (get().dbEdges.some((e) => e.id === edgeData.id)) continue;

        const edgeInput: RestoreEdgeInput = {
          id: edgeData.id,
          layer_id: edgeData.layer_id,
          source_node_id: edgeData.source_node_id,
          target_node_id: edgeData.target_node_id,
          weight: edgeData.weight,
          comment: edgeData.comment,
          source_handle: edgeData.source_handle,
          target_handle: edgeData.target_handle,
          created_by: edgeData.created_by,
        };
        const restoredEdge = await cmd.restoreEdge(edgeInput);
        set((s) => ({
          dbEdges: [...s.dbEdges, restoredEdge],
          edges: [...s.edges, dbEdgeToFlow(restoredEdge)],
        }));
      }
    };

    try {
      if (entry.type === "delete_node") {
        await restoreOneNode(entry.node, entry.edges, entry.flowNodePosition);
      } else if (entry.type === "delete_edge") {
        const edgeInput: RestoreEdgeInput = {
          id: entry.edge.id,
          layer_id: entry.edge.layer_id,
          source_node_id: entry.edge.source_node_id,
          target_node_id: entry.edge.target_node_id,
          weight: entry.edge.weight,
          comment: entry.edge.comment,
          source_handle: entry.edge.source_handle,
          target_handle: entry.edge.target_handle,
          created_by: entry.edge.created_by,
        };
        const restoredEdge = await cmd.restoreEdge(edgeInput);
        set((s) => ({
          dbEdges: [...s.dbEdges, restoredEdge],
          edges: [...s.edges, dbEdgeToFlow(restoredEdge)],
        }));
      } else if (entry.type === "batch_delete") {
        for (const item of entry.nodes) {
          await restoreOneNode(item.node, item.edges, item.flowNodePosition);
        }
      }
      bumpMutation(set);
    } catch (err) {
      console.error("Undo failed:", err);
    }
  },
}));

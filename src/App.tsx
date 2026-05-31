import { useState, useEffect, useCallback, useRef, type MouseEvent } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useProjectStore } from "./store/projectStore";
import { useLayerStore } from "./store/layerStore";
import { useGraphStore } from "./store/graphStore";
import { useAgentStore } from "./store/agentStore";
import { useFileStore } from "./store/fileStore";
import { useSettingsStore } from "./store/settingsStore";
import { useTabStore } from "./store/tabStore";
import { useSyncStore } from "./store/syncStore";
import { useUserStore } from "./store/userStore";

import { GraphCanvas } from "./components/graph/GraphCanvas";
import { FloatingDetailPanel } from "./components/panels/FloatingDetailPanel";
import { MultiSelectPanel } from "./components/panels/MultiSelectPanel";
import { AgentPanel } from "./components/panels/AgentPanel";
import { LayerBar } from "./components/layers/LayerBar";
import { FileTabBar } from "./components/FileTabBar";
import { ResizeHandle } from "./components/ResizeHandle";
import { StatusBar } from "./components/StatusBar";
import { openAgentConsoleWindow, openManualWindow } from "./lib/detached-window";

import { ExportBibtexDialog } from "./components/dialogs/ExportBibtexDialog";
import { NewLayerDialog } from "./components/dialogs/NewLayerDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { WelcomeDialog } from "./components/dialogs/WelcomeDialog";
import { SyncDialog } from "./components/dialogs/SyncDialog";
import {
  DeleteConfirmDialog,
  BatchDeleteConfirmDialog,
  EdgeDeleteConfirmDialog,
  UnsavedChangesDialog,
} from "./components/dialogs/ConfirmDialogs";
import { UpdateDialog } from "./components/dialogs/UpdateDialog";

import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import { useAutonomousTrigger } from "./hooks/useAutonomousTrigger";
import { useStructureTrigger } from "./hooks/useStructureTrigger";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { onNodeUpdated, onCommentsChanged, onExportStarted, onExportFinished } from "./lib/sync-events";
import * as cmd from "./lib/tauri-commands";
import { useExportStore } from "./store/exportStore";
import { ExportBlockingOverlay, PdfExportProgressDialog } from "./components/dialogs/PdfExportProgressDialog";


function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [newLayerDialogOpen, setNewLayerDialogOpen] = useState(false);
  const [layerSourceNodeId, setLayerSourceNodeId] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    nodeId: string;
    nodeTitle: string;
  } | null>(null);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState<{
    nodeIds: string[];
  } | null>(null);
  const [edgeDeleteConfirm, setEdgeDeleteConfirm] = useState<{
    edgeId: string;
  } | null>(null);
  const [pendingFileAction, setPendingFileAction] = useState<
    "new" | "open" | "close-tab" | "close-app" | null
  >(null);
  const [layerBarOpen, setLayerBarOpen] = useState(true);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const selfExporting = useExportStore((s) => s.selfExporting);
  const remoteExporting = useExportStore((s) => s.remoteExporting);
  const currentProject = useProjectStore((s) => s.currentProject);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);

  const currentLayer = useLayerStore((s) => s.currentLayer);
  const loadLayers = useLayerStore((s) => s.loadLayers);
  const createLayer = useLayerStore((s) => s.createLayer);
  const deleteLayer = useLayerStore((s) => s.deleteLayer);
  const setCurrentLayer = useLayerStore((s) => s.setCurrentLayer);
  const layers = useLayerStore((s) => s.layers);

  const loadGraph = useGraphStore((s) => s.loadGraph);
  const hardDeleteNode = useGraphStore((s) => s.hardDeleteNode);
  const removeEdge = useGraphStore((s) => s.removeEdge);
  const closeEdgeActionMenu = useGraphStore((s) => s.closeEdgeActionMenu);
  const pendingDeleteNodeId = useGraphStore((s) => s.pendingDeleteNodeId);
  // Whether a node with a detail panel is selected (excludes deleted/junction)
  const showDetailPanel = useGraphStore((s) => {
    if (!s.selectedNodeId) return false;
    const node = s.dbNodes.find((n) => n.id === s.selectedNodeId);
    return !!node && node.node_type !== "deleted" && node.node_type !== "junction";
  });
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  // Count of selected nodes in React Flow (for multi-select panel)
  const multiSelectCount = useGraphStore((s) => s.nodes.filter((n) => n.selected).length);
  const nodeCount = useGraphStore((s) => s.nodes.filter((n) => n.type !== "deleted" && n.type !== "junction").length);
  const edgeCount = useGraphStore((s) => s.edges.length);

  const agentPanelOpen = useAgentStore((s) => s.panelOpen);

  const openSettings = useSettingsStore((s) => s.openSettings);
  const apiKeyStatus = useSettingsStore((s) => s.apiKeyStatus);
  const agentCapabilities = useSettingsStore((s) => s.agentCapabilities);

  const fileName = useFileStore((s) => s.fileName);
  const isDirty = useFileStore((s) => s.isDirty);
  const newFile = useFileStore((s) => s.newFile);
  const openFile = useFileStore((s) => s.openFile);
  const saveFile = useFileStore((s) => s.saveFile);

  // Tab state
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const tabSwitching = useTabStore((s) => s.switching);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);

  // Sync state
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const syncIsConfigured = useSyncStore((s) => s.isConfigured);
  const syncStatus = useSyncStore((s) => s.syncStatus);
  const currentFilePath = useFileStore((s) => s.currentFilePath);

  // ─── Resizable right sidebar ───
  const [sidebarWidth, setSidebarWidth] = useState(
    () => useSettingsStore.getState().uiPreferences.sidebar_default_width,
  );
  const isResizingRef = useRef(false);

  const handleSidebarResizeStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: globalThis.MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = window.innerWidth - ev.clientX;
      const maxWidth = window.innerWidth * 0.5;
      setSidebarWidth(Math.max(280, Math.min(newWidth, maxWidth)));
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);
  const saveFileAs = useFileStore((s) => s.saveFileAs);
  const markDirty = useFileStore((s) => s.markDirty);

  // Guarded file operations: check for unsaved changes before New/Open
  const guardedNewFile = useCallback(async () => {
    // Cmd+N / File > New: create a new blank tab
    try {
      await newFile();
    } catch (err) {
      console.error("Failed to create new tab:", err);
    }
  }, [newFile]);

  const guardedOpenFile = useCallback(() => {
    // With multi-tab, open always creates a new tab — no unsaved prompt needed
    openFile();
  }, [openFile]);

  const handleUnsavedSave = useCallback(async () => {
    const action = pendingFileAction;
    const closeId = pendingCloseTabId;
    const tabsBefore = useTabStore.getState().tabs;
    setPendingFileAction(null);
    setPendingCloseTabId(null);
    try {
      const saved = await saveFile();
      if (!saved) return; // User cancelled Save As dialog — abort
      if (action === "close-tab" && closeId) {
        await useTabStore.getState().closeTab(closeId);
        await useFileStore.getState().refreshFilePath();
        if (tabsBefore.length <= 1) setShowWelcome(true);
      } else if (action === "close-app") {
        getCurrentWindow().destroy();
      }
    } catch (err) {
      console.error("Save failed:", err);
    }
  }, [pendingFileAction, pendingCloseTabId, saveFile]);

  const handleUnsavedDontSave = useCallback(async () => {
    const action = pendingFileAction;
    const closeId = pendingCloseTabId;
    const tabsBefore = useTabStore.getState().tabs;
    setPendingFileAction(null);
    setPendingCloseTabId(null);
    if (action === "close-tab" && closeId) {
      await useTabStore.getState().closeTab(closeId);
      await useFileStore.getState().refreshFilePath();
      if (tabsBefore.length <= 1) setShowWelcome(true);
    } else if (action === "close-app") {
      getCurrentWindow().destroy();
    }
  }, [pendingFileAction, pendingCloseTabId]);

  const handleUnsavedCancel = useCallback(() => {
    setPendingFileAction(null);
    setPendingCloseTabId(null);
  }, []);

  // ─── Welcome Dialog handlers ───
  const handleWelcomeNewFile = useCallback(() => {
    // App already starts with an in-memory DB (Untitled), so just dismiss
    setShowWelcome(false);
  }, []);

  const handleWelcomeFileOpened = useCallback(() => {
    setShowWelcome(false);
  }, []);

  // ─── Tab handlers ───
  const handleSwitchTab = useCallback(async (tabId: string) => {
    if (tabSwitching || tabId === activeTabId) return;
    try {
      await useTabStore.getState().switchTab(tabId);
      await useFileStore.getState().refreshFilePath();
    } catch (err) {
      console.error("Failed to switch tab:", err);
    }
  }, [tabSwitching, activeTabId]);

  const handleNewTab = useCallback(async () => {
    // + button: create a new blank tab
    try {
      await newFile();
    } catch (err) {
      console.error("Failed to create new tab:", err);
    }
  }, [newFile]);

  const handleCloseTab = useCallback((tabId: string) => {
    // Check if the tab being closed is dirty
    const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
    if (tab && tab.is_dirty) {
      setPendingCloseTabId(tabId);
      setPendingFileAction("close-tab");
    } else {
      const tabsBefore = useTabStore.getState().tabs;
      useTabStore.getState().closeTab(tabId).then(() => {
        useFileStore.getState().refreshFilePath();
        // If this was the last real tab, show welcome dialog
        if (tabsBefore.length <= 1) {
          setShowWelcome(true);
        }
      }).catch((err) => {
        console.error("Failed to close tab:", err);
      });
    }
  }, []);

  // Sync native window title with current file name and dirty state
  useEffect(() => {
    const dirtyMark = isDirty ? " *" : "";
    const title =
      fileName === "Untitled"
        ? `Cladel \u2014 Untitled${dirtyMark}`
        : `Cladel \u2014 ${fileName}${dirtyMark}`;
    getCurrentWindow().setTitle(title);
  }, [fileName, isDirty]);

  // Listen for native menu events from the macOS menu bar
  useEffect(() => {
    const unlisten = listen<string>("menu-file-action", (event) => {
      switch (event.payload) {
        case "new":
          guardedNewFile();
          break;
        case "open":
          guardedOpenFile();
          break;
        case "save":
          saveFile();
          break;
        case "save-as":
          saveFileAs();
          break;
        case "close-tab": {
          const currentActiveTabId = useTabStore.getState().activeTabId;
          if (currentActiveTabId) handleCloseTab(currentActiveTabId);
          break;
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [guardedNewFile, guardedOpenFile, saveFile, saveFileAs, handleCloseTab]);

  // Listen for native menu "Settings" event
  useEffect(() => {
    const unlisten = listen("menu-settings", () => {
      openSettings();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openSettings]);

  // Intercept window close — prompt if any tab has unsaved changes
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      const allTabs = useTabStore.getState().tabs;
      const hasDirty = allTabs.some((t) => t.is_dirty);
      if (hasDirty) {
        event.preventDefault();
        setPendingFileAction("close-app");
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Load API key status, autonomous settings, and UI preferences on startup
  useEffect(() => {
    useSettingsStore.getState().loadApiKeyStatus();
    useSettingsStore.getState().loadGeminiApiKeyStatus();
    useSettingsStore.getState().loadAgentCapabilities();
    useSettingsStore.getState().loadUiPreferences();
    useSyncStore.getState().loadConfig();
    useUserStore.getState().loadUser();
  }, []);

  // Check sync status when file path changes
  useEffect(() => {
    if (currentFilePath && useSyncStore.getState().isConfigured) {
      useSyncStore.getState().checkSyncStatus(currentFilePath);
    }
  }, [currentFilePath]);

  // Autonomous trigger: detect idle and fire agent queries
  useAutonomousTrigger();

  // Structure-based trigger: detect graph anomalies after structure changes
  useStructureTrigger({
    enabled: agentCapabilities.agent_enabled && agentCapabilities.autonomous_enabled,
  });

  // Cross-window sync: listen for node updates from detached windows
  useEffect(() => {
    const unlistenNode = onNodeUpdated((nodeId) => {
      useGraphStore.getState().refreshNode(nodeId);
    });
    const unlistenComments = onCommentsChanged(() => {
      useGraphStore.getState().fetchCommentCounts();
    });
    return () => {
      unlistenNode.then((fn) => fn());
      unlistenComments.then((fn) => fn());
    };
  }, []);

  // Cross-window sync: block UI while PDF export is in progress (from another window)
  useEffect(() => {
    const unlistenStart = onExportStarted((fromSelf) => {
      if (!fromSelf) {
        useExportStore.getState().setRemoteExporting(true);
      }
    });
    const unlistenFinish = onExportFinished((fromSelf) => {
      if (!fromSelf) {
        // Small delay so the blocking overlay stays visible briefly after completion
        setTimeout(() => {
          useExportStore.getState().setRemoteExporting(false);
        }, 600);
      }
    });
    return () => {
      unlistenStart.then((fn) => fn());
      unlistenFinish.then((fn) => fn());
    };
  }, []);

  // Initialize: load or create default project + layer
  // Guard ref prevents double-execution from React 18 StrictMode
  const initGuard = useRef(false);
  useEffect(() => {
    if (initGuard.current) return;
    initGuard.current = true;

    async function init() {
      try {
        await loadProjects();
        const projects = useProjectStore.getState().projects;

        let project = projects[0] ?? null;
        if (!project) {
          project = await createProject("My Research");
        }
        setCurrentProject(project);

        await loadLayers(project.id);
        const allLayers = useLayerStore.getState().layers;

        let layer = allLayers[0] ?? null;
        if (!layer) {
          layer = await createLayer(project.id);
        }
        setCurrentLayer(layer);

        await loadGraph(layer.id);

        // Sync file path state (will be null / "Untitled" on fresh launch)
        await useFileStore.getState().refreshFilePath();

        // Load tab state
        await useTabStore.getState().loadTabs();
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check for updates after init completes (production only)
  const updateGuard = useRef(false);
  useEffect(() => {
    if (loading || updateGuard.current) return;
    updateGuard.current = true;

    // Skip update check in dev mode (Vite serves on localhost)
    if (window.location.protocol === "http:") return;

    setUpdateDialogOpen(true);
  }, [loading]);

  const handleLayerSwitch = useCallback(
    async (layerId: string) => {
      const layer = layers.find((l) => l.id === layerId);
      if (layer && layer.id !== currentLayer?.id) {
        setCurrentLayer(layer);
        await loadGraph(layer.id);
      }
    },
    [layers, currentLayer, setCurrentLayer, loadGraph],
  );

  const handleCreateNewLayer = useCallback(
    async (_name: string, sourceNodeId?: string | null) => {
      if (!currentProject) return;

      // 1. Get the current Core node content from the current layer
      const dbNodes = useGraphStore.getState().dbNodes;
      const coreNode = dbNodes.find((n) => n.node_type === "core");
      const coreContent = coreNode?.content ?? null;

      // 2. Save a milestone version for the current Core before branching
      if (coreNode && coreContent) {
        try {
          await cmd.saveCoreVersion(coreNode.id, coreContent);
        } catch {
          // Non-fatal: the version may already exist if content hasn't changed
        }
      }

      // 3. Create the new layer
      const newLayer = sourceNodeId
        ? await createLayer(currentProject.id, null, sourceNodeId)
        : await createLayer(currentProject.id, coreContent);

      // 4. Switch to the new layer
      await loadGraph(newLayer.id);
      markDirty();
    },
    [currentProject, createLayer, loadGraph, markDirty],
  );

  const handleCreateLayerFromNode = useCallback((nodeId: string) => {
    setLayerSourceNodeId(nodeId);
    setNewLayerDialogOpen(true);
  }, []);

  const handleDeleteLayer = useCallback(
    async (layerId: string) => {
      const switchToId = await deleteLayer(layerId);
      if (switchToId) {
        await loadGraph(switchToId);
      }
      markDirty();
    },
    [deleteLayer, loadGraph, markDirty],
  );

  // Request node deletion — shows confirmation dialog
  const handleRequestDeleteNode = useCallback(
    (nodeId: string) => {
      const node = useGraphStore.getState().dbNodes.find(
        (n) => n.id === nodeId,
      );
      if (!node) return;
      if (node.node_type === "junction") {
        hardDeleteNode(node.id).catch((err: unknown) =>
          console.error("Failed to delete junction:", err),
        );
        return;
      }
      if (node.node_type === "paper_group") {
        useGraphStore.getState().ungroupPapers(node.id).catch((err: unknown) =>
          console.error("Failed to ungroup:", err),
        );
        return;
      }
      setDeleteConfirm({ nodeId: node.id, nodeTitle: node.title });
    },
    [hardDeleteNode],
  );

  // React to delete requests from child components
  useEffect(() => {
    if (pendingDeleteNodeId) {
      handleRequestDeleteNode(pendingDeleteNodeId);
      useGraphStore.setState({ pendingDeleteNodeId: null });
    }
  }, [pendingDeleteNodeId, handleRequestDeleteNode]);

  // Confirm node deletion
  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      await hardDeleteNode(deleteConfirm.nodeId);
    } catch (err) {
      console.error("Failed to delete node:", err);
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, hardDeleteNode]);

  // Request batch deletion — shows confirmation dialog
  const handleRequestBatchDelete = useCallback(
    (nodeIds: string[]) => {
      const dbNodes = useGraphStore.getState().dbNodes;
      const nodes = nodeIds
        .map((id) => dbNodes.find((n) => n.id === id))
        .filter((n): n is NonNullable<typeof n> => !!n);

      if (nodes.length === 0) return;

      if (nodes.length === 1) {
        handleRequestDeleteNode(nodes[0].id);
        return;
      }

      setBatchDeleteConfirm({ nodeIds: nodes.map((n) => n.id) });
    },
    [handleRequestDeleteNode],
  );

  // Confirm batch deletion
  const handleConfirmBatchDelete = useCallback(async () => {
    if (!batchDeleteConfirm) return;
    try {
      for (const nodeId of batchDeleteConfirm.nodeIds) {
        await hardDeleteNode(nodeId);
      }
    } catch (err) {
      console.error("Failed to batch delete nodes:", err);
    }
    setBatchDeleteConfirm(null);
  }, [batchDeleteConfirm, hardDeleteNode]);

  // Request edge deletion — shows confirmation dialog
  const handleRequestDeleteEdge = useCallback(
    (edgeId: string) => {
      closeEdgeActionMenu();
      setEdgeDeleteConfirm({ edgeId });
    },
    [closeEdgeActionMenu],
  );

  // Confirm edge deletion
  const handleConfirmEdgeDelete = useCallback(async () => {
    if (!edgeDeleteConfirm) return;
    try {
      await removeEdge(edgeDeleteConfirm.edgeId);
    } catch (err) {
      console.error("Failed to delete edge:", err);
    }
    setEdgeDeleteConfirm(null);
  }, [edgeDeleteConfirm, removeEdge]);

  if (loading) {
    return (
      <div style={centerStyle}>
        <div style={{ color: "#6b7280", fontSize: 14 }}>Loading Cladel...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={centerStyle}>
        <div style={{ color: "#dc2626", fontSize: 14 }}>Error: {error}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Tab bar */}
      <FileTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitchTab={handleSwitchTab}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onOpenConsole={() => openAgentConsoleWindow()}
        onOpenManual={() => openManualWindow()}
        onOpenSettings={openSettings}
      />

      {/* Main area: layer panel (left) + graph + optional detail panel (right) */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Layer panel — vertical left sidebar */}
        {layerBarOpen ? (
          <LayerBar
            layers={layers}
            currentLayer={currentLayer}
            onSwitchLayer={handleLayerSwitch}
            onNewLayer={() => setNewLayerDialogOpen(true)}
            onDeleteLayer={handleDeleteLayer}
            onExportBibtex={() => setExportDialogOpen(true)}
            onClose={() => setLayerBarOpen(false)}
          />
        ) : (
          <button
            onClick={() => setLayerBarOpen(true)}
            style={{
              width: 28,
              minWidth: 28,
              flexShrink: 0,
              background: "#e5e7eb",
              border: "none",
              borderRight: "1px solid #d1d5db",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              color: "#374151",
            }}
            title="Show layers"
          >
            <ChevronRightIcon sx={{ fontSize: 18 }} />
          </button>
        )}

        {/* Graph canvas */}
        <div style={{ flex: 1, position: "relative" }}>
          <ReactFlowProvider>
            <GraphCanvas onRequestDeleteNode={handleRequestDeleteNode} onRequestBatchDelete={handleRequestBatchDelete} onRequestDeleteEdge={handleRequestDeleteEdge} />
          </ReactFlowProvider>

          {/* Floating Node Detail Panel — top-right overlay */}
          {showDetailPanel && (
            <FloatingDetailPanel
              key={selectedNodeId ?? "none"}
              onDeleteNode={handleRequestDeleteNode}
              onCreateLayerFromNode={handleCreateLayerFromNode}
            />
          )}
        </div>

        {/* Right sidebar: multi-select panel or agent panel */}
        {(multiSelectCount >= 2 || agentPanelOpen) && (
          <>
            <ResizeHandle onMouseDown={handleSidebarResizeStart} />
            <div style={{ width: sidebarWidth, flexShrink: 0, minWidth: 0, height: "100%" }}>
              {multiSelectCount >= 2 ? (
                <MultiSelectPanel count={multiSelectCount} />
              ) : (
                <AgentPanel />
              )}
            </div>
          </>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar
        nodeCount={nodeCount}
        edgeCount={edgeCount}
        apiKeyStatus={apiKeyStatus}
        agentCapabilities={agentCapabilities}
        syncIsConfigured={syncIsConfigured}
        syncStatus={syncStatus}
        currentFilePath={currentFilePath}
        onOpenSettings={openSettings}
        onOpenSyncDialog={() => setSyncDialogOpen(true)}
      />

      {/* Version History Modal */}
      {/* New Layer Dialog */}
      <NewLayerDialog
        open={newLayerDialogOpen}
        nextLayerNumber={layers.length + 1}
        onClose={() => {
          setNewLayerDialogOpen(false);
          setLayerSourceNodeId(null);
        }}
        onCreate={handleCreateNewLayer}
        eligibleNodes={useGraphStore.getState().dbNodes.filter(
          (n) =>
            n.node_type !== "core" &&
            n.node_type !== "junction" &&
            n.node_type !== "deleted",
        )}
        preSelectedNodeId={layerSourceNodeId}
      />

      {/* Delete Node Confirmation */}
      {deleteConfirm && (
        <DeleteConfirmDialog
          nodeTitle={deleteConfirm.nodeTitle}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {/* Batch Delete Confirmation */}
      {batchDeleteConfirm && (
        <BatchDeleteConfirmDialog
          count={batchDeleteConfirm.nodeIds.length}
          onConfirm={handleConfirmBatchDelete}
          onCancel={() => setBatchDeleteConfirm(null)}
        />
      )}

      {/* Edge Delete Confirmation */}
      {edgeDeleteConfirm && (
        <EdgeDeleteConfirmDialog
          onConfirm={handleConfirmEdgeDelete}
          onCancel={() => setEdgeDeleteConfirm(null)}
        />
      )}

      {/* Unsaved Changes Confirmation */}
      {pendingFileAction && (
        <UnsavedChangesDialog
          onSave={handleUnsavedSave}
          onDontSave={handleUnsavedDontSave}
          onCancel={handleUnsavedCancel}
        />
      )}

      {/* Settings Dialog */}
      <SettingsDialog />

      {/* Sync Dialog */}
      <SyncDialog
        open={syncDialogOpen}
        onClose={() => setSyncDialogOpen(false)}
        localPath={currentFilePath ?? ""}
        onSyncComplete={() => {
          // After sync (especially download), reload the current tab's data
          const filePath = useFileStore.getState().currentFilePath;
          if (filePath) {
            useTabStore.getState().reloadActiveTabFromDisk()
              .then(() => {
                useFileStore.getState().refreshFilePath();
                useFileStore.getState().markClean();
              })
              .catch(console.error);
          }
        }}
      />

      {/* Export BibTeX Dialog */}
      <ExportBibtexDialog
        isOpen={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
      />

      {/* Welcome Dialog (shown on app launch or after closing all files) */}
      <WelcomeDialog
        open={showWelcome && !loading}
        onNewFile={handleWelcomeNewFile}
        onFileOpened={handleWelcomeFileOpened}
        onQuit={() => { getCurrentWindow().close(); }}
      />

      {/* Update Dialog (auto-check on startup, production only) */}
      <UpdateDialog
        open={updateDialogOpen}
        onClose={() => setUpdateDialogOpen(false)}
        silentErrors
      />


      {/* PDF export overlay: progress bar if initiated here, blocking if from another window */}
      {selfExporting && (
        <PdfExportProgressDialog
          open={true}
          onDone={() => { useExportStore.getState().reset(); }}
        />
      )}
      {!selfExporting && remoteExporting && (
        <ExportBlockingOverlay />
      )}
    </div>
  );
}

const centerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
};




export default App;

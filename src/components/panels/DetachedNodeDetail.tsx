import { useGraphStore } from "../../store/graphStore";
import { flushPendingSaves } from "../../lib/pendingSaves";
// Side effect: fileStore forwards this window's document writes to the main window.
import "../../store/fileStore";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as cmd from "../../lib/tauri-commands";
import {
  onNodeUpdated,
  onNodeDeleted,
  onFileChanged,
  onSettingsChanged,
  onExportStarted,
  onExportFinished,
} from "../../lib/sync-events";
import type { NodeData } from "../../types";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { useSettingsStore } from "../../store/settingsStore";
import { useExportStore } from "../../store/exportStore";
import { ExportBlockingOverlay, PdfExportProgressDialog } from "../dialogs/PdfExportProgressDialog";

/**
 * Standalone page component rendered in child windows.
 * Fetches node data from the backend and renders NodeDetailPanel in detached mode.
 * Listens for cross-window sync events to stay up to date.
 */
export function DetachedNodeDetail() {
  const { nodeId, layerId } = useParams<{ nodeId: string; layerId: string }>();
  const [node, setNode] = useState<NodeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const selfExporting = useExportStore((s) => s.selfExporting);
  const remoteExporting = useExportStore((s) => s.remoteExporting);

  // Load UI preferences (detached windows have their own JS context / Zustand instance)
  // Also listen for settings changes from the main window to update in real-time
  useEffect(() => {
    useSettingsStore.getState().loadUiPreferences();
    const unlisten = onSettingsChanged(() => {
      useSettingsStore.getState().loadUiPreferences();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const fetchNode = useCallback(async () => {
    if (!nodeId || !layerId) return;
    try {
      const nodes = await cmd.getNodesByLayer(layerId);
      const found = nodes.find((n: NodeData) => n.id === nodeId);
      if (found) {
        setNode(found);
      }
    } catch (e) {
      console.error("Failed to refresh node:", e);
    }
  }, [nodeId, layerId]);

  // Initial load
  useEffect(() => {
    if (!nodeId || !layerId) {
      setError("Missing node or layer ID");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const nodes = await cmd.getNodesByLayer(layerId!);
        const found = nodes.find((n: NodeData) => n.id === nodeId);
        if (cancelled) return;
        if (found) {
          setNode(found);
        } else {
          setError("Node not found");
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [nodeId, layerId]);

  // Listen for node-updated events from other windows
  useEffect(() => {
    if (!nodeId) return;
    const unlisten = onNodeUpdated((updatedNodeId) => {
      if (updatedNodeId === nodeId) {
        fetchNode();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [nodeId, fetchNode]);

  // A Translate node's panel writes through the store (patchTranslateModel) and
  // this window ignores its own node-updated events, so re-read after local
  // writes — otherwise the language / form controls keep showing stale values.
  // (Limited to translate: the editors of other types manage their own state.)
  const isTranslate = node?.node_type === "translate";
  useEffect(() => {
    if (!isTranslate) return;
    return useGraphStore.subscribe((state, prev) => {
      if (state.mutationVersion !== prev.mutationVersion) fetchNode();
    });
  }, [isTranslate, fetchNode]);

  // Closing this window (by the user, or by the main window before a tab
  // switch) must not drop a debounced edit. Tauri destroys the window only
  // after this async handler resolves.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      await flushPendingSaves();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for node-deleted events
  useEffect(() => {
    if (!nodeId) return;
    const unlisten = onNodeDeleted((deletedNodeId) => {
      if (deletedNodeId === nodeId) {
        setDeleted(true);
        setTimeout(() => {
          getCurrentWindow().close();
        }, 2000);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [nodeId]);

  // Listen for file-changed events (new file / open file) → close self
  useEffect(() => {
    const unlisten = onFileChanged(() => {
      getCurrentWindow().close();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Block UI while PDF export is in progress (from another window)
  useEffect(() => {
    const unlistenStart = onExportStarted((fromSelf) => {
      if (!fromSelf) {
        useExportStore.getState().setRemoteExporting(true);
      }
    });
    const unlistenFinish = onExportFinished((fromSelf) => {
      if (!fromSelf) {
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

  if (deleted) {
    return (
      <div style={containerStyle}>
        <div style={deletedStyle}>This node has been deleted. Closing...</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={loadingStyle}>Loading node...</div>
      </div>
    );
  }

  if (error || !node) {
    return (
      <div style={containerStyle}>
        <div style={errorStyle}>{error || "Node not found"}</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <NodeDetailPanel nodeOverride={node} detached />
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

const containerStyle: React.CSSProperties = {
  width: "100%",
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  background: "#ffffff",
  overflow: "auto",
};

const loadingStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: 1,
  fontSize: 14,
  color: "#9ca3af",
};

const errorStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: 1,
  fontSize: 14,
  color: "#dc2626",
  padding: 24,
  textAlign: "center",
};

const deletedStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: 1,
  fontSize: 14,
  color: "#d97706",
  padding: 24,
  textAlign: "center",
};

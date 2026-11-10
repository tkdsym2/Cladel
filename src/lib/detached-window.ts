import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { useGraphStore } from "../store/graphStore";
import { emitFileChanged } from "./sync-events";

/**
 * Open a node's detail panel in a separate window.
 * If a window for that nodeId already exists, focus it instead.
 */
export async function openNodeDetailWindow(
  nodeId: string,
  layerId: string,
  nodeTitle: string,
): Promise<WebviewWindow | null> {
  const label = `node-detail-${nodeId}`;

  // Check if a window with this label already exists
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const url = `index.html#/node-detail/${nodeId}/${layerId}`;

  const webview = new WebviewWindow(label, {
    url,
    title: nodeTitle,
    width: 500,
    height: 700,
    minWidth: 350,
    minHeight: 400,
    decorations: true,
  });

  // Listen for the window to be created successfully
  webview.once("tauri://created", () => {
    useGraphStore.getState().addDetachedNode(nodeId);
  });

  // Listen for the window to be closed/destroyed
  webview.once("tauri://destroyed", () => {
    useGraphStore.getState().removeDetachedNode(nodeId);
  });

  webview.once("tauri://error", (e) => {
    console.error("Failed to create detached window:", e);
  });

  return webview;
}

/**
 * Focus an existing detached window for a node, if it exists.
 * Returns true if a window was found and focused.
 */
export async function focusDetachedWindow(
  nodeId: string,
): Promise<boolean> {
  const label = `node-detail-${nodeId}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return true;
  }
  return false;
}

/**
 * Open the Agent Console in a separate window.
 * If already open, focus it instead.
 */
export async function openAgentConsoleWindow(): Promise<WebviewWindow | null> {
  const label = "agent-console";

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(label, {
    url: "index.html#/agent-console",
    title: "Agent Console",
    width: 700,
    height: 460,
    minWidth: 400,
    minHeight: 250,
    decorations: true,
  });

  webview.once("tauri://error", (e) => {
    console.error("Failed to create agent console window:", e);
  });

  return webview;
}

/**
 * Open the Manual in a separate window.
 * If already open, focus it instead.
 */
export async function openManualWindow(): Promise<WebviewWindow | null> {
  const label = "manual";

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(label, {
    url: "index.html#/manual",
    title: "Manual",
    width: 560,
    height: 700,
    minWidth: 380,
    minHeight: 400,
    decorations: true,
  });

  webview.once("tauri://error", (e) => {
    console.error("Failed to create manual window:", e);
  });

  return webview;
}

/**
 * Open the Note (Typst) help in a separate window so it can be read while
 * writing in the main window. If already open, focus it instead.
 */
export async function openNoteHelpWindow(): Promise<WebviewWindow | null> {
  const label = "note-help";

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const webview = new WebviewWindow(label, {
    url: "index.html#/note-help",
    title: "Note Help",
    width: 520,
    height: 680,
    minWidth: 360,
    minHeight: 400,
    decorations: true,
  });

  webview.once("tauri://error", (e) => {
    console.error("Failed to create note help window:", e);
  });

  return webview;
}

/**
 * Close all detached node-detail windows.
 * Called when the .cld file changes (new/open) so stale windows don't linger.
 */
export async function closeAllDetachedWindows(): Promise<void> {
  // Emit file-changed so child windows close themselves gracefully
  emitFileChanged();

  // Also forcefully close any that remain
  const allWindows = await getAllWebviewWindows();
  const store = useGraphStore.getState();
  for (const w of allWindows) {
    if (w.label.startsWith("node-detail-")) {
      const nodeId = w.label.replace("node-detail-", "");
      store.removeDetachedNode(nodeId);
      try {
        await w.close();
      } catch {
        // Window may have already closed from the event
      }
    }
  }
}

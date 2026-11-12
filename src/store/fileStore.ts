import { create } from "zustand";
import * as cmd from "../lib/tauri-commands";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useGraphStore } from "./graphStore";
import { useTabStore } from "./tabStore";
import { emitDocumentDirty } from "../lib/sync-events";
import { flushPendingSaves } from "../lib/pendingSaves";

interface FileStore {
  currentFilePath: string | null;
  fileName: string;
  isDirty: boolean;

  setCurrentFilePath: (path: string | null) => void;
  markDirty: () => void;
  markClean: () => void;
  newFile: () => Promise<void>;
  openFile: () => Promise<void>;
  openFilePath: (path: string) => Promise<void>;
  openSample: () => Promise<void>;
  saveFile: () => Promise<boolean>;
  saveFileAs: () => Promise<boolean>;
  refreshFilePath: () => Promise<void>;
}

function extractFileName(path: string | null): string {
  if (!path) return "Untitled";
  const parts = path.replace(/\\/g, "/").split("/");
  const filename = parts[parts.length - 1];
  return filename.replace(/\.flnx$/i, "");
}

export const useFileStore = create<FileStore>((set, get) => ({
  currentFilePath: null,
  fileName: "Untitled",
  isDirty: false,

  setCurrentFilePath: (path) =>
    set({ currentFilePath: path, fileName: extractFileName(path) }),

  markDirty: () => {
    // Decide from the ACTIVE TAB's own flag, not a global one: after switching
    // from a dirty tab to a clean one, the clean tab must still become dirty.
    const { tabs, activeTabId } = useTabStore.getState();
    if (tabs.length === 0) {
      // No tab list: this is a detached window (only the main window loads
      // tabs). Tell the main window, which owns the unsaved state.
      if (window.location.hash.includes("/node-detail/")) emitDocumentDirty();
      return;
    }
    const active = tabs.find((t) => t.id === activeTabId);
    if (active && !active.is_dirty) {
      useTabStore.getState().markActiveTabDirty();
    }
  },

  markClean: () => {
    set({ isDirty: false });
    useTabStore.getState().markActiveTabClean();
  },

  newFile: async () => {
    // Delegate to tabStore — creates a new tab
    try {
      await useTabStore.getState().newTab();
      set({ currentFilePath: null, fileName: "Untitled" });
    } catch (err) {
      console.error("Failed to create new file:", err);
      throw err;
    }
  },

  openFile: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Filonex Document", extensions: ["flnx"] }],
    });
    if (!selected) return; // User cancelled

    await get().openFilePath(selected);
  },

  openFilePath: async (path: string) => {
    // Delegate to tabStore — opens in new tab or switches to existing
    try {
      await useTabStore.getState().openFileInTab(path);
      set({
        currentFilePath: path,
        fileName: extractFileName(path),
      });
    } catch (err) {
      console.error("Failed to open file:", err);
      throw err;
    }
  },

  openSample: async () => {
    // Open the built-in sample as a read-only template: loaded into an untitled
    // document (no path), so the first save becomes "Save As" — the sample
    // itself is never overwritten.
    await useTabStore.getState().openSample();
    set({ currentFilePath: null, fileName: "sample" });
  },

  saveFile: async () => {
    // Editors save on a debounce: write what is still pending first, or the
    // file on disk misses the last keystrokes.
    await flushPendingSaves();
    const { currentFilePath } = get();
    if (currentFilePath) {
      try {
        await cmd.fileSave();
        set({ isDirty: false });
        useTabStore.getState().markActiveTabClean();
        return true;
      } catch (err) {
        console.error("Failed to save file:", err);
        throw err;
      }
    } else {
      return await get().saveFileAs();
    }
  },

  saveFileAs: async () => {
    const selected = await save({
      filters: [{ name: "Filonex Document", extensions: ["flnx"] }],
      defaultPath:
        get().fileName === "Untitled"
          ? "research.flnx"
          : `${get().fileName}.flnx`,
    });
    if (!selected) return false; // User cancelled

    let path = selected;
    // Ensure .flnx extension
    if (!path.toLowerCase().endsWith(".flnx")) {
      path += ".flnx";
    }

    try {
      await flushPendingSaves();
      await cmd.fileSaveAs(path);
      const name = extractFileName(path);
      set({
        currentFilePath: path,
        fileName: name,
        isDirty: false,
      });
      // Sync tab metadata
      useTabStore.getState().updateActiveTabAfterSave(path, name);
      // Track in recent files list
      cmd.addRecentFile(path).catch(() => {});
      return true;
    } catch (err) {
      console.error("Failed to save file as:", err);
      throw err;
    }
  },

  refreshFilePath: async () => {
    const path = await cmd.fileGetCurrentPath();
    set({
      currentFilePath: path,
      fileName: extractFileName(path),
    });
  },
}));

// ─── isDirty mirrors the active tab ───
// `isDirty` (window title) is derived from the active tab's flag, so it can never
// go stale across tab switches / new tabs / opening an already-open file.
useTabStore.subscribe((state) => {
  const active = state.tabs.find((t) => t.id === state.activeTabId);
  const dirty = active?.is_dirty ?? false;
  if (useFileStore.getState().isDirty !== dirty) {
    useFileStore.setState({ isDirty: dirty });
  }
});

// Every successful document write (see DOCUMENT_WRITE_COMMANDS) marks the file
// dirty — including writes that do not go through graphStore (comments,
// display_id / BibTeX edits, export settings, agent output, ...).
cmd.setDocumentMutatedListener(() => useFileStore.getState().markDirty());

// ─── Auto-dirty tracking ───
// Subscribe to graphStore's mutationVersion. When it changes,
// a write operation succeeded → mark file as dirty.
useGraphStore.subscribe((state, prevState) => {
  if (state.mutationVersion !== prevState.mutationVersion) {
    useFileStore.getState().markDirty();
  }
});

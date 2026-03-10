import { create } from "zustand";
import * as cmd from "../lib/tauri-commands";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useGraphStore } from "./graphStore";
import { useTabStore } from "./tabStore";
import { useSyncStore } from "./syncStore";

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
  saveFile: () => Promise<boolean>;
  saveFileAs: () => Promise<boolean>;
  refreshFilePath: () => Promise<void>;
}

function extractFileName(path: string | null): string {
  if (!path) return "Untitled";
  const parts = path.replace(/\\/g, "/").split("/");
  const filename = parts[parts.length - 1];
  return filename.replace(/\.(cld|klv|tmgx)$/i, "");
}

export const useFileStore = create<FileStore>((set, get) => ({
  currentFilePath: null,
  fileName: "Untitled",
  isDirty: false,

  setCurrentFilePath: (path) =>
    set({ currentFilePath: path, fileName: extractFileName(path) }),

  markDirty: () => {
    if (!get().isDirty) {
      set({ isDirty: true });
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
      set({ currentFilePath: null, fileName: "Untitled", isDirty: false });
    } catch (err) {
      console.error("Failed to create new file:", err);
      throw err;
    }
  },

  openFile: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Cladel Document", extensions: ["cld", "klv", "tmgx"] }],
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
        isDirty: false,
      });
    } catch (err) {
      console.error("Failed to open file:", err);
      throw err;
    }
  },

  saveFile: async () => {
    const { currentFilePath } = get();
    if (currentFilePath) {
      try {
        await cmd.fileSave();
        set({ isDirty: false });
        useTabStore.getState().markActiveTabClean();
        // Background sync check after save
        if (useSyncStore.getState().isConfigured) {
          useSyncStore.getState().checkSyncStatus(currentFilePath);
        }
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
      filters: [{ name: "Cladel Document", extensions: ["cld"] }],
      defaultPath:
        get().fileName === "Untitled"
          ? "research.cld"
          : `${get().fileName}.cld`,
    });
    if (!selected) return false; // User cancelled

    let path = selected;
    // Ensure .cld extension
    if (!path.toLowerCase().endsWith(".cld") && !path.toLowerCase().endsWith(".klv") && !path.toLowerCase().endsWith(".tmgx")) {
      path += ".cld";
    }

    try {
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
      // Background sync check after save
      if (useSyncStore.getState().isConfigured) {
        useSyncStore.getState().checkSyncStatus(path);
      }
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

// ─── Auto-dirty tracking ───
// Subscribe to graphStore's mutationVersion. When it changes,
// a write operation succeeded → mark file as dirty.
useGraphStore.subscribe((state, prevState) => {
  if (state.mutationVersion !== prevState.mutationVersion) {
    useFileStore.getState().markDirty();
  }
});

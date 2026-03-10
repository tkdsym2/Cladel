import { create } from "zustand";
import type { RemoteFileInfo, SyncStatusResult } from "../types";
import * as cmd from "../lib/tauri-commands";

interface SyncStore {
  isConfigured: boolean;
  remoteFiles: RemoteFileInfo[];
  isLoadingRemote: boolean;
  syncStatus: SyncStatusResult | null;
  isSyncing: boolean;
  lastSyncError: string | null;

  loadConfig: () => Promise<void>;
  loadRemoteFiles: () => Promise<void>;
  checkSyncStatus: (localPath: string) => Promise<SyncStatusResult | null>;
  uploadFile: (localPath: string) => Promise<boolean>;
  downloadFile: (remoteName: string, localPath: string) => Promise<boolean>;
  clearError: () => void;
}

export const useSyncStore = create<SyncStore>((set, get) => ({
  isConfigured: false,
  remoteFiles: [],
  isLoadingRemote: false,
  syncStatus: null,
  isSyncing: false,
  lastSyncError: null,

  loadConfig: async () => {
    try {
      const status = await cmd.getSupabaseConfigStatus();
      set({ isConfigured: status });
    } catch {
      set({ isConfigured: false });
    }
  },

  loadRemoteFiles: async () => {
    set({ isLoadingRemote: true, lastSyncError: null });
    try {
      const files = await cmd.syncListRemote();
      set({ remoteFiles: files, isLoadingRemote: false });
    } catch (err) {
      set({
        lastSyncError: typeof err === "string" ? err : String(err),
        isLoadingRemote: false,
      });
    }
  },

  checkSyncStatus: async (localPath: string) => {
    set({ lastSyncError: null });
    try {
      const result = await cmd.syncCheckStatus(localPath);
      set({ syncStatus: result });
      return result;
    } catch (err) {
      set({ lastSyncError: typeof err === "string" ? err : String(err) });
      return null;
    }
  },

  uploadFile: async (localPath: string) => {
    set({ isSyncing: true, lastSyncError: null });
    try {
      await cmd.syncUpload(localPath);
      set({ isSyncing: false });
      // Reload remote files list
      get().loadRemoteFiles();
      return true;
    } catch (err) {
      set({
        isSyncing: false,
        lastSyncError: typeof err === "string" ? err : String(err),
      });
      return false;
    }
  },

  downloadFile: async (remoteName: string, localPath: string) => {
    set({ isSyncing: true, lastSyncError: null });
    try {
      await cmd.syncDownload(remoteName, localPath);
      set({ isSyncing: false });
      return true;
    } catch (err) {
      set({
        isSyncing: false,
        lastSyncError: typeof err === "string" ? err : String(err),
      });
      return false;
    }
  },

  clearError: () => set({ lastSyncError: null }),
}));

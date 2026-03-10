import { create } from "zustand";
import * as cmd from "../lib/tauri-commands";
import type { TabInfo } from "../lib/tauri-commands";
import { useProjectStore } from "./projectStore";
import { useLayerStore } from "./layerStore";
import { useGraphStore } from "./graphStore";
import { useAgentStore } from "./agentStore";
import { closeAllDetachedWindows } from "../lib/detached-window";

export type { TabInfo };

interface TabStore {
  tabs: TabInfo[];
  activeTabId: string | null;
  switching: boolean;

  loadTabs: () => Promise<void>;
  switchTab: (tabId: string) => Promise<void>;
  newTab: () => Promise<void>;
  openFileInTab: (path: string) => Promise<void>;
  closeTab: (tabId: string) => Promise<void>;
  markActiveTabDirty: () => void;
  markActiveTabClean: () => void;
  updateActiveTabAfterSave: (path: string, name: string) => void;
}

/**
 * Re-initialize the frontend state after a DB swap (tab switch, new tab, etc.).
 */
async function reinitialize() {
  const projectStore = useProjectStore.getState();
  const layerStore = useLayerStore.getState();
  const graphStore = useGraphStore.getState();

  await projectStore.loadProjects();
  const projects = useProjectStore.getState().projects;

  let project = projects[0] ?? null;
  if (!project) {
    project = await projectStore.createProject("My Research");
  }
  projectStore.setCurrentProject(project);

  await layerStore.loadLayers(project.id);
  const allLayers = useLayerStore.getState().layers;

  let layer = allLayers[0] ?? null;
  if (!layer) {
    layer = await layerStore.createLayer(project.id);
  }
  layerStore.setCurrentLayer(layer);

  await graphStore.loadGraph(layer.id);

  // Reset agent panel state
  useAgentStore.getState().clearSuggestions();
  useAgentStore.getState().setStatus("idle");
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  switching: false,

  loadTabs: async () => {
    try {
      const [tabs, activeId] = await Promise.all([
        cmd.getTabs(),
        cmd.getActiveTabId(),
      ]);
      set({ tabs, activeTabId: activeId });
    } catch (err) {
      console.error("Failed to load tabs:", err);
    }
  },

  switchTab: async (tabId: string) => {
    const { switching, activeTabId } = get();
    if (switching || tabId === activeTabId) return;

    set({ switching: true });
    try {
      await closeAllDetachedWindows();
      await cmd.switchTab(tabId);
      await reinitialize();

      const tabs = await cmd.getTabs();
      set({ tabs, activeTabId: tabId, switching: false });
    } catch (err) {
      console.error("Failed to switch tab:", err);
      set({ switching: false });
      throw err;
    }
  },

  newTab: async () => {
    const { switching } = get();
    if (switching) return;

    set({ switching: true });
    try {
      await closeAllDetachedWindows();
      const newTab = await cmd.createTab();
      await reinitialize();

      const tabs = await cmd.getTabs();
      set({ tabs, activeTabId: newTab.id, switching: false });
    } catch (err) {
      console.error("Failed to create new tab:", err);
      set({ switching: false });
      throw err;
    }
  },

  openFileInTab: async (path: string) => {
    const { switching, tabs, activeTabId } = get();
    if (switching) return;

    // Check if the current tab is an empty untitled tab that should be replaced
    const currentTab = tabs.find((t) => t.id === activeTabId);
    const isEmptyUntitled = currentTab && !currentTab.file_path && !currentTab.is_dirty;

    set({ switching: true });
    try {
      await closeAllDetachedWindows();
      const tab = await cmd.openFileInTab(path);
      await reinitialize();

      // If we had an empty untitled tab, close it now
      if (isEmptyUntitled && currentTab && currentTab.id !== tab.id) {
        await cmd.closeTab(currentTab.id);
      }

      const updatedTabs = await cmd.getTabs();
      set({ tabs: updatedTabs, activeTabId: tab.id, switching: false });

      // Track in recent files
      cmd.addRecentFile(path).catch(() => {});
    } catch (err) {
      console.error("Failed to open file in tab:", err);
      set({ switching: false });
      throw err;
    }
  },

  closeTab: async (tabId: string) => {
    const { switching } = get();
    if (switching) return;

    set({ switching: true });
    try {
      await closeAllDetachedWindows();
      const newActiveId = await cmd.closeTab(tabId);
      const { activeTabId } = get();

      // If the closed tab was the active one, reinitialize
      if (activeTabId === tabId) {
        await reinitialize();
      }

      const tabs = await cmd.getTabs();
      set({ tabs, activeTabId: newActiveId, switching: false });
    } catch (err) {
      console.error("Failed to close tab:", err);
      set({ switching: false });
      throw err;
    }
  },

  markActiveTabDirty: () => {
    const { tabs, activeTabId } = get();
    if (!activeTabId) return;
    const updated = tabs.map((t) =>
      t.id === activeTabId ? { ...t, is_dirty: true } : t,
    );
    set({ tabs: updated });
  },

  markActiveTabClean: () => {
    const { tabs, activeTabId } = get();
    if (!activeTabId) return;
    const updated = tabs.map((t) =>
      t.id === activeTabId ? { ...t, is_dirty: false } : t,
    );
    set({ tabs: updated });
  },

  updateActiveTabAfterSave: (path: string, name: string) => {
    const { tabs, activeTabId } = get();
    if (!activeTabId) return;
    const updated = tabs.map((t) =>
      t.id === activeTabId
        ? { ...t, file_path: path, display_name: name, is_dirty: false }
        : t,
    );
    set({ tabs: updated });
    // Also sync to backend
    cmd.updateTabAfterSave(path, name, false).catch(() => {});
  },
}));

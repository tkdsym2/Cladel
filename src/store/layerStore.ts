import { create } from "zustand";
import type { LayerData } from "../types";
import * as cmd from "../lib/tauri-commands";

interface LayerStore {
  layers: LayerData[];
  currentLayer: LayerData | null;

  loadLayers: (projectId: string) => Promise<void>;
  createLayer: (projectId: string, coreContent?: string | null, sourceNodeId?: string | null) => Promise<LayerData>;
  deleteLayer: (layerId: string) => Promise<string | null>;
  setCurrentLayer: (layer: LayerData) => void;
}

export const useLayerStore = create<LayerStore>((set, get) => ({
  layers: [],
  currentLayer: null,

  loadLayers: async (projectId: string) => {
    const layers = await cmd.getLayers(projectId);
    set({ layers });
  },

  createLayer: async (projectId: string, coreContent?: string | null, sourceNodeId?: string | null) => {
    const layer = await cmd.createLayer(projectId, coreContent, sourceNodeId);
    set((s) => ({
      layers: [...s.layers, layer],
      currentLayer: layer,
    }));
    return layer;
  },

  deleteLayer: async (layerId: string) => {
    await cmd.deleteLayer(layerId);

    const { layers, currentLayer } = get();
    const remaining = layers.filter((l) => l.id !== layerId);
    const wasCurrent = currentLayer?.id === layerId;

    let switchToId: string | null = null;
    if (wasCurrent && remaining.length > 0) {
      // Prefer the previous layer (by layer_number), fall back to first
      const deletedIdx = layers.findIndex((l) => l.id === layerId);
      const prev = deletedIdx > 0 ? remaining[deletedIdx - 1] : remaining[0];
      const target = prev ?? remaining[0];
      switchToId = target.id;
      set({ layers: remaining, currentLayer: target });
    } else {
      set({ layers: remaining });
    }

    return switchToId;
  },

  setCurrentLayer: (layer) => {
    set({ currentLayer: layer });
  },
}));

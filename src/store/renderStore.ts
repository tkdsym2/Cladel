import { create } from "zustand";

/**
 * Transient render state for `render` nodes — kept out of the document so that
 * rendering a preview never marks the file dirty. Keyed by render node id.
 * Both the canvas `RenderNode` (thumbnail/status) and the `RenderNodeViewer`
 * (full multi-page preview) read from here.
 */
export type RenderStatus = "idle" | "rendering" | "ok" | "error";

export interface RenderState {
  status: RenderStatus;
  /** Absolute file paths to rendered page PNGs (use convertFileSrc to display). */
  pages: string[];
  pageCount: number;
  error: string | null;
  /** Epoch ms of the last successful render (for cache/debounce decisions). */
  renderedAt: number | null;
}

export const EMPTY_RENDER_STATE: RenderState = {
  status: "idle",
  pages: [],
  pageCount: 0,
  error: null,
  renderedAt: null,
};

interface RenderStore {
  byNode: Record<string, RenderState>;
  get: (nodeId: string) => RenderState;
  update: (nodeId: string, partial: Partial<RenderState>) => void;
  clear: (nodeId: string) => void;
}

export const useRenderStore = create<RenderStore>((set, getState) => ({
  byNode: {},
  get: (nodeId) => getState().byNode[nodeId] ?? EMPTY_RENDER_STATE,
  update: (nodeId, partial) =>
    set((s) => ({
      byNode: {
        ...s.byNode,
        [nodeId]: { ...(s.byNode[nodeId] ?? EMPTY_RENDER_STATE), ...partial },
      },
    })),
  clear: (nodeId) =>
    set((s) => {
      const next = { ...s.byNode };
      delete next[nodeId];
      return { byNode: next };
    }),
}));

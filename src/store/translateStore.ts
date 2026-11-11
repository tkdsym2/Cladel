import { create } from "zustand";
import * as cmd from "../lib/tauri-commands";

/**
 * Transient Translate-node state (streaming text, status) keyed by node id,
 * kept out of the document so streaming never marks the file dirty — only the
 * finished translation is saved into the node's metadata. Also caches whether
 * a translation model is installed (for the "Download model" prompt).
 */
export type TranslateStatus = "idle" | "loading" | "translating" | "done" | "cancelled" | "error";

export interface TranslateRunState {
  status: TranslateStatus;
  /** Streamed text of the running (or last) job. */
  live: string;
  error: string | null;
  jobId: string | null;
  chunkIndex: number;
  chunkCount: number;
  /** Last result hit the generation limit. */
  truncated: boolean;
  /** Paragraphs left untranslated (markup could not be preserved). */
  keptOriginal: string[];
}

export const EMPTY_TRANSLATE_STATE: TranslateRunState = {
  status: "idle",
  live: "",
  error: null,
  jobId: null,
  chunkIndex: 0,
  chunkCount: 0,
  truncated: false,
  keptOriginal: [],
};

export interface ModelStatus {
  checked: boolean;
  hasModel: boolean;
  /** e.g. "plamo-3-translate-0.8b-Q4_K_M.gguf" */
  activeName: string | null;
  /** Local translation is available on this platform (macOS only for now). */
  supported: boolean;
}

/** Progress of applying bilingual-sync items (per Translate node). */
export interface SyncRunState {
  /** Item key being applied, "all" for "apply all", null when idle. */
  busyKey: string | null;
  jobId: string | null;
  /** e.g. "2 / 5" while applying all. */
  progress: string | null;
  error: string | null;
  /** Paragraphs that kept their original text in the last applied translation. */
  warning: string | null;
  cancelRequested: boolean;
}

export const EMPTY_SYNC_STATE: SyncRunState = {
  busyKey: null,
  jobId: null,
  progress: null,
  error: null,
  warning: null,
  cancelRequested: false,
};

interface TranslateStore {
  byNode: Record<string, TranslateRunState>;
  update: (nodeId: string, partial: Partial<TranslateRunState>) => void;
  syncByNode: Record<string, SyncRunState>;
  updateSync: (nodeId: string, partial: Partial<SyncRunState>) => void;
  modelStatus: ModelStatus;
  refreshModelStatus: () => Promise<void>;
}

export const useTranslateStore = create<TranslateStore>((set) => ({
  byNode: {},
  update: (nodeId, partial) =>
    set((s) => ({
      byNode: {
        ...s.byNode,
        [nodeId]: { ...(s.byNode[nodeId] ?? EMPTY_TRANSLATE_STATE), ...partial },
      },
    })),
  syncByNode: {},
  updateSync: (nodeId, partial) =>
    set((s) => ({
      syncByNode: {
        ...s.syncByNode,
        [nodeId]: { ...(s.syncByNode[nodeId] ?? EMPTY_SYNC_STATE), ...partial },
      },
    })),
  modelStatus: { checked: false, hasModel: false, activeName: null, supported: true },
  refreshModelStatus: async () => {
    try {
      const local = await cmd.translationListLocalModels();
      const active = local.models.find((m) => m.active) ?? local.models[0] ?? null;
      set({
        modelStatus: {
          checked: true,
          hasModel: local.models.length > 0,
          activeName: active?.filename ?? null,
          supported: local.platform_supported,
        },
      });
    } catch {
      set({ modelStatus: { checked: true, hasModel: false, activeName: null, supported: true } });
    }
  },
}));

import { create } from "zustand";

export interface ExportProgress {
  stage: string;
  percent: number;
  message: string;
}

interface ExportState {
  /** True when this window initiated a PDF export that is in progress */
  selfExporting: boolean;
  /** True when another window is exporting (received via cross-window event) */
  remoteExporting: boolean;
  /** Export error (if any) */
  exportError: string | null;
  /** Current progress data */
  progress: ExportProgress;

  startSelfExport: () => void;
  finishSelfExport: (error?: string | null) => void;
  setProgress: (p: ExportProgress) => void;
  setRemoteExporting: (v: boolean) => void;
  reset: () => void;
}

const INIT_PROGRESS: ExportProgress = {
  stage: "init",
  percent: 0,
  message: "Preparing export...",
};

export const useExportStore = create<ExportState>((set) => ({
  selfExporting: false,
  remoteExporting: false,
  exportError: null,
  progress: { ...INIT_PROGRESS },

  startSelfExport: () =>
    set({ selfExporting: true, exportError: null, progress: { ...INIT_PROGRESS } }),

  finishSelfExport: (error) => {
    if (error) {
      set({ exportError: error });
    } else {
      set({
        progress: { stage: "done", percent: 100, message: "PDF export complete!" },
      });
    }
  },

  setProgress: (p) => set({ progress: p }),

  setRemoteExporting: (v) => set({ remoteExporting: v }),

  reset: () =>
    set({
      selfExporting: false,
      remoteExporting: false,
      exportError: null,
      progress: { ...INIT_PROGRESS },
    }),
}));

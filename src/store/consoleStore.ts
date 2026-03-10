import { create } from "zustand";

export interface ConsoleEntry {
  id: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  detail?: string;
  timestamp: string;
}

interface ConsoleState {
  entries: ConsoleEntry[];
  addEntry: (entry: Omit<ConsoleEntry, "id">) => void;
  clear: () => void;
}

const MAX_ENTRIES = 500;

let nextId = 0;

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],
  addEntry: (entry) =>
    set((state) => {
      const newEntry: ConsoleEntry = { ...entry, id: String(++nextId) };
      const entries = [...state.entries, newEntry];
      // Keep within limit
      if (entries.length > MAX_ENTRIES) {
        return { entries: entries.slice(entries.length - MAX_ENTRIES) };
      }
      return { entries };
    }),
  clear: () => set({ entries: [] }),
}));

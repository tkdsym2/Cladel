import { create } from "zustand";
import type { ProjectData } from "../types";
import * as cmd from "../lib/tauri-commands";

interface ProjectStore {
  projects: ProjectData[];
  currentProject: ProjectData | null;

  loadProjects: () => Promise<void>;
  createProject: (name: string) => Promise<ProjectData>;
  setCurrentProject: (project: ProjectData) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  currentProject: null,

  loadProjects: async () => {
    const projects = await cmd.getProjects();
    set({ projects });
  },

  createProject: async (name: string) => {
    const project = await cmd.createProject(name);
    set((s) => ({
      projects: [project, ...s.projects],
      currentProject: project,
    }));
    return project;
  },

  setCurrentProject: (project) => {
    set({ currentProject: project });
  },
}));

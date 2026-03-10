import { create } from "zustand";
import * as cmd from "../lib/tauri-commands";

interface UserStore {
  userId: string | null;
  userName: string | null;
  isRegistered: boolean;
  loadUser: () => Promise<void>;
  setUser: (userId: string, userName: string) => void;
  updateUserName: (userName: string) => Promise<void>;
}

export const useUserStore = create<UserStore>((set) => ({
  userId: null,
  userName: null,
  isRegistered: false,

  loadUser: async () => {
    try {
      const identity = await cmd.getUserIdentity();
      const registered = !!identity.user_id && !!identity.user_name;
      set({
        userId: identity.user_id,
        userName: identity.user_name,
        isRegistered: registered,
      });
    } catch (err) {
      console.error("Failed to load user identity:", err);
    }
  },

  setUser: (userId, userName) => {
    set({ userId, userName, isRegistered: true });
  },

  updateUserName: async (userName) => {
    try {
      const identity = await cmd.updateUserName(userName);
      set({ userName: identity.user_name });
    } catch (err) {
      console.error("Failed to update user name:", err);
    }
  },
}));

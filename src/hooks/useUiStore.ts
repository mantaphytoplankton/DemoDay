"use client";

import { create } from "zustand";

interface UiState {
  shortcutsOff: boolean;
  setShortcutsOff: (off: boolean) => void;
  /** Bumped by the E shortcut; scorecards toggle all remarks when it changes. */
  toggleAllSignal: number;
  requestToggleAll: () => void;
}

/** Browser storage is read after hydration (ShortcutsDialog effect), never during render. */
export function readShortcutsOff(): boolean {
  try {
    return window.localStorage.getItem("dd.shortcutsOff") === "1";
  } catch {
    return false;
  }
}

export const useUiStore = create<UiState>((set) => ({
  shortcutsOff: false,
  setShortcutsOff: (off) => {
    try {
      window.localStorage.setItem("dd.shortcutsOff", off ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    set({ shortcutsOff: off });
  },
  toggleAllSignal: 0,
  requestToggleAll: () => set((s) => ({ toggleAllSignal: s.toggleAllSignal + 1 })),
}));

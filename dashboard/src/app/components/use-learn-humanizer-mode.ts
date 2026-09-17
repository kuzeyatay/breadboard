"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  persistComposerSwitch,
  registerComposerSwitch,
} from "./composer-switch-preferences.ts";

// Learn has its own opt-in. Never inherit the Intelligence menu's rewrite
// preference: changing how chat answers read must not rewrite a textbook.
export const LEARN_HUMANIZER_STORAGE_KEY = "breadboard:learn-humanizer-mode";
export const LEARN_HUMANIZER_CHANGE_EVENT = "breadboard:learn-humanizer-mode-change";
let memoryValue = false;

export function isLearnHumanizerEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const value = window.localStorage.getItem(LEARN_HUMANIZER_STORAGE_KEY);
    if (value === "true" || value === "false") return value === "true";
  } catch {
    // Keep the current session's choice when storage is unavailable.
  }
  return memoryValue;
}

function subscribe(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LEARN_HUMANIZER_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(LEARN_HUMANIZER_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(LEARN_HUMANIZER_CHANGE_EVENT, onStoreChange);
  };
}

function applyLearnHumanizer(enabled: boolean): void {
  memoryValue = enabled;
  try {
    window.localStorage.setItem(LEARN_HUMANIZER_STORAGE_KEY, String(enabled));
  } catch {
    // The in-memory value still updates this tab.
  }
  window.dispatchEvent(new Event(LEARN_HUMANIZER_CHANGE_EVENT));
}

export function useLearnHumanizerMode(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, isLearnHumanizerEnabled, () => false);
  const setEnabled = useCallback((next: boolean) => {
    applyLearnHumanizer(next);
    persistComposerSwitch("learnHumanizerAuto", next);
  }, []);
  return [enabled, setEnabled] as const;
}

registerComposerSwitch("learnHumanizerAuto", applyLearnHumanizer);

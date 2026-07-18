"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "breadboard:yolo-mode";
const CHANGE_EVENT = "breadboard:yolo-mode-change";
let memoryValue = false;

export function isYoloModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? memoryValue : stored === "true";
  } catch {
    return memoryValue;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

export function useYoloMode(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, isYoloModeEnabled, () => false);
  const setEnabled = useCallback((next: boolean) => {
    memoryValue = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // The in-memory UI can still update through the local event when storage
      // is unavailable (for example, in a restricted browser context).
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [enabled, setEnabled] as const;
}

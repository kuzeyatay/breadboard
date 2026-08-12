"use client";

// Direct mode is the `i-have-adhd` first-party output style promoted to a
// switch. The skill keeps its descriptive one-turn command; the persistent
// product mode uses a neutral name that describes what it does.

import { useCallback, useSyncExternalStore } from "react";

export const DIRECT_MODE_STORAGE_KEY = "breadboard:direct-mode";
export const DIRECT_MODE_CHANGE_EVENT = "breadboard:direct-mode-change";
const LEGACY_STORAGE_KEY = "breadboard:adhd-mode";

// Fallback for browser contexts where localStorage throws. The same-tab event
// still keeps every mounted switch in sync.
let memoryValue = false;

function storedBoolean(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function isDirectModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const current = storedBoolean(
      window.localStorage.getItem(DIRECT_MODE_STORAGE_KEY),
    );
    if (current !== null) return current;

    const legacy = storedBoolean(window.localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy === null) return memoryValue;
    // One-time forward migration. Keep the old key in sync below so an older
    // build opened beside this one does not unexpectedly flip the preference.
    window.localStorage.setItem(DIRECT_MODE_STORAGE_KEY, String(legacy));
    memoryValue = legacy;
    return legacy;
  } catch {
    return memoryValue;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LEGACY_STORAGE_KEY) {
      const legacy = storedBoolean(event.newValue);
      if (legacy !== null) {
        memoryValue = legacy;
        try {
          window.localStorage.setItem(DIRECT_MODE_STORAGE_KEY, String(legacy));
        } catch {
          // The in-memory value still lets this tab follow the older client.
        }
      }
    }
    if (event.key === DIRECT_MODE_STORAGE_KEY || event.key === LEGACY_STORAGE_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(DIRECT_MODE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(DIRECT_MODE_CHANGE_EVENT, onStoreChange);
  };
}

export function useDirectMode(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribe,
    isDirectModeEnabled,
    () => false,
  );
  const setEnabled = useCallback((next: boolean) => {
    memoryValue = next;
    try {
      window.localStorage.setItem(DIRECT_MODE_STORAGE_KEY, String(next));
      window.localStorage.setItem(LEGACY_STORAGE_KEY, String(next));
    } catch {
      // Kept in memory only; the change event below still updates this tab.
    }
    window.dispatchEvent(new Event(DIRECT_MODE_CHANGE_EVENT));
  }, []);
  return [enabled, setEnabled] as const;
}

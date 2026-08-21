"use client";

// Personalize: whether this turn is allowed to know anything about the user.
//
// The counterpart to Concise, which governs the *shape* of an answer. This
// governs its *context*. Switched off, the turn is answered for anyone: no
// name, no durable memories, no synthesized profile. Switched on — the default,
// because it is the behaviour every existing chat already has — nothing
// changes.
//
// Read-side only, deliberately. Turning personalization off is a request for a
// general answer, not a request to go off the record: memory still saves, the
// chat still appears in history. The switch that stops writes is Temporary
// chat, and conflating the two would make one of them a lie.

import { useCallback, useSyncExternalStore } from "react";

export const PERSONALIZE_STORAGE_KEY = "breadboard:personalize";
export const PERSONALIZE_CHANGE_EVENT = "breadboard:personalize-change";

/** Personalization is the established behaviour, so absence means on. */
const DEFAULT_ENABLED = true;

// Fallback for browser contexts where localStorage throws. The same-tab event
// still keeps every mounted switch in sync.
let memoryValue = DEFAULT_ENABLED;

function storedBoolean(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function isPersonalizeEnabled(): boolean {
  if (typeof window === "undefined") return DEFAULT_ENABLED;
  try {
    const current = storedBoolean(
      window.localStorage.getItem(PERSONALIZE_STORAGE_KEY),
    );
    return current === null ? memoryValue : current;
  } catch {
    return memoryValue;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === PERSONALIZE_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(PERSONALIZE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(PERSONALIZE_CHANGE_EVENT, onStoreChange);
  };
}

export function usePersonalize(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribe,
    isPersonalizeEnabled,
    () => DEFAULT_ENABLED,
  );
  const setEnabled = useCallback((next: boolean) => {
    memoryValue = next;
    try {
      window.localStorage.setItem(PERSONALIZE_STORAGE_KEY, String(next));
    } catch {
      // Kept in memory only; the change event below still updates this tab.
    }
    window.dispatchEvent(new Event(PERSONALIZE_CHANGE_EVENT));
  }, []);
  return [enabled, setEnabled] as const;
}

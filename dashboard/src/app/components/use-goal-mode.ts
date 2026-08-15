"use client";

// Goal Mode is a per-message runtime capability with a browser preference like
// Direct and YOLO modes. Its durable objective lives on the server, keyed by
// the conversation, so this switch never leaks a goal into another chat.

import { useSyncExternalStore } from "react";
import { setAgentModeEnabled } from "./use-agent-mode.ts";

const STORAGE_KEY = "breadboard:goal-mode";
const CHANGE_EVENT = "breadboard:goal-mode-change";
let memoryValue = false;

export function isGoalModeEnabled(): boolean {
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

export function setGoalModeEnabled(next: boolean): void {
  memoryValue = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // The in-memory value and local event preserve this tab's control.
  }
  // Goal Mode needs the Hermes runtime to expose its Goal-compatible MCP
  // tools, so it cannot be used through provider-only direct chat.
  if (next) setAgentModeEnabled(true);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useGoalMode(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, isGoalModeEnabled, () => false);
  // The exported setter is stable, so returning it directly avoids a callback
  // wrapper while keeping the hook's tuple consistent with the other modes.
  return [enabled, setGoalModeEnabled] as const;
}

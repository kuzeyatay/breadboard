"use client";

// Rewrite naturally: whether finished prose is passed through the local
// rewriter after the model answers.
//
// This is a standing behaviour, not just visibility for a menu item. Chat
// answers keep the model's wording as version one, while the rewritten version
// becomes the one on screen. Server-written Markdown artifacts and garden notes
// read the mirrored account preference below and do the same on their write
// path. The per-answer action uses the ordinary retry path to create a fresh
// response branch, which this standing behaviour then humanizes.
//
// Off by default, unlike Personalize next to it. Personalize describes what
// Breadboard already did; this describes a capability most machines have not
// installed, so the honest default is that it stays out of the way until asked
// for.
//
// Same shape as `use-personalize`: localStorage, a same-tab event, and a
// memory fallback for browsers where storage throws.

import { useCallback, useSyncExternalStore } from "react";
import {
  markComposerSwitchTouched,
  registerComposerSwitch,
} from "./composer-switch-preferences.ts";

export const HUMANIZER_STORAGE_KEY = "breadboard:humanizer-mode";
export const HUMANIZER_CHANGE_EVENT = "breadboard:humanizer-mode-change";

const DEFAULT_ENABLED = false;

let memoryValue = DEFAULT_ENABLED;

function storedBoolean(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function isHumanizerEnabled(): boolean {
  if (typeof window === "undefined") return DEFAULT_ENABLED;
  try {
    const current = storedBoolean(window.localStorage.getItem(HUMANIZER_STORAGE_KEY));
    return current === null ? memoryValue : current;
  } catch {
    return memoryValue;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === HUMANIZER_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(HUMANIZER_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(HUMANIZER_CHANGE_EVENT, onStoreChange);
  };
}

export function useHumanizerMode(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, isHumanizerEnabled, () => DEFAULT_ENABLED);
  const setEnabled = useCallback((next: boolean) => {
    applyHumanizer(next);
    markComposerSwitchTouched("humanizerAuto");
    // The server needs this too. An artifact and a garden note are written
    // server-side, where there is no localStorage to read, so the switch is
    // mirrored onto the account as a standing preference. Best effort: a failed
    // sync leaves the browser behaving as the person just asked, and the
    // server-side surfaces simply keep their previous answer.
    void fetch("/api/assistant-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humanizerAuto: next }),
    }).catch(() => {});
  }, []);
  return [enabled, setEnabled] as const;
}

function applyHumanizer(next: boolean): void {
  memoryValue = next;
  try {
    window.localStorage.setItem(HUMANIZER_STORAGE_KEY, String(next));
  } catch {
    // Kept in memory only; the change event below still updates this tab.
  }
  window.dispatchEvent(new Event(HUMANIZER_CHANGE_EVENT));
}

// The account already carries this preference (see above); on load the
// browser switch follows it, since its localStorage copy belongs to one origin
// and the desktop dashboard's origin changes on every launch.
registerComposerSwitch("humanizerAuto", applyHumanizer);

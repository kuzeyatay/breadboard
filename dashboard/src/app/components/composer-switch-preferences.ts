"use client";

// Keeps the composer's switches on the account, not just in this origin's
// localStorage. See lib/hermes/composer-switches.ts for why the browser copy
// alone does not survive a Breadboard restart.
//
// Each switch store registers how to apply a remote value silently (memory +
// localStorage + change event, no write-back), and calls `persistComposerSwitch`
// from its own setter. Hydration runs once per page load, from the same
// `/api/assistant-preferences` request the intelligence picker already makes,
// and never overrides a switch the user touched while it was in flight.

import { useEffect } from "react";
import {
  loadAssistantPreferences,
  patchAssistantPreferences,
} from "../../lib/assistant-bootstrap-client.ts";
import {
  COMPOSER_SWITCH_KEYS,
  pickComposerSwitches,
  type ComposerSwitchKey,
} from "../../lib/hermes/composer-switches.ts";

/** Humanizer already lives on the account as its own column; it only hydrates. */
export type HydratedSwitchKey = ComposerSwitchKey | "humanizerAuto";

type Apply = (enabled: boolean) => void;

const appliers = new Map<HydratedSwitchKey, Apply>();
const touched = new Set<HydratedSwitchKey>();
let remote: Partial<Record<HydratedSwitchKey, boolean>> | null = null;
let hydration: Promise<void> | null = null;

function applyRemote(key: HydratedSwitchKey): void {
  const apply = appliers.get(key);
  const value = remote?.[key];
  if (!apply || value === undefined || touched.has(key)) return;
  apply(value);
}

/**
 * Called by each switch store at module load. A store that loads after the
 * preferences arrived is brought up to date immediately.
 */
export function registerComposerSwitch(key: HydratedSwitchKey, apply: Apply): void {
  appliers.set(key, apply);
  if (remote) applyRemote(key);
}

/** Write-through from a store's setter. The user's choice outranks hydration. */
export function persistComposerSwitch(key: ComposerSwitchKey, enabled: boolean): void {
  touched.add(key);
  if (typeof window === "undefined") return;
  void patchAssistantPreferences({ switches: { [key]: enabled } }).catch(() => {
    // Signed out or offline: the browser copy still carries this session.
  });
}

/** Humanizer persists itself; this only keeps hydration from undoing a click. */
export function markComposerSwitchTouched(key: HydratedSwitchKey): void {
  touched.add(key);
}

export async function hydrateComposerSwitches(): Promise<void> {
  if (typeof window === "undefined") return;
  if (hydration) return hydration;
  hydration = loadAssistantPreferences()
    .then((payload) => {
      if (!payload) return;
      const switches = pickComposerSwitches(payload.switches) ?? {};
      remote = { ...switches };
      if (typeof payload.humanizerAuto === "boolean") {
        remote.humanizerAuto = payload.humanizerAuto;
      }
      for (const key of [...COMPOSER_SWITCH_KEYS, "humanizerAuto"] as const) {
        applyRemote(key);
      }
    })
    .catch(() => {
      // No account copy reachable; the browser copy stands.
    });
  return hydration;
}

/** Mount once per surface; the request and its application are shared. */
export function useComposerSwitchHydration(): void {
  useEffect(() => {
    void hydrateComposerSwitches();
  }, []);
}

/** Test seam: forget the shared state between scenarios. */
export function resetComposerSwitchPreferencesForTest(): void {
  appliers.clear();
  touched.clear();
  remote = null;
  hydration = null;
}

"use client";

import { readTerminalData } from "./terminal-data-client.ts";

import {
  PAGE_APPEARANCE_CHANGE_EVENT, pageAppearanceKey, readPageAppearance, writePageAppearance,
  type AppearancePage, type AppearanceTheme,
} from "./page-appearance.ts";
import { parseSavedBackground, restoreBackground, savedBackground, type SavedBackground } from "./page-appearance-persistence.ts";

interface SyncState {
  hydration?: Promise<void>;
  touched: Set<AppearanceTheme>;
  writes: Promise<unknown>;
}

const states = new Map<string, SyncState>();

function stateFor(ownerKey: string, page: AppearancePage): SyncState {
  const key = pageAppearanceKey(ownerKey, page);
  let state = states.get(key);
  if (!state) {
    state = { touched: new Set(), writes: Promise.resolve() };
    states.set(key, state);
  }
  return state;
}

function endpoint(ownerKey: string, page: AppearancePage): string {
  return `/api/profile/page-appearance?${new URLSearchParams({ ownerKey, page })}`;
}

function changed() {
  window.dispatchEvent(new Event(PAGE_APPEARANCE_CHANGE_EVENT));
}

function persist(ownerKey: string, page: AppearancePage, theme: AppearanceTheme, value: SavedBackground, onlyIfMissing = false): Promise<SavedBackground> {
  const state = stateFor(ownerKey, page);
  // Serialize writes so a slow upload cannot land after a newer selection.
  const write = state.writes.catch(() => {}).then(async () => {
    const response = await fetch(endpoint(ownerKey, page), {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, theme, value, onlyIfMissing }),
    });
    if (!response.ok) throw new Error("Couldn’t save your background for the next restart. Try again.");
    const saved = parseSavedBackground((await response.json()).value);
    if (!saved) throw new Error("Couldn’t confirm your saved background. Try again.");
    return saved;
  });
  state.writes = write;
  return write;
}

/** Restore across desktop launches, whose loopback origins can change ports. */
export function hydratePageAppearance(ownerKey: string, page: AppearancePage): Promise<void> {
  const state = stateFor(ownerKey, page);
  if (state.hydration) return state.hydration;
  state.hydration = (async () => {
    const before = readPageAppearance(window.localStorage, ownerKey, page);
    const response = await readTerminalData(endpoint(ownerKey, page));
    if (!response.ok) throw new Error("Appearance unavailable.");
    const { preferences } = await response.json();
    if (!preferences || typeof preferences !== "object") throw new Error("Invalid appearance response.");
    for (const theme of ["light", "dark"] as const) {
      const original = savedBackground(before, theme);
      const untouched = () => !state.touched.has(theme) && JSON.stringify(savedBackground(readPageAppearance(window.localStorage, ownerKey, page), theme)) === JSON.stringify(original);
      if (!untouched()) continue;
      let value = parseSavedBackground(preferences[theme]);
      if (!value && (original.background !== "none" || original.nextChangeAt !== null || original.rain)) {
        value = await persist(ownerKey, page, theme, original, true);
      }
      if (!value || !untouched()) continue;
      const next = readPageAppearance(window.localStorage, ownerKey, page);
      restoreBackground(next, theme, value);
      window.localStorage.setItem(pageAppearanceKey(ownerKey, page), JSON.stringify(next));
      changed();
    }
  })().catch(() => {
    // Keep the browser copy available offline; a later mount can retry.
    state.hydration = undefined;
  });
  return state.hydration;
}

export function savePageAppearance(ownerKey: string, page: AppearancePage, patch: Parameters<typeof writePageAppearance>[3]): Promise<void> {
  writePageAppearance(window.localStorage, ownerKey, page, patch);
  const theme = "background" in patch ? patch.background.theme : "random" in patch ? patch.random.theme : patch.rain.theme;
  stateFor(ownerKey, page).touched.add(theme);
  changed();
  const value = savedBackground(readPageAppearance(window.localStorage, ownerKey, page), theme);
  return persist(ownerKey, page, theme, value).then(() => {});
}

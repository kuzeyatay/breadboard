"use client";

// The location consent used to live only in localStorage. That storage is
// scoped to an origin, while the desktop dashboard starts on a fresh loopback
// port after a restart. The Electron shell therefore owns the desktop's
// durable consent bit. A normal browser also keeps the signed-in account copy,
// while the actual coordinates remain in device-local browser storage.

import {
  hydrateComposerSwitches,
  persistComposerSwitch,
  registerComposerSwitch,
} from "./composer-switch-preferences.ts";
import {
  announceCurrentLocationChange,
  clearStoredCurrentLocationPreference,
  getStoredCurrentLocationPreference,
  writeStoredCurrentLocationPreference,
} from "../../lib/current-location.ts";

interface DesktopCurrentLocationBridge {
  getCurrentLocationPreference?: () => Promise<boolean | null>;
  setCurrentLocationPreference?: (enabled: boolean) => Promise<boolean>;
}

interface CurrentLocationPreferenceControl {
  read(): Promise<boolean | null>;
  write(enabled: boolean): Promise<boolean>;
}

function desktopPreferenceControl(): CurrentLocationPreferenceControl | null {
  if (typeof window === "undefined") return null;
  const desktop = (
    window as Window & { breadboardDesktop?: DesktopCurrentLocationBridge }
  ).breadboardDesktop;
  const read = desktop?.getCurrentLocationPreference;
  const write = desktop?.setCurrentLocationPreference;
  if (typeof read !== "function" || typeof write !== "function") return null;
  return {
    read: () =>
      Promise.resolve(read.call(desktop)).then(
        (enabled) => (typeof enabled === "boolean" ? enabled : null),
        () => null,
      ),
    write: (enabled) =>
      Promise.resolve(write.call(desktop, enabled)).then(
        (saved) => saved === true,
        () => false,
      ),
  };
}

export function applyRemoteCurrentLocationPreference(enabled: boolean): void {
  const current = getStoredCurrentLocationPreference(window.localStorage);
  if (enabled) {
    writeStoredCurrentLocationPreference(window.localStorage, {
      useForAnswers: true,
      snapshot: current.snapshot,
    });
  } else {
    clearStoredCurrentLocationPreference(window.localStorage);
  }
  announceCurrentLocationChange();
}

export async function persistCurrentLocationPreference(
  enabled: boolean,
): Promise<boolean> {
  const desktop = desktopPreferenceControl();
  if (desktop && !(await desktop.write(enabled))) return false;
  persistComposerSwitch("currentLocation", enabled);
  return true;
}

/** Restore the durable bit before startup decides whether to request a fix. */
export async function hydrateCurrentLocationPreference(): Promise<void> {
  // This also hydrates every account-backed switch. On desktop the registered
  // location applier deliberately yields to the shell read below.
  await hydrateComposerSwitches();
  const desktop = desktopPreferenceControl();
  if (!desktop) return;
  const enabled = await desktop.read();
  const current = getStoredCurrentLocationPreference(window.localStorage);
  if (enabled === null) {
    // One-time migration from the account-backed implementation. Only an
    // explicit true is copied; absent/corrupt native state cannot opt in.
    if (current.useForAnswers) await desktop.write(true);
    return;
  }
  if (enabled) {
    writeStoredCurrentLocationPreference(window.localStorage, {
      useForAnswers: true,
      snapshot: current.snapshot,
    });
  } else {
    clearStoredCurrentLocationPreference(window.localStorage);
  }
  announceCurrentLocationChange();
}

registerComposerSwitch("currentLocation", applyRemoteCurrentLocationPreference);

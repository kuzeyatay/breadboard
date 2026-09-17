"use client";

import { useEffect } from "react";
import { beginStartupLoading } from "./startup-readiness";
import { hydrateCurrentLocationPreference } from "@/app/components/current-location-preference.ts";
import {
  announceCurrentLocationChange,
  getStoredCurrentLocationPreference,
  normalizeCurrentLocationSnapshot,
  writeStoredCurrentLocationPreference,
  type CurrentLocationSnapshot,
} from "@/lib/current-location.ts";
import { requestUsesCurrentLocation } from "@/lib/hermes/current-location-context.ts";
import {
  requestCurrentLocationFix,
  resolveCurrentLocationLabel,
} from "@/lib/current-location-source.ts";

export const CURRENT_LOCATION_REFRESH_INTERVAL_MS = 15 * 60_000;

// React may mount effects twice while checking them in development. Keeping the
// startup work and active request at module scope prevents duplicate fixes.
let initializationRefresh: Promise<boolean> | null = null;
let locationRefreshInFlight: Promise<boolean> | null = null;
let lastLocationRefreshAttemptAt = 0;

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function refreshStoredCurrentLocation(): Promise<boolean> {
  if (locationRefreshInFlight) return locationRefreshInFlight;

  const refresh = (async () => {
    try {
      const preference = getStoredCurrentLocationPreference(window.localStorage);
      if (!preference.useForAnswers) return false;
      lastLocationRefreshAttemptAt = Date.now();

      // Automatic refreshes need a new fix instead of the browser's normally
      // useful geolocation cache: the stored snapshot is already our cache.
      const attempt = await requestCurrentLocationFix({ maxAgeMs: 0 });
      if (!attempt.ok) return false;

      const baseSnapshot = normalizeCurrentLocationSnapshot({
        latitude: attempt.fix.latitude,
        longitude: attempt.fix.longitude,
        capturedAt: new Date().toISOString(),
        accuracyMeters: attempt.fix.accuracyMeters,
        timeZone: deviceTimeZone(),
      });
      if (!baseSnapshot) return false;
      const label = await resolveCurrentLocationLabel(baseSnapshot, preference.snapshot);
      const snapshot = label ? { ...baseSnapshot, label } : baseSnapshot;

      // The user may turn location off while a fix is in flight. Re-read their
      // choice before writing so a late result can never opt them back in.
      const latestPreference = getStoredCurrentLocationPreference(window.localStorage);
      if (!latestPreference.useForAnswers) return false;

      writeStoredCurrentLocationPreference(window.localStorage, {
        useForAnswers: true,
        snapshot,
      });
      announceCurrentLocationChange();
      return true;
    } catch {
      // Location services and browser storage are optional. Keep the last fix
      // intact so Profile can explain it and offer a manual refresh.
      return false;
    }
  })();

  locationRefreshInFlight = refresh;
  void refresh.finally(() => {
    if (locationRefreshInFlight === refresh) locationRefreshInFlight = null;
  });
  return refresh;
}

export function refreshCurrentLocationAtInitialization(): Promise<boolean> {
  return refreshStoredCurrentLocation();
}

export function refreshCurrentLocationIfDue(now = Date.now()): Promise<boolean> {
  if (locationRefreshInFlight) return locationRefreshInFlight;
  try {
    const preference = getStoredCurrentLocationPreference(window.localStorage, now);
    if (!preference.useForAnswers) return Promise.resolve(false);

    const capturedAt = preference.snapshot
      ? Date.parse(preference.snapshot.capturedAt)
      : Number.NaN;
    const latestKnownRefresh = Math.max(
      lastLocationRefreshAttemptAt,
      Number.isFinite(capturedAt) ? capturedAt : 0,
    );
    if (latestKnownRefresh > 0 && now - latestKnownRefresh < CURRENT_LOCATION_REFRESH_INTERVAL_MS) {
      return Promise.resolve(false);
    }
    return refreshStoredCurrentLocation();
  } catch {
    return Promise.resolve(false);
  }
}

function initializeCurrentLocation(): Promise<boolean> {
  initializationRefresh ??= hydrateCurrentLocationPreference().then(() =>
    refreshCurrentLocationAtInitialization(),
  );
  return initializationRefresh;
}

/** Prepare the shared device context just before either chat transport sends. */
export async function getCurrentLocationForTurn(
  request: string,
): Promise<CurrentLocationSnapshot | undefined> {
  if (typeof window === "undefined" || !requestUsesCurrentLocation(request)) return undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Join startup and any refresh already in flight. A stalled location
    // service must not hold a chat indefinitely; it can finish in the background.
    await Promise.race([
      initializeCurrentLocation().then(() => refreshCurrentLocationIfDue()),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, 10_000); }),
    ]);
    const preference = getStoredCurrentLocationPreference(window.localStorage);
    return preference.useForAnswers && preference.state === "available"
      ? preference.snapshot ?? undefined
      : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export default function CurrentLocationAutoRefresh() {
  useEffect(() => {
    const finishStartup = beginStartupLoading();
    // Durable hydration must win before the first read. On desktop restart the
    // new loopback origin begins empty, so reading first would incorrectly see
    // the switch as off and skip the fresh device fix.
    void initializeCurrentLocation().then(finishStartup, finishStartup);

    const refreshIfDue = () => {
      void refreshCurrentLocationIfDue();
    };
    const refreshTimer = window.setInterval(
      refreshIfDue,
      CURRENT_LOCATION_REFRESH_INTERVAL_MS,
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshIfDue();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      finishStartup();
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}

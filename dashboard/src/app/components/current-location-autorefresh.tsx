"use client";

import { useEffect } from "react";
import { hydrateCurrentLocationPreference } from "@/app/components/current-location-preference.ts";
import {
  announceCurrentLocationChange,
  getStoredCurrentLocationPreference,
  normalizeCurrentLocationSnapshot,
  writeStoredCurrentLocationPreference,
} from "@/lib/current-location.ts";
import { requestCurrentLocationFix } from "@/lib/current-location-source.ts";

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

      const snapshot = normalizeCurrentLocationSnapshot({
        latitude: attempt.fix.latitude,
        longitude: attempt.fix.longitude,
        capturedAt: new Date().toISOString(),
        accuracyMeters: attempt.fix.accuracyMeters,
        timeZone: deviceTimeZone(),
      });
      if (!snapshot) return false;

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

export default function CurrentLocationAutoRefresh() {
  useEffect(() => {
    // Durable hydration must win before the first read. On desktop restart the
    // new loopback origin begins empty, so reading first would incorrectly see
    // the switch as off and skip the fresh device fix.
    initializationRefresh ??= hydrateCurrentLocationPreference().then(() =>
      refreshCurrentLocationAtInitialization(),
    );

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
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}

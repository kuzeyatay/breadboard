"use client";

import { useEffect } from "react";
import {
  announceCurrentLocationChange,
  getStoredCurrentLocationPreference,
  normalizeCurrentLocationSnapshot,
  writeStoredCurrentLocationPreference,
} from "@/lib/current-location.ts";
import { requestCurrentLocationFix } from "@/lib/current-location-source.ts";

// React may mount effects twice while checking them in development. Keeping the
// startup work at module scope still gives each Breadboard page load one request.
let initializationRefresh: Promise<boolean> | null = null;

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function refreshCurrentLocationAtInitialization(): Promise<boolean> {
  try {
    const preference = getStoredCurrentLocationPreference(window.localStorage);
    if (!preference.useForAnswers) return false;

    // A startup refresh should ask for a current fix instead of accepting the
    // browser's normally useful fifteen-minute geolocation cache.
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

    writeStoredCurrentLocationPreference(window.localStorage, {
      useForAnswers: true,
      snapshot,
    });
    announceCurrentLocationChange();
    return true;
  } catch {
    // Initialization must remain usable when location services or browser
    // storage are unavailable. The previous fix stays intact for the profile
    // card to explain, and a manual refresh can still be tried there.
    return false;
  }
}

export default function CurrentLocationAutoRefresh() {
  useEffect(() => {
    initializationRefresh ??= refreshCurrentLocationAtInitialization();
  }, []);

  return null;
}

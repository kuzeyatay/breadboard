export const CURRENT_LOCATION_STORAGE_KEY = "breadboard:current-location";
export const CURRENT_LOCATION_CHANGE_EVENT = "breadboard:current-location-change";
export const CURRENT_LOCATION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
// Anything broader than 100 km is not useful enough to call "current
// location" for nearby answers. Fail closed instead of presenting a city- or
// country-scale network estimate as an available local fix.
const MAX_ACCURACY_METERS = 100_000;

export interface CurrentLocationSnapshot {
  /** Coarse latitude, deliberately limited to two decimal places. */
  latitude: number;
  /** Coarse longitude, deliberately limited to two decimal places. */
  longitude: number;
  /** Minimal reverse-geocoded label, for example "London, United Kingdom". */
  label?: string;
  /** ISO-8601 instant at which the browser produced this fix. */
  capturedAt: string;
  /** The browser's estimated radius of uncertainty, in metres. */
  accuracyMeters: number;
  /** The device time zone when the fix was captured. */
  timeZone: string;
}

export type CurrentLocationPreferenceState =
  | "off"
  | "available"
  | "stale"
  | "unavailable";

export interface CurrentLocationPreference {
  useForAnswers: boolean;
  snapshot: CurrentLocationSnapshot | null;
  state: CurrentLocationPreferenceState;
}

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem" | "removeItem">;
type Clock = Date | number;

function clockMilliseconds(now: Clock = Date.now()): number {
  return now instanceof Date ? now.getTime() : now;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function coarseCoordinate(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function normalizeCurrentLocationLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.replace(/\s+/g, " ").trim();
  return candidate && candidate.length <= 160 ? candidate : null;
}

function normalizedTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > 100 ||
    !/^[A-Za-z0-9_+\-/]+$/.test(candidate)
  ) {
    return null;
  }
  try {
    // The Intl constructor rejects invented zone names while retaining valid
    // names such as UTC, Europe/Istanbul and Etc/GMT+3.
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Validate and coarsen an untrusted browser/server location payload.
 *
 * This function has no browser dependency, so the message routes can apply the
 * exact same validation before a location ever reaches an assistant prompt.
 */
export function normalizeCurrentLocationSnapshot(
  value: unknown,
  now: Clock = Date.now(),
): CurrentLocationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const latitude = finiteNumber(candidate.latitude);
  const longitude = finiteNumber(candidate.longitude);
  const accuracyMeters = finiteNumber(candidate.accuracyMeters);
  const timeZone = normalizedTimeZone(candidate.timeZone);
  const label = normalizeCurrentLocationLabel(candidate.label);
  if (
    latitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude === null ||
    longitude < -180 ||
    longitude > 180 ||
    accuracyMeters === null ||
    accuracyMeters < 0 ||
    accuracyMeters > MAX_ACCURACY_METERS ||
    !timeZone ||
    typeof candidate.capturedAt !== "string"
  ) {
    return null;
  }
  const capturedMilliseconds = Date.parse(candidate.capturedAt);
  const currentMilliseconds = clockMilliseconds(now);
  if (
    !Number.isFinite(capturedMilliseconds) ||
    !Number.isFinite(currentMilliseconds) ||
    capturedMilliseconds > currentMilliseconds + MAX_FUTURE_SKEW_MS
  ) {
    return null;
  }
  return {
    latitude: coarseCoordinate(latitude),
    longitude: coarseCoordinate(longitude),
    ...(label ? { label } : {}),
    capturedAt: new Date(capturedMilliseconds).toISOString(),
    accuracyMeters: Math.round(accuracyMeters),
    timeZone,
  };
}

export function isCurrentLocationFresh(
  snapshot: CurrentLocationSnapshot,
  now: Clock = Date.now(),
): boolean {
  const capturedMilliseconds = Date.parse(snapshot.capturedAt);
  const currentMilliseconds = clockMilliseconds(now);
  if (!Number.isFinite(capturedMilliseconds) || !Number.isFinite(currentMilliseconds)) {
    return false;
  }
  const age = currentMilliseconds - capturedMilliseconds;
  return age >= -MAX_FUTURE_SKEW_MS && age <= CURRENT_LOCATION_MAX_AGE_MS;
}

function preferenceFrom(
  useForAnswers: boolean,
  snapshot: CurrentLocationSnapshot | null,
  now: Clock,
): CurrentLocationPreference {
  return {
    useForAnswers,
    snapshot,
    state: !useForAnswers
      ? "off"
      : !snapshot
        ? "unavailable"
        : isCurrentLocationFresh(snapshot, now)
          ? "available"
          : "stale",
  };
}

export function getStoredCurrentLocationPreference(
  storage: StorageReader,
  now: Clock = Date.now(),
): CurrentLocationPreference {
  try {
    const parsed = JSON.parse(
      storage.getItem(CURRENT_LOCATION_STORAGE_KEY) ?? "null",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return preferenceFrom(false, null, now);
    }
    const record = parsed as Record<string, unknown>;
    const useForAnswers = record.useForAnswers === true;
    const snapshot = normalizeCurrentLocationSnapshot(record.snapshot, now);
    return preferenceFrom(useForAnswers, snapshot, now);
  } catch {
    return preferenceFrom(false, null, now);
  }
}

export function writeStoredCurrentLocationPreference(
  storage: StorageWriter,
  input: {
    useForAnswers: boolean;
    snapshot?: CurrentLocationSnapshot | null;
  },
  now: Clock = Date.now(),
): CurrentLocationPreference {
  const snapshot = normalizeCurrentLocationSnapshot(input.snapshot ?? null, now);
  const preference = preferenceFrom(input.useForAnswers === true, snapshot, now);
  storage.setItem(
    CURRENT_LOCATION_STORAGE_KEY,
    JSON.stringify({
      useForAnswers: preference.useForAnswers,
      snapshot: preference.snapshot,
    }),
  );
  return preference;
}

export function clearStoredCurrentLocationPreference(
  storage: StorageWriter,
): CurrentLocationPreference {
  storage.removeItem(CURRENT_LOCATION_STORAGE_KEY);
  return preferenceFrom(false, null, Date.now());
}

/** Announce a same-document write; the native storage event covers other tabs. */
export function announceCurrentLocationChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CURRENT_LOCATION_CHANGE_EVENT));
}

export function subscribeCurrentLocation(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CURRENT_LOCATION_STORAGE_KEY) onChange();
  };
  window.addEventListener(CURRENT_LOCATION_CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CURRENT_LOCATION_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

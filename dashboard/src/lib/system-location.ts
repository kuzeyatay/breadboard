/**
 * Asking the operating system where this computer is.
 *
 * Chromium's geolocation is not a sensor reading, it is a call to Google's
 * location service, and the API key authorizing that call is compiled into a
 * browser at build time. Electron ships without one, so inside the desktop
 * shell `navigator.geolocation` fails with POSITION_UNAVAILABLE however the
 * permission is answered — nothing is blocking it, it simply has no provider
 * to ask. Chrome and Edge carry their own keys, so the same page works there.
 *
 * Windows does have a location service, and .NET exposes it through
 * GeoCoordinateWatcher. Breadboard's server runs on the same computer as the
 * window showing it, so it can ask Windows directly and hand a fix back to a
 * page whose own geolocation had nowhere to go. Only Windows PowerShell can
 * load System.Device: the assembly is .NET Framework, absent from the .NET Core
 * that `pwsh` runs on.
 */

export type SystemLocationResult =
  | {
      state: "available";
      latitude: number;
      longitude: number;
      /** The service's radius of uncertainty, in metres. */
      accuracyMeters: number;
    }
  /** Someone said no: the OS privacy switch, or its per-app equivalent. */
  | { state: "blocked"; reason: string }
  /** The service was willing but produced no position. */
  | { state: "unavailable"; reason: string }
  /** This platform has no location service Breadboard can reach. */
  | { state: "unsupported"; reason: string };

const NO_FIX = "Windows did not return a position for this computer.";

function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

function reasonFrom(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  // A .NET exception message can be a paragraph; the card has one line for it.
  return text ? text.slice(0, 200) : fallback;
}

/**
 * Read the script's one line of JSON.
 *
 * Exported because this is where a malformed or half-written answer has to
 * become an ordinary "unavailable" rather than an exception in a route.
 */
export function parseSystemLocationOutput(output: string): SystemLocationResult {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { state: "unavailable", reason: NO_FIX };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch {
    return { state: "unavailable", reason: NO_FIX };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { state: "unavailable", reason: NO_FIX };
  }
  const record = parsed as Record<string, unknown>;
  if (record.state === "blocked") {
    return { state: "blocked", reason: reasonFrom(record.reason, "Windows is blocking location.") };
  }
  if (record.state === "available") {
    const latitude = finiteNumber(record.latitude);
    const longitude = finiteNumber(record.longitude);
    const accuracyMeters = finiteNumber(record.accuracyMeters);
    if (
      latitude === null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude === null ||
      longitude < -180 ||
      longitude > 180
    ) {
      return { state: "unavailable", reason: NO_FIX };
    }
    return {
      state: "available",
      latitude,
      longitude,
      // An unknown radius comes back as Double.MaxValue. Calling that zero would
      // be a lie in the other direction, so it becomes a frank 50 km — coarse
      // enough that the snapshot validator can still weigh it.
      accuracyMeters:
        accuracyMeters === null || accuracyMeters <= 0 || accuracyMeters > 1e6
          ? 50_000
          : accuracyMeters,
    };
  }
  return { state: "unavailable", reason: reasonFrom(record.reason, NO_FIX) };
}

/** The stable answer for a platform with no reachable operating-system sensor. */
export function unsupportedSystemLocation(): SystemLocationResult {
  return {
    state: "unsupported",
    reason: "This system has no location service Breadboard can read.",
  };
}

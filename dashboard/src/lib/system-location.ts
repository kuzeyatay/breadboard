import { execFile } from "node:child_process";
import path from "node:path";

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

/** How long Windows is given to produce a first fix. */
const FIX_TIMEOUT_MS = 10_000;
/** The whole PowerShell round trip, including .NET startup. */
const PROCESS_TIMEOUT_MS = 25_000;

const NO_FIX = "Windows did not return a position for this computer.";

/**
 * The watcher reports `Ready` once it holds a position. Until then its status
 * distinguishes the two failures worth telling apart: `Disabled` is the OS
 * privacy switch, anything else is a service that tried and came up empty.
 */
const LOCATION_SCRIPT = `
$ErrorActionPreference = 'Stop'
$result = @{ state = 'unavailable'; reason = '${NO_FIX}' }
try {
  Add-Type -AssemblyName System.Device
  $watcher = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::Default)
  $watcher.Start()
  $deadline = (Get-Date).AddMilliseconds(${FIX_TIMEOUT_MS})
  while ($watcher.Status -ne [System.Device.Location.GeoPositionStatus]::Ready -and (Get-Date) -lt $deadline) {
    if ($watcher.Permission -eq [System.Device.Location.GeoPositionPermission]::Denied) { break }
    if ($watcher.Status -eq [System.Device.Location.GeoPositionStatus]::Disabled) { break }
    Start-Sleep -Milliseconds 200
  }
  $location = $watcher.Position.Location
  if ($watcher.Permission -eq [System.Device.Location.GeoPositionPermission]::Denied) {
    $result = @{ state = 'blocked'; reason = 'Windows is not letting desktop apps use this computer''s location.' }
  } elseif ($location -and -not $location.IsUnknown) {
    $result = @{
      state = 'available'
      latitude = $location.Latitude
      longitude = $location.Longitude
      accuracyMeters = $location.HorizontalAccuracy
    }
  } elseif ($watcher.Status -eq [System.Device.Location.GeoPositionStatus]::Disabled) {
    $result = @{ state = 'blocked'; reason = 'The Windows location service is turned off.' }
  }
  $watcher.Stop()
} catch {
  $result = @{ state = 'unavailable'; reason = "Windows location failed: $($_.Exception.Message)" }
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
`;

function windowsPowerShell(): string {
  const systemRoot = process.env["SystemRoot"] || "C:\\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

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

/** Ask this machine's OS for a position. Never rejects. */
export function readSystemLocation(
  platform: NodeJS.Platform = process.platform,
): Promise<SystemLocationResult> {
  if (platform !== "win32") {
    return Promise.resolve({
      state: "unsupported",
      reason: "This system has no location service Breadboard can read.",
    });
  }
  return new Promise((resolve) => {
    // Base64 UTF-16LE is PowerShell's own way in for a script with quotes and
    // `$` in it, so nothing here depends on how a shell splits arguments.
    const encoded = Buffer.from(LOCATION_SCRIPT, "utf16le").toString("base64");
    execFile(
      windowsPowerShell(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { timeout: PROCESS_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error && !stdout) {
          resolve({
            state: "unavailable",
            reason: "Breadboard could not reach the Windows location service.",
          });
          return;
        }
        resolve(parseSystemLocationOutput(stdout));
      },
    );
  });
}

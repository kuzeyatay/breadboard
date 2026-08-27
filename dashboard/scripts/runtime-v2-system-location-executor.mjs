import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FIX_TIMEOUT_MS = 10_000;
const PROCESS_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_BYTES = 128 * 1024;
const NO_FIX = "Windows did not return a position for this computer.";

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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function finiteNumber(value) {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

function reasonFrom(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 200) : fallback;
}

export function validateSystemLocationRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation"]) ||
    value.protocolVersion !== 1 ||
    value.operation !== "read-device-location"
  ) throw new Error("The canonical system-location request is invalid.");
  return value;
}

export function validateSystemLocationExecutionScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    value.gardenId !== null ||
    value.conversationId !== null
  ) throw new Error("The system-location worker requires authenticated user-global scope.");
  return value;
}

export function parseSystemLocationWorkerOutput(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { state: "unavailable", reason: NO_FIX };
  }
  let parsed;
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch {
    return { state: "unavailable", reason: NO_FIX };
  }
  if (!isRecord(parsed)) return { state: "unavailable", reason: NO_FIX };
  if (parsed.state === "blocked") {
    return { state: "blocked", reason: reasonFrom(parsed.reason, "Windows is blocking location.") };
  }
  if (parsed.state === "available") {
    const latitude = finiteNumber(parsed.latitude);
    const longitude = finiteNumber(parsed.longitude);
    const accuracyMeters = finiteNumber(parsed.accuracyMeters);
    if (
      latitude === null || latitude < -90 || latitude > 90 ||
      longitude === null || longitude < -180 || longitude > 180
    ) return { state: "unavailable", reason: NO_FIX };
    return {
      state: "available",
      latitude,
      longitude,
      accuracyMeters:
        accuracyMeters === null || accuracyMeters <= 0 || accuracyMeters > 1e6
          ? 50_000
          : accuracyMeters,
    };
  }
  return { state: "unavailable", reason: reasonFrom(parsed.reason, NO_FIX) };
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function trustedPowerShell(environment) {
  if (environment.BREADBOARD_RUNTIME_V2_FIXED_TOOLS !== "1") {
    throw new Error("The system-location worker requires Runtime-minted tools.");
  }
  const systemRoot = environment.SystemRoot?.trim() ?? "";
  const configured = environment.BREADBOARD_WINDOWS_POWERSHELL_BIN?.trim() ?? "";
  if (!path.isAbsolute(systemRoot) || !path.isAbsolute(configured)) {
    throw new Error("The trusted Windows PowerShell path is unavailable.");
  }
  const expected = path.join(
    path.resolve(systemRoot),
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!samePath(configured, expected)) {
    throw new Error("The trusted Windows PowerShell path is outside SystemRoot.");
  }
  const metadata = fs.lstatSync(expected);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The trusted Windows PowerShell executable is unavailable.");
  }
  const canonical = fs.realpathSync.native(expected);
  if (!samePath(canonical, expected)) {
    throw new Error("The trusted Windows PowerShell executable is indirect.");
  }
  return canonical;
}

function childEnvironment(environment) {
  const allowed = [
    "SystemRoot",
    "SystemDrive",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "ComSpec",
    "PATHEXT",
  ];
  return Object.fromEntries(allowed.flatMap((name) => {
    const value = environment[name];
    return typeof value === "string" && value ? [[name, value]] : [];
  }));
}

function invokePowerShell(executable, signal, environment, execFileImpl) {
  const encoded = Buffer.from(LOCATION_SCRIPT, "utf16le").toString("base64");
  return new Promise((resolve) => {
    execFileImpl(
      executable,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        encoding: "utf8",
        env: childEnvironment(environment),
        maxBuffer: MAX_OUTPUT_BYTES,
        shell: false,
        signal,
        timeout: PROCESS_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        const output = typeof stdout === "string" ? stdout : "";
        if (error && !output) {
          resolve({
            state: "unavailable",
            reason: "Breadboard could not reach the Windows location service.",
          });
          return;
        }
        resolve(parseSystemLocationWorkerOutput(output));
      },
    );
  });
}

export async function executeSystemLocationOperation(
  launch,
  signal,
  options = {},
) {
  validateSystemLocationExecutionScope(launch.executionScope);
  validateSystemLocationRequest(launch.request);
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return {
      state: "unsupported",
      reason: "This system has no location service Breadboard can read.",
    };
  }
  const environment = options.environment ?? process.env;
  const executable = trustedPowerShell(environment);
  return invokePowerShell(
    executable,
    signal,
    environment,
    options.execFileImpl ?? execFile,
  );
}

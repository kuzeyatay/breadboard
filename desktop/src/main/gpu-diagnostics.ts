/**
 * Minimal structured Electron/Chromium process diagnostics.
 *
 * When the workstation ran out of committed memory, Chromium's GPU process
 * exited with code 34 and the only record of it was a console line nobody
 * keeps. These hooks write the same facts into the bounded, redacted
 * `desktop.log` so a future incident can be told apart from a genuine graphics
 * fault without reproducing it.
 *
 * Deliberately observational: hardware acceleration and GPU selection are left
 * exactly as they are.
 */

export interface ChildProcessGoneDetails {
  type: string;
  reason: string;
  exitCode: number;
  serviceName?: string | undefined;
  name?: string | undefined;
}

/**
 * The subset of Electron's `app` this module needs, expressed as subscriptions
 * rather than an overloaded `on` so tests can supply a plain object.
 */
export interface GpuDiagnosticsHost {
  onChildProcessGone(listener: (details: ChildProcessGoneDetails) => void): void;
  getGPUFeatureStatus(): Record<string, unknown>;
  getGPUInfo(mode: "basic"): Promise<unknown>;
}

/** Cap on the diagnostic line length; a GPU info blob can be very large. */
const MAX_DIAGNOSTIC_CHARS = 800;

function bounded(value: string): string {
  return value.length <= MAX_DIAGNOSTIC_CHARS
    ? value
    : `${value.slice(0, MAX_DIAGNOSTIC_CHARS)}…(truncated)`;
}

/**
 * Adapter identity only. `getGPUInfo("basic")` returns vendor/device ids and
 * driver strings; nothing user-identifying, but it is still filtered down to a
 * known set of fields rather than serialized wholesale.
 */
export function describeGpuAdapter(info: unknown): string {
  if (typeof info !== "object" || info === null) return "unavailable";
  const record = info as Record<string, unknown>;
  const devices = Array.isArray(record["gpuDevice"]) ? record["gpuDevice"] : [];
  const parts: string[] = [];
  for (const device of devices.slice(0, 2)) {
    if (typeof device !== "object" || device === null) continue;
    const entry = device as Record<string, unknown>;
    const fields = ["vendorId", "deviceId", "driverVendor", "driverVersion", "active"]
      .map((key) => (key in entry ? `${key}=${String(entry[key])}` : null))
      .filter((value): value is string => value !== null);
    if (fields.length > 0) parts.push(`{${fields.join(" ")}}`);
  }
  return bounded(parts.length > 0 ? parts.join(" ") : "unavailable");
}

/** One line summarising Chromium's feature status map. */
export function describeGpuFeatureStatus(status: Record<string, unknown>): string {
  const entries = Object.entries(status)
    .map(([feature, state]) => `${feature}=${String(state)}`)
    .sort();
  return bounded(entries.join(" ") || "unavailable");
}

export function describeChildProcessGone(details: ChildProcessGoneDetails): string {
  const parts = [
    `type=${details.type}`,
    `reason=${details.reason}`,
    `exitCode=${details.exitCode}`,
  ];
  if (details.serviceName) parts.push(`service=${details.serviceName}`);
  if (details.name) parts.push(`name=${details.name}`);
  return bounded(parts.join(" "));
}

/**
 * Subscribe to Chromium child-process failures and record the GPU baseline
 * once. `write` is the supervisor's existing bounded, redacted log writer.
 */
export function installGpuDiagnostics(
  host: GpuDiagnosticsHost,
  write: (line: string) => void,
): void {
  host.onChildProcessGone((details) => {
    try {
      write(`[desktop] chromium child process gone: ${describeChildProcessGone(details)}`);
      if (details.type === "GPU") {
        write(
          `[desktop] gpu feature status: ${describeGpuFeatureStatus(host.getGPUFeatureStatus())}`,
        );
      }
    } catch {
      // Diagnostics must never take the app down.
    }
  });

  // Baseline, recorded once at startup so a later failure has something to be
  // compared against.
  try {
    write(`[desktop] gpu feature status: ${describeGpuFeatureStatus(host.getGPUFeatureStatus())}`);
  } catch {
    // Ignore.
  }
  void (async () => {
    try {
      write(`[desktop] gpu adapter: ${describeGpuAdapter(await host.getGPUInfo("basic"))}`);
    } catch {
      // `getGPUInfo` rejects on some headless/software configurations.
    }
  })();
}

/**
 * Keeping the GPU process — and with it the window and every WebGL canvas —
 * alive on a machine whose driver keeps taking it down.
 *
 * `gpu-diagnostics.ts` is deliberately observational: it records what Chromium
 * decided. This module is the other half; it decides.
 *
 * The evidence is in `desktop.log`: `chromium child process gone: type=GPU
 * reason=crashed exitCode=2`, twice inside ninety seconds, with the feature
 * status showing a fully healthy GPU right up to the moment it died. When the
 * GPU process goes, the compositor has nothing to paint into and the window
 * stops responding, and every live WebGL context on the page is lost — which
 * is what a blank shader preview looks like from the outside.
 *
 * Chromium restarts the GPU process a few times and then falls back to
 * software for the rest of the session, so the app eventually recovers on its
 * own. This makes that recovery happen at the start of the *next* launch
 * instead of after several freezes:
 *
 * - Every GPU-process crash is recorded, with a rolling window.
 * - Once the crashes are a pattern rather than an incident, the next launch
 *   pins ANGLE to SwiftShader, so Chromium stops handing work to the driver
 *   that keeps dying. Measured on this machine, WebGL and WebGL2 both stay
 *   available under that switch — the pages keep working, the freezes stop.
 * - The record is pruned on the window, so a driver update quietly restores
 *   hardware acceleration without anyone clearing state by hand.
 *
 * `enable-unsafe-swiftshader` rides along on every launch. It is the
 * embedder's opt-in to a software GL backend, which Chromium has been moving
 * toward requiring; on this Electron version software WebGL is still granted
 * without it, so today it is insurance rather than a fix. It costs nothing on
 * a healthy GPU, which never reaches the software path at all.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandLine } from "electron";

const STATE_FILE = "gpu-state.json";

/** Crashes older than this stop counting; a fixed driver earns its GPU back. */
export const GPU_CRASH_WINDOW_MS = 24 * 60 * 60 * 1_000;

/**
 * Software rendering is slower, so it is a last resort, not a first response.
 * One crash is ordinary — a machine waking from sleep, a driver replaced under
 * the running app. Two is the burst Chromium already recovers from by itself.
 * Three inside a day means the driver is not going to settle, and a slower
 * renderer beats another frozen window.
 */
export const GPU_CRASH_SOFTWARE_THRESHOLD = 3;

/** Bound on the retained history so a crash loop cannot grow the file. */
const MAX_RECORDED_CRASHES = 16;

export interface GpuState {
  /** Epoch milliseconds of recent GPU-process crashes, oldest first. */
  readonly crashes: readonly number[];
}

export const EMPTY_GPU_STATE: GpuState = { crashes: [] };

/**
 * Tolerant parse: this file is advisory. Anything unreadable, truncated by a
 * power cut, or hand-edited is treated as "no history" rather than as a reason
 * to fail the launch.
 */
export function parseGpuState(raw: unknown): GpuState {
  if (typeof raw !== "object" || raw === null) return EMPTY_GPU_STATE;
  const candidate = (raw as { crashes?: unknown }).crashes;
  if (!Array.isArray(candidate)) return EMPTY_GPU_STATE;
  const crashes = candidate
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)
    .slice(-MAX_RECORDED_CRASHES);
  return { crashes };
}

/** Drop crashes that have aged out of the window. */
export function recentCrashes(state: GpuState, now: number): readonly number[] {
  return state.crashes.filter((at) => now - at < GPU_CRASH_WINDOW_MS && at <= now);
}

export function prefersSoftwareGl(state: GpuState, now: number): boolean {
  return recentCrashes(state, now).length >= GPU_CRASH_SOFTWARE_THRESHOLD;
}

export function withGpuCrash(state: GpuState, now: number): GpuState {
  return {
    crashes: [...recentCrashes(state, now), now].slice(-MAX_RECORDED_CRASHES),
  };
}

export interface GpuSwitch {
  readonly name: string;
  readonly value?: string;
}

/**
 * The switches this launch should carry. Pure, so the decision can be asserted
 * without starting Chromium.
 */
export function gpuSwitches(state: GpuState, now: number): GpuSwitch[] {
  const switches: GpuSwitch[] = [
    // The embedder's opt-in to software GL. Unused while the GPU is healthy,
    // and insurance for the day Chromium starts requiring it before handing a
    // software-backed context to a page.
    { name: "enable-unsafe-swiftshader" },
  ];
  if (prefersSoftwareGl(state, now)) {
    // Stop feeding the driver that keeps taking the GPU process down with it.
    switches.push({ name: "use-angle", value: "swiftshader" });
  }
  return switches;
}

function stateFilePath(userDataDir: string): string {
  return path.join(userDataDir, STATE_FILE);
}

export function readGpuState(userDataDir: string): GpuState {
  try {
    return parseGpuState(JSON.parse(fs.readFileSync(stateFilePath(userDataDir), "utf8")));
  } catch {
    // No history, or history we cannot read. Either way: start from nothing.
    return EMPTY_GPU_STATE;
  }
}

export function writeGpuState(userDataDir: string, state: GpuState): void {
  const file = stateFilePath(userDataDir);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    // Losing the record costs a repeat of the fallback decision next launch,
    // which is not worth failing a startup — or a crash handler — over.
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Nothing further to do.
    }
  }
}

/**
 * Apply this launch's GPU switches. Must run before Chromium starts, i.e.
 * before `app.whenReady()`, alongside the other pre-ready switch setup.
 *
 * Returns whether this launch is pinned to software GL so the caller can say
 * so in the log.
 */
export function configureGpuPreferences(
  commandLine: Pick<CommandLine, "appendSwitch">,
  userDataDir: string,
  now: number = Date.now(),
  state: GpuState = readGpuState(userDataDir),
): { softwareGl: boolean; applied: GpuSwitch[] } {
  const applied = gpuSwitches(state, now);
  for (const entry of applied) {
    if (entry.value === undefined) commandLine.appendSwitch(entry.name);
    else commandLine.appendSwitch(entry.name, entry.value);
  }
  return { softwareGl: prefersSoftwareGl(state, now), applied };
}

export function describeGpuSwitches(applied: readonly GpuSwitch[]): string {
  return (
    applied
      .map((entry) => (entry.value === undefined ? `--${entry.name}` : `--${entry.name}=${entry.value}`))
      .join(" ") || "none"
  );
}

export interface GpuCrashRecorderHost {
  onGpuProcessCrash(listener: () => void): void;
}

/**
 * Persist GPU-process crashes as they happen, so the *next* launch can act on
 * them. Chromium has already lost the GPU process by the time this runs —
 * there is nothing to repair in-flight — but a second launch does not have to
 * repeat the experiment.
 */
export function installGpuCrashRecorder(
  host: GpuCrashRecorderHost,
  userDataDir: string,
  write: (line: string) => void,
  now: () => number = Date.now,
): void {
  host.onGpuProcessCrash(() => {
    try {
      const at = now();
      const next = withGpuCrash(readGpuState(userDataDir), at);
      writeGpuState(userDataDir, next);
      if (prefersSoftwareGl(next, at)) {
        write(
          `[desktop] gpu process crashed ${next.crashes.length}x recently; ` +
            "the next launch will render WebGL through SwiftShader",
        );
      }
    } catch {
      // A diagnostic path must never take the app down.
    }
  });
}

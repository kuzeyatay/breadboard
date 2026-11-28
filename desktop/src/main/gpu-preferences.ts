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
 * - Unexpected hardware GPU-process failures are recorded, with a rolling
 *   window. External termination and Windows logoff are not driver failures.
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
import type { ChildProcessGoneDetails } from "./gpu-diagnostics";

const STATE_FILE = "gpu-state.json";
// Version 1 (no version field) counted every non-clean exit, including OS
// shutdown, and cannot tell those apart from real faults: ignored. Version 2
// holds bare timestamps, all of them on the hardware backend. Version 3 tags
// each crash with the backend it happened on.
const STATE_VERSION = 3;

/** Crashes older than this stop counting at all. */
export const GPU_CRASH_WINDOW_MS = 24 * 60 * 60 * 1_000;

/**
 * Leaving the default driver path is a response to a pattern, not an
 * incident. One crash is ordinary — a machine waking from sleep, a driver
 * replaced under the running app. Two is the burst Chromium already recovers
 * from by itself. Three inside a day means that driver path is not going to
 * settle.
 */
export const GPU_CRASH_SOFTWARE_THRESHOLD = 3;

/**
 * The alternate backend is already the second attempt, so it gets less
 * patience before the last resort.
 */
export const GPU_ALTERNATE_CRASH_THRESHOLD = 2;

/**
 * A fallback is re-tested one step closer to the hardware default after this
 * long without a crash, instead of waiting out the whole crash window. A failed
 * test costs one crash, which re-escalates straight away because the earlier
 * crashes still count; a passed test gives the GPU back hours sooner.
 */
export const GPU_RETRY_AFTER_MS = 4 * 60 * 60 * 1_000;

/** Bound on the retained history so a crash loop cannot grow the file. */
const MAX_RECORDED_CRASHES = 16;

/**
 * - hardware: Chromium's default ANGLE backend (Direct3D 11 on Windows).
 * - alternate: the same GPU through a different driver path. On Windows that
 *   is Direct3D 11 on 12, which runs on the D3D12 driver instead of the D3D11
 *   one where these crashes happen. Measured on an AMD laptop: WebGL2, GPU
 *   rasterization and 60 fps all kept. (OpenGL also ran but lost GPU
 *   rasterization; Direct3D 9 lost it and WebGL2 and cost twice the CPU.)
 * - software: SwiftShader, with Chromium's software compositor. Last resort.
 */
export type GpuBackend = "hardware" | "alternate" | "software";

export interface GpuCrash {
  /** Epoch milliseconds. */
  readonly at: number;
  /** The backend the launch was using when its GPU process crashed. */
  readonly backend: Exclude<GpuBackend, "software">;
}

export interface GpuState {
  /** Recent GPU-process crashes, oldest first. */
  readonly crashes: readonly GpuCrash[];
}

export const EMPTY_GPU_STATE: GpuState = { crashes: [] };

/** The alternate ANGLE backend for this platform, if it has a useful one. */
export function alternateAngleBackend(platform: NodeJS.Platform): string | undefined {
  return platform === "win32" ? "d3d11on12" : undefined;
}

function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Tolerant parse: this file is advisory. Anything unreadable, truncated by a
 * power cut, or hand-edited is treated as "no history" rather than as a reason
 * to fail the launch.
 */
export function parseGpuState(raw: unknown): GpuState {
  if (typeof raw !== "object" || raw === null) return EMPTY_GPU_STATE;
  const version = (raw as { version?: unknown }).version;
  const candidate = (raw as { crashes?: unknown }).crashes;
  if (!Array.isArray(candidate)) return EMPTY_GPU_STATE;
  let crashes: GpuCrash[];
  if (version === 2) {
    crashes = candidate.filter(validTime).map((at) => ({ at, backend: "hardware" as const }));
  } else if (version === STATE_VERSION) {
    crashes = candidate.flatMap((entry): GpuCrash[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const { at, backend } = entry as { at?: unknown; backend?: unknown };
      if (!validTime(at) || (backend !== "hardware" && backend !== "alternate")) return [];
      return [{ at, backend }];
    });
  } else {
    return EMPTY_GPU_STATE;
  }
  crashes.sort((left, right) => left.at - right.at);
  return { crashes: crashes.slice(-MAX_RECORDED_CRASHES) };
}

/** Drop crashes that have aged out of the window. */
export function recentCrashes(state: GpuState, now: number): readonly GpuCrash[] {
  return state.crashes.filter((crash) => now - crash.at < GPU_CRASH_WINDOW_MS && crash.at <= now);
}

/**
 * The backend this launch should use. Escalates hardware -> alternate ->
 * software on repeated crashes, and steps back one level for every
 * GPU_RETRY_AFTER_MS without a crash.
 */
export function decideGpuBackend(
  state: GpuState,
  now: number,
  platform: NodeJS.Platform = process.platform,
): GpuBackend {
  const ladder: GpuBackend[] = alternateAngleBackend(platform)
    ? ["hardware", "alternate", "software"]
    : ["hardware", "software"];
  const recent = recentCrashes(state, now);
  if (recent.length === 0) return "hardware";
  const onHardware = recent.filter((crash) => crash.backend === "hardware").length;
  const onAlternate = recent.filter((crash) => crash.backend === "alternate").length;
  let level = 0;
  if (onHardware >= GPU_CRASH_SOFTWARE_THRESHOLD) level = 1;
  // Without an alternate backend, the first escalation is already software.
  if (ladder.length === 3 && onAlternate >= GPU_ALTERNATE_CRASH_THRESHOLD) level = 2;
  const quietFor = now - recent[recent.length - 1]!.at;
  level = Math.max(0, level - Math.floor(quietFor / GPU_RETRY_AFTER_MS));
  return ladder[Math.min(level, ladder.length - 1)]!;
}

export function prefersSoftwareGl(
  state: GpuState,
  now: number,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return decideGpuBackend(state, now, platform) === "software";
}

export function withGpuCrash(
  state: GpuState,
  now: number,
  backend: GpuCrash["backend"] = "hardware",
): GpuState {
  return {
    crashes: [...recentCrashes(state, now), { at: now, backend }].slice(-MAX_RECORDED_CRASHES),
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
export function gpuSwitches(
  state: GpuState,
  now: number,
  platform: NodeJS.Platform = process.platform,
): GpuSwitch[] {
  const switches: GpuSwitch[] = [
    // The embedder's opt-in to software GL. Unused while the GPU is healthy,
    // and insurance for the day Chromium starts requiring it before handing a
    // software-backed context to a page.
    { name: "enable-unsafe-swiftshader" },
    // A video promoted to a hardware overlay outlives its tab's view when the
    // view is detached on a tab switch, and on this NVIDIA/AMD hybrid the stale
    // overlay plane shows as a zeroed YUV surface — a solid green sheet over the
    // whole window, tab strip included, that no click can get past.
    // Chromium 130 accepts this as a driver workaround (underscores), not the
    // removed gl switch (hyphens). The old spelling is silently ignored and
    // never reaches the GPU process. Keep this in sync with Chromium's
    // gpu/config/gpu_workaround_list.txt; the native test checks the active
    // driverBugWorkarounds, not merely the browser's command line.
    { name: "disable_direct_composition_video_overlays" },
  ];
  const backend = decideGpuBackend(state, now, platform);
  const alternate = alternateAngleBackend(platform);
  if (backend === "alternate" && alternate) {
    // Same GPU, different driver path: keeps hardware speed.
    switches.push({ name: "use-angle", value: alternate });
  }
  if (backend === "software") {
    // Stop feeding the driver that keeps taking the GPU process down with it.
    switches.push({ name: "use-angle", value: "swiftshader" });
    // ANGLE on SwiftShader alone leaves GPU compositing "enabled", so every
    // frame of every window is composited by an emulated GPU. The animated,
    // blurred 3-D startup scene then cost 1.5-12 cores (617 CPU-seconds in the
    // first minute) and on a four-core laptop the window stayed dark at ~90%
    // CPU without ever painting. Chromium's own software compositor draws the
    // same scene at 60 fps for 23 CPU-seconds; WebGL still gets SwiftShader.
    switches.push({ name: "disable-gpu-compositing" });
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
    fs.writeFileSync(tmp, JSON.stringify({ version: STATE_VERSION, crashes: state.crashes }), { encoding: "utf8", mode: 0o600 });
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
 * Returns the backend this launch uses so the caller can say so in the log
 * and charge any crash to it.
 */
export function configureGpuPreferences(
  commandLine: Pick<CommandLine, "appendSwitch" | "getSwitchValue">,
  userDataDir: string,
  now: number = Date.now(),
  state: GpuState = readGpuState(userDataDir),
  platform: NodeJS.Platform = process.platform,
): { backend: GpuBackend; softwareGl: boolean; applied: GpuSwitch[] } {
  const backend = decideGpuBackend(state, now, platform);
  const applied = gpuSwitches(state, now, platform);
  if (platform === "win32") {
    // In Electron 33 an occluded WebContentsView can hide its native child
    // HWND while backgroundThrottling:false keeps its renderer "visible".
    // Uncovering it then skips the shown transition that restores the HWND.
    // Let TabManager own view visibility; other apps covering the top-level
    // window must not hide the selected tab. Detached tabs still throttle.
    const disabled = commandLine.getSwitchValue("disable-features").split(",").filter(Boolean);
    const feature = "CalculateNativeWinOcclusion";
    if (!disabled.some(entry => entry.trim().split("<")[0] === feature)) {
      applied.push({ name: "disable-features", value: [...disabled, feature].join(",") });
    }
  }
  for (const entry of applied) {
    if (entry.value === undefined) commandLine.appendSwitch(entry.name);
    else commandLine.appendSwitch(entry.name, entry.value);
  }
  return { backend, softwareGl: backend === "software", applied };
}

export function describeGpuSwitches(applied: readonly GpuSwitch[]): string {
  return (
    applied
      .map((entry) => (entry.value === undefined ? `--${entry.name}` : `--${entry.name}=${entry.value}`))
      .join(" ") || "none"
  );
}

export interface GpuCrashRecorderHost {
  onChildProcessGone(listener: (details: ChildProcessGoneDetails) => void): void;
  /**
   * The backend to charge a crash to, or null when crashes must not count:
   * while quitting, and on software rendering, which has no driver to blame
   * and must not renew its own fallback.
   */
  recordingBackend(): GpuCrash["backend"] | null;
}

/** A terminated process says nothing about the health of the graphics driver. */
export function isGpuDriverFailure(details: ChildProcessGoneDetails): boolean {
  if (details.type !== "GPU" || !["crashed", "abnormal-exit"].includes(details.reason)) return false;
  // Electron can report these NTSTATUS values as crashes, including when
  // Windows kills the old GPU process and a replacement starts during logoff.
  // Normalize signed/unsigned Windows exit codes before comparing.
  const code = details.exitCode >>> 0;
  return code !== 0 &&
    code !== 0xc000026b && // STATUS_DLL_INIT_FAILED_LOGOFF
    code !== 0xc000013a && // STATUS_CONTROL_C_EXIT
    code !== 0xc000010a && // STATUS_PROCESS_IS_TERMINATING
    code !== 0xc000012d;   // STATUS_COMMITMENT_LIMIT (system memory pressure)
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
  platform: NodeJS.Platform = process.platform,
): void {
  host.onChildProcessGone((details) => {
    try {
      const backend = host.recordingBackend();
      if (!backend || !isGpuDriverFailure(details)) return;
      const at = now();
      const next = withGpuCrash(readGpuState(userDataDir), at, backend);
      writeGpuState(userDataDir, next);
      const nextBackend = decideGpuBackend(next, at, platform);
      if (nextBackend !== backend) {
        write(
          `[desktop] gpu process crashed ${next.crashes.length}x recently; ` +
            (nextBackend === "software"
              ? "the next launch will render WebGL through SwiftShader"
              : `the next launch will try the ${alternateAngleBackend(platform)} graphics backend`),
        );
      }
    } catch {
      // A diagnostic path must never take the app down.
    }
  });
}

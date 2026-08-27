// Locating the Vox Director clone and the toolchain a production needs.
//
// The clone is shape 2 in `docs/ADDING_AN_AGENT.md`: a skill, a reference
// library and a pile of scripts, with no runtime of its own. What it really
// contributes is the creative method (`SKILL.md`, `references/`) and one piece
// of working software — the local keyframe engine in `scripts/motion.py`, plus
// the collage prompt composer in `scripts/styles.py`, the caption renderer in
// `scripts/text_overlay.py` and the ffmpeg assembly in `scripts/assemble.py`.
// Those four are pure Python + Pillow + ffmpeg, so the whole local path needs
// an interpreter, Pillow, and the ffmpeg this repository already ships.
//
// Everything upstream that reaches api.atlascloud.ai lives behind
// `scripts/provider.py`, and nothing here imports it. That is what makes the
// integration key-free rather than merely key-optional.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import { resolveFfmpeg } from "../vimax/video.ts";

export interface VoxDirectorRuntime {
  /** Directory of the cloned repository. */
  root: string;
  /** How it was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

/** Fixed ffprobe resolution for this profile; importing Video Use's dashboard
 * health module here would pull its Runtime client back into worker helpers. */
export function resolveVoxFfprobe(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit =
    configured(env.BREADBOARD_RUNTIME_V2_VOX_FFPROBE_PATH) ||
    configured(env.BREADBOARD_RUNTIME_V2_MEDIA_FFPROBE_PATH) ||
    configured(env.VIDEO_USE_FFPROBE_PATH) ||
    configured(env.HYPERFRAMES_FFPROBE_PATH);
  if (explicit && fs.existsSync(explicit)) return explicit;
  const root = repositoryRoot();
  for (const candidate of [
    path.join(root, "desktop", "resources", "bin", executableName("ffprobe")),
    path.join(root, "agent-reach", ".tools", "bin", executableName("ffprobe")),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * A directory is the Vox Director clone when the skill and the two scripts the
 * local path actually executes are all there. Checking `SKILL.md` alone would
 * call a half-cloned directory healthy, which is exactly what section 19 of
 * `docs/ADDING_AN_AGENT.md` warns against.
 */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "SKILL.md")) &&
    fs.existsSync(path.join(candidate, "scripts", "motion.py")) &&
    fs.existsSync(path.join(candidate, "scripts", "styles.py")) &&
    fs.existsSync(path.join(candidate, "scripts", "assemble.py")) &&
    fs.existsSync(path.join(candidate, "references", "prompt-guide.md"))
  );
}

export function resolveVoxDirectorRoot(
  env: NodeJS.ProcessEnv = process.env,
): VoxDirectorRuntime | null {
  const candidates: Array<{ root: string; source: VoxDirectorRuntime["source"] }> = [];
  const explicit = configured(env.VOX_DIRECTOR_ROOT);
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({ root: path.join(repositoryRoot(), "vox-director"), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), "vox-director"), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", "vox-director"), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

/** The reference files the planning prompts quote from. */
export function referenceFile(root: string, name: string): string {
  return path.join(root, "references", name);
}

/**
 * The Python that runs the driver. A virtualenv inside the clone wins when one
 * exists. Installed Runtime profiles always mint an explicit interpreter;
 * discovery by `where`/`which` is deliberately outside the worker contract.
 */
export function resolvePython(
  root: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = configured(env.VOX_DIRECTOR_PYTHON);
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (root) {
    const venv =
      process.platform === "win32"
        ? path.join(root, ".venv", "Scripts", "python.exe")
        : path.join(root, ".venv", "bin", "python");
    if (fs.existsSync(venv)) return venv;
  }
  return null;
}

/** Breadboard's own driver, which imports the clone's engine rather than copying it. */
export function driverScript(): string {
  return path.join(repositoryRoot(), "dashboard", "scripts", "vox_local.py");
}

/**
 * Environment for a spawned driver.
 *
 * ffmpeg's directory goes to the front of PATH because upstream's own scripts
 * shell out to a bare `ffmpeg`/`ffprobe`, and Python is forced into UTF-8: the
 * clone prints `·` and `→` in its progress lines, which on a Windows console
 * defaulting to cp1252 raises UnicodeEncodeError and kills a render that was
 * otherwise fine.
 */
export function voxDirectorEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const ffmpeg = resolveFfmpeg(env);
  const ffprobe = resolveVoxFfprobe(env);
  const binDirectories = [
    ffmpeg ? path.dirname(ffmpeg) : "",
    ffprobe ? path.dirname(ffprobe) : "",
  ].filter(Boolean);
  const answer: NodeJS.ProcessEnv = {
    NODE_ENV: env.NODE_ENV ?? "production",
    PATH: [...new Set(binDirectories)].join(path.delimiter),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    // Upstream's stage scripts read this to pick a media backend. Nothing in
    // the local path uses a provider at all, and saying so keeps a future
    // upstream default from silently reaching for Atlas Cloud.
    VOX_PROVIDER: "none",
  };
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME"]) {
    const value = env[name]?.trim();
    if (value && !/[\u0000\r\n]/u.test(value)) answer[name] = value;
  }
  return answer;
}

export interface DriverResult {
  ok: boolean;
  code: number | null;
  /** Whatever the driver printed on stdout, which is JSON on success. */
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run one bounded driver operation.
 *
 * Arguments are an array, never a command line: everything interesting here —
 * a poster path, an element name, a beat's headline — began life as model
 * output, and a shell would be one quoting mistake away from executing it.
 * Nothing a model produced is ever passed as a flag either; the driver reads a
 * JSON spec file the caller wrote, inside the run's own workspace.
 */
export function runVoxDriver(input: {
  python: string;
  operation: string;
  specPath: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}): Promise<DriverResult> {
  if (input.signal?.aborted) {
    return Promise.resolve({
      ok: false,
      code: null,
      stdout: "",
      stderr: "The render was cancelled.",
      timedOut: false,
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(
      input.python,
      [driverScript(), input.operation, input.specPath],
      {
        cwd: input.cwd,
        windowsHide: true,
        env: voxDirectorEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        // Its own process group, so an abort can take the ffmpeg the driver
        // pipes frames into rather than leaving an encoder on the output file.
        detached: process.platform !== "win32",
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-400_000);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-40_000);
      if (input.onLine) {
        for (const line of chunk.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) input.onLine(trimmed);
        }
      }
    });

    const kill = () => {
      try {
        killTree(child.pid);
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, input.timeoutMs);
    timer.unref?.();
    const onAbort = () => kill();
    input.signal?.addEventListener("abort", onAbort);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut });
    };
    child.on("error", (error) => {
      stderr = `${stderr}\n${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

/**
 * Kill a spawned driver and anything it started.
 *
 * The driver pipes raw frames into an ffmpeg child, so killing only the Python
 * would leave an encoder holding the output file. `taskkill /T` is the reliable
 * way to take the tree on Windows; elsewhere the process group serves.
 */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    const windowsRoot = process.env.SystemRoot?.trim() || process.env.WINDIR?.trim() || "C:\\Windows";
    const taskkill = path.join(windowsRoot, "System32", "taskkill.exe");
    spawnSync(taskkill, ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      env: voxDirectorEnv(),
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

export type VoxHealthLevel = "ready" | "degraded" | "unavailable";

export interface VoxDirectorHealth {
  status: VoxHealthLevel;
  /** Ready to produce a film right now, in some form. */
  available: boolean;
  voxDirectorClone: string | null;
  python: string | null;
  pillow: boolean;
  ffmpeg: string | null;
  ffprobe: string | null;
  chatmock: boolean;
  comfyui: { state: string; message: string; checkpoint: string | null };
  tts: { available: boolean; voice: string | null; reason: string };
  /** What is missing, in the order it would stop a run. */
  blocking: string[];
  degraded: string[];
}

/**
 * Three states, and the distinction is the whole point of the health endpoint.
 *
 * `unavailable` means no film comes out at all — no clone, no Python, no
 * ffmpeg, no voice. `degraded` means a film comes out but not as asked: no
 * ComfyUI, so the posters are the deterministic title cards. `ready` means
 * every piece of the intended path is present. A cloned directory existing is
 * never on its own a reason to report anything but what was actually probed.
 */
export function voxHealthLevel(input: {
  blocking: readonly string[];
  degraded: readonly string[];
}): VoxHealthLevel {
  if (input.blocking.length) return "unavailable";
  if (input.degraded.length) return "degraded";
  return "ready";
}

/**
 * Does Pillow import in this interpreter?
 *
 * Asynchronous and cached by the caller: starting a Python costs seconds, and
 * `spawnSync` would stop the whole event loop — including the endpoint that
 * aborts a run — for the duration.
 */
export function probePillow(
  python: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(python, ["-c", "import PIL"], {
        windowsHide: true,
        stdio: "ignore",
        env: voxDirectorEnv(),
      });
      const onAbort = () => {
        killTree(child.pid);
        done(false);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        killTree(child.pid);
        done(false);
      }, timeoutMs);
      timer.unref?.();
      child.on("error", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        done(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        done(code === 0);
      });
    } catch {
      done(false);
    }
  });
}

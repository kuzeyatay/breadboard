// Locating the video-use clone and the toolchain a render needs.
//
// The clone is shape 2 in `docs/ADDING_AN_AGENT.md`: a skill and a pile of
// scripts with no runtime of its own. Breadboard drives it. What the clone
// actually contributes is `helpers/render.py` and `helpers/grade.py` — the cut
// craft, the per-segment extract, the 30ms fades, the auto-grade analysis, the
// loudness pass — and those two are pure Python standard library. That is a
// happy accident worth designing around: the editing core needs a Python and an
// ffmpeg and nothing else. No virtualenv, no package resolution, no first-run
// download standing between someone and their first cut.
//
// The two helpers that *do* have dependencies are optional and gated:
// `transcribe.py` wants `requests` and a hosted key (speech comes from the
// local engines in `speech.ts` instead, so the script is never run) and
// `timeline_view.py` wants numpy and Pillow (visual QC, offered from settings,
// never required by a run).
//
// ffmpeg is resolved from the copies this repository already ships rather than
// asking the machine to have one, and its directory goes to the front of PATH
// for the spawned Python — the clone's scripts shell out to a bare `ffmpeg`.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import { resolveFfmpeg } from "../vimax/video.ts";

export interface VideoUseRuntime {
  /** Directory of the cloned repository. */
  root: string;
  /** How it was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface VideoUseHealth {
  /** Ready to edit a video right now. */
  available: boolean;
  cloned: boolean;
  root: string | null;
  python: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
  reason: string | null;
}

const HEALTH_CACHE_MS = 20_000;
const VISUAL_QC_CACHE_MS = 10 * 60_000;
const WHICH_CACHE_MS = 5 * 60_000;
let cachedHealth: { at: number; value: VideoUseHealth } | null = null;
let cachedVisualQc: { at: number; value: boolean } | null = null;
// `where`/`which` is a process spawn, and health runs on the path of every run.
// The answer does not change between requests.
const cachedWhich = new Map<string, { at: number; value: string | null }>();

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function whichSync(command: string): string | null {
  const hit = cachedWhich.get(command);
  if (hit && Date.now() - hit.at < WHICH_CACHE_MS) return hit.value;
  const value = probeWhich(command);
  cachedWhich.set(command, { at: Date.now(), value });
  return value;
}

function probeWhich(command: string): string | null {
  try {
    const probe = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
      encoding: "utf8",
      windowsHide: true,
    });
    const first = (probe.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first && fs.existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

/** A directory is the video-use clone when its skill and its helpers are there. */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "SKILL.md")) &&
    fs.existsSync(path.join(candidate, "helpers", "render.py")) &&
    fs.existsSync(path.join(candidate, "helpers", "grade.py"))
  );
}

export function resolveVideoUseRoot(
  env: NodeJS.ProcessEnv = process.env,
): VideoUseRuntime | null {
  const candidates: Array<{ root: string; source: VideoUseRuntime["source"] }> = [];
  const explicit = configured(env.VIDEO_USE_ROOT);
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  const name = "video-use";
  candidates.push({ root: path.join(repositoryRoot(), name), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), name), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", name), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

export function helperScript(root: string, name: string): string {
  return path.join(root, "helpers", name);
}

/**
 * The Python that runs the helpers. A virtualenv inside the clone wins when one
 * exists (someone may have run `uv sync` for the optional visual QC), otherwise
 * any interpreter on PATH will do, because the render path is standard library.
 */
export function resolvePython(
  root: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = configured(env.VIDEO_USE_PYTHON);
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (root) {
    const venv =
      process.platform === "win32"
        ? path.join(root, ".venv", "Scripts", "python.exe")
        : path.join(root, ".venv", "bin", "python");
    if (fs.existsSync(venv)) return venv;
  }
  for (const command of process.platform === "win32"
    ? ["python", "python3", "py"]
    : ["python3", "python"]) {
    const found = whichSync(command);
    if (found) return found;
  }
  return null;
}

export function resolveFfprobe(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.VIDEO_USE_FFPROBE_PATH ?? env.HYPERFRAMES_FFPROBE_PATH);
  if (explicit && fs.existsSync(explicit)) return explicit;
  const root = repositoryRoot();
  const candidates = [
    path.join(root, "desktop", "resources", "bin", executableName("ffprobe")),
    path.join(root, "agent-reach", ".tools", "bin", executableName("ffprobe")),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return whichSync("ffprobe");
}

/**
 * Environment for a spawned helper.
 *
 * Two things matter here. ffmpeg's directory goes to the front of PATH because
 * every helper shells out to a bare `ffmpeg`/`ffprobe`. And Python is forced
 * into UTF-8: the helpers print `→` in their progress lines, which on a Windows
 * console defaulting to cp1252 raises `UnicodeEncodeError` and kills the render
 * before it has extracted a single segment.
 */
export function videoUseEnv(
  extra: Record<string, string> = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const ffmpeg = resolveFfmpeg(env);
  const ffprobe = resolveFfprobe(env);
  const binDirectories = [
    ffmpeg ? path.dirname(ffmpeg) : "",
    ffprobe ? path.dirname(ffprobe) : "",
  ].filter(Boolean);
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const existing = env[pathKey] ?? "";
  return {
    ...env,
    [pathKey]: [...new Set(binDirectories)].concat(existing || []).join(path.delimiter),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    ...extra,
  };
}

/**
 * Do numpy and Pillow import, so the optional filmstrip helper can run?
 *
 * Asynchronous, and deliberately not part of `videoUseHealth`. Starting a
 * Python interpreter costs seconds, and `spawnSync` does not merely make the
 * caller wait — it stops the whole event loop, so a health check on the path of
 * every run froze the server for everything else, including the endpoint that
 * stops the run. Nothing here is needed to edit a video; only the settings panel
 * asks, and it asks off the hot path.
 */
export function probeVisualQc(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const cached = cachedVisualQc;
  if (cached && Date.now() - cached.at < VISUAL_QC_CACHE_MS) {
    return Promise.resolve(cached.value);
  }
  const python = resolvePython(resolveVideoUseRoot(env)?.root ?? null, env);
  if (!python) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      cachedVisualQc = { at: Date.now(), value };
      resolve(value);
    };
    try {
      const child = spawn(python, ["-c", "import numpy, PIL"], {
        windowsHide: true,
        stdio: "ignore",
      });
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
        done(false);
      }, 30_000);
      timer.unref?.();
      child.on("error", () => {
        clearTimeout(timer);
        done(false);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done(code === 0);
      });
    } catch {
      done(false);
    }
  });
}

export function invalidateHealth(): void {
  cachedHealth = null;
  cachedVisualQc = null;
  cachedWhich.clear();
}

export function videoUseHealth(env: NodeJS.ProcessEnv = process.env): VideoUseHealth {
  const now = Date.now();
  if (cachedHealth && now - cachedHealth.at < HEALTH_CACHE_MS) return cachedHealth.value;

  const runtime = resolveVideoUseRoot(env);
  const root = runtime?.root ?? null;
  const python = resolvePython(root, env);
  const ffmpeg = resolveFfmpeg(env);
  const ffprobe = resolveFfprobe(env);

  const reasons: string[] = [];
  if (!root) reasons.push("The video-use clone was not found next to the dashboard.");
  if (!python) reasons.push("No Python interpreter was found.");
  if (!ffmpeg) reasons.push("No ffmpeg was found.");
  if (!ffprobe) reasons.push("No ffprobe was found.");

  const value: VideoUseHealth = {
    available: Boolean(root && python && ffmpeg && ffprobe),
    cloned: Boolean(root),
    root,
    python,
    ffmpeg,
    ffprobe,
    reason: reasons.length ? reasons.join(" ") : null,
  };
  cachedHealth = { at: now, value };
  return value;
}

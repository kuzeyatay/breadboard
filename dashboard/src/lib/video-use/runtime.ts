// Locating the Video Use clone and reporting the sealed media toolchain.
//
// Health checks are filesystem-only. The one executable probe the settings UI
// asks for (numpy/Pillow visual QC) is a finite speech/media Runtime job, never
// a dashboard-owned Python process.

import path from "node:path";

import {
  externalRuntimePathExists,
  externalRuntimeStat,
} from "../external-runtime-filesystem.ts";
import {
  probeVideoVisualQcViaRuntime,
  type SpeechMediaRuntimeScope,
} from "../runtime-v2/speech-media-job.ts";
import { repositoryRoot } from "../runtime-paths.ts";

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
let cachedHealth: { at: number; value: VideoUseHealth } | null = null;
let cachedVisualQc: { at: number; value: boolean } | null = null;

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function existingFile(candidates: readonly (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = path.resolve(candidate);
      if (externalRuntimeStat(resolved).isFile()) return resolved;
    } catch {
      // The candidate is absent or inaccessible.
    }
  }
  return null;
}

function executableOnPath(
  names: readonly string[],
  env: NodeJS.ProcessEnv,
): string | null {
  const pathValue = Object.entries(env).find(([name]) => name.toLowerCase() === "path")?.[1] ?? "";
  const extensions = process.platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const candidates: string[] = [];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      if (process.platform !== "win32" || path.extname(name)) {
        candidates.push(path.join(directory, name));
      } else {
        for (const extension of extensions) candidates.push(path.join(directory, `${name}${extension}`));
      }
    }
  }
  return existingFile(candidates);
}

/** A directory is the Video Use clone when its skill and its helpers are there. */
export function isClone(candidate: string): boolean {
  return (
    externalRuntimePathExists(path.join(candidate, "SKILL.md")) &&
    externalRuntimePathExists(path.join(candidate, "helpers", "render.py")) &&
    externalRuntimePathExists(path.join(candidate, "helpers", "grade.py"))
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
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

export function helperScript(root: string, name: string): string {
  return path.join(root, "helpers", name);
}

/** Resolve only explicit or packaged Python paths; health never shells out to PATH. */
export function resolvePython(
  root: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const venv = root
    ? process.platform === "win32"
      ? path.join(root, ".venv", "Scripts", "python.exe")
      : path.join(root, ".venv", "bin", "python")
    : null;
  return existingFile([
    configured(env.BREADBOARD_RUNTIME_V2_MEDIA_PYTHON_PATH),
    configured(env.VIDEO_USE_PYTHON),
    venv,
  ]) ?? executableOnPath(process.platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"], env);
}

/** Resolve only explicit or packaged ffmpeg paths; process ownership stays in Runtime. */
export function resolveFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  const root = repositoryRoot();
  return existingFile([
    configured(env.BREADBOARD_RUNTIME_V2_MEDIA_FFMPEG_PATH),
    configured(env.VIMAX_FFMPEG_PATH),
    configured(env.HYPERFRAMES_FFMPEG_PATH),
    path.join(root, "desktop", "node_modules", "ffmpeg-static", executableName("ffmpeg")),
    path.join(root, "desktop", "resources", "bin", executableName("ffmpeg")),
    path.join(root, "agent-reach", ".tools", "bin", executableName("ffmpeg")),
  ]) ?? executableOnPath(["ffmpeg"], env);
}

export function resolveFfprobe(env: NodeJS.ProcessEnv = process.env): string | null {
  const root = repositoryRoot();
  return existingFile([
    configured(env.BREADBOARD_RUNTIME_V2_MEDIA_FFPROBE_PATH),
    configured(env.VIDEO_USE_FFPROBE_PATH),
    configured(env.HYPERFRAMES_FFPROBE_PATH),
    path.join(root, "desktop", "resources", "bin", executableName("ffprobe")),
    path.join(root, "agent-reach", ".tools", "bin", executableName("ffprobe")),
  ]) ?? executableOnPath(["ffprobe"], env);
}

/** Does the sealed worker's optional visual-QC Python environment import? */
export async function probeVisualQc(scope: SpeechMediaRuntimeScope): Promise<boolean> {
  const cached = cachedVisualQc;
  if (cached && Date.now() - cached.at < VISUAL_QC_CACHE_MS) return cached.value;
  let value = false;
  try {
    value = await probeVideoVisualQcViaRuntime(scope);
  } catch {
    value = false;
  }
  cachedVisualQc = { at: Date.now(), value };
  return value;
}

export function invalidateHealth(): void {
  cachedHealth = null;
  cachedVisualQc = null;
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

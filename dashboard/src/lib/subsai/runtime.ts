// Locating the subsai clone and the environment it needs.
//
// Unlike video-use, this one cannot run on a bare interpreter. Every backend
// adapter in the clone imports `subsai.utils`, which imports torch — so torch
// is not optional however light a model you pick, and torch pins the
// interpreter to 3.12 or older. The machine's own Python may be newer, so the
// environment is a `uv` venv with its own fetched Python rather than whatever
// is on PATH.
//
// What *is* optional is the model zoo. `configs.py` wraps every backend import
// in `try/except ImportError` and registers only the ones that loaded, so a
// checkout with one backend installed is a working checkout. That is what keeps
// this to one install rather than the union of whisper, whisperX, stable-ts,
// whisper.cpp and Hugging Face transformers.
//
// Nothing here installs anything. A run finds the environment or reports that
// it is missing; building it is a button in settings, because it is gigabytes.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  externalRuntimePathExists,
  externalRuntimeReadUtf8,
} from "../external-runtime-filesystem.ts";
import {
  repositoryRoot,
  runtimeV2ServiceRoot,
  runtimeV2ServiceVenv,
} from "../runtime-paths.ts";

export interface SubsAiRuntime {
  root: string;
  source: "configured" | "repository" | "cwd";
}

export interface SubsAiHealth {
  /** Ready to transcribe right now. */
  available: boolean;
  cloned: boolean;
  root: string | null;
  /** The venv interpreter, when one has been built. */
  python: string | null;
  /** uv is present, so the environment *can* be built. */
  uvAvailable: boolean;
  /** Which backends imported successfully, as the clone itself reports them. */
  models: string[];
  reason: string | null;
}

const HEALTH_CACHE_MS = 30_000;
const WHICH_CACHE_MS = 5 * 60_000;
let cachedHealth: { at: number; value: SubsAiHealth } | null = null;
const cachedWhich = new Map<string, { at: number; value: string | null }>();

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/**
 * Memoized, because `where`/`which` is a process spawn and health is consulted
 * on paths that must not block. (A `spawnSync` on a request path stops the whole
 * event loop, not just that request.)
 */
function whichSync(command: string): string | null {
  const hit = cachedWhich.get(command);
  if (hit && Date.now() - hit.at < WHICH_CACHE_MS) return hit.value;
  let value: string | null = null;
  try {
    const probe = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
    });
    const first = (probe.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    value = first && externalRuntimePathExists(first) ? first : null;
  } catch {
    value = null;
  }
  cachedWhich.set(command, { at: Date.now(), value });
  return value;
}

/** A directory is the subsai clone when its package and CLI are both there. */
export function isClone(candidate: string): boolean {
  return (
    externalRuntimePathExists(path.join(candidate, "src", "subsai", "cli.py")) &&
    externalRuntimePathExists(path.join(candidate, "src", "subsai", "configs.py"))
  );
}

export function resolveSubsAiRoot(env: NodeJS.ProcessEnv = process.env): SubsAiRuntime | null {
  const candidates: Array<{ root: string; source: SubsAiRuntime["source"] }> = [];
  const explicit = configured(env.SUBSAI_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  const name = "subsai";
  candidates.push({ root: path.join(repositoryRoot(), name), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), name), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", name), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

/** The venv interpreter this clone's environment was built into, if it exists. */
export function venvPython(root: string): string | null {
  void root;
  const venv = runtimeV2ServiceVenv("subsai");
  const candidate =
    process.platform === "win32"
      ? path.join(venv, "Scripts", "python.exe")
      : path.join(venv, "bin", "python");
  return externalRuntimePathExists(candidate) ? candidate : null;
}

export function resolveUv(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.UV_PATH);
  if (explicit && externalRuntimePathExists(explicit)) return explicit;
  const bundled = path.join(
    repositoryRoot(),
    "desktop",
    "resources",
    "bin",
    executableName("uv"),
  );
  if (externalRuntimePathExists(bundled)) return bundled;
  return whichSync("uv");
}

/**
 * Which backends the built environment actually has.
 *
 * Recorded by the setup step rather than probed here: asking would mean
 * starting a Python that imports torch, which is seconds, and health is read on
 * paths that must stay cheap.
 */
function recordedModels(root: string): string[] {
  void root;
  try {
    const parsed = JSON.parse(
      externalRuntimeReadUtf8(
        path.join(runtimeV2ServiceVenv("subsai"), "breadboard-models.json"),
      ),
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function recordModels(_root: string, models: readonly string[]): void {
  try {
    fs.writeFileSync(
      path.join(runtimeV2ServiceVenv("subsai"), "breadboard-models.json"),
      `${JSON.stringify([...models], null, 2)}\n`,
      "utf8",
    );
  } catch {
    // The record is a convenience for health; a run asks the clone directly.
  }
}

export function invalidateHealth(): void {
  cachedHealth = null;
  cachedWhich.clear();
}

/** File checks only — never a process spawn. */
export function subsAiHealth(env: NodeJS.ProcessEnv = process.env): SubsAiHealth {
  const now = Date.now();
  if (cachedHealth && now - cachedHealth.at < HEALTH_CACHE_MS) return cachedHealth.value;

  const runtime = resolveSubsAiRoot(env);
  const root = runtime?.root ?? null;
  const python = root ? venvPython(root) : null;
  const uv = resolveUv(env);
  const models = root && python ? recordedModels(root) : [];

  const reasons: string[] = [];
  if (!root) reasons.push("The subsai clone was not found next to the dashboard.");
  else if (!python) {
    reasons.push(
      uv
        ? "Subtitles need an environment of their own. Build it from Video Use's settings."
        : "Subtitles need an environment of their own, and uv was not found to build it.",
    );
  }

  const value: SubsAiHealth = {
    available: Boolean(root && python),
    cloned: Boolean(root),
    root,
    python,
    uvAvailable: Boolean(uv),
    models,
    reason: reasons.length ? reasons.join(" ") : null,
  };
  cachedHealth = { at: now, value };
  return value;
}

/**
 * Environment for a spawned subsai process. ffmpeg's directory goes to the
 * front of PATH — the clone shells out to a bare `ffmpeg` for audio extraction
 * — and Python is forced into UTF-8 so its banner cannot kill a run on a
 * Windows console defaulting to cp1252.
 */
export function subsAiEnv(
  extra: Record<string, string> = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const root = resolveSubsAiRoot(env)?.root ?? null;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const ffmpegDirectory = path.join(repositoryRoot(), "desktop", "resources", "bin");
  return {
    ...env,
    [pathKey]: [ffmpegDirectory, env[pathKey] ?? ""].filter(Boolean).join(path.delimiter),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    // Model weights are large and shared; keep them out of the clone so a
    // rebuilt environment does not re-download them.
    ...(root
      ? {
          HF_HOME:
            env.HF_HOME?.trim() ||
            path.join(runtimeV2ServiceRoot("subsai"), "models"),
        }
      : {}),
    ...extra,
  };
}

// Filesystem status plus first-run preparation. The installer is supplied by
// the Runtime worker; the dashboard only reads the status projection.

import path from "node:path";
import { externalRuntimeReadUtf8 } from "../external-runtime-filesystem.ts";
import {
  resolveHyperframesRoot,
  resolveToolchain,
  runtimeAvailability,
  skillsRoot,
} from "./runtime.ts";
import { installedSkills } from "./prompt.ts";

const FALLBACK_VERSION = "";

export interface ToolchainStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string; skills: number };
  cli: { found: boolean; version: string; source: string; installable: boolean };
  ffmpeg: { found: boolean; path: string; source: string };
  ffprobe: { found: boolean; path: string; source: string };
  browser: { found: boolean; path: string; source: string };
  codex: { found: boolean; version: string };
  /** The version an install would pin to, read from the clone. */
  targetVersion: string;
}

export interface HyperframesCodexStatus {
  found: boolean;
  version: string;
}

/** The CLI version this clone ships, so an install matches the skills. */
export function targetCliVersion(env: NodeJS.ProcessEnv = process.env): string {
  const root = resolveHyperframesRoot(env);
  if (!root) return FALLBACK_VERSION;
  try {
    const manifest = JSON.parse(
      externalRuntimeReadUtf8(path.join(root, "packages", "cli", "package.json")),
    ) as { version?: unknown };
    const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
    return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version) ? version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

/** Called only in the video worker, before scaffolding or starting the model. */
export async function ensureHyperframesToolchain(
  installCli: () => Promise<{ ok: boolean; message: string; detail?: string }>,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
) {
  signal.throwIfAborted();
  let availability = runtimeAvailability(env);
  if (availability.available) return availability.toolchain;
  if (availability.missing.some((piece) => piece !== "cli")) {
    throw new Error(availability.reason);
  }
  if (!targetCliVersion(env)) {
    throw new Error("The HyperFrames source does not declare a pinned CLI version.");
  }
  const installed = await installCli();
  signal.throwIfAborted();
  if (!installed.ok) throw new Error([installed.message, installed.detail?.trim()].filter(Boolean).join("\n"));
  availability = runtimeAvailability(env);
  if (!availability.available) {
    throw new Error("HyperFrames setup finished, but the video toolchain is still unavailable. " + availability.reason);
  }
  return availability.toolchain;
}

/** Build the dashboard projection from filesystem-only checks plus Runtime-owned Codex evidence. */
export function toolchainStatus(
  codex: HyperframesCodexStatus,
  env: NodeJS.ProcessEnv = process.env,
): ToolchainStatus {
  const availability = runtimeAvailability(env);
  const toolchain = resolveToolchain(env);
  const skills = skillsRoot(env);
  const targetVersion = targetCliVersion(env);
  const automaticSetup = Boolean(targetVersion) && availability.missing.length === 1 &&
    availability.missing[0] === "cli";
  const canStart = availability.available || automaticSetup;
  return {
    ready: canStart && codex.found,
    reason: !canStart
      ? availability.missing.length === 1 && availability.missing[0] === "cli" && !targetVersion
        ? "The HyperFrames source does not declare a pinned CLI version."
        : (availability.reason ?? "")
      : codex.found
        ? automaticSetup ? (availability.reason ?? "") : ""
        : "The coding runtime that drives HyperFrames was not found. Install Codex or set CODEX_BIN.",
    clone: {
      found: Boolean(availability.root),
      path: availability.root ?? "",
      skills: skills ? installedSkills(env).length : 0,
    },
    cli: {
      found: toolchain.cli.found,
      version: toolchain.cli.found ? toolchain.cli.version : "",
      source: toolchain.cli.found ? toolchain.cli.source : "",
      installable: Boolean(targetVersion),
    },
    ffmpeg: {
      found: toolchain.ffmpeg.found,
      path: toolchain.ffmpeg.path,
      source: toolchain.ffmpeg.source,
    },
    ffprobe: { ...toolchain.ffprobe },
    browser: {
      found: toolchain.browser.found,
      path: toolchain.browser.path,
      source: toolchain.browser.source,
    },
    codex: { found: codex.found, version: codex.version },
    targetVersion,
  };
}

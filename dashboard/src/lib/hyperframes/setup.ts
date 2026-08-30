// Read-only status for the HyperFrames setup panel and the immutable version
// pin consumed by the Runtime-owned setup worker. Installation deliberately
// does not run in the dashboard process.

import path from "node:path";
import { externalRuntimeReadUtf8 } from "../external-runtime-filesystem.ts";
import {
  resolveHyperframesRoot,
  resolveToolchain,
  runtimeAvailability,
  skillsRoot,
} from "./runtime.ts";
import { installedSkills } from "./prompt.ts";

const FALLBACK_VERSION = "latest";

export interface ToolchainStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string; skills: number };
  cli: { found: boolean; version: string; source: string; installable: boolean };
  ffmpeg: { found: boolean; path: string; source: string };
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
    return /^\d+\.\d+\.\d+/.test(version) ? version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

/** Build the dashboard projection from filesystem-only checks plus Runtime-owned Codex evidence. */
export function toolchainStatus(
  codex: HyperframesCodexStatus,
  env: NodeJS.ProcessEnv = process.env,
): ToolchainStatus {
  const availability = runtimeAvailability(env);
  const toolchain = resolveToolchain(env);
  const skills = skillsRoot(env);
  return {
    ready: availability.available && codex.found,
    reason: !availability.available
      ? (availability.reason ?? "")
      : codex.found
        ? ""
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
      installable: true,
    },
    ffmpeg: {
      found: toolchain.ffmpeg.found,
      path: toolchain.ffmpeg.path,
      source: toolchain.ffmpeg.source,
    },
    browser: {
      found: toolchain.browser.found,
      path: toolchain.browser.path,
      source: toolchain.browser.source,
    },
    codex: { found: codex.found, version: codex.version },
    targetVersion: targetCliVersion(env),
  };
}

// Read-only status for the OpenMontage setup panel. The two fixed installs are
// authenticated Runtime V2 jobs and never launch from the dashboard process.
//
// The panel also reports how many of OpenMontage's 102 tools are actually
// available, because that number is the honest answer to "what can this make?".
// It moves with the toolchain: 14 tools with Python alone, 34 once ffmpeg is
// resolvable (which is what brings in `video_compose`, and with it any way to
// turn a plan into a video), and more with each provider key the person adds.

import { resolveCodexLauncher } from "../codex/run-manager.ts";
import { configuredProviders } from "./prompt.ts";
import {
  resolveToolchain,
  runtimeAvailability,
  toolAvailability,
  type ToolAvailability,
} from "./runtime.ts";

export interface ToolchainStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  python: {
    found: boolean;
    path: string;
    source: string;
    version: string;
    dependencies: boolean;
    installable: boolean;
  };
  ffmpeg: { found: boolean; path: string; source: string };
  ffprobe: { found: boolean; path: string; source: string };
  node: { found: boolean; version: string };
  remotion: { found: boolean; path: string; installable: boolean };
  codex: { found: boolean; version: string };
  tools: ToolAvailability;
  /** Provider keys found in the clone's `.env`, which widen what can be made. */
  providers: string[];
}

export function toolchainStatus(env: NodeJS.ProcessEnv = process.env): ToolchainStatus {
  const availability = runtimeAvailability(env);
  const toolchain = resolveToolchain(env);
  const codex = resolveCodexLauncher(env);
  return {
    ready: availability.available && Boolean(codex),
    reason: !availability.available
      ? (availability.reason ?? "")
      : codex
        ? ""
        : "The coding runtime that drives OpenMontage was not found. Install Codex or set CODEX_BIN.",
    clone: { found: Boolean(availability.root), path: availability.root ?? "" },
    python: {
      found: toolchain.python.found,
      path: toolchain.python.path,
      source: toolchain.python.source,
      version: toolchain.python.version,
      dependencies: toolchain.python.dependencies,
      installable: Boolean(availability.root),
    },
    ffmpeg: toolchain.ffmpeg,
    ffprobe: toolchain.ffprobe,
    node: { found: toolchain.node.found, version: toolchain.node.version },
    remotion: {
      found: toolchain.remotion.found,
      path: toolchain.remotion.path,
      installable: Boolean(availability.root) && toolchain.node.found,
    },
    codex: { found: Boolean(codex), version: codex?.version ?? "" },
    tools: availability.available
      ? toolAvailability(env)
      : { available: 0, total: 0, reason: "Install the dependencies to read the tool registry." },
    providers: configuredProviders(env),
  };
}

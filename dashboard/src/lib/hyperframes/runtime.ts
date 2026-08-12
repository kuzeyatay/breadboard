// Locating the pieces a HyperFrames run needs, and the environment they run in.
//
// HyperFrames is an HTML-to-MP4 framework, not an agent: the clone ships a CLI
// (`init` / `lint` / `check` / `render`) and 19 markdown skills that teach a
// coding agent how to author a composition. Breadboard therefore supplies the
// agent — a Codex process pinned to ChatMock — and this module supplies the
// three external things that process needs on top of Node:
//
//   - the `hyperframes` CLI, which does the rendering;
//   - ffmpeg/ffprobe, which the renderer encodes with;
//   - a Chromium, which the renderer captures frames from.
//
// None of the three are bundled. Each resolves from an explicit environment
// variable first, then from something already on this machine (a built clone, a
// Breadboard-managed npm install, Agent Reach's portable tools, an installed
// Chrome or Edge), so a working install needs no admin rights and no second
// copy of anything.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

export interface HyperframesLauncher {
  /** argv[0] used to invoke the CLI. */
  command: string;
  /** Fixed leading arguments (`[<bin>.mjs]` when the CLI is run through Node). */
  baseArgs: string[];
  /** Reported version, so a stale install is visible in health. */
  version: string;
  /** How it was found — surfaced in health so setup problems are obvious. */
  source: "configured" | "clone" | "managed" | "path";
}

export interface ToolchainPiece {
  found: boolean;
  path: string;
  source: string;
}

export interface HyperframesToolchain {
  cli: (HyperframesLauncher & { found: true }) | { found: false };
  ffmpeg: ToolchainPiece;
  ffprobe: ToolchainPiece;
  browser: ToolchainPiece;
}

export interface RuntimeAvailability {
  available: boolean;
  /** The clone exists, even when nothing has been installed yet. */
  cloned: boolean;
  /** Absolute path of the clone, when it was found. */
  root: string | null;
  toolchain: HyperframesToolchain;
  /** Every missing piece, so the settings panel can list them all at once. */
  missing: string[];
  reason?: string;
}

const VERSION_TIMEOUT_MS = 20_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function firstExisting(candidates: readonly (string | null)[]): string | null {
  return candidates.find((candidate): candidate is string =>
    Boolean(candidate) && fs.existsSync(candidate as string),
  ) ?? null;
}

/** The cloned repository — the source of truth for the skills. */
export function resolveHyperframesRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidates = [
    configured(env.HYPERFRAMES_ROOT),
    path.join(repositoryRoot(), "hyperframes"),
    path.resolve(process.cwd(), "hyperframes"),
    path.resolve(process.cwd(), "..", "hyperframes"),
  ];
  return (
    candidates.find(
      (candidate) =>
        Boolean(candidate) &&
        fs.existsSync(path.join(candidate as string, "skills", "hyperframes", "SKILL.md")),
    ) ?? null
  );
}

/** Where the 19 agent skills live inside the clone. */
export function skillsRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const root = resolveHyperframesRoot(env);
  if (!root) return null;
  const skills = path.join(root, "skills");
  return fs.existsSync(skills) ? skills : null;
}

/**
 * The npm prefix Breadboard installs the CLI into when the clone has not been
 * built. Kept beside the other run data so removing it is a directory delete.
 */
export function managedCliRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.HYPERFRAMES_CLI_ROOT) ?? path.join(dashboardDataDir(), "hyperframes-cli")
  );
}

/** Per-run project workspaces. Durable: a rendered video is a deliverable. */
export function workspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.HYPERFRAMES_WORKSPACE_ROOT) ??
    path.join(dashboardDataDir(), "hyperframes-runs")
  );
}

function cliVersion(command: string, baseArgs: readonly string[]): string | null {
  const probe = spawnSync(command, [...baseArgs, "--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: VERSION_TIMEOUT_MS,
    env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", NO_COLOR: "1" },
  });
  if (probe.error || probe.status !== 0) return null;
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`.trim();
  return output ? output.split(/\r?\n/)[0].slice(0, 120) : "hyperframes";
}

function nodeLauncher(
  entry: string,
  source: HyperframesLauncher["source"],
): HyperframesLauncher | null {
  if (!fs.existsSync(entry)) return null;
  const version = cliVersion(process.execPath, [entry]);
  return version
    ? { command: process.execPath, baseArgs: [entry], version, source }
    : null;
}

/**
 * How to invoke the CLI. A built clone wins over the managed npm install so the
 * CLI and the skills stay the same generation; an explicit `HYPERFRAMES_BIN`
 * wins over both.
 */
export function resolveLauncher(
  env: NodeJS.ProcessEnv = process.env,
): HyperframesLauncher | null {
  const explicit = configured(env.HYPERFRAMES_BIN);
  if (explicit && fs.existsSync(explicit)) {
    const asNode = explicit.endsWith(".mjs") || explicit.endsWith(".js");
    const launcher = asNode
      ? nodeLauncher(explicit, "configured")
      : (() => {
          const version = cliVersion(explicit, []);
          return version
            ? {
                command: explicit,
                baseArgs: [] as string[],
                version,
                source: "configured" as const,
              }
            : null;
        })();
    if (launcher) return launcher;
  }

  const root = resolveHyperframesRoot(env);
  if (root) {
    // The clone's bin script imports ../dist, so it only works once built.
    const built = path.join(root, "packages", "cli", "dist", "cli.js");
    if (fs.existsSync(built)) {
      const launcher = nodeLauncher(path.join(root, "packages", "cli", "bin", "hyperframes.mjs"), "clone");
      if (launcher) return launcher;
    }
  }

  const managed = nodeLauncher(
    path.join(managedCliRoot(env), "node_modules", "hyperframes", "bin", "hyperframes.mjs"),
    "managed",
  );
  if (managed) return managed;

  const onPath = process.platform === "win32" ? "hyperframes.cmd" : "hyperframes";
  const version = cliVersion(onPath, []);
  return version ? { command: onPath, baseArgs: [], version, source: "path" } : null;
}

function whichSync(executable: string): string | null {
  const finder = process.platform === "win32" ? "where" : "which";
  const probe = spawnSync(finder, [executable], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (probe.status !== 0) return null;
  const first = (probe.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return first && fs.existsSync(first) ? first : null;
}

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

/**
 * ffmpeg and ffprobe. Agent Reach already installs portable copies for its own
 * media channels; reusing them means the video agent needs no second download
 * and no package manager.
 */
function resolveFfmpegPiece(
  base: "ffmpeg" | "ffprobe",
  env: NodeJS.ProcessEnv,
): ToolchainPiece {
  const explicit = configured(
    base === "ffmpeg" ? env.HYPERFRAMES_FFMPEG_PATH : env.HYPERFRAMES_FFPROBE_PATH,
  );
  if (explicit && fs.existsSync(explicit)) {
    return { found: true, path: explicit, source: "configured" };
  }
  const shared = path.join(
    repositoryRoot(),
    "agent-reach",
    ".tools",
    "bin",
    executableName(base),
  );
  if (fs.existsSync(shared)) {
    return { found: true, path: shared, source: "agent-reach tools" };
  }
  const onPath = whichSync(base);
  if (onPath) return { found: true, path: onPath, source: "PATH" };
  return { found: false, path: "", source: "" };
}

const WINDOWS_BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const UNIX_BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/**
 * The Chromium the renderer captures frames from. An installed browser is
 * preferred over a Puppeteer download for the same reason Agent Browser prefers
 * the system Edge: it is already here, already patched, and costs no gigabyte.
 */
export function resolveBrowser(env: NodeJS.ProcessEnv = process.env): ToolchainPiece {
  const explicit = configured(env.HYPERFRAMES_BROWSER_PATH);
  if (explicit && fs.existsSync(explicit)) {
    return { found: true, path: explicit, source: "configured" };
  }
  const installed = firstExisting(
    process.platform === "win32" ? WINDOWS_BROWSERS : UNIX_BROWSERS,
  );
  if (installed) {
    return {
      found: true,
      path: installed,
      source: /msedge|Microsoft Edge/i.test(installed) ? "system Edge" : "system Chrome",
    };
  }
  return { found: false, path: "", source: "" };
}

export function resolveToolchain(
  env: NodeJS.ProcessEnv = process.env,
): HyperframesToolchain {
  const launcher = resolveLauncher(env);
  return {
    cli: launcher ? { ...launcher, found: true } : { found: false },
    ffmpeg: resolveFfmpegPiece("ffmpeg", env),
    ffprobe: resolveFfmpegPiece("ffprobe", env),
    browser: resolveBrowser(env),
  };
}

/**
 * A run can start once the CLI and ffmpeg are resolvable. The browser is
 * reported but never blocking: the CLI downloads a pinned chrome-headless-shell
 * on first render when it finds nothing, whereas it has no install path for
 * ffmpeg at all. Each piece is reported separately because each has a different
 * fix, and the settings panel offers each fix on its own.
 */
export function runtimeAvailability(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeAvailability {
  const root = resolveHyperframesRoot(env);
  const toolchain = resolveToolchain(env);
  const missing: string[] = [];
  if (!toolchain.cli.found) missing.push("cli");
  if (!toolchain.ffmpeg.found) missing.push("ffmpeg");

  if (!root) {
    return {
      available: false,
      cloned: false,
      root: null,
      toolchain,
      missing: ["clone", ...missing],
      reason: "The HyperFrames clone was not found next to the dashboard.",
    };
  }
  if (missing.length) {
    return {
      available: false,
      cloned: true,
      root,
      toolchain,
      missing,
      reason: `The video toolchain is incomplete: ${missing.join(", ")} not found. Open the HyperFrames setup panel to install what is missing.`,
    };
  }
  return { available: true, cloned: true, root, toolchain, missing: [], reason: undefined };
}

/**
 * The environment every HyperFrames process runs in.
 *
 * Three things are pinned deliberately: the resolved toolchain paths, so the
 * CLI never tries to download its own copy mid-render; `HYPERFRAMES_SKIP_SKILLS`
 * and `HYPERFRAMES_NO_UPDATE_CHECK`, because `init` otherwise reaches GitHub to
 * freshen skills into the user's *global* `~/.claude/skills` — Breadboard reads
 * the skills straight out of the clone instead; and telemetry off, since the
 * person asked Breadboard for a video, not the framework's vendor.
 */
export function hyperframesEnv(
  toolchain: HyperframesToolchain,
  env: NodeJS.ProcessEnv = process.env,
  extraPathPrefixes: readonly string[] = [],
): NodeJS.ProcessEnv {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const prefixes = [
    ...extraPathPrefixes,
    toolchain.ffmpeg.found ? path.dirname(toolchain.ffmpeg.path) : "",
    toolchain.ffprobe.found ? path.dirname(toolchain.ffprobe.path) : "",
  ].filter((dir, index, all) => dir && all.indexOf(dir) === index);
  return {
    ...env,
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    HYPERFRAMES_NO_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    HYPERFRAMES_SKIP_SKILLS: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
    ...(toolchain.ffmpeg.found ? { HYPERFRAMES_FFMPEG_PATH: toolchain.ffmpeg.path } : {}),
    ...(toolchain.ffprobe.found ? { HYPERFRAMES_FFPROBE_PATH: toolchain.ffprobe.path } : {}),
    ...(toolchain.browser.found ? { HYPERFRAMES_BROWSER_PATH: toolchain.browser.path } : {}),
    [pathKey]: [...prefixes, env[pathKey] ?? ""].filter(Boolean).join(path.delimiter),
  };
}

/** The CLI invocation for a workspace command, ready to spawn. */
export function cliCommand(
  launcher: HyperframesLauncher,
  args: readonly string[],
): { command: string; args: string[] } {
  return { command: launcher.command, args: [...launcher.baseArgs, ...args] };
}

/**
 * Write a `hyperframes` shim into `directory` and return that directory, for
 * the front of the agent's PATH.
 *
 * The CLI usually resolves to `node <somewhere>/hyperframes.mjs`, which is not
 * a name a model can type. Without a shim the agent falls back to what its
 * training and the skills both suggest — `npx hyperframes@latest` — which
 * downloads a second, unpinned copy of the CLI mid-run, or fails offline. One
 * three-line script removes the whole failure mode.
 */
export function writeCliShim(directory: string, launcher: HyperframesLauncher): string {
  fs.mkdirSync(directory, { recursive: true });
  const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;
  const argv = [launcher.command, ...launcher.baseArgs].map(quote).join(" ");
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(directory, "hyperframes.cmd"),
      `@echo off\r\n${argv} %*\r\n`,
      "utf8",
    );
    return directory;
  }
  const script = path.join(directory, "hyperframes");
  fs.writeFileSync(script, `#!/bin/sh\nexec ${argv} "$@"\n`, "utf8");
  fs.chmodSync(script, 0o755);
  return directory;
}

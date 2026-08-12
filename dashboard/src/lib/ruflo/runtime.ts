// Ruflo runtime resolution.
//
// Ruflo (the renamed claude-flow) is an agent meta-harness: it plans a
// queen-led hive-mind swarm and hands the resulting coordination prompt to
// Claude Code, which does the actual work. Breadboard therefore needs two
// executables — the Ruflo CLI (planner) and Claude Code (executor) — and
// reports precisely which one is missing so the Agents palette can explain it.
//
// Every launcher we build is spawned as `process.execPath <js> …` or as a real
// binary. We never shell out through `npx`/`ruflo.cmd` directly: Node refuses
// to spawn `.cmd`/`.bat` without `shell: true`, and `shell: true` would put the
// user's objective through a command-line parser.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

export interface RufloLauncher {
  command: string;
  args: string[];
  /** How the CLI was resolved, surfaced in health and in the run card. */
  source: "configured" | "clone" | "registry";
  version: string;
}

export interface RufloAvailability {
  available: boolean;
  /** The clone exists, even if it cannot be launched yet. */
  installed: boolean;
  reason?: string;
  version?: string;
  source?: RufloLauncher["source"];
  /** Claude Code is Ruflo's executor; without it a swarm can only be planned. */
  executor?: { available: boolean; version?: string };
}

const PROBE_TIMEOUT_MS = 10_000;

export function resolveRufloRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.RUFLO_ROOT?.trim(),
    path.resolve(process.cwd(), "ruflo"),
    path.resolve(process.cwd(), "..", "ruflo"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return (
    candidates.find(
      (candidate) =>
        existsSync(path.join(candidate, "bin", "cli.js")) &&
        existsSync(path.join(candidate, "v3", "@claude-flow", "cli", "package.json")),
    ) ?? null
  );
}

export function clonedRufloVersion(root: string): string {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : "latest";
  } catch {
    return "latest";
  }
}

/** The clone only runs from source once `v3/@claude-flow/cli` has been built. */
function cloneIsBuilt(root: string): boolean {
  return existsSync(
    path.join(root, "v3", "@claude-flow", "cli", "dist", "src", "index.js"),
  );
}

/** npm ships its own JS entry points next to the Node binary. */
function bundledNpxCli(): string | null {
  const candidate = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  return existsSync(candidate) ? candidate : null;
}

function probe(command: string, args: readonly string[]): boolean {
  const result = spawnSync(command, [...args, "--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: PROBE_TIMEOUT_MS,
  });
  return !result.error && result.status === 0;
}

export function resolveRufloLauncher(
  env: NodeJS.ProcessEnv = process.env,
): RufloLauncher | null {
  const root = resolveRufloRoot(env);
  if (!root) return null;
  const version = clonedRufloVersion(root);

  const configured = env.RUFLO_BIN?.trim();
  if (configured) {
    const isScript = /\.(?:js|mjs|cjs)$/i.test(configured);
    const command = isScript ? process.execPath : configured;
    const args = isScript ? [configured] : [];
    if (probe(command, args)) return { command, args, source: "configured", version };
  }

  if (cloneIsBuilt(root)) {
    const entry = path.join(root, "bin", "cli.js");
    return { command: process.execPath, args: [entry], source: "clone", version };
  }

  // The published package ships a prebuilt `dist/`, so an unbuilt clone still
  // pins the exact version it was cloned at rather than drifting to @latest.
  const npx = bundledNpxCli();
  if (!npx) return null;
  return {
    command: process.execPath,
    args: [npx, "--yes", `ruflo@${version}`],
    source: "registry",
    version,
  };
}

export function resolveClaudeExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = env.RUFLO_CLAUDE_BIN?.trim();
  const candidates = [configured, "claude"].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  return candidates.find((candidate) => probe(candidate, [])) ?? null;
}

function claudeVersion(command: string): string | undefined {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: PROBE_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) return undefined;
  return (result.stdout ?? "").trim().split(/\s+/)[0] || undefined;
}

export function runtimeAvailability(
  env: NodeJS.ProcessEnv = process.env,
): RufloAvailability {
  const root = resolveRufloRoot(env);
  if (!root) {
    return { available: false, installed: false, reason: "Ruflo clone was not found" };
  }
  const launcher = resolveRufloLauncher(env);
  if (!launcher) {
    return {
      available: false,
      installed: true,
      reason:
        "Ruflo cannot be launched. Build the clone (npm install && npm run build:ts in ruflo/) or make npm available so Breadboard can run the published CLI.",
    };
  }
  const claude = resolveClaudeExecutable(env);
  if (!claude) {
    return {
      available: false,
      installed: true,
      version: launcher.version,
      source: launcher.source,
      executor: { available: false },
      reason:
        "Ruflo plans swarms but runs them through Claude Code. Install Claude Code, or set RUFLO_CLAUDE_BIN to its path.",
    };
  }
  return {
    available: true,
    installed: true,
    version: launcher.version,
    source: launcher.source,
    executor: { available: true, version: claudeVersion(claude) },
  };
}

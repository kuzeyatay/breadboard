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

import { repositoryRoot } from "../runtime-paths.ts";
import {
  externalRuntimeAccess,
  externalRuntimeFilesystem as fs,
  externalRuntimePathExists,
  externalRuntimeReadUtf8,
  externalRuntimeStat,
} from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";

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

function isRufloRoot(candidate: string): boolean {
  if (!externalRuntimePathExists(path.join(candidate, "bin", "cli.js"))) return false;
  if (externalRuntimePathExists(path.join(candidate, "v3", "@claude-flow", "cli", "package.json"))) {
    return true;
  }
  if (
    externalRuntimePathExists(path.join(candidate, "runtime-artifact.json")) &&
    externalRuntimePathExists(path.join(candidate, "node_modules", "@claude-flow", "cli", "package.json")) &&
    externalRuntimePathExists(path.join(candidate, "node_modules", "@claude-flow", "cli", "dist", "src", "index.js"))
  ) return true;
  if (!externalRuntimePathExists(path.join(candidate, "dist", "src", "index.js"))) return false;
  try {
    const manifest = JSON.parse(externalRuntimeReadUtf8(path.join(candidate, "package.json"))) as {
      name?: unknown;
    };
    return manifest.name === "@claude-flow/cli";
  } catch {
    return false;
  }
}

export function resolveRufloRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.RUFLO_ROOT?.trim(),
    path.join(repositoryRoot(), "ruflo"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return (
    candidates.find((candidate) => isRufloRoot(candidate)) ?? null
  );
}

export function clonedRufloVersion(root: string): string {
  try {
    const parsed = JSON.parse(
      externalRuntimeReadUtf8(path.join(root, "package.json")),
    ) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : "latest";
  } catch {
    return "latest";
  }
}

/** A source clone needs its nested dist; the packaged CLI keeps dist at root. */
function cloneIsBuilt(root: string): boolean {
  return (
    externalRuntimePathExists(path.join(root, "dist", "src", "index.js")) ||
    externalRuntimePathExists(path.join(root, "node_modules", "@claude-flow", "cli", "dist", "src", "index.js")) ||
    externalRuntimePathExists(path.join(root, "v3", "@claude-flow", "cli", "dist", "src", "index.js"))
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
  return externalRuntimePathExists(candidate) ? candidate : null;
}

function regularFile(candidate: string): boolean {
  try {
    return externalRuntimeStat(candidate).isFile();
  } catch {
    return false;
  }
}

function executableFile(candidate: string): boolean {
  try {
    if (!regularFile(candidate)) return false;
    if (process.platform !== "win32") externalRuntimeAccess(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathValue(env: NodeJS.ProcessEnv, name: "PATH" | "PATHEXT"): string {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] ?? "" : "";
}

function findExecutable(command: string, env: NodeJS.ProcessEnv): string | null {
  if (path.isAbsolute(command) || /[\\/]/u.test(command)) {
    const candidate = path.resolve(command);
    return executableFile(candidate) ? candidate : null;
  }
  const hasExtension = Boolean(path.extname(command));
  const extensions = process.platform === "win32" && !hasExtension
    ? (pathValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const directory of pathValue(env, "PATH")
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/gu, ""))
    .filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (executableFile(candidate)) return candidate;
    }
  }
  return null;
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
    const resolved = isScript
      ? (regularFile(path.resolve(configured)) ? path.resolve(configured) : null)
      : findExecutable(configured, env);
    if (resolved) {
      return {
        command: isScript ? process.execPath : resolved,
        args: isScript ? [resolved] : [],
        source: "configured",
        version,
      };
    }
  }

  if (cloneIsBuilt(root)) {
    const entry = path.join(root, "bin", "cli.js");
    return { command: process.execPath, args: [entry], source: "clone", version };
  }

  // The published CLI package ships a prebuilt `dist/`, so an unbuilt clone
  // still pins its exact version rather than drifting to @latest. The bare
  // `ruflo` package name belongs to a different upstream project.
  const npx = bundledNpxCli();
  if (!npx) return null;
  return {
    command: process.execPath,
    args: [npx, "--yes", `@claude-flow/cli@${version}`],
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
  for (const candidate of candidates) {
    const resolved = findExecutable(candidate, env);
    if (resolved) return resolved;
  }
  return null;
}

function claudeVersion(command: string): string | undefined {
  try {
    const receipt = JSON.parse(
      externalRuntimeReadUtf8(path.join(path.dirname(path.resolve(command)), "claude-runtime-artifact.json")),
    ) as { claudeCode?: { version?: unknown } };
    const version = receipt.claudeCode?.version;
    if (
      typeof version === "string" &&
      version.trim() &&
      Buffer.byteLength(version, "utf8") <= 120
    ) return version.trim();
  } catch {
    // Development installs usually expose package.json higher in the tree.
  }
  let directory = path.dirname(path.resolve(command));
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const parsed = JSON.parse(externalRuntimeReadUtf8(path.join(directory, "package.json"))) as {
        name?: unknown;
        version?: unknown;
      };
      if (
        typeof parsed.name === "string" &&
        /claude/iu.test(parsed.name) &&
        typeof parsed.version === "string" &&
        parsed.version.trim() &&
        Buffer.byteLength(parsed.version, "utf8") <= 120
      ) return parsed.version.trim();
    } catch {
      // Static health never executes the CLI merely to discover a version.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
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
        "Ruflo cannot be launched. Build the clone (npm install && npm run build:ts in ruflo/) or make npm available so Breadboard can run the published @claude-flow/cli package.",
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

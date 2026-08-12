// Locating the pieces an OpenWork run needs, and the environment they run in.
//
// Unlike HyperFrames or Career Ops, the cloned `openwork/` *is* a runtime: its
// server owns workspaces, skills, MCP connections, approvals and an outbox, and
// it speaks a complete HTTP API. What it does not own is the model — OpenWork
// is "powered by OpenCode", so the server delegates every turn to an OpenCode
// engine it is pointed at. Breadboard already runs OpenCode on ChatMock for
// `/agents:opencode`, so the missing provider is one Breadboard can supply, and
// the clone is wrapped rather than ported.
//
// Two processes therefore back this agent, both resolved here:
//
//   - the OpenCode engine, launched the same way `/agents:opencode` launches
//     it (a `bunx --bun opencode-ai@<cloned version>` fallback when no binary
//     is installed), with a Breadboard-written config pointing at ChatMock;
//   - the OpenWork server, run from the clone's source with Bun.
//
// The published `openwork-server` npm package is deliberately not used: it
// ships one platform's compiled binary and no `openwork-server.exe`, so on
// Windows its launcher fails with "Unable to find an OpenWork server
// entrypoint". Upstream's own fallback — run the source with Bun — is the path
// that works everywhere, which is why setup.ts prepares a runnable copy of the
// server's source instead of installing the package.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

export interface OpencodeLauncher {
  /** argv[0] used to invoke OpenCode. */
  command: string;
  /** Fixed leading arguments, e.g. `["--bun", "opencode-ai@1.18.8"]`. */
  prefix: string[];
  /** The version pinned by the cloned OpenCode, so drift is visible. */
  version: string;
  source: "configured" | "path" | "bunx";
}

export interface RuntimePiece {
  found: boolean;
  path: string;
  source: string;
}

export interface OpenworkToolchain {
  /** The Bun binary the OpenWork server runs under. */
  bun: RuntimePiece;
  /** The prepared, dependency-installed copy of the server source. */
  server: RuntimePiece & { version: string };
  /** How the OpenCode engine will be started. */
  engine: (OpencodeLauncher & { found: true }) | { found: false };
}

export interface RuntimeAvailability {
  available: boolean;
  /** The clone exists, even when nothing has been prepared yet. */
  cloned: boolean;
  root: string | null;
  toolchain: OpenworkToolchain;
  /** Every missing piece, so the setup panel can list them all at once. */
  missing: string[];
  reason?: string;
}

const PROBE_TIMEOUT_MS = 20_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/** The cloned repository — the source of truth for the server. */
export function resolveOpenworkRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    configured(env.OPENWORK_ROOT),
    path.join(repositoryRoot(), "openwork"),
    path.resolve(process.cwd(), "openwork"),
    path.resolve(process.cwd(), "..", "openwork"),
  ];
  return (
    candidates.find(
      (candidate) =>
        Boolean(candidate) &&
        fs.existsSync(path.join(candidate as string, "apps", "server", "src", "cli.ts")),
    ) ?? null
  );
}

/**
 * Where setup.ts assembles the runnable server: the clone's `apps/server`
 * source, its two workspace packages, and `constants.json`, with dependencies
 * installed by npm. The clone itself is never written to — it is a pnpm
 * workspace and pnpm is not a Breadboard dependency.
 */
export function serverRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.OPENWORK_SERVER_RUNTIME_ROOT) ??
    path.join(dashboardDataDir(), "openwork-runtime")
  );
}

/** The prepared server's entry point. */
export function serverEntry(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(serverRuntimeRoot(env), "apps", "server", "src", "cli.ts");
}

/**
 * The OpenWork workspace this agent works inside. Durable and shared across
 * runs: the skills, connections and outbox a person builds up there are the
 * whole point of the product, so a run never gets a fresh empty one.
 */
export function workspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.OPENWORK_WORKSPACE_ROOT) ??
    path.join(dashboardDataDir(), "openwork-workspace")
  );
}

/** Server state (its `server.json`, tokens and runtime DB) beside the workspace. */
export function serverStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.OPENWORK_SERVER_STATE_ROOT) ??
    path.join(dashboardDataDir(), "openwork-state")
  );
}

function probe(command: string, args: readonly string[]): string | null {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: PROBE_TIMEOUT_MS,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error || result.status !== 0) return null;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return output ? output.split(/\r?\n/)[0].slice(0, 120) : "";
}

/**
 * Bun, which the OpenWork server needs: `apps/server` is TypeScript executed
 * directly, with `bun:sqlite` and `with { type: "json" }` imports Node cannot
 * run. Breadboard already depends on Bun for the OpenCode fallback launcher, so
 * this asks for nothing new.
 */
export function resolveBun(env: NodeJS.ProcessEnv = process.env): RuntimePiece {
  const explicit = configured(env.OPENWORK_BUN_PATH ?? env.BUN_PATH);
  if (explicit && fs.existsSync(explicit) && probe(explicit, ["--version"]) !== null) {
    return { found: true, path: explicit, source: "configured" };
  }
  const onPath = process.platform === "win32" ? "bun.exe" : "bun";
  const version = probe(onPath, ["--version"]);
  if (version !== null) return { found: true, path: onPath, source: `PATH (${version})` };
  const home = env.USERPROFILE?.trim() || env.HOME?.trim();
  if (home) {
    const bundled = path.join(home, ".bun", "bin", onPath);
    if (fs.existsSync(bundled) && probe(bundled, ["--version"]) !== null) {
      return { found: true, path: bundled, source: "~/.bun" };
    }
  }
  return { found: false, path: "", source: "" };
}

function preparedServerVersion(root: string): string | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(root, "apps", "server", "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/** The prepared server, and whether setup has run. */
export function resolvePreparedServer(
  env: NodeJS.ProcessEnv = process.env,
): RuntimePiece & { version: string } {
  const root = serverRuntimeRoot(env);
  const entry = serverEntry(env);
  // Dependencies decide readiness, not the source copy: a half-finished setup
  // leaves the files in place and would otherwise look installed.
  const installed = fs.existsSync(
    path.join(root, "apps", "server", "node_modules", "@opencode-ai", "sdk"),
  );
  if (!fs.existsSync(entry) || !installed) {
    return { found: false, path: "", source: "", version: "" };
  }
  return {
    found: true,
    path: entry,
    source: "prepared from the clone",
    version: preparedServerVersion(root) ?? "unknown",
  };
}

/** The version of OpenCode the clone next to Breadboard pins. */
function clonedOpencodeVersion(): string {
  const manifest = path.join(
    repositoryRoot(),
    "opencode",
    "packages",
    "opencode",
    "package.json",
  );
  try {
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : "latest";
  } catch {
    return "latest";
  }
}

/**
 * How to start the OpenCode engine. Deliberately the same resolution order as
 * `/agents:opencode`: an installed binary when there is one, otherwise Bun
 * running the version the clone pins, so both agents answer on the same engine.
 *
 * OpenWork can manage its own engine (`OPENWORK_MANAGE_OPENCODE=1`), and that
 * path is not used. It takes a single executable path, which the `bunx --bun
 * opencode-ai@…` fallback cannot be expressed as, and it would write its own
 * OpenCode config from OpenWork's runtime database — a config with no ChatMock
 * provider in it. Breadboard starts the engine itself and hands the server a
 * `--opencode-base-url`, which keeps the model wiring in one place.
 */
export function resolveEngineLauncher(
  env: NodeJS.ProcessEnv = process.env,
): OpencodeLauncher | null {
  const version = clonedOpencodeVersion();
  const explicit = env.OPENCODE_BIN?.trim();
  if (explicit && probe(explicit, ["--version"]) !== null) {
    return { command: explicit, prefix: [], version, source: "configured" };
  }
  if (probe("opencode", ["--version"]) !== null) {
    return { command: "opencode", prefix: [], version, source: "path" };
  }
  const bunx = process.platform === "win32" ? "bunx.exe" : "bunx";
  if (probe(bunx, ["--version"]) !== null) {
    return {
      command: bunx,
      prefix: ["--bun", `opencode-ai@${version}`],
      version,
      source: "bunx",
    };
  }
  return null;
}

export function resolveToolchain(env: NodeJS.ProcessEnv = process.env): OpenworkToolchain {
  const engine = resolveEngineLauncher(env);
  return {
    bun: resolveBun(env),
    server: resolvePreparedServer(env),
    engine: engine ? { ...engine, found: true } : { found: false },
  };
}

/**
 * A run can start once the clone is present, Bun is available, the server has
 * been prepared, and an OpenCode engine can be launched. Each piece is reported
 * separately because each has its own fix: the clone is a `git clone`, Bun is
 * an install, the prepared server is one button in the setup panel.
 */
export function runtimeAvailability(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeAvailability {
  const root = resolveOpenworkRoot(env);
  const toolchain = resolveToolchain(env);
  const missing: string[] = [];
  if (!toolchain.bun.found) missing.push("bun");
  if (!toolchain.server.found) missing.push("server");
  if (!toolchain.engine.found) missing.push("engine");

  if (!root) {
    return {
      available: false,
      cloned: false,
      root: null,
      toolchain,
      missing: ["clone", ...missing],
      reason: "The OpenWork clone was not found next to the dashboard.",
    };
  }
  if (missing.length) {
    const fix = missing.includes("bun")
      ? "Install Bun — the OpenWork server is TypeScript that only Bun can run directly."
      : "Open the OpenWork setup panel to prepare the server.";
    return {
      available: false,
      cloned: true,
      root,
      toolchain,
      missing,
      reason: `OpenWork is not ready: ${missing.join(", ")} missing. ${fix}`,
    };
  }
  return { available: true, cloned: true, root, toolchain, missing: [], reason: undefined };
}

/**
 * The environment both OpenWork processes run in.
 *
 * `OPENWORK_DEV_MODE` is left off on purpose: it turns on the clone's developer
 * affordances (a dev log endpoint, looser origin checks) that a supervised
 * local service has no use for. Telemetry is off for the same reason it is off
 * for every other wrapped clone — the person asked Breadboard for work, not the
 * upstream vendor.
 */
export function openworkEnv(
  extra: Record<string, string> = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    NO_COLOR: "1",
    DO_NOT_TRACK: "1",
    ELECTRON_RUN_AS_NODE: "1",
    ...extra,
  };
}

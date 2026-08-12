// Preparing the OpenWork server so Breadboard can run it.
//
// The clone is a pnpm workspace and pnpm is not a Breadboard dependency, so the
// clone is never installed into or written to. Instead the four things the
// server actually needs are copied into a Breadboard-owned directory and npm
// installs the dependencies there:
//
//   apps/server/src        the server itself
//   apps/server/package.json  its dependency list (workspace devDeps dropped)
//   packages/paths         imported at runtime for the config/state locations
//   packages/types         imported for its types
//   constants.json         read by server.ts through a repo-root-relative path
//
// That last one is the non-obvious member: `src/server.ts` imports
// `../../../constants.json`, which resolves *above* apps/server, so a copy of
// the source alone starts and then dies with "Cannot find module". The layout
// below reproduces the clone's shape exactly so every relative import still
// lands where upstream expects it.
//
// Setup is idempotent and fingerprinted: a `git pull` in the clone changes the
// fingerprint, the panel reports the prepared server as stale, and re-running
// setup re-copies. That is what keeps "pull the clone to upgrade the agent"
// true here as it is for the other wrapped clones.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { planSpawn } from "../agent-reach/spawn-plan.ts";
import {
  resolveBun,
  resolveOpenworkRoot,
  resolvePreparedServer,
  runtimeAvailability,
  serverRuntimeRoot,
  workspaceRoot,
} from "./runtime.ts";

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const FINGERPRINT_FILE = "breadboard-source.json";

export interface SetupResult {
  ok: boolean;
  message: string;
  version?: string;
  log?: string;
}

export interface SetupStatus {
  /** Everything a run needs is in place. */
  ready: boolean;
  /** Why not, when it is not. */
  reason: string;
  cloned: boolean;
  clonePath: string;
  prepared: boolean;
  /** True when the clone has moved on since the server was prepared. */
  stale: boolean;
  version: string;
  bun: { found: boolean; source: string };
  engine: { found: boolean; version: string; source: string };
  /** The durable workspace the agent works inside. */
  workspacePath: string;
}

/**
 * A cheap, stable signature of the server source in the clone: every file's
 * path and size, plus the server's own version. Content hashing ~120 files on
 * every health check would be wasted work — a size change is enough to notice a
 * pull, and the version catches a release that happened to keep sizes equal.
 */
function sourceFingerprint(root: string): string {
  const parts: string[] = [];
  const walk = (directory: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(absolute, relative);
        continue;
      }
      try {
        parts.push(`${relative}:${fs.statSync(absolute).size}`);
      } catch {
        // A file that vanished mid-walk simply does not count.
      }
    }
  };
  walk(path.join(root, "apps", "server", "src"), "src");
  for (const file of ["apps/server/package.json", "constants.json"]) {
    try {
      parts.push(`${file}:${fs.statSync(path.join(root, file)).size}`);
    } catch {
      // Missing files are caught by the copy step with a clearer message.
    }
  }
  return parts.join("|");
}

function readPreparedFingerprint(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(serverRuntimeRoot(env), FINGERPRINT_FILE), "utf8"),
    ) as { fingerprint?: unknown };
    return typeof parsed.fingerprint === "string" ? parsed.fingerprint : null;
  } catch {
    return null;
  }
}

export function setupStatus(env: NodeJS.ProcessEnv = process.env): SetupStatus {
  const availability = runtimeAvailability(env);
  const root = availability.root;
  const server = availability.toolchain.server;
  const bun = availability.toolchain.bun;
  const engine = availability.toolchain.engine;
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    cloned: availability.cloned,
    clonePath: root ?? "",
    prepared: server.found,
    // A prepared server whose clone has since moved on still runs; it is just
    // the previous generation, which is worth saying rather than hiding.
    stale: Boolean(root) && server.found && readPreparedFingerprint(env) !== sourceFingerprint(root as string),
    version: server.version,
    bun: { found: bun.found, source: bun.source },
    engine: engine.found
      ? { found: true, version: engine.version, source: engine.source }
      : { found: false, version: "", source: "" },
    workspacePath: workspaceRoot(env),
  };
}

function copyTree(from: string, to: string): void {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    // A stray node_modules or .git inside a workspace package would be copied
    // byte for byte otherwise, and npm is about to write the real one.
    filter: (source) => {
      const base = path.basename(source);
      return base !== "node_modules" && base !== ".git";
    },
  });
}

/**
 * The server's package.json, rewritten for a standalone npm install: the two
 * `workspace:*` devDependencies become `file:` links to the copies beside it,
 * and the rest of the devDependencies (TypeScript, bun-types, @types/*) are
 * dropped because nothing here compiles — Bun runs the TypeScript directly.
 */
function writeStandaloneManifest(cloneRoot: string, runtimeRoot: string): void {
  const manifestPath = path.join(runtimeRoot, "apps", "server", "package.json");
  const parsed = JSON.parse(
    fs.readFileSync(path.join(cloneRoot, "apps", "server", "package.json"), "utf8"),
  ) as Record<string, unknown>;
  const dependencies = {
    ...(parsed.dependencies as Record<string, string> | undefined),
    "@openwork/paths": "file:../../packages/paths",
    "@openwork/types": "file:../../packages/types",
  };
  delete parsed.devDependencies;
  delete parsed.scripts;
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...parsed, dependencies, private: true }, null, 2)}\n`,
    "utf8",
  );
}

function runNpmInstall(cwd: string): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    const plan = planSpawn(
      "npm",
      ["install", "--no-audit", "--no-fund", "--omit=dev", "--loglevel", "error"],
      process.env,
      () => "npm was not found on PATH.",
    );
    if ("error" in plan) {
      resolve({ code: null, log: plan.error });
      return;
    }
    const child = spawn(plan.command, plan.argv, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: plan.verbatim,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", npm_config_yes: "true" },
    });
    let log = "";
    const collect = (chunk: string) => {
      log = `${log}${chunk}`.slice(-8_000);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, INSTALL_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, log: `${log}\n${error.message}`.trim() });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, log });
    });
  });
}

let inFlight: Promise<SetupResult> | null = null;

/**
 * Copy the server out of the clone and install its dependencies. Concurrent
 * callers share one install: two npm processes writing the same node_modules
 * corrupt each other, and both chat surfaces can ask at once.
 */
export function prepareServerRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SetupResult> {
  inFlight ??= prepare(env).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function prepare(env: NodeJS.ProcessEnv): Promise<SetupResult> {
  const cloneRoot = resolveOpenworkRoot(env);
  if (!cloneRoot) {
    return {
      ok: false,
      message:
        "The OpenWork clone was not found. Clone https://github.com/openworklabs/openwork next to the dashboard.",
    };
  }
  if (!resolveBun(env).found) {
    return {
      ok: false,
      message:
        "Bun was not found. The OpenWork server is TypeScript with bun:sqlite imports, so Bun runs it directly — install Bun and try again.",
    };
  }

  const runtimeRoot = serverRuntimeRoot(env);
  const fingerprint = sourceFingerprint(cloneRoot);
  try {
    copyTree(
      path.join(cloneRoot, "apps", "server", "src"),
      path.join(runtimeRoot, "apps", "server", "src"),
    );
    copyTree(
      path.join(cloneRoot, "packages", "paths"),
      path.join(runtimeRoot, "packages", "paths"),
    );
    copyTree(
      path.join(cloneRoot, "packages", "types"),
      path.join(runtimeRoot, "packages", "types"),
    );
    fs.copyFileSync(
      path.join(cloneRoot, "constants.json"),
      path.join(runtimeRoot, "constants.json"),
    );
    writeStandaloneManifest(cloneRoot, runtimeRoot);
  } catch (error) {
    return {
      ok: false,
      message: `The OpenWork server source could not be copied: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }

  const { code, log } = await runNpmInstall(path.join(runtimeRoot, "apps", "server"));
  const prepared = resolvePreparedServer(env);
  if (code !== 0 || !prepared.found) {
    const tail = log.trim().split(/\r?\n/).slice(-4).join(" ").slice(0, 400);
    return {
      ok: false,
      message: `The OpenWork server could not be prepared${
        code === null ? "" : ` (npm exited with ${code})`
      }. ${tail}`.trim(),
      log,
    };
  }

  fs.writeFileSync(
    path.join(runtimeRoot, FINGERPRINT_FILE),
    `${JSON.stringify({ fingerprint, preparedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return {
    ok: true,
    message: `OpenWork server ${prepared.version} is ready.`,
    version: prepared.version,
    log,
  };
}

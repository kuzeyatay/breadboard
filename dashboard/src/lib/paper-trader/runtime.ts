// Locating the cloned Open Alpha Arena and the Node that runs it.
//
// The clone is a whole product: a Hono backend with its own SQLite store, a
// ccxt market-data layer, a leverage-aware matching engine with a margin
// monitor, an AI decision loop and a React frontend. Breadboard drives the
// backend half of it — the same shape as the Stock Analyst and Socials Manager
// integrations — and draws the frontend half itself, because a trading desk
// belongs inside a chat card rather than behind a second localhost tab.
//
// Two things are deliberately not the clone's defaults.
//
// **The database lives outside the checkout.** `DATABASE_PATH` defaults to
// `backend/data.db`, which is where a user's own `pnpm dev` writes. An agent
// must not share a portfolio with the user's own experiments, so state goes to
// `.runtime/paper-trader` next to every other agent's.
//
// **The Node is the one on PATH, not `process.execPath`.** Under the desktop
// shell `process.execPath` is Electron, and the backend loads two native
// addons (better-sqlite3, nodejs-polars) built for the Node ABI. Running them
// under Electron's ABI fails at require time with a module-version error, so a
// real `node` is preferred and Electron is only the last resort.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface PaperTraderRuntime {
  /** Directory of the cloned repository — the cwd of every command. */
  root: string;
  /** How the clone was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface PaperTraderHealth {
  /** The desk can be started right now. */
  available: boolean;
  /** The clone exists, even when its dependencies are not installed. */
  cloned: boolean;
  root: string | null;
  /** The build workspace has its dependencies. */
  dependenciesInstalled: boolean;
  /** The build workspace has a compiled entrypoint. */
  built: boolean;
  /** The clone has moved on since the workspace was built. */
  stale: boolean;
  /** The Node that would run it, when one can be found. */
  node: string | null;
  /** The npm that would install it. */
  npm: string | null;
  /** The TradingAgents clone that makes the decisions is itself ready. */
  deciderReady: boolean;
  deciderReason: string | null;
  reason: string | null;
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/**
 * A directory is an Open Alpha Arena clone when the backend entrypoint, its
 * package manifest and the AI decision service are all there. `backend/` alone
 * would match half the trees on disk.
 */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "backend", "package.json")) &&
    fs.existsSync(path.join(candidate, "backend", "src", "index.ts")) &&
    fs.existsSync(path.join(candidate, "backend", "src", "services", "aiDecision.ts"))
  );
}

export function resolvePaperTraderRoot(
  env: NodeJS.ProcessEnv = process.env,
): PaperTraderRuntime | null {
  const candidates: Array<{ root: string; source: PaperTraderRuntime["source"] }> = [];
  const explicit = configured(env.PAPER_TRADER_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({
    root: path.join(repositoryRoot(), "open-alpha-arena"),
    source: "repository",
  });
  candidates.push({ root: path.resolve(process.cwd(), "open-alpha-arena"), source: "cwd" });
  candidates.push({
    root: path.resolve(process.cwd(), "..", "open-alpha-arena"),
    source: "cwd",
  });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

/** The clone's backend — read from, never written to. */
export function backendDirectory(root: string): string {
  return path.join(root, "backend");
}

/**
 * Where the arena is actually built and run.
 *
 * Not in the checkout. Breadboard has to change the clone's sources to teach it
 * about company shares (see ./overlay.ts), and rewriting files in a repository
 * the user pulls would conflict on their next update. So the sources are copied
 * here, patched here, compiled here, and run from here; `git status` inside the
 * clone stays empty, down to the absence of a node_modules directory.
 */
export function workspaceDirectory(): string {
  return path.join(stateHome(), "backend");
}

export function workspaceSource(): string {
  return path.join(workspaceDirectory(), "src");
}

export function workspaceModules(): string {
  return path.join(workspaceDirectory(), "node_modules");
}

/** The compiled entrypoint the service runs, once `tsc` has produced it. */
export function backendEntry(): string {
  return path.join(workspaceDirectory(), "dist", "index.js");
}

export function dependenciesInstalled(): boolean {
  return (
    fs.existsSync(path.join(workspaceModules(), "hono")) &&
    fs.existsSync(path.join(workspaceModules(), "yahoo-finance2"))
  );
}

export function isBuilt(): boolean {
  return fs.existsSync(backendEntry());
}

/**
 * Whether the workspace was built from the sources currently in the clone. A
 * `git pull` in the checkout should be picked up by a rebuild rather than
 * silently ignored, and a mtime comparison is enough to notice one.
 */
export function workspaceStale(root: string): boolean {
  const built = backendEntry();
  if (!fs.existsSync(built)) return true;
  const builtAt = fs.statSync(built).mtimeMs;
  const integrationSources = Math.max(
    newestSourceTime(path.join(repositoryRoot(), "scripts", "paper-trader-overlay")),
    modifiedAt(path.join(repositoryRoot(), "dashboard", "src", "lib", "paper-trader", "overlay.ts")),
  );
  return Math.max(newestSourceTime(path.join(backendDirectory(root), "src")), integrationSources) > builtAt;
}

function modifiedAt(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function newestSourceTime(directory: string): number {
  let newest = 0;
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      } catch {
        // A file that vanished mid-walk cannot be newer than the build.
      }
    }
  };
  walk(directory);
  return newest;
}

/** Find an executable on PATH, honouring PATHEXT on Windows. */
export function resolveOnPath(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (path.isAbsolute(executable)) return fs.existsSync(executable) ? executable : null;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const directories = (env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * The Node the backend runs under. See the note at the top of the file: the
 * native addons are built for the Node ABI, so Electron's own binary is a
 * fallback that will only work outside the desktop shell.
 */
export function nodeExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.PAPER_TRADER_NODE);
  if (explicit && fs.existsSync(explicit)) return explicit;
  return resolveOnPath("node", env) ?? (process.versions.electron ? null : process.execPath);
}

export function npmExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveOnPath("npm", env);
}

/**
 * Where the desk keeps its portfolio. Breadboard's own runtime directory rather
 * than `backend/data.db`, so an agent's positions never mix with the user's own
 * runs of the same clone.
 */
export function stateHome(): string {
  const configuredHome = process.env.PAPER_TRADER_HOME?.trim();
  return configuredHome
    ? path.resolve(configuredHome)
    : path.join(repositoryRoot(), ".runtime", "paper-trader");
}

export function databasePath(): string {
  const configuredDatabase = process.env.PAPER_TRADER_DATABASE_PATH?.trim();
  if (configuredDatabase) return path.resolve(configuredDatabase);
  return path.join(stateHome(), "arena.db");
}

/**
 * Environment for anything the clone runs. `ELECTRON_RUN_AS_NODE` matters only
 * on the fallback path, and is harmless for a real Node.
 */
export function paperTraderEnv(
  extra: Record<string, string | undefined> = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  // The arena needs an operating-system environment, public market data and a
  // local SQLite path—never the dashboard's application environment. An
  // allowlist is deliberate: a credential named DATABASE_URL, SESSION or
  // something vendor-specific must not cross merely because a denylist did not
  // anticipate its spelling.
  const inherited = new Set([
    "APPDATA",
    "COMMONPROGRAMFILES",
    "COMMONPROGRAMFILES(X86)",
    "COMSPEC",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS",
    "NODE_ENV",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATH",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "TZ",
    "USERPROFILE",
    "WINDIR",
  ]);
  const safeEnvironment = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(env)) {
    if (inherited.has(key.toUpperCase())) safeEnvironment[key] = value;
  }
  return {
    ...safeEnvironment,
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    ...extra,
  };
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run one command for the clone. Never throws: every caller either reports the
 * failure to the user or turns it into a health reason.
 */
export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    env?: Record<string, string | undefined>;
    maxOutputChars?: number;
  },
): Promise<CommandResult> {
  const limit = options.maxOutputChars ?? 200_000;
  return new Promise((resolve) => {
    // npm and tsc on Windows are .cmd shims, which CreateProcess cannot start
    // directly; the shell is what makes them spawnable at all. It also means the
    // command line is re-parsed by cmd, so anything containing a space has to be
    // quoted — without this, `C:\Program Files\nodejs\npm.cmd` runs as
    // `C:\Program` with `Files\nodejs\npm.cmd` as its first argument.
    const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const quote = (value: string) =>
      shell && /\s/.test(value) && !value.startsWith('"') ? `"${value}"` : value;

    let child;
    try {
      child = spawn(quote(command), shell ? args.map(quote) : args, {
        cwd: options.cwd,
        windowsHide: true,
        shell,
        env: paperTraderEnv(options.env ?? {}),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : "spawn failed",
        timedOut: false,
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < limit) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 32_000) stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: error.message, timedOut });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/**
 * A health read. Everything here is a filesystem check, so unlike the Stock
 * Analyst probe it is cheap enough to run on every request without a cache.
 */
export async function health(): Promise<PaperTraderHealth> {
  const runtime = resolvePaperTraderRoot();
  const node = nodeExecutable();
  const npm = npmExecutable();
  const decider = await deciderHealth();

  if (!runtime) {
    return {
      available: false,
      cloned: false,
      root: null,
      dependenciesInstalled: false,
      built: false,
      stale: false,
      node,
      npm,
      deciderReady: decider.ready,
      deciderReason: decider.reason,
      reason: "The open-alpha-arena clone was not found next to the dashboard.",
    };
  }

  const installed = dependenciesInstalled();
  const built = isBuilt();
  const stale = built && workspaceStale(runtime.root);

  const reason = !node
    ? "No Node.js was found on PATH. The trading desk runs two native addons that need a real Node, not the desktop shell's own binary."
    : !installed || !built
      ? "Paper Trader is cloned but not built yet. Build it from its settings — nothing is written into the clone itself."
      : stale
        ? "The open-alpha-arena clone has changed since Paper Trader was built. Rebuild it from its settings to pick the change up."
        : !decider.ready
          ? decider.reason
          : null;

  return {
    // Never launch a build whose overlay no longer matches the integration.
    // "It still runs" is not enough for a process that may execute paper orders
    // with an older symbol or risk policy.
    available: Boolean(node) && installed && built && !stale && decider.ready,
    cloned: true,
    root: runtime.root,
    dependenciesInstalled: installed,
    built,
    stale,
    node,
    npm,
    deciderReady: decider.ready,
    deciderReason: decider.reason,
    reason,
  };
}

/**
 * Whether the thing that actually decides — the TradingAgents clone and its
 * Python environment — is ready. Imported lazily so this module stays free of a
 * cycle with the agent that owns it.
 */
async function deciderHealth(): Promise<{ ready: boolean; reason: string | null }> {
  try {
    const { resolveTradingAgentsRoot, venvPython, bridgeScriptPath } = await import(
      "../tradingagents/runtime.ts"
    );
    const runtime = resolveTradingAgentsRoot();
    if (!runtime) {
      return {
        ready: false,
        reason:
          "Paper Trader decides through TradingAgents, and that clone was not found next to the dashboard.",
      };
    }
    if (!venvPython(runtime.root)) {
      return {
        ready: false,
        reason:
          "Paper Trader decides through TradingAgents, whose Python environment has not been built yet. Build it from the Trading Agent settings.",
      };
    }
    if (!bridgeScriptPath()) {
      return { ready: false, reason: "Breadboard's TradingAgents bridge script is missing." };
    }
    return { ready: true, reason: null };
  } catch {
    return { ready: false, reason: "The TradingAgents runtime could not be inspected." };
  }
}

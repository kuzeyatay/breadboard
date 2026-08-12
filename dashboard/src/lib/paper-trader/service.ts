// The cloned arena backend, supervised as one long-lived process.
//
// This is the part of the integration that runs while Breadboard is open. The clone owns the
// portfolio, the ccxt price feed, the leverage-aware matching engine, the margin
// monitor that liquidates a position when it goes underwater, and the timer that
// asks for a trading decision every few minutes. Breadboard starts it, keeps it
// alive, and stops it when the user says so — it does not reimplement any of it.
//
// Three things about the start are deliberate.
//
// **The port is whatever is free.** Nothing outside this process talks to the
// arena directly: the card reads Breadboard's own endpoints, which proxy it. A
// fixed port would only be something to collide with.
//
// **The database is Breadboard's, not the checkout's.** See ./runtime.ts.
//
// **Readiness is the health endpoint, not the log line.** The clone prints its
// banner when the socket opens and then spends up to a minute prefetching prices
// from Hyperliquid before its first cycle; polling `/api/health` is what tells
// the difference between "listening" and "not started yet".

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  backendEntry,
  databasePath,
  dependenciesInstalled,
  isBuilt,
  nodeExecutable,
  paperTraderEnv,
  resolvePaperTraderRoot,
  stateHome,
  workspaceDirectory,
} from "./runtime.ts";
import { deskSymbolsEnv } from "./overlay.ts";

export interface DeskRegisterEntry {
  symbol: string;
  kind: "CRYPTO" | "EQUITY";
  name: string;
}

export interface ArenaService {
  /** Where the supervised backend listens, e.g. `http://127.0.0.1:52413`. */
  url: string;
  startedAt: number;
  /** What the running process was told it may trade. */
  register: string;
  /** The scheduler interval this process read at boot. */
  cycleSeconds: number;
}

interface ServiceState extends ArenaService {
  child: ChildProcess;
  /** The tail of the process's own output, so a crash can be explained. */
  log: string;
}

interface StartControl {
  /** The child as soon as it exists, so Stop can reach it before readiness. */
  child: ChildProcess | null;
  cancelled: boolean;
}

interface StartAttempt {
  register: string;
  cycleSeconds: number;
  control: StartControl;
  promise: Promise<ArenaService>;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __breadboardPaperTraderArena?: ServiceState | null;
  __breadboardPaperTraderStarting?: StartAttempt | null;
  /** Serialises process teardown so a replacement never overlaps its predecessor. */
  __breadboardPaperTraderStopping?: Promise<void> | null;
  /** Incremented by an explicit Stop so it wins over a concurrent restart. */
  __breadboardPaperTraderStopGeneration?: number;
};

// Cold start is a Node boot plus a SQLite open; the generous bound is for a
// machine where the first ccxt call is still resolving DNS.
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 500;
const HEALTH_TIMEOUT_MS = 5_000;
const STOP_GRACE_MS = 5_000;

/**
 * Where the running backend records itself.
 *
 * The arena is a child process, and a child outlives the thing that started it
 * whenever that thing dies without cleaning up — a dev-server restart, a crashed
 * worker, a hard quit. Without this file the next start cannot see the previous
 * arena at all: the port was chosen at random and lives only in the memory of a
 * process that is gone. Two arenas on one database is two schedulers trading the
 * same account against each other, so the note on disk is what makes the second
 * start able to end the first.
 */
function pidFile(): string {
  return path.join(stateHome(), "arena.pid");
}

function recordProcess(pid: number | undefined, port: number): void {
  if (!pid) return;
  try {
    fs.mkdirSync(stateHome(), { recursive: true });
    fs.writeFileSync(pidFile(), JSON.stringify({ pid, port }), "utf8");
  } catch {
    // Losing the note costs a stray process on the next restart, not this start.
  }
}

function forgetProcess(): void {
  try {
    fs.rmSync(pidFile(), { force: true });
  } catch {
    // Nothing to forget.
  }
}

/**
 * End an arena left behind by a process that is no longer here.
 *
 * A recorded pid alone is not enough to kill on: pids are recycled, and killing
 * a stranger because it inherited a number is far worse than leaving a stray
 * backend running. So the port has to answer as an arena first — a pid that is
 * alive *and* serving this desk's API on the port it recorded is the arena, not
 * a coincidence.
 */
async function reapOrphan(): Promise<void> {
  let recorded: { pid?: unknown; port?: unknown };
  try {
    recorded = JSON.parse(fs.readFileSync(pidFile(), "utf8")) as typeof recorded;
  } catch {
    return;
  }
  const pid = Number(recorded.pid);
  const port = Number(recorded.port);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port)) {
    forgetProcess();
    return;
  }
  // Our own child is not an orphan; it is handled by the normal restart path.
  if (runtimeGlobal.__breadboardPaperTraderArena?.child.pid === pid) return;

  try {
    process.kill(pid, 0);
  } catch {
    forgetProcess();
    return;
  }
  if (!(await reachable(`http://127.0.0.1:${port}`))) {
    forgetProcess();
    return;
  }
  try {
    process.kill(pid);
  } catch {
    // It exited between the check and the signal, which is the outcome anyway.
  }
  forgetProcess();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
        return;
      }
      server.close(() => reject(new Error("could not reserve a port")));
    });
  });
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/health", url), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function lastLines(text: string, lines = 6): string {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
}

async function waitForReady(
  child: ChildProcess,
  url: string,
  readLog: () => string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The trading desk exited before it was ready (code ${child.exitCode ?? child.signalCode}). ${lastLines(readLog())}`.trim(),
      );
    }
    if (await reachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(
    `The trading desk did not become ready within ${Math.round(READY_TIMEOUT_MS / 1000)}s. ${lastLines(readLog())}`.trim(),
  );
}

function kill(child: ChildProcess | null | undefined): void {
  if (!child) return;
  try {
    child.kill();
  } catch {
    // Already gone.
  }
  // The clone handles SIGTERM, but a wedged tick would otherwise hold the port
  // and, worse, the SQLite write lock.
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }, STOP_GRACE_MS);
  timer.unref?.();
  child.once("exit", () => clearTimeout(timer));
}

/** Send termination and do not return until the process has actually exited. */
async function terminateChild(child: ChildProcess | null | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      child.off("exit", done);
      child.off("error", done);
      resolve();
    };
    child.once("exit", done);
    // A spawn-level error may not be followed by an exit event.
    child.once("error", done);
    kill(child);
  });
}

class StartCancelledError extends Error {
  constructor() {
    super("The trading desk start was cancelled.");
    this.name = "StartCancelledError";
  }
}

function assertStartActive(control: StartControl): void {
  if (control.cancelled) throw new StartCancelledError();
}

async function start(
  register: string,
  cycleSeconds: number,
  control: StartControl,
): Promise<ArenaService> {
  assertStartActive(control);
  const runtime = resolvePaperTraderRoot();
  if (!runtime) {
    throw new Error("The open-alpha-arena clone was not found next to the dashboard.");
  }
  if (!dependenciesInstalled() || !isBuilt()) {
    throw new Error(
      "Paper Trader has not been built yet. Build it from its settings first.",
    );
  }
  const node = nodeExecutable();
  if (!node) {
    throw new Error(
      "No Node.js was found on PATH. The trading desk runs native addons that the desktop shell's own binary cannot load.",
    );
  }

  const home = stateHome();
  fs.mkdirSync(home, { recursive: true });

  // Anything left over from a process that died without cleaning up goes first:
  // two arenas on one database is two schedulers trading the same account.
  await reapOrphan();
  assertStartActive(control);

  const port = await freePort();
  assertStartActive(control);
  const url = `http://127.0.0.1:${port}`;

  const child = spawn(node, [backendEntry()], {
    // The build workspace, not the checkout: that is where its node_modules are.
    cwd: workspaceDirectory(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: paperTraderEnv({
      PORT: String(port),
      DATABASE_PATH: databasePath(),
      LOG_LEVEL: process.env.PAPER_TRADER_LOG_LEVEL?.trim() || "info",
      // Read once at boot by the patched symbol registry, which is why a changed
      // register restarts the process rather than being picked up in place.
      DESK_SYMBOLS: register,
      DESK_CYCLE_SECONDS: String(cycleSeconds),
    }),
  });
  control.child = child;

  let log = "";
  const append = (chunk: Buffer | string) => {
    log = `${log}${chunk}`.slice(-16_000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  recordProcess(child.pid, port);

  try {
    assertStartActive(control);
    await waitForReady(child, url, () => log);
    assertStartActive(control);
  } catch (error) {
    await terminateChild(child);
    forgetProcess();
    if (control.cancelled) throw new StartCancelledError();
    throw error;
  }

  const state: ServiceState = {
    child,
    url,
    register,
    cycleSeconds,
    startedAt: Date.now(),
    get log() {
      return log;
    },
  };
  // A process that dies later must not leave a service record the next read
  // trusts; the keepalive in ./supervisor.ts is what brings it back.
  child.once("exit", () => {
    if (runtimeGlobal.__breadboardPaperTraderArena === state) {
      runtimeGlobal.__breadboardPaperTraderArena = null;
      forgetProcess();
    }
  });
  runtimeGlobal.__breadboardPaperTraderArena = state;
  return state;
}

function createStartAttempt(register: string, cycleSeconds: number): StartAttempt {
  const control: StartControl = { child: null, cancelled: false };
  const promise = start(register, cycleSeconds, control).finally(() => {
    if (runtimeGlobal.__breadboardPaperTraderStarting?.control === control) {
      runtimeGlobal.__breadboardPaperTraderStarting = null;
    }
  });
  return { register, cycleSeconds, control, promise };
}

async function cancelStart(attempt: StartAttempt): Promise<void> {
  attempt.control.cancelled = true;
  await terminateChild(attempt.control.child);
  try {
    await attempt.promise;
  } catch {
    // Cancellation is the requested outcome. The original start caller receives
    // the rejection from the same promise and can report it if still present.
  }
  if (runtimeGlobal.__breadboardPaperTraderStarting === attempt) {
    runtimeGlobal.__breadboardPaperTraderStarting = null;
  }
}

function beginStopping(operation: () => Promise<void>): Promise<void> {
  const existing = runtimeGlobal.__breadboardPaperTraderStopping;
  if (existing) return existing;
  const stopping = operation().finally(() => {
    if (runtimeGlobal.__breadboardPaperTraderStopping === stopping) {
      runtimeGlobal.__breadboardPaperTraderStopping = null;
    }
  });
  runtimeGlobal.__breadboardPaperTraderStopping = stopping;
  return stopping;
}

/**
 * The running backend, started if necessary — and restarted when the list of
 * things it may trade has changed, because the process reads that at boot.
 */
export async function ensureArena(
  symbols: DeskRegisterEntry[],
  cycleMinutes = 5,
): Promise<ArenaService> {
  const register = deskSymbolsEnv(symbols);
  const cycleSeconds = Math.max(60, Math.round(cycleMinutes * 60));
  const stopGeneration = runtimeGlobal.__breadboardPaperTraderStopGeneration ?? 0;

  while (true) {
    const stopping = runtimeGlobal.__breadboardPaperTraderStopping;
    if (stopping) {
      await stopping;
      if ((runtimeGlobal.__breadboardPaperTraderStopGeneration ?? 0) !== stopGeneration) {
        throw new StartCancelledError();
      }
      continue;
    }

    const starting = runtimeGlobal.__breadboardPaperTraderStarting;
    if (starting) {
      if (starting.register === register && starting.cycleSeconds === cycleSeconds) {
        return starting.promise;
      }
      await beginStopping(() => cancelStart(starting));
      if ((runtimeGlobal.__breadboardPaperTraderStopGeneration ?? 0) !== stopGeneration) {
        throw new StartCancelledError();
      }
      continue;
    }

    const existing = runtimeGlobal.__breadboardPaperTraderArena;
    if (existing) {
      const reusable =
        existing.register === register &&
        existing.cycleSeconds === cycleSeconds &&
        existing.child.exitCode === null &&
        (await reachable(existing.url));
      if ((runtimeGlobal.__breadboardPaperTraderStopGeneration ?? 0) !== stopGeneration) {
        throw new StartCancelledError();
      }
      // Another restart may have claimed this service while reachability was in
      // flight. Only return the process that is still the published arena.
      if (reusable && runtimeGlobal.__breadboardPaperTraderArena === existing) {
        return existing;
      }
      if (runtimeGlobal.__breadboardPaperTraderArena !== existing) continue;
      // Publish the transition before yielding so every concurrent caller waits
      // for the same exit instead of starting another arena beside this one.
      runtimeGlobal.__breadboardPaperTraderArena = null;
      await beginStopping(async () => {
        await terminateChild(existing.child);
        forgetProcess();
      });
      if ((runtimeGlobal.__breadboardPaperTraderStopGeneration ?? 0) !== stopGeneration) {
        throw new StartCancelledError();
      }
      continue;
    }

    if ((runtimeGlobal.__breadboardPaperTraderStopGeneration ?? 0) !== stopGeneration) {
      throw new StartCancelledError();
    }
    const attempt = createStartAttempt(register, cycleSeconds);
    runtimeGlobal.__breadboardPaperTraderStarting = attempt;
    return attempt.promise;
  }
}

/** The backend if it is already running, without starting one. */
export function currentArena(): ArenaService | null {
  const state = runtimeGlobal.__breadboardPaperTraderArena;
  return state && state.child.exitCode === null ? state : null;
}

/** Whether a start is in progress right now. */
export function arenaStarting(): boolean {
  return Boolean(
    runtimeGlobal.__breadboardPaperTraderStarting &&
      !runtimeGlobal.__breadboardPaperTraderStarting.control.cancelled,
  );
}

/**
 * Stop the backend and wait for the process to go, so a caller about to delete
 * the build it is running from does not race its open file handles.
 */
export async function stopArena(): Promise<void> {
  runtimeGlobal.__breadboardPaperTraderStopGeneration =
    (runtimeGlobal.__breadboardPaperTraderStopGeneration ?? 0) + 1;

  while (true) {
    const stopping = runtimeGlobal.__breadboardPaperTraderStopping;
    if (stopping) {
      await stopping;
      continue;
    }

    const starting = runtimeGlobal.__breadboardPaperTraderStarting;
    const state = runtimeGlobal.__breadboardPaperTraderArena;
    runtimeGlobal.__breadboardPaperTraderArena = null;

    if (starting || (state && state.child.exitCode === null)) {
      await beginStopping(async () => {
        if (starting) await cancelStart(starting);
        if (state && state.child !== starting?.control.child) {
          await terminateChild(state.child);
        }
        forgetProcess();
      });
      continue;
    }

    // Even with nothing running here, an arena from a previous process may still
    // be trading, and Stop has to mean stopped rather than merely unobserved.
    await reapOrphan();
    return;
  }
}

/**
 * Synchronous last-resort cleanup for process exit and operating-system signals.
 *
 * Normal Stop awaits the child and verifies orphan state. An exiting Node
 * process cannot do asynchronous work, but it can still fence a pending start
 * and signal every child it owns. The desktop supervisor also terminates the
 * full process tree, making this the graceful first line rather than the only
 * line of defence.
 */
export function stopArenaForProcessExit(): void {
  runtimeGlobal.__breadboardPaperTraderStopGeneration =
    (runtimeGlobal.__breadboardPaperTraderStopGeneration ?? 0) + 1;
  const starting = runtimeGlobal.__breadboardPaperTraderStarting;
  if (starting) starting.control.cancelled = true;
  const state = runtimeGlobal.__breadboardPaperTraderArena;
  runtimeGlobal.__breadboardPaperTraderArena = null;
  kill(starting?.control.child);
  if (state?.child !== starting?.control.child) kill(state?.child);
}

/** The tail of the running process's output, for a failure report. */
export function arenaLog(): string {
  return lastLines(runtimeGlobal.__breadboardPaperTraderArena?.log ?? "", 10);
}

/** Where the arena keeps its portfolio, for the read-only side of the card. */
export function arenaDatabasePath(): string {
  return databasePath();
}

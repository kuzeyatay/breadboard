import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import * as path from "node:path";
import { waitForHealthy, delay, type HealthCheckSpec } from "./health-checker";
import { killProcessTree } from "./process-tree";
import type { LogManager } from "./log-manager";

export interface DesktopServiceDefinition {
  id: string;
  displayName: string;
  required: boolean;
  /**
   * Start the service without holding the startup screen open. Intended for
   * optional leaf integrations whose readiness can take minutes.
   */
  startInBackground?: boolean;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  dependsOn?: string[];
  healthCheck?: HealthCheckSpec & { intervalMs: number };
  startupTimeoutMs: number;
  gracefulShutdownMs: number;
  restartPolicy: "never" | "on-failure";
  /** Development source files that require a clean service reload on change. */
  restartOnChange?: string[];
}

export type ServiceState =
  | "pending"
  | "starting"
  | "healthy"
  | "degraded"
  | "failed"
  | "stopping"
  | "stopped";

export interface ServiceStatus {
  id: string;
  displayName: string;
  required: boolean;
  state: ServiceState;
  pid: number | null;
  lastError: string | null;
  restarts: number;
}

interface ManagedService {
  definition: DesktopServiceDefinition;
  state: ServiceState;
  child: ChildProcess | null;
  lastError: string | null;
  restarts: number;
  restartTimestamps: number[];
  stopRequested: boolean;
  changeWatchers: FSWatcher[];
  sourceRestartTimer: ReturnType<typeof setTimeout> | null;
  sourceRestartInProgress: boolean;
}

export interface ServiceManagerEvents {
  "state-changed": (status: ServiceStatus) => void;
  "log-line": (serviceId: string, line: string) => void;
  "fatal": (serviceId: string, reason: string) => void;
}

const MAX_RESTARTS_IN_WINDOW = 3;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const RESTART_BACKOFF_MS = [1_000, 5_000, 15_000];

/**
 * Typed service supervisor. The Electron main process is the only spawner of
 * Breadboard services; every child is started hidden (no console windows),
 * logged, health-checked, and terminated as a full process tree on shutdown.
 */
export class ServiceManager extends EventEmitter {
  private readonly services = new Map<string, ManagedService>();
  private readonly logs: LogManager;
  private shuttingDown = false;

  constructor(logs: LogManager) {
    super();
    this.logs = logs;
  }

  register(definition: DesktopServiceDefinition): void {
    if (this.services.has(definition.id)) {
      throw new Error(`Service "${definition.id}" is already registered`);
    }
    this.services.set(definition.id, {
      definition,
      state: "pending",
      child: null,
      lastError: null,
      restarts: 0,
      restartTimestamps: [],
      stopRequested: false,
      changeWatchers: [],
      sourceRestartTimer: null,
      sourceRestartInProgress: false,
    });
  }

  status(id: string): ServiceStatus {
    const managed = this.requireService(id);
    return toStatus(managed);
  }

  allStatuses(): ServiceStatus[] {
    return [...this.services.values()].map(toStatus);
  }

  tailLog(id: string, maxLines = 40): string[] {
    return this.logs.forService(id).readTail(maxLines);
  }

  /**
   * Compute a dependency-ordered start plan: an array of "waves"; services in
   * the same wave start in parallel. Throws on unknown or cyclic dependencies.
   */
  startPlan(): string[][] {
    const remaining = new Map<string, Set<string>>();
    for (const [id, managed] of this.services) {
      const deps = new Set(managed.definition.dependsOn ?? []);
      for (const dep of deps) {
        if (!this.services.has(dep)) {
          throw new Error(`Service "${id}" depends on unknown service "${dep}"`);
        }
      }
      remaining.set(id, deps);
    }
    const waves: string[][] = [];
    const done = new Set<string>();
    while (remaining.size > 0) {
      const wave = [...remaining.entries()]
        .filter(([, deps]) => [...deps].every((dep) => done.has(dep)))
        .map(([id]) => id);
      if (wave.length === 0) {
        throw new Error(`Dependency cycle among services: ${[...remaining.keys()].join(", ")}`);
      }
      for (const id of wave) {
        remaining.delete(id);
        done.add(id);
      }
      waves.push(wave);
    }
    return waves;
  }

  /**
   * Start all registered services in dependency order. Resolves when every
   * required service is healthy. Optional-service failures mark the service
   * "failed" and continue; background optional services are allowed to keep
   * starting after this resolves. A required-service failure rejects after
   * cleanup of everything already started.
   */
  async startAll(): Promise<void> {
    const waves = this.startPlan();
    for (const wave of waves) {
      const results = await Promise.all(
        wave.map(async (id) => {
          const managed = this.requireService(id);
          if (managed.definition.startInBackground && !managed.definition.required) {
            void this.startService(id).catch((error) => {
              this.setState(managed, "failed", `background start error: ${message(error)}`);
            });
            return { id, ok: true };
          }
          return { id, ok: await this.startService(id) };
        }),
      );
      for (const result of results) {
        const managed = this.requireService(result.id);
        if (!result.ok && managed.definition.required) {
          const reason = managed.lastError ?? "failed to start";
          this.emit("fatal", result.id, reason);
          throw new Error(`Required service "${result.id}" failed: ${reason}`);
        }
      }
    }
  }

  /** Start (or restart) one service and wait for readiness. */
  async startService(id: string): Promise<boolean> {
    const managed = this.requireService(id);
    if (this.shuttingDown) return false;
    if (managed.state === "healthy" || managed.state === "starting") return true;

    // A dependency that failed means this service cannot start meaningfully.
    for (const dep of managed.definition.dependsOn ?? []) {
      const depManaged = this.requireService(dep);
      if (depManaged.state !== "healthy") {
        this.setState(managed, "failed", `dependency "${dep}" is not healthy`);
        return false;
      }
    }

    managed.stopRequested = false;
    this.setState(managed, "starting", null);
    const definition = managed.definition;
    const log = this.logs.forService(id);

    let child: ChildProcess;
    try {
      child = spawn(definition.command, definition.args, {
        cwd: definition.cwd,
        env: definition.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      this.setState(managed, "failed", `spawn error: ${message(error)}`);
      return false;
    }
    managed.child = child;

    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim().length === 0) continue;
        log.write(line);
        this.emit("log-line", id, line);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    let exited = false;
    let exitDescription: string | null = null;
    child.on("error", (error) => {
      exited = true;
      exitDescription = `process error: ${message(error)}`;
      log.write(`[supervisor] ${exitDescription}`);
    });
    child.on("exit", (code, signal) => {
      exited = true;
      exitDescription = `process exited (code ${code ?? "null"}, signal ${signal ?? "null"})`;
      log.write(`[supervisor] ${exitDescription}`);
      this.handleExit(id);
    });

    if (!definition.healthCheck) {
      // Process-liveness services: consider healthy after a short grace period.
      await delay(500);
      if (exited) {
        this.setState(managed, "failed", exitDescription ?? "exited immediately");
        return false;
      }
      this.setState(managed, "healthy", null);
      this.ensureChangeWatchers(managed);
      return true;
    }

    const result = await waitForHealthy(definition.healthCheck, {
      startupTimeoutMs: definition.startupTimeoutMs,
      intervalMs: definition.healthCheck.intervalMs,
      shouldAbort: () => (exited ? exitDescription ?? "process exited during startup" : null),
    });
    if (this.shuttingDown) return false;
    if (!result.ok) {
      this.setState(managed, "failed", result.reason);
      await this.terminate(managed, true);
      return false;
    }
    this.setState(managed, "healthy", null);
    this.ensureChangeWatchers(managed);
    return true;
  }

  /**
   * Watch parent directories rather than file handles so editors that replace
   * a file atomically do not detach the watcher after the first save.
   */
  private ensureChangeWatchers(managed: ManagedService): void {
    const targets = managed.definition.restartOnChange ?? [];
    if (!targets.length || managed.changeWatchers.length) return;

    const namesByDirectory = new Map<string, Set<string>>();
    for (const target of targets) {
      const absolute = path.resolve(target);
      const directory = path.dirname(absolute);
      const name = normalizedFilename(path.basename(absolute));
      const names = namesByDirectory.get(directory) ?? new Set<string>();
      names.add(name);
      namesByDirectory.set(directory, names);
    }

    const log = this.logs.forService(managed.definition.id);
    for (const [directory, names] of namesByDirectory) {
      try {
        const watcher = watch(directory, (_event, filename) => {
          if (this.shuttingDown) return;
          const changed = filename ? normalizedFilename(filename.toString()) : null;
          if (changed !== null && !names.has(changed)) return;
          this.scheduleSourceRestart(managed);
        });
        watcher.on("error", (error) => {
          log.write(`[supervisor] source watcher error: ${message(error)}`);
        });
        managed.changeWatchers.push(watcher);
      } catch (error) {
        log.write(`[supervisor] could not watch ${directory}: ${message(error)}`);
      }
    }
  }

  private scheduleSourceRestart(managed: ManagedService): void {
    if (managed.sourceRestartTimer) clearTimeout(managed.sourceRestartTimer);
    managed.sourceRestartTimer = setTimeout(() => {
      managed.sourceRestartTimer = null;
      void this.restartForSourceChange(managed);
    }, 250);
  }

  private async restartForSourceChange(managed: ManagedService): Promise<void> {
    if (this.shuttingDown || managed.stopRequested) return;
    if (managed.sourceRestartInProgress) {
      this.scheduleSourceRestart(managed);
      return;
    }
    if (!managed.child || !["healthy", "degraded"].includes(managed.state)) return;

    managed.sourceRestartInProgress = true;
    const log = this.logs.forService(managed.definition.id);
    log.write("[supervisor] integration source changed; restarting service");
    managed.restarts += 1;
    this.setState(managed, "degraded", "integration source changed; restarting");
    try {
      await this.stopService(managed.definition.id);
      if (this.shuttingDown) return;
      this.setState(managed, "pending", managed.lastError);
      await this.startService(managed.definition.id);
    } finally {
      managed.sourceRestartInProgress = false;
    }
  }

  private handleExit(id: string): void {
    const managed = this.services.get(id);
    if (!managed) return;
    managed.child = null;
    if (this.shuttingDown || managed.stopRequested) {
      this.setState(managed, "stopped", managed.lastError);
      return;
    }
    if (managed.state === "starting") {
      // startService's health wait will observe the exit and report failure.
      return;
    }
    if (managed.state !== "healthy" && managed.state !== "degraded") return;

    if (managed.definition.restartPolicy === "never") {
      this.setState(managed, "failed", "process exited unexpectedly");
      if (managed.definition.required) {
        this.emit("fatal", id, "process exited unexpectedly");
      }
      return;
    }

    const now = Date.now();
    managed.restartTimestamps = managed.restartTimestamps.filter(
      (t) => now - t < RESTART_WINDOW_MS,
    );
    if (managed.restartTimestamps.length >= MAX_RESTARTS_IN_WINDOW) {
      this.setState(
        managed,
        "failed",
        `restarted ${managed.restartTimestamps.length} times within ${Math.round(RESTART_WINDOW_MS / 60000)} minutes; giving up`,
      );
      if (managed.definition.required) {
        this.emit("fatal", id, managed.lastError ?? "restart loop");
      }
      return;
    }

    const attempt = managed.restartTimestamps.length;
    const backoff = RESTART_BACKOFF_MS[Math.min(attempt, RESTART_BACKOFF_MS.length - 1)] ?? 15_000;
    managed.restartTimestamps.push(now);
    managed.restarts += 1;
    this.setState(managed, "degraded", "process exited; restarting");
    void delay(backoff).then(async () => {
      if (this.shuttingDown || managed.stopRequested) return;
      this.setState(managed, "pending", managed.lastError);
      const ok = await this.startService(managed.definition.id);
      if (!ok && managed.definition.required) {
        this.emit("fatal", managed.definition.id, managed.lastError ?? "restart failed");
      }
    });
  }

  /** Stop one service (graceful, then forced tree kill). */
  async stopService(id: string): Promise<void> {
    const managed = this.requireService(id);
    managed.stopRequested = true;
    if (managed.child === null) {
      this.setState(managed, "stopped", managed.lastError);
      return;
    }
    this.setState(managed, "stopping", null);
    await this.terminate(managed, false);
    this.setState(managed, "stopped", managed.lastError);
  }

  /** Reverse-dependency-order shutdown of everything. */
  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    for (const managed of this.services.values()) this.closeChangeWatchers(managed);
    const waves = this.startPlan().reverse();
    for (const wave of waves) {
      await Promise.all(
        wave.map(async (id) => {
          const managed = this.requireService(id);
          managed.stopRequested = true;
          if (managed.child !== null) {
            this.setState(managed, "stopping", null);
            await this.terminate(managed, false);
          }
          this.setState(managed, "stopped", managed.lastError);
        }),
      );
    }
  }

  /** Best-effort synchronous-ish emergency cleanup (crash paths). */
  killAllNow(): void {
    this.shuttingDown = true;
    for (const managed of this.services.values()) {
      this.closeChangeWatchers(managed);
      const pid = managed.child?.pid;
      if (typeof pid === "number") {
        void killProcessTree(pid, true);
      }
    }
  }

  private async terminate(managed: ManagedService, immediate: boolean): Promise<void> {
    const child = managed.child;
    const pid = child?.pid;
    if (!child || typeof pid !== "number") {
      managed.child = null;
      return;
    }
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    });
    if (!immediate) {
      // Graceful phase. On Windows there is no cross-console Ctrl+C without a
      // console; SIGTERM via child.kill() terminates the direct child only, so
      // follow with a tree kill after the graceful window either way.
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
      await Promise.race([exited, delay(managed.definition.gracefulShutdownMs)]);
    }
    await killProcessTree(pid, true);
    await Promise.race([exited, delay(3_000)]);
    managed.child = null;
  }

  private setState(managed: ManagedService, state: ServiceState, error: string | null): void {
    managed.state = state;
    if (error !== null) managed.lastError = error;
    if (state === "healthy") managed.lastError = null;
    this.emit("state-changed", toStatus(managed));
  }

  private closeChangeWatchers(managed: ManagedService): void {
    if (managed.sourceRestartTimer) {
      clearTimeout(managed.sourceRestartTimer);
      managed.sourceRestartTimer = null;
    }
    for (const watcher of managed.changeWatchers) watcher.close();
    managed.changeWatchers = [];
  }

  private requireService(id: string): ManagedService {
    const managed = this.services.get(id);
    if (!managed) throw new Error(`Unknown service "${id}"`);
    return managed;
  }
}

function toStatus(managed: ManagedService): ServiceStatus {
  return {
    id: managed.definition.id,
    displayName: managed.definition.displayName,
    required: managed.definition.required,
    state: managed.state,
    pid: managed.child?.pid ?? null,
    lastError: managed.lastError,
    restarts: managed.restarts,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizedFilename(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

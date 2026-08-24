import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import * as path from "node:path";
import { runHealthProbe, waitForHealthy, delay, type HealthCheckSpec } from "./health-checker";
import { killProcessTree } from "./process-tree";
import type { LogManager } from "./log-manager";
import {
  ResourceMonitor,
  defaultMetricsProvider,
  describeBreach,
  type ProcessMetricsProvider,
  type ResourceBreach,
  type ServiceResourceBudget,
} from "./resource-monitor";
import {
  MemoryGovernor,
  ResourceExhaustionError,
  type HeavyConcurrencyGroup,
  type SystemMemoryMetricSource,
} from "./memory-governor";
import type { MemoryPolicy } from "./memory-policy";

export type StartPolicy = "eager" | "on-demand" | "scheduled" | "external";

export interface DesktopServiceDefinition {
  id: string;
  displayName: string;
  required: boolean;
  /**
   * Start the service without holding the startup screen open. Intended for
   * optional leaf integrations whose readiness can take minutes.
   *
   * Retained as the spelling most definitions already use; it is exactly
   * equivalent to `startupPolicy: "background"`.
   */
  startInBackground?: boolean;
  /** Explicit lifecycle policy. New definitions should use this field. */
  startPolicy?: StartPolicy;
  /**
   * When `startAll()` starts this service.
   *
   * - `eager` (the default): started in its dependency wave, and startup waits
   *   for it to become healthy.
   * - `background`: started in its wave, but startup does not wait for it.
   * - `on-demand`: **not started by `startAll()` at all**. It stays in its
   *   registered `pending` state until something explicitly calls
   *   `startService(id)`.
   *
   * The third value exists because "do not block the startup screen" and "do
   * not start until asked" are different requirements, and conflating them is
   * how an optional integration ends up running on every launch. Anything that
   * costs real resources to have running belongs behind `on-demand`.
   */
  startupPolicy?: "eager" | "background" | "on-demand";
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  dependsOn?: string[];
  healthCheck?: HealthCheckSpec & { intervalMs: number };
  /**
   * Adopt an instance that is already running instead of spawning a second one.
   *
   * Set by the lifecycle owner when its startup probe recognised a usable
   * instance on this service's port (`service-adoption.ts`). The supervisor
   * still confirms with `adoptionCheck` (or `healthCheck`) before believing it,
   * so an instance that died between the two checks is started normally.
   */
  adoptExternal?: boolean;
  /**
   * What proves a running instance is ours, when that is a stricter question
   * than "is it healthy". Hermes answers its public status endpoint for any
   * caller, so adopting on that alone would bind the app to a runtime whose
   * session token it does not hold. Defaults to `healthCheck`.
   */
  adoptionCheck?: HealthCheckSpec;
  startupTimeoutMs: number;
  gracefulShutdownMs: number;
  restartPolicy: "never" | "on-failure";
  /** Development source files that require a clean service reload on change. */
  restartOnChange?: string[];
  /**
   * Memory ceiling for this service's whole process tree. Sustained breaches
   * are contained locally instead of being left to exhaust the system commit
   * limit. Only set it for services whose footprint has actually been measured.
   */
  resourceBudget?: ServiceResourceBudget;
  idleTtlMs?: number;
  estimatedColdStartCommitMb?: number;
  softCommitLimitMb?: number;
  hardCommitLimitMb?: number;
  /** Higher values survive constrained admission longer. Core is >= 100. */
  priority?: number;
  concurrencyGroup?: HeavyConcurrencyGroup;
  /** Hot dashboard only: recycle after a soft crossing at a safe job boundary. */
  safeRecycleOnSoftLimit?: boolean;
}

/**
 * The effective startup policy for a definition.
 *
 * `startupPolicy` wins when set. Otherwise the historical pairing applies:
 * an optional service marked `startInBackground` is a background start, and
 * everything else is eager. A *required* service is always eager — startup
 * readiness means something, and a required service that startup did not wait
 * for would make it mean nothing.
 */
export function startupPolicyOf(
  definition: Pick<
    DesktopServiceDefinition,
    "required" | "startInBackground" | "startPolicy" | "startupPolicy"
  >,
): StartPolicy | "background" {
  // Required means startup readiness is part of the application contract.
  // It cannot be made lazy by a contradictory legacy or new policy field.
  if (definition.required) return "eager";
  if (definition.startPolicy) return definition.startPolicy;
  if (definition.startupPolicy) return definition.startupPolicy;
  return definition.startInBackground ? "background" : "eager";
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
  /** True when this service was already running and the app is reusing it. */
  adopted: boolean;
  activeLeases: number;
  startPolicy: StartPolicy | "background";
}

export interface ServiceLease {
  id: string;
  targetId: string;
  release(): void;
}

export interface CapabilityDefinition {
  id: string;
  estimatedColdStartCommitMb: number;
  priority: number;
  concurrencyGroup: HeavyConcurrencyGroup;
  maxLeaseMs?: number;
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
  /** Set when the running instance was adopted rather than spawned here. */
  adopted: boolean;
  /** Set when this service's *pending* termination is a memory-budget breach. */
  resourceLimited: boolean;
  /** How many times this service has been terminated for a budget breach. */
  resourceLimitKills: number;
  startPromise: Promise<boolean> | null;
  leases: Set<string>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  usingRuntimeHelper: boolean;
  softRecoveryInProgress: boolean;
  lastSoftRecycleAt: number;
}

export interface ServiceManagerEvents {
  "state-changed": (status: ServiceStatus) => void;
  "log-line": (serviceId: string, line: string) => void;
  "fatal": (serviceId: string, reason: string) => void;
  "resource-breach": (breach: ResourceBreach) => void;
}

export interface ServiceManagerOptions {
  /** Injected so tests never depend on the memory of the host machine. */
  metricsProvider?: ProcessMetricsProvider;
  /** Overrides the sampling interval derived from service budgets (tests). */
  resourceSampleIntervalMs?: number;
  memoryPolicy?: MemoryPolicy;
  systemMetrics?: SystemMemoryMetricSource;
  /** Windows Job Object helper. Missing binaries use the tested process-tree fallback. */
  runtimeSupervisorPath?: string;
}

/**
 * How long the supervisor waits on a silent-but-listening instance before
 * deciding the thing it was told to adopt is not answering after all.
 */
const ADOPTION_CONFIRM_MS = 20_000;
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
  private readonly resources: ResourceMonitor;
  private readonly governor: MemoryGovernor | null;
  private readonly memoryPolicy: MemoryPolicy | null;
  private readonly capabilities = new Map<string, CapabilityDefinition>();
  private readonly runtimeSupervisorPath: string | null;
  private readonly leases = new Map<
    string,
    { targetId: string; group?: HeavyConcurrencyGroup; timer: ReturnType<typeof setTimeout> | null }
  >();
  private shuttingDown = false;

  constructor(logs: LogManager, options: ServiceManagerOptions = {}) {
    super();
    this.logs = logs;
    this.memoryPolicy = options.memoryPolicy ?? null;
    this.runtimeSupervisorPath =
      process.platform === "win32" &&
      options.runtimeSupervisorPath &&
      existsSync(options.runtimeSupervisorPath)
        ? options.runtimeSupervisorPath
        : null;
    this.resources = new ResourceMonitor({
      provider: options.metricsProvider ?? defaultMetricsProvider(),
      ...(options.resourceSampleIntervalMs === undefined
        ? {}
        : { intervalMs: options.resourceSampleIntervalMs }),
      onBreach: (breach) => this.handleResourceBreach(breach),
      onError: (error) => {
        // Telemetry must never take the supervisor down, and a failed sample
        // must never be read as "the service is fine" or "the service is huge".
        this.logs.forService("desktop").write(`[supervisor] memory sampling failed: ${message(error)}`);
      },
    });
    this.governor = options.memoryPolicy && options.systemMetrics
      ? new MemoryGovernor({
          policy: options.memoryPolicy,
          metrics: options.systemMetrics,
          onPressure: (state, snapshot) => {
            const free = Math.round(snapshot.commitLimitMb - snapshot.commitTotalMb);
            this.logs
              .forService("desktop")
              .write(`[governor] state=${state} freeCommitMb=${free}`);
            if (state !== "normal") void this.stopIdleOptionalServices(`memory-${state}`);
          },
        })
      : null;
    this.governor?.start();
  }

  /** Test seam: run one resource sampling pass immediately. */
  async sampleResourcesNow(): Promise<void> {
    await this.resources.tick();
  }

  /** Test seam: which services currently have an active memory monitor. */
  monitoredServiceIds(): string[] {
    return this.resources.watchedServiceIds();
  }

  register(definition: DesktopServiceDefinition): void {
    if (this.services.has(definition.id)) {
      throw new Error(`Service "${definition.id}" is already registered`);
    }
    const normalized =
      !definition.resourceBudget &&
      definition.softCommitLimitMb !== undefined &&
      definition.hardCommitLimitMb !== undefined
        ? {
            ...definition,
            resourceBudget: {
              warningBytes: definition.softCommitLimitMb * 1024 * 1024,
              hardLimitBytes: definition.hardCommitLimitMb * 1024 * 1024,
              consecutiveSamplesBeforeAction: 3,
              sampleIntervalMs: 15_000,
            },
          }
        : definition;
    this.services.set(definition.id, {
      definition: normalized,
      state: "pending",
      child: null,
      lastError: null,
      restarts: 0,
      restartTimestamps: [],
      stopRequested: false,
      changeWatchers: [],
      sourceRestartTimer: null,
      sourceRestartInProgress: false,
      adopted: false,
      resourceLimited: false,
      resourceLimitKills: 0,
      startPromise: null,
      leases: new Set(),
      idleTimer: null,
      usingRuntimeHelper: false,
      softRecoveryInProgress: false,
      lastSoftRecycleAt: 0,
    });
  }

  registerCapability(definition: CapabilityDefinition): void {
    if (this.capabilities.has(definition.id) || this.services.has(definition.id)) {
      throw new Error(`Capability "${definition.id}" is already registered`);
    }
    this.capabilities.set(definition.id, definition);
  }

  status(id: string): ServiceStatus {
    const managed = this.requireService(id);
    return toStatus(managed);
  }

  allStatuses(): ServiceStatus[] {
    return [...this.services.values()].map(toStatus);
  }

  activeLeaseSummary(): Array<{ targetId: string; count: number }> {
    const counts = new Map<string, number>();
    for (const lease of this.leases.values()) {
      counts.set(lease.targetId, (counts.get(lease.targetId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([targetId, count]) => ({ targetId, count }))
      .sort((left, right) => left.targetId.localeCompare(right.targetId));
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
   * starting after this resolves. Services declared `on-demand` are skipped
   * entirely and left pending for a later explicit `startService(id)`. A
   * required-service failure rejects after cleanup of everything already
   * started.
   */
  async startAll(): Promise<void> {
    const waves = this.startPlan();
    for (const wave of waves) {
      const results = await Promise.all(
        wave.map(async (id) => {
          const managed = this.requireService(id);
          const policy = startupPolicyOf(managed.definition);
          if (policy === "on-demand" || policy === "scheduled" || policy === "external") {
            // Deliberately not started, and deliberately not a failure: an
            // on-demand service is idle by design until something asks for it.
            this.logs
              .forService(id)
              .write("[supervisor] on-demand service; not started with the app");
            return { id, ok: true };
          }
          if (policy === "background") {
            void this.startService(id).catch((error) => {
              this.setState(managed, "failed", `background start error: ${startFailureMessage(error)}`);
            });
            return { id, ok: true };
          }
          try {
            return { id, ok: await this.startService(id) };
          } catch {
            // startService records the precise rejection on the service. Keep
            // optional admission failures local, while allowing the required
            // check below to turn a core-service failure into startup failure.
            return { id, ok: false };
          }
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

  /** Single-flight start (or restart) of one service, including admission. */
  async startService(id: string): Promise<boolean> {
    const managed = this.requireService(id);
    if (this.shuttingDown) return false;
    if (managed.state === "healthy") return true;
    if (managed.startPromise) return managed.startPromise;
    const attempt = this.startServiceInner(managed);
    managed.startPromise = attempt;
    try {
      return await attempt;
    } catch (error) {
      // Admission failures used to escape while the service was still
      // "pending". AppLifecycle could then find no failed required service and
      // leave the startup renderer saying "Starting" forever.
      this.setState(managed, "failed", startFailureMessage(error));
      throw error;
    } finally {
      if (managed.startPromise === attempt) managed.startPromise = null;
    }
  }

  /** Public single-flight spelling used by server-side capability clients. */
  async ensureService(id: string): Promise<boolean> {
    return this.startService(id);
  }

  private async startServiceInner(managed: ManagedService): Promise<boolean> {
    const definition = managed.definition;
    const id = definition.id;
    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = null;
    }

    // A dependency that failed means this service cannot start meaningfully.
    for (const dep of definition.dependsOn ?? []) {
      const depManaged = this.requireService(dep);
      if (depManaged.state !== "healthy") {
        this.setState(managed, "failed", `dependency "${dep}" is not healthy`);
        return false;
      }
    }

    managed.stopRequested = false;
    this.setState(managed, "starting", null);
    const log = this.logs.forService(id);

    // Reusing a process creates no cold-start allocation. Confirm adoption
    // before reserving the budget for a process tree we will not spawn. This
    // matters most for `next dev`: an already-hot server can be safely reused
    // even when there is not enough commit headroom to compile another copy.
    if (await this.adoptRunningInstance(managed, log)) return true;

    if (this.governor) {
      await this.governor.admit({
        id,
        estimatedColdStartCommitMb: definition.estimatedColdStartCommitMb ?? 256,
        priority: definition.priority ?? (definition.required ? 100 : 50),
        required: definition.required,
        ...(definition.concurrencyGroup
          ? { concurrencyGroup: definition.concurrencyGroup }
          : {}),
        activeConcurrencyGroups: this.activeConcurrencyGroups(id),
      });
    }

    let child: ChildProcess;
    try {
      const helper = this.runtimeSupervisorPath;
      const softBytes = definition.resourceBudget?.warningBytes ?? 0;
      const hardBytes = definition.resourceBudget?.hardLimitBytes ?? 0;
      const command = helper ?? definition.command;
      const args = helper
        ? [
            "--soft-limit-bytes", String(softBytes),
            "--hard-limit-bytes", String(hardBytes),
            "--graceful-timeout-ms", String(definition.gracefulShutdownMs),
            "--",
            definition.command,
            ...definition.args,
          ]
        : definition.args;
      child = spawn(command, args, {
        cwd: definition.cwd,
        env: definition.env,
        stdio: [helper ? "pipe" : "ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        detached: process.platform !== "win32",
      });
      managed.usingRuntimeHelper = Boolean(helper);
      if (helper) log.write("[supervisor] Windows Job Object containment enabled");
    } catch (error) {
      this.setState(managed, "failed", `spawn error: ${message(error)}`);
      return false;
    }
    managed.child = child;

    const attachOutput = (stream: NodeJS.ReadableStream | null, helperProtocol: boolean) => {
      let buffered = "";
      stream?.on("data", (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        for (;;) {
          const newline = buffered.indexOf("\n");
          if (newline < 0) break;
          const line = buffered.slice(0, newline).replace(/\r$/, "");
          buffered = buffered.slice(newline + 1);
          if (line.trim().length === 0) continue;
          if (helperProtocol && this.handleRuntimeHelperEvent(managed, line)) continue;
          log.write(line);
          this.emit("log-line", id, line);
        }
      });
      stream?.on("end", () => {
        const line = buffered.trimEnd();
        if (!line) return;
        if (helperProtocol && this.handleRuntimeHelperEvent(managed, line)) return;
        log.write(line);
        this.emit("log-line", id, line);
      });
    };
    attachOutput(child.stdout, managed.usingRuntimeHelper);
    attachOutput(child.stderr, false);

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
      this.handleExit(id, child);
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
      this.beginResourceMonitoring(managed);
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
    this.beginResourceMonitoring(managed);
    return true;
  }

  private handleRuntimeHelperEvent(managed: ManagedService, line: string): boolean {
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      event = parsed as Record<string, unknown>;
    } catch {
      return false;
    }

    const kind = event.type;
    if ((kind === "stdout" || kind === "stderr") && typeof event.data === "string") {
      const targetLog = this.logs.forService(managed.definition.id);
      for (const outputLine of event.data.split(/\r?\n/)) {
        if (!outputLine) continue;
        targetLog.write(outputLine);
        this.emit("log-line", managed.definition.id, outputLine);
      }
      return true;
    }
    if (kind === "memory") return true; // high-rate telemetry is sampled centrally, not written to disk
    if (kind === "started") {
      this.logs
        .forService(managed.definition.id)
        .write(`[supervisor] contained target started pid=${typeof event.pid === "number" ? event.pid : "unknown"}`);
      return true;
    }
    if (kind === "soft-limit" || kind === "hard-limit") {
      const budget = managed.definition.resourceBudget;
      if (!budget || typeof event.jobCommitBytes !== "number") return true;
      this.handleResourceBreach({
        serviceId: managed.definition.id,
        kind: kind === "hard-limit" ? "hard-limit" : "warning",
        sample: {
          pid: managed.child?.pid ?? 0,
          privateBytes: event.jobCommitBytes,
          treePrivateBytes: event.jobCommitBytes,
          descendantCount: 0,
          sampledAt: Date.now(),
        },
        budget,
        consecutiveSamples: 1,
        trendBytes: [event.jobCommitBytes],
      });
      return true;
    }
    if (kind === "error" || kind === "exit") {
      this.logs.forService(managed.definition.id).write(`[runtime-helper] ${line.slice(0, 1_000)}`);
      return true;
    }
    return false;
  }

  /** Ensure a service is ready and hold it for the complete operation. */
  async acquireServiceLease(
    id: string,
    reason: string,
    maxLeaseMs = 60 * 60_000,
  ): Promise<ServiceLease> {
    const managed = this.requireService(id);
    const ok = await this.startService(id);
    if (!ok) throw new Error(managed.lastError ?? `Service "${id}" is unavailable.`);
    const leaseId = randomUUID();
    managed.leases.add(leaseId);
    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = null;
    }
    this.rememberLease(leaseId, id, managed.definition.concurrencyGroup, maxLeaseMs);
    this.logs
      .forService(id)
      .write(`[supervisor] lease acquired id=${leaseId} reason=${sanitizeAuditReason(reason)}`);
    return { id: leaseId, targetId: id, release: () => void this.releaseLease(leaseId) };
  }

  /** Admission-only lease for a heavyweight job or external Docker tree. */
  async acquireCapabilityLease(id: string, reason: string): Promise<ServiceLease> {
    const capability = this.capabilities.get(id);
    if (!capability) throw new Error(`Unknown capability "${id}"`);
    if (this.governor) {
      await this.governor.admit({
        id,
        estimatedColdStartCommitMb: capability.estimatedColdStartCommitMb,
        priority: capability.priority,
        required: false,
        concurrencyGroup: capability.concurrencyGroup,
        activeConcurrencyGroups: this.activeConcurrencyGroups(),
      });
    }
    const leaseId = randomUUID();
    this.rememberLease(
      leaseId,
      id,
      capability.concurrencyGroup,
      capability.maxLeaseMs ?? 2 * 60 * 60_000,
    );
    this.logs
      .forService("desktop")
      .write(`[governor] capability lease acquired target=${id} id=${leaseId} reason=${sanitizeAuditReason(reason)}`);
    return { id: leaseId, targetId: id, release: () => void this.releaseLease(leaseId) };
  }

  releaseLease(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    this.leases.delete(leaseId);
    if (lease.timer) clearTimeout(lease.timer);
    const service = this.services.get(lease.targetId);
    if (service) {
      service.leases.delete(leaseId);
      this.logs.forService(lease.targetId).write(`[supervisor] lease released id=${leaseId}`);
      this.scheduleIdleStop(service);
    } else {
      this.logs
        .forService("desktop")
        .write(`[governor] capability lease released target=${lease.targetId} id=${leaseId}`);
    }
    return true;
  }

  private rememberLease(
    leaseId: string,
    targetId: string,
    group: HeavyConcurrencyGroup | undefined,
    maxLeaseMs: number,
  ): void {
    const bounded = Math.max(30_000, Math.min(24 * 60 * 60_000, Math.floor(maxLeaseMs)));
    const timer = setTimeout(() => {
      this.logs
        .forService("desktop")
        .write(`[governor] expired abandoned lease target=${targetId} id=${leaseId}`);
      this.releaseLease(leaseId);
    }, bounded);
    timer.unref?.();
    this.leases.set(leaseId, { targetId, ...(group ? { group } : {}), timer });
  }

  private activeConcurrencyGroups(excludeServiceId?: string): Set<HeavyConcurrencyGroup> {
    const groups = new Set<HeavyConcurrencyGroup>();
    for (const [id, managed] of this.services) {
      if (id === excludeServiceId) continue;
      if (["starting", "healthy", "degraded"].includes(managed.state)) {
        if (managed.definition.concurrencyGroup) groups.add(managed.definition.concurrencyGroup);
      }
    }
    for (const lease of this.leases.values()) if (lease.group) groups.add(lease.group);
    return groups;
  }

  private scheduleIdleStop(managed: ManagedService): void {
    if (managed.leases.size > 0 || this.shuttingDown) return;
    const ttl = managed.definition.idleTtlMs;
    const policy = startupPolicyOf(managed.definition);
    if (ttl === undefined || ttl < 0 || !["on-demand", "scheduled"].includes(policy)) return;
    if (managed.idleTimer) clearTimeout(managed.idleTimer);
    managed.idleTimer = setTimeout(() => {
      managed.idleTimer = null;
      if (managed.leases.size > 0 || this.shuttingDown) return;
      this.logs.forService(managed.definition.id).write("[supervisor] idle TTL elapsed; stopping tree");
      void this.stopService(managed.definition.id);
    }, ttl);
    managed.idleTimer.unref?.();
  }

  async stopIdleOptionalServices(reason: string): Promise<void> {
    const candidates = [...this.services.values()].filter(
      (managed) =>
        !managed.definition.required &&
        managed.leases.size === 0 &&
        ["healthy", "degraded"].includes(managed.state) &&
        ["on-demand", "scheduled"].includes(startupPolicyOf(managed.definition)),
    );
    for (const managed of candidates.sort(
      (left, right) => (left.definition.priority ?? 50) - (right.definition.priority ?? 50),
    )) {
      this.logs
        .forService(managed.definition.id)
        .write(`[supervisor] stopping idle optional service (${reason})`);
      await this.stopService(managed.definition.id);
    }
  }

  /**
   * Reuse an instance that is already running instead of starting a second one.
   *
   * Only ever attempted for a definition the lifecycle owner marked
   * `adoptExternal`, and only believed when the adoption check actually
   * answers: the instance may have exited between the startup probe and this
   * moment, in which case the port is free again and a normal spawn is right.
   *
   * An adopted service has no child process here, so the supervisor neither
   * restarts nor kills it — we did not start it, and the process that did owns
   * its lifetime. It also has no memory monitor: the budget belongs to the
   * launcher that spawned the tree.
   */
  private async adoptRunningInstance(
    managed: ManagedService,
    log: ReturnType<LogManager["forService"]>,
  ): Promise<boolean> {
    const definition = managed.definition;
    if (!definition.adoptExternal) return false;
    const check = definition.adoptionCheck ?? definition.healthCheck;
    if (!check || check.type === "process") return false;
    if (!(await this.confirmAdoption(check))) {
      log.write("[supervisor] the instance that was already running is gone; starting our own");
      return false;
    }
    managed.adopted = true;
    managed.child = null;
    log.write("[supervisor] adopted the instance already running on this port; not starting a second one");
    this.setState(managed, "healthy", null);
    return true;
  }

  /**
   * Re-ask the adoption check, tolerating a server that is up but still busy.
   *
   * A held-open request is not a "no": a dev server compiling a route answers
   * nothing for many seconds and would otherwise be spawned over. An actual
   * reply — wrong status, wrong body, 401 — settles it immediately.
   */
  private async confirmAdoption(check: HealthCheckSpec): Promise<boolean> {
    const deadline = Date.now() + ADOPTION_CONFIRM_MS;
    for (;;) {
      const result = await runHealthProbe(check);
      if (result === "pass") return true;
      if (result === "answered" || result === "unreachable") return false;
      if (Date.now() >= deadline) return false;
      await delay(500);
    }
  }

  /**
   * Start sampling this service's process tree, if it declares a budget. The
   * supervised pid is only the root: `next dev` keeps its wrapper at ~65 MB
   * while the server child it forks is the process that actually grows, so the
   * monitor always measures the whole tree beneath it.
   */
  private beginResourceMonitoring(managed: ManagedService): void {
    const budget = managed.definition.resourceBudget;
    const pid = managed.child?.pid;
    if (!budget || typeof pid !== "number" || this.shuttingDown) return;
    this.resources.watch(managed.definition.id, pid, budget);
  }

  /**
   * A sustained breach is contained here: record why, write one bounded and
   * redacted diagnostic, kill the whole tree, and let the existing restart
   * policy (and its cap) decide what happens next. There is deliberately no
   * separate restart loop for resource kills.
   */
  private handleResourceBreach(breach: ResourceBreach): void {
    const managed = this.services.get(breach.serviceId);
    if (!managed) return;
    const log = this.logs.forService(breach.serviceId);
    log.write(describeBreach(breach, managed.restarts));
    this.emit("resource-breach", breach);
    if (breach.kind === "warning") {
      this.governor?.constrainNewHeavyWork();
      void this.recoverFromSoftLimit(managed);
      return;
    }

    const mb = Math.round(breach.budget.hardLimitBytes / (1024 * 1024));
    managed.resourceLimited = true;
    managed.resourceLimitKills += 1;
    managed.lastError =
      `exceeded its ${mb}MB memory budget across ` +
      `${breach.consecutiveSamples} consecutive samples; terminated by the supervisor`;
    void this.terminateForResourceLimit(managed);
  }

  private async recoverFromSoftLimit(managed: ManagedService): Promise<void> {
    await this.stopIdleOptionalServices(`${managed.definition.id}-soft-limit`);
    if (!managed.definition.safeRecycleOnSoftLimit || managed.softRecoveryInProgress) return;
    if (Date.now() - managed.lastSoftRecycleAt < 30 * 60_000) return;
    managed.softRecoveryInProgress = true;
    const deadline = Date.now() + 5 * 60_000;
    try {
      while (!this.shuttingDown && Date.now() < deadline) {
        const activeHeavyLease = [...this.leases.values()].some((lease) => Boolean(lease.group));
        if (!activeHeavyLease) {
          const snapshot = await this.governor?.refresh();
          const required =
            (this.memoryPolicy?.minFreeCommitMb ?? 0) +
            (managed.definition.estimatedColdStartCommitMb ?? 256);
          if (!snapshot || snapshot.commitLimitMb - snapshot.commitTotalMb >= required) {
            this.governor?.clearLocalPressure();
            this.logs
              .forService(managed.definition.id)
              .write("[supervisor] soft-limit recovery boundary reached; recycling hot dashboard once");
            managed.lastSoftRecycleAt = Date.now();
            await this.stopService(managed.definition.id);
            if (!this.shuttingDown) {
              this.setState(managed, "pending", managed.lastError);
              await this.startService(managed.definition.id);
            }
            return;
          }
        }
        await delay(5_000);
      }
      this.logs
        .forService(managed.definition.id)
        .write("[supervisor] soft-limit recycle deferred; no safe boundary was reached");
    } finally {
      managed.softRecoveryInProgress = false;
    }
  }

  private async terminateForResourceLimit(managed: ManagedService): Promise<void> {
    if (this.shuttingDown || managed.stopRequested || managed.child === null) return;
    // Not stopService(): a resource kill is an involuntary failure. It is
    // deliberately not retried by handleExit; repeating the same workload
    // after resource exhaustion is not recovery.
    await this.terminate(managed, true);
  }

  /**
   * Watch parent directories rather than file handles so editors that replace
   * a file atomically do not detach the watcher after the first save.
   */
  private ensureChangeWatchers(managed: ManagedService): void {
    const targets = managed.definition.restartOnChange ?? [];
    if (!targets.length || managed.changeWatchers.length) return;

    const pathsByDirectory = new Map<string, string[]>();
    for (const target of targets) {
      const absolute = path.resolve(target);
      const directory = path.dirname(absolute);
      const paths = pathsByDirectory.get(directory) ?? [];
      paths.push(absolute);
      pathsByDirectory.set(directory, paths);
    }

    const log = this.logs.forService(managed.definition.id);
    for (const [directory, watchedPaths] of pathsByDirectory) {
      try {
        const verifier = new SourceChangeVerifier(watchedPaths);
        const watcher = watch(directory, (event, filename) => {
          if (this.shuttingDown) return;
          const changedPaths = verifier.changedPaths(filename);
          if (changedPaths.length === 0) {
            if (filename === null) {
              log.write(
                `[supervisor] ignored ambiguous ${event} source event; watched content is unchanged`,
              );
            }
            return;
          }
          const changedNames = changedPaths.map((changedPath) => path.basename(changedPath));
          log.write(
            `[supervisor] verified source content change (${event}): ${changedNames.join(", ")}`,
          );
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

  private handleExit(id: string, exitedChild: ChildProcess): void {
    const managed = this.services.get(id);
    if (!managed) return;
    // An old process can deliver its exit event after an idle-stop and a new
    // cold start. Never let that stale event clear or restart the replacement.
    if (managed.child !== exitedChild) return;
    managed.child = null;
    // The pid is gone: never keep sampling it, and never let a stale monitor
    // survive into the next incarnation of this service.
    this.resources.unwatch(id);
    // Consume the flag here so an unrelated later crash is not misreported as
    // a memory breach; the cumulative count keeps the cap message honest.
    const resourceLimited = managed.resourceLimited;
    managed.resourceLimited = false;
    if (this.shuttingDown || managed.stopRequested) {
      // stopService/stopAll own the terminal transition. Publishing `stopped`
      // from the exit callback would let a new acquire race the still-running
      // cleanup path, which could then clear the newly spawned child.
      if (managed.state !== "stopping") this.setState(managed, "stopped", managed.lastError);
      return;
    }
    if (managed.state === "starting") {
      // startService's health wait will observe the exit and report failure.
      return;
    }
    if (managed.state !== "healthy" && managed.state !== "degraded") return;

    if (resourceLimited) {
      this.setState(
        managed,
        "failed",
        managed.lastError ?? "BREADBOARD_RESOURCE_EXHAUSTED: service memory limit exceeded",
      );
      if (managed.definition.required) {
        this.emit("fatal", id, managed.lastError ?? "service memory limit exceeded");
      }
      return;
    }

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
      const cause = managed.resourceLimitKills > 0
        ? "repeatedly exceeded its memory budget and "
        : "";
      this.setState(
        managed,
        "failed",
        `${cause}restarted ${managed.restartTimestamps.length} times within ${Math.round(RESTART_WINDOW_MS / 60000)} minutes; giving up`,
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
    this.setState(
      managed,
      "degraded",
      resourceLimited ? "exceeded its memory budget; restarting" : "process exited; restarting",
    );
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
    if (managed.leases.size > 0) {
      this.logs
        .forService(id)
        .write(`[supervisor] stop deferred; ${managed.leases.size} active lease(s)`);
      return;
    }
    managed.stopRequested = true;
    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
      managed.idleTimer = null;
    }
    this.resources.unwatch(id);
    if (managed.child === null) {
      // Adopted services included: killing a process another launcher owns
      // would take down the stack the user is actually working in.
      if (managed.adopted) {
        this.logs.forService(id).write("[supervisor] adopted instance left running; it is not ours to stop");
        managed.adopted = false;
      }
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
    this.governor?.stop();
    this.resources.stop();
    for (const leaseId of [...this.leases.keys()]) this.releaseLease(leaseId);
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
          } else if (managed.adopted) {
            // Adopted instances outlive this app deliberately: whoever started
            // them still depends on them.
            this.logs
              .forService(id)
              .write("[supervisor] adopted instance left running; it is not ours to stop");
            managed.adopted = false;
          }
          this.setState(managed, "stopped", managed.lastError);
        }),
      );
    }
  }

  /** Best-effort synchronous-ish emergency cleanup (crash paths). */
  killAllNow(): void {
    this.shuttingDown = true;
    this.governor?.stop();
    this.resources.stop();
    for (const managed of this.services.values()) {
      this.closeChangeWatchers(managed);
      const pid = managed.child?.pid;
      if (typeof pid === "number") {
        void killProcessTree(pid, true);
      }
    }
  }

  private async terminate(managed: ManagedService, immediate: boolean): Promise<void> {
    // Whatever the reason, this pid is going away; stop sampling it first so no
    // monitor outlives the process or follows a recycled pid.
    this.resources.unwatch(managed.definition.id);
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
        if (managed.usingRuntimeHelper && child.stdin?.writable) {
          child.stdin.write('{"type":"stop","force":false}\n');
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        // Already gone.
      }
      await Promise.race([exited, delay(managed.definition.gracefulShutdownMs)]);
    }
    if (immediate && managed.usingRuntimeHelper && child.stdin?.writable) {
      child.stdin.write('{"type":"stop","force":true}\n');
    }
    await killProcessTree(pid, true);
    await Promise.race([exited, delay(3_000)]);
    if (managed.child === child) {
      managed.child = null;
      managed.usingRuntimeHelper = false;
    }
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
    adopted: managed.adopted,
    activeLeases: managed.leases.size,
    startPolicy: startupPolicyOf(managed.definition),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function startFailureMessage(error: unknown): string {
  return error instanceof ResourceExhaustionError
    ? `${error.result.code}: ${error.message}`
    : message(error);
}

function normalizedFilename(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function sanitizeAuditReason(reason: string): string {
  return reason.replace(/[^a-zA-Z0-9_.:-]+/g, "-").slice(0, 80) || "operation";
}

/** Resolve only a concrete fs.watch filename. A null name is not evidence by
 * itself that any configured integration source changed; the byte verifier
 * must check every target before it can authorize a service restart. */
export function watchedSourceFilename(
  filename: string | Buffer | null,
): string | null {
  if (filename === null) return null;
  const value = filename.toString().trim();
  return value ? normalizedFilename(value) : null;
}

function sourceFingerprint(absolutePath: string): string {
  try {
    return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
  } catch {
    // Missing/unreadable is a stable state too. A later appearance, deletion,
    // or permission repair changes the fingerprint and authorizes one reload.
    return "missing";
  }
}

/** Stateful proof that a watched source's bytes actually changed. fs.watch may
 * omit the filename or emit metadata/no-op notifications, including on Windows;
 * neither is sufficient reason to terminate a healthy supervised service. */
export class SourceChangeVerifier {
  private readonly pathsByName = new Map<string, string>();
  private readonly fingerprints = new Map<string, string>();

  constructor(targets: Iterable<string>) {
    for (const target of targets) {
      const absolute = path.resolve(target);
      this.pathsByName.set(normalizedFilename(path.basename(absolute)), absolute);
      this.fingerprints.set(absolute, sourceFingerprint(absolute));
    }
  }

  changedPaths(filename: string | Buffer | null): string[] {
    const changedName = watchedSourceFilename(filename);
    const candidates = changedName === null
      ? [...this.pathsByName.values()]
      : this.pathsByName.has(changedName)
        ? [this.pathsByName.get(changedName)!]
        : [];
    const changed: string[] = [];
    for (const absolute of candidates) {
      const previous = this.fingerprints.get(absolute) ?? "missing";
      const current = sourceFingerprint(absolute);
      this.fingerprints.set(absolute, current);
      if (current !== previous) changed.push(absolute);
    }
    return changed;
  }
}

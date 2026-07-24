// Run orchestrator: the authoritative live state for active runs.
//
// Owns the state machine, approval registry, event sequencing/buffering, and
// wires the RuntimeClient to policy. The dashboard persists these normalized
// events to SQLite for durability + refresh recovery; this layer is the live
// source and streams to subscribers with sequence-number resume.

import { RunState, isTerminal } from "./run-state.ts";
import {
  ApprovalRegistry,
  ApprovalError,
  classify,
  type ProposedAction,
} from "./approval-policy.ts";
import type { ScreenshotStore } from "./screenshot-store.ts";
import type { ProcessManager } from "./process-manager.ts";
import type {
  RuntimeClient,
  RuntimeHost,
  StartRunParams,
  RunOutcome,
} from "./runtime-client.ts";
import type {
  NormalizedEvent,
  NormalizedEventType,
  RunFailure,
  RunStatus,
  UITarsAgentConfiguration,
  ApprovalRequest,
} from "./types.ts";

export interface CreateRunParams {
  runId: string;
  ownerUserId: number;
  task: string;
  config: UITarsAgentConfiguration;
  providerApiKey?: string;
}

export interface RunSummary {
  runId: string;
  ownerUserId: number;
  status: RunStatus;
  task: string;
  operatorType: "browser";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failure?: RunFailure;
  lastSequence: number;
  pendingApproval?: ApprovalRequest;
}

interface ManagedRun {
  state: RunState;
  ownerUserId: number;
  task: string;
  config: UITarsAgentConfiguration;
  providerApiKey?: string;
  events: NormalizedEvent[];
  subscribers: Set<(e: NormalizedEvent) => void>;
  abort: AbortController;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failure?: RunFailure;
  actionCount: number;
  lastScreenshotId?: string;
  timeoutTimer?: NodeJS.Timeout;
  done: Promise<void>;
}

const MAX_EVENTS_PER_RUN = 10_000;
const MAX_TASK_LENGTH = 8_000;

export interface RunManagerOptions {
  maxConcurrentRuns: number;
  screenshotRetentionMs: number;
  redact: (line: string) => string;
  now?: () => number;
}

export class RunManagerError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "RunManagerError";
    this.code = code;
  }
}

export class RunManager {
  private runs = new Map<string, ManagedRun>();
  private approvals: ApprovalRegistry;
  private client: RuntimeClient;
  private screenshots: ScreenshotStore;
  private processes: ProcessManager;
  private opts: RunManagerOptions;

  constructor(
    client: RuntimeClient,
    screenshots: ScreenshotStore,
    processes: ProcessManager,
    opts: RunManagerOptions,
  ) {
    this.client = client;
    this.screenshots = screenshots;
    this.processes = processes;
    this.opts = opts;
    this.approvals = new ApprovalRegistry(opts.now);
  }

  private activeCount(): number {
    let n = 0;
    for (const r of this.runs.values()) if (!r.state.terminal) n += 1;
    return n;
  }

  create(params: CreateRunParams): RunSummary {
    if (this.runs.has(params.runId)) throw new RunManagerError("run_exists");
    if (typeof params.task !== "string" || params.task.trim().length === 0) {
      throw new RunManagerError("empty_task");
    }
    if (params.task.length > MAX_TASK_LENGTH) throw new RunManagerError("task_too_long");
    if (this.activeCount() >= this.opts.maxConcurrentRuns) throw new RunManagerError("too_many_runs");

    const run: ManagedRun = {
      state: new RunState(params.runId),
      ownerUserId: params.ownerUserId,
      task: params.task,
      config: params.config,
      ...(params.providerApiKey ? { providerApiKey: params.providerApiKey } : {}),
      events: [],
      subscribers: new Set(),
      abort: new AbortController(),
      createdAt: new Date(this.nowMs()).toISOString(),
      actionCount: 0,
      done: Promise.resolve(),
    };
    this.runs.set(params.runId, run);
    this.emit(run, "run.queued", { task: run.task });
    run.done = this.execute(run);
    return this.summary(params.runId);
  }

  private nowMs(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private emit(run: ManagedRun, type: NormalizedEventType, payload: Record<string, unknown>): NormalizedEvent {
    const event: NormalizedEvent = {
      runId: run.state.runId,
      sequenceNumber: run.state.allocateSequence(),
      type,
      at: new Date(this.nowMs()).toISOString(),
      payload,
    };
    if (run.events.length < MAX_EVENTS_PER_RUN) run.events.push(event);
    for (const sub of run.subscribers) {
      try {
        sub(event);
      } catch {
        // a broken subscriber must never break the run
      }
    }
    return event;
  }

  private safeTransition(run: ManagedRun, to: RunStatus): boolean {
    try {
      run.state.transition(to);
      return true;
    } catch {
      // Invalid transitions are rejected and logged (never crash the run).
      this.emit(run, "run.status", { note: "invalid_transition_rejected", to });
      return false;
    }
  }

  private buildHost(run: ManagedRun): RuntimeHost {
    const redact = this.opts.redact;
    return {
      signal: run.abort.signal,
      status: (text) => {
        this.emit(run, "run.status", { message: redact(String(text)) });
      },
      page: (info) => {
        this.emit(run, "observation.page", {
          url: info.url ? redact(info.url) : undefined,
          title: info.title ? redact(info.title) : undefined,
        });
      },
      screenshot: (data) => {
        const seq = run.state.nextSequence;
        if (data.base64) {
          void this.screenshots
            .put(run.state.runId, seq, data.base64)
            .then((stored) => {
              run.lastScreenshotId = stored.screenshotId;
              this.emit(run, "observation.screenshot", {
                screenshotId: stored.screenshotId,
                caption: data.caption ? redact(data.caption) : undefined,
              });
            })
            .catch(() => {
              this.emit(run, "run.status", { note: "screenshot_store_failed" });
            });
        }
      },
      actionStarted: (a) => {
        run.actionCount += 1;
        this.emit(run, "action.started", { actionId: a.actionId, action: a.action, target: redact(a.target) });
        if (run.actionCount > run.config.maxSteps) {
          this.fail(run, "max_steps_exceeded", "Run exceeded the configured maximum steps");
        }
      },
      actionCompleted: (a) => {
        this.emit(run, "action.completed", { actionId: a.actionId, summary: a.summary ? redact(a.summary) : undefined });
      },
      actionFailed: (a) => {
        this.emit(run, "action.failed", { actionId: a.actionId, error: redact(a.error) });
      },
      requestApproval: (action) => this.gate(run, action),
      ownBrowser: (pid, profileDir) => {
        this.processes.register(run.state.runId, pid, profileDir);
      },
    };
  }

  /** Apply policy to a proposed action; pause + await human decision if sensitive. */
  private async gate(run: ManagedRun, action: ProposedAction): Promise<boolean> {
    const c = classify(action, run.config);
    this.emit(run, "action.proposed", {
      action: action.action,
      target: this.opts.redact(action.target),
      sensitive: c.sensitive,
      risk: c.risk,
    });
    if (!c.sensitive) return true;
    if (run.abort.signal.aborted || run.state.terminal) return false;

    let resolveGate!: (d: "approved" | "rejected") => void;
    const gate = new Promise<"approved" | "rejected">((res) => (resolveGate = res));
    const request = this.approvals.create({
      runId: run.state.runId,
      action: action.action,
      target: this.opts.redact(action.target),
      explanation: c.explanation,
      risk: c.risk,
      ...(run.lastScreenshotId ? { screenshotBefore: run.lastScreenshotId } : {}),
      resolve: resolveGate,
    });

    if (!this.safeTransition(run, "awaiting_approval")) return false;
    this.emit(run, "approval.requested", {
      actionId: request.actionId,
      action: request.action,
      target: request.target,
      explanation: request.explanation,
      risk: request.risk,
      screenshotBefore: request.screenshotBefore,
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt,
    });

    const decision = await gate;
    if (decision === "approved") {
      this.safeTransition(run, "running");
      this.emit(run, "approval.approved", { actionId: request.actionId });
      return true;
    }
    // Rejected (or invalidated): the action must NOT execute. Trip abort so the
    // real runtime's pre-execution abort check prevents the tool from running.
    this.emit(run, "approval.rejected", { actionId: request.actionId });
    this.abort(run.state.runId, { reason: "rejected" });
    return false;
  }

  private async execute(run: ManagedRun): Promise<void> {
    if (!this.safeTransition(run, "starting")) return;
    this.emit(run, "run.status", { message: "Starting run" });
    if (!this.safeTransition(run, "running")) return;
    run.startedAt = new Date(this.nowMs()).toISOString();
    this.emit(run, "run.started", { task: run.task, strategy: run.config.browserStrategy });

    run.timeoutTimer = setTimeout(() => {
      this.fail(run, "timeout", "Run exceeded the configured time limit");
    }, run.config.timeoutMs);

    let outcome: RunOutcome;
    try {
      outcome = await this.client.run(
        {
          runId: run.state.runId,
          task: run.task,
          config: run.config,
          ...(run.providerApiKey ? { providerApiKey: run.providerApiKey } : {}),
        } satisfies StartRunParams,
        this.buildHost(run),
      );
    } catch (err) {
      outcome = { status: "runtime_lost", failure: { code: "runtime_error", message: "Runtime failed" } };
    } finally {
      if (run.timeoutTimer) clearTimeout(run.timeoutTimer);
    }

    // The gate/timeout may have already driven a terminal state; respect it.
    if (run.state.terminal) {
      this.finalizeProcesses(run);
      return;
    }

    switch (outcome.status) {
      case "completed":
        this.safeTransition(run, "completed");
        run.completedAt = new Date(this.nowMs()).toISOString();
        this.emit(run, "run.completed", { summary: outcome.summary ? this.opts.redact(outcome.summary) : undefined });
        break;
      case "aborted":
        this.safeTransition(run, "aborted");
        run.completedAt = new Date(this.nowMs()).toISOString();
        this.emit(run, "run.aborted", {});
        break;
      case "failed":
        run.failure = outcome.failure ?? { code: "failed", message: "Run failed" };
        this.safeTransition(run, "failed");
        run.completedAt = new Date(this.nowMs()).toISOString();
        this.emit(run, "run.failed", { code: run.failure.code, message: this.opts.redact(run.failure.message) });
        break;
      case "runtime_lost":
      default:
        run.failure = outcome.failure ?? { code: "runtime_lost", message: "Runtime disconnected" };
        this.emit(run, "runtime.disconnected", { code: run.failure.code });
        this.safeTransition(run, "runtime_lost");
        run.completedAt = new Date(this.nowMs()).toISOString();
        break;
    }
    this.finalizeProcesses(run);
  }

  private finalizeProcesses(run: ManagedRun): void {
    // Always release the owned browser + approvals for a finished run.
    this.approvals.invalidateRun(run.state.runId);
    this.processes.killRun(run.state.runId);
  }

  private fail(run: ManagedRun, code: string, message: string): void {
    if (run.state.terminal) return;
    run.failure = { code, message };
    run.abort.abort();
    if (run.timeoutTimer) clearTimeout(run.timeoutTimer);
    this.safeTransition(run, "failed");
    run.completedAt = new Date(this.nowMs()).toISOString();
    this.emit(run, "run.failed", { code, message: this.opts.redact(message) });
    this.finalizeProcesses(run);
  }

  // ---------------- public control surface ----------------

  approve(runId: string, actionId: string, userId: number): void {
    const run = this.requireOwned(runId, userId);
    this.assertOwnerMatchesApproval(run);
    this.approvals.decide(actionId, "approved", { runId, userId });
  }

  reject(runId: string, actionId: string, userId: number): void {
    const run = this.requireOwned(runId, userId);
    this.assertOwnerMatchesApproval(run);
    this.approvals.decide(actionId, "rejected", { runId, userId });
  }

  private assertOwnerMatchesApproval(_run: ManagedRun): void {
    // Ownership already enforced by requireOwned; hook kept for clarity.
  }

  abort(runId: string, opts: { userId?: number; reason?: string } = {}): void {
    const run = this.runs.get(runId);
    if (!run) throw new RunManagerError("run_not_found");
    if (opts.userId !== undefined && run.ownerUserId !== opts.userId) {
      throw new RunManagerError("forbidden");
    }
    if (run.state.terminal) return;
    if (run.timeoutTimer) clearTimeout(run.timeoutTimer);
    run.abort.abort();
    this.approvals.invalidateRun(runId);
    this.safeTransition(run, "aborted");
    run.completedAt = new Date(this.nowMs()).toISOString();
    this.emit(run, "run.aborted", { reason: opts.reason });
    this.processes.killRun(runId);
  }

  private requireOwned(runId: string, userId: number): ManagedRun {
    const run = this.runs.get(runId);
    if (!run) throw new RunManagerError("run_not_found");
    if (run.ownerUserId !== userId) throw new RunManagerError("forbidden");
    return run;
  }

  summary(runId: string, userId?: number): RunSummary {
    const run = this.runs.get(runId);
    if (!run) throw new RunManagerError("run_not_found");
    if (userId !== undefined && run.ownerUserId !== userId) throw new RunManagerError("forbidden");
    const pending = this.approvals.pendingForRun(runId)[0];
    return {
      runId,
      ownerUserId: run.ownerUserId,
      status: run.state.status,
      task: run.task,
      operatorType: "browser",
      createdAt: run.createdAt,
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      ...(run.failure ? { failure: run.failure } : {}),
      lastSequence: run.state.nextSequence - 1,
      ...(pending ? { pendingApproval: pending } : {}),
    };
  }

  /** Buffered events strictly after `sinceSequence`, for resume. */
  eventsSince(runId: string, sinceSequence: number, userId?: number): NormalizedEvent[] {
    const run = this.runs.get(runId);
    if (!run) throw new RunManagerError("run_not_found");
    if (userId !== undefined && run.ownerUserId !== userId) throw new RunManagerError("forbidden");
    return run.events.filter((e) => e.sequenceNumber > sinceSequence);
  }

  subscribe(runId: string, userId: number, cb: (e: NormalizedEvent) => void): () => void {
    const run = this.requireOwned(runId, userId);
    run.subscribers.add(cb);
    return () => run.subscribers.delete(cb);
  }

  listForUser(userId: number): RunSummary[] {
    return [...this.runs.keys()]
      .map((id) => this.summary(id))
      .filter((s) => s.ownerUserId === userId);
  }

  isApprovalError(err: unknown): err is ApprovalError {
    return err instanceof ApprovalError;
  }

  async shutdown(): Promise<void> {
    for (const run of this.runs.values()) {
      if (run.timeoutTimer) clearTimeout(run.timeoutTimer);
      if (!run.state.terminal) {
        run.abort.abort();
        this.approvals.invalidateRun(run.state.runId);
        this.safeTransition(run, "aborted");
      }
    }
    this.processes.killAll();
    await this.client.shutdown();
  }
}

export { isTerminal };

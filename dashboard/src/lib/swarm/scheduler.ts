import { randomUUID } from "node:crypto";
import { SwarmStore } from "./store.ts";
import { SwarmError, type SwarmAttempt, type SwarmEvidenceInput, type SwarmExecutor, type SwarmHandle,
  type SwarmLease, type SwarmRun, type SwarmSnapshot, type SwarmTask } from "./types.ts";

export interface SwarmExecutionContext {
  run: SwarmRun;
  task: SwarmTask;
  attempt: SwarmAttempt;
  /** Only completed dependencies (or the candidate being reviewed) are shared. */
  dependencies: Array<{ key: string; summary: string; evidence: SwarmSnapshot["evidence"] }>;
}

export interface SwarmObservation {
  status: "running" | "completed" | "failed" | "cancelled" | "uncertain";
  summary?: string;
  error?: string;
  evidence?: SwarmEvidenceInput[];
  /** Cumulative actual usage, including nested agents and council calls. */
  totalTokens?: number;
  usageComplete?: boolean;
}

export type SwarmRecovery =
  | { status: "found"; handle: SwarmHandle }
  | { status: "absent" }
  | { status: "unknown"; reason: string };

export interface SwarmExecutorAdapter {
  /** True only when the real executor deduplicates the sealed request ID. */
  idempotentStart: boolean;
  start(context: SwarmExecutionContext): Promise<SwarmHandle>;
  recover(context: SwarmExecutionContext): Promise<SwarmRecovery>;
  observe(context: SwarmExecutionContext, handle: SwarmHandle): Promise<SwarmObservation>;
  /** Request stop. Observe must still prove the process has actually stopped. */
  cancel(context: SwarmExecutionContext, handle: SwarmHandle): Promise<void>;
}

/** Adapters use this only for validation failures before any executor started. */
export class SwarmStartRejected extends Error {}

export interface SwarmTickResult {
  acquired: boolean;
  started: number;
  observed: number;
  needsCoordinator: boolean;
  status: SwarmRun["status"];
}

const OBSERVABLE = new Set(["starting", "running", "cancelling", "uncertain"]);

export class SwarmScheduler {
  readonly store: SwarmStore;
  readonly executor: (executor: SwarmExecutor) => SwarmExecutorAdapter;
  readonly owner: string;
  constructor(store: SwarmStore, executor: (executor: SwarmExecutor) => SwarmExecutorAdapter, owner = `coordinator_${randomUUID()}`) {
    this.store = store; this.executor = executor; this.owner = owner;
  }

  private context(snapshot: SwarmSnapshot, attempt: SwarmAttempt): SwarmExecutionContext {
    const task = snapshot.tasks.find(item => item.key === attempt.taskKey);
    if (!task) throw new SwarmError("swarm_task_missing", "The attempt lost its assignment.", 409);
    return { run: snapshot.run, task, attempt, dependencies: task.dependsOn.flatMap(key => {
      const source = snapshot.tasks.find(item => item.key === key);
      return source && (source.status === "completed" || (task.verifies === key && source.status === "verifying"))
        ? [{ key, summary: source.summary, evidence: snapshot.evidence.filter(item => item.taskKey === key && item.attemptId === source.activeAttemptId) }] : [];
    }) };
  }

  private warning(lease: SwarmLease, taskKey: string, error: unknown): void {
    if (error instanceof SwarmError && error.code === "swarm_stale_coordinator") throw error;
    this.store.checkpoint(lease, "task.observation_pending", taskKey, {
      reason: error instanceof Error ? error.message.slice(0, 1_000) : "Waiting for executor state.",
    });
  }

  private async start(lease: SwarmLease, context: SwarmExecutionContext, adapter: SwarmExecutorAdapter): Promise<boolean> {
    try {
      const handle = await adapter.start(context);
      this.store.attach(lease, context.attempt.id, handle);
      return true;
    } catch (error) {
      if (error instanceof SwarmStartRejected) {
        this.store.reportUsage(lease, context.attempt.id, 0, true);
        this.store.settle(lease, context.attempt.id, "failed", "The executor did not start.", error.message);
      } else {
        // A timeout can occur after an accepted start. Keep its reservation and
        // request ID; the next pass reconciles that exact attempt.
        this.warning(lease, context.task.key, error);
      }
      return false;
    }
  }

  private async reconcile(lease: SwarmLease, context: SwarmExecutionContext): Promise<void> {
    const adapter = this.executor(context.task.executor);
    let handle = context.attempt.handle;
    if (!handle) {
      const recovered = await adapter.recover(context);
      if (recovered.status === "unknown") { this.warning(lease, context.task.key, new Error(recovered.reason)); return; }
      if (recovered.status === "absent") {
        if (context.attempt.status === "cancelling") {
          this.store.reportUsage(lease, context.attempt.id, 0, true);
          this.store.settle(lease, context.attempt.id, "cancelled", "Stopped before the executor started.");
        } else if (adapter.idempotentStart) {
          await this.start(lease, context, adapter);
        } else {
          this.store.settle(lease, context.attempt.id, "uncertain", "The launch has no recoverable handle; it was not replayed.");
        }
        return;
      }
      handle = recovered.handle;
      this.store.attach(lease, context.attempt.id, handle);
    }
    if (context.attempt.status === "cancelling") await adapter.cancel(context, handle);
    const result = await adapter.observe(context, handle);
    if (result.totalTokens !== undefined) this.store.reportUsage(lease, context.attempt.id, result.totalTokens, result.usageComplete === true);
    if (result.evidence?.length) this.store.evidence(lease, context.attempt.id, result.evidence);
    if (result.status === "running") {
      this.store.observedRunning(lease, context.attempt.id);
      return;
    }
    this.store.settle(lease, context.attempt.id, result.status, result.summary ?? "", result.error);
  }

  /** One bounded pass. Callers wake it for persisted work, never for idle chats. */
  async tick(userId: number, runId: string): Promise<SwarmTickResult> {
    const lease = this.store.acquireLease(userId, runId, this.owner);
    if (!lease) return { acquired: false, started: 0, observed: 0, needsCoordinator: false, status: this.store.get(userId, runId).status };
    let leaseError: unknown;
    const renewal = setInterval(() => {
      try {
        if (!this.store.acquireLease(userId, runId, this.owner)) leaseError = new SwarmError("swarm_stale_coordinator", "Coordinator lease expired.", 409);
      } catch (error) { leaseError = error; }
    }, 10_000);
    renewal.unref();
    let started = 0;
    let observed = 0;
    try {
      let snapshot = this.store.snapshot(userId, runId);
      // Evaluate a deadline even when every slot is occupied.
      if (snapshot.run.status === "running" && this.store.now() >= snapshot.run.deadlineAt) this.store.claimNext(lease);
      this.store.stopActiveForBudget(lease);
      snapshot = this.store.snapshot(userId, runId);
      const attempts = snapshot.attempts.filter(attempt => OBSERVABLE.has(attempt.status));
      // Observe independent jobs together; all admissions and writes remain
      // transactional. A transient failure never implies the worker died.
      const results = await Promise.allSettled(attempts.map(attempt => this.reconcile(lease, this.context(snapshot, attempt))));
      results.forEach((result, index) => {
        if (result.status === "rejected") this.warning(lease, attempts[index].taskKey, result.reason);
        else observed += 1;
      });
      if (leaseError) throw leaseError;
      this.store.stopActiveForBudget(lease);
      // Reserve a bounded batch before waiting on any startup. One slow
      // executor must not serialize unrelated task starts.
      const launches: Array<{ context: SwarmExecutionContext; adapter: SwarmExecutorAdapter }> = [];
      for (;;) {
        const claimed = this.store.claimNext(lease);
        if (!claimed) break;
        const current = this.store.snapshot(userId, runId);
        launches.push({ context: this.context(current, claimed.attempt), adapter: this.executor(claimed.task.executor) });
      }
      const starts = await Promise.allSettled(launches.map(item => this.start(lease, item.context, item.adapter)));
      starts.forEach((result, index) => {
        if (result.status === "rejected") this.warning(lease, launches[index].context.task.key, result.reason);
        else if (result.value) started += 1;
      });
      const final = this.store.snapshot(userId, runId);
      return { acquired: true, started, observed, needsCoordinator: final.tasks.some(task => ["verifying", "failed", "uncertain", "blocked", "awaiting_approval"].includes(task.status)), status: final.run.status };
    } finally {
      clearInterval(renewal);
      this.store.releaseLease(lease);
    }
  }
}

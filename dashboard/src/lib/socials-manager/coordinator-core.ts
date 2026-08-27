// The one component that owns the Postiz Docker Compose stack.
//
// Runtime V2 starts this coordinator on demand, and the coordinator itself does
// nothing until asked. It does not look for Docker, run Compose, or probe the
// engine at startup. The stack starts when — and only when — an authenticated
// server-side caller asks for it because a user operation genuinely needs
// Postiz.
//
// That split is the whole point. "Do not block the startup screen" and "do not
// start until asked" are different requirements, and the previous supervisor
// only implemented the first: it called `startStack()` on its first line, so
// every Breadboard launch woke Docker Desktop, the docker-desktop WSL VM, and
// nine containers holding roughly 3.4 GiB, whether or not anyone ever opened
// Socials Manager.
//
// Everything the coordinator needs from the outside world is injected, so the
// state machine, the coalescing, the authentication and the idle policy are all
// testable without a Docker daemon.

import type { SocialsManagerConfig } from "./config.ts";

/**
 * Where the Postiz stack is, as far as this coordinator knows.
 *
 * `stopped` is the state at launch and the state after a clean stop; `failed`
 * is a startup that did not reach an authenticated API, and is retryable.
 */
export type PostizStackState = "stopped" | "starting" | "ready" | "stopping" | "failed";

/** Who the running containers belong to. Decides what may be stopped, and when. */
export type StackOwnership = "unknown" | "pre-existing" | "breadboard";

/**
 * Why something wants Postiz. A closed set: it is written to the log and
 * returned in API responses, so it must never be a caller-controlled string.
 */
export const ACTIVATION_REASONS = [
  "run",
  "channels",
  "publish",
  "schedule",
  "sync",
  "settings",
  "manual",
  "other",
] as const;
export type ActivationReason = (typeof ACTIVATION_REASONS)[number];

export function normalizeActivationReason(value: unknown): ActivationReason {
  return (ACTIVATION_REASONS as readonly string[]).includes(value as string)
    ? (value as ActivationReason)
    : "other";
}

export interface StartOutcome {
  ok: boolean;
  /** Sanitized failure category; never raw Compose output. */
  reason?: string;
  /** True when the containers were already up before Breadboard asked. */
  preExisting: boolean;
}

/**
 * Everything the coordinator is not allowed to do for itself.
 *
 * `dockerAvailable` must never start anything — it answers whether an engine
 * is currently up, and the coordinator only consults it to label a failure.
 */
export interface CoordinatorDeps {
  config: SocialsManagerConfig;
  /** Does the Postiz backend answer right now? Plain HTTP; never touches Docker. */
  reachable: () => Promise<boolean>;
  /**
   * A sealed durable receipt proves that this exact Compose project was
   * Breadboard-started before a coordinator restart. Missing/invalid receipts
   * fail safe to pre-existing ownership and therefore can never authorize a
   * stop.
   */
  recoverOwnership?: () => Promise<boolean>;
  /** Start the engine if needed, write the override, `compose up -d`. */
  startStack: (reason: ActivationReason) => Promise<StartOutcome>;
  /** `compose down` for exactly this project. Never `-v`. */
  stopStack: () => Promise<boolean>;
  /** Poll `reachable` until the budget runs out. */
  waitForReady: (timeoutMs: number) => Promise<boolean>;
  /** Register/log in the local account and verify the public API answers. */
  bootstrap: () => Promise<{ ok: boolean; integrations: number; reason?: string }>;
  /**
   * Is there future scheduled publishing that needs Postiz and Temporal alive?
   * `known: false` means the question could not be answered, which is never
   * treated as "no".
   */
  pendingWork: () => Promise<{ known: boolean; pending: boolean; detail?: string }>;
  /** Is a container engine reachable right now? Read-only; starts nothing. */
  dockerAvailable: () => Promise<boolean>;
  now: () => number;
  log: (line: string) => void;
  /** Full activation budget, including a cold Docker Desktop start. */
  startupTimeoutMs: number;
  /** Idle window before a Breadboard-started, unused stack is brought down. 0 disables. */
  idleTimeoutMs: number;
  /** How long a caller's hold survives without being released. */
  leaseTtlMs?: number;
  /** Release native admission without changing any preserved Compose state. */
  releaseAdmission?: () => Promise<void>;
}

export interface EnsureReadyInput {
  reason?: unknown;
  /** How long *this caller* is willing to wait. The activation continues either way. */
  timeoutMs?: number;
  /** Keep the stack pinned until the returned lease is released. */
  hold?: boolean;
  /** The caller's own next scheduled publish, if it knows of one. */
  nextScheduledAt?: string | null;
  /** Authenticated caller binding supplied by the control server. */
  scopeKey?: string;
}

export interface EnsureReadyResult {
  state: PostizStackState;
  ready: boolean;
  ownership: StackOwnership;
  integrations: number | null;
  /** Present only when `hold` was requested and the stack is ready. */
  leaseId?: string;
  reason?: string;
  /** Milliseconds this caller waited. Never includes another caller's wait. */
  waitedMs: number;
}

export interface CoordinatorSnapshot {
  state: PostizStackState;
  ownership: StackOwnership;
  integrations: number | null;
  reason: string | null;
  leases: number;
  idleTimeoutMs: number;
  /** Milliseconds until the idle check next considers stopping, or null. */
  idleInMs: number | null;
  lastActivationReason: ActivationReason | null;
  lastStartupMs: number | null;
}

const DEFAULT_LEASE_TTL_MS = 30 * 60_000;

interface Lease {
  id: string;
  reason: ActivationReason;
  expiresAt: number;
  scopeKey: string;
}

/**
 * The Postiz lifecycle state machine.
 *
 * One instance per coordinator process. Every mutation happens here; reads
 * (`snapshot`) never touch Docker, never start anything, and never change
 * state, which is what makes status polling safe to do on a timer.
 */
export class PostizCoordinator {
  private readonly deps: CoordinatorDeps;
  private state: PostizStackState = "stopped";
  private ownership: StackOwnership = "unknown";
  private integrations: number | null = null;
  private reason: string | null = null;
  private activation: Promise<EnsureReadyResult> | null = null;
  private shutdown: Promise<boolean> | null = null;
  private readonly leases = new Map<string, Lease>();
  private lastActivityAt: number;
  private nextScheduledAt: number | null = null;
  private lastActivationReason: ActivationReason | null = null;
  private lastStartupMs: number | null = null;
  private leaseCounter = 0;
  private closed = false;
  /** The last idle refusal already logged, so a held stack says so only once. */
  private lastIdleRefusal: string | null = null;

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
    this.lastActivityAt = deps.now();
  }

  /** Side-effect-free. Safe to poll. */
  snapshot(): CoordinatorSnapshot {
    this.expireLeases();
    const idle = this.deps.idleTimeoutMs;
    return {
      state: this.state,
      ownership: this.ownership,
      integrations: this.integrations,
      reason: this.reason,
      leases: this.leases.size,
      idleTimeoutMs: idle,
      idleInMs:
        idle > 0 && this.state === "ready" && this.leases.size === 0
          ? Math.max(0, this.lastActivityAt + idle - this.deps.now())
          : null,
      lastActivationReason: this.lastActivationReason,
      lastStartupMs: this.lastStartupMs,
    };
  }

  /**
   * The only way the stack ever starts.
   *
   * Concurrent callers share one attempt: the second caller awaits the first
   * one's promise rather than issuing a second `compose up`. A caller whose own
   * budget runs out gets an honest "still starting" and leaves the shared
   * attempt running, so a cold Docker start degrades to local drafting instead
   * of stalling the user's turn.
   */
  async ensureReady(input: EnsureReadyInput = {}): Promise<EnsureReadyResult> {
    const reason = normalizeActivationReason(input.reason);
    this.noteActivity(input.nextScheduledAt);
    if (this.closed) {
      return this.result({ reason: "coordinator_shutting_down", waitedMs: 0 });
    }

    // Serialize against a stop already in progress so "start during stop" has
    // one answer rather than a race: the stop finishes, then this starts.
    if (this.shutdown) await this.shutdown.catch(() => false);

    const budget = clampBudget(input.timeoutMs, this.deps.startupTimeoutMs);
    const startedWaiting = this.deps.now();

    if (this.state === "ready" && (await this.deps.reachable())) {
      // Already up: reuse it. No Compose command, no Docker command.
      return this.result({
        waitedMs: this.deps.now() - startedWaiting,
        ...(input.hold ? { leaseId: this.openLease(reason, input.scopeKey) } : {}),
      });
    }

    const attempt = this.activation ?? this.beginActivation(reason);
    const outcome = await raceBudget(attempt, budget, this.deps, () =>
      this.result({
        state: "starting",
        reason: "Postiz is still starting.",
        waitedMs: this.deps.now() - startedWaiting,
      }),
    );

    if (outcome.ready && input.hold) {
      return {
        ...outcome,
        leaseId: this.openLease(reason, input.scopeKey),
        waitedMs: this.deps.now() - startedWaiting,
      };
    }
    return { ...outcome, waitedMs: this.deps.now() - startedWaiting };
  }

  private beginActivation(reason: ActivationReason): Promise<EnsureReadyResult> {
    const startedAt = this.deps.now();
    this.state = "starting";
    this.reason = null;
    this.lastActivationReason = reason;
    this.deps.log(`[postiz] activation requested (reason=${reason})`);

    const attempt = this.runActivation(reason, startedAt).finally(() => {
      // Cleared unconditionally, including on failure, so a later caller can
      // retry rather than inheriting a settled failed attempt forever.
      this.activation = null;
    });
    this.activation = attempt;
    return attempt;
  }

  private async runActivation(
    reason: ActivationReason,
    startedAt: number,
  ): Promise<EnsureReadyResult> {
    try {
      // A stack someone else already started is claimed as pre-existing: it is
      // usable, but Breadboard never stops it on its own.
      if (await this.deps.reachable()) {
        if (this.ownership === "unknown") {
          this.ownership = await this.deps.recoverOwnership?.()
            ? "breadboard"
            : "pre-existing";
        }
      } else {
        const started = await this.deps.startStack(reason);
        if (!started.ok) {
          return this.fail(
            started.reason ?? "The Postiz containers could not be started.",
            startedAt,
          );
        }
        this.ownership = started.preExisting ? "pre-existing" : "breadboard";
        const remaining = Math.max(
          0,
          this.deps.startupTimeoutMs - (this.deps.now() - startedAt),
        );
        if (!(await this.deps.waitForReady(remaining))) {
          return this.fail("Postiz did not answer before the startup budget ran out.", startedAt);
        }
      }

      const boot = await this.deps.bootstrap();
      if (!boot.ok) {
        return this.fail(boot.reason ?? "Postiz did not return a usable API key.", startedAt);
      }

      this.state = "ready";
      this.reason = null;
      this.integrations = boot.integrations;
      this.lastStartupMs = this.deps.now() - startedAt;
      this.noteActivity(null);
      this.deps.log(
        `[postiz] ready in ${this.lastStartupMs}ms (reason=${reason}; ` +
          `ownership=${this.ownership}; integrations=${boot.integrations})`,
      );
      return this.result({ waitedMs: 0 });
    } catch (error) {
      return this.fail(sanitize(error), startedAt);
    }
  }

  private fail(reason: string, startedAt: number): EnsureReadyResult {
    this.state = "failed";
    this.reason = reason;
    this.integrations = null;
    this.deps.log(`[postiz] activation failed after ${this.deps.now() - startedAt}ms: ${reason}`);
    return this.result({ waitedMs: 0 });
  }

  /**
   * Bring the project down. Explicit stops are always honoured — the user asked
   * — but the idle path calls this only after `idleDecision` has cleared it.
   */
  async stop(trigger: "manual" | "idle" | "exit" = "manual"): Promise<boolean> {
    if (this.shutdown) return this.shutdown;
    // A stop that arrives mid-activation waits for the activation to settle, so
    // the two never issue overlapping Compose commands.
    if (this.activation) await this.activation.catch(() => null);

    const previous = this.state;
    this.state = "stopping";
    const attempt = (async () => {
      const stopped = await this.deps.stopStack();
      this.state = stopped ? "stopped" : previous === "ready" ? "ready" : "failed";
      if (stopped) {
        this.ownership = "unknown";
        this.integrations = null;
        this.reason = null;
        this.leases.clear();
      } else {
        this.reason = "The Postiz containers could not be stopped.";
      }
      this.deps.log(`[postiz] stop (trigger=${trigger}) -> ${stopped ? "stopped" : "failed"}`);
      return stopped;
    })().finally(() => {
      this.shutdown = null;
    });
    this.shutdown = attempt;
    return attempt;
  }

  /** Pin the stack for the life of one operation. */
  openLease(reason: ActivationReason, scopeKey = "legacy"): string {
    this.expireLeases();
    this.leaseCounter += 1;
    const id = `lease-${this.leaseCounter}-${Math.floor(this.deps.now())}`;
    this.leases.set(id, {
      id,
      reason,
      expiresAt: this.deps.now() + (this.deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS),
      scopeKey,
    });
    this.noteActivity(null);
    return id;
  }

  releaseLease(id: unknown, scopeKey?: string): boolean {
    this.noteActivity(null);
    if (typeof id !== "string") return false;
    const lease = this.leases.get(id);
    if (!lease || (scopeKey !== undefined && lease.scopeKey !== scopeKey)) return false;
    return this.leases.delete(id);
  }

  activeLeases(): number {
    this.expireLeases();
    return this.leases.size;
  }

  /** Record that something used Postiz, and what it knows about future work. */
  noteActivity(nextScheduledAt?: string | null): void {
    this.lastActivityAt = this.deps.now();
    if (typeof nextScheduledAt === "string") {
      const at = Date.parse(nextScheduledAt);
      if (Number.isFinite(at)) {
        this.nextScheduledAt = this.nextScheduledAt === null ? at : Math.max(this.nextScheduledAt, at);
      }
    }
  }

  private expireLeases(): void {
    const now = this.deps.now();
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt <= now) {
        this.leases.delete(id);
        this.deps.log(`[postiz] lease expired (reason=${lease.reason})`);
      }
    }
  }

  /**
   * Decide whether an idle stack may be stopped, and say why not when it may
   * not. Every uncertainty resolves to "keep running": memory is cheaper than a
   * post that never publishes.
   */
  async idleDecision(): Promise<{ stop: boolean; reason: string }> {
    if (this.deps.idleTimeoutMs <= 0) return { stop: false, reason: "idle_stop_disabled" };
    if (this.state !== "ready") return { stop: false, reason: `state_${this.state}` };
    if (this.activation !== null || this.shutdown !== null) {
      return { stop: false, reason: "operation_in_progress" };
    }
    if (this.ownership !== "breadboard") return { stop: false, reason: "not_breadboard_started" };
    if (this.activeLeases() > 0) return { stop: false, reason: "active_lease" };
    const idleFor = this.deps.now() - this.lastActivityAt;
    if (idleFor < this.deps.idleTimeoutMs) return { stop: false, reason: "not_idle_yet" };
    if (this.nextScheduledAt !== null && this.nextScheduledAt > this.deps.now()) {
      return { stop: false, reason: "scheduled_post_pending" };
    }

    const pending = await this.deps.pendingWork();
    if (!pending.known) {
      return {
        stop: false,
        reason: `pending_work_unknown${pending.detail ? `:${pending.detail}` : ""}`,
      };
    }
    if (pending.pending) return { stop: false, reason: "scheduled_post_pending" };
    return { stop: true, reason: "idle_draft_only" };
  }

  /** One idle pass. Returns true when it actually brought the stack down. */
  async idleTick(): Promise<boolean> {
    const decision = await this.idleDecision();
    if (!decision.stop) {
      // Log the refusal once per distinct reason, not once per tick. A stack
      // that is deliberately being kept alive should say so, without turning
      // the minute-by-minute check into a log flood.
      if (decision.reason !== this.lastIdleRefusal) {
        this.lastIdleRefusal = decision.reason;
        if (decision.reason !== "not_idle_yet" && decision.reason !== "state_stopped") {
          this.deps.log(`[postiz] idle-stop declined: ${decision.reason}`);
        }
      }
      return false;
    }
    this.lastIdleRefusal = null;
    this.deps.log(`[postiz] idle for ${this.deps.idleTimeoutMs}ms with no pending work; stopping`);
    return this.stop("idle");
  }

  /**
   * Application exit. A stack Breadboard started, with nothing scheduled and
   * nothing in flight, is cleaned up; anything else is left exactly as found.
   */
  async close(): Promise<boolean> {
    this.closed = true;
    try {
      if (this.state !== "ready" || this.ownership !== "breadboard") return false;
      if (this.activeLeases() > 0) return false;
      if (this.nextScheduledAt !== null && this.nextScheduledAt > this.deps.now()) return false;
      const pending = await this.deps.pendingWork();
      if (!pending.known || pending.pending) return false;
      return this.stop("exit");
    } finally {
      // The Runtime service may exit while deliberately preserving a
      // pre-existing or scheduled stack. Drop only the native admission hold;
      // never translate service shutdown into an unconditional Compose down.
      await this.deps.releaseAdmission?.().catch(() => undefined);
    }
  }

  /** Report whether an engine is up, without starting one. Diagnostics only. */
  async dockerAvailable(): Promise<boolean> {
    return this.deps.dockerAvailable();
  }

  private result(
    overrides: Partial<EnsureReadyResult> & { waitedMs: number },
  ): EnsureReadyResult {
    const base: EnsureReadyResult = {
      state: this.state,
      ready: this.state === "ready",
      ownership: this.ownership,
      integrations: this.integrations,
      waitedMs: overrides.waitedMs,
      ...(this.reason ? { reason: this.reason } : {}),
    };
    const merged = { ...base, ...overrides };
    return { ...merged, ready: merged.state === "ready" };
  }
}

function clampBudget(requested: unknown, ceiling: number): number {
  const value = typeof requested === "number" && Number.isFinite(requested) ? requested : ceiling;
  return Math.max(0, Math.min(ceiling, Math.floor(value)));
}

/**
 * Wait for the shared attempt, but only for this caller's budget.
 *
 * The timer is always cleared, and the shared promise is never rejected or
 * cancelled by a caller giving up — that is what keeps one caller's timeout
 * from corrupting another caller's startup.
 */
async function raceBudget(
  attempt: Promise<EnsureReadyResult>,
  budget: number,
  deps: Pick<CoordinatorDeps, "log">,
  onTimeout: () => EnsureReadyResult,
): Promise<EnsureReadyResult> {
  attempt.catch(() => null);
  if (budget <= 0) return onTimeout();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), budget);
    // Never hold the process open on this timer alone.
    timer.unref?.();
  });
  try {
    const outcome = await Promise.race([attempt, expiry]);
    if (outcome === "timeout") {
      deps.log(`[postiz] caller gave up after ${budget}ms; activation continues`);
      return onTimeout();
    }
    return outcome;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Never let a raw error (which may quote Compose output) reach a caller. */
function sanitize(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split(/\r?\n/)[0] ?? "";
  return firstLine.slice(0, 200) || "Postiz activation failed.";
}

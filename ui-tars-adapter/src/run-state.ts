// Explicit run-state machine with validated transitions.
//
// Invalid transitions are rejected (and the caller logs them). A terminal run
// can never return to a non-terminal state.

import { TERMINAL_STATES, type RunStatus } from "./types.ts";

/** Allowed transitions. Anything not listed is invalid. */
const TRANSITIONS: Record<RunStatus, ReadonlySet<RunStatus>> = {
  queued: new Set<RunStatus>(["starting", "failed", "aborted"]),
  starting: new Set<RunStatus>(["running", "failed", "aborted", "runtime_lost"]),
  running: new Set<RunStatus>([
    "awaiting_approval",
    "completed",
    "failed",
    "aborted",
    "runtime_lost",
  ]),
  awaiting_approval: new Set<RunStatus>(["running", "aborted", "failed", "runtime_lost"]),
  // Terminal states: no outgoing transitions.
  completed: new Set<RunStatus>(),
  failed: new Set<RunStatus>(),
  aborted: new Set<RunStatus>(),
  runtime_lost: new Set<RunStatus>(),
};

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATES.has(status);
}

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

export class InvalidTransitionError extends Error {
  from: RunStatus;
  to: RunStatus;
  constructor(from: RunStatus, to: RunStatus) {
    super(`invalid_transition:${from}->${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * A single run's state, guarding transitions and issuing monotonic sequence
 * numbers so a reconnecting client can resume from its last received event.
 */
export class RunState {
  readonly runId: string;
  private _status: RunStatus = "queued";
  private _seq = 0;

  constructor(runId: string) {
    this.runId = runId;
  }

  get status(): RunStatus {
    return this._status;
  }

  get terminal(): boolean {
    return isTerminal(this._status);
  }

  /** Peek the next sequence number without consuming it. */
  get nextSequence(): number {
    return this._seq + 1;
  }

  /** Consume and return the next monotonic sequence number. */
  allocateSequence(): number {
    this._seq += 1;
    return this._seq;
  }

  /** Attempt a transition; throws InvalidTransitionError if not allowed. */
  transition(to: RunStatus): RunStatus {
    if (!canTransition(this._status, to)) {
      throw new InvalidTransitionError(this._status, to);
    }
    this._status = to;
    return this._status;
  }
}

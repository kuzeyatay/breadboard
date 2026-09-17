/**
 * Interaction tracing for the performance work in
 * `docs/PERFORMANCE_IMPLEMENTATION_PLAN.md` (BASE-02 … BASE-04, BASE-06).
 *
 * One record covers one thing a person did: an interaction id is assigned at
 * the input event and carried through every stage until the content they asked
 * for is usable. Stages are recorded as named marks so a regression can be
 * attributed to a span rather than to the total.
 *
 * Failures, cancellations, and timeouts are recorded like any other outcome —
 * dropping them is what makes a latency summary flattering and useless.
 */

/** The user-visible milestones the plan tracks (BASE-03). */
export const INTERACTION_FEATURES = [
  "tab-input-to-visible",
  "settings-input-to-controls",
  "settings-input-to-data",
  "pdf-input-to-first-page",
  "pdf-input-to-requested-page",
  "route-input-to-usable",
] as const;

export type InteractionFeature = (typeof INTERACTION_FEATURES)[number];

export type InteractionOutcome = "usable" | "cancelled" | "failed" | "timeout";

export interface InteractionMark {
  readonly name: string;
  /** Milliseconds since the interaction's input event. */
  readonly at: number;
}

/** Whatever else was competing for the machine during this interaction. */
export interface InteractionContention {
  /** Total time spent in renderer long tasks while the interaction ran. */
  longTaskMs: number;
  /** Requests started during the interaction, and how many repeated a URL. */
  requests: number;
  duplicateRequests: number;
  transferredBytes: number;
  cacheHits: number;
  cacheMisses: number;
  cacheStale: number;
}

export interface InteractionRecord {
  readonly id: string;
  readonly feature: InteractionFeature;
  /** Epoch milliseconds, for correlating with main-process and service logs. */
  readonly startedAt: number;
  readonly durationMs: number | null;
  readonly outcome: InteractionOutcome | null;
  /**
   * A cold interaction is the first of its kind in this process — nothing was
   * cached, nothing was compiled. Warm and cold are never summarized together.
   */
  readonly cold: boolean;
  /**
   * A refresh that happens behind already visible content. Recorded, but never
   * counted as the latency of showing that content.
   */
  readonly background: boolean;
  readonly marks: readonly InteractionMark[];
  readonly contention: InteractionContention;
}

export interface InteractionHandle {
  readonly id: string;
  readonly feature: InteractionFeature;
  /** Record a stage. Repeating a name keeps the first occurrence. */
  mark(name: string): void;
  /** Close the interaction. The first outcome wins; later calls are ignored. */
  end(outcome: InteractionOutcome): InteractionRecord | null;
  /** Whether this interaction is still open. */
  readonly open: boolean;
}

function emptyContention(): InteractionContention {
  return {
    longTaskMs: 0,
    requests: 0,
    duplicateRequests: 0,
    transferredBytes: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheStale: 0,
  };
}

/** Contention counters a host collects while interactions are open. */
export interface ContentionSource {
  /** Accumulated values since process start; the recorder takes differences. */
  sample(): InteractionContention;
}

export interface InteractionRecorderOptions {
  /** Bound on retained records; the oldest are dropped first. */
  readonly limit?: number;
  /** Monotonic clock in milliseconds. */
  readonly now?: () => number;
  /** Wall clock in epoch milliseconds. */
  readonly wallClock?: () => number;
  readonly contention?: ContentionSource;
  readonly onRecord?: (record: InteractionRecord) => void;
  /** Ceiling after which an unfinished interaction is recorded as a timeout. */
  readonly timeoutMs?: number;
  readonly idFactory?: () => string;
}

const DEFAULT_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 60_000;

export class InteractionRecorder {
  private readonly records: InteractionRecord[] = [];
  private readonly limit: number;
  private readonly now: () => number;
  private readonly wallClock: () => number;
  private readonly contention?: ContentionSource;
  private readonly onRecord?: (record: InteractionRecord) => void;
  private readonly timeoutMs: number;
  private readonly idFactory: () => string;
  private readonly seenFeatures = new Set<InteractionFeature>();
  private readonly open = new Map<string, OpenInteraction>();
  private sequence = 0;

  constructor(options: InteractionRecorderOptions = {}) {
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    this.now = options.now ?? (() => Date.now());
    this.wallClock = options.wallClock ?? (() => Date.now());
    this.contention = options.contention;
    this.onRecord = options.onRecord;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.idFactory = options.idFactory ?? (() => `i${++this.sequence}`);
  }

  /**
   * Open an interaction at its input event. `startedAt` accepts the event's own
   * timestamp so queued input is not silently excluded from the measurement.
   */
  begin(
    feature: InteractionFeature,
    options: { startedAt?: number; background?: boolean } = {},
  ): InteractionHandle {
    this.expireOverdue();
    const id = this.idFactory();
    const startedAt = options.startedAt ?? this.now();
    const background = options.background ?? false;
    // A background refresh is not the first sight of a feature, so it must not
    // consume the cold slot that a real first display should be measured in.
    const cold = !background && !this.seenFeatures.has(feature);
    if (!background) this.seenFeatures.add(feature);
    const entry: OpenInteraction = {
      id,
      feature,
      startedAt,
      wallStartedAt: this.wallClock(),
      cold,
      background,
      marks: [],
      markNames: new Set<string>(),
      contentionAtStart: this.contention?.sample() ?? emptyContention(),
    };
    this.open.set(id, entry);
    const recorder = this;
    return {
      id,
      feature,
      mark: (name: string) => recorder.mark(id, name),
      end: (outcome: InteractionOutcome) => recorder.end(id, outcome),
      get open() {
        return recorder.open.has(id);
      },
    };
  }

  private mark(id: string, name: string): void {
    const entry = this.open.get(id);
    if (!entry || entry.markNames.has(name)) return;
    entry.markNames.add(name);
    entry.marks.push({ name, at: round(this.now() - entry.startedAt) });
  }

  private end(id: string, outcome: InteractionOutcome): InteractionRecord | null {
    const entry = this.open.get(id);
    if (!entry) return null;
    this.open.delete(id);
    const record: InteractionRecord = {
      id: entry.id,
      feature: entry.feature,
      startedAt: entry.wallStartedAt,
      durationMs: round(this.now() - entry.startedAt),
      outcome,
      cold: entry.cold,
      background: entry.background,
      marks: entry.marks,
      contention: this.contentionSince(entry.contentionAtStart),
    };
    this.push(record);
    return record;
  }

  /** An interaction nobody closed is a real outcome, not a missing sample. */
  private expireOverdue(): void {
    const deadline = this.now() - this.timeoutMs;
    for (const [id, entry] of this.open) {
      if (entry.startedAt <= deadline) this.end(id, "timeout");
    }
  }

  private contentionSince(start: InteractionContention): InteractionContention {
    const end = this.contention?.sample() ?? emptyContention();
    return {
      longTaskMs: round(end.longTaskMs - start.longTaskMs),
      requests: end.requests - start.requests,
      duplicateRequests: end.duplicateRequests - start.duplicateRequests,
      transferredBytes: end.transferredBytes - start.transferredBytes,
      cacheHits: end.cacheHits - start.cacheHits,
      cacheMisses: end.cacheMisses - start.cacheMisses,
      cacheStale: end.cacheStale - start.cacheStale,
    };
  }

  private push(record: InteractionRecord): void {
    this.records.push(record);
    while (this.records.length > this.limit) this.records.shift();
    this.onRecord?.(record);
  }

  /** Every completed record, oldest first. */
  completed(): readonly InteractionRecord[] {
    this.expireOverdue();
    return [...this.records];
  }

  /** Interactions still waiting for their content. */
  pending(): readonly { id: string; feature: InteractionFeature; openedForMs: number }[] {
    return [...this.open.values()].map((entry) => ({
      id: entry.id,
      feature: entry.feature,
      openedForMs: round(this.now() - entry.startedAt),
    }));
  }

  clear(): void {
    this.records.length = 0;
    this.open.clear();
    this.seenFeatures.clear();
  }
}

interface OpenInteraction {
  id: string;
  feature: InteractionFeature;
  startedAt: number;
  wallStartedAt: number;
  cold: boolean;
  background: boolean;
  marks: InteractionMark[];
  markNames: Set<string>;
  contentionAtStart: InteractionContention;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

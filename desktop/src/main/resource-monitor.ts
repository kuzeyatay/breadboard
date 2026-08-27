/**
 * Bounded per-service memory evaluation retained for the legacy supervisor's
 * injected test seam.
 *
 * Production Electron starts Runtime V2 directly. Runtime V2 owns each child
 * tree in a Windows Job Object and samples private commit plus system commit
 * through Win32 APIs in the Rust supervisor. Keeping collection out of this
 * module is deliberate: an Electron timer must never launch PowerShell, `ps`,
 * or another process merely to observe memory. Tests can still inject exact
 * samples here to verify streaks, hysteresis, diagnostics, and containment.
 */

export interface ProcessMemorySample {
  pid: number;
  rssBytes?: number;
  privateBytes?: number;
  descendantCount: number;
  treeRssBytes?: number;
  treePrivateBytes?: number;
  sampledAt: number;
}

export interface ServiceResourceBudget {
  warningBytes: number;
  hardLimitBytes: number;
  consecutiveSamplesBeforeAction: number;
  sampleIntervalMs: number;
}

/**
 * Samples every requested root pid in one pass. Injected so tests never depend
 * on the memory of the machine they run on.
 */
export interface ProcessMetricsProvider {
  sample(rootPids: number[]): Promise<Map<number, ProcessMemorySample>>;
}

export type ResourceBreachKind = "warning" | "hard-limit";

export interface ResourceBreach {
  serviceId: string;
  kind: ResourceBreachKind;
  sample: ProcessMemorySample;
  budget: ServiceResourceBudget;
  consecutiveSamples: number;
  /** Oldest-to-newest tree bytes from the bounded history, for the log line. */
  trendBytes: number[];
}

/** Fixed-size history per service. Enough for a trend line, never unbounded. */
const HISTORY_LIMIT = 12;

/** Lowest interval the shared loop will run at, whatever a budget asks for. */
const MIN_SAMPLE_INTERVAL_MS = 1_000;

/**
 * A warning is not repeated until the tree falls back below this fraction of
 * the warning threshold. Without it a service parked just over the line would
 * write a diagnostic on every single sample.
 */
const WARNING_RECOVERY_FRACTION = 0.9;

interface WatchedService {
  serviceId: string;
  pid: number;
  budget: ServiceResourceBudget;
  history: number[];
  warningStreak: number;
  hardLimitStreak: number;
  warningActive: boolean;
}

/** The byte figure a budget is compared against, preferring commit on Windows. */
export function treeBytesOf(sample: ProcessMemorySample): number | undefined {
  return sample.treePrivateBytes ?? sample.treeRssBytes;
}

export interface ResourceMonitorOptions {
  provider: ProcessMetricsProvider;
  onBreach: (breach: ResourceBreach) => void;
  /** Overrides the interval derived from registered budgets (tests). */
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

/**
 * One bounded sampling loop for every watched service. A single provider call
 * per tick covers all of them, so adding a service does not add a shell spawn.
 */
export class ResourceMonitor {
  private readonly watched = new Map<string, WatchedService>();
  private readonly options: ResourceMonitorOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentIntervalMs = 0;
  private sampling = false;
  private stopped = false;

  constructor(options: ResourceMonitorOptions) {
    this.options = options;
  }

  watch(serviceId: string, pid: number, budget: ServiceResourceBudget): void {
    if (this.stopped) return;
    this.watched.set(serviceId, {
      serviceId,
      pid,
      budget,
      history: [],
      warningStreak: 0,
      hardLimitStreak: 0,
      warningActive: false,
    });
    this.ensureTimer();
  }

  /** Stop watching one service and drop everything remembered about it. */
  unwatch(serviceId: string): void {
    this.watched.delete(serviceId);
    if (this.watched.size === 0) this.clearTimer();
  }

  /** Stop the loop and release every timer, sample and reference. */
  stop(): void {
    this.stopped = true;
    this.watched.clear();
    this.clearTimer();
  }

  /** Watched service ids; used by tests and by shutdown assertions. */
  watchedServiceIds(): string[] {
    return [...this.watched.keys()];
  }

  /**
   * One shared loop, running at the shortest interval any watched service asks
   * for. Recomputed whenever the watch set changes, so a service registered
   * later with a tighter budget is not sampled at a stale slower rate.
   */
  private ensureTimer(): void {
    if (this.stopped || this.watched.size === 0) return;
    const desired = Math.max(MIN_SAMPLE_INTERVAL_MS, this.desiredIntervalMs());
    if (this.timer !== null) {
      if (desired === this.currentIntervalMs) return;
      clearInterval(this.timer);
      this.timer = null;
    }
    this.currentIntervalMs = desired;
    this.timer = setInterval(() => void this.tick(), desired);
    // Never hold the Electron main process open for telemetry alone.
    this.timer.unref?.();
  }

  private desiredIntervalMs(): number {
    if (this.options.intervalMs !== undefined) return this.options.intervalMs;
    return Math.min(
      ...[...this.watched.values()].map((entry) => entry.budget.sampleIntervalMs),
    );
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.currentIntervalMs = 0;
  }

  /** Exposed for tests: run exactly one sampling pass. */
  async tick(): Promise<void> {
    if (this.sampling || this.stopped || this.watched.size === 0) return;
    this.sampling = true;
    try {
      const entries = [...this.watched.values()];
      const samples = await this.options.provider.sample(entries.map((entry) => entry.pid));
      for (const entry of entries) {
        // The service may have been unwatched while the sample was in flight.
        if (!this.watched.has(entry.serviceId)) continue;
        const sample = samples.get(entry.pid);
        if (!sample) continue;
        this.evaluate(entry, sample);
      }
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.sampling = false;
    }
  }

  private evaluate(entry: WatchedService, sample: ProcessMemorySample): void {
    const bytes = treeBytesOf(sample);
    // No usable figure (provider degraded on this platform): never act blind.
    if (typeof bytes !== "number" || !Number.isFinite(bytes)) return;

    entry.history.push(bytes);
    if (entry.history.length > HISTORY_LIMIT) entry.history.shift();

    const { warningBytes, hardLimitBytes, consecutiveSamplesBeforeAction } = entry.budget;
    const required = Math.max(1, consecutiveSamplesBeforeAction);

    if (bytes >= hardLimitBytes) {
      entry.hardLimitStreak += 1;
    } else {
      entry.hardLimitStreak = 0;
    }

    if (bytes >= warningBytes) {
      entry.warningStreak += 1;
    } else {
      entry.warningStreak = 0;
      if (bytes < warningBytes * WARNING_RECOVERY_FRACTION) entry.warningActive = false;
    }

    if (entry.hardLimitStreak >= required) {
      const streak = entry.hardLimitStreak;
      // The service is about to be terminated; stop watching the dead pid.
      this.unwatch(entry.serviceId);
      this.options.onBreach({
        serviceId: entry.serviceId,
        kind: "hard-limit",
        sample,
        budget: entry.budget,
        consecutiveSamples: streak,
        trendBytes: [...entry.history],
      });
      return;
    }

    if (entry.warningStreak >= required && !entry.warningActive) {
      entry.warningActive = true;
      this.options.onBreach({
        serviceId: entry.serviceId,
        kind: "warning",
        sample,
        budget: entry.budget,
        consecutiveSamples: entry.warningStreak,
        trendBytes: [...entry.history],
      });
    }
  }
}

/** Bounded, secret-free one-line diagnostic for a breach. */
export function describeBreach(breach: ResourceBreach, restarts: number): string {
  const mb = (bytes: number | undefined): string =>
    typeof bytes === "number" ? `${Math.round(bytes / (1024 * 1024))}MB` : "n/a";
  const threshold =
    breach.kind === "hard-limit" ? breach.budget.hardLimitBytes : breach.budget.warningBytes;
  const trend = breach.trendBytes
    .slice(-6)
    .map((bytes) => mb(bytes))
    .join(" -> ");
  return (
    `[supervisor] memory ${breach.kind} for "${breach.serviceId}": ` +
    `pid=${breach.sample.pid} descendants=${breach.sample.descendantCount} ` +
    `tree=${mb(treeBytesOf(breach.sample))} threshold=${mb(threshold)} ` +
    `samples=${breach.consecutiveSamples} restarts=${restarts} trend=${trend || "n/a"}`
  );
}

import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import {
  freeCommitMb,
  type MemoryPolicy,
  type SystemMemorySnapshot,
} from "./memory-policy";

export type MemoryGovernorState = "normal" | "constrained" | "critical" | "emergency";

export type HeavyConcurrencyGroup =
  | "local-model"
  | "browser-automation"
  | "media-processing"
  | "document-model"
  | "large-generation"
  | "docker-stack";

export interface SystemMemoryMetricSource {
  sample(): Promise<SystemMemorySnapshot>;
}

export interface MemoryRefreshOptions {
  /**
   * If sampling was already in flight when this call began, await that shared
   * sample but do not use it as the result. Start or join exactly one
   * subsequent sample instead. This is a causal boundary that does not depend
   * on wall-clock ordering.
   */
  afterCurrentSample?: boolean;
}

export interface AdmissionRequest {
  id: string;
  estimatedColdStartCommitMb: number;
  priority: number;
  required: boolean;
  /**
   * The headroom that must still be free after this work reaches its expected
   * peak. Background work preserves the normal/minimum reserve. Explicit,
   * bounded foreground work may consume the soft reserve, but must preserve
   * the critical reserve and is still refused once the machine is critical.
   */
  reserveFloor?: "minimum" | "critical";
  concurrencyGroup?: HeavyConcurrencyGroup;
  activeConcurrencyGroups?: ReadonlySet<HeavyConcurrencyGroup>;
}

export interface ResourceExhaustionPayload {
  code: "BREADBOARD_RESOURCE_EXHAUSTED";
  resource: "windows_commit";
  denialReason: "active_heavyweight" | "headroom" | "pressure";
  requiredHeadroomMb: number;
  availableHeadroomMb: number;
  reserveHeadroomMb: number;
  incomingEstimateMb: number;
  overlapHeadroomMb: number;
  retryable: false;
  state: MemoryGovernorState;
}

export class ResourceExhaustionError extends Error {
  readonly result: ResourceExhaustionPayload;

  constructor(result: ResourceExhaustionPayload) {
    const message = result.denialReason === "active_heavyweight"
      ? "Another heavyweight operation is already active; heavyweight work is exclusive until it releases its lease."
      : result.denialReason === "pressure"
        ? `Memory pressure prevents new work; Windows commit headroom is ${result.availableHeadroomMb} MB.`
        : `Windows commit headroom is ${result.availableHeadroomMb} MB; ` +
          `${result.requiredHeadroomMb} MB is required to start this work safely.`;
    super(message);
    this.name = "ResourceExhaustionError";
    this.result = result;
  }
}

export interface MemoryGovernorOptions {
  policy: MemoryPolicy;
  metrics: SystemMemoryMetricSource;
  onPressure?: (state: MemoryGovernorState, snapshot: SystemMemorySnapshot) => void;
  onError?: (error: unknown) => void;
  intervalMs?: number;
}

interface InFlightMemorySample {
  promise: Promise<SystemMemorySnapshot>;
}

export class MemoryGovernor extends EventEmitter {
  private readonly policy: MemoryPolicy;
  private readonly metrics: SystemMemoryMetricSource;
  private readonly onPressure?: MemoryGovernorOptions["onPressure"];
  private readonly onError?: MemoryGovernorOptions["onError"];
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight: InFlightMemorySample | null = null;
  private currentState: MemoryGovernorState = "normal";
  private currentSnapshot: SystemMemorySnapshot | null = null;
  private localPressureUntil = 0;

  constructor(options: MemoryGovernorOptions) {
    super();
    this.policy = options.policy;
    this.metrics = options.metrics;
    this.onPressure = options.onPressure;
    this.onError = options.onError;
    this.intervalMs = options.intervalMs ?? options.policy.sampleIntervalMs;
  }

  get state(): MemoryGovernorState {
    return this.currentState;
  }

  get snapshot(): SystemMemorySnapshot | null {
    return this.currentSnapshot;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch((error: unknown) => {
        try {
          this.onError?.(error);
        } catch {
          // A diagnostics callback must not turn a contained sampler failure
          // into an unhandled interval rejection.
        }
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(options: MemoryRefreshOptions = {}): Promise<SystemMemorySnapshot> {
    const excludedSample = options.afterCurrentSample
      ? this.refreshInFlight
      : null;

    while (true) {
      const inFlight = this.refreshInFlight ?? this.beginRefresh();
      let snapshot: SystemMemorySnapshot;
      try {
        snapshot = await inFlight.promise;
      } catch (error) {
        // A causally excluded sample is never admission evidence, including
        // when it fails. Its caller still observes the failure; this caller
        // proceeds to the one qualifying subsequent sample.
        if (inFlight === excludedSample) continue;
        throw error;
      }
      if (inFlight !== excludedSample) return snapshot;
      // The excluded sample is shared and awaited so sampling stays
      // single-flight. Looping now creates or joins one subsequent sample.
    }
  }

  private beginRefresh(): InFlightMemorySample {
    const inFlight: InFlightMemorySample = {
      promise: this.sampleAndApply(),
    };
    this.refreshInFlight = inFlight;
    inFlight.promise = inFlight.promise.finally(() => {
      if (this.refreshInFlight === inFlight) this.refreshInFlight = null;
    });
    return inFlight;
  }

  private async sampleAndApply(): Promise<SystemMemorySnapshot> {
    const snapshot = await this.metrics.sample();
    const previous = this.currentState;
    const measured = this.stateFor(snapshot, previous);
    const next = measured === "normal" && performance.now() < this.localPressureUntil
      ? "constrained"
      : measured;
    this.currentSnapshot = snapshot;
    this.currentState = next;
    if (next !== previous) this.emit("state-changed", next, previous, snapshot);
    if (next !== "normal") this.onPressure?.(next, snapshot);
    return snapshot;
  }

  constrainNewHeavyWork(durationMs = 10 * 60_000): void {
    this.localPressureUntil = Math.max(
      this.localPressureUntil,
      performance.now() + Math.max(1_000, Math.min(60 * 60_000, durationMs)),
    );
  }

  clearLocalPressure(): void {
    this.localPressureUntil = 0;
  }

  stateFor(
    snapshot: SystemMemorySnapshot,
    previous: MemoryGovernorState = this.currentState,
  ): MemoryGovernorState {
    const free = freeCommitMb(snapshot);
    const hysteresis = previous === "normal" ? 0 : this.policy.recoveryHysteresisMb;
    if (free < this.policy.emergencyFreeCommitMb + hysteresis) return "emergency";
    if (free < this.policy.criticalFreeCommitMb + hysteresis) return "critical";
    if (free < this.policy.minFreeCommitMb + hysteresis) return "constrained";
    return "normal";
  }

  async admit(request: AdmissionRequest, refresh: MemoryRefreshOptions = {}): Promise<void> {
    const snapshot = await this.refresh({
      afterCurrentSample: refresh.afterCurrentSample ?? true,
    });
    const available = Math.floor(freeCommitMb(snapshot));
    const estimate = Math.max(0, Math.ceil(request.estimatedColdStartCommitMb));
    const reserve = Math.ceil(
      request.reserveFloor === "critical"
        ? this.policy.criticalFreeCommitMb
        : this.policy.minFreeCommitMb,
    );
    const required = reserve + estimate;
    const localPressureActive = performance.now() < this.localPressureUntil;
    const pressureDenial =
      this.currentState === "emergency" ||
      (this.currentState === "critical" && !request.required) ||
      (localPressureActive && !request.required && request.priority < 80) ||
      (this.currentState === "constrained" &&
        request.reserveFloor !== "critical" &&
        !request.required &&
        request.priority < 80);
    const denialReason = pressureDenial
      ? "pressure"
      : available < required
        ? "headroom"
        : null;
    if (denialReason) {
      throw new ResourceExhaustionError({
        code: "BREADBOARD_RESOURCE_EXHAUSTED",
        resource: "windows_commit",
        denialReason,
        requiredHeadroomMb: required,
        availableHeadroomMb: available,
        reserveHeadroomMb: reserve,
        incomingEstimateMb: estimate,
        overlapHeadroomMb: 0,
        retryable: false,
        state: this.currentState,
      });
    }
  }
}

import { EventEmitter } from "node:events";
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

export interface AdmissionRequest {
  id: string;
  estimatedColdStartCommitMb: number;
  priority: number;
  required: boolean;
  concurrencyGroup?: HeavyConcurrencyGroup;
  activeConcurrencyGroups?: ReadonlySet<HeavyConcurrencyGroup>;
}

export interface ResourceExhaustionPayload {
  code: "BREADBOARD_RESOURCE_EXHAUSTED";
  resource: "windows_commit";
  requiredHeadroomMb: number;
  availableHeadroomMb: number;
  retryable: false;
  state: MemoryGovernorState;
}

export class ResourceExhaustionError extends Error {
  readonly result: ResourceExhaustionPayload;

  constructor(result: ResourceExhaustionPayload) {
    super(
      `Windows commit headroom is ${result.availableHeadroomMb} MB; ` +
        `${result.requiredHeadroomMb} MB is required to start this work safely.`,
    );
    this.name = "ResourceExhaustionError";
    this.result = result;
  }
}

export interface MemoryGovernorOptions {
  policy: MemoryPolicy;
  metrics: SystemMemoryMetricSource;
  onPressure?: (state: MemoryGovernorState, snapshot: SystemMemorySnapshot) => void;
  intervalMs?: number;
}

export class MemoryGovernor extends EventEmitter {
  private readonly policy: MemoryPolicy;
  private readonly metrics: SystemMemoryMetricSource;
  private readonly onPressure?: MemoryGovernorOptions["onPressure"];
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sampling = false;
  private currentState: MemoryGovernorState = "normal";
  private currentSnapshot: SystemMemorySnapshot | null = null;
  private localPressureUntil = 0;

  constructor(options: MemoryGovernorOptions) {
    super();
    this.policy = options.policy;
    this.metrics = options.metrics;
    this.onPressure = options.onPressure;
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
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<SystemMemorySnapshot> {
    if (this.sampling && this.currentSnapshot) return this.currentSnapshot;
    this.sampling = true;
    try {
      const snapshot = await this.metrics.sample();
      const previous = this.currentState;
      const measured = this.stateFor(snapshot, previous);
      const next = measured === "normal" && Date.now() < this.localPressureUntil
        ? "constrained"
        : measured;
      this.currentSnapshot = snapshot;
      this.currentState = next;
      if (next !== previous) this.emit("state-changed", next, previous, snapshot);
      if (next !== "normal") this.onPressure?.(next, snapshot);
      return snapshot;
    } finally {
      this.sampling = false;
    }
  }

  constrainNewHeavyWork(durationMs = 10 * 60_000): void {
    this.localPressureUntil = Math.max(
      this.localPressureUntil,
      Date.now() + Math.max(1_000, Math.min(60 * 60_000, durationMs)),
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

  async admit(request: AdmissionRequest): Promise<void> {
    const snapshot = await this.refresh();
    const available = Math.floor(freeCommitMb(snapshot));
    const estimate = Math.max(0, Math.ceil(request.estimatedColdStartCommitMb));
    const required = Math.ceil(this.policy.minFreeCommitMb + estimate);
    const activeHeavyConflict = Boolean(
      request.concurrencyGroup &&
        request.activeConcurrencyGroups &&
        [...request.activeConcurrencyGroups].some((group) => group !== request.concurrencyGroup),
    );
    const enoughForHeavyOverlap = available >= required + estimate;
    const pressureDenial =
      this.currentState === "emergency" ||
      (this.currentState === "critical" && !request.required) ||
      (this.currentState === "constrained" && !request.required && request.priority < 80);
    if (
      pressureDenial ||
      available < required ||
      (activeHeavyConflict && !enoughForHeavyOverlap)
    ) {
      throw new ResourceExhaustionError({
        code: "BREADBOARD_RESOURCE_EXHAUSTED",
        resource: "windows_commit",
        requiredHeadroomMb: activeHeavyConflict ? required + estimate : required,
        availableHeadroomMb: available,
        retryable: false,
        state: this.currentState,
      });
    }
  }
}

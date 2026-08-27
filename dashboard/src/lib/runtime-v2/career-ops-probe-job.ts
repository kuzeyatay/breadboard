import "server-only";

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import type { CareerOpsHealth, OnboardingState } from "../career-ops/health-contract.ts";
import {
  cancelRuntimeJob,
  cancelRuntimeJobByIdempotencyKey,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  RuntimeJobControlError,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobIdempotencyCancellationDisposition,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";

const PROTOCOL_VERSION = 1;
const CACHE_MS = 30_000;
const MAX_OPERATION_MS = 90_000;
const POLL_MS = 100;
const MAX_PATH_BYTES = 2_048;
const MAX_REASON_BYTES = 8 * 1_024;
const MAX_LIST_ITEMS = 128;
const MAX_LIST_ITEM_BYTES = 2_048;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface CareerOpsProbeControl {
  submit(
    authority: RuntimeJobAuthority,
    submission: RuntimeJobSubmission,
  ): Promise<RuntimeJobSnapshot>;
  inspect(authority: RuntimeJobAuthority, jobId: string): Promise<RuntimeJobSnapshot>;
  readOutput(
    authority: RuntimeJobAuthority,
    jobId: string,
    kind: RuntimeJobOutput["kind"],
  ): Promise<RuntimeJobOutput>;
  cancel(authority: RuntimeJobAuthority, jobId: string): Promise<RuntimeJobSnapshot>;
  cancelByIdempotencyKey(
    authority: RuntimeJobAuthority,
    idempotencyKey: string,
  ): Promise<RuntimeJobIdempotencyCancellationDisposition>;
}

interface CachedHealth {
  readonly at: number;
  readonly health: CareerOpsHealth;
}

interface InFlightHealth {
  readonly promise: Promise<CareerOpsHealth>;
  readonly abort: AbortController;
  waiters: number;
}

const DEFAULT_CONTROL: CareerOpsProbeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
  cancelByIdempotencyKey: cancelRuntimeJobByIdempotencyKey,
};

const globalHealth = globalThis as typeof globalThis & {
  __breadboardCareerOpsProbeHealth?: CachedHealth;
  __breadboardCareerOpsProbeHealthInFlight?: InFlightHealth;
};

export class CareerOpsProbeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "CareerOpsProbeError";
    this.code = code;
    this.status = status;
  }
}

function authority(userId: number): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("Career Ops health user scope is invalid.");
  }
  return { userId, gardenId: null, conversationId: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function boundedList(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length <= MAX_LIST_ITEMS &&
    value.every((item) => boundedText(item, MAX_LIST_ITEM_BYTES));
}

function parseOnboarding(value: unknown): OnboardingState | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !exactKeys(value, ["onboardingNeeded", "missing", "warnings", "autoCopied"]) ||
    typeof value.onboardingNeeded !== "boolean" ||
    !boundedList(value.missing) ||
    !boundedList(value.warnings) ||
    !boundedList(value.autoCopied)
  ) throw new Error("Runtime returned invalid Career Ops onboarding state.");
  return {
    onboardingNeeded: value.onboardingNeeded,
    missing: [...value.missing],
    warnings: [...value.warnings],
    autoCopied: [...value.autoCopied],
  };
}

function assertSnapshot(job: RuntimeJobSnapshot): void {
  if (
    job.jobType !== "career-ops-probe" ||
    job.workerKind !== "career-ops-probe-node" ||
    job.resourceClass !== "document-processing" ||
    job.gardenId !== null ||
    job.conversationId !== null
  ) throw new Error("Runtime returned a job outside the Career Ops probe contract.");
}

function parseResult(job: RuntimeJobSnapshot, content: unknown): CareerOpsHealth {
  if (
    !isRecord(content) ||
    !exactKeys(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result) ||
    !exactKeys(content.result, [
      "available",
      "cloned",
      "root",
      "dependenciesInstalled",
      "browsersInstalled",
      "onboarding",
      "modeCount",
      "trackedApplications",
      "reason",
    ])
  ) throw new Error("Runtime returned an unfenced Career Ops probe result.");
  const result = content.result;
  if (
    typeof result.available !== "boolean" ||
    typeof result.cloned !== "boolean" ||
    !(result.root === null || (
      boundedText(result.root, MAX_PATH_BYTES) && path.isAbsolute(result.root)
    )) ||
    typeof result.dependenciesInstalled !== "boolean" ||
    typeof result.browsersInstalled !== "boolean" ||
    !Number.isSafeInteger(result.modeCount) ||
    Number(result.modeCount) < 0 ||
    Number(result.modeCount) > 10_000 ||
    !(result.trackedApplications === null || (
      Number.isSafeInteger(result.trackedApplications) &&
      Number(result.trackedApplications) >= 0 &&
      Number(result.trackedApplications) <= 100_000_000
    )) ||
    !(result.reason === null || boundedText(result.reason, MAX_REASON_BYTES)) ||
    result.cloned !== (result.root !== null) ||
    (result.available && (!result.cloned || !result.dependenciesInstalled))
  ) throw new Error("Runtime returned invalid Career Ops health metadata.");
  const onboarding = parseOnboarding(result.onboarding);
  if (result.available !== (onboarding !== null)) {
    throw new Error("Runtime returned inconsistent Career Ops doctor metadata.");
  }
  return {
    available: result.available,
    cloned: result.cloned,
    root: result.root,
    dependenciesInstalled: result.dependenciesInstalled,
    browsersInstalled: result.browsersInstalled,
    onboarding,
    modeCount: result.modeCount as number,
    trackedApplications: result.trackedApplications as number | null,
    reason: result.reason,
  };
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    const abort = () => done(signal.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function terminalError(job: RuntimeJobSnapshot): Error {
  if (job.state === "resource_exhausted" && job.resourceExhaustion) {
    const evidence = job.resourceExhaustion;
    return new RuntimeJobControlError({
      code: "BREADBOARD_RESOURCE_EXHAUSTED",
      message: "Windows commit headroom is too low for the Career Ops health probe.",
      status: 503,
      resource: evidence.resource,
      requiredHeadroomMb: evidence.requiredHeadroomMb,
      availableHeadroomMb: evidence.availableHeadroomMb,
    });
  }
  if (job.state === "cancelled") {
    return new CareerOpsProbeError(
      "career_ops_probe_cancelled",
      "The Career Ops health probe was cancelled.",
      499,
    );
  }
  return new CareerOpsProbeError(
    "career_ops_probe_interrupted",
    job.failureMessage ?? "The Career Ops health probe was interrupted.",
    502,
  );
}

/** Submit one sealed, user-scoped doctor probe to a fresh disposable worker. */
export async function runCareerOpsProbeViaRuntime(input: {
  readonly userId: number;
  readonly signal?: AbortSignal;
  readonly control?: CareerOpsProbeControl;
}): Promise<CareerOpsHealth> {
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const jobAuthority = authority(input.userId);
  const control = input.control ?? DEFAULT_CONTROL;
  const idempotencyKey = `career-ops-probe-v2:${createHash("sha256")
    .update(`${input.userId}:${randomUUID()}`, "utf8")
    .digest("hex")}`;
  let job: RuntimeJobSnapshot | null = null;
  let cancellationForwarded = false;
  try {
    job = await control.submit(jobAuthority, {
      jobType: "career-ops-probe",
      idempotencyKey,
      requestPayload: {
        protocolVersion: PROTOCOL_VERSION,
        operation: "doctor",
      },
    });
    assertSnapshot(job);
    const deadline = Date.now() + MAX_OPERATION_MS;
    while (!TERMINAL_STATES.has(job.state)) {
      if (input.signal?.aborted) {
        cancellationForwarded = true;
        await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
        throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      if (Date.now() >= deadline) {
        cancellationForwarded = true;
        await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
        throw new CareerOpsProbeError(
          "career_ops_probe_timeout",
          "The Career Ops health probe did not finish in time.",
          504,
        );
      }
      await delay(POLL_MS, input.signal ?? new AbortController().signal);
      job = await control.inspect(jobAuthority, job.jobId);
      assertSnapshot(job);
    }
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another Career Ops probe.");
    }
    return parseResult(job, output.content);
  } catch (error) {
    if (
      job &&
      !cancellationForwarded &&
      input.signal?.aborted &&
      !TERMINAL_STATES.has(job.state)
    ) {
      cancellationForwarded = true;
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
      throw input.signal.reason ?? error;
    }
    if (!job && input.signal?.aborted) {
      await control.cancelByIdempotencyKey(jobAuthority, idempotencyKey).catch(() => undefined);
      throw input.signal.reason ?? error;
    }
    throw error;
  }
}

function waitForSharedProbe(
  running: InFlightHealth,
  signal?: AbortSignal,
): Promise<CareerOpsHealth> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  running.waiters += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      running.waiters -= 1;
    };
    const abort = () => {
      release();
      if (running.waiters === 0) {
        running.abort.abort(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      }
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    running.promise.then(
      (value) => {
        if (settled) return;
        release();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        release();
        reject(error);
      },
    );
    if (signal?.aborted) abort();
  });
}

/**
 * Preserve the historical 30-second cache, force-refresh, and single-flight
 * behavior while moving the actual probe into Runtime ownership.
 */
export function careerOpsHealthViaRuntime(input: {
  readonly userId: number;
  readonly force?: boolean;
  readonly signal?: AbortSignal;
  readonly control?: CareerOpsProbeControl;
}): Promise<CareerOpsHealth> {
  authority(input.userId);
  if (input.signal?.aborted) {
    return Promise.reject(input.signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  const cached = globalHealth.__breadboardCareerOpsProbeHealth;
  if (!input.force && cached && Date.now() - cached.at < CACHE_MS) {
    return Promise.resolve(cached.health);
  }
  const existing = globalHealth.__breadboardCareerOpsProbeHealthInFlight;
  if (existing) return waitForSharedProbe(existing, input.signal);

  const abort = new AbortController();
  const running = {} as InFlightHealth;
  const promise = runCareerOpsProbeViaRuntime({
    userId: input.userId,
    signal: abort.signal,
    control: input.control,
  })
    .then((health) => {
      globalHealth.__breadboardCareerOpsProbeHealth = { at: Date.now(), health };
      return health;
    })
    .finally(() => {
      if (globalHealth.__breadboardCareerOpsProbeHealthInFlight === running) {
        globalHealth.__breadboardCareerOpsProbeHealthInFlight = undefined;
      }
    });
  Object.assign(running, { promise, abort, waiters: 0 });
  globalHealth.__breadboardCareerOpsProbeHealthInFlight = running;
  return waitForSharedProbe(running, input.signal);
}

/** Drop only the cached report; an already-running historical single flight remains authoritative. */
export function invalidateCareerOpsHealth(): void {
  globalHealth.__breadboardCareerOpsProbeHealth = undefined;
}

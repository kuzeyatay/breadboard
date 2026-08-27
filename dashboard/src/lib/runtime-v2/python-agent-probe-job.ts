import "server-only";

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

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
const POLL_MS = 100;
const CACHE_MS = 20_000;
const MAX_PATH_BYTES = 2_048;
const MAX_REASON_BYTES = 32 * 1_024;
const MAX_LABEL_BYTES = 256;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export type PythonAgentProbeKind = "legal" | "shorts" | "tradingagents";

export interface LegalProbeHealth {
  readonly available: boolean;
  readonly cloned: boolean;
  readonly root: string | null;
  readonly environmentReady: boolean;
  readonly harnessImportable: boolean;
  readonly pandocAvailable: boolean;
  readonly shellAvailable: boolean;
  readonly systemPython: string | null;
  readonly uvAvailable: boolean;
  readonly bridgeFound: boolean;
  readonly reason: string | null;
}

export interface ShortsProbeHealth {
  readonly available: boolean;
  readonly cloned: boolean;
  readonly root: string | null;
  readonly environmentReady: boolean;
  readonly dependenciesInstalled: boolean;
  readonly missing: readonly string[];
  readonly systemPython: string | null;
  readonly uvAvailable: boolean;
  readonly ffmpeg: string | null;
  readonly bridgeFound: boolean;
  readonly reason: string | null;
}

export interface TradingAgentsProbeHealth {
  readonly available: boolean;
  readonly cloned: boolean;
  readonly root: string | null;
  readonly environmentReady: boolean;
  readonly packageInstalled: boolean;
  readonly systemPython: string | null;
  readonly uvAvailable: boolean;
  readonly version: string | null;
  readonly bridgeFound: boolean;
  readonly reason: string | null;
}

interface ProbeResultMap {
  readonly legal: LegalProbeHealth;
  readonly shorts: ShortsProbeHealth;
  readonly tradingagents: TradingAgentsProbeHealth;
}

export interface PythonAgentProbeControl {
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

const DEFAULT_CONTROL: PythonAgentProbeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
  cancelByIdempotencyKey: cancelRuntimeJobByIdempotencyKey,
};

const DEFINITIONS = {
  legal: {
    jobType: "legal-probe",
    workerKind: "legal-probe-node",
    maximumOperationMs: 90_000,
    label: "Legal Agent",
  },
  shorts: {
    jobType: "shorts-probe",
    workerKind: "shorts-probe-node",
    maximumOperationMs: 120_000,
    label: "Shorts",
  },
  tradingagents: {
    jobType: "tradingagents-probe",
    workerKind: "tradingagents-probe-node",
    maximumOperationMs: 90_000,
    label: "Trading Agent",
  },
} as const;

interface CachedProbe<K extends PythonAgentProbeKind> {
  readonly at: number;
  readonly health: ProbeResultMap[K];
}

interface InFlightProbe<K extends PythonAgentProbeKind> {
  readonly promise: Promise<ProbeResultMap[K]>;
  readonly abort: AbortController;
  waiters: number;
}

interface AnyCachedProbe {
  readonly at: number;
  readonly health: ProbeResultMap[PythonAgentProbeKind];
}

interface AnyInFlightProbe {
  readonly promise: Promise<ProbeResultMap[PythonAgentProbeKind]>;
  readonly abort: AbortController;
  waiters: number;
}

const globalProbe = globalThis as typeof globalThis & {
  __breadboardPythonAgentProbeCache?: Partial<Record<PythonAgentProbeKind, AnyCachedProbe>>;
  __breadboardPythonAgentProbeInFlight?: Partial<Record<PythonAgentProbeKind, AnyInFlightProbe>>;
};
const probeCache = globalProbe.__breadboardPythonAgentProbeCache ?? {};
const probeInFlight = globalProbe.__breadboardPythonAgentProbeInFlight ?? {};
globalProbe.__breadboardPythonAgentProbeCache = probeCache;
globalProbe.__breadboardPythonAgentProbeInFlight = probeInFlight;

export class PythonAgentProbeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "PythonAgentProbeError";
    this.code = code;
    this.status = status;
  }
}

function authority(userId: number): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("Agent probe user scope is invalid.");
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

function nullablePath(value: unknown): value is string | null {
  return value === null ||
    (boundedText(value, MAX_PATH_BYTES) && value.length > 0 && path.isAbsolute(value));
}

function nullableReason(value: unknown): value is string | null {
  return value === null || boundedText(value, MAX_REASON_BYTES);
}

function parseLegalHealth(value: unknown): LegalProbeHealth {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "available",
      "cloned",
      "root",
      "environmentReady",
      "harnessImportable",
      "pandocAvailable",
      "shellAvailable",
      "systemPython",
      "uvAvailable",
      "bridgeFound",
      "reason",
    ]) ||
    typeof value.available !== "boolean" ||
    typeof value.cloned !== "boolean" ||
    !nullablePath(value.root) ||
    value.cloned !== (value.root !== null) ||
    typeof value.environmentReady !== "boolean" ||
    typeof value.harnessImportable !== "boolean" ||
    typeof value.pandocAvailable !== "boolean" ||
    typeof value.shellAvailable !== "boolean" ||
    !nullablePath(value.systemPython) ||
    typeof value.uvAvailable !== "boolean" ||
    typeof value.bridgeFound !== "boolean" ||
    !nullableReason(value.reason) ||
    value.available !== (value.reason === null) ||
    (value.environmentReady && value.systemPython === null) ||
    (value.available &&
      (!value.cloned || !value.environmentReady || !value.harnessImportable || !value.bridgeFound)) ||
    (!value.environmentReady && (value.harnessImportable || value.pandocAvailable))
  ) throw new Error("Runtime returned invalid Legal Agent health.");
  return {
    available: value.available,
    cloned: value.cloned,
    root: value.root,
    environmentReady: value.environmentReady,
    harnessImportable: value.harnessImportable,
    pandocAvailable: value.pandocAvailable,
    shellAvailable: value.shellAvailable,
    systemPython: value.systemPython,
    uvAvailable: value.uvAvailable,
    bridgeFound: value.bridgeFound,
    reason: value.reason,
  };
}

function parseShortsHealth(value: unknown): ShortsProbeHealth {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "available",
      "cloned",
      "root",
      "environmentReady",
      "dependenciesInstalled",
      "missing",
      "systemPython",
      "uvAvailable",
      "ffmpeg",
      "bridgeFound",
      "reason",
    ]) ||
    typeof value.available !== "boolean" ||
    typeof value.cloned !== "boolean" ||
    !nullablePath(value.root) ||
    value.cloned !== (value.root !== null) ||
    typeof value.environmentReady !== "boolean" ||
    typeof value.dependenciesInstalled !== "boolean" ||
    !Array.isArray(value.missing) ||
    value.missing.length > 16 ||
    value.missing.some((item) => !boundedText(item, MAX_LABEL_BYTES)) ||
    !nullablePath(value.systemPython) ||
    typeof value.uvAvailable !== "boolean" ||
    !nullablePath(value.ffmpeg) ||
    typeof value.bridgeFound !== "boolean" ||
    !nullableReason(value.reason) ||
    value.available !== (value.reason === null) ||
    (value.environmentReady && value.systemPython === null) ||
    (value.dependenciesInstalled && value.missing.length !== 0) ||
    (!value.environmentReady && value.dependenciesInstalled) ||
    (value.available &&
      (!value.cloned ||
        !value.environmentReady ||
        !value.dependenciesInstalled ||
        !value.bridgeFound ||
        value.ffmpeg === null))
  ) throw new Error("Runtime returned invalid Shorts health.");
  return {
    available: value.available,
    cloned: value.cloned,
    root: value.root,
    environmentReady: value.environmentReady,
    dependenciesInstalled: value.dependenciesInstalled,
    missing: value.missing as string[],
    systemPython: value.systemPython,
    uvAvailable: value.uvAvailable,
    ffmpeg: value.ffmpeg,
    bridgeFound: value.bridgeFound,
    reason: value.reason,
  };
}

function parseTradingAgentsHealth(value: unknown): TradingAgentsProbeHealth {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "available",
      "cloned",
      "root",
      "environmentReady",
      "packageInstalled",
      "systemPython",
      "uvAvailable",
      "version",
      "bridgeFound",
      "reason",
    ]) ||
    typeof value.available !== "boolean" ||
    typeof value.cloned !== "boolean" ||
    !nullablePath(value.root) ||
    value.cloned !== (value.root !== null) ||
    typeof value.environmentReady !== "boolean" ||
    typeof value.packageInstalled !== "boolean" ||
    !nullablePath(value.systemPython) ||
    typeof value.uvAvailable !== "boolean" ||
    (value.version !== null && !boundedText(value.version, MAX_LABEL_BYTES)) ||
    typeof value.bridgeFound !== "boolean" ||
    !nullableReason(value.reason) ||
    value.available !== (value.reason === null) ||
    (value.environmentReady && value.systemPython === null) ||
    (!value.environmentReady && value.packageInstalled) ||
    (value.available &&
      (!value.cloned || !value.environmentReady || !value.packageInstalled || !value.bridgeFound))
  ) throw new Error("Runtime returned invalid Trading Agent health.");
  return {
    available: value.available,
    cloned: value.cloned,
    root: value.root,
    environmentReady: value.environmentReady,
    packageInstalled: value.packageInstalled,
    systemPython: value.systemPython,
    uvAvailable: value.uvAvailable,
    version: value.version,
    bridgeFound: value.bridgeFound,
    reason: value.reason,
  };
}

function assertSnapshot<K extends PythonAgentProbeKind>(
  kind: K,
  job: RuntimeJobSnapshot,
): void {
  const definition = DEFINITIONS[kind];
  if (
    job.jobType !== definition.jobType ||
    job.workerKind !== definition.workerKind ||
    job.resourceClass !== "document-processing" ||
    job.gardenId !== null ||
    job.conversationId !== null
  ) throw new Error(`Runtime returned a job outside the ${definition.label} probe contract.`);
}

function parseResult<K extends PythonAgentProbeKind>(
  kind: K,
  job: RuntimeJobSnapshot,
  content: unknown,
): ProbeResultMap[K] {
  const label = DEFINITIONS[kind].label;
  if (
    !isRecord(content) ||
    !exactKeys(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId
  ) throw new Error(`Runtime returned an unfenced ${label} probe result.`);
  return (kind === "legal"
    ? parseLegalHealth(content.result)
    : kind === "shorts"
      ? parseShortsHealth(content.result)
      : parseTradingAgentsHealth(content.result)) as ProbeResultMap[K];
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    const abort = () => done(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function terminalError<K extends PythonAgentProbeKind>(
  kind: K,
  job: RuntimeJobSnapshot,
): Error {
  const definition = DEFINITIONS[kind];
  if (job.state === "resource_exhausted" && job.resourceExhaustion) {
    const evidence = job.resourceExhaustion;
    return new RuntimeJobControlError({
      code: "BREADBOARD_RESOURCE_EXHAUSTED",
      message: `Windows commit headroom is too low for the ${definition.label} probe.`,
      status: 503,
      resource: evidence.resource,
      requiredHeadroomMb: evidence.requiredHeadroomMb,
      availableHeadroomMb: evidence.availableHeadroomMb,
    });
  }
  if (job.state === "cancelled") {
    return new PythonAgentProbeError(
      `${kind}_probe_cancelled`,
      `The ${definition.label} health probe was cancelled.`,
      499,
    );
  }
  return new PythonAgentProbeError(
    `${kind}_probe_interrupted`,
    job.failureMessage ?? `The ${definition.label} health probe was interrupted.`,
    502,
  );
}

/** Submit one fixed import probe to a fresh source-specific worker. */
export async function runPythonAgentProbeViaRuntime<K extends PythonAgentProbeKind>(input: {
  readonly kind: K;
  readonly userId: number;
  readonly signal?: AbortSignal;
  readonly control?: PythonAgentProbeControl;
}): Promise<ProbeResultMap[K]> {
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const definition = DEFINITIONS[input.kind];
  const jobAuthority = authority(input.userId);
  const control = input.control ?? DEFAULT_CONTROL;
  const idempotencyKey = `${input.kind}-probe-v2:${createHash("sha256")
    .update(`${input.userId}:${randomUUID()}`, "utf8")
    .digest("hex")}`;
  let job: RuntimeJobSnapshot | null = null;
  let cancellationForwarded = false;
  try {
    job = await control.submit(jobAuthority, {
      jobType: definition.jobType,
      idempotencyKey,
      requestPayload: { protocolVersion: PROTOCOL_VERSION, operation: "health" },
    });
    assertSnapshot(input.kind, job);
    const deadline = Date.now() + definition.maximumOperationMs;
    while (!TERMINAL_STATES.has(job.state)) {
      if (input.signal?.aborted) {
        cancellationForwarded = true;
        await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
        throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      if (Date.now() >= deadline) {
        cancellationForwarded = true;
        await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
        throw new PythonAgentProbeError(
          `${input.kind}_probe_timeout`,
          `The ${definition.label} health probe did not finish in time.`,
          504,
        );
      }
      await delay(POLL_MS, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      assertSnapshot(input.kind, job);
    }
    if (job.state !== "succeeded") throw terminalError(input.kind, job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error(`Runtime returned output for another ${definition.label} probe.`);
    }
    return parseResult(input.kind, job, output.content);
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

function waitForSharedProbe<K extends PythonAgentProbeKind>(
  running: InFlightProbe<K>,
  signal?: AbortSignal,
): Promise<ProbeResultMap[K]> {
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

function healthViaRuntime<K extends PythonAgentProbeKind>(input: {
  readonly kind: K;
  readonly userId: number;
  readonly force?: boolean;
  readonly signal?: AbortSignal;
  readonly control?: PythonAgentProbeControl;
}): Promise<ProbeResultMap[K]> {
  authority(input.userId);
  if (input.signal?.aborted) {
    return Promise.reject(input.signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  const cached = probeCache[input.kind] as CachedProbe<K> | undefined;
  if (!input.force && cached && Date.now() - cached.at < CACHE_MS) {
    return Promise.resolve(cached.health);
  }
  const existing = probeInFlight[input.kind] as InFlightProbe<K> | undefined;
  if (existing) return waitForSharedProbe(existing, input.signal);

  const abort = new AbortController();
  const running = {} as InFlightProbe<K>;
  const promise = runPythonAgentProbeViaRuntime({
    kind: input.kind,
    userId: input.userId,
    signal: abort.signal,
    control: input.control,
  })
    .then((health) => {
      probeCache[input.kind] = { at: Date.now(), health };
      return health;
    })
    .finally(() => {
      if (probeInFlight[input.kind] === running) delete probeInFlight[input.kind];
    });
  Object.assign(running, { promise, abort, waiters: 0 });
  probeInFlight[input.kind] = running;
  return waitForSharedProbe(running, input.signal);
}

export function legalHealthViaRuntime(input: {
  readonly userId: number;
  readonly force?: boolean;
  readonly signal?: AbortSignal;
  readonly control?: PythonAgentProbeControl;
}): Promise<LegalProbeHealth> {
  return healthViaRuntime({ kind: "legal", ...input });
}

export function shortsHealthViaRuntime(input: {
  readonly userId: number;
  readonly force?: boolean;
  readonly signal?: AbortSignal;
  readonly control?: PythonAgentProbeControl;
}): Promise<ShortsProbeHealth> {
  return healthViaRuntime({ kind: "shorts", ...input });
}

export function tradingagentsHealthViaRuntime(input: {
  readonly userId: number;
  readonly force?: boolean;
  readonly signal?: AbortSignal;
  readonly control?: PythonAgentProbeControl;
}): Promise<TradingAgentsProbeHealth> {
  return healthViaRuntime({ kind: "tradingagents", ...input });
}

/** Invalidate only the selected cached receipt; a running single flight remains authoritative. */
export function invalidatePythonAgentProbe(kind: PythonAgentProbeKind): void {
  delete probeCache[kind];
}

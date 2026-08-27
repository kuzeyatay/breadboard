import { createHash, randomUUID } from "node:crypto";

import {
  RuntimeJobControlError,
  cancelRuntimeJob,
  inspectRuntimeJob,
  isRuntimeV2ServiceControlConfigured,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";
import {
  buildProgress,
  clearIndexJobReceipt,
  clearManifest,
  indexState,
  knowledgeBaseName,
  readIndexJobReceipt,
  readManifest,
  writeIndexJobReceipt,
  type IndexJobReceipt,
  type IndexState,
} from "../deep-tutor/knowledge-base.ts";
import { embeddingFingerprint } from "../deep-tutor/home.ts";
import type { TutorScope } from "../deep-tutor/materials.ts";
import { RuntimeAuthorityUnavailableError } from "./authority-error.ts";

const PROTOCOL_VERSION = 1;
const POLL_MS = 250;
const PROBE_RUNTIME_MS = 120_000;
const INDEX_RUNTIME_MS = 50 * 60_000;
const CANCEL_RUNTIME_MS = 45_000;
const MAX_INDEXED_FILES = 600;
const TERMINAL = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface DeepTutorProbeResult {
  packageInstalled: boolean;
  mcpInstalled: boolean;
  timedOut: boolean;
  detail: string;
  durationMs: number;
}

export interface DeepTutorMaintenanceControl {
  configured(env: NodeJS.ProcessEnv): boolean;
  submit(
    authority: RuntimeJobAuthority,
    submission: RuntimeJobSubmission,
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobSnapshot>;
  inspect(
    authority: RuntimeJobAuthority,
    jobId: string,
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobSnapshot>;
  readOutput(
    authority: RuntimeJobAuthority,
    jobId: string,
    kind: RuntimeJobOutput["kind"],
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobOutput>;
  cancel(
    authority: RuntimeJobAuthority,
    jobId: string,
    env: NodeJS.ProcessEnv,
  ): Promise<RuntimeJobSnapshot>;
}

const DEFAULT_CONTROL: DeepTutorMaintenanceControl = {
  configured: isRuntimeV2ServiceControlConfigured,
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function authority(userId: number, conversationId: string): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("The Deep Tutor Runtime user authority is invalid.");
  }
  return { userId, gardenId: null, conversationId };
}

function indexConversationId(scopeId: string): string {
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(scopeId)) {
    throw new TypeError("The Deep Tutor Runtime scope identifier is invalid.");
  }
  return `deep-tutor-index-${createHash("sha256").update(scopeId).digest("hex").slice(0, 24)}`;
}

function assertSnapshot(
  snapshot: RuntimeJobSnapshot,
  operation: "probe" | "index",
  expectedAuthority: RuntimeJobAuthority,
): void {
  const probe = operation === "probe";
  if (
    snapshot.jobType !== (probe ? "deep-tutor-probe" : "deep-tutor-index") ||
    snapshot.workerKind !== (probe ? "deep-tutor-probe-node" : "deep-tutor-index-node") ||
    snapshot.resourceClass !== (probe ? "document-processing" : "large-generation") ||
    snapshot.gardenId !== expectedAuthority.gardenId ||
    snapshot.conversationId !== expectedAuthority.conversationId
  ) throw new Error("Runtime returned a job outside the sealed Deep Tutor contract.");
}

function validIdentity(job: RuntimeJobSnapshot, value: unknown): boolean {
  return exactRecord(value, ["jobId", "attempt", "workerInstanceId"]) &&
    value.jobId === job.jobId &&
    value.attempt === job.attempt &&
    value.workerInstanceId === job.workerInstanceId;
}

function resultEnvelope(job: RuntimeJobSnapshot, content: unknown): unknown {
  if (
    !exactRecord(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !validIdentity(job, content.identity)
  ) throw new Error("Runtime returned unfenced Deep Tutor output.");
  return content.result;
}

function boundedDetail(value: unknown): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= 8 * 1024;
}

function parseProbeResult(job: RuntimeJobSnapshot, content: unknown): DeepTutorProbeResult {
  const value = resultEnvelope(job, content);
  if (
    !exactRecord(value, [
      "packageInstalled",
      "mcpInstalled",
      "timedOut",
      "detail",
      "durationMs",
    ]) ||
    typeof value.packageInstalled !== "boolean" ||
    typeof value.mcpInstalled !== "boolean" ||
    (value.mcpInstalled && !value.packageInstalled) ||
    typeof value.timedOut !== "boolean" ||
    !boundedDetail(value.detail) ||
    !Number.isSafeInteger(value.durationMs) ||
    (value.durationMs as number) < 0 ||
    (value.durationMs as number) > PROBE_RUNTIME_MS
  ) throw new Error("Runtime returned an invalid Deep Tutor probe result.");
  return value as unknown as DeepTutorProbeResult;
}

interface DeepTutorIndexResult {
  ok: boolean;
  kb: string;
  fingerprint: string;
  builtAt: string | null;
  candidateCount: number;
  documentCount: number;
  chunkCount: number;
  durationMs: number;
  error: string;
}

function parseIndexResult(
  job: RuntimeJobSnapshot,
  content: unknown,
  kb: string,
  fingerprint: string,
): DeepTutorIndexResult {
  const value = resultEnvelope(job, content);
  if (
    !exactRecord(value, [
      "ok",
      "kb",
      "fingerprint",
      "builtAt",
      "candidateCount",
      "documentCount",
      "chunkCount",
      "durationMs",
      "error",
    ]) ||
    typeof value.ok !== "boolean" ||
    value.kb !== kb ||
    value.fingerprint !== fingerprint ||
    (value.builtAt !== null &&
      (typeof value.builtAt !== "string" || !Number.isFinite(Date.parse(value.builtAt)))) ||
    !Number.isSafeInteger(value.candidateCount) ||
    (value.candidateCount as number) < 0 ||
    (value.candidateCount as number) > MAX_INDEXED_FILES ||
    !Number.isSafeInteger(value.documentCount) ||
    (value.documentCount as number) < 0 ||
    (value.documentCount as number) > MAX_INDEXED_FILES ||
    !Number.isSafeInteger(value.chunkCount) ||
    (value.chunkCount as number) < 0 ||
    (value.chunkCount as number) > 100_000_000 ||
    !Number.isSafeInteger(value.durationMs) ||
    (value.durationMs as number) < 0 ||
    (value.durationMs as number) > INDEX_RUNTIME_MS ||
    !boundedDetail(value.error) ||
    (value.ok && (value.builtAt === null || value.error !== "")) ||
    (!value.ok && !value.error.trim())
  ) throw new Error("Runtime returned an invalid Deep Tutor index result.");
  return value as unknown as DeepTutorIndexResult;
}

interface DeepTutorIndexCheckpoint {
  operation: "index";
  kb: string;
  candidateCount: number;
  stage: string;
  percent: number;
  startedAt: number;
}

function parseIndexCheckpoint(
  job: RuntimeJobSnapshot,
  content: unknown,
  kb: string,
): DeepTutorIndexCheckpoint {
  if (
    !exactRecord(content, ["protocolVersion", "identity", "snapshot"]) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    !validIdentity(job, content.identity) ||
    !exactRecord(content.snapshot, [
      "operation",
      "kb",
      "candidateCount",
      "stage",
      "percent",
      "startedAt",
    ])
  ) throw new Error("Runtime returned an unfenced Deep Tutor index checkpoint.");
  const value = content.snapshot;
  if (
    value.operation !== "index" ||
    value.kb !== kb ||
    !Number.isSafeInteger(value.candidateCount) ||
    (value.candidateCount as number) < 0 ||
    (value.candidateCount as number) > MAX_INDEXED_FILES ||
    typeof value.stage !== "string" ||
    Buffer.byteLength(value.stage, "utf8") > 128 ||
    /\p{Cc}/u.test(value.stage) ||
    !Number.isSafeInteger(value.percent) ||
    (value.percent as number) < 0 ||
    (value.percent as number) > 100 ||
    !Number.isSafeInteger(value.startedAt) ||
    (value.startedAt as number) < 1
  ) throw new Error("Runtime returned an invalid Deep Tutor index checkpoint.");
  return value as unknown as DeepTutorIndexCheckpoint;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
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

/** Run the fixed import probe under authenticated native Runtime authority. */
export async function runDeepTutorProbeJob(input: {
  userId: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  control?: DeepTutorMaintenanceControl;
}): Promise<DeepTutorProbeResult> {
  const env = input.env ?? process.env;
  const control = input.control ?? DEFAULT_CONTROL;
  if (!control.configured(env)) {
    throw new RuntimeAuthorityUnavailableError(
      "Deep Tutor health checks require the Breadboard Runtime job owner.",
    );
  }
  const jobAuthority = authority(input.userId, "deep-tutor-health");
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Deep Tutor health timed out", "TimeoutError")),
    PROBE_RUNTIME_MS,
  );
  timeout.unref?.();
  const forwardAbort = () => controller.abort(
    input.signal?.reason ?? new DOMException("Request aborted", "AbortError"),
  );
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });
  let jobId: string | null = null;
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    let snapshot = await control.submit(jobAuthority, {
      jobType: "deep-tutor-probe",
      idempotencyKey: `deep-tutor-probe-v2:${input.userId}:${randomUUID()}`,
      requestPayload: { protocolVersion: PROTOCOL_VERSION, operation: "probe" },
    }, env);
    assertSnapshot(snapshot, "probe", jobAuthority);
    jobId = snapshot.jobId;
    while (!TERMINAL.has(snapshot.state)) {
      await delay(POLL_MS, controller.signal);
      snapshot = await control.inspect(jobAuthority, snapshot.jobId, env);
      assertSnapshot(snapshot, "probe", jobAuthority);
    }
    if (snapshot.state !== "succeeded") {
      throw new Error(
        snapshot.state === "resource_exhausted"
          ? "There is not enough free memory to inspect Deep Tutor right now."
          : snapshot.state === "cancelled"
            ? "The Deep Tutor environment check was cancelled."
            : "The Deep Tutor environment check was interrupted.",
      );
    }
    return parseProbeResult(
      snapshot,
      (await control.readOutput(jobAuthority, snapshot.jobId, "result", env)).content,
    );
  } catch (error) {
    if (jobId && controller.signal.aborted) {
      await control.cancel(jobAuthority, jobId, env).catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
  }
}

function failedReceipt(receipt: IndexJobReceipt, error: string): IndexJobReceipt {
  return {
    ...receipt,
    updatedAt: Date.now(),
    phase: "failed",
    stage: "failed",
    error: Buffer.from(error, "utf8").subarray(0, 8 * 1024).toString("utf8") ||
      "The Deep Tutor index was interrupted.",
  };
}

function terminalIndexError(snapshot: RuntimeJobSnapshot): string {
  if (snapshot.state === "resource_exhausted") {
    return "There is not enough free memory to rebuild the Deep Tutor index right now.";
  }
  if (snapshot.state === "cancelled") return "Indexing was cancelled.";
  return snapshot.failureMessage ?? "The Deep Tutor index worker was interrupted.";
}

async function readCheckpoint(
  control: DeepTutorMaintenanceControl,
  env: NodeJS.ProcessEnv,
  jobAuthority: RuntimeJobAuthority,
  snapshot: RuntimeJobSnapshot,
  kb: string,
): Promise<DeepTutorIndexCheckpoint | null> {
  if (!snapshot.workerInstanceId) return null;
  try {
    return parseIndexCheckpoint(
      snapshot,
      (await control.readOutput(jobAuthority, snapshot.jobId, "checkpoint", env)).content,
      kb,
    );
  } catch {
    return null;
  }
}

/** Reconcile a restart-safe receipt with Runtime's authoritative state. */
export async function refreshDeepTutorIndexJob(
  userId: number,
  scope: TutorScope,
  options: {
    env?: NodeJS.ProcessEnv;
    control?: DeepTutorMaintenanceControl;
  } = {},
): Promise<IndexState> {
  const receipt = readIndexJobReceipt(userId, scope);
  if (!receipt?.jobId || receipt.phase !== "building") return indexState(userId, scope);
  const kb = knowledgeBaseName(scope);
  if (!kb) return indexState(userId, scope);
  const env = options.env ?? process.env;
  const control = options.control ?? DEFAULT_CONTROL;
  if (!control.configured(env)) return indexState(userId, scope);
  const jobAuthority = authority(userId, indexConversationId(scope.id));
  let snapshot: RuntimeJobSnapshot;
  try {
    snapshot = await control.inspect(jobAuthority, receipt.jobId, env);
    assertSnapshot(snapshot, "index", jobAuthority);
  } catch (error) {
    if (error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND") {
      writeIndexJobReceipt(
        userId,
        scope,
        failedReceipt(receipt, "The Deep Tutor index job was lost during restart."),
      );
    }
    return indexState(userId, scope);
  }

  if (!TERMINAL.has(snapshot.state)) {
    const checkpoint = await readCheckpoint(control, env, jobAuthority, snapshot, kb);
    writeIndexJobReceipt(userId, scope, {
      ...receipt,
      updatedAt: Date.now(),
      candidateCount: checkpoint?.candidateCount ?? receipt.candidateCount,
      stage: checkpoint?.stage ?? receipt.stage,
      percent: checkpoint?.percent ?? receipt.percent,
    });
    return indexState(userId, scope);
  }

  if (snapshot.state !== "succeeded") {
    writeIndexJobReceipt(
      userId,
      scope,
      failedReceipt(receipt, terminalIndexError(snapshot)),
    );
    return indexState(userId, scope);
  }

  try {
    const result = parseIndexResult(
      snapshot,
      (await control.readOutput(jobAuthority, snapshot.jobId, "result", env)).content,
      kb,
      embeddingFingerprint(),
    );
    if (!result.ok) {
      writeIndexJobReceipt(userId, scope, failedReceipt(receipt, result.error));
      return indexState(userId, scope);
    }
    const manifest = readManifest(userId, scope);
    if (
      !manifest ||
      manifest.kb !== result.kb ||
      manifest.fingerprint !== result.fingerprint ||
      manifest.builtAt !== result.builtAt ||
      manifest.documentCount !== result.documentCount ||
      manifest.chunkCount !== result.chunkCount
    ) {
      throw new Error("The Runtime worker completed without its durable Deep Tutor manifest.");
    }
    clearIndexJobReceipt(userId, scope);
  } catch (error) {
    writeIndexJobReceipt(
      userId,
      scope,
      failedReceipt(
        receipt,
        error instanceof Error ? error.message : "The Deep Tutor index result was invalid.",
      ),
    );
  }
  return indexState(userId, scope);
}

export interface DeepTutorIndexStartResult {
  state: IndexState;
  started: boolean;
}

/** Submit a forced rebuild and return as soon as native admission is durable. */
async function rebuildDeepTutorIndexOnce(
  userId: number,
  scope: TutorScope,
  options: {
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
    control?: DeepTutorMaintenanceControl;
    now?: () => number;
  } = {},
): Promise<DeepTutorIndexStartResult> {
  if (knowledgeBaseName(scope) === null) {
    return { state: indexState(userId, scope), started: false };
  }
  let state = await refreshDeepTutorIndexJob(userId, scope, options);
  if (state.phase === "building" || !state.candidateCount) {
    return { state, started: false };
  }
  const root = scope.roots.length === 1 ? scope.roots[0] : null;
  const kb = knowledgeBaseName(scope);
  if (!root || !kb) return { state, started: false };
  const env = options.env ?? process.env;
  const control = options.control ?? DEFAULT_CONTROL;
  if (!control.configured(env)) {
    throw new RuntimeAuthorityUnavailableError(
      "Deep Tutor indexing requires the Breadboard Runtime job owner.",
    );
  }
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const jobAuthority = authority(userId, indexConversationId(scope.id));
  clearManifest(userId, scope);
  clearIndexJobReceipt(userId, scope);
  const snapshot = await control.submit(jobAuthority, {
    jobType: "deep-tutor-index",
    idempotencyKey: `deep-tutor-index-v2:${userId}:${randomUUID()}`,
    requestPayload: {
      protocolVersion: PROTOCOL_VERSION,
      operation: "index",
      root,
      scopeId: scope.id,
      kb,
      fingerprint: embeddingFingerprint(),
    },
  }, env);
  assertSnapshot(snapshot, "index", jobAuthority);
  if (options.signal?.aborted) {
    await control.cancel(jobAuthority, snapshot.jobId, env).catch(() => undefined);
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const startedAt = options.now?.() ?? Date.now();
  const receipt: IndexJobReceipt = {
    protocolVersion: 1,
    jobId: snapshot.jobId,
    startedAt,
    updatedAt: startedAt,
    candidateCount: state.candidateCount,
    phase: "building",
    stage: "starting",
    percent: 0,
    error: null,
  };
  try {
    writeIndexJobReceipt(userId, scope, receipt);
  } catch (error) {
    await control.cancel(jobAuthority, snapshot.jobId, env).catch(() => undefined);
    throw error;
  }
  state = indexState(userId, scope);
  return { state, started: true };
}

const globalIndexStarts = globalThis as typeof globalThis & {
  __breadboardDeepTutorIndexStarts?: Map<string, Promise<DeepTutorIndexStartResult>>;
};
const indexStarts = globalIndexStarts.__breadboardDeepTutorIndexStarts ??
  new Map<string, Promise<DeepTutorIndexStartResult>>();
globalIndexStarts.__breadboardDeepTutorIndexStarts = indexStarts;

/** Duplicate clicks share one admission attempt for the same learner/scope. */
export function rebuildDeepTutorIndex(
  userId: number,
  scope: TutorScope,
  options: {
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
    control?: DeepTutorMaintenanceControl;
    now?: () => number;
  } = {},
): Promise<DeepTutorIndexStartResult> {
  const key = `${userId}:${scope.id}`;
  const existing = indexStarts.get(key);
  if (existing) return existing;
  const started = rebuildDeepTutorIndexOnce(userId, scope, options).finally(() => {
    if (indexStarts.get(key) === started) indexStarts.delete(key);
  });
  indexStarts.set(key, started);
  return started;
}

/** Cancel the current scoped index worker and wait until its tree is terminal. */
export async function cancelDeepTutorIndex(
  userId: number,
  scope: TutorScope,
  options: {
    env?: NodeJS.ProcessEnv;
    control?: DeepTutorMaintenanceControl;
  } = {},
): Promise<IndexState> {
  const receipt = readIndexJobReceipt(userId, scope);
  if (!receipt || receipt.phase !== "building") return indexState(userId, scope);
  const env = options.env ?? process.env;
  const control = options.control ?? DEFAULT_CONTROL;
  if (!control.configured(env)) {
    throw new RuntimeAuthorityUnavailableError(
      "Deep Tutor cancellation requires the Breadboard Runtime job owner.",
    );
  }
  const jobAuthority = authority(userId, indexConversationId(scope.id));
  let snapshot = await control.cancel(jobAuthority, receipt.jobId, env);
  assertSnapshot(snapshot, "index", jobAuthority);
  const deadline = Date.now() + CANCEL_RUNTIME_MS;
  while (!TERMINAL.has(snapshot.state)) {
    if (Date.now() >= deadline) {
      throw new Error("Deep Tutor indexing did not stop within its cancellation deadline.");
    }
    await delay(POLL_MS);
    snapshot = await control.inspect(jobAuthority, receipt.jobId, env);
    assertSnapshot(snapshot, "index", jobAuthority);
  }
  if (snapshot.state === "succeeded") {
    return refreshDeepTutorIndexJob(userId, scope, options);
  }
  writeIndexJobReceipt(
    userId,
    scope,
    failedReceipt(receipt, terminalIndexError(snapshot)),
  );
  return indexState(userId, scope);
}

/** Current UI projection after authoritative Runtime reconciliation. */
export async function deepTutorIndexStatus(
  userId: number,
  scope: TutorScope,
): Promise<IndexState & { progress: ReturnType<typeof buildProgress> }> {
  const state = await refreshDeepTutorIndexJob(userId, scope);
  return { ...state, progress: buildProgress(userId, scope) };
}

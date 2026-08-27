import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

import type {
  LearnTaskHandoff,
  LearnWorkerRequest,
} from "@/lib/learn-background";
import db from "@/lib/db";
import {
  readRuntimeV2LearnBinding,
  type RuntimeV2LearnBinding,
} from "@/lib/runtime-v2/learn-binding";
import {
  cancelRuntimeJob,
  inspectRuntimeJob,
  inspectRuntimeJobForStatus,
  replayRuntimeJobEventsForStatus,
  RuntimeJobControlError,
  submitRuntimeJob,
  type RuntimeJobEventRecord,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
} from "@/lib/supervisor-control";

const RECEIPT_VERSION = 1 as const;
const RECEIPT_NAME = "runtime-v2-learn-submission.json";
const MAX_RECEIPT_BYTES = 16 * 1024;
const MAX_CANONICAL_NODES = 16_384;
const RUNTIME_JOB_ID = /^job_[0-9a-f]{64}$/;
const TERMINAL_RUNTIME_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

interface RuntimeV2LearnReceipt {
  readonly version: typeof RECEIPT_VERSION;
  readonly runtimeJobId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly operation: LearnWorkerRequest["operation"];
  readonly userId: number;
  readonly gardenId: string;
  readonly model: string | null;
  readonly humanizerEnabled: boolean | null;
  readonly humanizerVersionId: string | null;
  readonly baselineLearnJobId: string | null;
  readonly baselineLearnJobUpdatedAt: string | null;
  readonly submittedAt: string;
}

interface RuntimeV2LearnScopeInput {
  readonly userId: number;
  readonly gardenId: string;
  readonly contentPath: string;
}

interface RuntimeV2LearnCancellationInput extends RuntimeV2LearnScopeInput {
  readonly expectedJobId?: string;
}

export interface RuntimeV2LearnCancellation {
  readonly handled: boolean;
  readonly runtimeJob: RuntimeJobSnapshot | null;
}

export interface RuntimeV2LearnEventCompatibility {
  readonly runtimeJobId: string;
  readonly legacyJobId: string | null;
  readonly events: readonly {
    readonly at: string;
    readonly type: string;
    readonly line: string;
    readonly jobId: string;
  }[];
}

interface LearnJobFence {
  readonly id: string;
  readonly model: string;
  readonly status: string;
  readonly updatedAt: string;
}

/** Keep the established route conflict response while the native owner is busy. */
class LearnWorkerConflictError extends Error {
  readonly requiresReplan = false;

  constructor(message: string) {
    super(message);
    this.name = "LearnWorkerConflictError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function runtimeAuthority(userId: number, gardenId: string): RuntimeJobAuthority {
  return { userId, gardenId, conversationId: null };
}

function latestLearnJobFence(gardenId: string): LearnJobFence | null {
  let row: unknown;
  try {
    row = db.prepare(
      `SELECT id, model, status, updated_at AS updatedAt
       FROM learn_jobs
       WHERE garden_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    ).get(gardenId);
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code === "SQLITE_ERROR" && /no such table:\s*learn_jobs/i.test(candidate.message)) {
      return null;
    }
    throw error;
  }
  if (!isRecord(row)) return null;
  if (
    typeof row.id !== "string" ||
    !row.id ||
    typeof row.model !== "string" ||
    !row.model ||
    typeof row.status !== "string" ||
    !row.status ||
    typeof row.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(row.updatedAt))
  ) {
    throw new Error("The latest Learn job fence is invalid.");
  }
  return {
    id: row.id,
    model: row.model,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

function correlatedLearnJob(
  receipt: RuntimeV2LearnReceipt,
  candidate: LearnJobFence | null,
  binding: RuntimeV2LearnBinding | null,
): LearnJobFence | null {
  if (
    !binding ||
    !candidate ||
    binding.runtimeJobId !== receipt.runtimeJobId ||
    binding.learnJobId !== candidate.id ||
    candidate.status === "idle" ||
    receipt.operation === "humanizer"
  ) {
    return null;
  }
  return candidate;
}

function learnJobFenceById(gardenId: string, jobId: string): LearnJobFence | null {
  const row: unknown = db.prepare(
    `SELECT id, model, status, updated_at AS updatedAt
     FROM learn_jobs
     WHERE garden_id = ? AND id = ?
     LIMIT 1`,
  ).get(gardenId, jobId);
  if (!isRecord(row)) return null;
  if (
    row.id !== jobId ||
    typeof row.model !== "string" ||
    !row.model ||
    typeof row.status !== "string" ||
    !row.status ||
    typeof row.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(row.updatedAt))
  ) {
    throw new Error("The Runtime-bound Learn job fence is invalid.");
  }
  return {
    id: row.id,
    model: row.model,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

function receiptBinding(
  input: RuntimeV2LearnScopeInput,
  receipt: RuntimeV2LearnReceipt,
): RuntimeV2LearnBinding | null {
  return readRuntimeV2LearnBinding({
    contentPath: input.contentPath,
    gardenId: input.gardenId,
    userId: input.userId,
    runtimeJobId: receipt.runtimeJobId,
  });
}

function learnJobFenceFromSnapshot(snapshot: Record<string, unknown>): LearnJobFence | null {
  const job = snapshot.job;
  if (
    !isRecord(job) ||
    typeof job.id !== "string" ||
    !job.id ||
    typeof job.model !== "string" ||
    !job.model ||
    typeof job.status !== "string" ||
    !job.status ||
    typeof job.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(job.updatedAt))
  ) {
    return null;
  }
  return {
    id: job.id,
    model: job.model,
    status: job.status,
    updatedAt: job.updatedAt,
  };
}

function gardenRoot(contentPath: string, gardenId: string): string {
  const root = path.resolve(contentPath);
  const candidate = path.resolve(root, gardenId);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new TypeError("The Learn garden path is outside its content authority.");
  }
  return candidate;
}

function receiptPath(contentPath: string, gardenId: string): string {
  return path.join(gardenRoot(contentPath, gardenId), ".breadboard", RECEIPT_NAME);
}

function validReceipt(
  value: unknown,
  expected: Pick<RuntimeV2LearnReceipt, "userId" | "gardenId">,
): value is RuntimeV2LearnReceipt {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "version",
      "runtimeJobId",
      "idempotencyKey",
      "requestDigest",
      "operation",
      "userId",
      "gardenId",
      "model",
      "humanizerEnabled",
      "humanizerVersionId",
      "baselineLearnJobId",
      "baselineLearnJobUpdatedAt",
      "submittedAt",
    ]) &&
    value.version === RECEIPT_VERSION &&
    typeof value.runtimeJobId === "string" &&
    RUNTIME_JOB_ID.test(value.runtimeJobId) &&
    typeof value.idempotencyKey === "string" &&
    value.idempotencyKey.length > 0 &&
    value.idempotencyKey.length <= 256 &&
    typeof value.requestDigest === "string" &&
    /^[0-9a-f]{64}$/.test(value.requestDigest) &&
    typeof value.operation === "string" &&
    [
      "confirm",
      "plan",
      "generate",
      "confirm_generate",
      "repair",
      "rebuild",
      "humanizer",
    ].includes(value.operation) &&
    value.userId === expected.userId &&
    value.gardenId === expected.gardenId &&
    (value.model === null ||
      (typeof value.model === "string" && value.model.length > 0 && value.model.length <= 512)) &&
    (value.humanizerEnabled === null || typeof value.humanizerEnabled === "boolean") &&
    (value.humanizerVersionId === null ||
      (typeof value.humanizerVersionId === "string" &&
        value.humanizerVersionId.length > 0 &&
        value.humanizerVersionId.length <= 512)) &&
    (value.baselineLearnJobId === null ||
      (typeof value.baselineLearnJobId === "string" &&
        value.baselineLearnJobId.length > 0 &&
        value.baselineLearnJobId.length <= 512)) &&
    (value.baselineLearnJobUpdatedAt === null ||
      (typeof value.baselineLearnJobUpdatedAt === "string" &&
        Number.isFinite(Date.parse(value.baselineLearnJobUpdatedAt)))) &&
    ((value.baselineLearnJobId === null) ===
      (value.baselineLearnJobUpdatedAt === null)) &&
    (value.operation === "humanizer"
      ? typeof value.humanizerEnabled === "boolean"
      : value.humanizerEnabled === null && value.humanizerVersionId === null) &&
    typeof value.submittedAt === "string" &&
    Number.isFinite(Date.parse(value.submittedAt))
  );
}

function readReceipt(
  contentPath: string,
  userId: number,
  gardenId: string,
): RuntimeV2LearnReceipt | null {
  const target = receiptPath(contentPath, gardenId);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(target, "r");
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_RECEIPT_BYTES) {
      throw new Error("The Runtime Learn receipt is invalid.");
    }
    const bytes = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (count === 0) throw new Error("The Runtime Learn receipt is truncated.");
      offset += count;
    }
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!validReceipt(value, { userId, gardenId })) {
      throw new Error("The Runtime Learn receipt is outside its authenticated scope.");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeReceipt(
  contentPath: string,
  receipt: RuntimeV2LearnReceipt,
): void {
  const target = receiptPath(contentPath, receipt.gardenId);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8");
  if (bytes.byteLength > MAX_RECEIPT_BYTES) {
    throw new Error("The Runtime Learn receipt exceeds its storage bound.");
  }
  const temporary = path.join(
    directory,
    `.${RECEIPT_NAME}.${process.pid}.${randomUUID()}.pending`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the original durable-write error.
    }
    throw error;
  }
}

function canonicalRuntimeJson(value: unknown): unknown {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (candidate: unknown, inArray: boolean): unknown => {
    nodes += 1;
    if (nodes > MAX_CANONICAL_NODES) {
      throw new TypeError("The Learn request is too complex.");
    }
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        throw new TypeError("The Learn request contains a non-finite number.");
      }
      return candidate;
    }
    if (candidate === undefined && !inArray) return undefined;
    if (typeof candidate !== "object" || candidate === null) {
      throw new TypeError("The Learn request contains a non-JSON value.");
    }
    if (ancestors.has(candidate)) {
      throw new TypeError("The Learn request contains a cycle.");
    }
    ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        return candidate.map((item) => {
          const normalized = visit(item, true);
          if (normalized === undefined) {
            throw new TypeError("The Learn request contains an undefined array item.");
          }
          return normalized;
        });
      }
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("The Learn request must contain plain JSON objects.");
      }
      const output: Record<string, unknown> = {};
      for (const key of Object.keys(candidate).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!descriptor?.enumerable) continue;
        if (!("value" in descriptor)) {
          throw new TypeError("The Learn request cannot contain accessors.");
        }
        const normalized = visit(descriptor.value, false);
        if (normalized !== undefined) output[key] = normalized;
      }
      return output;
    } finally {
      ancestors.delete(candidate);
    }
  };
  return visit(value, false);
}

function requestPayload(request: LearnWorkerRequest): Record<string, unknown> {
  const untrustedPayload: Record<string, unknown> = { ...request };
  delete untrustedPayload.userId;
  delete untrustedPayload.gardenId;
  delete untrustedPayload.contentPath;
  const normalized = canonicalRuntimeJson(untrustedPayload);
  if (!isRecord(normalized)) {
    throw new TypeError("The Learn request payload is invalid.");
  }
  for (const field of ["userId", "gardenId", "conversationId", "contentPath"]) {
    if (Object.hasOwn(normalized, field)) {
      throw new TypeError(`The Learn request payload duplicates ${field} authority.`);
    }
  }
  return normalized;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requestDigest(payload: Record<string, unknown>): string {
  return sha256(JSON.stringify(payload));
}

function receiptModel(payload: Record<string, unknown>): string | null {
  for (const candidate of [payload.model, payload.expectedModel]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function idempotencyKey(
  authority: RuntimeJobAuthority,
  digest: string,
  predecessorJobId: string | null,
): string {
  return `learn-v2:${sha256(JSON.stringify({
    version: 1,
    userId: authority.userId,
    gardenId: authority.gardenId,
    conversationId: authority.conversationId,
    requestDigest: digest,
    predecessorJobId,
  }))}`;
}

function terminal(job: RuntimeJobSnapshot): boolean {
  return TERMINAL_RUNTIME_STATES.has(job.state);
}

function isRuntimeV2LearnJob(
  job: RuntimeJobSnapshot,
  gardenId: string,
): boolean {
  return (
    job.jobType === "learn" &&
    job.workerKind === "learn-node" &&
    job.resourceClass === "large-generation" &&
    job.gardenId === gardenId &&
    job.conversationId === null
  );
}

async function inspectReceiptJob(
  authority: RuntimeJobAuthority,
  receipt: RuntimeV2LearnReceipt,
  readOnlyStatus = false,
): Promise<RuntimeJobSnapshot | null> {
  try {
    const job = await (readOnlyStatus
      ? inspectRuntimeJobForStatus(authority, receipt.runtimeJobId)
      : inspectRuntimeJob(authority, receipt.runtimeJobId));
    if (!isRuntimeV2LearnJob(job, receipt.gardenId)) {
      throw new Error(
        "The Runtime Learn receipt does not identify a Learn worker job.",
      );
    }
    return job;
  } catch (error) {
    if (error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

function runtimeIso(timestamp: number, fallback: string): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : fallback;
}

function compatibilityMode(
  operation: RuntimeV2LearnReceipt["operation"],
): "plan" | "generate" | "repair" | "full_rebuild" {
  switch (operation) {
    case "generate":
    case "confirm_generate":
      return "generate";
    case "repair":
      return "repair";
    case "rebuild":
      return "full_rebuild";
    default:
      return "plan";
  }
}

function compatibilityActiveStatus(
  operation: RuntimeV2LearnReceipt["operation"],
): "planning" | "analyzing_issues" | "generating_learning_pages" {
  if (operation === "repair") return "analyzing_issues";
  if (
    operation === "generate" ||
    operation === "confirm_generate" ||
    operation === "rebuild"
  ) {
    return "generating_learning_pages";
  }
  return "planning";
}

function compatibilityStatus(
  receipt: RuntimeV2LearnReceipt,
  job: RuntimeJobSnapshot,
): string {
  if (job.state === "succeeded") return "complete";
  if (job.state === "cancelled") return "cancelled";
  if (terminal(job)) return "failed";
  return compatibilityActiveStatus(receipt.operation);
}

function compatibilityStep(job: RuntimeJobSnapshot): string {
  switch (job.state) {
    case "queued":
      return "Waiting for Runtime admission";
    case "admitted":
      return "Runtime reserved Learn capacity";
    case "starting":
      return "Starting the isolated Learn worker";
    case "running":
    case "checkpointing":
      return "Starting the durable Learn operation";
    case "cancelling":
      return "Stopping the Learn operation";
    case "cancelled":
      return "Learn operation stopped";
    case "succeeded":
      return "Learn operation completed";
    default:
      return "Runtime could not complete the Learn operation";
  }
}

function compatibilityJob(
  receipt: RuntimeV2LearnReceipt,
  job: RuntimeJobSnapshot,
  fallbackModel: string | null,
): Record<string, unknown> {
  const updatedAt = runtimeIso(job.updatedAt, receipt.submittedAt);
  const startedAt = Date.parse(receipt.submittedAt);
  const finished = terminal(job);
  const progressPercent = job.progressTotal > 0
    ? Math.round((job.progressCurrent / job.progressTotal) * 100)
    : finished
      ? 100
      : 0;
  return {
    id: job.jobId,
    model: receipt.model ?? fallbackModel ?? "Runtime Learn",
    status: compatibilityStatus(receipt, job),
    mode: compatibilityMode(receipt.operation),
    currentStep: compatibilityStep(job),
    progressPercent,
    ...(job.failureMessage ? { error: job.failureMessage } : {}),
    requiresReplan: false,
    elapsedMs: Math.max(0, Date.parse(updatedAt) - startedAt),
    timerStartedAt: receipt.submittedAt,
    createdAt: runtimeIso(job.createdAt, receipt.submittedAt),
    updatedAt,
  };
}

function compatibilityHumanizer(
  snapshot: Record<string, unknown>,
  receipt: RuntimeV2LearnReceipt,
  job: RuntimeJobSnapshot,
): Record<string, unknown> {
  const existing = isRecord(snapshot.humanizer) ? snapshot.humanizer : {};
  const enabled = receipt.humanizerEnabled === true;
  let status: string;
  if (job.state === "succeeded") status = enabled ? "humanized" : "ai";
  else if (job.state === "cancelled") {
    status = typeof existing.status === "string"
      ? existing.status
      : enabled ? "ai" : "humanized";
  } else if (terminal(job)) status = "failed";
  else status = enabled ? "running" : "restoring_ai";
  const activeCopy = existing.activeCopy === "humanized" || existing.activeCopy === "ai"
    ? existing.activeCopy
    : enabled ? "ai" : "humanized";
  return {
    versionId:
      receipt.humanizerVersionId ??
      (typeof existing.versionId === "string" ? existing.versionId : null) ??
      (typeof snapshot.latestTextbookVersionId === "string"
        ? snapshot.latestTextbookVersionId
        : job.jobId),
    requested: enabled,
    activeCopy,
    status,
    reason: compatibilityStep(job),
    ...(job.failureMessage ? { error: job.failureMessage } : {}),
    updatedAt: runtimeIso(job.updatedAt, receipt.submittedAt),
  };
}

/**
 * Preserve the legacy status DTO while the native job is queued or importing
 * the Learn source closure. Once a real Learn row changes past the submission
 * fence, that durable row is the sole status projection again.
 */
export async function mergeRuntimeV2LearnStatus(
  input: RuntimeV2LearnScopeInput,
  snapshot: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const receipt = readReceipt(input.contentPath, input.userId, input.gardenId);
  if (!receipt) return snapshot;
  const runtimeJob = await inspectReceiptJob(
    runtimeAuthority(input.userId, input.gardenId),
    receipt,
    true,
  );
  if (!runtimeJob) return snapshot;
  const withRuntime = { ...snapshot, runtimeJob };
  if (receipt.operation === "humanizer") {
    return {
      ...withRuntime,
      humanizer: compatibilityHumanizer(snapshot, receipt, runtimeJob),
    };
  }
  const binding = receiptBinding(input, receipt);
  const boundLearnJob = binding
    ? learnJobFenceById(input.gardenId, binding.learnJobId)
    : null;
  if (correlatedLearnJob(receipt, boundLearnJob, binding)) return withRuntime;
  const snapshotFence = learnJobFenceFromSnapshot(snapshot);
  return {
    ...withRuntime,
    job: compatibilityJob(receipt, runtimeJob, snapshotFence?.model ?? null),
  };
}

function runtimeEventLine(event: RuntimeJobEventRecord): string {
  const labels: Partial<Record<RuntimeJobEventRecord["eventType"], string>> = {
    queued: "Learn queued by Runtime",
    admitted: "Runtime reserved Learn capacity",
    "worker-assigned": "Runtime assigned the Learn worker",
    "worker-ready": "The isolated Learn worker is ready",
    "worker-heartbeat": "The isolated Learn worker is active",
    "worker-progress": "The isolated Learn worker reported progress",
    "worker-checkpoint": "The isolated Learn worker saved a checkpoint",
    "worker-complete": "The isolated Learn worker completed",
    "worker-failed": "The isolated Learn worker failed",
    "worker-cancellation-acknowledged": "The Learn worker acknowledged Stop",
    "cancellation-requested": "Runtime requested Learn cancellation",
    "job-cancelling": "Runtime is stopping Learn",
    "job-cancelled": "Runtime stopped Learn",
    "job-succeeded": "Runtime completed Learn",
    "job-failed": "Runtime marked Learn failed",
    "job-resource-exhausted": "Runtime refused Learn because memory was unavailable",
    "job-interrupted": "Runtime recorded an interrupted Learn run",
    "job-uncertain": "Runtime recorded an uncertain Learn outcome",
  };
  const payload: Readonly<Record<string, unknown>> = isRecord(event.payload)
    ? event.payload
    : {};
  const stage = payload.stage;
  const progressCurrent = payload.progressCurrent;
  const progressTotal = payload.progressTotal;
  const details: string[] = [];
  if (typeof stage === "string") details.push(`stage=${stage}`);
  if (
    typeof progressCurrent === "number" &&
    typeof progressTotal === "number"
  ) {
    details.push(`progress=${progressCurrent}/${progressTotal}`);
  }
  const label = labels[event.eventType] ?? `Runtime ${event.eventType}`;
  return details.length > 0 ? `${label} (${details.join(", ")})` : label;
}

async function runtimeCompatibilityEvents(
  authority: RuntimeJobAuthority,
  jobId: string,
): Promise<RuntimeV2LearnEventCompatibility["events"]> {
  const events: Array<RuntimeV2LearnEventCompatibility["events"][number]> = [];
  let after = 0;
  for (let page = 0; page < 4; page += 1) {
    const replay = await replayRuntimeJobEventsForStatus(
      authority,
      jobId,
      after,
      100,
    );
    for (const event of replay.events) {
      events.push({
        at: runtimeIso(event.createdAt, new Date(0).toISOString()),
        type: `learn_runtime_${event.eventType.replaceAll("-", "_")}`,
        line: runtimeEventLine(event),
        jobId,
      });
    }
    if (!replay.hasMore) break;
    after = replay.nextAfter;
  }
  return events;
}

/** Select exactly one event source: Runtime until the Learn row appears, then legacy. */
export async function getRuntimeV2LearnEventCompatibility(
  input: RuntimeV2LearnScopeInput & { readonly requestedJobId?: string },
): Promise<RuntimeV2LearnEventCompatibility | null> {
  const receipt = readReceipt(input.contentPath, input.userId, input.gardenId);
  if (!receipt) return null;
  const requestedJobId = input.requestedJobId?.trim();
  if (requestedJobId && requestedJobId !== receipt.runtimeJobId) return null;
  const authority = runtimeAuthority(input.userId, input.gardenId);
  const runtimeJob = await inspectReceiptJob(authority, receipt, true);
  if (!runtimeJob) return null;
  const binding = receiptBinding(input, receipt);
  const boundLearnJob = binding
    ? learnJobFenceById(input.gardenId, binding.learnJobId)
    : null;
  const legacy = correlatedLearnJob(receipt, boundLearnJob, binding);
  if (legacy) {
    return {
      runtimeJobId: receipt.runtimeJobId,
      legacyJobId: legacy.id,
      events: [],
    };
  }
  return {
    runtimeJobId: receipt.runtimeJobId,
    legacyJobId: null,
    events: await runtimeCompatibilityEvents(authority, receipt.runtimeJobId),
  };
}

/**
 * Submit one authenticated Learn operation to the native Runtime V2 owner.
 * The legacy request type remains the route-facing API only: path and identity
 * authority are removed before the durable worker input is canonicalized.
 */
export async function executeLearnOperationForRoute<T>(
  request: LearnWorkerRequest,
  label: string,
): Promise<LearnTaskHandoff<T>> {
  void label;
  const authority = runtimeAuthority(request.userId, request.gardenId);
  const payload = requestPayload(request);
  const digest = requestDigest(payload);
  const previous = readReceipt(
    request.contentPath,
    request.userId,
    request.gardenId,
  );
  let key: string;
  let baseline: LearnJobFence | null;
  let submittedAt: string;

  if (previous) {
    const previousJob = await inspectReceiptJob(authority, previous);
    if (previousJob && !terminal(previousJob)) {
      if (previous.requestDigest !== digest) {
        throw new LearnWorkerConflictError(
          `Another Learn operation (${previous.runtimeJobId}) is still active for this garden.`,
        );
      }
      key = previous.idempotencyKey;
      baseline = previous.baselineLearnJobId === null
        ? null
        : {
            id: previous.baselineLearnJobId,
            model: previous.model ?? "unknown",
            status: "unknown",
            updatedAt: previous.baselineLearnJobUpdatedAt as string,
          };
      submittedAt = previous.submittedAt;
    } else {
      key = idempotencyKey(authority, digest, previous.runtimeJobId);
      baseline = latestLearnJobFence(request.gardenId);
      submittedAt = new Date().toISOString();
    }
  } else {
    key = idempotencyKey(authority, digest, null);
    baseline = latestLearnJobFence(request.gardenId);
    submittedAt = new Date().toISOString();
  }

  const job = await submitRuntimeJob(authority, {
    jobType: "learn",
    idempotencyKey: key,
    requestPayload: payload,
  });
  writeReceipt(request.contentPath, {
    version: RECEIPT_VERSION,
    runtimeJobId: job.jobId,
    idempotencyKey: key,
    requestDigest: digest,
    operation: request.operation,
    userId: request.userId,
    gardenId: request.gardenId,
    model: receiptModel(payload),
    humanizerEnabled:
      request.operation === "humanizer" ? request.enabled : null,
    humanizerVersionId:
      request.operation === "humanizer" ? request.expectedVersionId ?? null : null,
    baselineLearnJobId: baseline?.id ?? null,
    baselineLearnJobUpdatedAt: baseline?.updatedAt ?? null,
    submittedAt,
  });
  return { accepted: true, jobId: job.jobId };
}

/**
 * Cancels the active native Learn job when a Runtime receipt owns the garden.
 * A direct Runtime job ID from the 202 receipt remains valid even if the local
 * correlation receipt was lost; authenticated control headers enforce scope.
 */
export async function cancelRuntimeV2LearnOperation(
  input: RuntimeV2LearnCancellationInput,
): Promise<RuntimeV2LearnCancellation> {
  const authority = runtimeAuthority(input.userId, input.gardenId);
  const expectedJobId = input.expectedJobId?.trim();
  if (expectedJobId && RUNTIME_JOB_ID.test(expectedJobId)) {
    const expectedJob = await inspectRuntimeJob(authority, expectedJobId);
    if (!isRuntimeV2LearnJob(expectedJob, input.gardenId)) {
      return { handled: false, runtimeJob: null };
    }
    return {
      handled: true,
      runtimeJob: await cancelRuntimeJob(authority, expectedJobId),
    };
  }
  // The legacy Learn job ID is an optimistic-concurrency token. Only the
  // legacy transaction can validate it exactly; the route calls back without
  // that token after validation so a stale UI cannot cancel a replacement.
  if (expectedJobId) {
    return { handled: false, runtimeJob: null };
  }

  const receipt = readReceipt(input.contentPath, input.userId, input.gardenId);
  if (!receipt) return { handled: false, runtimeJob: null };
  const current = await inspectReceiptJob(authority, receipt);
  if (!current || terminal(current)) {
    return { handled: false, runtimeJob: current };
  }
  return {
    handled: true,
    runtimeJob: await cancelRuntimeJob(authority, receipt.runtimeJobId),
  };
}

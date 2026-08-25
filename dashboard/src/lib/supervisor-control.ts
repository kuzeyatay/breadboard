// Do not let an accidental Client Component import turn this server-side
// control surface into browser code. Only non-NEXT_PUBLIC environment keys are
// read below, so the per-launch bearer is never compiled into a client bundle.
if (typeof window !== "undefined") {
  throw new Error("Breadboard supervisor control is server-only.");
}

const CONTROL_TIMEOUT_MS = 4 * 60_000;
const MAX_CONTROL_RESPONSE_BYTES = 64 * 1024;
const MAX_JOB_REQUEST_BYTES = 256 * 1024;
const MAX_JOB_EVENT_REPLAY_RECORDS = 256;
const MAX_RUNTIME_IDENTIFIER_BYTES = 128;
const MAX_RUNTIME_SCOPE_BYTES = 256;
const MAX_RUNTIME_IDEMPOTENCY_KEY_BYTES = 256;
const MAX_RUNTIME_ERROR_BYTES = 8 * 1024;
const MAX_RUNTIME_JSON_NODES = 100_000;
const MIN_CONTROL_TOKEN_BYTES = 32;
const MAX_CONTROL_TOKEN_BYTES = 1024;
const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);

export type SupervisedServiceId =
  | "hermes"
  | "quartz"
  | "gbrain"
  | "ui-tars"
  | "cad"
  | "colpali"
  | "humanizer"
  | "voicebox"
  | "scriberr";

export type SupervisedCapabilityId =
  | "learn-worker"
  | "document-ingestion"
  | "artifact-render"
  | "browser-agent"
  | "postiz-stack";

export interface SupervisorLease {
  id: string;
  targetId: string;
}

export type SupervisedServiceLifecycleState =
  | "pending"
  | "starting"
  | "healthy"
  | "degraded"
  | "failed"
  | "stopping"
  | "stopped"
  | "available-but-stopped"
  | "ready"
  | "busy"
  | "resource-blocked"
  | "installation-unavailable";

const SUPERVISED_SERVICE_STATES = new Set<SupervisedServiceLifecycleState>([
  "pending",
  "starting",
  "healthy",
  "degraded",
  "failed",
  "stopping",
  "stopped",
  "available-but-stopped",
  "ready",
  "busy",
  "resource-blocked",
  "installation-unavailable",
]);

export interface SupervisedServiceSnapshot {
  id: SupervisedServiceId;
  state: SupervisedServiceLifecycleState;
}

export interface ResourceExhaustionResult {
  code: "BREADBOARD_RESOURCE_EXHAUSTED";
  resource: "windows_commit";
  requiredHeadroomMb: number;
  availableHeadroomMb: number;
  reserveHeadroomMb?: number;
  incomingEstimateMb?: number;
  overlapHeadroomMb?: number;
  denialReason?: "active_heavyweight" | "headroom" | "pressure";
  retryable: false;
  state: "normal" | "constrained" | "critical" | "emergency";
}

export class SupervisorResourceExhaustedError extends Error {
  readonly result: ResourceExhaustionResult;

  constructor(result: ResourceExhaustionResult) {
    const breakdown =
      typeof result.reserveHeadroomMb === "number" &&
      typeof result.incomingEstimateMb === "number" &&
      typeof result.overlapHeadroomMb === "number"
        ? ` (${result.reserveHeadroomMb} MB reserve + ` +
          `${result.incomingEstimateMb} MB incoming estimate + ` +
          `${result.overlapHeadroomMb} MB overlap)`
        : "";
    const message = result.denialReason === "active_heavyweight"
      ? "Another heavyweight operation is already active; heavyweight work is exclusive until it releases its lease."
      : result.denialReason === "pressure"
        ? `Memory pressure prevents new work even though Windows commit headroom is ${result.availableHeadroomMb} MB.`
        : `Breadboard needs ${result.requiredHeadroomMb} MB of free Windows commit ` +
          `for this operation${breakdown}; ${result.availableHeadroomMb} MB is available.`;
    super(message);
    this.name = "SupervisorResourceExhaustedError";
    this.result = result;
  }
}

export type RuntimeJobState =
  | "queued"
  | "admitted"
  | "starting"
  | "running"
  | "checkpointing"
  | "cancelling"
  | "cancelled"
  | "succeeded"
  | "failed"
  | "resource_exhausted"
  | "interrupted"
  | "uncertain";

export type RuntimeJobResourceClass =
  | "core"
  | "large-generation"
  | "document-processing"
  | "document-model"
  | "media-processing"
  | "browser-automation"
  | "local-model"
  | "docker-stack";

export type RuntimePublicStage =
  | "preparing"
  | "working"
  | "generating"
  | "waiting-external"
  | "processing"
  | "persisting"
  | "finalizing"
  | "cancelling";

const RUNTIME_PUBLIC_STAGES = new Set<RuntimePublicStage>([
  "preparing",
  "working",
  "generating",
  "waiting-external",
  "processing",
  "persisting",
  "finalizing",
  "cancelling",
]);

export type RuntimePublicArtifactKind =
  | "checkpoint"
  | "artifact"
  | "document"
  | "image"
  | "audio"
  | "video"
  | "model"
  | "report"
  | "archive"
  | "page";

const RUNTIME_PUBLIC_ARTIFACT_KINDS = new Set<RuntimePublicArtifactKind>([
  "checkpoint",
  "artifact",
  "document",
  "image",
  "audio",
  "video",
  "model",
  "report",
  "archive",
  "page",
]);

export type RuntimePublicFailureCode =
  | "RUNTIME_JOB_FAILED"
  | "WORKER_FAILED"
  | "BREADBOARD_RESOURCE_EXHAUSTED"
  | "JOB_INTERRUPTED"
  | "JOB_UNCERTAIN";

const RUNTIME_PUBLIC_FAILURE_CODES = new Set<RuntimePublicFailureCode>([
  "RUNTIME_JOB_FAILED",
  "WORKER_FAILED",
  "BREADBOARD_RESOURCE_EXHAUSTED",
  "JOB_INTERRUPTED",
  "JOB_UNCERTAIN",
]);

const SANITIZED_RUNTIME_FAILURE_MESSAGE = "Runtime job execution failed.";

const RUNTIME_JOB_STATES = new Set<RuntimeJobState>([
  "queued",
  "admitted",
  "starting",
  "running",
  "checkpointing",
  "cancelling",
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

const RUNTIME_JOB_RESOURCE_CLASSES = new Set<RuntimeJobResourceClass>([
  "core",
  "large-generation",
  "document-processing",
  "document-model",
  "media-processing",
  "browser-automation",
  "local-model",
  "docker-stack",
]);

export interface RuntimeJobAuthority {
  readonly userId: number;
  readonly gardenId: string | null;
  readonly conversationId: string | null;
}

export interface RuntimeJobSubmission {
  readonly jobType: string;
  readonly idempotencyKey: string;
  readonly requestPayload: unknown;
}

export interface RuntimeJobSnapshot {
  readonly jobId: string;
  readonly jobType: string;
  readonly workerKind: string;
  readonly resourceClass: RuntimeJobResourceClass;
  readonly state: RuntimeJobState;
  readonly stage: RuntimePublicStage | null;
  readonly attempt: number;
  readonly workerInstanceId: string | null;
  readonly gardenId: string | null;
  readonly conversationId: string | null;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly updatedAt: number;
  readonly finishedAt: number | null;
  readonly lastHeartbeatAt: number | null;
  readonly lastWorkerSequence: number;
  readonly progressCurrent: number;
  readonly progressTotal: number;
  readonly failureCode: RuntimePublicFailureCode | null;
  readonly failureMessage: string | null;
  readonly cancellationRequested: boolean;
}

export type RuntimeJobEventType =
  | "queued"
  | "admitted"
  | "worker-assigned"
  | "reservation-settled"
  | "reservation-released"
  | "cancellation-requested"
  | "completion-confirmed"
  | "worker-ready"
  | "worker-heartbeat"
  | "worker-progress"
  | "worker-checkpoint"
  | "worker-artifact"
  | "worker-complete"
  | "worker-failed"
  | "worker-cancellation-acknowledged"
  | "job-starting"
  | "job-running"
  | "job-checkpointing"
  | "job-cancelling"
  | "job-cancelled"
  | "job-succeeded"
  | "job-failed"
  | "job-resource-exhausted"
  | "job-interrupted"
  | "job-uncertain";

type RuntimeEmptyJobEventPayload = Readonly<Record<string, never>>;

interface RuntimeJobEventPayloadMap {
  readonly queued: { readonly state: "queued" };
  readonly admitted: { readonly state: "admitted" };
  readonly "worker-assigned": { readonly state: "starting" };
  readonly "reservation-settled": RuntimeEmptyJobEventPayload;
  readonly "reservation-released": RuntimeEmptyJobEventPayload;
  readonly "cancellation-requested": { readonly state: "cancelling" };
  readonly "completion-confirmed": { readonly state: "succeeded" };
  readonly "worker-ready": { readonly state: "running" };
  readonly "worker-heartbeat": { readonly stage: RuntimePublicStage };
  readonly "worker-progress": {
    readonly stage: RuntimePublicStage;
    readonly progressCurrent: number;
    readonly progressTotal: number;
  };
  readonly "worker-checkpoint": { readonly artifactKind: RuntimePublicArtifactKind };
  readonly "worker-artifact": { readonly artifactKind: RuntimePublicArtifactKind };
  readonly "worker-complete": RuntimeEmptyJobEventPayload;
  readonly "worker-failed": {
    readonly state: "failed";
    readonly failureCode: "WORKER_FAILED";
    readonly failureMessage: typeof SANITIZED_RUNTIME_FAILURE_MESSAGE;
  };
  readonly "worker-cancellation-acknowledged": { readonly state: "cancelling" };
  readonly "job-starting": { readonly state: "starting" };
  readonly "job-running": { readonly state: "running" };
  readonly "job-checkpointing": { readonly state: "checkpointing" };
  readonly "job-cancelling": { readonly state: "cancelling" };
  readonly "job-cancelled": { readonly state: "cancelled" };
  readonly "job-succeeded": { readonly state: "succeeded" };
  readonly "job-failed": { readonly state: "failed" };
  readonly "job-resource-exhausted": { readonly state: "resource_exhausted" };
  readonly "job-interrupted": { readonly state: "interrupted" };
  readonly "job-uncertain": { readonly state: "uncertain" };
}

type RuntimeWorkerJobEventType =
  | "worker-ready"
  | "worker-heartbeat"
  | "worker-progress"
  | "worker-checkpoint"
  | "worker-artifact"
  | "worker-complete"
  | "worker-failed"
  | "worker-cancellation-acknowledged";

type RuntimeZeroFenceJobEventType = "queued" | "admitted";

type RuntimeAttemptFenceJobEventType =
  | "worker-assigned"
  | "reservation-settled"
  | "completion-confirmed"
  | "job-starting"
  | "job-running"
  | "job-checkpointing"
  | "job-succeeded"
  | "job-failed"
  | "job-uncertain";

type RuntimeCurrentFenceJobEventType =
  | "reservation-released"
  | "cancellation-requested"
  | "job-cancelling"
  | "job-cancelled"
  | "job-resource-exhausted"
  | "job-interrupted";

type RuntimeZeroFence = {
  readonly attempt: 0;
  readonly workerInstanceId: null;
  readonly workerSequence: null;
};

type RuntimeAttemptFence = {
  readonly attempt: number;
  readonly workerInstanceId: string;
  readonly workerSequence: null;
};

type RuntimeWorkerFence = {
  readonly attempt: number;
  readonly workerInstanceId: string;
  readonly workerSequence: number;
};

type RuntimeJobEventFence<T extends RuntimeJobEventType> =
  T extends RuntimeWorkerJobEventType
    ? RuntimeWorkerFence
    : T extends RuntimeZeroFenceJobEventType
      ? RuntimeZeroFence
      : T extends RuntimeAttemptFenceJobEventType
        ? RuntimeAttemptFence
        : T extends RuntimeCurrentFenceJobEventType
          ? RuntimeZeroFence | RuntimeAttemptFence
          : never;

type RuntimeJobEventRecordFor<T extends RuntimeJobEventType> = {
  readonly sequence: number;
  readonly jobId: string;
  readonly eventType: T;
  readonly payload: RuntimeJobEventPayloadMap[T];
  readonly createdAt: number;
} & RuntimeJobEventFence<T>;

export type RuntimeJobEventRecord = {
  readonly [T in RuntimeJobEventType]: RuntimeJobEventRecordFor<T>;
}[RuntimeJobEventType];

export type RuntimeJobEventPayload = RuntimeJobEventPayloadMap[RuntimeJobEventType];

export interface RuntimeJobEventReplay {
  readonly jobId: string;
  readonly after: number;
  readonly nextAfter: number;
  readonly terminal: boolean;
  readonly hasMore: boolean;
  readonly events: readonly RuntimeJobEventRecord[];
}

export type RuntimeJobControlErrorCode =
  | "INVALID_JOB_REQUEST"
  | "JOB_SCOPE_FORBIDDEN"
  | "JOB_NOT_FOUND"
  | "JOB_CONFLICT"
  | "BREADBOARD_RESOURCE_EXHAUSTED"
  | "RUNTIME_UNAVAILABLE"
  | "RUNTIME_INTERNAL_ERROR";

export class RuntimeJobControlError extends Error {
  readonly code: RuntimeJobControlErrorCode;
  readonly status: number;
  readonly retryable: false;
  readonly resource: "windows_commit" | null;
  readonly requiredHeadroomMb: number | null;
  readonly availableHeadroomMb: number | null;

  constructor(input: {
    code: RuntimeJobControlErrorCode;
    message: string;
    status: number;
    resource: "windows_commit" | null;
    requiredHeadroomMb: number | null;
    availableHeadroomMb: number | null;
  }) {
    super(input.message);
    this.name = "RuntimeJobControlError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = false;
    this.resource = input.resource;
    this.requiredHeadroomMb = input.requiredHeadroomMb;
    this.availableHeadroomMb = input.availableHeadroomMb;
  }
}

interface Endpoint {
  origin: string;
  token: string;
}

function endpoint(env: NodeJS.ProcessEnv = process.env): Endpoint | null {
  const raw = env.BREADBOARD_SUPERVISOR_CONTROL_URL?.trim();
  const token = env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN?.trim();
  if (!raw && !token) return null;
  if (!raw || !token) {
    throw new Error("Breadboard supervisor control configuration is incomplete.");
  }
  const tokenBytes = new TextEncoder().encode(token).byteLength;
  if (
    tokenBytes < MIN_CONTROL_TOKEN_BYTES ||
    tokenBytes > MAX_CONTROL_TOKEN_BYTES ||
    !/^[\x21-\x7e]+$/.test(token)
  ) {
    throw new Error("Breadboard supervisor control token is invalid.");
  }
  const url = new URL(raw);
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) {
    throw new Error("Breadboard supervisor control URL must use HTTP on loopback.");
  }
  return { origin: url.origin, token };
}

function isResourceResult(value: unknown): value is ResourceExhaustionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ResourceExhaustionResult>;
  return (
    record.code === "BREADBOARD_RESOURCE_EXHAUSTED" &&
    record.resource === "windows_commit" &&
    typeof record.requiredHeadroomMb === "number" &&
    typeof record.availableHeadroomMb === "number" &&
    (record.reserveHeadroomMb === undefined ||
      typeof record.reserveHeadroomMb === "number") &&
    (record.incomingEstimateMb === undefined ||
      typeof record.incomingEstimateMb === "number") &&
    (record.overlapHeadroomMb === undefined ||
      typeof record.overlapHeadroomMb === "number") &&
    (record.denialReason === undefined ||
      record.denialReason === "active_heavyweight" ||
      record.denialReason === "headroom" ||
      record.denialReason === "pressure") &&
    record.retryable === false
  );
}

async function readBoundedControlJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new Error("Supervisor returned an invalid Content-Length header.");
    }
    const declaredBytes = Number(declaredLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      throw new Error("Supervisor returned an invalid Content-Length header.");
    }
    if (declaredBytes > MAX_CONTROL_RESPONSE_BYTES) {
      throw new Error(
        `Supervisor response exceeds the ${MAX_CONTROL_RESPONSE_BYTES}-byte limit.`,
      );
    }
  }

  if (!response.body) {
    throw new Error("Supervisor returned an empty response body.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let reachedEnd = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        reachedEnd = true;
        break;
      }
      if (!value || value.byteLength === 0) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_CONTROL_RESPONSE_BYTES) {
        throw new Error(
          `Supervisor response exceeds the ${MAX_CONTROL_RESPONSE_BYTES}-byte limit.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    if (!reachedEnd) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new Error("Supervisor returned an empty response body.");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Supervisor returned invalid UTF-8.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Supervisor returned invalid JSON.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isBoundedRuntimeText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maximumBytes
  );
}

function isRuntimeIdentifier(value: unknown): value is string {
  return (
    isBoundedRuntimeText(value, MAX_RUNTIME_IDENTIFIER_BYTES) &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isRuntimeScope(value: unknown): value is string {
  return (
    isBoundedRuntimeText(value, MAX_RUNTIME_SCOPE_BYTES) &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validateRuntimeJobAuthority(authority: RuntimeJobAuthority): void {
  if (!isSafePositiveInteger(authority.userId)) {
    throw new TypeError("Runtime job user ID must be a positive safe integer.");
  }
  for (const [label, value] of [
    ["garden", authority.gardenId],
    ["conversation", authority.conversationId],
  ] as const) {
    if (value !== null && !isRuntimeScope(value)) {
      throw new TypeError(`Runtime job ${label} scope is invalid.`);
    }
  }
}

function assertRuntimeJsonValue(value: unknown): void {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (pending.length > 0) {
    const candidate = pending.pop();
    nodes += 1;
    if (nodes > MAX_RUNTIME_JSON_NODES) {
      throw new TypeError("Runtime job request payload is too complex.");
    }
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      continue;
    }
    if (typeof candidate === "number") {
      if (Number.isFinite(candidate)) continue;
      throw new TypeError("Runtime job request payload contains a non-finite number.");
    }
    if (typeof candidate !== "object") {
      throw new TypeError("Runtime job request payload contains a non-JSON value.");
    }
    if (seen.has(candidate)) {
      throw new TypeError("Runtime job request payload contains a cycle or shared object.");
    }
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const item of candidate) pending.push(item);
      continue;
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(candidate).length !== 0
    ) {
      throw new TypeError("Runtime job request payload must contain only plain JSON objects.");
    }
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(candidate))) {
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) {
        throw new TypeError("Runtime job request payload cannot contain accessors.");
      }
      pending.push(descriptor.value);
    }
  }
}

function runtimeJobAuthorityHeaders(authority: RuntimeJobAuthority): Record<string, string> {
  validateRuntimeJobAuthority(authority);
  return {
    "x-breadboard-user-id": String(authority.userId),
    ...(authority.gardenId === null
      ? {}
      : { "x-breadboard-garden-id": authority.gardenId }),
    ...(authority.conversationId === null
      ? {}
      : { "x-breadboard-conversation-id": authority.conversationId }),
  };
}

const RUNTIME_JOB_FIELDS = [
  "jobId",
  "jobType",
  "workerKind",
  "resourceClass",
  "state",
  "stage",
  "attempt",
  "workerInstanceId",
  "gardenId",
  "conversationId",
  "createdAt",
  "startedAt",
  "updatedAt",
  "finishedAt",
  "lastHeartbeatAt",
  "lastWorkerSequence",
  "progressCurrent",
  "progressTotal",
  "failureCode",
  "failureMessage",
  "cancellationRequested",
] as const;

function hasValidRuntimeJobFailure(value: Record<string, unknown>): boolean {
  if (value.failureCode === null && value.failureMessage === null) {
    return true;
  }
  if (
    !RUNTIME_PUBLIC_FAILURE_CODES.has(value.failureCode as RuntimePublicFailureCode) ||
    value.failureMessage !== SANITIZED_RUNTIME_FAILURE_MESSAGE
  ) {
    return false;
  }
  switch (value.failureCode) {
    case "RUNTIME_JOB_FAILED":
    case "WORKER_FAILED":
      return value.state === "failed";
    case "BREADBOARD_RESOURCE_EXHAUSTED":
      return value.state === "resource_exhausted";
    case "JOB_INTERRUPTED":
      return value.state === "interrupted";
    case "JOB_UNCERTAIN":
      return value.state === "uncertain";
    default:
      return false;
  }
}

function parseRuntimeJobSnapshot(
  value: unknown,
  authority: RuntimeJobAuthority,
): RuntimeJobSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, RUNTIME_JOB_FIELDS)) {
    throw new Error("Runtime returned an invalid job snapshot.");
  }
  if (
    !isRuntimeIdentifier(value.jobId) ||
    !isRuntimeIdentifier(value.jobType) ||
    !isRuntimeIdentifier(value.workerKind) ||
    !RUNTIME_JOB_RESOURCE_CLASSES.has(value.resourceClass as RuntimeJobResourceClass) ||
    !RUNTIME_JOB_STATES.has(value.state as RuntimeJobState) ||
    (value.stage !== null &&
      !RUNTIME_PUBLIC_STAGES.has(value.stage as RuntimePublicStage)) ||
    !isSafeNonnegativeInteger(value.attempt) ||
    (value.workerInstanceId !== null && !isRuntimeIdentifier(value.workerInstanceId)) ||
    (value.workerInstanceId !== null && value.attempt === 0) ||
    (value.gardenId !== null && !isRuntimeScope(value.gardenId)) ||
    (value.conversationId !== null && !isRuntimeScope(value.conversationId)) ||
    value.gardenId !== authority.gardenId ||
    value.conversationId !== authority.conversationId ||
    !isSafePositiveInteger(value.createdAt) ||
    (value.startedAt !== null && !isSafePositiveInteger(value.startedAt)) ||
    !isSafePositiveInteger(value.updatedAt) ||
    value.updatedAt < value.createdAt ||
    (value.startedAt !== null && value.startedAt > value.updatedAt) ||
    (value.finishedAt !== null && !isSafePositiveInteger(value.finishedAt)) ||
    (value.finishedAt !== null && value.finishedAt > value.updatedAt) ||
    (value.lastHeartbeatAt !== null && !isSafePositiveInteger(value.lastHeartbeatAt)) ||
    (value.lastHeartbeatAt !== null && value.lastHeartbeatAt > value.updatedAt) ||
    !isSafeNonnegativeInteger(value.lastWorkerSequence) ||
    !isSafeNonnegativeInteger(value.progressCurrent) ||
    !isSafeNonnegativeInteger(value.progressTotal) ||
    (value.progressTotal === 0 && value.progressCurrent !== 0) ||
    (value.progressTotal > 0 && value.progressCurrent > value.progressTotal) ||
    !hasValidRuntimeJobFailure(value) ||
    typeof value.cancellationRequested !== "boolean"
  ) {
    throw new Error("Runtime returned an invalid job snapshot.");
  }
  return value as unknown as RuntimeJobSnapshot;
}

function parseRuntimeJobResponse(
  value: unknown,
  authority: RuntimeJobAuthority,
  expected: { jobId?: string; jobType?: string },
): RuntimeJobSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["type", "protocolVersion", "job"]) ||
    value.type !== "runtime-job" ||
    value.protocolVersion !== 1
  ) {
    throw new Error("Runtime returned an invalid job response.");
  }
  const job = parseRuntimeJobSnapshot(value.job, authority);
  if (
    (expected.jobId !== undefined && job.jobId !== expected.jobId) ||
    (expected.jobType !== undefined && job.jobType !== expected.jobType)
  ) {
    throw new Error("Runtime returned a job outside the requested binding.");
  }
  return job;
}

const RUNTIME_JOB_EVENT_FIELDS = [
  "sequence",
  "jobId",
  "attempt",
  "workerInstanceId",
  "workerSequence",
  "eventType",
  "payload",
  "createdAt",
] as const;

type RuntimeJobEventFenceKind =
  | "runtime-zero"
  | "runtime-attempt"
  | "runtime-current"
  | "worker";

type RuntimeJobEventRule =
  | {
      readonly fence: RuntimeJobEventFenceKind;
      readonly payload: "empty";
    }
  | {
      readonly fence: RuntimeJobEventFenceKind;
      readonly payload: "state";
      readonly state: RuntimeJobState;
    }
  | {
      readonly fence: RuntimeJobEventFenceKind;
      readonly payload: "stage" | "progress" | "artifact" | "failure";
    };

const RUNTIME_JOB_EVENT_RULES = {
  queued: { fence: "runtime-zero", payload: "state", state: "queued" },
  admitted: { fence: "runtime-zero", payload: "state", state: "admitted" },
  "worker-assigned": {
    fence: "runtime-attempt",
    payload: "state",
    state: "starting",
  },
  "reservation-settled": { fence: "runtime-attempt", payload: "empty" },
  "reservation-released": { fence: "runtime-current", payload: "empty" },
  "cancellation-requested": {
    fence: "runtime-current",
    payload: "state",
    state: "cancelling",
  },
  "completion-confirmed": {
    fence: "runtime-attempt",
    payload: "state",
    state: "succeeded",
  },
  "worker-ready": { fence: "worker", payload: "state", state: "running" },
  "worker-heartbeat": { fence: "worker", payload: "stage" },
  "worker-progress": { fence: "worker", payload: "progress" },
  "worker-checkpoint": { fence: "worker", payload: "artifact" },
  "worker-artifact": { fence: "worker", payload: "artifact" },
  "worker-complete": { fence: "worker", payload: "empty" },
  "worker-failed": { fence: "worker", payload: "failure" },
  "worker-cancellation-acknowledged": {
    fence: "worker",
    payload: "state",
    state: "cancelling",
  },
  "job-starting": {
    fence: "runtime-attempt",
    payload: "state",
    state: "starting",
  },
  "job-running": {
    fence: "runtime-attempt",
    payload: "state",
    state: "running",
  },
  "job-checkpointing": {
    fence: "runtime-attempt",
    payload: "state",
    state: "checkpointing",
  },
  "job-cancelling": {
    fence: "runtime-current",
    payload: "state",
    state: "cancelling",
  },
  "job-cancelled": {
    fence: "runtime-current",
    payload: "state",
    state: "cancelled",
  },
  "job-succeeded": {
    fence: "runtime-attempt",
    payload: "state",
    state: "succeeded",
  },
  "job-failed": {
    fence: "runtime-attempt",
    payload: "state",
    state: "failed",
  },
  "job-resource-exhausted": {
    fence: "runtime-current",
    payload: "state",
    state: "resource_exhausted",
  },
  "job-interrupted": {
    fence: "runtime-current",
    payload: "state",
    state: "interrupted",
  },
  "job-uncertain": {
    fence: "runtime-attempt",
    payload: "state",
    state: "uncertain",
  },
} as const satisfies Record<RuntimeJobEventType, RuntimeJobEventRule>;

function isRuntimeJobEventType(value: unknown): value is RuntimeJobEventType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(RUNTIME_JOB_EVENT_RULES, value)
  );
}

function parseRuntimeJobEventPayload<T extends RuntimeJobEventType>(
  eventType: T,
  value: unknown,
): RuntimeJobEventPayloadMap[T] {
  if (!isRecord(value)) {
    throw new Error("Runtime returned an invalid job event payload.");
  }
  const rule: RuntimeJobEventRule = RUNTIME_JOB_EVENT_RULES[eventType];
  let valid = false;
  switch (rule.payload) {
    case "empty":
      valid = hasExactKeys(value, []);
      break;
    case "state":
      valid = hasExactKeys(value, ["state"]) && value.state === rule.state;
      break;
    case "stage":
      valid =
        hasExactKeys(value, ["stage"]) &&
        RUNTIME_PUBLIC_STAGES.has(value.stage as RuntimePublicStage);
      break;
    case "progress":
      valid =
        hasExactKeys(value, ["stage", "progressCurrent", "progressTotal"]) &&
        RUNTIME_PUBLIC_STAGES.has(value.stage as RuntimePublicStage) &&
        isSafeNonnegativeInteger(value.progressCurrent) &&
        isSafePositiveInteger(value.progressTotal) &&
        value.progressCurrent <= value.progressTotal;
      break;
    case "artifact":
      valid =
        hasExactKeys(value, ["artifactKind"]) &&
        RUNTIME_PUBLIC_ARTIFACT_KINDS.has(
          value.artifactKind as RuntimePublicArtifactKind,
        );
      break;
    case "failure":
      valid =
        hasExactKeys(value, ["state", "failureCode", "failureMessage"]) &&
        value.state === "failed" &&
        value.failureCode === "WORKER_FAILED" &&
        value.failureMessage === SANITIZED_RUNTIME_FAILURE_MESSAGE;
      break;
  }
  if (!valid) {
    throw new Error("Runtime returned an invalid job event payload.");
  }
  return value as unknown as RuntimeJobEventPayloadMap[T];
}

function hasValidRuntimeJobEventFence(
  value: Record<string, unknown>,
  fence: RuntimeJobEventFenceKind,
): boolean {
  switch (fence) {
    case "runtime-zero":
      return (
        value.attempt === 0 &&
        value.workerInstanceId === null &&
        value.workerSequence === null
      );
    case "runtime-attempt":
      return (
        isSafePositiveInteger(value.attempt) &&
        isRuntimeIdentifier(value.workerInstanceId) &&
        value.workerSequence === null
      );
    case "runtime-current":
      return (
        value.workerSequence === null &&
        ((value.attempt === 0 && value.workerInstanceId === null) ||
          (isSafePositiveInteger(value.attempt) &&
            isRuntimeIdentifier(value.workerInstanceId)))
      );
    case "worker":
      return (
        isSafePositiveInteger(value.attempt) &&
        isRuntimeIdentifier(value.workerInstanceId) &&
        isSafePositiveInteger(value.workerSequence)
      );
  }
}

function parseRuntimeJobEvent(value: unknown): RuntimeJobEventRecord {
  if (!isRecord(value) || !hasExactKeys(value, RUNTIME_JOB_EVENT_FIELDS)) {
    throw new Error("Runtime returned an invalid job event.");
  }
  if (
    !isSafePositiveInteger(value.sequence) ||
    !isRuntimeIdentifier(value.jobId) ||
    !isRuntimeJobEventType(value.eventType) ||
    !isSafePositiveInteger(value.createdAt)
  ) {
    throw new Error("Runtime returned an invalid job event.");
  }
  const rule = RUNTIME_JOB_EVENT_RULES[value.eventType];
  if (!hasValidRuntimeJobEventFence(value, rule.fence)) {
    throw new Error("Runtime returned an invalid job event fence.");
  }
  parseRuntimeJobEventPayload(value.eventType, value.payload);
  return value as unknown as RuntimeJobEventRecord;
}

function parseRuntimeJobEventsResponse(
  value: unknown,
  authority: RuntimeJobAuthority,
  expectedJobId: string,
  expectedAfter: number,
  requestedLimit: number,
): RuntimeJobEventReplay {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "type",
      "protocolVersion",
      "jobId",
      "after",
      "nextAfter",
      "terminal",
      "hasMore",
      "events",
    ]) ||
    value.type !== "runtime-job-events" ||
    value.protocolVersion !== 1 ||
    value.jobId !== expectedJobId ||
    value.after !== expectedAfter ||
    !isSafeNonnegativeInteger(value.nextAfter) ||
    value.nextAfter < expectedAfter ||
    typeof value.terminal !== "boolean" ||
    typeof value.hasMore !== "boolean" ||
    !Array.isArray(value.events) ||
    value.events.length > requestedLimit ||
    (value.hasMore && value.events.length === 0)
  ) {
    throw new Error("Runtime returned an invalid event replay.");
  }
  validateRuntimeJobAuthority(authority);
  let previous = expectedAfter;
  const events = value.events.map((event) => {
    const parsed = parseRuntimeJobEvent(event);
    if (parsed.jobId !== expectedJobId || parsed.sequence <= previous) {
      throw new Error("Runtime returned an invalid event replay.");
    }
    previous = parsed.sequence;
    return parsed;
  });
  if (previous !== value.nextAfter) {
    throw new Error("Runtime returned an invalid event replay cursor.");
  }
  return {
    jobId: expectedJobId,
    after: expectedAfter,
    nextAfter: value.nextAfter,
    terminal: value.terminal,
    hasMore: value.hasMore,
    events,
  };
}

const RUNTIME_JOB_ERROR_CODES = new Set<RuntimeJobControlErrorCode>([
  "INVALID_JOB_REQUEST",
  "JOB_SCOPE_FORBIDDEN",
  "JOB_NOT_FOUND",
  "JOB_CONFLICT",
  "BREADBOARD_RESOURCE_EXHAUSTED",
  "RUNTIME_UNAVAILABLE",
  "RUNTIME_INTERNAL_ERROR",
]);

function parseRuntimeJobError(value: unknown, status: number): RuntimeJobControlError | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "type",
      "protocolVersion",
      "code",
      "message",
      "retryable",
      "resource",
      "requiredHeadroomMb",
      "availableHeadroomMb",
    ]) ||
    value.type !== "runtime-error" ||
    value.protocolVersion !== 1 ||
    !RUNTIME_JOB_ERROR_CODES.has(value.code as RuntimeJobControlErrorCode) ||
    !isBoundedRuntimeText(value.message, MAX_RUNTIME_ERROR_BYTES) ||
    value.retryable !== false
  ) {
    return null;
  }
  const resource = value.resource;
  const required = value.requiredHeadroomMb;
  const available = value.availableHeadroomMb;
  const hasHeadroom = required !== null || available !== null;
  const isResourceExhaustion = value.code === "BREADBOARD_RESOURCE_EXHAUSTED";
  if (
    (resource !== null && resource !== "windows_commit") ||
    (hasHeadroom &&
      (!isSafePositiveInteger(required) || !isSafeNonnegativeInteger(available))) ||
    (!hasHeadroom && (resource !== null || required !== null || available !== null)) ||
    (isResourceExhaustion && (resource !== "windows_commit" || !hasHeadroom)) ||
    (!isResourceExhaustion &&
      (resource !== null || required !== null || available !== null))
  ) {
    return null;
  }
  return new RuntimeJobControlError({
    code: value.code as RuntimeJobControlErrorCode,
    message: value.message,
    status,
    resource: resource as "windows_commit" | null,
    requiredHeadroomMb: required as number | null,
    availableHeadroomMb: available as number | null,
  });
}

async function runtimeJobRequest(
  path: string,
  method: "GET" | "POST",
  authority: RuntimeJobAuthority,
  body: string | null,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  const target = endpoint(env);
  if (!target) {
    throw new RuntimeJobControlError({
      code: "RUNTIME_UNAVAILABLE",
      message: "Runtime job control is unavailable.",
      status: 503,
      resource: null,
      requiredHeadroomMb: null,
      availableHeadroomMb: null,
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTROL_TIMEOUT_MS);
  try {
    const response = await fetch(`${target.origin}${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${target.token}`,
        ...runtimeJobAuthorityHeaders(authority),
        ...(body === null ? {} : { "content-type": "application/json" }),
      },
      ...(body === null ? {} : { body }),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    let value: unknown;
    try {
      value = await readBoundedControlJson(response);
    } catch {
      throw new RuntimeJobControlError({
        code: "RUNTIME_INTERNAL_ERROR",
        message: response.ok
          ? "Runtime returned an invalid control response."
          : `Runtime job control failed (${response.status}).`,
        status: response.ok ? 502 : response.status,
        resource: null,
        requiredHeadroomMb: null,
        availableHeadroomMb: null,
      });
    }
    if (!response.ok) {
      const runtimeError = parseRuntimeJobError(value, response.status);
      if (runtimeError) throw runtimeError;
      throw new RuntimeJobControlError({
        code: "RUNTIME_INTERNAL_ERROR",
        message: `Runtime job control failed (${response.status}).`,
        status: response.status,
        resource: null,
        requiredHeadroomMb: null,
        availableHeadroomMb: null,
      });
    }
    return value;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function submitRuntimeJob(
  authority: RuntimeJobAuthority,
  submission: RuntimeJobSubmission,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeJobSnapshot> {
  validateRuntimeJobAuthority(authority);
  if (!isRuntimeIdentifier(submission.jobType)) {
    throw new TypeError("Runtime job type is invalid.");
  }
  if (
    !isBoundedRuntimeText(
      submission.idempotencyKey,
      MAX_RUNTIME_IDEMPOTENCY_KEY_BYTES,
    ) ||
    /\p{Cc}/u.test(submission.idempotencyKey)
  ) {
    throw new TypeError("Runtime job idempotency key is invalid.");
  }
  assertRuntimeJsonValue(submission.requestPayload);
  let body: string | undefined;
  try {
    body = JSON.stringify({
      jobType: submission.jobType,
      gardenId: authority.gardenId,
      conversationId: authority.conversationId,
      idempotencyKey: submission.idempotencyKey,
      requestPayload: submission.requestPayload,
    });
  } catch {
    throw new TypeError("Runtime job request payload is not valid JSON.");
  }
  if (
    typeof body !== "string" ||
    new TextEncoder().encode(body).byteLength > MAX_JOB_REQUEST_BYTES
  ) {
    throw new TypeError(
      `Runtime job request exceeds the ${MAX_JOB_REQUEST_BYTES}-byte limit.`,
    );
  }
  const value = await runtimeJobRequest("/v1/jobs", "POST", authority, body, env);
  return parseRuntimeJobResponse(value, authority, { jobType: submission.jobType });
}

export async function inspectRuntimeJob(
  authority: RuntimeJobAuthority,
  jobId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeJobSnapshot> {
  validateRuntimeJobAuthority(authority);
  if (!isRuntimeIdentifier(jobId)) throw new TypeError("Runtime job ID is invalid.");
  const value = await runtimeJobRequest(`/v1/jobs/${jobId}`, "GET", authority, null, env);
  return parseRuntimeJobResponse(value, authority, { jobId });
}

export async function replayRuntimeJobEvents(
  authority: RuntimeJobAuthority,
  jobId: string,
  after: number,
  limit = 100,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeJobEventReplay> {
  validateRuntimeJobAuthority(authority);
  if (!isRuntimeIdentifier(jobId)) throw new TypeError("Runtime job ID is invalid.");
  if (!isSafeNonnegativeInteger(after)) {
    throw new TypeError("Runtime event cursor must be a nonnegative safe integer.");
  }
  if (!isSafePositiveInteger(limit) || limit > MAX_JOB_EVENT_REPLAY_RECORDS) {
    throw new TypeError(
      `Runtime event replay limit must be between 1 and ${MAX_JOB_EVENT_REPLAY_RECORDS}.`,
    );
  }
  const value = await runtimeJobRequest(
    `/v1/jobs/${jobId}/events?after=${after}&limit=${limit}`,
    "GET",
    authority,
    null,
    env,
  );
  return parseRuntimeJobEventsResponse(value, authority, jobId, after, limit);
}

export async function cancelRuntimeJob(
  authority: RuntimeJobAuthority,
  jobId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeJobSnapshot> {
  validateRuntimeJobAuthority(authority);
  if (!isRuntimeIdentifier(jobId)) throw new TypeError("Runtime job ID is invalid.");
  const value = await runtimeJobRequest(
    `/v1/jobs/${jobId}/cancel`,
    "POST",
    authority,
    null,
    env,
  );
  return parseRuntimeJobResponse(value, authority, { jobId });
}

async function control<T>(
  path: string,
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<T | null> {
  const target = endpoint(env);
  // Bare dashboard development has no Electron lifecycle owner. Preserve that
  // supported workflow; services launched by `npm run dev` remain external.
  if (!target) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTROL_TIMEOUT_MS);
  try {
    const response = await fetch(`${target.origin}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    let result: unknown;
    try {
      result = await readBoundedControlJson(response);
    } catch (error) {
      if (!response.ok) {
        throw new Error(`Supervisor control request failed (${response.status}).`);
      }
      throw error;
    }
    if (isResourceResult(result)) throw new SupervisorResourceExhaustedError(result);
    if (!response.ok) throw new Error(`Supervisor control request failed (${response.status}).`);
    return result as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads lifecycle state without acquiring a lease or starting a process.
 *
 * The legacy Electron control plane and Runtime V2 intentionally share this
 * small server-only contract during cutover. Returning `null` means the
 * supported bare-dashboard development mode has no lifecycle owner; it never
 * means that a configured desktop service is healthy.
 */
export async function readSupervisedServiceSnapshot(
  serviceId: SupervisedServiceId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SupervisedServiceSnapshot | null> {
  const target = endpoint(env);
  if (!target) return null;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(CONTROL_TIMEOUT_MS, 5_000),
  );
  try {
    const response = await fetch(`${target.origin}/v1/status`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${target.token}`,
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Supervisor status request failed (${response.status}).`);
    }
    const value = await readBoundedControlJson(response);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Supervisor returned an invalid status response.");
    }
    const services = (value as { services?: unknown }).services;
    if (!Array.isArray(services) || services.length > 256) {
      throw new Error("Supervisor returned an invalid service list.");
    }
    const matches = services.filter(
      (candidate): candidate is { id: string; state: string } =>
        Boolean(candidate) &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        (candidate as { id?: unknown }).id === serviceId &&
        typeof (candidate as { state?: unknown }).state === "string",
    );
    if (
      matches.length !== 1 ||
      !SUPERVISED_SERVICE_STATES.has(
        matches[0]!.state as SupervisedServiceLifecycleState,
      )
    ) {
      throw new Error("Supervisor omitted or duplicated the requested service state.");
    }
    return {
      id: serviceId,
      state: matches[0]!.state as SupervisedServiceLifecycleState,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function acquireServiceLease(
  serviceId: SupervisedServiceId,
  reason: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SupervisorLease | null> {
  const result = await control<{ leaseId?: unknown; serviceId?: unknown }>(
    `/v1/services/${serviceId}/lease`,
    { reason },
    env,
  );
  if (!result) return null;
  if (typeof result.leaseId !== "string" || result.serviceId !== serviceId) {
    throw new Error("Supervisor returned an invalid service lease.");
  }
  return { id: result.leaseId, targetId: serviceId };
}

export async function acquireCapabilityLease(
  capabilityId: SupervisedCapabilityId,
  reason: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SupervisorLease | null> {
  const result = await control<{ leaseId?: unknown; capabilityId?: unknown }>(
    `/v1/capabilities/${capabilityId}/lease`,
    { reason },
    env,
  );
  if (!result) return null;
  if (typeof result.leaseId !== "string" || result.capabilityId !== capabilityId) {
    throw new Error("Supervisor returned an invalid capability lease.");
  }
  return { id: result.leaseId, targetId: capabilityId };
}

export async function releaseSupervisorLease(
  lease: SupervisorLease | string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  options: { afterOwnerPidExit?: number } = {},
): Promise<void> {
  const id = typeof lease === "string" ? lease : lease?.id;
  if (!id) return;
  const ownerPid = options.afterOwnerPidExit;
  if (
    ownerPid !== undefined &&
    (!Number.isSafeInteger(ownerPid) || ownerPid <= 0)
  ) {
    throw new TypeError("Supervisor lease owner PID must be a positive safe integer.");
  }
  await control(
    `/v1/leases/${encodeURIComponent(id)}/release`,
    ownerPid === undefined ? {} : { afterOwnerPidExit: ownerPid },
    env,
  ).catch(() => null);
}

export async function withServiceLease<T>(
  serviceId: SupervisedServiceId,
  reason: string,
  operation: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const lease = await acquireServiceLease(serviceId, reason, env);
  try {
    return await operation();
  } finally {
    await releaseSupervisorLease(lease, env);
  }
}

export async function withCapabilityLease<T>(
  capabilityId: SupervisedCapabilityId,
  reason: string,
  operation: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const lease = await acquireCapabilityLease(capabilityId, reason, env);
  try {
    return await operation();
  } finally {
    await releaseSupervisorLease(lease, env);
  }
}

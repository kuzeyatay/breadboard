import "server-only";

import { randomUUID } from "node:crypto";

import {
  cancelRuntimeJob,
  inspectRuntimeJobForStatus,
  readRuntimeJobOutput,
  RuntimeJobControlError,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";

const PROTOCOL_VERSION = 1;
const MAX_EVENTS = 3_000;
const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const WORKER_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const EVENT_TYPE = /^[a-z][a-z0-9_.-]{0,79}$/u;
const TERMINAL_JOB_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export type CinemaAgentKind = "vimax" | "vox-director";
export type CinemaRunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export interface CinemaRunEvent {
  readonly sequenceNumber: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly at: string;
}

interface CinemaAdapter {
  readonly kind: CinemaAgentKind;
  readonly jobType: string;
  readonly workerKind: string;
  readonly timeoutMs: number;
}

export const CINEMA_RUNTIME_ADAPTERS = Object.freeze({
  vimax: Object.freeze({
    kind: "vimax",
    jobType: "vimax-run",
    workerKind: "vimax-node",
    timeoutMs: 3 * 60 * 60 * 1_000,
  }),
  "vox-director": Object.freeze({
    kind: "vox-director",
    jobType: "vox-director-run",
    workerKind: "vox-director-node",
    timeoutMs: 4 * 60 * 60 * 1_000,
  }),
} satisfies Record<CinemaAgentKind, CinemaAdapter>);

export interface CinemaRuntimeControl {
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
}

const DEFAULT_CONTROL: CinemaRuntimeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJobForStatus,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

interface RuntimeIdentity {
  readonly jobId: string;
  readonly attempt: number;
  readonly workerInstanceId: string;
}

interface RuntimeProjection {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly identity: RuntimeIdentity;
  readonly scope: RuntimeJobAuthority;
  readonly agentKind: CinemaAgentKind;
  readonly status: CinemaRunStatus;
  readonly events: readonly CinemaRunEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validScopeValue(value: string | null): boolean {
  return value === null || (
    value.trim() === value &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 256 &&
    !/\p{Cc}/u.test(value)
  );
}

function runtimeAuthority(userId: number, conversationId: string | null): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1 || !validScopeValue(conversationId)) {
    throw new TypeError("Cinema Runtime authority is invalid.");
  }
  return { userId, gardenId: null, conversationId };
}

function requireAdapterJob(
  adapter: CinemaAdapter,
  authority: RuntimeJobAuthority,
  job: RuntimeJobSnapshot,
): RuntimeJobSnapshot {
  if (
    !JOB_ID.test(job.jobId) ||
    job.jobType !== adapter.jobType ||
    job.workerKind !== adapter.workerKind ||
    job.resourceClass !== "large-generation" ||
    job.gardenId !== authority.gardenId ||
    job.conversationId !== authority.conversationId
  ) {
    throw new Error("Runtime returned a cinema job outside its sealed profile scope.");
  }
  return job;
}

function parseProjection(
  value: unknown,
  expected: {
    readonly adapter: CinemaAdapter;
    readonly authority: RuntimeJobAuthority;
    readonly job: RuntimeJobSnapshot;
  },
): RuntimeProjection {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["protocolVersion", "identity", "scope", "agentKind", "status", "events"]) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.agentKind !== expected.adapter.kind ||
    !isRecord(value.identity) ||
    !exactKeys(value.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    value.identity.jobId !== expected.job.jobId ||
    !Number.isSafeInteger(value.identity.attempt) ||
    (value.identity.attempt as number) < 1 ||
    typeof value.identity.workerInstanceId !== "string" ||
    !WORKER_ID.test(value.identity.workerInstanceId) ||
    !isRecord(value.scope) ||
    !exactKeys(value.scope, ["userId", "gardenId", "conversationId"]) ||
    value.scope.userId !== expected.authority.userId ||
    value.scope.gardenId !== expected.authority.gardenId ||
    value.scope.conversationId !== expected.authority.conversationId ||
    typeof value.status !== "string" ||
    !["queued", "running", "completed", "failed", "aborted"].includes(value.status) ||
    !Array.isArray(value.events) ||
    value.events.length > MAX_EVENTS
  ) {
    throw new Error("The durable cinema Runtime projection is invalid.");
  }
  if (
    expected.job.workerInstanceId !== null &&
    (expected.job.attempt !== value.identity.attempt ||
      expected.job.workerInstanceId !== value.identity.workerInstanceId)
  ) {
    throw new Error("The cinema Runtime projection belongs to another worker attempt.");
  }
  let prior = 0;
  let terminal = false;
  for (const event of value.events) {
    if (
      terminal ||
      !isRecord(event) ||
      !exactKeys(event, ["sequenceNumber", "type", "payload", "at"]) ||
      !Number.isSafeInteger(event.sequenceNumber) ||
      (event.sequenceNumber as number) <= prior ||
      typeof event.type !== "string" ||
      !EVENT_TYPE.test(event.type) ||
      !isRecord(event.payload) ||
      typeof event.at !== "string" ||
      !Number.isFinite(Date.parse(event.at))
    ) {
      throw new Error("The durable cinema Runtime event stream is invalid.");
    }
    prior = event.sequenceNumber as number;
    terminal = ["run.completed", "run.failed", "run.aborted"].includes(event.type);
  }
  const status = value.status as CinemaRunStatus;
  if (["completed", "failed", "aborted"].includes(status)) {
    const expectedType = status === "aborted" ? "run.aborted" : `run.${status}`;
    if ((value.events as CinemaRunEvent[]).at(-1)?.type !== expectedType) {
      throw new Error("The cinema Runtime terminal projection is inconsistent.");
    }
  } else if (terminal) {
    throw new Error("The cinema Runtime projection continued after a terminal event.");
  }
  return value as unknown as RuntimeProjection;
}

function sealedPayload(value: unknown, depth = 0): void {
  if (depth > 16) throw new TypeError("Cinema Runtime request nesting is too deep.");
  if (Array.isArray(value)) {
    for (const item of value) sealedPayload(item, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (["argv", "args", "env", "environment", "executable", "command"].includes(normalized)) {
      throw new TypeError("Cinema Runtime requests cannot override execution configuration.");
    }
    if (/(?:api[-_]?key|authorization|cookie|password|secret|token)$/iu.test(normalized)) {
      throw new TypeError("Cinema Runtime secrets must come from trusted worker environment.");
    }
    sealedPayload(item, depth + 1);
  }
}

async function readProjection(
  adapter: CinemaAdapter,
  authority: RuntimeJobAuthority,
  job: RuntimeJobSnapshot,
  control: CinemaRuntimeControl,
): Promise<RuntimeProjection | null> {
  for (const kind of (job.state === "succeeded" ? ["result", "checkpoint"] : ["checkpoint"]) as
    Array<RuntimeJobOutput["kind"]>) {
    try {
      const output = await control.readOutput(authority, job.jobId, kind);
      if (output.jobId !== job.jobId || output.kind !== kind) {
        throw new Error("The cinema Runtime output belongs to another job or output kind.");
      }
      let candidate = output.content;
      if (kind === "result") {
        if (
          !isRecord(output.content) ||
          !exactKeys(output.content, ["protocolVersion", "identity", "completionSequence", "run"]) ||
          output.content.protocolVersion !== PROTOCOL_VERSION ||
          !isRecord(output.content.identity) ||
          !exactKeys(output.content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
          output.content.identity.jobId !== job.jobId ||
          output.content.identity.attempt !== job.attempt ||
          output.content.identity.workerInstanceId !== job.workerInstanceId ||
          output.content.completionSequence !== job.lastWorkerSequence
        ) {
          throw new Error("The cinema Runtime result envelope is invalid.");
        }
        candidate = output.content.run;
      }
      if (candidate === undefined) continue;
      const projection = parseProjection(candidate, { adapter, authority, job });
      if (kind === "result" && projection.status !== "completed") {
        throw new Error("The cinema Runtime result is not a completed projection.");
      }
      return projection;
    } catch (error) {
      if (
        !(error instanceof RuntimeJobControlError) ||
        !["JOB_OUTPUT_NOT_READY", "JOB_NOT_FOUND"].includes(error.code)
      ) throw error;
    }
  }
  return null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCinemaAgentJob(input: {
  readonly kind: CinemaAgentKind;
  readonly userId: number;
  readonly conversationId: string;
  readonly runId: string;
  readonly requestPayload: unknown;
  readonly signal?: AbortSignal;
  readonly onEvents: (events: readonly CinemaRunEvent[], status: CinemaRunStatus) => void;
  readonly control?: CinemaRuntimeControl;
}): Promise<{ status: CinemaRunStatus; failureMessage: string | null }> {
  const adapter = CINEMA_RUNTIME_ADAPTERS[input.kind];
  const control = input.control ?? DEFAULT_CONTROL;
  const authority = runtimeAuthority(input.userId, input.conversationId);
  if (!JOB_ID.test(input.runId)) throw new TypeError("Cinema Runtime run identity is invalid.");
  sealedPayload(input.requestPayload);
  if (input.signal?.aborted) return { status: "aborted", failureMessage: null };
  let job = requireAdapterJob(
    adapter,
    authority,
    await control.submit(authority, {
      jobType: adapter.jobType,
      idempotencyKey: `${adapter.jobType}-v2:${input.userId}:${input.runId}`,
      requestPayload: input.requestPayload,
      inputUploads: [],
    }),
  );
  let cursor = 0;
  let cancellation: Promise<void> | null = null;
  const cancel = (): Promise<void> => {
    if (TERMINAL_JOB_STATES.has(job.state)) return Promise.resolve();
    if (cancellation) return cancellation;
    cancellation = (async () => {
      try {
        job = requireAdapterJob(adapter, authority, await control.cancel(authority, job.jobId));
      } catch {
        // The native owner still fences and reaps the disposable worker.
      }
    })();
    return cancellation;
  };
  const onAbort = () => void cancel();
  input.signal?.addEventListener("abort", onAbort, { once: true });
  const deadline = Date.now() + adapter.timeoutMs + 10 * 60_000;
  try {
    while (true) {
      const projection = await readProjection(adapter, authority, job, control);
      if (projection) {
        const next = projection.events.filter((event) => event.sequenceNumber > cursor);
        if (next.length > 0) {
          cursor = next.at(-1)!.sequenceNumber;
          input.onEvents(next, projection.status);
        }
      }
      if (input.signal?.aborted) {
        await cancel();
        return { status: "aborted", failureMessage: null };
      }
      if (TERMINAL_JOB_STATES.has(job.state)) {
        const status: CinemaRunStatus = job.state === "succeeded"
          ? projection?.status ?? "completed"
          : job.state === "cancelled"
            ? "aborted"
            : "failed";
        return { status, failureMessage: job.failureMessage };
      }
      if (Date.now() >= deadline) {
        await cancel();
        return { status: "failed", failureMessage: "The cinema Runtime job exceeded its deadline." };
      }
      await wait(150);
      job = requireAdapterJob(adapter, authority, await control.inspect(authority, job.jobId));
    }
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
  }
}

export async function inspectVoxDirectorRuntimeHealth(input: {
  readonly userId: number;
  readonly baseUrl: string;
  readonly checkpoint: string | null;
  readonly voiceProfileId: string | null;
  readonly control?: CinemaRuntimeControl;
}): Promise<Record<string, unknown>> {
  const adapter = CINEMA_RUNTIME_ADAPTERS["vox-director"];
  const control = input.control ?? DEFAULT_CONTROL;
  const authority = runtimeAuthority(input.userId, null);
  const requestId = randomUUID().replaceAll("-", "");
  const requestPayload = {
    operation: "health",
    baseUrl: input.baseUrl,
    checkpoint: input.checkpoint,
    voiceProfileId: input.voiceProfileId,
  };
  sealedPayload(requestPayload);
  let job = requireAdapterJob(
    adapter,
    authority,
    await control.submit(authority, {
      jobType: adapter.jobType,
      idempotencyKey: `${adapter.jobType}-health-v2:${input.userId}:${requestId}`,
      requestPayload,
      inputUploads: [],
    }),
  );
  const deadline = Date.now() + 60_000;
  while (!TERMINAL_JOB_STATES.has(job.state) && Date.now() < deadline) {
    await wait(100);
    job = requireAdapterJob(adapter, authority, await control.inspect(authority, job.jobId));
  }
  if (!TERMINAL_JOB_STATES.has(job.state)) {
    await control.cancel(authority, job.jobId).catch(() => undefined);
    throw new Error("The Vox Director health probe timed out.");
  }
  if (job.state !== "succeeded") {
    throw new Error(job.failureMessage ?? "The Vox Director health probe failed.");
  }
  const output = await control.readOutput(authority, job.jobId, "result");
  if (
    output.jobId !== job.jobId ||
    output.kind !== "result" ||
    !isRecord(output.content) ||
    !exactKeys(output.content, ["protocolVersion", "identity", "completionSequence", "health"]) ||
    output.content.protocolVersion !== PROTOCOL_VERSION ||
    !isRecord(output.content.identity) ||
    !exactKeys(output.content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    output.content.identity.jobId !== job.jobId ||
    output.content.identity.attempt !== job.attempt ||
    output.content.identity.workerInstanceId !== job.workerInstanceId ||
    output.content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(output.content.health)
  ) {
    throw new Error("The Vox Director Runtime health result is invalid.");
  }
  return output.content.health;
}

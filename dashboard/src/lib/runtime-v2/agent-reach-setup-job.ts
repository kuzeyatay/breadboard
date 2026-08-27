import { randomUUID } from "node:crypto";

import {
  RuntimeJobControlError,
  abandonRuntimeJobInput,
  cancelRuntimeJob,
  inspectRuntimeJob,
  isRuntimeV2ServiceControlConfigured,
  readRuntimeJobOutput,
  reserveRuntimeJobInput,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  type RuntimeJobAuthority,
  type RuntimeJobInputReservation,
  type RuntimeJobSnapshot,
} from "../supervisor-control.ts";
import { RuntimeAuthorityUnavailableError } from "./authority-error.ts";

export type AgentReachSetupRequest =
  | { protocolVersion: 1; operation: "install"; target: string }
  | { protocolVersion: 1; operation: "configure"; key: string }
  | { protocolVersion: 1; operation: "import-cookies"; browser: string; platform: string }
  | { protocolVersion: 1; operation: "doctor"; force: boolean };

export interface AgentReachSetupResult {
  ok: boolean;
  output: string;
}

export interface AgentReachDoctorChannel {
  channel: string;
  name: string;
  status: "ok" | "warn" | "off" | "error";
  message: string;
  tier: number;
  backends: string[];
  activeBackend: string | null;
}

export interface AgentReachDoctorResult extends AgentReachSetupResult {
  available: boolean;
  cloned: boolean;
  reason: string | null;
  channels: AgentReachDoctorChannel[];
}

export class AgentReachSetupJobError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AgentReachSetupJobError";
    this.status = status;
    this.code = code;
  }
}

const MAX_SECRET_BYTES = 64 * 1024;
const MAX_RUNTIME_MS = 25 * 60_000;
const POLL_MS = 750;
const TERMINAL = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

function authority(userId: number): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("Agent Reach setup user scope is invalid.");
  }
  return { userId, gardenId: null, conversationId: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function assertSnapshot(snapshot: RuntimeJobSnapshot): void {
  if (
    snapshot.jobType !== "agent-reach-setup" ||
    snapshot.workerKind !== "agent-reach-setup-node" ||
    snapshot.resourceClass !== "document-processing" ||
    snapshot.gardenId !== null ||
    snapshot.conversationId !== null
  ) throw new Error("Runtime returned an invalid Agent Reach setup job.");
}

function parseResult(
  job: RuntimeJobSnapshot,
  content: unknown,
  request: AgentReachSetupRequest,
): AgentReachSetupResult | AgentReachDoctorResult {
  if (
    !exactRecord(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== 1 ||
    content.completionSequence !== job.lastWorkerSequence ||
    !exactRecord(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result)
  ) throw new Error("Runtime returned an unfenced Agent Reach setup result.");
  const result = content.result;
  const keys = Object.keys(result).sort().join(",");
  const successKeys = request.operation === "doctor"
    ? "available,channels,cloned,ok,output,reason"
    : "ok,output";
  if (keys !== successKeys && keys !== "error,ok,output") {
    throw new Error("Runtime returned an invalid Agent Reach setup result.");
  }
  if (result.error !== undefined) {
    if (
      !exactRecord(result.error, ["code", "status", "message"]) ||
      typeof result.error.code !== "string" ||
      !result.error.code ||
      result.error.code.length > 128 ||
      !Number.isSafeInteger(result.error.status) ||
      (result.error.status as number) < 400 ||
      (result.error.status as number) > 599 ||
      typeof result.error.message !== "string"
    ) throw new Error("Runtime returned an invalid Agent Reach setup failure.");
    throw new AgentReachSetupJobError(
      result.error.status as number,
      result.error.code,
      result.error.message.slice(0, 8_000),
    );
  }
  if (
    typeof result.ok !== "boolean" ||
    typeof result.output !== "string" ||
    Buffer.byteLength(result.output, "utf8") > 16_000
  ) {
    throw new Error("Runtime returned invalid Agent Reach setup output.");
  }
  if (request.operation !== "doctor") return { ok: result.ok, output: result.output };
  if (
    result.ok !== true ||
    typeof result.available !== "boolean" ||
    typeof result.cloned !== "boolean" ||
    !(result.reason === null || (
      typeof result.reason === "string" && Buffer.byteLength(result.reason, "utf8") <= 4_000
    )) ||
    !Array.isArray(result.channels) ||
    result.channels.length > 100
  ) throw new Error("Runtime returned invalid Agent Reach doctor output.");
  const channels = result.channels.map((channel) => {
    if (
      !exactRecord(channel, [
        "channel",
        "name",
        "status",
        "message",
        "tier",
        "backends",
        "activeBackend",
      ]) ||
      typeof channel.channel !== "string" ||
      !/^[a-z0-9_-]{1,80}$/u.test(channel.channel) ||
      typeof channel.name !== "string" ||
      Buffer.byteLength(channel.name, "utf8") > 400 ||
      !["ok", "warn", "off", "error"].includes(channel.status as string) ||
      typeof channel.message !== "string" ||
      Buffer.byteLength(channel.message, "utf8") > 4_000 ||
      !Number.isSafeInteger(channel.tier) ||
      (channel.tier as number) < 0 ||
      (channel.tier as number) > 10 ||
      !Array.isArray(channel.backends) ||
      channel.backends.length > 20 ||
      !channel.backends.every(
        (backend) => typeof backend === "string" && Buffer.byteLength(backend, "utf8") <= 400,
      ) ||
      !(channel.activeBackend === null || (
        typeof channel.activeBackend === "string" &&
        Buffer.byteLength(channel.activeBackend, "utf8") <= 400
      ))
    ) throw new Error("Runtime returned an invalid Agent Reach doctor channel.");
    return channel as unknown as AgentReachDoctorChannel;
  });
  return {
    ok: true,
    output: result.output,
    available: result.available,
    cloned: result.cloned,
    reason: result.reason,
    channels,
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const abort = () => done(signal.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown) {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
    timer.unref?.();
  });
}

function secretStream(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

export async function runAgentReachSetupJob(input: {
  userId: number;
  request: AgentReachSetupRequest;
  secret?: string;
  signal?: AbortSignal;
}): Promise<AgentReachSetupResult | AgentReachDoctorResult> {
  if (!isRuntimeV2ServiceControlConfigured()) {
    throw new RuntimeAuthorityUnavailableError(
      "Agent Reach setup requires the Breadboard Runtime job owner.",
    );
  }
  const secret = input.secret === undefined ? null : Buffer.from(input.secret, "utf8");
  if (
    (input.request.operation === "configure" && (!secret || secret.byteLength < 1)) ||
    (input.request.operation !== "configure" && secret !== null) ||
    (secret?.byteLength ?? 0) > MAX_SECRET_BYTES
  ) throw new TypeError("The sealed Agent Reach setup input is invalid.");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Agent Reach setup timed out", "TimeoutError")),
    MAX_RUNTIME_MS,
  );
  timeout.unref?.();
  const forwardAbort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });
  const jobAuthority = authority(input.userId);
  let reservation: RuntimeJobInputReservation | null = null;
  let submitted = false;
  let jobId: string | null = null;
  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    let uploaded = null;
    if (secret) {
      reservation = await reserveRuntimeJobInput(jobAuthority, {
        gardenId: null,
        conversationId: null,
        displayName: "agent-reach-credential.txt",
        mediaType: "application/x-breadboard-secret",
        declaredSizeBytes: secret.byteLength,
      });
      uploaded = await uploadRuntimeJobInput(
        jobAuthority,
        reservation,
        secretStream(secret),
        controller.signal,
      );
    }
    let snapshot = await submitRuntimeJob(jobAuthority, {
      jobType: "agent-reach-setup",
      idempotencyKey: `agent-reach-setup-${randomUUID()}`,
      requestPayload: input.request,
      ...(uploaded ? { inputUploads: [{ uploadId: uploaded.uploadId }] } : {}),
    });
    submitted = true;
    jobId = snapshot.jobId;
    assertSnapshot(snapshot);
    while (!TERMINAL.has(snapshot.state)) {
      await delay(POLL_MS, controller.signal);
      snapshot = await inspectRuntimeJob(jobAuthority, snapshot.jobId);
      assertSnapshot(snapshot);
    }
    if (snapshot.state === "succeeded") {
      return parseResult(
        snapshot,
        (await readRuntimeJobOutput(jobAuthority, snapshot.jobId, "result")).content,
        input.request,
      );
    }
    if (snapshot.state === "resource_exhausted" && snapshot.resourceExhaustion) {
      const evidence = snapshot.resourceExhaustion;
      throw new RuntimeJobControlError({
        code: "BREADBOARD_RESOURCE_EXHAUSTED",
        message: "Windows commit headroom is too low for Agent Reach setup.",
        status: 503,
        resource: evidence.resource,
        requiredHeadroomMb: evidence.requiredHeadroomMb,
        availableHeadroomMb: evidence.availableHeadroomMb,
      });
    }
    throw new AgentReachSetupJobError(
      snapshot.state === "cancelled" ? 499 : 502,
      snapshot.state === "cancelled" ? "setup_cancelled" : "setup_interrupted",
      snapshot.state === "cancelled"
        ? "Agent Reach setup was cancelled."
        : snapshot.failureMessage ?? "Agent Reach setup was interrupted.",
    );
  } catch (error) {
    if (controller.signal.aborted && jobId) {
      await cancelRuntimeJob(jobAuthority, jobId).catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
    secret?.fill(0);
    if (!submitted && reservation) {
      await abandonRuntimeJobInput(jobAuthority, reservation.uploadId).catch(() => undefined);
    }
  }
}

export async function runAgentReachDoctorJob(input: {
  userId: number;
  force?: boolean;
  signal?: AbortSignal;
}): Promise<AgentReachDoctorResult> {
  const result = await runAgentReachSetupJob({
    userId: input.userId,
    request: { protocolVersion: 1, operation: "doctor", force: input.force === true },
    signal: input.signal,
  });
  if (!("available" in result)) {
    throw new Error("Runtime returned the wrong Agent Reach doctor result.");
  }
  return result;
}

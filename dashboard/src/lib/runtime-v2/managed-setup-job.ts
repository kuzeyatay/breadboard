import "server-only";

import { randomUUID } from "node:crypto";
import {
  RuntimeJobControlError,
  cancelRuntimeJob,
  inspectRuntimeJob,
  isRuntimeV2ServiceControlConfigured,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
} from "../supervisor-control.ts";
import { RuntimeAuthorityUnavailableError } from "./authority-error.ts";

export type ManagedSetupServiceId =
  | "audio-analyzer"
  | "bolt-slides"
  | "career-ops"
  | "comfyui"
  | "deep-tutor"
  | "deer-flow"
  | "google-images"
  | "hyperframes"
  | "legal"
  | "matraix"
  | "money-printer"
  | "openmontage"
  | "openexecutive"
  | "openscience"
  | "openwork"
  | "resource2skill"
  | "shorts"
  | "stock-analyst"
  | "subsai"
  | "tradingagents"
  | "vibe-trading"
  | "wardrobe";

export interface ManagedSetupResult {
  ok: boolean;
  message: string;
  detail: string;
}

export class ManagedSetupExecutionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ManagedSetupExecutionError";
    this.status = status;
    this.code = code;
  }
}

const POLL_MS = 750;
// Stay inside the worker profile's 60-minute hard runtime while leaving the
// supervisor five minutes to acknowledge cancellation and reap the tree.
const MAX_SETUP_MS = 55 * 60_000;
const TERMINAL = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

function authority(userId: number): RuntimeJobAuthority {
  return { userId, gardenId: null, conversationId: null };
}

function assertManagedSetupSnapshot(snapshot: RuntimeJobSnapshot): void {
  if (
    snapshot.jobType !== "managed-setup" ||
    snapshot.workerKind !== "managed-setup-node" ||
    snapshot.resourceClass !== "document-processing" ||
    snapshot.gardenId !== null ||
    snapshot.conversationId !== null
  ) {
    throw new Error("Runtime returned an invalid managed setup job.");
  }
}

function boundedText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 8_000)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseResult(job: RuntimeJobSnapshot, content: unknown): ManagedSetupResult {
  if (!isRecord(content)) {
    throw new Error("Runtime returned an invalid setup result.");
  }
  const identity = content.identity;
  if (
    Object.keys(content).sort().join(",") !==
      "completionSequence,identity,protocolVersion,result" ||
    content.protocolVersion !== 1 ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(identity) ||
    identity.jobId !== job.jobId ||
    identity.attempt !== job.attempt ||
    identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result)
  ) {
    throw new Error("Runtime returned an unfenced setup result.");
  }
  const value = content.result;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "detail,message,ok" && keys !== "detail,error,message,ok") {
    throw new Error("Runtime returned an invalid setup result.");
  }
  if (value.error !== undefined) {
    if (
      !isRecord(value.error) ||
      Object.keys(value.error).sort().join(",") !== "code,status" ||
      typeof value.error.code !== "string" ||
      !value.error.code ||
      value.error.code.length > 128 ||
      !Number.isSafeInteger(value.error.status) ||
      (value.error.status as number) < 400 ||
      (value.error.status as number) > 599
    ) {
      throw new Error("Runtime returned an invalid setup failure.");
    }
    throw new ManagedSetupExecutionError(
      value.error.status as number,
      value.error.code,
      boundedText(value.message, "Setup failed."),
    );
  }
  return {
    ok: value.ok === true,
    message: boundedText(value.message, "Setup finished."),
    detail: typeof value.detail === "string" ? value.detail.slice(0, 32_000) : "",
  };
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const abort = () => done(signal.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
    timer.unref?.();
  });
}

/**
 * Submit one user-authorized install/repair/remove operation to the durable
 * Runtime job ledger, preserving the existing synchronous setup-route shape.
 */
export async function runManagedSetupJob(input: {
  userId: number;
  serviceId: ManagedSetupServiceId;
  action: string;
  signal?: AbortSignal;
}): Promise<ManagedSetupResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Setup timed out", "TimeoutError")),
    MAX_SETUP_MS,
  );
  timeout.unref?.();
  const forwardAbort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });
  const jobAuthority = authority(input.userId);
  let jobId: string | null = null;
  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    let snapshot = await submitManagedSetupJob({ ...input, signal: controller.signal });
    jobId = snapshot.jobId;
    while (!TERMINAL.has(snapshot.state)) {
      await delay(POLL_MS, controller.signal);
      snapshot = await inspectRuntimeJob(jobAuthority, snapshot.jobId);
      assertManagedSetupSnapshot(snapshot);
    }
    if (snapshot.state === "succeeded") {
      return parseResult(
        snapshot,
        (await readRuntimeJobOutput(jobAuthority, snapshot.jobId, "result")).content,
      );
    }
    if (snapshot.state === "cancelled") {
      return { ok: false, message: "Setup was cancelled.", detail: "" };
    }
    if (snapshot.state === "resource_exhausted" && snapshot.resourceExhaustion) {
      const evidence = snapshot.resourceExhaustion;
      throw new RuntimeJobControlError({
        code: "BREADBOARD_RESOURCE_EXHAUSTED",
        message: "Windows commit headroom is too low for this setup operation.",
        status: 503,
        resource: evidence.resource,
        requiredHeadroomMb: evidence.requiredHeadroomMb,
        availableHeadroomMb: evidence.availableHeadroomMb,
      });
    }
    return {
      ok: false,
      message:
        snapshot.state === "interrupted" || snapshot.state === "uncertain"
          ? "Setup was interrupted before completion."
          : "Setup failed.",
      detail: snapshot.failureMessage ?? "",
    };
  } catch (error) {
    if (controller.signal.aborted && jobId) {
      await cancelRuntimeJob(jobAuthority, jobId).catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
  }
}

/** Submit a durable finite setup and return once Runtime owns it. */
export async function submitManagedSetupJob(input: {
  userId: number;
  serviceId: ManagedSetupServiceId;
  action: string;
  signal?: AbortSignal;
}): Promise<RuntimeJobSnapshot> {
  if (!isRuntimeV2ServiceControlConfigured()) {
    throw new RuntimeAuthorityUnavailableError(
      "Managed setup requires the Breadboard Runtime job owner.",
    );
  }
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const snapshot = await submitRuntimeJob(authority(input.userId), {
    jobType: "managed-setup",
    idempotencyKey: `${input.serviceId}-setup-${randomUUID()}`,
    requestPayload: {
      protocolVersion: 1,
      operation: input.serviceId,
      action: input.action,
    },
  });
  assertManagedSetupSnapshot(snapshot);
  return snapshot;
}

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

export type ClaudeAccountOperation = "status" | "logout";

export interface ClaudeAccountJobResult {
  ok: boolean;
  message: string;
  detail: string;
}

export class ClaudeAccountJobError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ClaudeAccountJobError";
    this.status = status;
  }
}

const POLL_MS = 250;
const MAX_RUNTIME_MS = 30_000;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSnapshot(snapshot: RuntimeJobSnapshot): void {
  if (
    snapshot.jobType !== "claude-account" ||
    snapshot.workerKind !== "claude-account-node" ||
    snapshot.resourceClass !== "document-processing" ||
    snapshot.gardenId !== null ||
    snapshot.conversationId !== null
  ) {
    throw new Error("Runtime returned an invalid Claude account job.");
  }
}

function boundedText(value: unknown, fallback: string, maximum: number): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum)
    : fallback;
}

function parseResult(job: RuntimeJobSnapshot, content: unknown): ClaudeAccountJobResult {
  if (!isRecord(content)) throw new Error("Runtime returned an invalid Claude account result.");
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
    throw new Error("Runtime returned an unfenced Claude account result.");
  }
  const result = content.result;
  const keys = Object.keys(result).sort().join(",");
  if (keys !== "detail,message,ok" && keys !== "detail,error,message,ok") {
    throw new Error("Runtime returned an invalid Claude account result.");
  }
  if (result.error !== undefined) {
    if (
      !isRecord(result.error) ||
      Object.keys(result.error).sort().join(",") !== "code,status" ||
      !Number.isSafeInteger(result.error.status) ||
      (result.error.status as number) < 400 ||
      (result.error.status as number) > 599
    ) {
      throw new Error("Runtime returned an invalid Claude account failure.");
    }
    throw new ClaudeAccountJobError(
      result.error.status as number,
      boundedText(result.message, "Claude Code account operation failed.", 8_000),
    );
  }
  return {
    ok: result.ok === true,
    message: boundedText(result.message, "Claude Code account operation finished.", 8_000),
    detail: typeof result.detail === "string" ? result.detail.slice(0, 32_000) : "",
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

/** Run one fixed Claude-owned account command under authenticated Runtime authority. */
export async function runClaudeAccountJob(input: {
  userId: number;
  operation: ClaudeAccountOperation;
  signal?: AbortSignal;
}): Promise<ClaudeAccountJobResult> {
  if (!isRuntimeV2ServiceControlConfigured()) {
    throw new RuntimeAuthorityUnavailableError(
      "Claude Code account checks require the Breadboard Runtime job owner.",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Claude account operation timed out", "TimeoutError")),
    MAX_RUNTIME_MS,
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
    let snapshot = await submitRuntimeJob(jobAuthority, {
      jobType: "claude-account",
      idempotencyKey: `claude-account-${input.operation}-${randomUUID()}`,
      requestPayload: {
        protocolVersion: 1,
        operation: "claude-code",
        action: input.operation,
      },
    });
    assertSnapshot(snapshot);
    jobId = snapshot.jobId;
    while (!TERMINAL.has(snapshot.state)) {
      await delay(POLL_MS, controller.signal);
      snapshot = await inspectRuntimeJob(jobAuthority, snapshot.jobId);
      assertSnapshot(snapshot);
    }
    if (snapshot.state === "succeeded") {
      return parseResult(
        snapshot,
        (await readRuntimeJobOutput(jobAuthority, snapshot.jobId, "result")).content,
      );
    }
    if (snapshot.state === "resource_exhausted" && snapshot.resourceExhaustion) {
      const evidence = snapshot.resourceExhaustion;
      throw new RuntimeJobControlError({
        code: "BREADBOARD_RESOURCE_EXHAUSTED",
        message: "Windows commit headroom is too low for the Claude account check.",
        status: 503,
        resource: evidence.resource,
        requiredHeadroomMb: evidence.requiredHeadroomMb,
        availableHeadroomMb: evidence.availableHeadroomMb,
      });
    }
    throw new ClaudeAccountJobError(
      snapshot.state === "cancelled" ? 499 : 502,
      snapshot.state === "cancelled"
        ? "Claude Code account operation was cancelled."
        : "Claude Code account operation was interrupted.",
    );
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

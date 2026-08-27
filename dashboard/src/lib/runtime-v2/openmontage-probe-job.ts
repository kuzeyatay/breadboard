import "server-only";

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import type { ToolchainStatus } from "../openmontage/setup.ts";
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
const MAX_OPERATION_MS = 360_000;
const POLL_MS = 100;
const MAX_PATH_BYTES = 2_048;
const MAX_REASON_BYTES = 8 * 1_024;
const MAX_TEXT_BYTES = 512;
const PROVIDERS = new Set([
  "FAL_KEY",
  "FAL_AI_API_KEY",
  "REPLICATE_API_TOKEN",
  "HIGGSFIELD_API_KEY",
  "KLING_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "ELEVENLABS_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "SUNO_API_KEY",
  "HEYGEN_API_KEY",
  "RUNWAY_API_KEY",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "UNSPLASH_ACCESS_KEY",
  "AZURE_SPEECH_KEY",
]);
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface OpenMontageProbeControl {
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

const DEFAULT_CONTROL: OpenMontageProbeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
  cancelByIdempotencyKey: cancelRuntimeJobByIdempotencyKey,
};

export class OpenMontageProbeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "OpenMontageProbeError";
    this.code = code;
    this.status = status;
  }
}

function authority(userId: number): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("OpenMontage probe user scope is invalid.");
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

function boundedText(value: unknown, maximumBytes = MAX_TEXT_BYTES): value is string {
  return typeof value === "string" &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function absolutePath(value: unknown, allowEmpty: boolean): value is string {
  return boundedText(value, MAX_PATH_BYTES) &&
    (value === "" ? allowEmpty : path.isAbsolute(value));
}

function validProviders(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length <= PROVIDERS.size &&
    value.every((provider): provider is string => (
      typeof provider === "string" && PROVIDERS.has(provider)
    )) &&
    new Set(value).size === value.length &&
    [...value].sort().every((provider, index) => provider === value[index]);
}

function parsePiece(value: unknown, label: string): { found: boolean; path: string; source: string } {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["found", "path", "source"]) ||
    typeof value.found !== "boolean" ||
    !absolutePath(value.path, true) ||
    !boundedText(value.source) ||
    value.found !== (value.path !== "") ||
    (!value.found && value.source !== "")
  ) throw new Error(`Runtime returned invalid OpenMontage ${label} status.`);
  return { found: value.found, path: value.path, source: value.source };
}

function assertSnapshot(job: RuntimeJobSnapshot): void {
  if (
    job.jobType !== "openmontage-probe" ||
    job.workerKind !== "openmontage-probe-node" ||
    job.resourceClass !== "document-processing" ||
    job.gardenId !== null ||
    job.conversationId !== null
  ) throw new Error("Runtime returned a job outside the OpenMontage probe contract.");
}

function parseResult(job: RuntimeJobSnapshot, content: unknown): ToolchainStatus {
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
      "ready", "reason", "clone", "python", "ffmpeg", "ffprobe", "node",
      "remotion", "codex", "tools", "providers",
    ])
  ) throw new Error("Runtime returned an unfenced OpenMontage probe result.");
  const result = content.result;
  if (
    typeof result.ready !== "boolean" ||
    !boundedText(result.reason, MAX_REASON_BYTES) ||
    !isRecord(result.clone) ||
    !exactKeys(result.clone, ["found", "path"]) ||
    typeof result.clone.found !== "boolean" ||
    !absolutePath(result.clone.path, true) ||
    result.clone.found !== (result.clone.path !== "") ||
    !isRecord(result.python) ||
    !exactKeys(result.python, [
      "found", "path", "source", "version", "dependencies", "installable",
    ]) ||
    typeof result.python.found !== "boolean" ||
    !absolutePath(result.python.path, true) ||
    result.python.found !== (result.python.path !== "") ||
    !boundedText(result.python.source) ||
    !boundedText(result.python.version) ||
    typeof result.python.dependencies !== "boolean" ||
    typeof result.python.installable !== "boolean" ||
    result.python.installable !== result.clone.found ||
    (result.python.dependencies && !result.python.found) ||
    !isRecord(result.node) ||
    !exactKeys(result.node, ["found", "version"]) ||
    typeof result.node.found !== "boolean" ||
    !boundedText(result.node.version) ||
    !isRecord(result.remotion) ||
    !exactKeys(result.remotion, ["found", "path", "installable"]) ||
    typeof result.remotion.found !== "boolean" ||
    !absolutePath(result.remotion.path, false) ||
    typeof result.remotion.installable !== "boolean" ||
    result.remotion.installable !== (result.clone.found && result.node.found) ||
    !isRecord(result.codex) ||
    !exactKeys(result.codex, ["found", "version"]) ||
    typeof result.codex.found !== "boolean" ||
    !boundedText(result.codex.version) ||
    !isRecord(result.tools) ||
    !exactKeys(result.tools, ["available", "total", "reason"]) ||
    !Number.isSafeInteger(result.tools.available) ||
    Number(result.tools.available) < 0 ||
    !Number.isSafeInteger(result.tools.total) ||
    Number(result.tools.total) < 0 ||
    Number(result.tools.available) > Number(result.tools.total) ||
    Number(result.tools.total) > 10_000 ||
    !boundedText(result.tools.reason, MAX_REASON_BYTES) ||
    !validProviders(result.providers)
  ) throw new Error("Runtime returned invalid OpenMontage setup status.");
  const ffmpeg = parsePiece(result.ffmpeg, "ffmpeg");
  const ffprobe = parsePiece(result.ffprobe, "ffprobe");
  if (
    (!result.python.found && (result.python.source !== "" || result.python.version !== "")) ||
    (!result.node.found && result.node.version !== "") ||
    (!result.codex.found && result.codex.version !== "") ||
    (result.ready && (
      !result.clone.found || !result.python.found || !result.python.dependencies ||
      !ffmpeg.found || !result.codex.found
    ))
  ) throw new Error("Runtime returned inconsistent OpenMontage setup status.");
  return {
    ready: result.ready,
    reason: result.reason,
    clone: { found: result.clone.found, path: result.clone.path },
    python: {
      found: result.python.found,
      path: result.python.path,
      source: result.python.source,
      version: result.python.version,
      dependencies: result.python.dependencies,
      installable: result.python.installable,
    },
    ffmpeg,
    ffprobe,
    node: { found: result.node.found, version: result.node.version },
    remotion: {
      found: result.remotion.found,
      path: result.remotion.path,
      installable: result.remotion.installable,
    },
    codex: { found: result.codex.found, version: result.codex.version },
    tools: {
      available: result.tools.available as number,
      total: result.tools.total as number,
      reason: result.tools.reason,
    },
    providers: [...result.providers],
  };
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

function terminalError(job: RuntimeJobSnapshot): Error {
  if (job.state === "resource_exhausted" && job.resourceExhaustion) {
    const evidence = job.resourceExhaustion;
    return new RuntimeJobControlError({
      code: "BREADBOARD_RESOURCE_EXHAUSTED",
      message: "Windows commit headroom is too low for the OpenMontage health probe.",
      status: 503,
      resource: evidence.resource,
      requiredHeadroomMb: evidence.requiredHeadroomMb,
      availableHeadroomMb: evidence.availableHeadroomMb,
    });
  }
  if (job.state === "cancelled") {
    return new OpenMontageProbeError(
      "openmontage_probe_cancelled",
      "The OpenMontage health probe was cancelled.",
      499,
    );
  }
  return new OpenMontageProbeError(
    "openmontage_probe_interrupted",
    job.failureMessage ?? "The OpenMontage health probe was interrupted.",
    502,
  );
}

/** Run one observational OpenMontage toolchain probe in a fresh disposable worker. */
export async function runOpenMontageProbeViaRuntime(input: {
  readonly userId: number;
  readonly signal?: AbortSignal;
  readonly control?: OpenMontageProbeControl;
}): Promise<ToolchainStatus> {
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const jobAuthority = authority(input.userId);
  const control = input.control ?? DEFAULT_CONTROL;
  const idempotencyKey = `openmontage-probe-v2:${createHash("sha256")
    .update(`${input.userId}:${randomUUID()}`, "utf8")
    .digest("hex")}`;
  let job: RuntimeJobSnapshot | null = null;
  let cancellationForwarded = false;
  try {
    job = await control.submit(jobAuthority, {
      jobType: "openmontage-probe",
      idempotencyKey,
      requestPayload: { protocolVersion: PROTOCOL_VERSION, operation: "status" },
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
        throw new OpenMontageProbeError(
          "openmontage_probe_timeout",
          "The OpenMontage health probe did not finish in time.",
          504,
        );
      }
      await delay(POLL_MS, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      assertSnapshot(job);
    }
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another OpenMontage probe.");
    }
    return parseResult(job, output.content);
  } catch (error) {
    if (
      job && !cancellationForwarded && input.signal?.aborted &&
      !TERMINAL_STATES.has(job.state)
    ) {
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

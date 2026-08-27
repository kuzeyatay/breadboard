import "server-only";

import { createHash, randomUUID } from "node:crypto";

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
const MAX_ARGUMENTS = 12;
const MAX_ARGUMENT_LENGTH = 4_096;
const MAX_ARGUMENT_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const PREVIEW_BYTES = 24 * 1024;
const MAX_OPERATION_MS = 330_000;
const WORKSPACE_KEY = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/u;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface FactcheckRuntimeScope {
  readonly userId: number;
  readonly gardenId: string | null;
  readonly conversationId: string;
}

export interface FactcheckRuntimeControl {
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

export interface FactcheckRuntimeResult {
  readonly command: string;
  readonly arguments: string[];
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly outputPath: string;
  readonly outputBytes: number;
  readonly preview: string;
  readonly truncated: boolean;
  readonly stderr: string;
}

const DEFAULT_CONTROL: FactcheckRuntimeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
  cancelByIdempotencyKey: cancelRuntimeJobByIdempotencyKey,
};

export class FactcheckRuntimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "FactcheckRuntimeError";
    this.code = code;
    this.status = status;
  }
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

function boundedScope(value: string | null, nullable: boolean): boolean {
  return value === null
    ? nullable
    : value.trim() === value &&
        value.length > 0 &&
        Buffer.byteLength(value, "utf8") <= 256 &&
        !/\p{Cc}/u.test(value);
}

function authority(scope: FactcheckRuntimeScope): RuntimeJobAuthority {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId < 1 ||
    !boundedScope(scope.gardenId, true) ||
    !boundedScope(scope.conversationId, false)
  ) throw new TypeError("Factcheck Runtime scope is invalid.");
  return {
    userId: scope.userId,
    gardenId: scope.gardenId,
    conversationId: scope.conversationId,
  };
}

function canonicalArguments(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_ARGUMENTS) {
    throw new FactcheckRuntimeError(
      "factcheck_invalid_arguments",
      `The fact-check tool requires between 2 and ${MAX_ARGUMENTS} arguments: a command and its subject.`,
      400,
    );
  }
  const args = value.map((entry) => {
    if (
      typeof entry !== "string" ||
      !entry.trim() ||
      entry.length > MAX_ARGUMENT_LENGTH ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(entry) ||
      /[\r\n]/u.test(entry)
    ) {
      throw new FactcheckRuntimeError(
        "factcheck_invalid_arguments",
        "Fact-check arguments must be non-empty, bounded, single-line strings.",
        400,
      );
    }
    return entry;
  });
  if (Buffer.byteLength(args.join("\u0000"), "utf8") > MAX_ARGUMENT_BYTES) {
    throw new FactcheckRuntimeError(
      "factcheck_invalid_arguments",
      "Fact-check arguments exceed the size limit.",
      400,
    );
  }
  return args;
}

function isFactcheckJob(job: RuntimeJobSnapshot, scope: RuntimeJobAuthority): boolean {
  return job.jobType === "factcheck-command" &&
    job.workerKind === "factcheck-node" &&
    job.resourceClass === "document-processing" &&
    job.gardenId === scope.gardenId &&
    job.conversationId === scope.conversationId;
}

function validateEnvelope(job: RuntimeJobSnapshot, content: unknown): Record<string, unknown> {
  if (!isRecord(content) || !exactKeys(content, [
    "protocolVersion",
    "identity",
    "completionSequence",
    "result",
  ])) throw new Error("Runtime returned an invalid Factcheck result envelope.");
  if (
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result)
  ) throw new Error("Runtime returned Factcheck output outside its worker fence.");
  return content.result;
}

function validOutputPath(value: unknown, command: string): value is string {
  if (
    typeof value !== "string" ||
    value.includes("\\") ||
    value.includes(":") ||
    /\p{Cc}/u.test(value)
  ) return false;
  const segments = value.split("/");
  if (
    segments.length !== 2 ||
    segments[0] !== "factcheck" ||
    !segments[1] ||
    segments[1] === "." ||
    segments[1] === ".."
  ) return false;
  if (command === "reference") {
    return /^reference-(?:RUBRIC|CLAIMS|RUN-RECORD)\.md$/u.test(segments[1]);
  }
  const extension = command === "fetch" || command === "coverage" ? "md" : "txt";
  return new RegExp(`^${command}-[a-z0-9-]{1,48}-[a-f0-9]{8}\\.${extension}$`, "u")
    .test(segments[1]);
}

function validReturnedArguments(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length >= 1 &&
    value.length < MAX_ARGUMENTS &&
    value.every((entry) =>
      typeof entry === "string" &&
      entry.length > 0 &&
      entry.length <= MAX_ARGUMENT_LENGTH &&
      !/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(entry)
    ) &&
    Buffer.byteLength(value.join("\u0000"), "utf8") <= MAX_ARGUMENT_BYTES;
}

function validRunResult(
  value: Record<string, unknown>,
  requestedArguments: readonly string[],
): value is Record<string, unknown> & FactcheckRuntimeResult {
  const command = requestedArguments[0];
  return exactKeys(value, [
    "ok",
    "operation",
    "command",
    "arguments",
    "exitCode",
    "durationMs",
    "outputPath",
    "outputBytes",
    "preview",
    "truncated",
    "stderr",
  ]) &&
    value.ok === true &&
    value.operation === "command" &&
    value.command === command &&
    ["fetch", "coverage", "tally", "retractions", "reference"].includes(command) &&
    validReturnedArguments(value.arguments) &&
    (value.exitCode === null ||
      (Number.isSafeInteger(value.exitCode) &&
        Number(value.exitCode) >= -2_147_483_648 &&
        Number(value.exitCode) <= 4_294_967_295)) &&
    Number.isSafeInteger(value.durationMs) &&
    Number(value.durationMs) >= 0 &&
    Number(value.durationMs) <= MAX_OPERATION_MS &&
    validOutputPath(value.outputPath, command) &&
    Number.isSafeInteger(value.outputBytes) &&
    Number(value.outputBytes) >= 0 &&
    Number(value.outputBytes) <= MAX_OUTPUT_BYTES &&
    typeof value.preview === "string" &&
    Buffer.byteLength(value.preview, "utf8") <= PREVIEW_BYTES + 3 &&
    typeof value.truncated === "boolean" &&
    value.truncated === (Number(value.outputBytes) > PREVIEW_BYTES) &&
    typeof value.stderr === "string" &&
    value.stderr.length <= 4_000 &&
    Buffer.byteLength(value.stderr, "utf8") <= 16 * 1024;
}

function statusForCode(code: string): number {
  return code === "factcheck_failed"
    ? 500
    : code === "factcheck_runtime_unavailable"
      ? 503
      : code === "factcheck_timeout"
        ? 504
        : code === "factcheck_cancelled"
          ? 409
          : code === "factcheck_launch_failed" ||
              code === "factcheck_workspace_unavailable"
            ? 502
            : code === "factcheck_command_denied" ||
                code === "factcheck_flag_denied" ||
                code === "factcheck_source_denied" ||
                code === "factcheck_path_denied"
              ? 403
              : 400;
}

function terminalError(job: RuntimeJobSnapshot): FactcheckRuntimeError {
  if (job.state === "cancelled") {
    return new FactcheckRuntimeError(
      "factcheck_cancelled",
      "The fact-check script was cancelled with the current chat turn.",
      409,
    );
  }
  if (job.state === "resource_exhausted") {
    return new FactcheckRuntimeError(
      "factcheck_runtime_unavailable",
      "The fact-check runtime is not prepared. Clone bullshit-detector/ and install uv (https://docs.astral.sh/uv/).",
      503,
    );
  }
  return new FactcheckRuntimeError(
    "factcheck_launch_failed",
    "The fact-check script could not start.",
    502,
  );
}

function controlError(error: RuntimeJobControlError): FactcheckRuntimeError {
  if (error.code === "JOB_CANCELLED_BEFORE_SUBMISSION") {
    return new FactcheckRuntimeError(
      "factcheck_cancelled",
      "The fact-check script was cancelled with the current chat turn.",
      409,
    );
  }
  if (error.code === "RUNTIME_UNAVAILABLE" || error.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
    return new FactcheckRuntimeError(
      "factcheck_runtime_unavailable",
      "The fact-check runtime is not prepared. Clone bullshit-detector/ and install uv (https://docs.astral.sh/uv/).",
      503,
    );
  }
  return new FactcheckRuntimeError(
    "factcheck_launch_failed",
    "The fact-check script could not start.",
    502,
  );
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

/** Execute one Factcheck command in a fresh, conversation-scoped Runtime worker. */
export async function runFactcheckViaRuntime(input: {
  readonly scope: FactcheckRuntimeScope;
  readonly workspaceKey: string;
  readonly arguments: unknown;
  readonly signal?: AbortSignal;
  readonly control?: FactcheckRuntimeControl;
}): Promise<FactcheckRuntimeResult> {
  const args = canonicalArguments(input.arguments);
  if (
    !WORKSPACE_KEY.test(input.workspaceKey) ||
    Buffer.byteLength(input.workspaceKey, "utf8") > 512
  ) throw new TypeError("Factcheck workspace identity is invalid.");
  if (input.signal?.aborted) {
    throw new FactcheckRuntimeError(
      "factcheck_cancelled",
      "The fact-check script was cancelled with the current chat turn.",
      409,
    );
  }
  const jobAuthority = authority(input.scope);
  const control = input.control ?? DEFAULT_CONTROL;
  const digest = createHash("sha256")
    .update(JSON.stringify({
      scope: jobAuthority,
      workspaceKey: input.workspaceKey,
      arguments: args,
      nonce: randomUUID(),
    }), "utf8")
    .digest("hex");
  const idempotencyKey = `factcheck-v2:${digest}`;
  let cancellationForwarded = false;
  let job: RuntimeJobSnapshot | null = null;
  try {
    job = await control.submit(jobAuthority, {
      jobType: "factcheck-command",
      idempotencyKey,
      requestPayload: {
        protocolVersion: PROTOCOL_VERSION,
        operation: "command",
        workspaceKey: input.workspaceKey,
        arguments: args,
      },
    });
    if (!isFactcheckJob(job, jobAuthority)) {
      throw new Error("Runtime returned a job outside the Factcheck worker contract.");
    }
    const deadline = Date.now() + MAX_OPERATION_MS;
    while (!TERMINAL_STATES.has(job.state)) {
      if (input.signal?.aborted) {
        cancellationForwarded = true;
        await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
        throw new FactcheckRuntimeError(
          "factcheck_cancelled",
          "The fact-check script was cancelled with the current chat turn.",
          409,
        );
      }
      if (Date.now() >= deadline) {
        cancellationForwarded = true;
        await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
        throw new FactcheckRuntimeError(
          "factcheck_timeout",
          "The fact-check script did not finish within the time limit.",
          504,
        );
      }
      await delay(100, input.signal);
      job = await control.inspect(jobAuthority, job.jobId);
      if (!isFactcheckJob(job, jobAuthority)) {
        throw new Error("Runtime returned a job outside the Factcheck worker contract.");
      }
    }
    if (job.state !== "succeeded") throw terminalError(job);
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    if (output.jobId !== job.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another Factcheck job.");
    }
    const result = validateEnvelope(job, output.content);
    if (
      result.ok === false &&
      exactKeys(result, ["ok", "operation", "errorCode", "message"]) &&
      result.operation === "command" &&
      typeof result.errorCode === "string" &&
      /^[a-z][a-z0-9_]{0,127}$/u.test(result.errorCode) &&
      typeof result.message === "string" &&
      result.message.trim() === result.message &&
      result.message.length > 0 &&
      Buffer.byteLength(result.message, "utf8") <= 32 * 1024 &&
      !/\p{Cc}/u.test(result.message)
    ) throw new FactcheckRuntimeError(
      result.errorCode,
      result.message,
      statusForCode(result.errorCode),
    );
    if (!validRunResult(result, args)) {
      throw new Error("Runtime returned invalid Factcheck command metadata.");
    }
    return {
      command: result.command,
      arguments: result.arguments,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      outputPath: result.outputPath,
      outputBytes: result.outputBytes,
      preview: result.preview,
      truncated: result.truncated,
      stderr: result.stderr,
    };
  } catch (error) {
    if (
      job &&
      !cancellationForwarded &&
      input.signal?.aborted &&
      !TERMINAL_STATES.has(job.state)
    ) {
      cancellationForwarded = true;
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
      throw new FactcheckRuntimeError(
        "factcheck_cancelled",
        "The fact-check script was cancelled with the current chat turn.",
        409,
      );
    }
    if (!job && input.signal?.aborted) {
      await control.cancelByIdempotencyKey(jobAuthority, idempotencyKey).catch(() => undefined);
      throw new FactcheckRuntimeError(
        "factcheck_cancelled",
        "The fact-check script was cancelled with the current chat turn.",
        409,
      );
    }
    if (error instanceof RuntimeJobControlError) throw controlError(error);
    throw error;
  }
}

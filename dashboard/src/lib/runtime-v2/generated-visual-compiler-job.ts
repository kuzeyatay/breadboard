import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type {
  GeneratedVisualCompilation,
} from "../generated-visuals.ts";
import type { VisualizationOpportunity } from "../visualization-opportunities.ts";
import {
  cancelRuntimeJob,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";

const PROTOCOL_VERSION = 1;
const POLL_MS = 100;
const MAX_OPERATION_MS = 120_000;
const MAX_SOURCE_CHARACTERS = 60_000;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface GeneratedVisualCompilerRuntimeControl {
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

const DEFAULT_CONTROL: GeneratedVisualCompilerRuntimeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function assertSnapshot(
  snapshot: RuntimeJobSnapshot,
  authority: RuntimeJobAuthority,
): void {
  if (
    snapshot.jobType !== "generated-visual-compile" ||
    snapshot.workerKind !== "generated-visual-compiler-node" ||
    snapshot.resourceClass !== "document-processing" ||
    snapshot.gardenId !== authority.gardenId ||
    snapshot.conversationId !== null
  ) throw new Error("Runtime returned a job outside the generated-visual compiler contract.");
}

function validValidation(value: unknown): boolean {
  return isRecord(value) &&
    exactKeys(value, [
      "valid", "checkedAt", "astNodeCount", "sourceBytes", "imports", "errors", "warnings",
    ]) &&
    typeof value.valid === "boolean" &&
    typeof value.checkedAt === "string" &&
    Number.isSafeInteger(value.astNodeCount) && Number(value.astNodeCount) >= 0 &&
    Number.isSafeInteger(value.sourceBytes) && Number(value.sourceBytes) >= 0 &&
    Array.isArray(value.imports) && value.imports.length <= 8 &&
    value.imports.every((entry) => typeof entry === "string" && entry.length <= 256) &&
    Array.isArray(value.errors) && value.errors.length <= 256 &&
    value.errors.every((entry) => typeof entry === "string" && entry.length <= 2_000) &&
    Array.isArray(value.warnings) && value.warnings.length <= 256 &&
    value.warnings.every((entry) => typeof entry === "string" && entry.length <= 2_000);
}

function validateCompilation(
  value: unknown,
  submittedSourceCode: string,
): GeneratedVisualCompilation {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "definition", "validation", "sourceHash", "compiledHash", "compiledJavaScript", "cacheHit",
    ]) ||
    (value.definition !== null && !isRecord(value.definition)) ||
    !validValidation(value.validation) ||
    typeof value.sourceHash !== "string" || !/^[0-9a-f]{64}$/u.test(value.sourceHash) ||
    typeof value.compiledHash !== "string" ||
      (value.compiledHash !== "" && !/^[0-9a-f]{64}$/u.test(value.compiledHash)) ||
    typeof value.compiledJavaScript !== "string" ||
    Buffer.byteLength(value.compiledJavaScript, "utf8") > 4 * 1024 * 1024 ||
    typeof value.cacheHit !== "boolean"
  ) throw new Error("Runtime returned an invalid generated-visual compilation.");
  const validation = value.validation as {
    valid: boolean;
    sourceBytes: number;
  };
  const expectedSourceHash = createHash("sha256")
    .update(submittedSourceCode, "utf8")
    .digest("hex");
  const sourceBytes = Buffer.byteLength(submittedSourceCode, "utf8");
  const hasDefinition = value.definition !== null;
  const expectedCompiledJavaScript = hasDefinition
    ? `globalThis.__BREADBOARD_GENERATED_VISUAL__ = Object.freeze(${JSON.stringify(value.definition)});\n`
    : "";
  const expectedCompiledHash = expectedCompiledJavaScript
    ? createHash("sha256").update(expectedCompiledJavaScript, "utf8").digest("hex")
    : "";
  if (
    value.sourceHash !== expectedSourceHash ||
    validation.sourceBytes !== sourceBytes ||
    validation.valid !== hasDefinition ||
    value.compiledJavaScript !== expectedCompiledJavaScript ||
    value.compiledHash !== expectedCompiledHash
  ) {
    throw new Error(
      "Runtime returned a generated-visual compilation that does not match its submitted source.",
    );
  }
  return value as unknown as GeneratedVisualCompilation;
}

function validateEnvelope(
  job: RuntimeJobSnapshot,
  value: unknown,
  submittedSourceCode: string,
): GeneratedVisualCompilation {
  if (!isRecord(value) || !exactKeys(value, [
    "protocolVersion", "identity", "completionSequence", "result",
  ])) throw new Error("Runtime returned an invalid generated-visual compiler envelope.");
  const identity = value.identity;
  if (
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.completionSequence !== job.lastWorkerSequence ||
    !isRecord(identity) ||
    !exactKeys(identity, ["jobId", "attempt", "workerInstanceId"]) ||
    identity.jobId !== job.jobId ||
    identity.attempt !== job.attempt ||
    identity.workerInstanceId !== job.workerInstanceId
  ) throw new Error("Runtime returned generated-visual output outside its worker fence.");
  return validateCompilation(value.result, submittedSourceCode);
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

export async function compileGeneratedVisualizationViaRuntime(input: {
  userId: number;
  gardenId: string;
  sourceCode: string;
  opportunity: VisualizationOpportunity;
  signal?: AbortSignal;
  control?: GeneratedVisualCompilerRuntimeControl;
}): Promise<GeneratedVisualCompilation> {
  if (!Number.isSafeInteger(input.userId) || input.userId < 1) {
    throw new TypeError("Generated-visual compiler user scope is invalid.");
  }
  if (
    typeof input.gardenId !== "string" ||
    !input.gardenId.trim() ||
    input.gardenId !== input.opportunity.gardenId ||
    Buffer.byteLength(input.gardenId, "utf8") > 256
  ) throw new TypeError("Generated-visual compiler garden scope is invalid.");
  if (
    typeof input.sourceCode !== "string" ||
    input.sourceCode.length === 0 ||
    input.sourceCode.length > MAX_SOURCE_CHARACTERS
  ) throw new TypeError("Generated-visual compiler source is invalid.");
  if (input.signal?.aborted) {
    throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  const authority: RuntimeJobAuthority = {
    userId: input.userId,
    gardenId: input.gardenId,
    conversationId: null,
  };
  const control = input.control ?? DEFAULT_CONTROL;
  const digest = createHash("sha256")
    .update(input.sourceCode, "utf8")
    .update("\0", "utf8")
    .update(input.opportunity.id, "utf8")
    .digest("hex");
  let snapshot: RuntimeJobSnapshot | null = null;
  try {
    snapshot = await control.submit(authority, {
      jobType: "generated-visual-compile",
      idempotencyKey: `generated-visual-compile-v2:${digest}:${randomUUID()}`,
      requestPayload: {
        protocolVersion: PROTOCOL_VERSION,
        operation: "compile-generated-visual",
        sourceCode: input.sourceCode,
        opportunity: input.opportunity,
      },
    });
    assertSnapshot(snapshot, authority);
    const deadline = Date.now() + MAX_OPERATION_MS;
    while (!TERMINAL_STATES.has(snapshot.state)) {
      if (Date.now() >= deadline) {
        await control.cancel(authority, snapshot.jobId).catch(() => undefined);
        throw new Error("Generated-visual compilation timed out.");
      }
      await delay(POLL_MS, input.signal);
      snapshot = await control.inspect(authority, snapshot.jobId);
      assertSnapshot(snapshot, authority);
    }
    if (snapshot.state !== "succeeded") {
      throw new Error(`Generated-visual compiler worker ended as ${snapshot.state}.`);
    }
    const output = await control.readOutput(authority, snapshot.jobId, "result");
    if (output.jobId !== snapshot.jobId || output.kind !== "result") {
      throw new Error("Runtime returned output for another generated-visual compiler job.");
    }
    return validateEnvelope(snapshot, output.content, input.sourceCode);
  } catch (error) {
    if (snapshot && input.signal?.aborted && !TERMINAL_STATES.has(snapshot.state)) {
      await control.cancel(authority, snapshot.jobId).catch(() => undefined);
    }
    throw error;
  }
}

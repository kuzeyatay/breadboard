if (typeof window !== "undefined") {
  throw new Error("Runtime V2 ingestion compatibility is server-only.");
}

import { emptyIngestTokenUsage, type IngestTokenUsage } from "@/lib/ingest-token-usage";
import {
  RuntimeJobControlError,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  replayRuntimeJobEvents,
  type RuntimeJobAuthority,
  type RuntimeJobEventRecord,
  type RuntimeJobSnapshot,
  type RuntimePublicStage,
  type RuntimeResourceExhaustionEvidence,
} from "@/lib/supervisor-control";

const POLL_INTERVAL_MS = 200;
const SSE_KEEPALIVE_INTERVAL_MS = 15_000;
const MAX_CHECKPOINT_STEP_BYTES = 4 * 1024;
const MAX_RESULT_STRING_BYTES = 64 * 1024;
const MAX_RESULT_TOPICS = 10_000;
const SANITIZED_RUNTIME_FAILURE_MESSAGE = "Runtime job execution failed.";
const PUBLIC_INGEST_VISION_WARNING =
  "Vision processing was incomplete for this document.";
const PUBLIC_INGEST_DOCUMENT_WARNING =
  "Some document content or page previews could not be processed.";
const PUBLIC_INGEST_MAP_WARNING =
  "Map generation failed, so the source was saved without extracted lesson topics. You can retry with Learn after upload.";
const RESULT_SAFETY_VERDICTS = new Set(["suspicious", "review", "notes", "clean"]);
const RESULT_SAFETY_SEVERITIES = new Set(["critical", "warning", "info"]);
const TERMINAL_JOB_STATES = new Set([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const CHECKPOINT_STAGES = new Set<RuntimePublicStage>([
  "preparing",
  "working",
  "generating",
  "waiting-external",
  "processing",
  "persisting",
  "finalizing",
  "cancelling",
]);

type WorkerFence = {
  readonly jobId: string;
  readonly attempt: number;
  readonly workerInstanceId: string;
};

type ParsedCheckpoint = {
  readonly revision: number;
  readonly updatedAt: number;
  readonly step: string;
  readonly tokenUsage: IngestTokenUsage | null;
  readonly failure: { readonly error: string; readonly visionError: string | null } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    new TextEncoder().encode(value).byteLength <= maximumBytes
  );
}

function safeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function sameIdentity(value: unknown, fence: WorkerFence): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["jobId", "attempt", "workerInstanceId"]) &&
    value.jobId === fence.jobId &&
    value.attempt === fence.attempt &&
    value.workerInstanceId === fence.workerInstanceId
  );
}

const TOKEN_USAGE_NUMBERS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens",
  "reasoningTokens",
  "startedCalls",
  "completedCalls",
  "reportedCalls",
  "unreportedCalls",
  "inFlightCalls",
] as const;

function parseTokenUsage(value: unknown, model: string | null): IngestTokenUsage {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [...TOKEN_USAGE_NUMBERS, "estimated", "model"]) ||
    !boundedText(value.model, 256) ||
    (model !== null && value.model !== model) ||
    typeof value.estimated !== "boolean" ||
    TOKEN_USAGE_NUMBERS.some((field) => !safeNonnegativeInteger(value[field]))
  ) {
    throw new Error("Runtime returned an invalid ingestion token-usage checkpoint.");
  }
  return value as unknown as IngestTokenUsage;
}

function parseCheckpoint(
  content: unknown,
  fence: WorkerFence,
  model: string | null,
): ParsedCheckpoint {
  if (
    !isRecord(content) ||
    !hasExactKeys(content, [
      "protocolVersion",
      "identity",
      "stage",
      "step",
      "tokenUsage",
      "failure",
      "revision",
      "updatedAt",
    ]) ||
    content.protocolVersion !== 1 ||
    !sameIdentity(content.identity, fence) ||
    !CHECKPOINT_STAGES.has(content.stage as RuntimePublicStage) ||
    !boundedText(content.step, MAX_CHECKPOINT_STEP_BYTES) ||
    content.step.length === 0 ||
    !safePositiveInteger(content.revision) ||
    !safePositiveInteger(content.updatedAt)
  ) {
    throw new Error("Runtime returned an invalid ingestion checkpoint envelope.");
  }
  let failure: ParsedCheckpoint["failure"] = null;
  if (content.failure !== null) {
    if (
      !isRecord(content.failure) ||
      !hasExactKeys(content.failure, ["error", "visionError"]) ||
      content.failure.error !== SANITIZED_RUNTIME_FAILURE_MESSAGE ||
      (content.failure.visionError !== null &&
        content.failure.visionError !== PUBLIC_INGEST_VISION_WARNING)
    ) {
      throw new Error("Runtime returned an invalid ingestion failure checkpoint.");
    }
    failure = {
      error: content.failure.error,
      visionError: content.failure.visionError,
    };
  }
  return {
    revision: content.revision,
    updatedAt: content.updatedAt,
    step: content.step,
    tokenUsage: content.tokenUsage === null
      ? null
      : parseTokenUsage(content.tokenUsage, model),
    failure,
  };
}

const RESULT_KEYS = new Set([
  "success",
  "duplicate",
  "filename",
  "slug",
  "sourceRelPath",
  "wordCount",
  "topicCount",
  "imageCount",
  "figureCount",
  "visionError",
  "screenshotWarning",
  "mapGenerationWarning",
  "hiddenContentWarning",
  "hiddenContentVerdict",
  "hiddenContentFindings",
  "mapGenerated",
  "topics",
  "durationMs",
  "tokenUsage",
]);

function optionalBoundedText(value: unknown): boolean {
  return value === undefined || boundedText(value, MAX_RESULT_STRING_BYTES);
}

function optionalExactText(value: unknown, expected: string): boolean {
  return value === undefined || value === expected;
}

function validResultTopic(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["slug", "title", "locations", "action"]) &&
    boundedText(value.slug, 512) &&
    value.slug.length > 0 &&
    boundedText(value.title, MAX_RESULT_STRING_BYTES) &&
    value.title.length > 0 &&
    Array.isArray(value.locations) &&
    value.locations.length <= MAX_RESULT_TOPICS &&
    value.locations.every((location) => boundedText(location, MAX_RESULT_STRING_BYTES)) &&
    (value.action === "created" || value.action === "merged")
  );
}

function validSafetyFinding(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["severity", "type", "where", "detail"]) &&
    RESULT_SAFETY_SEVERITIES.has(value.severity as string) &&
    boundedText(value.type, MAX_RESULT_STRING_BYTES) &&
    boundedText(value.where, MAX_RESULT_STRING_BYTES) &&
    boundedText(value.detail, MAX_RESULT_STRING_BYTES)
  );
}

function parseIngestionResult(value: unknown, model: string | null): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !RESULT_KEYS.has(key)) ||
    value.success !== true ||
    !boundedText(value.filename, 512) ||
    !boundedText(value.slug, 512) ||
    !boundedText(value.sourceRelPath, 4 * 1024) ||
    !safeNonnegativeInteger(value.wordCount) ||
    !safeNonnegativeInteger(value.topicCount) ||
    !safeNonnegativeInteger(value.imageCount) ||
    typeof value.mapGenerated !== "boolean" ||
    !safeNonnegativeInteger(value.durationMs) ||
    (value.duplicate !== undefined && typeof value.duplicate !== "boolean") ||
    (value.figureCount !== undefined && !safeNonnegativeInteger(value.figureCount)) ||
    !optionalExactText(value.visionError, PUBLIC_INGEST_VISION_WARNING) ||
    !optionalExactText(value.screenshotWarning, PUBLIC_INGEST_DOCUMENT_WARNING) ||
    !optionalExactText(value.mapGenerationWarning, PUBLIC_INGEST_MAP_WARNING) ||
    !optionalBoundedText(value.hiddenContentWarning) ||
    (value.hiddenContentVerdict !== undefined &&
      !RESULT_SAFETY_VERDICTS.has(value.hiddenContentVerdict as string)) ||
    (value.topics !== undefined &&
      (!Array.isArray(value.topics) ||
        value.topics.length > MAX_RESULT_TOPICS ||
        value.topics.length !== value.topicCount ||
        !value.topics.every(validResultTopic))) ||
    (value.hiddenContentFindings !== undefined &&
      (!Array.isArray(value.hiddenContentFindings) ||
        value.hiddenContentFindings.length > MAX_RESULT_TOPICS ||
        !value.hiddenContentFindings.every(validSafetyFinding)))
  ) {
    throw new Error("Runtime returned an invalid ingestion result payload.");
  }
  parseTokenUsage(value.tokenUsage, model);
  return value;
}

function parseResultEnvelope(
  content: unknown,
  fence: WorkerFence,
  completionSequence: number,
  model: string | null,
): Record<string, unknown> {
  if (
    !isRecord(content) ||
    !hasExactKeys(content, [
      "protocolVersion",
      "identity",
      "completionSequence",
      "result",
    ]) ||
    content.protocolVersion !== 1 ||
    !sameIdentity(content.identity, fence) ||
    content.completionSequence !== completionSequence
  ) {
    throw new Error("Runtime returned an invalid ingestion result envelope.");
  }
  return parseIngestionResult(content.result, model);
}

function checkpointFence(event: RuntimeJobEventRecord): WorkerFence | null {
  if (
    event.eventType !== "worker-checkpoint" ||
    event.attempt < 1 ||
    !event.workerInstanceId ||
    event.workerSequence === null
  ) {
    return null;
  }
  return {
    jobId: event.jobId,
    attempt: event.attempt,
    workerInstanceId: event.workerInstanceId,
  };
}

function isCurrentFence(fence: WorkerFence, job: RuntimeJobSnapshot): boolean {
  return (
    fence.jobId === job.jobId &&
    fence.attempt === job.attempt &&
    fence.workerInstanceId === job.workerInstanceId
  );
}

function completionFence(event: RuntimeJobEventRecord): {
  fence: WorkerFence;
  sequence: number;
} | null {
  if (
    event.eventType !== "worker-complete" ||
    event.attempt < 1 ||
    !event.workerInstanceId ||
    event.workerSequence === null
  ) {
    return null;
  }
  return {
    fence: {
      jobId: event.jobId,
      attempt: event.attempt,
      workerInstanceId: event.workerInstanceId,
    },
    sequence: event.workerSequence,
  };
}

function eventResourceExhaustion(
  event: RuntimeJobEventRecord,
): RuntimeResourceExhaustionEvidence | null {
  return event.eventType === "job-resource-exhausted" &&
    "resourceExhaustion" in event.payload
    ? event.payload.resourceExhaustion
    : null;
}

function formatHeadroom(megabytes: number): string {
  const gigabytes = megabytes / 1024;
  return `${gigabytes.toFixed(gigabytes >= 10 ? 0 : 1)} GB`;
}

/**
 * Runtime deliberately sanitizes its terminal message, and a memory denial
 * (the job itself, or the local VLM OCR service it leases) would otherwise
 * reach the upload dialog as "Runtime job execution failed." — nothing a person
 * can act on. The headroom evidence is closed runtime output, so it is safe to
 * show, and "Parse with VLM" is the one upload option that leases a multi-GB
 * local model, so it is named when it was on.
 */
function resourceExhaustedUploadMessage(
  evidence: RuntimeResourceExhaustionEvidence | null,
  parseWithVlm: boolean,
): string {
  const headroom = evidence
    ? `Windows could not reserve enough memory to process this upload ` +
      `(${formatHeadroom(evidence.requiredHeadroomMb)} required, ` +
      `${formatHeadroom(evidence.availableHeadroomMb)} available).`
    : "The Runtime could not reserve enough memory to process this upload.";
  const remedy = parseWithVlm
    ? " The local VLM OCR model needs several GB of free memory on top of the " +
      "Runtime's reserve — close memory-heavy apps or increase the Windows " +
      "paging file and retry, or upload again with \"Parse with VLM\" off."
    : " Close memory-heavy apps or increase the Windows paging file, then retry.";
  return headroom + remedy;
}

function terminalErrorEvent(
  job: RuntimeJobSnapshot,
  tokenUsage: IngestTokenUsage,
  elapsedMs: number,
  failure: ParsedCheckpoint["failure"],
  replayResourceExhaustion: RuntimeResourceExhaustionEvidence | null,
  parseWithVlm: boolean,
): Record<string, unknown> {
  if (job.state === "cancelled") {
    return {
      type: "error",
      error: "Upload canceled",
      canceled: true,
      tokenUsage,
    };
  }
  const resourceExhaustion =
    job.resourceExhaustion ?? replayResourceExhaustion;
  const error =
    job.state === "resource_exhausted"
      ? resourceExhaustedUploadMessage(resourceExhaustion, parseWithVlm)
      : failure?.error || job.failureMessage || "Upload failed";
  return {
    type: "error",
    error,
    ...(job.state === "resource_exhausted"
      ? {
          code: "BREADBOARD_RESOURCE_EXHAUSTED",
          ...(resourceExhaustion ?? { retryable: false }),
        }
      : {}),
    durationMs: elapsedMs,
    tokenUsage,
    ...(failure?.visionError ? { visionError: failure.visionError } : {}),
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function runtimeControlErrorEvent(
  error: unknown,
  model: string,
  elapsedMs: number,
): Record<string, unknown> {
  const tokenUsage = { ...emptyIngestTokenUsage(), model };
  if (error instanceof RuntimeJobControlError) {
    return {
      type: "error",
      error: error.message,
      ...(error.code === "BREADBOARD_RESOURCE_EXHAUSTED"
        ? {
            code: error.code,
            resource: error.resource,
            requiredHeadroomMb: error.requiredHeadroomMb,
            availableHeadroomMb: error.availableHeadroomMb,
            retryable: false,
          }
        : {}),
      durationMs: elapsedMs,
      tokenUsage,
    };
  }
  return {
    type: "error",
    error: "Upload failed",
    durationMs: elapsedMs,
    tokenUsage,
  };
}

export function createIngestErrorSseResponse(event: Record<string, unknown>): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { headers: ingestSseHeaders() },
  );
}

function ingestSseHeaders(
  jobId?: string,
  metadata?: {
    readonly model: string | null;
    readonly startedAt: number;
    readonly state: RuntimeJobSnapshot["state"];
  },
): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...(jobId ? { "X-Breadboard-Runtime-Job-Id": jobId } : {}),
    ...(metadata?.model === null || metadata?.model === undefined
      ? {}
      : { "X-Breadboard-Ingest-Model": encodeURIComponent(metadata.model) }),
    ...(metadata
      ? {
          "X-Breadboard-Ingest-Started-At": String(metadata.startedAt),
          "X-Breadboard-Runtime-Job-State": metadata.state,
        }
      : {}),
  };
}

export function createRuntimeIngestSseResponse(input: {
  readonly authority: RuntimeJobAuthority;
  readonly job: RuntimeJobSnapshot;
  readonly model: string | null;
  readonly startedAt: number;
  /** Whether the upload asked for the local VLM OCR service; names it on a memory denial. */
  readonly parseWithVlm?: boolean;
  readonly control?: {
    readonly replay: typeof replayRuntimeJobEvents;
    readonly inspect: typeof inspectRuntimeJob;
    readonly readOutput: typeof readRuntimeJobOutput;
    readonly wait?: (milliseconds: number) => Promise<void>;
    readonly now?: () => number;
    readonly keepAliveIntervalMs?: number;
  };
}): Response {
  const encoder = new TextEncoder();
  let disconnected = false;
  const runtimeControl = input.control ?? {
    replay: replayRuntimeJobEvents,
    inspect: inspectRuntimeJob,
    readOutput: readRuntimeJobOutput,
  };
  const wait = input.control?.wait ?? delay;
  const now = input.control?.now ?? Date.now;
  const keepAliveIntervalMs =
    input.control?.keepAliveIntervalMs ?? SSE_KEEPALIVE_INTERVAL_MS;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastFrameAt = now();
      let cursor = 0;
      let job = input.job;
      let latestCheckpointRevision = 0;
      let latestStep = "";
      let latestUsageJson = "";
      let resolvedModel = input.model;
      let tokenUsage: IngestTokenUsage = {
        ...emptyIngestTokenUsage(),
        model: input.model ?? "",
      };
      let failure: ParsedCheckpoint["failure"] = null;
      let replayResourceExhaustion: RuntimeResourceExhaustionEvidence | null = null;
      let checkpointed: WorkerFence | null = null;
      let completed: ReturnType<typeof completionFence> = null;
      const enqueue = (frame: string) => {
        if (closed || disconnected) return;
        try {
          controller.enqueue(encoder.encode(frame));
          lastFrameAt = now();
        } catch {
          disconnected = true;
        }
      };
      const send = (event: Record<string, unknown>) => {
        enqueue(`data: ${JSON.stringify(event)}\n\n`);
      };
      const sendKeepAliveIfIdle = () => {
        if (now() - lastFrameAt >= keepAliveIntervalMs) {
          enqueue(": keep-alive\n\n");
        }
      };
      const drainReplay = async (): Promise<boolean> => {
        let terminal = false;
        let replay;
        do {
          replay = await runtimeControl.replay(
            input.authority,
            input.job.jobId,
            cursor,
            100,
          );
          cursor = replay.nextAfter;
          terminal = replay.terminal;
          for (const event of replay.events) {
            checkpointed = checkpointFence(event) ?? checkpointed;
            completed = completionFence(event) ?? completed;
            replayResourceExhaustion =
              eventResourceExhaustion(event) ?? replayResourceExhaustion;
          }
        } while (replay.hasMore && !disconnected);
        return terminal;
      };
      try {
        while (!disconnected) {
          sendKeepAliveIfIdle();
          await drainReplay();
          job = await runtimeControl.inspect(input.authority, input.job.jobId);
          if (TERMINAL_JOB_STATES.has(job.state)) {
            // Inspect and replay are separate authenticated reads. Drain once
            // more after the terminal snapshot so an event committed between
            // the first replay and inspect cannot be skipped.
            let replayTerminal = false;
            while (!replayTerminal && !disconnected) {
              replayTerminal = await drainReplay();
              if (!replayTerminal && !disconnected) {
                await wait(POLL_INTERVAL_MS);
                sendKeepAliveIfIdle();
              }
            }
          }
          // The worker atomically installs the first checkpoint before it
          // publishes worker-checkpoint. Reading from assignment alone races
          // that install on Windows and can turn a transient sharing conflict
          // into a false terminal upload failure.
          const fence = checkpointed && isCurrentFence(checkpointed, job)
            ? checkpointed
            : null;
          if (fence) {
            try {
              const output = await runtimeControl.readOutput(
                input.authority,
                input.job.jobId,
                "checkpoint",
              );
              const checkpoint = parseCheckpoint(
                output.content,
                fence,
                resolvedModel,
              );
              if (checkpoint.revision > latestCheckpointRevision) {
                latestCheckpointRevision = checkpoint.revision;
                if (checkpoint.step !== latestStep) {
                  latestStep = checkpoint.step;
                  send({
                    type: "progress",
                    step: checkpoint.step,
                    elapsedMs: Date.now() - input.startedAt,
                  });
                }
                if (checkpoint.tokenUsage) {
                  resolvedModel ??= checkpoint.tokenUsage.model ?? null;
                  tokenUsage = checkpoint.tokenUsage;
                }
                if (checkpoint.tokenUsage && checkpoint.tokenUsage.startedCalls > 0) {
                  const usageJson = JSON.stringify(checkpoint.tokenUsage);
                  if (usageJson !== latestUsageJson) {
                    latestUsageJson = usageJson;
                    send({ type: "usage", tokenUsage });
                  }
                }
                failure = checkpoint.failure ?? failure;
              }
            } catch (error) {
              if (!(error instanceof RuntimeJobControlError) ||
                  error.code !== "JOB_OUTPUT_NOT_READY") {
                throw error;
              }
            }
          }

          if (TERMINAL_JOB_STATES.has(job.state)) break;
          await wait(POLL_INTERVAL_MS);
        }

        if (disconnected) return;
        if (job.state === "succeeded") {
          const finalCompletion = completed as {
            fence: WorkerFence;
            sequence: number;
          } | null;
          if (!finalCompletion) {
            throw new Error("Runtime completed ingestion without a fenced completion event.");
          }
          const output = await runtimeControl.readOutput(
            input.authority,
            input.job.jobId,
            "result",
          );
          const result = parseResultEnvelope(
            output.content,
            finalCompletion.fence,
            finalCompletion.sequence,
            resolvedModel,
          );
          send({ type: "result", ...result });
        } else {
          send(
            terminalErrorEvent(
              job,
              tokenUsage,
              Date.now() - input.startedAt,
              failure,
              replayResourceExhaustion,
              input.parseWithVlm === true,
            ),
          );
        }
      } catch (error) {
        if (!disconnected) {
          send(
            runtimeControlErrorEvent(
              error,
              resolvedModel ?? "",
              Date.now() - input.startedAt,
            ),
          );
        }
      } finally {
        if (!disconnected) {
          try {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {
            // The durable job continues after its viewer disconnects.
          }
        }
        closed = true;
      }
    },
    cancel() {
      disconnected = true;
    },
  });
  return new Response(stream, {
    headers: ingestSseHeaders(input.job.jobId, {
      model: input.model,
      startedAt: input.startedAt,
      state: input.job.state,
    }),
  });
}

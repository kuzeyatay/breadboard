import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import {
  cancelRuntimeJob,
  inspectRuntimeJob,
  isRuntimeV2ServiceControlConfigured,
  readRuntimeJobOutput,
  RuntimeJobControlError,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
} from "../supervisor-control.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { RuntimeAuthorityUnavailableError } from "../runtime-v2/authority-error.ts";

const JOB_TYPE = "agent-edits";
const WORKER_KIND = "agent-edits-node";
const RESOURCE_CLASS = "document-processing";
const MAX_OPERATION_MS = 14 * 60_000;
const POLL_MS = 500;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const SNAPSHOT_ID = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TERMINAL = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface AgentEditsRef {
  before: string;
  after: string;
}

export type AgentEditStatus = "added" | "modified" | "deleted";

export interface AgentEditFile {
  path: string;
  status: AgentEditStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface AgentEditsSummary {
  files: AgentEditFile[];
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface AgentEditsUndoResult {
  restored: string[];
  skipped: string[];
}

export type AgentEditsOperation = "summary" | "finalize" | "patch" | "undo";

export interface AgentEditsArtifact {
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly mediaType: "application/json";
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

export function isSnapshotId(value: unknown): value is string {
  return typeof value === "string" && SNAPSHOT_ID.test(value);
}

function validRef(value: unknown): value is AgentEditsRef {
  return isRecord(value) &&
    exactKeys(value, ["before", "after"]) &&
    isSnapshotId(value.before) &&
    isSnapshotId(value.after);
}

export function agentEditsFromRunEvents(
  events: readonly { type: string; payload: Record<string, unknown> }[],
): AgentEditsRef | null {
  const terminal = events.findLast((event) =>
    ["run.completed", "run.failed", "run.aborted"].includes(event.type),
  );
  return validRef(terminal?.payload.edits) ? terminal.payload.edits : null;
}

function authority(userId: number, repositoryPath: string): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("Agent-edits Runtime user authority is invalid.");
  }
  const scope = createHash("sha256")
    .update(`${userId}\0${path.resolve(repositoryPath)}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return { userId, gardenId: null, conversationId: `agent_edits_${scope}` };
}

function requireJob(
  job: RuntimeJobSnapshot,
  expectedAuthority: RuntimeJobAuthority,
): RuntimeJobSnapshot {
  if (
    job.jobType !== JOB_TYPE ||
    job.workerKind !== WORKER_KIND ||
    job.resourceClass !== RESOURCE_CLASS ||
    job.gardenId !== expectedAuthority.gardenId ||
    job.conversationId !== expectedAuthority.conversationId
  ) throw new Error("Runtime returned a job outside the sealed agent-edits scope.");
  return job;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    const abort = () => done(signal.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function parseResult(
  job: RuntimeJobSnapshot,
  operation: AgentEditsOperation,
  content: unknown,
): Promise<AgentEditsArtifact> {
  if (
    !isRecord(content) ||
    !exactKeys(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== 1 ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) ||
    !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result) ||
    !exactKeys(content.result, [
      "operation",
      "artifactRelativePath",
      "sizeBytes",
      "sha256",
      "mediaType",
    ]) ||
    content.result.operation !== operation ||
    content.result.mediaType !== "application/json" ||
    typeof content.result.artifactRelativePath !== "string" ||
    !Number.isSafeInteger(content.result.sizeBytes) ||
    (content.result.sizeBytes as number) < 1 ||
    (content.result.sizeBytes as number) > MAX_ARTIFACT_BYTES ||
    typeof content.result.sha256 !== "string" ||
    !SHA256.test(content.result.sha256)
  ) throw new Error("Runtime returned an invalid fenced agent-edits result.");

  const expectedRelative = [
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "agent-edits-response.json",
  ].join("/");
  if (content.result.artifactRelativePath !== expectedRelative) {
    throw new Error("Runtime returned an agent-edits artifact outside its fenced workspace.");
  }
  const root = path.resolve(dashboardDataDir());
  const filePath = path.resolve(root, ...expectedRelative.split("/"));
  const metadata = fs.lstatSync(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== content.result.sizeBytes
  ) throw new Error("The Runtime agent-edits artifact is unavailable.");
  if (!samePath(fs.realpathSync.native(filePath), filePath)) {
    throw new Error("The Runtime agent-edits artifact is indirect.");
  }
  if ((await sha256File(filePath)) !== content.result.sha256) {
    throw new Error("The Runtime agent-edits artifact failed integrity validation.");
  }
  const revalidated = fs.lstatSync(filePath);
  if (!revalidated.isFile() || revalidated.isSymbolicLink() || revalidated.size !== metadata.size) {
    throw new Error("The Runtime agent-edits artifact changed during validation.");
  }
  return {
    filePath,
    sizeBytes: metadata.size,
    mediaType: "application/json",
  };
}

export function streamAgentEditsArtifact(artifact: AgentEditsArtifact): Response {
  const metadata = fs.lstatSync(artifact.filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== artifact.sizeBytes
  ) throw new Error("The Runtime agent-edits artifact is no longer available.");
  const body = Readable.toWeb(fs.createReadStream(artifact.filePath)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "content-type": `${artifact.mediaType}; charset=utf-8`,
      "content-length": String(artifact.sizeBytes),
      "cache-control": "no-store",
    },
  });
}

export async function runAgentEditsOperation(input: {
  userId: number;
  operation: AgentEditsOperation;
  repositoryPath: string;
  ref: AgentEditsRef;
  filePath?: string;
  signal?: AbortSignal;
}): Promise<AgentEditsArtifact> {
  if (!isRuntimeV2ServiceControlConfigured()) {
    throw new RuntimeAuthorityUnavailableError(
      "Agent edit inspection requires the Breadboard Runtime job owner.",
    );
  }
  if (!validRef(input.ref)) throw new TypeError("The agent-edits snapshot pair is invalid.");
  if (input.operation === "patch" && !input.filePath) {
    throw new TypeError("The agent-edits patch path is required.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Agent-edits operation timed out", "TimeoutError")),
    MAX_OPERATION_MS,
  );
  timeout.unref?.();
  const forwardAbort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });
  const jobAuthority = authority(input.userId, input.repositoryPath);
  const requestPayload = {
    operation: input.operation,
    repositoryPath: path.resolve(input.repositoryPath),
    before: input.ref.before,
    after: input.ref.after,
    ...(input.operation === "patch" ? { filePath: input.filePath } : {}),
  };
  const requestDigest = createHash("sha256")
    .update(JSON.stringify(requestPayload), "utf8")
    .digest("hex");
  let jobId: string | null = null;
  try {
    let job = requireJob(
      await submitRuntimeJob(jobAuthority, {
        jobType: JOB_TYPE,
        idempotencyKey: `agent-edits-v2:${input.userId}:${requestDigest}:${
          input.operation === "undo" ? "once" : randomUUID()
        }`,
        requestPayload,
      }),
      jobAuthority,
    );
    jobId = job.jobId;
    while (!TERMINAL.has(job.state)) {
      await delay(POLL_MS, controller.signal);
      job = requireJob(
        await inspectRuntimeJob(jobAuthority, job.jobId),
        jobAuthority,
      );
    }
    if (job.state !== "succeeded") {
      if (job.state === "resource_exhausted" && job.resourceExhaustion) {
        const evidence = job.resourceExhaustion;
        throw new RuntimeJobControlError({
          code: "BREADBOARD_RESOURCE_EXHAUSTED",
          message: "Windows commit headroom is too low for this repository operation.",
          status: 503,
          resource: evidence.resource,
          requiredHeadroomMb: evidence.requiredHeadroomMb,
          availableHeadroomMb: evidence.availableHeadroomMb,
        });
      }
      throw new Error(
        job.state === "cancelled"
          ? "The agent-edits operation was cancelled."
          : job.failureMessage ?? `The agent-edits Runtime job ended as ${job.state}.`,
      );
    }
    return parseResult(
      job,
      input.operation,
      (await readRuntimeJobOutput(jobAuthority, job.jobId, "result")).content,
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

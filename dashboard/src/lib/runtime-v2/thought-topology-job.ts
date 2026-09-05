import "server-only";

import {
  inspectRuntimeJob,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";
import type { ThoughtTopologyBuildResult } from "../thought-topology/builder.ts";
import type { TopologyQueueSubmission } from "../thought-topology/state.ts";

const TERMINAL = new Set<RuntimeJobSnapshot["state"]>(["cancelled", "succeeded", "failed", "resource_exhausted", "interrupted", "uncertain"]);

export interface ThoughtTopologyRuntimeControl {
  submit(authority: RuntimeJobAuthority, submission: RuntimeJobSubmission): Promise<RuntimeJobSnapshot>;
  inspect(authority: RuntimeJobAuthority, jobId: string): Promise<RuntimeJobSnapshot>;
  readOutput(authority: RuntimeJobAuthority, jobId: string, kind: RuntimeJobOutput["kind"]): Promise<RuntimeJobOutput>;
}

const DEFAULT_CONTROL: ThoughtTopologyRuntimeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
};

export class ThoughtTopologyRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ThoughtTopologyRuntimeError";
  }
}

function assertSnapshot(snapshot: RuntimeJobSnapshot, authority: RuntimeJobAuthority): void {
  if (
    snapshot.jobType !== "thought-topology" ||
    snapshot.workerKind !== "thought-topology-node" ||
    snapshot.resourceClass !== "document-processing" ||
    snapshot.gardenId !== authority.gardenId ||
    snapshot.conversationId !== null
  ) throw new ThoughtTopologyRuntimeError("invalid_runtime_job", "Runtime returned a job outside the Thought Topology contract.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateThoughtTopologyRuntimeEnvelope(
  snapshot: RuntimeJobSnapshot,
  value: unknown,
): ThoughtTopologyBuildResult {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "completionSequence,identity,protocolVersion,result") {
    throw new ThoughtTopologyRuntimeError("invalid_result", "Runtime returned an invalid Thought Topology envelope.");
  }
  const identity = value.identity;
  if (
    value.protocolVersion !== 1 ||
    value.completionSequence !== snapshot.lastWorkerSequence ||
    !isRecord(identity) ||
    Object.keys(identity).sort().join(",") !== "attempt,jobId,workerInstanceId" ||
    identity.jobId !== snapshot.jobId ||
    identity.attempt !== snapshot.attempt ||
    identity.workerInstanceId !== snapshot.workerInstanceId ||
    !isRecord(value.result)
  ) throw new ThoughtTopologyRuntimeError("invalid_result", "Runtime output failed its worker fence.");
  const result = value.result;
  const required = ["clusterId", "edges", "mode", "nodes", "revision", "status"];
  const optional = Object.hasOwn(result, "sourceRevision") ? ["sourceRevision"] : [];
  if (
    Object.keys(result).sort().join(",") !== [...required, ...optional].sort().join(",") ||
    !Number.isSafeInteger(result.clusterId) || Number(result.clusterId) < 1 ||
    !Number.isSafeInteger(result.revision) || Number(result.revision) < 1 ||
    !Number.isSafeInteger(result.nodes) || Number(result.nodes) < 0 ||
    !Number.isSafeInteger(result.edges) || Number(result.edges) < 0 ||
    !["built", "stale", "skipped"].includes(String(result.status)) ||
    !["semantic-vector", "concept-lexical", "disabled"].includes(String(result.mode)) ||
    (Object.hasOwn(result, "sourceRevision") && (typeof result.sourceRevision !== "string" || result.sourceRevision.length > 256))
  ) throw new ThoughtTopologyRuntimeError("invalid_result", "Runtime returned an invalid Thought Topology result.");
  return result as unknown as ThoughtTopologyBuildResult;
}

export async function startThoughtTopologyRuntimeJob(
  input: TopologyQueueSubmission & { control?: ThoughtTopologyRuntimeControl },
): Promise<{ authority: RuntimeJobAuthority; snapshot: RuntimeJobSnapshot }> {
  if (![input.userId, input.clusterId, input.revision, input.queueJobId].every((value) => Number.isSafeInteger(value) && value > 0) || !input.gardenId || input.gardenId.length > 256) {
    throw new TypeError("Thought Topology Runtime submission is invalid.");
  }
  const authority: RuntimeJobAuthority = { userId: input.userId, gardenId: input.gardenId, conversationId: null };
  const snapshot = await (input.control ?? DEFAULT_CONTROL).submit(authority, {
    jobType: "thought-topology",
    // A queued row coalesces Markdown changes until its worker starts, so its
    // durable queue identity—not a replaceable intermediate revision—is the
    // stable Runtime idempotency boundary.
    idempotencyKey: `thought-topology-v2:${input.clusterId}:queue:${input.queueJobId}`,
    requestPayload: {
      protocolVersion: 1,
      operation: "build-thought-topology",
      clusterId: input.clusterId,
      revision: input.revision,
      queueJobId: input.queueJobId,
    },
  });
  assertSnapshot(snapshot, authority);
  return { authority, snapshot };
}

export async function runThoughtTopologyViaRuntime(
  input: TopologyQueueSubmission & { control?: ThoughtTopologyRuntimeControl },
): Promise<ThoughtTopologyBuildResult> {
  const control = input.control ?? DEFAULT_CONTROL;
  const handle = await startThoughtTopologyRuntimeJob({ ...input, control });
  let snapshot = handle.snapshot;
  while (!TERMINAL.has(snapshot.state)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    snapshot = await control.inspect(handle.authority, snapshot.jobId);
    assertSnapshot(snapshot, handle.authority);
  }
  if (snapshot.state !== "succeeded") throw new ThoughtTopologyRuntimeError("build_failed", "Thought Topology worker did not complete.");
  const output = await control.readOutput(handle.authority, snapshot.jobId, "result");
  const result = validateThoughtTopologyRuntimeEnvelope(snapshot, output.content);
  if (result.clusterId !== input.clusterId || result.revision < input.revision) {
    throw new ThoughtTopologyRuntimeError("invalid_result", "Runtime returned another Garden revision.");
  }
  return result;
}

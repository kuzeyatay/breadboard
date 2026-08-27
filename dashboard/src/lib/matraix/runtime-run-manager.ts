import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import {
  abortOuterAgentRun,
  inspectOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import type { MatraixRequest } from "./identity.ts";
import { matraixArtifactId, type MatraixArtifact } from "./workspace.ts";

export type MatraixEvent = OuterAgentEvent;

export interface StartMatraixRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly request: MatraixRequest;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly baseUrl: string;
  readonly conversationContext?: string;
}

interface RuntimeAttemptIdentity {
  readonly jobId: string;
  readonly attempt: number;
  readonly workerInstanceId: string | null;
}

const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const WORKER_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const ARTIFACT_ID = /^[A-Za-z0-9_-]{1,512}$/u;
const KINDS = new Set(["report", "data", "task", "response"]);
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4_096 ||
    value.startsWith("/") ||
    path.win32.isAbsolute(value) ||
    /[\\:\u0000\r\n]/u.test(value)
  ) return false;
  return value.split("/").every((segment) =>
    Boolean(segment) &&
    segment !== "." &&
    segment !== ".." &&
    Buffer.byteLength(segment, "utf8") <= 255);
}

function validatedArtifact(value: unknown): MatraixArtifact | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    !ARTIFACT_ID.test(value.id) ||
    !safeRelativePath(value.relativePath) ||
    matraixArtifactId(value.relativePath) !== value.id ||
    typeof value.name !== "string" ||
    !value.name ||
    value.name !== path.posix.basename(value.relativePath) ||
    value.name !== path.basename(value.name) ||
    Buffer.byteLength(value.name, "utf8") > 512 ||
    /[\u0000\r\n]/u.test(value.name) ||
    typeof value.kind !== "string" ||
    !KINDS.has(value.kind) ||
    typeof value.contentType !== "string" ||
    !/^[a-z0-9][a-z0-9.+-]{0,126}\/[a-z0-9][a-z0-9.+-]{0,126}(?:; charset=utf-8)?$/iu.test(value.contentType) ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    (value.size as number) > MAX_ARTIFACT_BYTES ||
    typeof value.modifiedAt !== "string" ||
    !Number.isFinite(Date.parse(value.modifiedAt))
  ) return null;
  return value as unknown as MatraixArtifact;
}

function artifactsFromEvents(events: readonly OuterAgentEvent[]): MatraixArtifact[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const values = events[index]?.payload.artifacts;
    if (!Array.isArray(values)) continue;
    if (values.length > 2_000) throw new Error("MatrAIx artifact receipt is invalid.");
    const records = values.map(validatedArtifact);
    if (records.some((record) => record === null)) {
      throw new Error("MatrAIx artifact receipt is invalid.");
    }
    const artifacts = records as MatraixArtifact[];
    if (new Set(artifacts.map((record) => record.id)).size !== artifacts.length) {
      throw new Error("MatrAIx artifact receipt is invalid.");
    }
    return artifacts;
  }
  return [];
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.normalize(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function contained(candidate: string, root: string): boolean {
  const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function runtimeDataRoot(): string {
  return process.env.BREADBOARD_DATA_DIR?.trim() ? dashboardDataDir() : repositoryRoot();
}

export function resolveMatraixArtifactPath(input: {
  readonly dataRoot: string;
  readonly job: RuntimeAttemptIdentity;
  readonly events: readonly OuterAgentEvent[];
  readonly artifactId: string;
}): { record: MatraixArtifact; canonicalPath: string } | null {
  if (
    !JOB_ID.test(input.job.jobId) ||
    !Number.isSafeInteger(input.job.attempt) ||
    input.job.attempt < 1 ||
    !input.job.workerInstanceId ||
    !WORKER_ID.test(input.job.workerInstanceId) ||
    !ARTIFACT_ID.test(input.artifactId)
  ) return null;
  const record = artifactsFromEvents(input.events).find((item) => item.id === input.artifactId);
  if (!record) return null;
  const outputRoot = path.resolve(
    input.dataRoot,
    "runtime",
    "jobs",
    input.job.jobId,
    "attempts",
    String(input.job.attempt),
    input.job.workerInstanceId,
    "workspace",
    "output",
  );
  const candidate = path.resolve(outputRoot, ...record.relativePath.split("/"));
  if (!contained(candidate, outputRoot)) return null;
  try {
    const rootMetadata = fs.lstatSync(outputRoot);
    const metadata = fs.lstatSync(candidate);
    if (
      !rootMetadata.isDirectory() ||
      rootMetadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size !== record.size
    ) return null;
    const canonicalRoot = fs.realpathSync.native(outputRoot);
    const canonicalPath = fs.realpathSync.native(candidate);
    if (
      !samePath(canonicalRoot, outputRoot) ||
      !samePath(canonicalPath, candidate) ||
      !contained(canonicalPath, canonicalRoot)
    ) return null;
    return { record, canonicalPath };
  } catch {
    return null;
  }
}

/** Durable Next facade. Only Runtime owns the MatrAIx study tree. */
export async function startRun(
  input: StartMatraixRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  return startOuterAgentRun({
    kind: "matraix",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      request: input.request,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      conversationContext: input.conversationContext ?? "",
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<MatraixEvent[]> {
  return [...(await readOuterAgentRunView("matraix", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("matraix", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("matraix", userId, runId);
}

export async function listArtifacts(userId: number, runId: string): Promise<MatraixArtifact[]> {
  const view = await readOuterAgentRunView("matraix", userId, runId, 0);
  return artifactsFromEvents(view.events);
}

export async function readArtifact(
  userId: number,
  runId: string,
  artifactId: string,
): Promise<{ record: MatraixArtifact; stream: ReadableStream<Uint8Array> } | null> {
  const view = await readOuterAgentRunView("matraix", userId, runId, 0);
  const job = await inspectOuterAgentRun("matraix", userId, runId);
  const resolved = resolveMatraixArtifactPath({
    dataRoot: runtimeDataRoot(),
    job,
    events: view.events,
    artifactId,
  });
  if (!resolved) return null;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(resolved.canonicalPath, "r");
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size !== resolved.record.size) {
      fs.closeSync(descriptor);
      return null;
    }
    const stream = fs.createReadStream(resolved.canonicalPath, {
      fd: descriptor,
      autoClose: true,
    });
    descriptor = undefined;
    return {
      record: resolved.record,
      stream: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    };
  } catch {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    return null;
  }
}

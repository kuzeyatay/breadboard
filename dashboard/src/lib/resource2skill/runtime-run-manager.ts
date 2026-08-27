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
import type { Resource2SkillDomain } from "./identity.ts";
import {
  resource2SkillArtifactId,
  type Resource2SkillArtifact,
} from "./workspace.ts";

export type Resource2SkillEvent = OuterAgentEvent;

export interface StartResource2SkillRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly task: string;
  readonly domain: Resource2SkillDomain;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly maxIterations?: number;
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
const KINDS = new Set([
  "web",
  "presentation",
  "spreadsheet",
  "scene",
  "audio",
  "image",
  "document",
  "source",
]);
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

function validatedArtifact(value: unknown): Resource2SkillArtifact | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    !ARTIFACT_ID.test(value.id) ||
    !safeRelativePath(value.relativePath) ||
    resource2SkillArtifactId(value.relativePath) !== value.id ||
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
  return value as unknown as Resource2SkillArtifact;
}

function artifactsFromEvents(events: readonly OuterAgentEvent[]): Resource2SkillArtifact[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const values = events[index]?.payload.artifacts;
    if (!Array.isArray(values)) continue;
    if (values.length > 2_000) throw new Error("Resource2Skill artifact receipt is invalid.");
    const records = values.map(validatedArtifact);
    if (records.some((record) => record === null)) {
      throw new Error("Resource2Skill artifact receipt is invalid.");
    }
    const artifacts = records as Resource2SkillArtifact[];
    if (new Set(artifacts.map((record) => record.id)).size !== artifacts.length) {
      throw new Error("Resource2Skill artifact receipt is invalid.");
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

/** Pure resolver used by the route and traversal/symlink regression tests. */
export function resolveResource2SkillArtifactPath(input: {
  readonly dataRoot: string;
  readonly job: RuntimeAttemptIdentity;
  readonly events: readonly OuterAgentEvent[];
  readonly artifactId: string;
}): { record: Resource2SkillArtifact; canonicalPath: string } | null {
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

/** Durable Next facade. Only Runtime owns Resource2Skill and its descendants. */
export async function startRun(
  input: StartResource2SkillRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  const maxIterations = Number.isSafeInteger(input.maxIterations)
    ? Math.max(1, Math.min(input.maxIterations as number, 120))
    : 60;
  return startOuterAgentRun({
    kind: "resource2skill",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      task: input.task,
      domain: input.domain,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      maxIterations,
      baseUrl: input.baseUrl,
      conversationContext: input.conversationContext ?? "",
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<Resource2SkillEvent[]> {
  return [...(await readOuterAgentRunView("resource2skill", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("resource2skill", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("resource2skill", userId, runId);
}

export async function listArtifacts(
  userId: number,
  runId: string,
): Promise<Resource2SkillArtifact[]> {
  const view = await readOuterAgentRunView("resource2skill", userId, runId, 0);
  return artifactsFromEvents(view.events);
}

/** Stream only a file named by a fenced, durable Runtime event receipt. */
export async function readArtifact(
  userId: number,
  runId: string,
  artifactId: string,
): Promise<{
  record: Resource2SkillArtifact;
  stream: ReadableStream<Uint8Array>;
} | null> {
  const view = await readOuterAgentRunView("resource2skill", userId, runId, 0);
  const job = await inspectOuterAgentRun("resource2skill", userId, runId);
  const resolved = resolveResource2SkillArtifactPath({
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

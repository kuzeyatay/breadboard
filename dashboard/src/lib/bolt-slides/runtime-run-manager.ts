if (typeof window !== "undefined") {
  throw new Error("Bolt Slides Runtime control is server-only.");
}

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
import type { BoltSlidesRequest } from "./identity.ts";
import {
  boltSlidesArtifactId,
  resolveDeckFileAt,
  type BoltSlidesArtifact,
} from "./workspace.ts";

export type BoltSlidesEvent = OuterAgentEvent;

export interface StartBoltSlidesRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly brief: string;
  readonly request: BoltSlidesRequest;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly baseUrl: string;
  readonly conversationPublicId?: string;
  readonly conversationContext?: string;
}

interface RuntimeAttemptIdentity {
  readonly jobId: string;
  readonly attempt: number;
  readonly workerInstanceId: string | null;
}

export interface BoltSlidesArtifactRead {
  readonly record: BoltSlidesArtifact;
  readonly stream: ReadableStream<Uint8Array>;
}

export interface BoltSlidesDeckRead {
  readonly contentType: string;
  readonly size: number;
  readonly stream: ReadableStream<Uint8Array>;
}

const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const WORKER_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const ARTIFACT_ID = /^[A-Za-z0-9_-]{1,512}$/u;
const MAX_SOURCE_ARTIFACT_BYTES = 8 * 1024 * 1024;
const ARTIFACT_LAYOUT: Record<string, Pick<BoltSlidesArtifact, "kind" | "contentType">> = {
  "src/App.tsx": { kind: "deck", contentType: "text/plain; charset=utf-8" },
  "src/styles/tokens.css": { kind: "theme", contentType: "text/css; charset=utf-8" },
  "index.html": { kind: "page", contentType: "text/html; charset=utf-8" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function artifactDescriptor(relativePath: string): Pick<BoltSlidesArtifact, "kind" | "contentType"> | null {
  const fixed = ARTIFACT_LAYOUT[relativePath];
  if (fixed) return fixed;
  return /^src\/authored\/[A-Z][A-Za-z0-9]{0,79}\.tsx$/u.test(relativePath)
    ? { kind: "component", contentType: "text/plain; charset=utf-8" }
    : null;
}

function validatedArtifact(value: unknown): BoltSlidesArtifact | null {
  if (!isRecord(value) || typeof value.relativePath !== "string") return null;
  const descriptor = artifactDescriptor(value.relativePath);
  if (
    !descriptor ||
    typeof value.id !== "string" ||
    !ARTIFACT_ID.test(value.id) ||
    boltSlidesArtifactId(value.relativePath) !== value.id ||
    typeof value.name !== "string" ||
    value.name !== path.posix.basename(value.relativePath) ||
    value.name !== path.basename(value.name) ||
    Buffer.byteLength(value.name, "utf8") > 256 ||
    /[\u0000\r\n]/u.test(value.name) ||
    value.kind !== descriptor.kind ||
    value.contentType !== descriptor.contentType ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    (value.size as number) > MAX_SOURCE_ARTIFACT_BYTES ||
    typeof value.modifiedAt !== "string" ||
    !Number.isFinite(Date.parse(value.modifiedAt))
  ) return null;
  return value as unknown as BoltSlidesArtifact;
}

function artifactsFromEvents(events: readonly OuterAgentEvent[]): BoltSlidesArtifact[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const values = events[index]?.payload.artifacts;
    if (!Array.isArray(values)) continue;
    if (values.length > 11) throw new Error("Bolt Slides artifact receipt is invalid.");
    const records = values.map(validatedArtifact);
    if (records.some((record) => record === null)) {
      throw new Error("Bolt Slides artifact receipt is invalid.");
    }
    const artifacts = records as BoltSlidesArtifact[];
    if (new Set(artifacts.map((record) => record.id)).size !== artifacts.length) {
      throw new Error("Bolt Slides artifact receipt is invalid.");
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

function attemptWorkspace(dataRoot: string, job: RuntimeAttemptIdentity): string | null {
  if (
    !JOB_ID.test(job.jobId) ||
    !Number.isSafeInteger(job.attempt) ||
    job.attempt < 1 ||
    !job.workerInstanceId ||
    !WORKER_ID.test(job.workerInstanceId)
  ) return null;
  return path.resolve(
    dataRoot,
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
  );
}

export function resolveBoltSlidesArtifactPath(input: {
  readonly dataRoot: string;
  readonly job: RuntimeAttemptIdentity;
  readonly events: readonly OuterAgentEvent[];
  readonly artifactId: string;
}): { record: BoltSlidesArtifact; canonicalPath: string } | null {
  if (!ARTIFACT_ID.test(input.artifactId)) return null;
  const workspaceRoot = attemptWorkspace(input.dataRoot, input.job);
  const record = artifactsFromEvents(input.events).find((item) => item.id === input.artifactId);
  if (!workspaceRoot || !record) return null;
  const candidate = path.resolve(workspaceRoot, ...record.relativePath.split("/"));
  if (!contained(candidate, workspaceRoot)) return null;
  try {
    const rootMetadata = fs.lstatSync(workspaceRoot);
    const metadata = fs.lstatSync(candidate);
    if (
      !rootMetadata.isDirectory() ||
      rootMetadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size !== record.size
    ) return null;
    const canonicalRoot = fs.realpathSync.native(workspaceRoot);
    const canonicalPath = fs.realpathSync.native(candidate);
    if (
      !samePath(canonicalRoot, workspaceRoot) ||
      !samePath(canonicalPath, candidate) ||
      !contained(canonicalPath, canonicalRoot)
    ) return null;
    return { record, canonicalPath };
  } catch {
    return null;
  }
}

export function resolveBoltSlidesDeckPath(input: {
  readonly dataRoot: string;
  readonly job: RuntimeAttemptIdentity;
  readonly relativePath: string;
}): { canonicalPath: string; contentType: string; size: number } | null {
  const workspaceRoot = attemptWorkspace(input.dataRoot, input.job);
  if (!workspaceRoot) return null;
  try {
    const file = resolveDeckFileAt(workspaceRoot, input.relativePath);
    return {
      canonicalPath: fs.realpathSync.native(file.absolutePath),
      contentType: file.contentType,
      size: file.size,
    };
  } catch {
    return null;
  }
}

function openFile(input: {
  canonicalPath: string;
  size: number;
}): ReadableStream<Uint8Array> | null {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(input.canonicalPath, "r");
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size !== input.size) {
      fs.closeSync(descriptor);
      return null;
    }
    const stream = fs.createReadStream(input.canonicalPath, {
      fd: descriptor,
      autoClose: true,
    });
    descriptor = undefined;
    return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  } catch {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    return null;
  }
}

/** Durable Next facade. Only the disposable Runtime worker authors and builds. */
export async function startRun(
  input: StartBoltSlidesRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  return startOuterAgentRun({
    kind: "bolt-slides",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      brief: input.brief,
      request: input.request,
      model: input.model,
      reasoningEffort: input.reasoningEffort ?? "",
      baseUrl: input.baseUrl,
      conversationPublicId: input.conversationPublicId ?? "",
      conversationContext: input.conversationContext ?? "",
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<BoltSlidesEvent[]> {
  return [...(await readOuterAgentRunView("bolt-slides", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("bolt-slides", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("bolt-slides", userId, runId);
}

export async function listArtifacts(
  userId: number,
  runId: string,
): Promise<BoltSlidesArtifact[]> {
  const view = await readOuterAgentRunView("bolt-slides", userId, runId, 0);
  return artifactsFromEvents(view.events);
}

export async function readArtifact(
  userId: number,
  runId: string,
  artifactId: string,
): Promise<BoltSlidesArtifactRead | null> {
  const view = await readOuterAgentRunView("bolt-slides", userId, runId, 0);
  const job = await inspectOuterAgentRun("bolt-slides", userId, runId);
  const resolved = resolveBoltSlidesArtifactPath({
    dataRoot: runtimeDataRoot(),
    job,
    events: view.events,
    artifactId,
  });
  if (!resolved) return null;
  const stream = openFile({ canonicalPath: resolved.canonicalPath, size: resolved.record.size });
  return stream ? { record: resolved.record, stream } : null;
}

export async function readDeckFile(
  userId: number,
  runId: string,
  relativePath: string,
): Promise<BoltSlidesDeckRead | null> {
  const job = await inspectOuterAgentRun("bolt-slides", userId, runId);
  const resolved = resolveBoltSlidesDeckPath({
    dataRoot: runtimeDataRoot(),
    job,
    relativePath,
  });
  if (!resolved) return null;
  const stream = openFile(resolved);
  return stream
    ? { contentType: resolved.contentType, size: resolved.size, stream }
    : null;
}

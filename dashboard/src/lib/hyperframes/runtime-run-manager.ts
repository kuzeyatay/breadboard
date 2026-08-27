import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  externalRuntimeLstat,
  externalRuntimeRealpath,
} from "../external-runtime-filesystem.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import {
  abortOuterAgentRun,
  inspectOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import { hyperframesArtifactId, type HyperframesArtifact } from "./workspace.ts";

export type HyperframesEvent = OuterAgentEvent;

export interface StartHyperframesRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly brief: string;
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

export interface HyperframesArtifactRead {
  readonly record: HyperframesArtifact;
  readonly stream: ReadableStream<Uint8Array>;
  readonly status: 200 | 206;
  readonly contentLength: number;
  readonly contentRange: string | null;
}

const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const WORKER_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const ARTIFACT_ID = /^[A-Za-z0-9_-]{1,512}$/u;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024 * 1024;
const FILE_KINDS: Record<string, Pick<HyperframesArtifact, "kind" | "contentType">> = {
  ".mp4": { kind: "video", contentType: "video/mp4" },
  ".webm": { kind: "video", contentType: "video/webm" },
  ".mov": { kind: "video", contentType: "video/quicktime" },
  ".gif": { kind: "image", contentType: "image/gif" },
  ".png": { kind: "image", contentType: "image/png" },
  ".jpg": { kind: "image", contentType: "image/jpeg" },
  ".jpeg": { kind: "image", contentType: "image/jpeg" },
  ".webp": { kind: "image", contentType: "image/webp" },
  ".svg": { kind: "image", contentType: "image/svg+xml" },
  ".html": { kind: "composition", contentType: "text/html; charset=utf-8" },
  ".md": { kind: "document", contentType: "text/markdown; charset=utf-8" },
  ".mp3": { kind: "audio", contentType: "audio/mpeg" },
  ".wav": { kind: "audio", contentType: "audio/wav" },
  ".m4a": { kind: "audio", contentType: "audio/mp4" },
};

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

function validatedArtifact(value: unknown): HyperframesArtifact | null {
  if (!isRecord(value) || !safeRelativePath(value.relativePath)) return null;
  const descriptor = FILE_KINDS[path.posix.extname(value.relativePath).toLowerCase()];
  if (
    !descriptor ||
    typeof value.id !== "string" ||
    !ARTIFACT_ID.test(value.id) ||
    hyperframesArtifactId(value.relativePath) !== value.id ||
    typeof value.name !== "string" ||
    !value.name ||
    value.name !== path.posix.basename(value.relativePath) ||
    value.name !== path.basename(value.name) ||
    Buffer.byteLength(value.name, "utf8") > 512 ||
    /[\u0000\r\n]/u.test(value.name) ||
    value.kind !== descriptor.kind ||
    value.contentType !== descriptor.contentType ||
    !Number.isSafeInteger(value.size) ||
    (value.size as number) < 0 ||
    (value.size as number) > MAX_ARTIFACT_BYTES ||
    typeof value.modifiedAt !== "string" ||
    !Number.isFinite(Date.parse(value.modifiedAt))
  ) return null;
  return value as unknown as HyperframesArtifact;
}

function artifactsFromEvents(events: readonly OuterAgentEvent[]): HyperframesArtifact[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const values = events[index]?.payload.artifacts;
    if (!Array.isArray(values)) continue;
    if (values.length > 4_000) throw new Error("HyperFrames artifact receipt is invalid.");
    const records = values.map(validatedArtifact);
    if (records.some((record) => record === null)) {
      throw new Error("HyperFrames artifact receipt is invalid.");
    }
    const artifacts = records as HyperframesArtifact[];
    if (new Set(artifacts.map((record) => record.id)).size !== artifacts.length) {
      throw new Error("HyperFrames artifact receipt is invalid.");
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

function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  let start = rawStart ? Number(rawStart) : 0;
  let end = rawEnd ? Number(rawEnd) : size - 1;
  if (!rawStart) {
    start = Math.max(0, size - Number(rawEnd));
    end = size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < 0 ||
    start > end ||
    start >= size
  ) return null;
  return { start, end: Math.min(end, size - 1) };
}

export function resolveHyperframesArtifactPath(input: {
  readonly dataRoot: string;
  readonly job: RuntimeAttemptIdentity;
  readonly events: readonly OuterAgentEvent[];
  readonly artifactId: string;
}): { record: HyperframesArtifact; canonicalPath: string } | null {
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
  const projectRoot = path.resolve(
    input.dataRoot,
    "runtime",
    "jobs",
    input.job.jobId,
    "attempts",
    String(input.job.attempt),
    input.job.workerInstanceId,
    "workspace",
    "project",
  );
  const candidate = path.resolve(projectRoot, ...record.relativePath.split("/"));
  if (!contained(candidate, projectRoot)) return null;
  try {
    const rootMetadata = externalRuntimeLstat(projectRoot);
    const metadata = externalRuntimeLstat(candidate);
    if (
      !rootMetadata.isDirectory() ||
      rootMetadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size !== record.size
    ) return null;
    const canonicalRoot = externalRuntimeRealpath(projectRoot);
    const canonicalPath = externalRuntimeRealpath(candidate);
    if (
      !samePath(canonicalRoot, projectRoot) ||
      !samePath(canonicalPath, candidate) ||
      !contained(canonicalPath, canonicalRoot)
    ) return null;
    return { record, canonicalPath };
  } catch {
    return null;
  }
}

/** Durable Next facade. Only Runtime owns the Codex/CLI/browser/ffmpeg tree. */
export async function startRun(
  input: StartHyperframesRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  return startOuterAgentRun({
    kind: "hyperframes",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      brief: input.brief,
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
): Promise<HyperframesEvent[]> {
  return [...(await readOuterAgentRunView("hyperframes", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("hyperframes", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("hyperframes", userId, runId);
}

export async function listArtifacts(
  userId: number,
  runId: string,
): Promise<HyperframesArtifact[]> {
  const view = await readOuterAgentRunView("hyperframes", userId, runId, 0);
  return artifactsFromEvents(view.events);
}

export async function readArtifact(
  userId: number,
  runId: string,
  artifactId: string,
  rangeHeader: string | null,
): Promise<HyperframesArtifactRead | null> {
  const view = await readOuterAgentRunView("hyperframes", userId, runId, 0);
  const job = await inspectOuterAgentRun("hyperframes", userId, runId);
  const resolved = resolveHyperframesArtifactPath({
    dataRoot: runtimeDataRoot(),
    job,
    events: view.events,
    artifactId,
  });
  if (!resolved) return null;
  const range = parseRange(rangeHeader, resolved.record.size);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(/* turbopackIgnore: true */ resolved.canonicalPath, "r");
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size !== resolved.record.size) {
      fs.closeSync(descriptor);
      return null;
    }
    const stream = fs.createReadStream(/* turbopackIgnore: true */ resolved.canonicalPath, {
      fd: descriptor,
      autoClose: true,
      ...(range ? { start: range.start, end: range.end } : {}),
    });
    descriptor = undefined;
    return {
      record: resolved.record,
      stream: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
      status: range ? 206 : 200,
      contentLength: range ? range.end - range.start + 1 : resolved.record.size,
      contentRange: range
        ? `bytes ${range.start}-${range.end}/${resolved.record.size}`
        : null,
    };
  } catch {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    return null;
  }
}

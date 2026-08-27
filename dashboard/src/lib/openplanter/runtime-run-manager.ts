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

export type OpenPlanterEvent = OuterAgentEvent;

export interface StartOpenPlanterRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly task: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly baseUrl: string;
  readonly conversationContext?: string;
}

export interface OpenPlanterArtifactRecord {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: string;
  readonly size: number;
  readonly preview: string;
}

interface ArtifactReceipt {
  readonly sessionId: string;
  readonly record: OpenPlanterArtifactRecord;
}

interface RuntimeAttemptIdentity {
  readonly jobId: string;
  readonly attempt: number;
  readonly workerInstanceId: string | null;
}

const SESSION_ID = /^\d{8}-\d{6}-[0-9a-f]{6}(?:-[0-9a-f]{4})?$/u;
const ARTIFACT_ID = /^[0-9a-f]{20}$/u;
const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const WORKER_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeArtifactPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4_096 ||
    value.startsWith("/") ||
    path.win32.isAbsolute(value) ||
    /[\\:\u0000\r\n]/u.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) =>
      Boolean(segment) &&
      segment !== "." &&
      segment !== ".." &&
      Buffer.byteLength(segment, "utf8") <= 255,
  );
}

function artifactReceipt(
  events: readonly OuterAgentEvent[],
  artifactId: string,
): ArtifactReceipt | null {
  if (!ARTIFACT_ID.test(artifactId)) return null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]?.payload;
    if (!payload || !SESSION_ID.test(String(payload.sessionId ?? ""))) continue;
    if (!Array.isArray(payload.artifacts)) continue;
    for (const value of payload.artifacts) {
      if (!isRecord(value) || value.id !== artifactId) continue;
      if (
        !ARTIFACT_ID.test(String(value.id ?? "")) ||
        typeof value.name !== "string" ||
        !value.name ||
        value.name !== path.basename(value.name) ||
        Buffer.byteLength(value.name, "utf8") > 512 ||
        /[\u0000\r\n]/u.test(value.name) ||
        !safeArtifactPath(value.path) ||
        typeof value.kind !== "string" ||
        Buffer.byteLength(value.kind, "utf8") > 64 ||
        !Number.isSafeInteger(value.size) ||
        (value.size as number) < 0 ||
        (value.size as number) > MAX_ARTIFACT_BYTES ||
        typeof value.preview !== "string" ||
        Buffer.byteLength(value.preview, "utf8") > 8_192
      ) {
        return null;
      }
      return {
        sessionId: String(payload.sessionId),
        record: value as unknown as OpenPlanterArtifactRecord,
      };
    }
  }
  return null;
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
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

/** Pure path resolver exported for protocol/security fixtures. */
export function resolveOpenPlanterArtifactPath(input: {
  readonly dataRoot: string;
  readonly job: RuntimeAttemptIdentity;
  readonly events: readonly OuterAgentEvent[];
  readonly artifactId: string;
}): { record: OpenPlanterArtifactRecord; canonicalPath: string } | null {
  const receipt = artifactReceipt(input.events, input.artifactId);
  if (
    !receipt ||
    !JOB_ID.test(input.job.jobId) ||
    !Number.isSafeInteger(input.job.attempt) ||
    input.job.attempt < 1 ||
    !input.job.workerInstanceId ||
    !WORKER_ID.test(input.job.workerInstanceId)
  ) {
    return null;
  }
  const sessionRoot = path.resolve(
    input.dataRoot,
    "runtime",
    "jobs",
    input.job.jobId,
    "attempts",
    String(input.job.attempt),
    input.job.workerInstanceId,
    "workspace",
    ".openplanter",
    "sessions",
    receipt.sessionId,
  );
  const candidate = path.resolve(sessionRoot, ...receipt.record.path.split("/"));
  if (!contained(candidate, sessionRoot)) return null;
  try {
    const rootMetadata = fs.lstatSync(sessionRoot);
    const metadata = fs.lstatSync(candidate);
    if (
      !rootMetadata.isDirectory() ||
      rootMetadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size !== receipt.record.size
    ) {
      return null;
    }
    const canonicalRoot = fs.realpathSync.native(sessionRoot);
    const canonicalPath = fs.realpathSync.native(candidate);
    if (
      !samePath(canonicalRoot, sessionRoot) ||
      !samePath(canonicalPath, candidate) ||
      !contained(canonicalPath, canonicalRoot)
    ) {
      return null;
    }
    return { record: receipt.record, canonicalPath };
  } catch {
    return null;
  }
}

function runtimeDataRoot(): string {
  return process.env.BREADBOARD_DATA_DIR?.trim() ? dashboardDataDir() : repositoryRoot();
}

/** Durable Next façade. Only Runtime owns OpenPlanter and its Python tree. */
export async function startRun(
  input: StartOpenPlanterRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  return startOuterAgentRun({
    kind: "openplanter",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      task: input.task,
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
): Promise<OpenPlanterEvent[]> {
  return [...(await readOuterAgentRunView("openplanter", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("openplanter", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("openplanter", userId, runId);
}

/** Stream only an artifact authenticated by the durable Runtime event receipt. */
export async function readArtifact(
  userId: number,
  runId: string,
  artifactId: string,
): Promise<{
  record: OpenPlanterArtifactRecord;
  stream: ReadableStream<Uint8Array>;
} | null> {
  const view = await readOuterAgentRunView("openplanter", userId, runId, 0);
  const job = await inspectOuterAgentRun("openplanter", userId, runId);
  const resolved = resolveOpenPlanterArtifactPath({
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

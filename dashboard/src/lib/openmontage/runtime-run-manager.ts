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
import {
  openMontageArtifactId,
  PRODUCTION_STAGES,
  type OpenMontageArtifact,
  type ProductionDecision,
  type ProductionState,
} from "./workspace.ts";

export type OpenMontageEvent = OuterAgentEvent;

export interface StartOpenMontageRunInput {
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

export interface OpenMontageArtifactRead {
  readonly record: OpenMontageArtifact;
  readonly stream: ReadableStream<Uint8Array>;
  readonly contentLength: number;
  readonly contentRange: string | null;
}

const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const WORKER_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const ARTIFACT_ID = /^[A-Za-z0-9_-]{1,512}$/u;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024 * 1024;
const FILE_KINDS: Record<string, Pick<OpenMontageArtifact, "kind" | "contentType">> = {
  ".mp4": { kind: "video", contentType: "video/mp4" },
  ".webm": { kind: "video", contentType: "video/webm" },
  ".mov": { kind: "video", contentType: "video/quicktime" },
  ".gif": { kind: "image", contentType: "image/gif" },
  ".png": { kind: "image", contentType: "image/png" },
  ".jpg": { kind: "image", contentType: "image/jpeg" },
  ".jpeg": { kind: "image", contentType: "image/jpeg" },
  ".webp": { kind: "image", contentType: "image/webp" },
  ".svg": { kind: "image", contentType: "image/svg+xml" },
  ".mp3": { kind: "audio", contentType: "audio/mpeg" },
  ".wav": { kind: "audio", contentType: "audio/wav" },
  ".m4a": { kind: "audio", contentType: "audio/mp4" },
  ".md": { kind: "document", contentType: "text/markdown; charset=utf-8" },
  ".txt": { kind: "document", contentType: "text/plain; charset=utf-8" },
  ".srt": { kind: "document", contentType: "text/plain; charset=utf-8" },
  ".vtt": { kind: "document", contentType: "text/plain; charset=utf-8" },
  ".json": { kind: "data", contentType: "application/json; charset=utf-8" },
  ".yaml": { kind: "data", contentType: "text/plain; charset=utf-8" },
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

function validatedArtifact(value: unknown): OpenMontageArtifact | null {
  if (!isRecord(value) || !safeRelativePath(value.relativePath)) return null;
  const descriptor = FILE_KINDS[path.posix.extname(value.relativePath).toLowerCase()];
  if (
    !descriptor ||
    typeof value.id !== "string" ||
    !ARTIFACT_ID.test(value.id) ||
    openMontageArtifactId(value.relativePath) !== value.id ||
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
  return value as unknown as OpenMontageArtifact;
}

function artifactsFromEvents(events: readonly OuterAgentEvent[]): OpenMontageArtifact[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const values = events[index]?.payload.artifacts;
    if (!Array.isArray(values)) continue;
    if (values.length > 4_000) throw new Error("OpenMontage artifact receipt is invalid.");
    const records = values.map(validatedArtifact);
    if (records.some((record) => record === null)) {
      throw new Error("OpenMontage artifact receipt is invalid.");
    }
    const artifacts = records as OpenMontageArtifact[];
    if (new Set(artifacts.map((record) => record.id)).size !== artifacts.length) {
      throw new Error("OpenMontage artifact receipt is invalid.");
    }
    return artifacts;
  }
  return [];
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= maximum;
}

function stringList(value: unknown, maximumItems: number, maximumBytes: number): value is string[] {
  return Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((item) => boundedString(item, maximumBytes));
}

function validatedDecision(value: unknown): ProductionDecision | null {
  if (!isRecord(value)) return null;
  if (
    !boundedString(value.category, 120) ||
    !boundedString(value.subject, 200) ||
    !boundedString(value.stage, 60) ||
    !boundedString(value.chosen, 300) ||
    !boundedString(value.rationale, 1_000) ||
    !stringList(value.optionsConsidered, 12, 200) ||
    typeof value.superseded !== "boolean" ||
    !boundedString(value.at, 60)
  ) return null;
  return value as unknown as ProductionDecision;
}

function validatedProduction(value: unknown): ProductionState | null {
  if (!isRecord(value)) return null;
  const decisions = Array.isArray(value.decisions)
    ? value.decisions.map(validatedDecision)
    : null;
  if (
    !(value.projectId === null || boundedString(value.projectId, 200)) ||
    !boundedString(value.title, 300) ||
    !boundedString(value.pipelineType, 120) ||
    !stringList(value.stages, 32, 60) ||
    !stringList(value.completedStages, 32, 60) ||
    !(value.currentStage === null || boundedString(value.currentStage, 60)) ||
    !decisions ||
    decisions.length > 200 ||
    decisions.some((item) => item === null) ||
    typeof value.spendUsd !== "number" ||
    !Number.isFinite(value.spendUsd) ||
    value.spendUsd < 0
  ) return null;
  return value as unknown as ProductionState;
}

function productionFromEvents(events: readonly OuterAgentEvent[]): ProductionState {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (!("production" in events[index].payload)) continue;
    const production = validatedProduction(events[index].payload.production);
    if (production) return production;
  }
  return {
    projectId: null,
    title: "",
    pipelineType: "",
    stages: [...PRODUCTION_STAGES],
    completedStages: [],
    currentStage: null,
    decisions: [],
    spendUsd: 0,
  };
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

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
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

export function resolveOpenMontageArtifactPath(input: {
  readonly dataRoot: string;
  readonly job: RuntimeAttemptIdentity;
  readonly events: readonly OuterAgentEvent[];
  readonly artifactId: string;
}): { record: OpenMontageArtifact; canonicalPath: string } | null {
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
  const projectsRoot = path.resolve(
    input.dataRoot,
    "runtime",
    "jobs",
    input.job.jobId,
    "attempts",
    String(input.job.attempt),
    input.job.workerInstanceId,
    "workspace",
    "projects",
  );
  const candidate = path.resolve(projectsRoot, ...record.relativePath.split("/"));
  if (!contained(candidate, projectsRoot)) return null;
  try {
    const rootMetadata = fs.lstatSync(projectsRoot);
    const metadata = fs.lstatSync(candidate);
    if (
      !rootMetadata.isDirectory() ||
      rootMetadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size !== record.size
    ) return null;
    const canonicalRoot = fs.realpathSync.native(projectsRoot);
    const canonicalPath = fs.realpathSync.native(candidate);
    if (
      !samePath(canonicalRoot, projectsRoot) ||
      !samePath(canonicalPath, candidate) ||
      !contained(canonicalPath, canonicalRoot)
    ) return null;
    return { record, canonicalPath };
  } catch {
    return null;
  }
}

/** Durable Next facade. Only Runtime owns the production toolchain. */
export async function startRun(
  input: StartOpenMontageRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  return startOuterAgentRun({
    kind: "openmontage",
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
): Promise<OpenMontageEvent[]> {
  return [...(await readOuterAgentRunView("openmontage", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("openmontage", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("openmontage", userId, runId);
}

export async function listArtifacts(
  userId: number,
  runId: string,
): Promise<OpenMontageArtifact[]> {
  return (await readArtifactView(userId, runId)).artifacts;
}

export async function readProduction(
  userId: number,
  runId: string,
): Promise<ProductionState> {
  return (await readArtifactView(userId, runId)).production;
}

export async function readArtifactView(
  userId: number,
  runId: string,
): Promise<{ artifacts: OpenMontageArtifact[]; production: ProductionState }> {
  const view = await readOuterAgentRunView("openmontage", userId, runId, 0);
  return {
    artifacts: artifactsFromEvents(view.events),
    production: productionFromEvents(view.events),
  };
}

export async function readArtifact(
  userId: number,
  runId: string,
  artifactId: string,
  rangeHeader: string | null,
): Promise<OpenMontageArtifactRead | null> {
  const view = await readOuterAgentRunView("openmontage", userId, runId, 0);
  const job = await inspectOuterAgentRun("openmontage", userId, runId);
  const resolved = resolveOpenMontageArtifactPath({
    dataRoot: runtimeDataRoot(),
    job,
    events: view.events,
    artifactId,
  });
  if (!resolved) return null;
  const range = parseRange(rangeHeader, resolved.record.size);
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
      ...(range ? { start: range.start, end: range.end } : {}),
    });
    descriptor = undefined;
    return {
      record: resolved.record,
      stream: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
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

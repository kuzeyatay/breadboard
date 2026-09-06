if (typeof window !== "undefined") {
  throw new Error("OpenWork Runtime control is server-only.");
}

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
import type { PromptOptions } from "./prompt.ts";
import {
  isOpenworkRuntimeArtifact,
  MAX_OPENWORK_ARTIFACTS,
  type OpenworkRuntimeArtifact,
} from "./runtime-artifact.ts";
import { prepareOpenworkRunProfile } from "./runtime-service.ts";

export type OpenworkEvent = OuterAgentEvent;

export interface StartOpenworkRuntimeRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly task: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly prompt: PromptOptions;
  readonly conversationContext?: string;
}

export interface OpenworkArtifactRead {
  readonly id: string;
  readonly path: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly stream: ReadableStream<Uint8Array>;
}

const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const WORKER_ID = /^[A-Za-z0-9_-]{1,128}$/u;

function runtimeDataRoot(): string {
  return process.env.BREADBOARD_DATA_DIR?.trim() ? dashboardDataDir() : repositoryRoot();
}

function normalizePath(value: string): string {
  const resolved = path.toNamespacedPath(path.normalize(path.resolve(value)));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function contained(candidate: string, root: string): boolean {
  const child = normalizePath(candidate);
  const parent = normalizePath(root);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function artifactsFromEvents(events: readonly OuterAgentEvent[]): OpenworkRuntimeArtifact[] {
  const artifacts: OpenworkRuntimeArtifact[] = [];
  const ids = new Set<string>();
  for (const event of events) {
    const values = event.type === "artifact.ready"
      ? [event.payload]
      : ["run.completed", "run.failed", "run.aborted"].includes(event.type) &&
          Array.isArray(event.payload.artifacts)
        ? event.payload.artifacts
        : [];
    for (const value of values) {
      if (!isOpenworkRuntimeArtifact(value)) {
        throw new Error("The OpenWork artifact receipt is invalid.");
      }
      if (ids.has(value.id)) continue;
      ids.add(value.id);
      artifacts.push(value);
      if (artifacts.length > MAX_OPENWORK_ARTIFACTS) {
        throw new Error("The OpenWork artifact receipt exceeded its bound.");
      }
    }
  }
  return artifacts;
}

function attemptWorkspace(input: {
  jobId: string;
  attempt: number;
  workerInstanceId: string | null;
}): string | null {
  if (
    !JOB_ID.test(input.jobId) ||
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 1 ||
    !input.workerInstanceId ||
    !WORKER_ID.test(input.workerInstanceId)
  ) return null;
  return path.resolve(
    runtimeDataRoot(),
    "runtime",
    "jobs",
    input.jobId,
    "attempts",
    String(input.attempt),
    input.workerInstanceId,
    "workspace",
  );
}

export function resolveOpenworkRuntimeArtifact(input: {
  readonly workspaceRoot: string;
  readonly record: OpenworkRuntimeArtifact;
}): string | null {
  const workspace = path.resolve(input.workspaceRoot);
  const candidate = path.resolve(workspace, ...input.record.relativePath.split("/"));
  if (!contained(candidate, workspace)) return null;
  try {
    const workspaceMetadata = fs.lstatSync(workspace);
    const fileMetadata = fs.lstatSync(candidate);
    if (
      !workspaceMetadata.isDirectory() ||
      workspaceMetadata.isSymbolicLink() ||
      !fileMetadata.isFile() ||
      fileMetadata.isSymbolicLink() ||
      fileMetadata.size !== input.record.size ||
      !samePath(fs.realpathSync.native(workspace), workspace) ||
      !samePath(fs.realpathSync.native(candidate), candidate) ||
      !contained(candidate, workspace)
    ) return null;
    return candidate;
  } catch {
    return null;
  }
}

function safeFilename(value: string): string {
  const base = path.basename(value.replaceAll("\\", "/"));
  const safe = base.replace(/["\u0000-\u001f\u007f]/gu, "_").slice(0, 240);
  return safe || "artifact";
}

/** Write the immutable private service profile, then submit one sealed job. */
export async function startRun(
  input: StartOpenworkRuntimeRunInput,
  dependencies: {
    prepare?: typeof prepareOpenworkRunProfile;
    submit?: typeof startOuterAgentRun;
  } = {},
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  const requestId = input.requestId ?? randomUUID();
  const prepare = dependencies.prepare ?? prepareOpenworkRunProfile;
  const submit = dependencies.submit ?? startOuterAgentRun;
  prepare(
    { userId: input.userId, runId: requestId },
    {
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      prompt: input.prompt,
    },
  );
  return submit({
    kind: "openwork",
    userId: input.userId,
    requestId,
    requestPayload: {
      task: input.task,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      prompt: {
        deliverFiles: input.prompt.deliverFiles,
        allowCommands: input.prompt.allowCommands,
      },
      conversationContext: input.conversationContext ?? "",
      serviceScopeId: requestId,
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<OpenworkEvent[]> {
  return [...(await readOuterAgentRunView("openwork", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("openwork", userId, runId, 0)).terminal;
}

export function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("openwork", userId, runId);
}

/**
 * Open only a file named by this authenticated run's sealed projection and
 * fixed Runtime-attempt workspace. The service and worker may both be gone.
 */
export async function readRunArtifact(
  userId: number,
  runId: string,
  artifactId: string,
): Promise<OpenworkArtifactRead> {
  if (
    !artifactId ||
    Buffer.byteLength(artifactId, "utf8") > 1_024 ||
    /\p{Cc}/u.test(artifactId)
  ) throw new Error("artifact_not_found");
  const [view, job] = await Promise.all([
    readOuterAgentRunView("openwork", userId, runId, 0),
    inspectOuterAgentRun("openwork", userId, runId),
  ]);
  const record = artifactsFromEvents(view.events).find((item) => item.id === artifactId);
  const workspace = attemptWorkspace(job);
  if (!record || !workspace) throw new Error("artifact_not_found");
  const absolutePath = resolveOpenworkRuntimeArtifact({ workspaceRoot: workspace, record });
  if (!absolutePath) throw new Error("artifact_not_found");
  let descriptor: number | undefined;
  try {
    const linkMetadata = fs.lstatSync(absolutePath);
    descriptor = fs.openSync(
      absolutePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const metadata = fs.fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size !== record.size ||
      metadata.dev !== linkMetadata.dev ||
      metadata.ino !== linkMetadata.ino
    ) {
      fs.closeSync(descriptor);
      descriptor = undefined;
      throw new Error("artifact_not_found");
    }
    const stream = fs.createReadStream(absolutePath, { fd: descriptor, autoClose: true });
    descriptor = undefined;
    return {
      id: record.id,
      path: record.path,
      filename: safeFilename(record.path),
      contentType: record.contentType,
      size: record.size,
      stream: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error instanceof Error && error.message === "artifact_not_found") throw error;
    throw new Error("artifact_not_found");
  }
}

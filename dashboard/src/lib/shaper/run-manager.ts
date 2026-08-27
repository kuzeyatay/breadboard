// Durable orchestration for Formsmith's fresh Runtime V2 ShapeR jobs. Runtime
// owns Python/CUDA descendants; this manager owns the unchanged chat event and
// artifact contracts and can reconcile an idempotent job after a Next restart.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  closeFormsmithArtifactContext,
  findPublishedFormsmithMesh,
  openFormsmithArtifactContext,
  publishFormsmithMesh,
  type FormsmithArtifactContext,
} from "./artifact.ts";
import { formsmithRunLabel, type FormsmithRequest } from "./identity.ts";
import { resolveFormsmithUpload } from "./uploads.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import {
  cancelFormsmithRuntimeRun,
  runFormsmithViaRuntime,
  type FormsmithRuntimeResult,
  type FormsmithRuntimeStage,
} from "../runtime-v2/formsmith-job.ts";

export interface FormsmithRunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  conversationPublicId: string;
  request: FormsmithRequest;
  label: string;
  status: RunStatus;
  sequence: number;
  events: FormsmithRunEvent[];
  controller: AbortController;
  aborted: boolean;
  driving: boolean;
  context: FormsmithArtifactContext | null;
  createdAt: number;
  updatedAt: number;
}

interface StoredRun {
  version: 1;
  runId: string;
  userId: number;
  conversationPublicId: string;
  request: FormsmithRequest;
  status: RunStatus;
  sequence: number;
  events: FormsmithRunEvent[];
  context: FormsmithArtifactContext | null;
  createdAt: number;
  updatedAt: number;
}

const globals = globalThis as typeof globalThis & {
  __breadboardFormsmithRuns?: Map<string, RunState>;
};
const runs = globals.__breadboardFormsmithRuns ?? new Map<string, RunState>();
globals.__breadboardFormsmithRuns = runs;

const MAX_EVENTS = 500;
const MAX_BINDING_BYTES = 512 * 1024;
const RETENTION_MS = 30 * 60 * 1000;
const MAX_ACTIVE_AGE_MS = 2 * 60 * 60 * 1_000 + 30 * 60 * 1_000;
const TERMINAL = new Set<RunStatus>(["completed", "failed", "aborted"]);
const RUN_ID = /^fmsrun_[a-f0-9]{32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value);
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function bindingsRoot(): string {
  const root = path.join(dashboardDataDir(), "runtime-v2-formsmith-runs");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const metadata = fs.lstatSync(root);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(root), root)
  ) throw new Error("The Formsmith recovery store is unavailable.");
  return root;
}

function userBindingsRoot(userId: number, create: boolean): string {
  const root = path.join(bindingsRoot(), String(userId));
  if (create && !fs.existsSync(root)) {
    try {
      fs.mkdirSync(root, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
  const metadata = fs.lstatSync(root);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(root), root)
  ) throw new Error("The Formsmith user recovery store is unavailable.");
  return root;
}

function bindingPath(userId: number, runId: string, createUser = false): string {
  if (!Number.isSafeInteger(userId) || userId < 1 || !RUN_ID.test(runId)) {
    throw new TypeError("The Formsmith recovery identity is invalid.");
  }
  let root: string;
  try {
    root = userBindingsRoot(userId, createUser);
  } catch (error) {
    if (!createUser && error instanceof Error && "code" in error && error.code === "ENOENT") {
      return path.join(bindingsRoot(), String(userId), `${runId}.json`);
    }
    throw error;
  }
  return path.join(root, `${runId}.json`);
}

function storedRun(run: RunState): StoredRun {
  return {
    version: 1,
    runId: run.runId,
    userId: run.userId,
    conversationPublicId: run.conversationPublicId,
    request: run.request,
    status: run.status,
    sequence: run.sequence,
    events: run.events,
    context: run.context,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function persist(run: RunState, strict = false): void {
  try {
    run.updatedAt = Date.now();
    const target = bindingPath(run.userId, run.runId, true);
    const bytes = Buffer.from(`${JSON.stringify(storedRun(run))}\n`, "utf8");
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_BINDING_BYTES) {
      throw new Error("The Formsmith recovery projection exceeded its bound.");
    }
    const pending = path.join(path.dirname(target), `.${run.runId}.${randomUUID()}.pending`);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(pending, "wx", 0o600);
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(pending, target);
    } catch (error) {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      fs.rmSync(pending, { force: true });
      throw error;
    }
  } catch (error) {
    if (strict) throw error;
  }
}

function validRequest(value: unknown): value is FormsmithRequest {
  return exactRecord(value, ["uploadId", "filename", "sizeBytes"]) &&
    typeof value.uploadId === "string" &&
    /^[a-f0-9]{32}$/.test(value.uploadId) &&
    boundedText(value.filename, 200) &&
    typeof value.sizeBytes === "number" &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    value.sizeBytes <= 20 * 1024 * 1024;
}

function validEvent(value: unknown): value is FormsmithRunEvent {
  return exactRecord(value, ["sequenceNumber", "type", "payload", "at"]) &&
    typeof value.sequenceNumber === "number" &&
    Number.isSafeInteger(value.sequenceNumber) &&
    value.sequenceNumber > 0 &&
    boundedText(value.type, 128) &&
    isRecord(value.payload) &&
    boundedText(value.at, 64) &&
    Number.isFinite(Date.parse(value.at));
}

function validContext(value: unknown, stored: {
  userId: number;
  conversationPublicId: string;
  runId: string;
}): value is FormsmithArtifactContext | null {
  if (value === null) return true;
  if (!exactRecord(value, [
    "userId",
    "conversationPublicId",
    "runtimeSessionId",
    "hermesSessionId",
    "conversationId",
    "clusterId",
    "surface",
    "runId",
    "agentRunId",
    "assistantMessageId",
  ])) return false;
  return value.userId === stored.userId &&
    value.conversationPublicId === stored.conversationPublicId &&
    value.agentRunId === stored.runId &&
    typeof value.runtimeSessionId === "number" &&
    Number.isSafeInteger(value.runtimeSessionId) && value.runtimeSessionId > 0 &&
    boundedText(value.hermesSessionId, 512) &&
    typeof value.conversationId === "number" &&
    Number.isSafeInteger(value.conversationId) && value.conversationId > 0 &&
    (value.clusterId === null || (typeof value.clusterId === "number" &&
      Number.isSafeInteger(value.clusterId) && value.clusterId > 0)) &&
    ["dashboard_terminal", "garden_chat"].includes(String(value.surface)) &&
    boundedText(value.runId, 256) &&
    (value.assistantMessageId === null ||
      (typeof value.assistantMessageId === "number" &&
        Number.isSafeInteger(value.assistantMessageId) && value.assistantMessageId > 0));
}

function parseStoredRun(value: unknown, expectedUserId?: number): StoredRun | null {
  if (!exactRecord(value, [
    "version",
    "runId",
    "userId",
    "conversationPublicId",
    "request",
    "status",
    "sequence",
    "events",
    "context",
    "createdAt",
    "updatedAt",
  ]) ||
    value.version !== 1 ||
    !RUN_ID.test(String(value.runId)) ||
    typeof value.userId !== "number" ||
    !Number.isSafeInteger(value.userId) ||
    value.userId < 1 ||
    (expectedUserId !== undefined && value.userId !== expectedUserId) ||
    !boundedText(value.conversationPublicId, 256) ||
    !validRequest(value.request) ||
    !["queued", "running", "completed", "failed", "aborted"].includes(String(value.status)) ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    !Array.isArray(value.events) ||
    value.events.length > MAX_EVENTS ||
    !value.events.every(validEvent) ||
    value.events.some((event, index) => event.sequenceNumber !== index + 1) ||
    value.sequence !== value.events.length ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 1 ||
    typeof value.updatedAt !== "number" ||
    !Number.isSafeInteger(value.updatedAt) ||
    value.updatedAt < value.createdAt
  ) return null;
  const identity = {
    userId: value.userId as number,
    conversationPublicId: value.conversationPublicId as string,
    runId: value.runId as string,
  };
  if (!validContext(value.context, identity)) return null;
  return value as unknown as StoredRun;
}

function readStoredRun(userId: number, runId: string): StoredRun | null {
  const target = bindingPath(userId, runId);
  try {
    const metadata = fs.lstatSync(target);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1 ||
      metadata.size > MAX_BINDING_BYTES ||
      !samePath(fs.realpathSync.native(target), target)
    ) return null;
    const bytes = fs.readFileSync(target);
    if (bytes.byteLength !== metadata.size) return null;
    return parseStoredRun(JSON.parse(bytes.toString("utf8")), userId);
  } catch {
    return null;
  }
}

function restore(stored: StoredRun): RunState {
  return {
    runId: stored.runId,
    userId: stored.userId,
    conversationPublicId: stored.conversationPublicId,
    request: stored.request,
    label: formsmithRunLabel(stored.request),
    status: stored.status,
    sequence: stored.sequence,
    events: stored.events,
    controller: new AbortController(),
    aborted: stored.status === "aborted",
    driving: false,
    context: stored.context,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) {
    // The fixed Formsmith protocol emits fewer than ten events. Treat any
    // future unbounded producer as a terminal failure instead of breaking
    // durable sequence identity by trimming the beginning.
    throw new Error("Formsmith emitted too many progress events.");
  }
  persist(run);
}

function stageAlreadyPublished(run: RunState, candidate: FormsmithRuntimeStage): boolean {
  return run.events.some((event) =>
    event.type === "stage.updated" &&
    event.payload.stage === candidate.stage &&
    event.payload.status === candidate.status);
}

function requireRun(userId: number, runId: string): RunState {
  let run = runs.get(runId);
  if (!run) {
    const stored = readStoredRun(userId, runId);
    if (!stored) throw new Error("run_not_found");
    run = restore(stored);
    runs.set(runId, run);
    if (!TERMINAL.has(run.status)) queueMicrotask(() => void drive(run!));
  }
  if (run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function activeRun(): RunState | null {
  return [...runs.values()].find((run) => !TERMINAL.has(run.status)) ?? null;
}

function durableActiveRunExists(): boolean {
  const cutoff = Date.now() - MAX_ACTIVE_AGE_MS;
  let root: string;
  try {
    root = bindingsRoot();
  } catch {
    return false;
  }
  let inspected = 0;
  for (const userName of fs.readdirSync(root)) {
    if (!/^\d+$/.test(userName)) continue;
    const userId = Number(userName);
    const userRoot = path.join(root, userName);
    let files: string[];
    try {
      const metadata = fs.lstatSync(userRoot);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) continue;
      files = fs.readdirSync(userRoot);
    } catch {
      continue;
    }
    for (const name of files) {
      inspected += 1;
      if (inspected > 10_000) return true;
      const match = /^(fmsrun_[a-f0-9]{32})\.json$/.exec(name);
      if (!match) continue;
      const stored = readStoredRun(userId, match[1]);
      if (stored && !TERMINAL.has(stored.status) && stored.updatedAt >= cutoff) return true;
    }
  }
  return false;
}

export function startFormsmithRun(input: {
  userId: number;
  conversationPublicId: string;
  request: FormsmithRequest;
}): { runId: string; status: RunStatus } {
  // ShapeR keeps several large models resident on one CUDA device. Preserve
  // the immediate single-run refusal in addition to native concurrency=1.
  if (activeRun() || durableActiveRunExists()) {
    throw new Error("Formsmith is already reconstructing another picture.");
  }
  const source = resolveFormsmithUpload(input.userId, input.request.uploadId);
  if (!source) throw new Error("That uploaded picture is no longer available. Choose it again.");

  const runId = `fmsrun_${randomUUID().replaceAll("-", "")}`;
  const now = Date.now();
  const run: RunState = {
    runId,
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    request: input.request,
    label: formsmithRunLabel(input.request),
    status: "queued",
    sequence: 0,
    events: [],
    controller: new AbortController(),
    aborted: false,
    driving: false,
    context: null,
    createdAt: now,
    updatedAt: now,
  };
  runs.set(runId, run);
  run.context = openFormsmithArtifactContext({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    label: run.label,
    agentRunId: runId,
  });
  try {
    persist(run, true);
  } catch (error) {
    runs.delete(runId);
    closeFormsmithArtifactContext(run.context, "failed");
    throw error;
  }
  void drive(run);
  return { runId, status: "queued" };
}

async function drive(run: RunState): Promise<void> {
  if (run.driving || TERMINAL.has(run.status)) return;
  run.driving = true;
  if (!run.events.some((event) => event.type === "run.started")) {
    run.status = "running";
    emit(run, "run.started", { label: run.label, filename: run.request.filename });
  }
  const source = resolveFormsmithUpload(run.userId, run.request.uploadId) ?? "";
  try {
    const result = await runFormsmithViaRuntime({
      userId: run.userId,
      conversationId: run.conversationPublicId,
      runId: run.runId,
      request: run.request,
      sourcePath: source,
      signal: run.controller.signal,
      onStage(stage) {
        if (!TERMINAL.has(run.status) && !stageAlreadyPublished(run, stage)) {
          emit(run, "stage.updated", { ...stage });
        }
      },
    });
    if (!run.aborted && !TERMINAL.has(run.status)) await complete(run, result);
    else result.cleanup();
  } catch (error) {
    if (!run.aborted && !TERMINAL.has(run.status)) {
      fail(run, error instanceof Error ? error.message : "ShapeR could not reconstruct the picture.");
    }
  } finally {
    run.driving = false;
  }
}

async function complete(run: RunState, result: FormsmithRuntimeResult): Promise<void> {
  if (TERMINAL.has(run.status)) {
    result.cleanup();
    return;
  }
  let artifactId: string | null = null;
  let artifactError: string | null = null;
  try {
    if (run.context) {
      const existing = findPublishedFormsmithMesh(run.context);
      artifactId = existing?.id ?? (await publishFormsmithMesh({
        context: run.context,
        workspace: result.meshRoot,
        meshPath: result.meshPath,
        sourceFilename: run.request.filename,
      })).id;
    } else {
      artifactError = "This conversation had no artifact session, so the GLB could not be attached.";
    }
  } catch (error) {
    artifactError = error instanceof Error ? error.message : "The GLB could not be attached.";
  } finally {
    result.cleanup();
  }
  closeFormsmithArtifactContext(run.context, "completed");
  run.context = null;
  run.status = "completed";
  emit(run, "run.completed", {
    summary: artifactId
      ? `Formsmith reconstructed **${run.request.filename}** as a 3D model with ShapeR. The GLB is attached below.`
      : `ShapeR reconstructed **${run.request.filename}**, but Breadboard could not attach the GLB.${artifactError ? ` ${artifactError}` : ""}`,
    artifactId,
    sizeBytes: result.sizeBytes,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
}

function fail(run: RunState, error: string): void {
  if (TERMINAL.has(run.status)) return;
  run.status = "failed";
  closeFormsmithArtifactContext(run.context, "failed");
  run.context = null;
  emit(run, "run.failed", {
    error,
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
}

function scheduleCleanup(run: RunState): void {
  const timer = setTimeout(() => {
    runs.delete(run.runId);
    try {
      const target = bindingPath(run.userId, run.runId);
      const metadata = fs.lstatSync(target);
      if (metadata.isFile() && !metadata.isSymbolicLink()) fs.rmSync(target, { force: true });
    } catch {
      // A restored transcript already carries terminal content.
    }
  }, RETENTION_MS);
  timer.unref?.();
}

export function getFormsmithEventsSince(
  userId: number,
  runId: string,
  since = 0,
): FormsmithRunEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isFormsmithTerminal(userId: number, runId: string): boolean {
  return TERMINAL.has(requireRun(userId, runId).status);
}

export function abortFormsmithRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (TERMINAL.has(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  run.controller.abort(new DOMException("Formsmith stopped", "AbortError"));
  void cancelFormsmithRuntimeRun({
    userId: run.userId,
    conversationId: run.conversationPublicId,
    runId: run.runId,
  }).catch(() => undefined);
  closeFormsmithArtifactContext(run.context, "aborted");
  run.context = null;
  emit(run, "run.aborted", {
    summary: "Formsmith stopped before the 3D reconstruction finished.",
    elapsedSec: (Date.now() - run.createdAt) / 1_000,
  });
  scheduleCleanup(run);
  return true;
}

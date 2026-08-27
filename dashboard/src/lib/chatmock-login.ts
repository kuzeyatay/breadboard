// Authenticated Runtime-owned ChatMock login control.
//
// The dashboard never launches ChatMock or Python. It submits a closed Runtime
// job, records only that opaque job identity under Runtime data, and reads the
// worker's fenced checkpoint while the browser completes OAuth.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  RuntimeJobControlError,
  cancelRuntimeJob,
  inspectRuntimeJob,
  isRuntimeV2ServiceControlConfigured,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
} from "./supervisor-control.ts";
import { RuntimeAuthorityUnavailableError } from "./runtime-v2/authority-error.ts";
import { dashboardDataDir, runtimeV2ServiceRoot } from "./runtime-paths.ts";

export type ChatmockLoginStatus =
  | "idle"
  | "awaiting_authorization"
  | "completed"
  | "failed"
  | "cancelled";

export interface ChatmockLoginState {
  status: ChatmockLoginStatus;
  authorizationUrl: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

interface LoginPointer {
  protocolVersion: 1;
  jobId: string;
  submittedAt: string;
  terminal: ChatmockLoginState | null;
}

const PORT_IN_USE_EXIT_CODE = 13;
const URL_WAIT_MS = 22_000;
const POLL_MS = 250;
const MAX_POINTER_BYTES = 32 * 1024;
const MAX_CHECKPOINT_BYTES = 32 * 1024;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const TERMINAL = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const starts = new Map<number, Promise<ChatmockLoginState>>();

const IDLE: ChatmockLoginState = {
  status: "idle",
  authorizationUrl: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validTimestamp(value: unknown, nullable: boolean): value is string | null {
  return (nullable && value === null) ||
    (typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)));
}

function validLoginState(value: unknown): value is ChatmockLoginState {
  if (
    !exactRecord(value, ["status", "authorizationUrl", "startedAt", "finishedAt", "error"]) ||
    !["idle", "awaiting_authorization", "completed", "failed", "cancelled"].includes(
      value.status as string,
    ) ||
    !validTimestamp(value.startedAt, true) ||
    !validTimestamp(value.finishedAt, true) ||
    (value.authorizationUrl !== null &&
      (typeof value.authorizationUrl !== "string" ||
        !value.authorizationUrl.startsWith("https://") ||
        Buffer.byteLength(value.authorizationUrl, "utf8") > 16 * 1024)) ||
    (value.error !== null &&
      (typeof value.error !== "string" || Buffer.byteLength(value.error, "utf8") > 8_000))
  ) return false;
  if (value.status === "idle") {
    return value.authorizationUrl === null && value.startedAt === null && value.finishedAt === null;
  }
  if (value.startedAt === null) return false;
  if (value.status === "awaiting_authorization") return value.finishedAt === null;
  return value.finishedAt !== null && value.authorizationUrl === null;
}

function authority(userId: number): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("ChatMock login user scope is invalid.");
  }
  return { userId, gardenId: null, conversationId: null };
}

function assertSnapshot(snapshot: RuntimeJobSnapshot): void {
  if (
    snapshot.jobType !== "chatmock-login" ||
    snapshot.workerKind !== "chatmock-login-node" ||
    snapshot.resourceClass !== "core" ||
    snapshot.gardenId !== null ||
    snapshot.conversationId !== null
  ) throw new Error("Runtime returned an invalid ChatMock login job.");
}

function pointerPath(userId: number): string {
  authority(userId);
  return path.join(runtimeV2ServiceRoot("chatmock-login"), "users", String(userId), "current.json");
}

function checkpointPath(jobId: string): string {
  if (!IDENTIFIER.test(jobId)) throw new Error("The ChatMock login job identity is invalid.");
  return path.join(dashboardDataDir(), "runtime", "jobs", jobId, "checkpoint.json");
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function ensureDirectDirectory(directory: string): void {
  const serviceRoot = runtimeV2ServiceRoot("chatmock-login");
  const relative = path.relative(serviceRoot, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The ChatMock login state directory escaped Runtime data.");
  }
  fs.mkdirSync(serviceRoot, { recursive: true, mode: 0o700 });
  const validate = (candidate: string) => {
    const metadata = fs.lstatSync(candidate);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      !samePath(fs.realpathSync.native(candidate), candidate)
    ) {
      throw new Error("The ChatMock login state directory is unavailable.");
    }
  };
  validate(serviceRoot);
  let current = serviceRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const existing = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!existing) fs.mkdirSync(current, { mode: 0o700 });
    validate(current);
  }
}

function readBoundedJson(filePath: string, maximumBytes: number): unknown {
  const metadata = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) return null;
  try {
    if (!samePath(fs.realpathSync.native(filePath), filePath)) return null;
    const bytes = fs.readFileSync(filePath);
    if (bytes.byteLength !== metadata.size || bytes.byteLength > maximumBytes) return null;
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

function readPointer(userId: number): LoginPointer | null {
  const value = readBoundedJson(pointerPath(userId), MAX_POINTER_BYTES);
  if (
    !exactRecord(value, ["protocolVersion", "jobId", "submittedAt", "terminal"]) ||
    value.protocolVersion !== 1 ||
    typeof value.jobId !== "string" ||
    !IDENTIFIER.test(value.jobId) ||
    !validTimestamp(value.submittedAt, false) ||
    (value.terminal !== null && !validLoginState(value.terminal))
  ) return null;
  return value as unknown as LoginPointer;
}

function writePointer(userId: number, pointer: LoginPointer): void {
  const target = pointerPath(userId);
  ensureDirectDirectory(path.dirname(target));
  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error("The ChatMock login pointer is indirect.");
  }
  const bytes = Buffer.from(`${JSON.stringify(pointer)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_POINTER_BYTES) {
    throw new Error("The ChatMock login pointer exceeded its bound.");
  }
  const pending = `${target}.pending.${randomUUID()}`;
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
}

function readCheckpoint(
  pointer: LoginPointer,
  expected?: RuntimeJobSnapshot,
): ChatmockLoginState | null {
  const value = readBoundedJson(checkpointPath(pointer.jobId), MAX_CHECKPOINT_BYTES);
  if (
    !exactRecord(value, ["protocolVersion", "identity", "snapshot"]) ||
    value.protocolVersion !== 1 ||
    !exactRecord(value.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    value.identity.jobId !== pointer.jobId ||
    !Number.isSafeInteger(value.identity.attempt) ||
    (value.identity.attempt as number) < 1 ||
    typeof value.identity.workerInstanceId !== "string" ||
    !IDENTIFIER.test(value.identity.workerInstanceId) ||
    (expected !== undefined &&
      (value.identity.attempt !== expected.attempt ||
        value.identity.workerInstanceId !== expected.workerInstanceId)) ||
    !validLoginState(value.snapshot)
  ) return null;
  return { ...(value.snapshot as unknown as ChatmockLoginState) };
}

function queuedState(pointer: LoginPointer): ChatmockLoginState {
  return {
    status: "awaiting_authorization",
    authorizationUrl: null,
    startedAt: pointer.submittedAt,
    finishedAt: null,
    error: null,
  };
}

/** First HTTPS URL on the stream that carries OAuth authorize parameters. */
export function extractAuthorizationUrl(output: string): string | null {
  for (const candidate of output.match(/https:\/\/[^\s"'<>]+/g) ?? []) {
    if (
      Buffer.byteLength(candidate, "utf8") <= 16 * 1024 &&
      /[?&]client_id=/.test(candidate) &&
      /[?&]code_challenge=/.test(candidate)
    ) return candidate;
  }
  return null;
}

export function describeLoginExit(code: number | null, output: string): string {
  if (code === PORT_IN_USE_EXIT_CODE) {
    return "Port 1455 is already in use, so the sign-in callback could not start. Close the other login attempt and try again.";
  }
  const reported = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^ERROR:/i.test(line))
    .at(-1);
  if (reported) return reported.replace(/^ERROR:\s*/i, "");
  return `The ChatMock sign-in exited with code ${code ?? "unknown"} before completing.`;
}

/** Synchronous durable view used by settings payloads and pure unit tests. */
export function readChatmockLoginState(userId?: number): ChatmockLoginState {
  if (userId === undefined) return { ...IDLE };
  const pointer = readPointer(userId);
  if (!pointer) return { ...IDLE };
  if (pointer.terminal) return { ...pointer.terminal };
  return readCheckpoint(pointer) ?? queuedState(pointer);
}

function resultState(job: RuntimeJobSnapshot, content: unknown): ChatmockLoginState | null {
  if (
    !exactRecord(content, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    content.protocolVersion !== 1 ||
    content.completionSequence !== job.lastWorkerSequence ||
    !exactRecord(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !validLoginState(content.result)
  ) return null;
  return { ...(content.result as unknown as ChatmockLoginState) };
}

function snapshotFailure(pointer: LoginPointer, snapshot: RuntimeJobSnapshot): ChatmockLoginState {
  return {
    status: snapshot.state === "cancelled" ? "cancelled" : "failed",
    authorizationUrl: null,
    startedAt: pointer.submittedAt,
    finishedAt: new Date().toISOString(),
    error: snapshot.state === "cancelled"
      ? null
      : snapshot.state === "resource_exhausted"
        ? "Windows commit headroom is too low to start ChatMock sign-in."
        : snapshot.failureMessage ?? "The ChatMock sign-in was interrupted.",
  };
}

/** Reconcile the durable checkpoint with Runtime's authoritative job state. */
export async function refreshChatmockLoginState(userId: number): Promise<ChatmockLoginState> {
  const pointer = readPointer(userId);
  if (!pointer) return { ...IDLE };
  if (pointer.terminal) return { ...pointer.terminal };
  const jobAuthority = authority(userId);
  const snapshot = await inspectRuntimeJob(jobAuthority, pointer.jobId);
  assertSnapshot(snapshot);
  const checkpoint = readCheckpoint(pointer, snapshot);
  if (!TERMINAL.has(snapshot.state)) return checkpoint ?? queuedState(pointer);
  let terminal = checkpoint && checkpoint.status !== "awaiting_authorization"
    ? checkpoint
    : null;
  if (!terminal && snapshot.state === "succeeded") {
    terminal = resultState(
      snapshot,
      (await readRuntimeJobOutput(jobAuthority, pointer.jobId, "result")).content,
    );
  }
  terminal ??= snapshotFailure(pointer, snapshot);
  writePointer(userId, { ...pointer, terminal });
  return terminal;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const abort = () => done(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
    timer.unref?.();
  });
}

async function waitForAuthorization(
  userId: number,
  jobId: string,
  signal?: AbortSignal,
): Promise<ChatmockLoginState> {
  const deadline = Date.now() + URL_WAIT_MS;
  while (Date.now() < deadline) {
    const pointer = readPointer(userId);
    if (!pointer || pointer.jobId !== jobId) {
      throw new Error("The ChatMock login pointer changed unexpectedly.");
    }
    const state = await refreshChatmockLoginState(userId);
    if (state.authorizationUrl || state.status !== "awaiting_authorization") return state;
    await delay(POLL_MS, signal);
  }
  await cancelRuntimeJob(authority(userId), jobId).catch(() => undefined);
  const pointer = readPointer(userId);
  const failed: ChatmockLoginState = {
    status: "failed",
    authorizationUrl: null,
    startedAt: pointer?.submittedAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: "ChatMock did not report an authorization URL.",
  };
  if (pointer?.jobId === jobId) writePointer(userId, { ...pointer, terminal: failed });
  return failed;
}

async function startChatmockLoginOnce(
  userId: number,
  signal?: AbortSignal,
): Promise<ChatmockLoginState> {
  if (!isRuntimeV2ServiceControlConfigured()) {
    throw new RuntimeAuthorityUnavailableError(
      "ChatMock sign-in requires the Breadboard Runtime job owner.",
    );
  }
  const existing = readPointer(userId);
  if (existing && !existing.terminal) {
    try {
      const state = await refreshChatmockLoginState(userId);
      if (state.status === "awaiting_authorization") {
        return state.authorizationUrl
          ? state
          : await waitForAuthorization(userId, existing.jobId, signal);
      }
    } catch (error) {
      if (!(error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND")) {
        throw error;
      }
    }
  }
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const jobAuthority = authority(userId);
  const snapshot = await submitRuntimeJob(jobAuthority, {
    jobType: "chatmock-login",
    idempotencyKey: `chatmock-login-${randomUUID()}`,
    requestPayload: { protocolVersion: 1, operation: "login" },
  });
  assertSnapshot(snapshot);
  const pointer: LoginPointer = {
    protocolVersion: 1,
    jobId: snapshot.jobId,
    submittedAt: new Date().toISOString(),
    terminal: null,
  };
  writePointer(userId, pointer);
  try {
    return await waitForAuthorization(userId, snapshot.jobId, signal);
  } catch (error) {
    if (signal?.aborted) {
      await cancelRuntimeJob(jobAuthority, snapshot.jobId).catch(() => undefined);
    }
    throw error;
  }
}

/** Submit one login attempt; duplicate clicks share the same user-scoped job. */
export async function startChatmockLogin(
  userId: number,
  signal?: AbortSignal,
): Promise<ChatmockLoginState> {
  const active = starts.get(userId);
  if (active) return active;
  const started = startChatmockLoginOnce(userId, signal).finally(() => {
    if (starts.get(userId) === started) starts.delete(userId);
  });
  starts.set(userId, started);
  return started;
}

/** Request Runtime cancellation; Native remains the final process-tree owner. */
export async function cancelChatmockLogin(userId: number): Promise<ChatmockLoginState> {
  const pointer = readPointer(userId);
  if (!pointer || pointer.terminal) return readChatmockLoginState(userId);
  const snapshot = await cancelRuntimeJob(authority(userId), pointer.jobId);
  assertSnapshot(snapshot);
  const cancelled: ChatmockLoginState = {
    status: "cancelled",
    authorizationUrl: null,
    startedAt: pointer.submittedAt,
    finishedAt: new Date().toISOString(),
    error: null,
  };
  writePointer(userId, { ...pointer, terminal: cancelled });
  return cancelled;
}

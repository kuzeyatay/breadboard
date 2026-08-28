import "server-only";

import {
  fork,
  type ChildProcess,
  type ForkOptions,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after } from "next/server";

import type { StartLearnOperationRequest } from "@/lib/learn-operation-mode";

type SettledLearnTask<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export type LearnTaskHandoff<T> =
  | { accepted: true; jobId?: string | null }
  | { accepted: false; value: T };

interface LearnWorkerCommonRequest {
  gardenId: string;
  userId: number;
  contentPath: string;
}

interface LearnWorkerModelRequest extends LearnWorkerCommonRequest {
  baseURL: string;
  model: string;
}

export type LearnWorkerRequest =
  | (LearnWorkerCommonRequest & {
      operation: "confirm";
      expectedModel: string;
      proposedLearningMapId: string;
    })
  | (LearnWorkerModelRequest & {
      operation: "plan";
      includedSourceIds: string[];
      syllabusSourceId: string | null;
      sourceOnly: boolean;
      includeSourceSnapshots: boolean;
      autoConfirmTopicMap: boolean;
    })
  | (LearnWorkerModelRequest & {
      operation: "generate";
      expectedModel: string;
      requestedConfirmedLearningMapId: string;
      includedSourceIds?: string[];
      sourceOnly: boolean;
      includeSourceSnapshots: boolean;
    })
  | (LearnWorkerModelRequest & {
      operation: "confirm_generate";
      expectedModel: string;
      proposedLearningMapId: string;
      sourceOnly: boolean;
      includeSourceSnapshots: boolean;
    })
  | (LearnWorkerModelRequest & {
      operation: "repair";
      request: StartLearnOperationRequest;
    })
  | (LearnWorkerModelRequest & {
      operation: "rebuild";
      includedSourceIds?: string[];
      syllabusSourceId?: string;
      sourceOnly: boolean;
      includeSourceSnapshots: boolean;
    })
  | (LearnWorkerCommonRequest & {
      operation: "humanizer";
      enabled: boolean;
      expectedVersionId?: string;
    });

const LEARN_WORKER_PROTOCOL_VERSION = 1 as const;
const LEARN_WORKER_STARTUP_TIMEOUT_MS = 3 * 60_000;
const WINDOWS_WORKER_EXIT_TIMEOUT_MS = 5_000;
const CHILD_PROCESS_EXIT_TIMEOUT_MS = 5_000;
const WORKER_LOG_RETENTION_MS = 14 * 24 * 60 * 60_000;
const WORKER_LOG_RETENTION_COUNT = 100;
const ORPHANED_WORKER_CLAIM_RETENTION_MS = 60_000;

interface LearnWorkerEnvelope {
  protocolVersion: typeof LEARN_WORKER_PROTOCOL_VERSION;
  requestId: string;
  operation: LearnWorkerRequest["operation"];
  gardenId: string;
}

interface LearnWorkerReadyMessage extends LearnWorkerEnvelope {
  type: "ready";
  jobId: string;
}

interface LearnWorkerCompletedMessage extends LearnWorkerEnvelope {
  type: "completed";
  value: unknown;
}

interface LearnWorkerFailedMessage extends LearnWorkerEnvelope {
  type: "failed";
  error: {
    name: string;
    message: string;
    requiresReplan?: boolean;
  };
}

type LearnWorkerMessage =
  | LearnWorkerReadyMessage
  | LearnWorkerCompletedMessage
  | LearnWorkerFailedMessage;

/** A worker-side preflight conflict retains normal HTTP 409 semantics. */
export class LearnWorkerConflictError extends Error {
  readonly requiresReplan: boolean;

  constructor(message: string, requiresReplan = false) {
    super(message);
    this.name = "LearnWorkerConflictError";
    this.requiresReplan = requiresReplan;
  }
}

/** A worker-side scoped-repair conflict retains normal HTTP 409 semantics. */
export class LearnWorkerRepairPendingMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnWorkerRepairPendingMapError";
  }
}

function isWorkerMessage(
  value: unknown,
  expected: {
    requestId: string;
    operation: LearnWorkerRequest["operation"];
    gardenId: string;
  },
): value is LearnWorkerMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Partial<LearnWorkerEnvelope>;
  if (
    envelope.protocolVersion !== LEARN_WORKER_PROTOCOL_VERSION ||
    envelope.requestId !== expected.requestId ||
    envelope.operation !== expected.operation ||
    envelope.gardenId !== expected.gardenId
  ) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (type === "ready") {
    const jobId = (value as { jobId?: unknown }).jobId;
    return typeof jobId === "string" && jobId.trim().length > 0;
  }
  if (type === "completed") return "value" in value;
  if (type !== "failed") return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(
    error &&
      typeof error === "object" &&
      !Array.isArray(error) &&
      typeof (error as { name?: unknown }).name === "string" &&
      typeof (error as { message?: unknown }).message === "string",
  );
}

function dashboardDevelopmentRoot(): string | null {
  const configuredWorkerRoot = process.env.BREADBOARD_LEARN_WORKER_DASHBOARD_ROOT?.trim();
  const configured = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR?.trim();
  const candidates = [
    configuredWorkerRoot,
    configured,
    process.cwd(),
    path.join(process.cwd(), "dashboard"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    const sourceRoot = process.env.BREADBOARD_LEARN_SOURCE_ROOT?.trim()
      ? path.resolve(process.env.BREADBOARD_LEARN_SOURCE_ROOT.trim())
      : path.join(root, "src");
    if (
      fs.existsSync(path.join(root, "scripts", "learn-worker.mjs")) &&
      fs.existsSync(path.join(root, "scripts", "learn-worker-import-hook.mjs")) &&
      fs.existsSync(path.join(sourceRoot, "lib", "learn.ts"))
    ) {
      return root;
    }
  }
  return null;
}

function learnWorkerRuntimeRoot(dashboardRoot: string): string {
  const configured = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(path.dirname(dashboardRoot), ".runtime", "learn-workers");
}

function assertDedicatedWorkerNodeVersion(): void {
  const [major = 0, minor = 0] = process.versions.node
    .split(".")
    .slice(0, 2)
    .map((part) => Number.parseInt(part, 10));
  const supported =
    (major === 22 && minor >= 15) ||
    (major === 23 && minor >= 5) ||
    major >= 24;
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !supported
  ) {
    throw new Error(
      "Dedicated Learn workers require Node.js 22.15+, 23.5+, or 24+ for synchronous module hooks and native TypeScript execution.",
    );
  }
}

function workerFailure(error: LearnWorkerFailedMessage["error"]): Error {
  if (error.name === "LearnPipelineConflictError") {
    return new LearnWorkerConflictError(error.message, error.requiresReplan === true);
  }
  if (error.name === "LearnRepairPendingMapError") {
    return new LearnWorkerRepairPendingMapError(error.message);
  }
  const failure = new Error(error.message);
  failure.name = error.name || "LearnWorkerError";
  return failure;
}

function workerCleanupFailure(
  message: string,
  workerError: unknown,
  cleanupError: unknown,
): AggregateError {
  return new AggregateError([workerError, cleanupError], message, {
    cause: cleanupError,
  });
}

function readWorkerReadyReceipt(
  receiptPath: string,
  expected: {
    requestId: string;
    operation: LearnWorkerRequest["operation"];
    gardenId: string;
  },
): LearnWorkerReadyMessage | null {
  const parsed = readWorkerReceipt(receiptPath, expected);
  return parsed?.type === "ready" ? parsed : null;
}

function readWorkerReceipt(
  receiptPath: string,
  expected: {
    requestId: string;
    operation: LearnWorkerRequest["operation"];
    gardenId: string;
  },
): LearnWorkerMessage | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as unknown;
    return isWorkerMessage(parsed, expected) ? parsed : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function childProcessHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null || child.pid === undefined;
}

function waitForChildProcessExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (childProcessHasExited(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timeout);
      child.removeListener("exit", finish);
      resolve();
    };
    const timeout = setTimeout(() => {
      child.removeListener("exit", finish);
      reject(
        new Error(
          `The dedicated Learn worker ${child.pid ?? "unknown"} did not exit within ${timeoutMs} milliseconds.`,
        ),
      );
    }, timeoutMs);
    child.once("exit", finish);
    if (childProcessHasExited(child)) finish();
  });
}

async function terminateChildProcessAndWait(child: ChildProcess): Promise<void> {
  if (childProcessHasExited(child)) return;
  child.kill();
  try {
    await waitForChildProcessExit(child, CHILD_PROCESS_EXIT_TIMEOUT_MS);
  } catch (terminationError) {
    child.kill("SIGKILL");
    try {
      await waitForChildProcessExit(child, CHILD_PROCESS_EXIT_TIMEOUT_MS);
    } catch (killError) {
      throw new AggregateError(
        [terminationError, killError],
        "The dedicated Learn worker ignored both its bounded termination and kill windows.",
        { cause: killError },
      );
    }
  }
}

async function awaitChildProcessExitOrTerminate(child: ChildProcess): Promise<void> {
  try {
    await waitForChildProcessExit(child, CHILD_PROCESS_EXIT_TIMEOUT_MS);
  } catch {
    await terminateChildProcessAndWait(child);
  }
}

function workerMarkerIsActive(markerPath: string): boolean {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as {
      pid?: unknown;
      state?: unknown;
      nonce?: unknown;
      requestId?: unknown;
      protocolVersion?: unknown;
    };
    const validEnvelope =
      marker.protocolVersion === LEARN_WORKER_PROTOCOL_VERSION &&
      typeof marker.requestId === "string" &&
      marker.requestId.length > 0 &&
      typeof marker.nonce === "string" &&
      marker.nonce.length > 0;
    if (validEnvelope && marker.state === "launching") {
      // A dead parent does not prove its just-created breakaway worker is dead.
      // Only the worker's exclusive marker promotion or owner cleanup may end
      // this ambiguous state; reclaiming it could admit two heavy workers.
      return true;
    }
    if (
      validEnvelope &&
      marker.state === "running" &&
      Number.isSafeInteger(marker.pid) &&
      Number(marker.pid) > 0
    ) {
      if (processIsAlive(Number(marker.pid))) return true;
      return false;
    }
  } catch {
    // Invalid ownership is ambiguous and therefore remains fail-closed.
  }
  return true;
}

function removeWorkerMarkerIfOwned(markerPath: string, nonce: string): void {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as {
      nonce?: unknown;
    };
    if (marker.nonce === nonce) fs.rmSync(markerPath, { force: true });
  } catch {
    // Never remove an unreadable marker that a replacement process may own.
  }
}

function acquireWorkerConcurrencyMarker(
  runtimeRoot: string,
  requestId: string,
): { markerPath: string; nonce: string } {
  const markerPath = path.join(runtimeRoot, "learn-worker.active.json");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nonce = randomUUID();
    const claimPath = `${markerPath}.claim-${process.pid}-${nonce}`;
    let linked = false;
    let claimFd: number | undefined;
    try {
      try {
        claimFd = fs.openSync(claimPath, "wx");
        fs.writeFileSync(
          claimFd,
          `${JSON.stringify({
            protocolVersion: LEARN_WORKER_PROTOCOL_VERSION,
            requestId,
            nonce,
            pid: process.pid,
            state: "launching",
            startedAt: new Date().toISOString(),
          })}\n`,
          "utf8",
        );
        fs.fsyncSync(claimFd);
        const completedClaimFd = claimFd;
        claimFd = undefined;
        fs.closeSync(completedClaimFd);
        fs.linkSync(claimPath, markerPath);
        linked = true;
      } finally {
        if (claimFd !== undefined) {
          const incompleteClaimFd = claimFd;
          claimFd = undefined;
          fs.closeSync(incompleteClaimFd);
        }
        try {
          fs.rmSync(claimPath, { force: true });
        } catch {
          // The complete global hard link is authoritative; an orphaned
          // candidate is harmless and pruned independently.
        }
      }
      if (!linked) throw new Error("The global Learn worker claim was not linked.");
      return { markerPath, nonce };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (workerMarkerIsActive(markerPath)) {
        throw new LearnWorkerConflictError(
          "Another Learn worker is already active. Wait for its durable job to settle before starting another garden.",
        );
      }
      const stalePath = `${markerPath}.stale-${process.pid}-${randomUUID()}`;
      try {
        fs.renameSync(markerPath, stalePath);
        if (workerMarkerIsActive(stalePath)) {
          try {
            fs.linkSync(stalePath, markerPath);
          } catch (restoreError) {
            if ((restoreError as NodeJS.ErrnoException).code !== "EEXIST") {
              throw restoreError;
            }
          }
          fs.rmSync(stalePath, { force: true });
          throw new LearnWorkerConflictError(
            "Another Learn worker became active while stale ownership was being checked.",
          );
        }
        fs.rmSync(stalePath, { force: true });
      } catch (reclaimError) {
        if (reclaimError instanceof LearnWorkerConflictError) throw reclaimError;
        if ((reclaimError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new LearnWorkerConflictError(
            "A stale Learn worker marker could not be reclaimed safely.",
          );
        }
      }
    }
  }
  throw new LearnWorkerConflictError(
    "The global Learn worker slot could not be acquired safely.",
  );
}

function pruneWorkerRuntime(runtimeRoot: string): void {
  const now = Date.now();
  const entries = fs.readdirSync(runtimeRoot, { withFileTypes: true });
  const candidates = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^learn-worker-[\w-]+\.(?:log|ready\.json|start\.json)$/.test(entry.name),
    )
    .map((entry) => {
      const filePath = path.join(runtimeRoot, entry.name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const [index, candidate] of candidates.entries()) {
    if (
      index >= WORKER_LOG_RETENTION_COUNT ||
      now - candidate.mtimeMs > WORKER_LOG_RETENTION_MS
    ) {
      fs.rmSync(candidate.filePath, { force: true });
    }
  }
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !/^learn-worker\.active\.json\.(?:claim|promoting)-\d+-[\w-]+$/u.test(
        entry.name,
      )
    ) {
      continue;
    }
    const candidatePath = path.join(runtimeRoot, entry.name);
    try {
      if (
        now - fs.statSync(candidatePath).mtimeMs >
        ORPHANED_WORKER_CLAIM_RETENTION_MS
      ) {
        fs.rmSync(candidatePath, { force: true });
      }
    } catch {
      // A concurrent claimant may still own or have already removed the file.
    }
  }
}

interface WindowsBreakawayProcess {
  pid: number;
  status(): { alive: true; exitCode: null } | { alive: false; exitCode: number };
  waitForExit(timeoutMs: number): number;
  terminateAndWait(timeoutMs: number): number;
  kill(): void;
  close(): void;
}

interface WindowsBreakawayLauncher {
  launchWindowsBreakawayProcess(options: {
    applicationPath: string;
    args: string[];
    cwd: string;
    logPath: string;
  }): WindowsBreakawayProcess;
}

function processOwnedByLaunchError(error: unknown): WindowsBreakawayProcess | null {
  const candidate =
    error && typeof error === "object"
      ? (error as { windowsBreakawayProcess?: unknown }).windowsBreakawayProcess
      : null;
  if (!candidate || typeof candidate !== "object") return null;
  const process = candidate as Partial<WindowsBreakawayProcess>;
  return Number.isSafeInteger(process.pid) &&
    Number(process.pid) > 0 &&
    typeof process.status === "function" &&
    typeof process.waitForExit === "function" &&
    typeof process.terminateAndWait === "function" &&
    typeof process.close === "function"
    ? (process as WindowsBreakawayProcess)
    : null;
}

function windowsBreakawayLauncherPath(dashboardRoot: string): string {
  const candidate = path.join(
    dashboardRoot,
    "scripts",
    "windows-breakaway-process.mjs",
  );
  if (fs.existsSync(candidate)) return path.resolve(candidate);
  throw new Error(
    "The Windows Learn worker breakaway launcher is unavailable; refusing to start a worker tied to the dashboard job.",
  );
}

async function handOffWindowsDedicatedLearnWorker<T>(
  dashboardRoot: string,
  request: LearnWorkerRequest,
  label: string,
): Promise<LearnTaskHandoff<T>> {
  const runtimeRoot = learnWorkerRuntimeRoot(dashboardRoot);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const receiptId = randomUUID();
  pruneWorkerRuntime(runtimeRoot);
  const concurrency = acquireWorkerConcurrencyMarker(runtimeRoot, receiptId);
  const logPath = path.join(runtimeRoot, `learn-worker-${receiptId}.log`);
  const receiptPath = path.join(runtimeRoot, `learn-worker-${receiptId}.ready.json`);
  const startupPath = path.join(runtimeRoot, `learn-worker-${receiptId}.start.json`);
  const startMessage = {
    protocolVersion: LEARN_WORKER_PROTOCOL_VERSION,
    type: "start",
    requestId: receiptId,
    receiptPath,
    concurrencyPath: concurrency.markerPath,
    concurrencyNonce: concurrency.nonce,
    request,
    label,
  };

  let child!: WindowsBreakawayProcess;
  try {
    fs.writeFileSync(startupPath, `${JSON.stringify(startMessage)}\n`, "utf8");
    const launcherUrl = pathToFileURL(
      windowsBreakawayLauncherPath(dashboardRoot),
    ).href;
    const launcher = (await import(
      /* webpackIgnore: true */ launcherUrl
    )) as WindowsBreakawayLauncher;
    child = launcher.launchWindowsBreakawayProcess({
      applicationPath: process.execPath,
      args: [
        "--max-old-space-size=4096",
        "--experimental-strip-types",
        "--import",
        pathToFileURL(
          path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs"),
        ).href,
        path.join(dashboardRoot, "scripts", "learn-worker.mjs"),
        "--breadboard-learn-start-file",
        startupPath,
      ],
      cwd: dashboardRoot,
      logPath,
    });
  } catch (error) {
    fs.rmSync(startupPath, { force: true });
    const ownedProcess = processOwnedByLaunchError(error);
    if (!child && ownedProcess) child = ownedProcess;
    if (child) {
      try {
        child.terminateAndWait(WINDOWS_WORKER_EXIT_TIMEOUT_MS);
      } catch (terminationError) {
        child.close();
        throw workerCleanupFailure(
          "The Windows Learn worker launch failed and its process could not be stopped safely.",
          error,
          terminationError,
        );
      }
      child.close();
    }
    removeWorkerMarkerIfOwned(concurrency.markerPath, concurrency.nonce);
    throw error;
  }

  return new Promise<LearnTaskHandoff<T>>((resolve, reject) => {
    let settled = false;
    const expected = {
      requestId: receiptId,
      operation: request.operation,
      gardenId: request.gardenId,
    } as const;
    const stopParentObservation = () => {
      clearTimeout(startupTimeout);
      clearInterval(receiptPoll);
      fs.rmSync(startupPath, { force: true });
    };
    const finishReadyObservation = () => {
      stopParentObservation();
      child.close();
    };
    const fail = (error: unknown, terminate: boolean) => {
      if (settled) return;
      settled = true;
      stopParentObservation();
      try {
        if (terminate) {
          child.terminateAndWait(WINDOWS_WORKER_EXIT_TIMEOUT_MS);
        }
      } catch (terminationError) {
        child.close();
        reject(
          workerCleanupFailure(
            "The dedicated Learn worker failed before handoff and could not be stopped safely; its global slot remains fenced.",
            error,
            terminationError,
          ),
        );
        return;
      }
      removeWorkerMarkerIfOwned(concurrency.markerPath, concurrency.nonce);
      child.close();
      reject(error);
    };
    const complete = (message: LearnWorkerCompletedMessage) => {
      if (settled) return;
      settled = true;
      stopParentObservation();
      try {
        child.waitForExit(WINDOWS_WORKER_EXIT_TIMEOUT_MS);
      } catch {
        try {
          child.terminateAndWait(WINDOWS_WORKER_EXIT_TIMEOUT_MS);
        } catch (terminationError) {
          child.close();
          reject(
            new Error(
              "The dedicated Learn worker completed before handoff but could not be stopped safely; its global slot remains fenced.",
              { cause: terminationError },
            ),
          );
          return;
        }
      }
      removeWorkerMarkerIfOwned(concurrency.markerPath, concurrency.nonce);
      child.close();
      resolve({ accepted: false, value: message.value as T });
    };
    const accept = (message: LearnWorkerReadyMessage) => {
      if (settled) return;
      settled = true;
      finishReadyObservation();
      console.info(
        `[learn] Dedicated worker ${child.pid} accepted ${label}; ` +
          `job=${message.jobId ?? "unknown"}; receipt=${receiptPath}; log=${logPath}`,
      );
      resolve({ accepted: true, jobId: message.jobId });
    };
    const observeReceipt = (): boolean => {
      const message = readWorkerReceipt(receiptPath, expected);
      if (!message) {
        if (fs.existsSync(receiptPath)) {
          fail(
            new Error("The dedicated Learn worker returned an invalid startup receipt."),
            true,
          );
          return true;
        }
        return false;
      }
      if (message.type === "failed") {
        fail(workerFailure(message.error), true);
        return true;
      }
      if (message.type === "completed") {
        complete(message);
        return true;
      }
      accept(message);
      return true;
    };

    const receiptPoll = setInterval(() => {
      if (settled || observeReceipt()) return;
      let status: ReturnType<WindowsBreakawayProcess["status"]>;
      try {
        status = child.status();
      } catch (error) {
        fail(error, true);
        return;
      }
      if (status.alive) return;
      if (observeReceipt()) return;
      fail(
        new Error(
          `The dedicated Learn worker exited before creating its durable job ` +
            `(code ${status.exitCode}, signal none). See ${logPath}.`,
        ),
        false,
      );
    }, 25);
    const startupTimeout = setTimeout(() => {
      if (settled || observeReceipt()) return;
      fail(
        new Error(
          `The dedicated Learn worker did not create its durable startup receipt ` +
            `within ${Math.round(LEARN_WORKER_STARTUP_TIMEOUT_MS / 1000)} seconds. ` +
            `It was stopped before the UI may retry. See ${logPath}.`,
        ),
        true,
      );
    }, LEARN_WORKER_STARTUP_TIMEOUT_MS);
  });
}

/**
 * Start long development Learn work outside Next's route process.
 *
 * The Next development compiler can recycle or OOM independently of the
 * learning pipeline. A detached worker owns its own V8
 * heap while the existing SQLite job heartbeat and fenced garden lease remain
 * the authority. If Next restarts, the worker keeps running and the replacement
 * server merely resumes status polling. If the worker itself dies, the existing
 * abandoned-job sweeper performs the same exact rollback as before.
 */
async function handOffDedicatedLearnWorker<T>(
  dashboardRoot: string,
  request: LearnWorkerRequest,
  label: string,
): Promise<LearnTaskHandoff<T>> {
  if (process.platform === "win32") {
    return handOffWindowsDedicatedLearnWorker<T>(dashboardRoot, request, label);
  }
  const runtimeRoot = learnWorkerRuntimeRoot(dashboardRoot);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const receiptId = randomUUID();
  pruneWorkerRuntime(runtimeRoot);
  const concurrency = acquireWorkerConcurrencyMarker(runtimeRoot, receiptId);
  const logPath = path.join(runtimeRoot, `learn-worker-${receiptId}.log`);
  const receiptPath = path.join(runtimeRoot, `learn-worker-${receiptId}.ready.json`);
  let logFd!: number;
  try {
    logFd = fs.openSync(logPath, "a");
  } catch (error) {
    removeWorkerMarkerIfOwned(concurrency.markerPath, concurrency.nonce);
    throw error;
  }
  let child!: ChildProcess;
  try {
    const options: ForkOptions & { windowsHide: boolean } = {
      cwd: dashboardRoot,
      detached: true,
      windowsHide: true,
      execArgv: [
        "--max-old-space-size=4096",
        "--experimental-strip-types",
        "--import",
        pathToFileURL(
          path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs"),
        ).href,
      ],
      env: {
        ...process.env,
        BREADBOARD_LEARN_WORKER: "1",
      },
      stdio: ["ignore", logFd, logFd, "ipc"],
    };
    child = fork(
      path.join(dashboardRoot, "scripts", "learn-worker.mjs"),
      [],
      options,
    );
    fs.writeFileSync(
      concurrency.markerPath,
      `${JSON.stringify({
        protocolVersion: LEARN_WORKER_PROTOCOL_VERSION,
        requestId: receiptId,
        nonce: concurrency.nonce,
        pid: child.pid,
        state: "running",
        startedAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
  } catch (error) {
    if (child) {
      try {
        await terminateChildProcessAndWait(child);
      } catch (terminationError) {
        child.unref();
        throw workerCleanupFailure(
          "The dedicated Learn worker launch failed and its process could not be stopped safely; its global slot remains fenced.",
          error,
          terminationError,
        );
      }
      child.unref();
    }
    removeWorkerMarkerIfOwned(concurrency.markerPath, concurrency.nonce);
    throw error;
  } finally {
    fs.closeSync(logFd);
  }

  return new Promise<LearnTaskHandoff<T>>((resolve, reject) => {
    let settled = false;
    const expected = {
      requestId: receiptId,
      operation: request.operation,
      gardenId: request.gardenId,
    } as const;
    const fail = (error: unknown, terminate: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      void (async () => {
        try {
          if (terminate) await terminateChildProcessAndWait(child);
          else await waitForChildProcessExit(child, CHILD_PROCESS_EXIT_TIMEOUT_MS);
        } catch (terminationError) {
          child.unref();
          reject(
            workerCleanupFailure(
              "The dedicated Learn worker failed before handoff and could not be stopped safely; its global slot remains fenced.",
              error,
              terminationError,
            ),
          );
          return;
        }
        removeWorkerMarkerIfOwned(concurrency.markerPath, concurrency.nonce);
        child.unref();
        reject(error);
      })();
    };
    const complete = (message: LearnWorkerCompletedMessage) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      void (async () => {
        try {
          await awaitChildProcessExitOrTerminate(child);
        } catch (terminationError) {
          child.unref();
          reject(
            new Error(
              "The dedicated Learn worker completed before handoff but could not be stopped safely; its global slot remains fenced.",
              { cause: terminationError },
            ),
          );
          return;
        }
        removeWorkerMarkerIfOwned(concurrency.markerPath, concurrency.nonce);
        child.unref();
        resolve({ accepted: false, value: message.value as T });
      })();
    };
    const accept = (message: LearnWorkerReadyMessage) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimeout);
      child.unref();
      console.info(
        `[learn] Dedicated worker ${child.pid ?? "unknown"} accepted ${label}; ` +
          `job=${message.jobId ?? "unknown"}; receipt=${receiptPath}; log=${logPath}`,
      );
      resolve({ accepted: true, jobId: message.jobId });
    };
    const startupTimeout = setTimeout(() => {
      if (settled) return;
      const receipt = readWorkerReadyReceipt(receiptPath, expected);
      if (receipt) {
        accept(receipt);
        return;
      }
      fail(
        new Error(
          `The dedicated Learn worker did not create its durable startup receipt ` +
            `within ${Math.round(LEARN_WORKER_STARTUP_TIMEOUT_MS / 1000)} seconds. ` +
          `It was stopped before the UI may retry. See ${logPath}.`,
        ),
        true,
      );
    }, LEARN_WORKER_STARTUP_TIMEOUT_MS);
    child.once("error", (error) => fail(error, true));
    child.once("exit", (code, signal) => {
      if (settled) return;
      const receipt = readWorkerReadyReceipt(receiptPath, expected);
      if (receipt) {
        accept(receipt);
        return;
      }
      fail(
        new Error(
          `The dedicated Learn worker exited before creating its durable job ` +
          `(code ${code ?? "none"}, signal ${signal ?? "none"}). See ${logPath}.`,
        ),
        false,
      );
    });
    child.once("disconnect", () => {
      if (settled) return;
      const receipt = readWorkerReadyReceipt(receiptPath, expected);
      if (receipt) accept(receipt);
    });
    child.on("message", (message: unknown) => {
      if (settled) return;
      if (!isWorkerMessage(message, expected)) {
        fail(
          new Error("The dedicated Learn worker returned an invalid startup receipt."),
          true,
        );
        return;
      }
      if (message.type === "failed") {
        fail(workerFailure(message.error), true);
        return;
      }
      if (message.type === "completed") {
        complete(message);
        return;
      }
      accept(message);
    });
    child.send(
      {
        protocolVersion: LEARN_WORKER_PROTOCOL_VERSION,
        type: "start",
        requestId: receiptId,
        receiptPath,
        concurrencyPath: concurrency.markerPath,
        concurrencyNonce: concurrency.nonce,
        request,
        label,
      },
      (error) => {
        if (error) fail(error, true);
      },
    );
  });
}

/**
 * Let fast validation failures keep normal HTTP error semantics, then hand a
 * genuinely long Learn run to Next's post-response lifecycle. The pipeline
 * calls the supplied barrier only after creating its durable job/state marker;
 * heavy cached work remains paused until the 202 response is closing.
 */
export async function handOffLearnTask<T>(
  startTask: (yieldToResponse: (jobId?: string) => Promise<void>) => Promise<T>,
  label: string,
  workerRequest?: LearnWorkerRequest,
): Promise<LearnTaskHandoff<T>> {
  if (workerRequest) {
    const dedicated = await handOffDedicatedLearnTask<T>(workerRequest, label);
    if (dedicated) return dedicated;
  }

  let signalReady!: () => void;
  let releaseTask!: () => void;
  let barrierReleased = false;
  let checkpointJobId: string | undefined;
  const ready = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseTask = () => {
      barrierReleased = true;
      resolve();
    };
  });
  const yieldToResponse = (jobId?: string): Promise<void> => {
    if (!checkpointJobId && typeof jobId === "string" && jobId.trim()) {
      checkpointJobId = jobId;
    }
    signalReady();
    return barrierReleased ? Promise.resolve() : release;
  };
  const task = startTask(yieldToResponse);
  const settled = task.then<SettledLearnTask<T>, SettledLearnTask<T>>(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
  const initial = await Promise.race<SettledLearnTask<T> | null>([
    settled,
    ready.then(() => null),
  ]);

  if (initial) {
    if (!initial.ok) throw initial.error;
    return { accepted: false, value: initial.value };
  }

  after(async () => {
    // Next invokes `after` only once the response is closing. Releasing the
    // cooperative barrier here guarantees cache-heavy synchronous work cannot
    // starve the response that told the UI which durable job to poll.
    releaseTask();
    const final = await settled;
    if (!final.ok) {
      // The pipeline persists its own failed/cancelled state. This log is for
      // operators; the UI learns the same outcome through status polling.
      console.error(`[learn] Background ${label} failed:`, final.error);
    }
  });
  return checkpointJobId
    ? { accepted: true, jobId: checkpointJobId }
    : { accepted: true };
}

/**
 * Compile-time operation facades call this before importing any Learn pipeline
 * code. Both hot and standalone modes use the same bounded durable worker;
 * null is retained only for explicitly external/non-desktop deployments.
 */
export async function handOffDedicatedLearnTask<T>(
  request: LearnWorkerRequest,
  label: string,
): Promise<LearnTaskHandoff<T> | null> {
  assertDedicatedWorkerNodeVersion();
  const dashboardRoot = dashboardDevelopmentRoot();
  if (!dashboardRoot) {
    throw new Error(
      "The dedicated Learn worker is unavailable; refusing to run long Learn work inside next dev.",
    );
  }
  return handOffDedicatedLearnWorker<T>(dashboardRoot, request, label);
}

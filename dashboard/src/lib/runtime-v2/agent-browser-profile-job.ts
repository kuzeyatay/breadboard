import "server-only";

import { randomUUID } from "node:crypto";

import {
  BrowserProfileError,
  normalizeBrowserProfileStartUrl,
  signInWindow,
  signInWindowOpen,
  type SignInWindow,
} from "../agent-browser/browser-profile.ts";
import {
  cancelRuntimeJob,
  cancelRuntimeJobByIdempotencyKey,
  inspectRuntimeJob,
  isRuntimeV2ServiceControlConfigured,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
} from "../supervisor-control.ts";

const JOB_TYPE = "agent-browser-profile";
const WORKER_KIND = "agent-browser-profile-node";
const RESOURCE_CLASS = "browser-automation";
const OPEN_TIMEOUT_MS = 45_000;
const CLOSE_WAIT_MS = 8_000;
const POLL_MS = 200;
const TERMINAL = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled", "succeeded", "failed", "resource_exhausted", "interrupted", "uncertain",
]);

function authority(userId: number): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new BrowserProfileError(401, "invalid_user");
  }
  return { userId, gardenId: null, conversationId: null };
}

function assertSnapshot(snapshot: RuntimeJobSnapshot): void {
  if (
    snapshot.jobType !== JOB_TYPE || snapshot.workerKind !== WORKER_KIND ||
    snapshot.resourceClass !== RESOURCE_CLASS || snapshot.gardenId !== null ||
    snapshot.conversationId !== null
  ) throw new Error("Runtime returned an invalid browser-profile job.");
}

function markerMatchesJob(window: SignInWindow, job: RuntimeJobSnapshot, userId: number): boolean {
  return window.jobId === job.jobId && window.attempt === job.attempt &&
    window.workerInstanceId === job.workerInstanceId && window.userId === userId;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    const abort = () => done(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function terminalError(snapshot: RuntimeJobSnapshot): BrowserProfileError {
  if (snapshot.state === "resource_exhausted") {
    return new BrowserProfileError(503, "resource_exhausted");
  }
  if (snapshot.state === "cancelled") return new BrowserProfileError(409, "browser_launch_cancelled");
  return new BrowserProfileError(502, "browser_launch_failed");
}

/** Submit one long-lived, user-global Runtime job and wait only until Chromium is visible. */
export async function openAgentBrowserProfileWindow(input: {
  userId: number;
  url?: unknown;
  signal?: AbortSignal;
}): Promise<SignInWindow> {
  const existing = signInWindow();
  if (existing) {
    if (existing.userId !== undefined && existing.userId !== input.userId) {
      throw new BrowserProfileError(409, "sign_in_window_owned_by_another_user");
    }
    return existing;
  }
  if (!isRuntimeV2ServiceControlConfigured()) {
    throw new BrowserProfileError(503, "runtime_unavailable");
  }
  const startUrl = normalizeBrowserProfileStartUrl(input.url);
  const jobAuthority = authority(input.userId);
  const idempotencyKey = `agent-browser-profile-${randomUUID()}`;
  let snapshot: RuntimeJobSnapshot | null = null;
  let submitted = false;
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new DOMException("Browser profile launch timed out", "TimeoutError")),
    OPEN_TIMEOUT_MS,
  );
  timer.unref?.();
  const abort = () => timeout.abort(input.signal?.reason);
  if (input.signal?.aborted) abort();
  else input.signal?.addEventListener("abort", abort, { once: true });
  try {
    snapshot = await submitRuntimeJob(jobAuthority, {
      jobType: JOB_TYPE,
      idempotencyKey,
      requestPayload: { protocolVersion: 1, operation: "open", startUrl },
    });
    submitted = true;
    assertSnapshot(snapshot);
    for (;;) {
      if (timeout.signal.aborted) {
        throw timeout.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      const window = signInWindow();
      if (window?.jobId === snapshot.jobId) {
        snapshot = await inspectRuntimeJob(jobAuthority, snapshot.jobId);
        assertSnapshot(snapshot);
        if (markerMatchesJob(window, snapshot, input.userId)) return window;
      }
      if (TERMINAL.has(snapshot.state)) throw terminalError(snapshot);
      await delay(POLL_MS, timeout.signal);
      snapshot = await inspectRuntimeJob(jobAuthority, snapshot.jobId);
      assertSnapshot(snapshot);
    }
  } catch (error) {
    if (snapshot && !TERMINAL.has(snapshot.state)) {
      await cancelRuntimeJob(jobAuthority, snapshot.jobId).catch(() => undefined);
    } else if (!submitted) {
      await cancelRuntimeJobByIdempotencyKey(jobAuthority, idempotencyKey).catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
  }
}

/** Cancel the exact job fence recorded by the Runtime-owned visible window. */
export async function closeAgentBrowserProfileWindow(input: {
  userId: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  const current = signInWindow();
  if (!current) return false;
  if (!current.jobId || !current.workerInstanceId || !current.attempt || !current.userId) {
    throw new BrowserProfileError(409, "unmanaged_sign_in_window");
  }
  if (current.userId !== input.userId) {
    throw new BrowserProfileError(409, "sign_in_window_owned_by_another_user");
  }
  if (!isRuntimeV2ServiceControlConfigured()) {
    throw new BrowserProfileError(503, "runtime_unavailable");
  }
  const jobAuthority = authority(input.userId);
  const inspected = await inspectRuntimeJob(jobAuthority, current.jobId);
  assertSnapshot(inspected);
  if (!markerMatchesJob(current, inspected, input.userId)) {
    throw new BrowserProfileError(409, "unmanaged_sign_in_window");
  }
  const cancelled = await cancelRuntimeJob(jobAuthority, current.jobId);
  assertSnapshot(cancelled);
  const deadline = Date.now() + CLOSE_WAIT_MS;
  while (Date.now() < deadline && signInWindowOpen()) {
    await delay(POLL_MS, input.signal);
  }
  return !signInWindowOpen();
}

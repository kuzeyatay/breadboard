import "server-only";

import { randomUUID } from "node:crypto";

import type { SystemLocationResult } from "../system-location.ts";
import { unsupportedSystemLocation } from "../system-location.ts";
import {
  cancelRuntimeJob,
  inspectRuntimeJob,
  isRuntimeV2ServiceControlConfigured,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";

const PROTOCOL_VERSION = 1;
const POLL_MS = 200;
const MAX_OPERATION_MS = 35_000;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export interface SystemLocationRuntimeControl {
  submit(
    authority: RuntimeJobAuthority,
    submission: RuntimeJobSubmission,
  ): Promise<RuntimeJobSnapshot>;
  inspect(authority: RuntimeJobAuthority, jobId: string): Promise<RuntimeJobSnapshot>;
  readOutput(
    authority: RuntimeJobAuthority,
    jobId: string,
    kind: RuntimeJobOutput["kind"],
  ): Promise<RuntimeJobOutput>;
  cancel(authority: RuntimeJobAuthority, jobId: string): Promise<RuntimeJobSnapshot>;
}

const DEFAULT_CONTROL: SystemLocationRuntimeControl = {
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

function unavailable(reason: string): SystemLocationResult {
  return { state: "unavailable", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function assertSnapshot(snapshot: RuntimeJobSnapshot): void {
  if (
    snapshot.jobType !== "system-location" ||
    snapshot.workerKind !== "system-location-node" ||
    snapshot.resourceClass !== "core" ||
    snapshot.gardenId !== null ||
    snapshot.conversationId !== null
  ) throw new Error("Runtime returned a job outside the system-location worker contract.");
}

function boundedReason(value: unknown): string | null {
  return typeof value === "string" &&
      value.trim() === value &&
      value.length > 0 &&
      Buffer.byteLength(value, "utf8") <= 200 &&
      !/\p{Cc}/u.test(value)
    ? value
    : null;
}

function validateResult(value: unknown): SystemLocationResult {
  if (!isRecord(value) || typeof value.state !== "string") {
    throw new Error("Runtime returned an invalid system-location result.");
  }
  if (value.state === "available") {
    if (
      !exactKeys(value, ["state", "latitude", "longitude", "accuracyMeters"]) ||
      typeof value.latitude !== "number" ||
      !Number.isFinite(value.latitude) ||
      value.latitude < -90 ||
      value.latitude > 90 ||
      typeof value.longitude !== "number" ||
      !Number.isFinite(value.longitude) ||
      value.longitude < -180 ||
      value.longitude > 180 ||
      typeof value.accuracyMeters !== "number" ||
      !Number.isFinite(value.accuracyMeters) ||
      value.accuracyMeters <= 0 ||
      value.accuracyMeters > 1e6
    ) throw new Error("Runtime returned an invalid system-location fix.");
    return {
      state: "available",
      latitude: value.latitude,
      longitude: value.longitude,
      accuracyMeters: value.accuracyMeters,
    };
  }
  if (
    !["blocked", "unavailable", "unsupported"].includes(value.state) ||
    !exactKeys(value, ["state", "reason"])
  ) throw new Error("Runtime returned an invalid system-location state.");
  const reason = boundedReason(value.reason);
  if (!reason) throw new Error("Runtime returned an invalid system-location reason.");
  return { state: value.state, reason } as SystemLocationResult;
}

function validateEnvelope(job: RuntimeJobSnapshot, value: unknown): SystemLocationResult {
  if (!isRecord(value) || !exactKeys(value, [
    "protocolVersion",
    "identity",
    "completionSequence",
    "result",
  ])) throw new Error("Runtime returned an invalid system-location envelope.");
  const identity = value.identity;
  if (
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.completionSequence !== job.lastWorkerSequence ||
    !isRecord(identity) ||
    !exactKeys(identity, ["jobId", "attempt", "workerInstanceId"]) ||
    identity.jobId !== job.jobId ||
    identity.attempt !== job.attempt ||
    identity.workerInstanceId !== job.workerInstanceId
  ) throw new Error("Runtime returned system-location output outside its worker fence.");
  return validateResult(value.result);
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    const abort = () => done(signal.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function terminalFailure(snapshot: RuntimeJobSnapshot): SystemLocationResult {
  if (snapshot.state === "resource_exhausted") {
    return unavailable("There is not enough free memory to read this computer's location right now.");
  }
  if (snapshot.state === "cancelled") {
    return unavailable("The Windows location request was cancelled.");
  }
  return unavailable("Breadboard could not reach the Windows location service.");
}

/**
 * Ask the authenticated Runtime owner to perform one bounded OS sensor read.
 * The dashboard never receives an executable or command line and never falls
 * back to launching PowerShell itself.
 */
export async function readSystemLocationViaRuntime(input: {
  userId: number;
  signal?: AbortSignal;
  platform?: NodeJS.Platform;
  control?: SystemLocationRuntimeControl;
}): Promise<SystemLocationResult> {
  if ((input.platform ?? process.platform) !== "win32") {
    return unsupportedSystemLocation();
  }
  if (!Number.isSafeInteger(input.userId) || input.userId < 1) {
    throw new TypeError("System-location Runtime user scope is invalid.");
  }
  if (!input.control && !isRuntimeV2ServiceControlConfigured()) {
    return unavailable("Breadboard's Runtime location service is unavailable.");
  }
  const authority: RuntimeJobAuthority = {
    userId: input.userId,
    gardenId: null,
    conversationId: null,
  };
  const control = input.control ?? DEFAULT_CONTROL;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("System location timed out", "TimeoutError")),
    MAX_OPERATION_MS,
  );
  timeout.unref?.();
  const forwardAbort = () => controller.abort(
    input.signal?.reason ?? new DOMException("Request aborted", "AbortError"),
  );
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });
  let jobId: string | null = null;
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    let snapshot = await control.submit(authority, {
      jobType: "system-location",
      idempotencyKey: `system-location-v2:${randomUUID()}`,
      requestPayload: {
        protocolVersion: PROTOCOL_VERSION,
        operation: "read-device-location",
      },
    });
    assertSnapshot(snapshot);
    jobId = snapshot.jobId;
    while (!TERMINAL_STATES.has(snapshot.state)) {
      await delay(POLL_MS, controller.signal);
      snapshot = await control.inspect(authority, snapshot.jobId);
      assertSnapshot(snapshot);
    }
    if (snapshot.state !== "succeeded") return terminalFailure(snapshot);
    const output = await control.readOutput(authority, snapshot.jobId, "result");
    return validateEnvelope(snapshot, output.content);
  } catch {
    if (jobId) {
      await control.cancel(authority, jobId).catch(() => undefined);
    }
    return unavailable("Breadboard could not reach the Windows location service.");
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
  }
}

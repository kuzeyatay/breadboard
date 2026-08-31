import { randomUUID } from "node:crypto";

import {
  inspectRuntimeJob,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
} from "./supervisor-control.ts";

const DISABLED_ENV_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const DEFAULT_BUILD_CONCURRENCY = 1;
const DEFAULT_BUILD_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_BUILD_TIMEOUT_MS = 10_000;
const MAX_BUILD_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_BUILD_CONCURRENCY = 16;
const MAX_REASON_BYTES = 512;
const MAX_REASONS_PER_JOB = 32;
const MAX_PENDING_REASONS = 32;
const COALESCED_REASON = "additional coalesced garden mutations";
const TERMINAL_STATES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const BUILD_ENVIRONMENT_NAMES = [
  "BREADBOARD_DASHBOARD_URL",
  "CI",
  "DASHBOARD_URL",
  "NEXT_PUBLIC_DASHBOARD_URL",
  "NEXT_PUBLIC_PENECHO_URL",
  "NEXT_PUBLIC_QUARTZ_URL",
  "PENECHO_URL",
  "QUARTZ_BASE_URL",
  "QUARTZ_CUSTOM_OG_IMAGES",
  "SECOND_BRAIN_ASSET_VERSION",
  "SHOW_LEGACY_SUBTOPIC_PAGES",
  "TERM",
] as const;

interface QuartzBuildResult {
  readonly published: true;
  readonly durationMs: number;
  readonly reasonCount: number;
}

interface SealedRuntimeV2QuartzPublishExecutor {
  (input: {
    readonly reasons: readonly string[];
    readonly concurrency: number;
    readonly timeoutMs: number;
    readonly buildEnvironment: Readonly<Record<string, string>>;
  }): Promise<QuartzBuildResult>;
}

interface QuartzPublishOptions {
  readonly requireSuccess?: boolean;
  /** Authenticated actor. Scope remains deliberately user-global. */
  readonly userId?: number;
  /** Garden-scoped canonical mutation that invalidates derived topology. */
  readonly gardenSlug?: string;
}

interface PendingPublication {
  readonly reasons: string[];
  readonly userId: number | null;
}

const pendingReasons = new Map<string, number | null>();
let activePublish: Promise<void> | null = null;
let sealedWorkerExecutor: SealedRuntimeV2QuartzPublishExecutor | null = null;

function envValue(rawValue: string | undefined): string {
  return rawValue?.trim().toLowerCase() ?? "";
}

function isDisabled(rawValue: string | undefined): boolean {
  return DISABLED_ENV_VALUES.has(envValue(rawValue));
}

function shouldAutoPublish(): boolean {
  const configured = process.env.QUARTZ_AUTO_PUBLISH;
  if (configured) return !isDisabled(configured);
  return process.env.NODE_ENV === "production";
}

function publishMode(): "await" | "background" {
  return envValue(process.env.QUARTZ_PUBLISH_MODE) === "background"
    ? "background"
    : "await";
}

function boundedUtf8(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maximumBytes) return value;
  return bytes
    .subarray(0, maximumBytes)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "");
}

function normalizeReason(reason: string): string {
  const trimmed = String(reason).trim() || "Breadboard content update";
  return boundedUtf8(trimmed.replace(/\p{Cc}/gu, " "), MAX_REASON_BYTES).trim();
}

function quartzBuildConcurrency(): number {
  const parsed = Number.parseInt(process.env.QUARTZ_BUILD_CONCURRENCY ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(MAX_BUILD_CONCURRENCY, Math.floor(parsed));
  }
  return DEFAULT_BUILD_CONCURRENCY;
}

function quartzBuildTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.QUARTZ_BUILD_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= MIN_BUILD_TIMEOUT_MS) {
    return Math.min(MAX_BUILD_TIMEOUT_MS, Math.floor(parsed));
  }
  return DEFAULT_BUILD_TIMEOUT_MS;
}

function quartzBuildEnvironment(): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const name of BUILD_ENVIRONMENT_NAMES) {
    const value = process.env[name];
    if (typeof value === "string" && value.length > 0) environment[name] = value;
  }
  return environment;
}

function assertUserId(userId: number | undefined): number {
  if (!Number.isSafeInteger(userId) || (userId as number) < 1) {
    throw new TypeError(
      "Quartz publication from Next requires an authenticated positive user ID.",
    );
  }
  return userId as number;
}

function isQuartzPublishJob(job: RuntimeJobSnapshot): boolean {
  return (
    job.jobType === "quartz-publish" &&
    job.workerKind === "quartz-publish-node" &&
    job.resourceClass === "large-generation" &&
    job.gardenId === null &&
    job.conversationId === null
  );
}

function validateQuartzResult(
  job: RuntimeJobSnapshot,
  content: unknown,
  expectedReasonCount: number,
): QuartzBuildResult {
  if (
    content === null ||
    typeof content !== "object" ||
    Array.isArray(content)
  ) {
    throw new Error("Runtime returned an invalid Quartz publication result.");
  }
  const envelope = content as Record<string, unknown>;
  const identity = envelope.identity;
  const result = envelope.result;
  if (
    Object.keys(envelope).sort().join(",") !==
      "completionSequence,identity,protocolVersion,result" ||
    envelope.protocolVersion !== 1 ||
    !Number.isSafeInteger(envelope.completionSequence) ||
    envelope.completionSequence !== job.lastWorkerSequence ||
    typeof identity !== "object" ||
    identity === null ||
    Array.isArray(identity) ||
    Object.keys(identity).sort().join(",") !==
      "attempt,jobId,workerInstanceId" ||
    (identity as Record<string, unknown>).jobId !== job.jobId ||
    (identity as Record<string, unknown>).attempt !== job.attempt ||
    (identity as Record<string, unknown>).workerInstanceId !==
      job.workerInstanceId ||
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    Object.keys(result).sort().join(",") !==
      "durationMs,published,reasonCount" ||
    (result as Record<string, unknown>).published !== true ||
    !Number.isSafeInteger((result as Record<string, unknown>).durationMs) ||
    ((result as Record<string, unknown>).durationMs as number) < 0 ||
    !Number.isSafeInteger((result as Record<string, unknown>).reasonCount) ||
    (result as Record<string, unknown>).reasonCount !== expectedReasonCount
  ) {
    throw new Error("Runtime returned an invalid Quartz publication result.");
  }
  return result as unknown as QuartzBuildResult;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForQuartzPublication(
  authority: RuntimeJobAuthority,
  initialJob: RuntimeJobSnapshot,
  timeoutMs: number,
  expectedReasonCount: number,
): Promise<QuartzBuildResult> {
  if (!isQuartzPublishJob(initialJob)) {
    throw new Error("Runtime returned a job outside the Quartz publication contract.");
  }
  const deadline = Date.now() + timeoutMs + 5 * 60_000;
  let job = initialJob;
  while (!TERMINAL_STATES.has(job.state)) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for Runtime V2 Quartz publication.");
    }
    await delay(250);
    job = await inspectRuntimeJob(authority, job.jobId);
    if (!isQuartzPublishJob(job)) {
      throw new Error("Runtime returned a job outside the Quartz publication contract.");
    }
  }
  if (job.state !== "succeeded") {
    throw new Error(job.failureMessage ?? `Quartz publication ended as ${job.state}.`);
  }
  const output = await readRuntimeJobOutput(authority, job.jobId, "result");
  return validateQuartzResult(job, output.content, expectedReasonCount);
}

async function submitQuartzPublication(
  userId: number,
  reasons: readonly string[],
): Promise<QuartzBuildResult> {
  const authority: RuntimeJobAuthority = {
    userId,
    gardenId: null,
    conversationId: null,
  };
  const timeoutMs = quartzBuildTimeoutMs();
  const job = await submitRuntimeJob(authority, {
    jobType: "quartz-publish",
    idempotencyKey: `quartz-publish-${randomUUID()}`,
    requestPayload: {
      operation: "publish",
      reasons,
      concurrency: quartzBuildConcurrency(),
      timeoutMs,
      buildEnvironment: quartzBuildEnvironment(),
    },
  });
  return waitForQuartzPublication(authority, job, timeoutMs, reasons.length);
}

function consumePendingPublication(): PendingPublication | null {
  const entries = [...pendingReasons.entries()].slice(0, MAX_REASONS_PER_JOB);
  if (entries.length === 0) return null;
  for (const [reason] of entries) pendingReasons.delete(reason);
  return {
    reasons: entries.map(([reason]) => reason),
    userId: entries.find(([, userId]) => userId !== null)?.[1] ?? null,
  };
}

async function runQuartzPublication(publication: PendingPublication): Promise<void> {
  const input = {
    reasons: publication.reasons,
    concurrency: quartzBuildConcurrency(),
    timeoutMs: quartzBuildTimeoutMs(),
    buildEnvironment: quartzBuildEnvironment(),
  };
  if (sealedWorkerExecutor) {
    await sealedWorkerExecutor(input);
    return;
  }
  await submitQuartzPublication(
    assertUserId(publication.userId ?? undefined),
    publication.reasons,
  );
}

async function drainQuartzPublishQueue(): Promise<void> {
  try {
    let publication = consumePendingPublication();
    while (publication) {
      await runQuartzPublication(publication);
      publication = consumePendingPublication();
    }
  } finally {
    activePublish = null;
  }
}

function queueQuartzPublish(reason: string, userId: number | null): Promise<void> {
  const normalized = normalizeReason(reason);
  if (!pendingReasons.has(normalized)) {
    if (pendingReasons.size < MAX_PENDING_REASONS - 1) {
      pendingReasons.set(normalized, userId);
    } else if (!pendingReasons.has(COALESCED_REASON)) {
      pendingReasons.set(COALESCED_REASON, userId);
    }
  }
  if (!activePublish) activePublish = drainQuartzPublishQueue();
  return activePublish;
}

function logPublishError(reason: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[quartz] Auto-publish failed after ${normalizeReason(reason)}: ${message}`,
  );
}

/**
 * Installed only by a pinned Runtime V2 worker after its independent
 * `start.json` attestation succeeds. Next has no direct compiler implementation.
 */
export function installSealedRuntimeV2QuartzPublishExecutor(
  executor: SealedRuntimeV2QuartzPublishExecutor,
): void {
  if (typeof executor !== "function" || sealedWorkerExecutor) {
    throw new Error("The sealed Runtime V2 Quartz executor cannot be installed.");
  }
  sealedWorkerExecutor = executor;
}

export async function publishQuartzAfterMutation(
  reason: string,
  options: QuartzPublishOptions = {},
): Promise<void> {
  if (options.gardenSlug) {
    const { invalidateThoughtTopologyAfterMutation } = await import(
      "./thought-topology/state.ts"
    );
    await invalidateThoughtTopologyAfterMutation(options.gardenSlug, reason);
  }
  if (!shouldAutoPublish()) return;

  const userId = sealedWorkerExecutor ? null : assertUserId(options.userId);
  const publishPromise = queueQuartzPublish(reason, userId);

  if (options.requireSuccess) {
    try {
      await publishPromise;
      return;
    } catch (error) {
      logPublishError(reason, error);
      throw error;
    }
  }

  if (publishMode() === "background") {
    void publishPromise.catch((error) => logPublishError(reason, error));
    return;
  }

  try {
    await publishPromise;
  } catch (error) {
    logPublishError(reason, error);
  }
}

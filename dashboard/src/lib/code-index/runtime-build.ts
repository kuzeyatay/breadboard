import { externalRuntimePath as path } from "../external-runtime-path.ts";
import {
  inspectRuntimeJobForStatus,
  isRuntimeV2ServiceControlConfigured,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";
import {
  graftIndexExists,
  graftRepositoryKey,
  graftIndexState,
  type GraftIndexState,
} from "./index-service.ts";

const BUILD_TIMEOUT_MS = 20 * 60_000;
const MONITOR_GRACE_MS = 2 * 60_000;
/** A failed build should not be retried on every keystroke-fast rerun. */
const BUILD_RETRY_COOLDOWN_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 1_000;
const MAX_REPOSITORY_PATH_BYTES = 32 * 1024;
const TERMINAL_JOB_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

interface BuildRecord {
  readonly status: "building" | "failed";
  readonly startedAt: number;
  readonly finishedAt: number;
}

export interface GraftRuntimeControl {
  readonly configured: (env: NodeJS.ProcessEnv) => boolean;
  readonly submit: (
    authority: RuntimeJobAuthority,
    submission: RuntimeJobSubmission,
    env: NodeJS.ProcessEnv,
  ) => Promise<RuntimeJobSnapshot>;
  readonly inspect: (
    authority: RuntimeJobAuthority,
    jobId: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<RuntimeJobSnapshot>;
  readonly readResult: (
    authority: RuntimeJobAuthority,
    jobId: string,
    env: NodeJS.ProcessEnv,
  ) => ReturnType<typeof readRuntimeJobOutput>;
}

const DEFAULT_CONTROL: GraftRuntimeControl = {
  configured: isRuntimeV2ServiceControlConfigured,
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJobForStatus,
  readResult: (authority, jobId, env) =>
    readRuntimeJobOutput(authority, jobId, "result", env),
};

const builds = new Map<string, BuildRecord>();

function validateRepositoryPath(repositoryPath: string): string {
  const resolved = path.resolve(repositoryPath);
  if (
    typeof repositoryPath !== "string" ||
    !path.isAbsolute(repositoryPath) ||
    repositoryPath !== repositoryPath.trim() ||
    /[\u0000\r\n]/u.test(repositoryPath) ||
    Buffer.byteLength(repositoryPath, "utf8") > MAX_REPOSITORY_PATH_BYTES
  ) {
    throw new TypeError("The Graft repository path is invalid.");
  }
  return resolved;
}

function authority(userId: number, repositoryKey: string): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("The Graft Runtime user authority is invalid.");
  }
  return {
    userId,
    gardenId: null,
    conversationId: `graft_${repositoryKey}`,
  };
}

function requireGraftJob(
  job: RuntimeJobSnapshot,
  expectedAuthority: RuntimeJobAuthority,
): RuntimeJobSnapshot {
  if (
    job.jobType !== "graft-index-build" ||
    job.workerKind !== "graft-index-node" ||
    job.resourceClass !== "large-generation" ||
    job.gardenId !== expectedAuthority.gardenId ||
    job.conversationId !== expectedAuthority.conversationId
  ) {
    throw new Error("Runtime returned a job outside the sealed Graft index contract.");
  }
  return job;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function validateBuildResult(job: RuntimeJobSnapshot, value: unknown): void {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["protocolVersion", "identity", "completionSequence", "result"]) ||
    value.protocolVersion !== 1 ||
    value.completionSequence !== job.lastWorkerSequence ||
    !isRecord(value.identity) ||
    !exactKeys(value.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    value.identity.jobId !== job.jobId ||
    value.identity.attempt !== job.attempt ||
    value.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(value.result) ||
    !exactKeys(value.result, ["built", "durationMs", "ready"]) ||
    typeof value.result.built !== "boolean" ||
    value.result.ready !== true ||
    !Number.isSafeInteger(value.result.durationMs) ||
    (value.result.durationMs as number) < 0 ||
    (value.result.durationMs as number) > BUILD_TIMEOUT_MS + MONITOR_GRACE_MS
  ) {
    throw new Error("Runtime returned an invalid fenced Graft index result.");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function monitorBuild(input: {
  readonly key: string;
  readonly repositoryPath: string;
  readonly authority: RuntimeJobAuthority;
  readonly initialJob: RuntimeJobSnapshot;
  readonly control: GraftRuntimeControl;
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => number;
}): Promise<void> {
  try {
    const deadline = input.now() + BUILD_TIMEOUT_MS + MONITOR_GRACE_MS;
    let job = input.initialJob;
    while (!TERMINAL_JOB_STATES.has(job.state)) {
      if (input.now() >= deadline) {
        throw new Error("The Graft Runtime job exceeded its monitor deadline.");
      }
      await delay(POLL_INTERVAL_MS);
      job = requireGraftJob(
        await input.control.inspect(input.authority, job.jobId, input.env),
        input.authority,
      );
    }
    if (job.state !== "succeeded") {
      throw new Error(`The Graft Runtime job ended as ${job.state}.`);
    }
    const output = await input.control.readResult(
      input.authority,
      job.jobId,
      input.env,
    );
    validateBuildResult(job, output.content);
    if (!graftIndexExists(input.repositoryPath, input.env)) {
      throw new Error("The Graft Runtime job completed without a ready graph.");
    }
    builds.delete(input.key);
  } catch {
    builds.set(input.key, {
      status: "failed",
      startedAt: 0,
      finishedAt: input.now(),
    });
  }
}

/**
 * Submit a cold Graft graph build to the native Runtime and return immediately
 * after durable admission. Agent runs never wait for the graph itself: a cold,
 * failed, or unavailable index preserves the existing direct-search behavior.
 */
export async function ensureGraftIndex(
  userId: number,
  repositoryPath: string,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly control?: GraftRuntimeControl;
    readonly now?: () => number;
  } = {},
): Promise<GraftIndexState> {
  const env = options.env ?? process.env;
  const control = options.control ?? DEFAULT_CONTROL;
  const now = options.now ?? Date.now;
  const resolvedRepository = validateRepositoryPath(repositoryPath);
  const current = graftIndexState(resolvedRepository, env);
  if (current === "ready" || current === "unavailable") return current;

  const key = graftRepositoryKey(resolvedRepository);
  const record = builds.get(key);
  if (
    record?.status === "building" &&
    now() - record.startedAt < BUILD_TIMEOUT_MS + MONITOR_GRACE_MS
  ) {
    return "building";
  }
  if (
    record?.status === "failed" &&
    now() - record.finishedAt < BUILD_RETRY_COOLDOWN_MS
  ) {
    return "missing";
  }
  if (!control.configured(env)) {
    builds.set(key, { status: "failed", startedAt: 0, finishedAt: now() });
    return "missing";
  }

  const jobAuthority = authority(userId, key);
  const startedAt = now();
  const bucket = Math.floor(startedAt / BUILD_RETRY_COOLDOWN_MS);
  try {
    const job = requireGraftJob(
      await control.submit(
        jobAuthority,
        {
          jobType: "graft-index-build",
          idempotencyKey: `graft-index-v2:${userId}:${key}:${bucket}`,
          requestPayload: { repositoryPath: resolvedRepository },
        },
        env,
      ),
      jobAuthority,
    );
    builds.set(key, { status: "building", startedAt, finishedAt: 0 });
    void monitorBuild({
      key,
      repositoryPath: resolvedRepository,
      authority: jobAuthority,
      initialJob: job,
      control,
      env,
      now,
    });
    return "building";
  } catch {
    builds.set(key, { status: "failed", startedAt: 0, finishedAt: now() });
    return "missing";
  }
}

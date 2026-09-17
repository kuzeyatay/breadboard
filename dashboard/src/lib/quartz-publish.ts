import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";

import { externalRuntimePathExists } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { invalidateGardenNoteCount } from "./garden-note-count-cache.ts";
import {
  inspectRuntimeJob,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
} from "./supervisor-control.ts";

const DISABLED_ENV_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
// Parsing dominates a full-site build (KaTeX and syntax highlighting per page)
// and parallelises well across worker threads; each thread holds one chunk of
// pages, so the cap keeps the build's process tree inside its memory budget.
const DEFAULT_BUILD_CONCURRENCY = Math.min(
  4,
  Math.max(1, availableParallelism() - 2),
);
const DEFAULT_BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_BUILD_TIMEOUT_MS = 10_000;
const MAX_BUILD_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_BUILD_CONCURRENCY = 16;
const MAX_REASON_BYTES = 512;
const MAX_REASONS_PER_JOB = 32;
const MAX_PENDING_REASONS = 32;
const COALESCED_REASON = "additional coalesced garden mutations";
// Every Garden-scoped publication also refreshes the dashboard's library
// landing pages (`private-library/…`, `public-library`, …): they summarise the
// Gardens and are rewritten alongside most Garden mutations.
const LIBRARY_INDEX_SCOPES = [
  "private-library",
  "public-library",
  "organization-library",
] as const;
const MAX_SCOPE_ROOTS = 32;
const SCOPE_ROOT = /^(?!\.)[^\\/\0\p{Cc}]{1,255}(?:\/(?!\.)[^\\/\0\p{Cc}]{1,255})*$/u;
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
    /** Content-relative directories to rebuild; empty = the whole site. */
    readonly scope: readonly string[];
  }): Promise<QuartzBuildResult>;
}

interface QuartzPublishBaseOptions {
  readonly requireSuccess?: boolean;
  /** Authenticated actor. Scope remains deliberately user-global. */
  readonly userId?: number;
}

type QuartzPublishOptions = QuartzPublishBaseOptions & (
  | {
      /** Garden-scoped canonical mutation that invalidates derived topology.
       * The publication rebuilds only this Garden (plus the library landing
       * pages) on top of the current site. */
      readonly gardenSlug: string;
      readonly topologyImpact?: never;
      readonly scope?: never;
    }
  | {
      /** Explicit proof that this publication changes only aggregate/static
       * output and cannot make one Garden's derived topology stale. */
      readonly gardenSlug?: never;
      readonly topologyImpact: "none";
      /** Content-relative directories that are enough to rebuild. Omit when
       * the change can touch pages anywhere (deletions, imports, renames). */
      readonly scope?: readonly string[];
    }
);

interface PendingPublication {
  readonly reasons: string[];
  readonly userId: number | null;
  /** Union of the queued scopes, or `null` when any entry needs the whole site. */
  readonly scope: readonly string[] | null;
}

interface PendingReason {
  readonly userId: number | null;
  readonly scope: readonly string[] | null;
}

const pendingReasons = new Map<string, PendingReason>();
let activePublish: Promise<void> | null = null;
let currentPublish: Promise<void> | null = null;
let viewReadinessPublish: Promise<void> | null = null;
/** In-flight and recently attempted per-Garden recovery publications. */
const gardenRecoveryPublishes = new Map<string, Promise<void>>();
const gardenRecoveryAttempts = new Map<string, number>();
const GARDEN_RECOVERY_RETRY_MS = 10 * 60 * 1000;
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
  // Runtime V2 serves only the atomically published data-root tree. Its hot
  // dashboard still has NODE_ENV=development, but unlike the legacy Quartz
  // dev server there is no resident compiler watching content changes. The
  // authenticated Runtime control capability proves that the disposable
  // publisher is available, so mutations must publish in every Runtime mode.
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(
      process.env.BREADBOARD_SUPERVISOR_CONTROL_URL?.trim() &&
        process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN?.trim(),
    )
  );
}

function quartzPublicIndexIsAvailable(): boolean {
  const contentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (!contentPath) return false;
  return externalRuntimePathExists(
    path.join(path.resolve(contentPath, ".."), "public", "index.html"),
  );
}

function quartzPublicRoot(): string | null {
  const contentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (!contentPath) return null;
  return path.join(path.resolve(contentPath, ".."), "public");
}

/** Whether the published tree already holds a landing page for this Garden. */
function gardenIsPublished(gardenSlug: string): boolean {
  const publicRoot = quartzPublicRoot();
  if (!publicRoot) return false;
  return externalRuntimePathExists(
    path.join(publicRoot, gardenSlug, "index.html"),
  );
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
  scope: readonly string[],
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
      scope,
    },
  });
  return waitForQuartzPublication(authority, job, timeoutMs, reasons.length);
}

/** Content-relative roots for a scoped publication, or `null` (whole site)
 * when a root is unusable: a mutation must never fail to publish over it. */
function normalizeScope(scope: readonly string[]): string[] | null {
  const roots = new Set<string>();
  for (const raw of scope) {
    const root = String(raw).trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
    if (!SCOPE_ROOT.test(root)) {
      console.warn(
        `[quartz] Publication scope ${JSON.stringify(raw)} is unusable; building the whole site.`,
      );
      return null;
    }
    roots.add(root);
  }
  return [...roots];
}

function mergeScopes(
  entries: readonly PendingReason[],
): readonly string[] | null {
  const merged = new Set<string>();
  for (const entry of entries) {
    if (entry.scope === null) return null;
    for (const root of entry.scope) merged.add(root);
  }
  // Too many Gardens at once is no cheaper than the whole site.
  return merged.size > MAX_SCOPE_ROOTS ? null : [...merged];
}

function consumePendingPublication(): PendingPublication | null {
  const entries = [...pendingReasons.entries()].slice(0, MAX_REASONS_PER_JOB);
  if (entries.length === 0) return null;
  for (const [reason] of entries) pendingReasons.delete(reason);
  return {
    reasons: entries.map(([reason]) => reason),
    userId: entries.find(([, entry]) => entry.userId !== null)?.[1].userId ?? null,
    scope: mergeScopes(entries.map(([, entry]) => entry)),
  };
}

async function runQuartzPublication(publication: PendingPublication): Promise<void> {
  const scope = publication.scope ?? [];
  const input = {
    reasons: publication.reasons,
    concurrency: quartzBuildConcurrency(),
    timeoutMs: quartzBuildTimeoutMs(),
    buildEnvironment: quartzBuildEnvironment(),
    scope,
  };
  if (sealedWorkerExecutor) {
    await sealedWorkerExecutor(input);
    return;
  }
  await submitQuartzPublication(
    assertUserId(publication.userId ?? undefined),
    publication.reasons,
    scope,
  );
}

async function drainQuartzPublishQueue(): Promise<void> {
  try {
    let publication = consumePendingPublication();
    while (publication) {
      const publicationAttempt = runQuartzPublication(publication);
      currentPublish = publicationAttempt;
      try {
        await publicationAttempt;
      } finally {
        if (currentPublish === publicationAttempt) currentPublish = null;
      }
      publication = consumePendingPublication();
    }
  } finally {
    activePublish = null;
  }
}

function queueQuartzPublish(
  reason: string,
  userId: number | null,
  scope: readonly string[] | null,
): Promise<void> {
  const normalized = normalizeReason(reason);
  const existing = pendingReasons.get(normalized);
  if (existing) {
    // The same reason queued again with a wider scope must not stay narrow.
    if (existing.scope !== null && scope !== null) {
      pendingReasons.set(normalized, {
        userId: existing.userId ?? userId,
        scope: [...new Set([...existing.scope, ...scope])],
      });
    } else if (existing.scope !== null) {
      pendingReasons.set(normalized, { userId: existing.userId ?? userId, scope: null });
    }
  } else if (pendingReasons.size < MAX_PENDING_REASONS - 1) {
    pendingReasons.set(normalized, { userId, scope });
  } else {
    // Overflow entries lose their reason text and, with it, their scope.
    const coalesced = pendingReasons.get(COALESCED_REASON);
    pendingReasons.set(COALESCED_REASON, {
      userId: coalesced?.userId ?? userId,
      scope: null,
    });
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

/**
 * A fresh Runtime V2 profile intentionally has no derived `public` tree. Make
 * the first authenticated Quartz view create it before acquiring the static
 * server lease, so every entry point can recover rather than rendering the
 * static service's 404 preparation document. Concurrent cold views share the
 * same publication job.
 */
export async function ensureQuartzPublicationForView(userId: number): Promise<void> {
  if (quartzPublicIndexIsAvailable()) return;
  if (!shouldAutoPublish()) {
    throw new Error("Quartz publication is disabled while its public tree is missing.");
  }
  if (!viewReadinessPublish) {
    viewReadinessPublish = (async () => {
      // A library route or content mutation may already be producing the
      // missing tree. Wait for that one publication attempt and check its
      // output before enqueueing another several-minute full build.
      const publicationInFlight = currentPublish;
      if (publicationInFlight) {
        await publicationInFlight.catch(() => undefined);
        if (quartzPublicIndexIsAvailable()) return;
      }

      await publishQuartzAfterMutation(
        "prepare Quartz for the first garden view",
        { userId, requireSuccess: true, topologyImpact: "none" },
      );
    })().finally(() => {
      viewReadinessPublish = null;
    });
  }
  await viewReadinessPublish;
}

/**
 * A Garden whose source exists but whose pages were never published — its
 * creating publication failed, or it was written while publication was broken
 * — would otherwise render the static service's "could not be found" document
 * with no way forward: nothing in the reader triggers a publication, so the
 * page's own Retry link cannot ever succeed. Publish that one Garden (a scoped
 * build, so it costs a minute rather than a full site rebuild) before handing
 * the frame its URL, and let the global navigation progress bar cover the wait.
 *
 * A Garden that publishes no pages at all — every note still a draft — must not
 * rebuild on every visit, so a failed recovery is not retried for a while.
 */
export async function ensureGardenPublicationForView(
  userId: number,
  gardenSlug: string,
): Promise<void> {
  const contentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (!gardenSlug || !contentPath) return;
  if (gardenIsPublished(gardenSlug)) return;
  // Nothing has been written for this Garden yet; its first content mutation
  // publishes it.
  if (!externalRuntimePathExists(path.join(contentPath, gardenSlug))) return;
  if (!shouldAutoPublish()) return;
  const lastAttempt = gardenRecoveryAttempts.get(gardenSlug) ?? 0;
  if (Date.now() - lastAttempt < GARDEN_RECOVERY_RETRY_MS) return;

  let recovery = gardenRecoveryPublishes.get(gardenSlug);
  if (!recovery) {
    recovery = (async () => {
      // A mutation may already be publishing this Garden. Wait for that
      // attempt and recheck before queueing another build.
      if (await waitForQuartzPublicationInFlight()) {
        if (gardenIsPublished(gardenSlug)) return;
      }
      gardenRecoveryAttempts.set(gardenSlug, Date.now());
      await publishQuartzAfterMutation(`publish unpublished garden ${gardenSlug}`, {
        userId,
        requireSuccess: true,
        topologyImpact: "none",
        scope: [gardenSlug],
      });
    })().finally(() => {
      gardenRecoveryPublishes.delete(gardenSlug);
    });
    gardenRecoveryPublishes.set(gardenSlug, recovery);
  }
  try {
    await recovery;
  } catch (error) {
    // The reader still opens: Quartz's own document explains the page is
    // missing, and the next visit after the backoff tries again.
    logPublishError(`publish unpublished garden ${gardenSlug}`, error);
  }
}

export async function publishQuartzAfterMutation(
  reason: string,
  options: QuartzPublishOptions,
): Promise<void> {
  // `gardenSlug` used to be optional and silent. A new background writer could
  // successfully publish changed Markdown while forgetting to invalidate the
  // corresponding Thought Topology—the Runtime ingestion worker was one such
  // path. Make every caller declare either the Garden or an intentional
  // topology-neutral publication, and enforce it at runtime for JS workers.
  if (!options.gardenSlug && options.topologyImpact !== "none") {
    throw new TypeError(
      "Quartz publication after a mutation requires a Garden slug or an explicit topology-neutral scope.",
    );
  }
  if (options.gardenSlug) {
    // Every in-process write to a Garden's files passes through here, so this
    // is where the cached note count for that Garden stops being true.
    invalidateGardenNoteCount(options.gardenSlug);
    const { invalidateThoughtTopologyAfterMutation } = await import(
      "./thought-topology/state.ts"
    );
    await invalidateThoughtTopologyAfterMutation(options.gardenSlug, reason);
  }
  if (!shouldAutoPublish()) return;

  const userId = sealedWorkerExecutor ? null : assertUserId(options.userId);
  const scope = options.gardenSlug
    ? normalizeScope([options.gardenSlug, ...LIBRARY_INDEX_SCOPES])
    : options.scope
      ? normalizeScope([...options.scope, ...LIBRARY_INDEX_SCOPES])
      : null;
  const publishPromise = queueQuartzPublish(reason, userId, scope);

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

/**
 * Warm derived Quartz pages while the dashboard remains usable. Repeated
 * Server Component renders must not enqueue another full-site publication
 * behind one that is already running; the next render can retry if that build
 * did not include the newly materialized source.
 */
export function publishQuartzIndexesIfIdle(reason: string, userId: number): void {
  if (activePublish || currentPublish) return;
  void publishQuartzAfterMutation(reason, {
    userId,
    topologyImpact: "none",
    // Only the library landing pages are stale here; they live under the
    // library roots, which every scoped publication rebuilds.
    scope: [],
  });
}

/**
 * Wait for only the publication batch that is running right now. A route that
 * needs a freshly materialized index can then check the output again instead
 * of blindly queueing a duplicate full-site build behind the dashboard warmup.
 */
export async function waitForQuartzPublicationInFlight(): Promise<boolean> {
  const publication = currentPublish ?? activePublish;
  if (!publication) return false;
  try {
    await publication;
  } catch {
    // The caller rechecks its output and can submit one recovery build.
  }
  return true;
}

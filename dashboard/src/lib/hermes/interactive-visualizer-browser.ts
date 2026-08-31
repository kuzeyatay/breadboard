if (typeof window !== "undefined") {
  throw new Error("Interactive visualizer Runtime control is server-only.");
}

import { createHash } from "node:crypto";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { Readable } from "node:stream";

import db from "../db.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import {
  abandonRuntimeJobInput,
  cancelRuntimeJob,
  cancelRuntimeJobByIdempotencyKey,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  reserveRuntimeJobInput,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  type RuntimeJobAuthority,
  type RuntimePublicStage,
  type RuntimeJobSnapshot,
} from "../supervisor-control.ts";
import { interactiveVisualizerConfig } from
  "./interactive-visualizer-config.ts";
import type { CustomInteractiveVisualizerManifest } from
  "./interactive-visualizer-custom.ts";
import type {
  InteractiveVisualizerBrowserTests,
  InteractiveVisualizerManifest,
  InteractiveVisualizerPlan,
  InteractiveVisualizerValidation,
} from "./interactive-visualizer-types.ts";

const PROTOCOL_VERSION = 1;
const SOURCE_MEDIA_TYPE =
  "application/vnd.breadboard.interactive-visualizer+json";
const SOURCE_DISPLAY_NAME = "interactive-visualizer-source.json";
const MAX_SOURCE_BYTES = 1024 * 1024;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const SHA256 = /^[0-9a-f]{64}$/u;

interface InteractiveVisualizerRuntimeScope {
  userId: number;
  runtimeSessionId: number;
  conversationId: number;
  clusterId: number | null;
}

interface RuntimeScopeRow {
  localJobId: string;
  userId: number;
  conversationId: number;
  conversationPublicId: string;
  clusterId: number | null;
  gardenId: string | null;
}

interface RuntimeVisualizerResult {
  status: "validation-failed" | "browser-failed" | "ready";
  validation: InteractiveVisualizerValidation;
  manifest:
    | InteractiveVisualizerManifest
    | CustomInteractiveVisualizerManifest
    | null;
  sourceHash: string | null;
  tests: InteractiveVisualizerBrowserTests | null;
  bundleHash: string | null;
  outputRelativePath: string | null;
  customPackage: boolean;
}

export interface InteractiveVisualizerRuntimePublication
  extends RuntimeVisualizerResult {
  bundleHtml: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function runtimeDataRoot(): string {
  const configured = process.env.BREADBOARD_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : repositoryRoot();
}

function idempotencyKey(localJobId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(localJobId)) {
    throw new TypeError("Interactive visualizer job identity is invalid.");
  }
  return `interactive-visualizer-v2:${localJobId}`;
}

function activeRuntimeRows(runtimeSessionId: number): RuntimeScopeRow[] {
  if (!Number.isSafeInteger(runtimeSessionId) || runtimeSessionId < 1) {
    throw new TypeError("Interactive visualizer runtime session is invalid.");
  }
  return db.prepare(`
    SELECT j.id AS localJobId, s.user_id AS userId,
           s.conversation_id AS conversationId,
           c.public_id AS conversationPublicId,
           s.cluster_id AS clusterId, s.garden_id AS gardenId
    FROM hermes_interactive_visualizer_jobs j
    JOIN hermes_runs r ON r.id = j.run_id
    JOIN hermes_runtime_sessions s ON s.id = r.runtime_session_id
    JOIN conversations c ON c.id = s.conversation_id
    WHERE s.id = ?
      AND j.status IN ('generating','validating','browser_testing')
    ORDER BY j.started_at DESC
    LIMIT 8
  `).all(runtimeSessionId) as RuntimeScopeRow[];
}

function scopeRow(
  scope: InteractiveVisualizerRuntimeScope,
  localJobId: string,
): RuntimeScopeRow {
  const row = activeRuntimeRows(scope.runtimeSessionId)
    .find((candidate) => candidate.localJobId === localJobId);
  if (
    !row ||
    row.userId !== scope.userId ||
    row.conversationId !== scope.conversationId ||
    row.clusterId !== scope.clusterId ||
    !row.conversationPublicId
  ) {
    throw new Error(
      "The interactive visualizer job is outside its authenticated conversation.",
    );
  }
  return row;
}

function authority(row: RuntimeScopeRow): RuntimeJobAuthority {
  return {
    userId: row.userId,
    gardenId: row.gardenId,
    conversationId: row.conversationPublicId,
  };
}

function isVisualizerJob(
  job: RuntimeJobSnapshot,
  expected: RuntimeJobAuthority,
): boolean {
  return job.jobType === "interactive-visualizer" &&
    job.workerKind === "interactive-visualizer-node" &&
    job.resourceClass === "browser-automation" &&
    job.gardenId === expected.gardenId &&
    job.conversationId === expected.conversationId;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForVisualizerJob(
  expected: RuntimeJobAuthority,
  initial: RuntimeJobSnapshot,
  timeoutMs: number,
  onStage?: (stage: RuntimePublicStage) => void,
): Promise<RuntimeJobSnapshot> {
  if (!isVisualizerJob(initial, expected)) {
    throw new Error("Runtime returned a job outside the visualizer contract.");
  }
  const deadline = Date.now() + timeoutMs;
  let job = initial;
  let observedStage: RuntimePublicStage | null = null;
  while (!TERMINAL_STATES.has(job.state)) {
    if (job.stage && job.stage !== observedStage) {
      observedStage = job.stage;
      onStage?.(job.stage);
    }
    if (Date.now() >= deadline) {
      await cancelRuntimeJob(expected, job.jobId).catch(() => undefined);
      throw new Error("Interactive visualizer processing timed out and was stopped.");
    }
    await delay(150);
    job = await inspectRuntimeJob(expected, job.jobId);
    if (!isVisualizerJob(job, expected)) {
      throw new Error("Runtime returned a job outside the visualizer contract.");
    }
  }
  if (job.state !== "succeeded") {
    if (job.state === "cancelled") {
      throw new Error("Interactive visualizer cancelled by user");
    }
    throw new Error(
      job.failureMessage ?? `Interactive visualizer processing ended as ${job.state}.`,
    );
  }
  return job;
}

function validValidation(value: unknown): value is InteractiveVisualizerValidation {
  if (
    !hasExactKeys(value, [
      "valid",
      "checkedAt",
      "astNodeCount",
      "sourceBytes",
      "imports",
      "errors",
      "warnings",
    ]) ||
    !isRecord(value) ||
    typeof value.valid !== "boolean" ||
    typeof value.checkedAt !== "string" ||
    !Number.isSafeInteger(value.astNodeCount) ||
    !Number.isSafeInteger(value.sourceBytes)
  ) return false;
  return [value.imports, value.errors, value.warnings].every(
    (items) => Array.isArray(items) &&
      items.length <= 256 &&
      items.every((item) => typeof item === "string"),
  );
}

function validTests(value: unknown): value is InteractiveVisualizerBrowserTests {
  if (
    !hasExactKeys(value, [
      "passed",
      "checkedAt",
      "viewports",
      "checks",
      "screenshotCreated",
    ]) ||
    !isRecord(value) ||
    typeof value.passed !== "boolean" ||
    typeof value.checkedAt !== "string" ||
    typeof value.screenshotCreated !== "boolean" ||
    !Array.isArray(value.viewports) ||
    value.viewports.length > 8 ||
    !value.viewports.every((item) => typeof item === "string") ||
    !Array.isArray(value.checks) ||
    value.checks.length > 16
  ) return false;
  return value.checks.every((check) =>
    isRecord(check) &&
    ["name,passed", "detail,name,passed"].includes(
      Object.keys(check).sort().join(","),
    ) &&
    typeof check.name === "string" &&
    typeof check.passed === "boolean" &&
    (check.detail === undefined || typeof check.detail === "string"));
}

function validManifest(
  value: unknown,
): value is InteractiveVisualizerManifest | CustomInteractiveVisualizerManifest {
  if (!isRecord(value)) return false;
  let bytes = Number.POSITIVE_INFINITY;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return false;
  }
  return bytes <= 64 * 1024 &&
    (value.schemaVersion === 1 || value.schemaVersion === 2) &&
    value.artifactType === "interactive-visualizer" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.accessibilityDescription === "string" &&
    ["2d", "3d", "hybrid"].includes(String(value.mode)) &&
    value.entry === "index.html" &&
    isRecord(value.runtime) &&
    value.runtime.id === "breadboard-interactive-visualizer" &&
    typeof value.runtime.version === "string";
}

/**
 * The exact acceptance predicate for a worker's durable `result.json`. Exported
 * so tests can prove the gate accepts what the worker actually writes for a
 * schema-2 package; the runtime path keeps calling it through `validateResult`.
 */
export function validateInteractiveVisualizerRuntimeResult(
  job: Pick<
    RuntimeJobSnapshot,
    "jobId" | "attempt" | "workerInstanceId" | "lastWorkerSequence"
  >,
  content: unknown,
): RuntimeVisualizerResult {
  return validateResult(job as RuntimeJobSnapshot, content);
}

function validateResult(
  job: RuntimeJobSnapshot,
  content: unknown,
): RuntimeVisualizerResult {
  if (
    !hasExactKeys(content, [
      "protocolVersion",
      "identity",
      "completionSequence",
      "result",
    ]) ||
    !isRecord(content) ||
    content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !hasExactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    !isRecord(content.identity) ||
    content.identity.jobId !== job.jobId ||
    content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !hasExactKeys(content.result, [
      "status",
      "validation",
      "manifest",
      "sourceHash",
      "tests",
      "bundleHash",
      "outputRelativePath",
      "customPackage",
    ]) ||
    !isRecord(content.result)
  ) {
    throw new Error("Runtime returned an unfenced visualizer result.");
  }
  const result = content.result;
  if (
    !["validation-failed", "browser-failed", "ready"].includes(
      String(result.status),
    ) ||
    !validValidation(result.validation) ||
    typeof result.customPackage !== "boolean"
  ) {
    throw new Error("Runtime returned an invalid visualizer result.");
  }
  if (result.status === "validation-failed") {
    if (
      result.validation.valid ||
      result.manifest !== null ||
      result.sourceHash !== null ||
      result.tests !== null ||
      result.bundleHash !== null ||
      result.outputRelativePath !== null
    ) {
      throw new Error("Runtime returned an invalid validation failure.");
    }
  } else {
    // Name the exact field that breaks the contract. A bare "invalid
    // browser-test result" once hid a manifest-schema mismatch behind a
    // message the model read as a runtime failure of its own package, and it
    // spent three repair attempts rewriting a bundle the browser gate had
    // already passed.
    const reason = browserTestResultDefect(result, result.validation);
    if (reason) {
      throw new Error(
        `Runtime returned an invalid browser-test result: ${reason}.`,
      );
    }
  }
  return result as unknown as RuntimeVisualizerResult;
}

function browserTestResultDefect(
  result: Record<string, unknown>,
  validation: InteractiveVisualizerValidation,
): string | null {
  if (!validation.valid) return "validation did not pass";
  if (!validManifest(result.manifest)) {
    const schema = isRecord(result.manifest)
      ? String(result.manifest.schemaVersion)
      : typeof result.manifest;
    return `manifest is not a supported visualizer manifest (schemaVersion ${schema})`;
  }
  if (typeof result.sourceHash !== "string" || !SHA256.test(result.sourceHash)) {
    return "sourceHash is not a sha256 digest";
  }
  if (!validTests(result.tests)) return "tests do not match the browser-test contract";
  if (typeof result.bundleHash !== "string" || !SHA256.test(result.bundleHash)) {
    return "bundleHash is not a sha256 digest";
  }
  const ready = result.status === "ready";
  if (ready !== result.tests.passed) {
    return `status ${String(result.status)} disagrees with tests.passed=${String(result.tests.passed)}`;
  }
  if (ready !== (typeof result.outputRelativePath === "string")) {
    return ready
      ? "ready result has no bundle path"
      : "failed result carries a bundle path";
  }
  return null;
}

function outputDirectory(job: RuntimeJobSnapshot): string {
  if (!job.workerInstanceId) {
    throw new Error("The visualizer worker has no fenced identity.");
  }
  return path.resolve(
    runtimeDataRoot(),
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "interactive-visualizer-output",
  );
}

/**
 * Reads a worker's `bundle.html` from inside its job fence. Exported so the
 * gate test can run the exact fence checks against real files under a
 * temporary data root; the runtime path calls it through `runVisualizerJob`.
 */
export function readFencedInteractiveVisualizerBundle(
  job: Pick<RuntimeJobSnapshot, "jobId" | "attempt" | "workerInstanceId">,
  relativePath: string,
): string {
  return readBundle(job as RuntimeJobSnapshot, relativePath);
}

function readBundle(job: RuntimeJobSnapshot, relativePath: string): string {
  if (!job.workerInstanceId || relativePath.includes("\\")) {
    throw new Error("Runtime returned an invalid visualizer bundle path.");
  }
  const expectedRelative = [
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "interactive-visualizer-output",
    "bundle.html",
  ].join("/");
  if (relativePath !== expectedRelative) {
    throw new Error("Runtime returned a visualizer bundle outside its fence.");
  }
  const root = runtimeDataRoot();
  const filePath = path.resolve(root, ...relativePath.split("/"));
  const metadata = fs.lstatSync(filePath);
  // Name the predicate that failed. A bare "bundle is unavailable" once cost a
  // whole turn: the worker had passed the package and written the bundle, and
  // nothing recorded which of these checks rejected it.
  const defect = bundleDefect(root, filePath, metadata);
  if (defect) {
    throw new Error(`The fenced visualizer bundle is unavailable: ${defect}.`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function bundleDefect(
  root: string,
  filePath: string,
  metadata: NonNullable<ReturnType<typeof fs.lstatSync>>,
): string | null {
  if (metadata.isSymbolicLink()) return "bundle path is a symbolic link";
  if (!metadata.isFile()) return "bundle path is not a regular file";
  if (metadata.size < 1) return "bundle is empty";
  const maximum = interactiveVisualizerConfig().maxArtifactBytes;
  if (metadata.size > maximum) {
    return `bundle is ${metadata.size} bytes, above the ${maximum}-byte artifact limit`;
  }
  // The fence rejects links *inside* the job tree. Canonicalise the data root
  // as well, so the way the root itself is spelled (a junction, an 8.3 short
  // name, a subst or differently-cased drive on Windows) cannot fail a bundle
  // that sits exactly where the worker wrote it.
  const canonicalRoot = fs.realpathSync.native(root);
  const expected = path.resolve(canonicalRoot, path.relative(root, filePath));
  const actual = fs.realpathSync.native(filePath);
  if (!samePath(actual, expected)) {
    console.error(
      "[interactive-visualizer] bundle resolves outside its fence",
      { expected, actual },
    );
    return "bundle resolves to a different location than its fenced path";
  }
  return null;
}

async function cancelRows(rows: RuntimeScopeRow[]): Promise<boolean> {
  const dispositions = await Promise.all(rows.map(async (row) => {
    const disposition = await cancelRuntimeJobByIdempotencyKey(
      authority(row),
      idempotencyKey(row.localJobId),
    );
    return disposition.accepted || disposition.jobId !== null;
  }));
  return dispositions.some(Boolean);
}

export async function cancelInteractiveVisualizerWork(
  runtimeSessionId: number,
): Promise<boolean> {
  const rows = activeRuntimeRows(runtimeSessionId);
  return rows.length > 0 ? await cancelRows(rows) : false;
}

export async function runInteractiveVisualizerPublicationViaRuntime(input: {
  scope: InteractiveVisualizerRuntimeScope;
  localJobId: string;
  plan: InteractiveVisualizerPlan;
    packageValue: unknown;
  onStage?: (stage: RuntimePublicStage) => void;
}): Promise<InteractiveVisualizerRuntimePublication> {
  const row = scopeRow(input.scope, input.localJobId);
  const jobAuthority = authority(row);
  const prior = activeRuntimeRows(input.scope.runtimeSessionId)
    .filter((candidate) => candidate.localJobId !== input.localJobId);
  if (prior.length > 0) await cancelRows(prior);
  const sourceBytes = Buffer.from(JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    plan: input.plan,
    package: input.packageValue,
  }), "utf8");
  if (sourceBytes.byteLength < 1 || sourceBytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("The interactive visualizer source exceeds its Runtime bound.");
  }
  const reservation = await reserveRuntimeJobInput(jobAuthority, {
    gardenId: jobAuthority.gardenId,
    conversationId: jobAuthority.conversationId,
    displayName: SOURCE_DISPLAY_NAME,
    mediaType: SOURCE_MEDIA_TYPE,
    declaredSizeBytes: sourceBytes.byteLength,
  });
  let submitted = false;
  let completedJob: RuntimeJobSnapshot | null = null;
  try {
    const uploaded = await uploadRuntimeJobInput(
      jobAuthority,
      reservation,
      Readable.toWeb(Readable.from([sourceBytes])) as ReadableStream<Uint8Array>,
    );
    const job = await submitRuntimeJob(jobAuthority, {
      jobType: "interactive-visualizer",
      idempotencyKey: idempotencyKey(input.localJobId),
      inputUploads: [{ uploadId: uploaded.uploadId }],
      requestPayload: {
        protocolVersion: PROTOCOL_VERSION,
        operation: "compile-test",
        runtimeSessionId: input.scope.runtimeSessionId,
      },
    });
    submitted = true;
    const timeoutMs = Math.max(
      180_000,
      interactiveVisualizerConfig().browserScenarioTimeoutMs * 7 + 60_000,
    );
    completedJob = await waitForVisualizerJob(
      jobAuthority,
      job,
      timeoutMs,
      input.onStage,
    );
    const output = await readRuntimeJobOutput(
      jobAuthority,
      completedJob.jobId,
      "result",
    );
    const result = validateResult(completedJob, output.content);
    const bundleHtml = result.outputRelativePath
      ? readBundle(completedJob, result.outputRelativePath)
      : null;
    if (
      bundleHtml &&
      createHash("sha256").update(bundleHtml).digest("hex") !== result.bundleHash
    ) {
      throw new Error("The fenced visualizer bundle digest does not match.");
    }
    return { ...result, bundleHtml };
  } finally {
    if (!submitted) {
      await abandonRuntimeJobInput(
        jobAuthority,
        reservation.uploadId,
      ).catch(() => undefined);
    }
    if (completedJob?.workerInstanceId) {
      fs.rmSync(outputDirectory(completedJob), {
        recursive: true,
        force: true,
        maxRetries: process.platform === "win32" ? 10 : 0,
        retryDelay: 100,
      });
    }
  }
}

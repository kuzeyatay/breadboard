import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  GeneratedVisualBrowserMountReceipt,
  GeneratedVisualPreviewMatrixReceipt,
  GeneratedVisualRejectedAttempt,
} from "./generated-visuals";

export const LEARN_VISUAL_REJECTED_ATTEMPT_SOURCE_MAX_BYTES = 16 * 1024;
export const LEARN_VISUAL_REJECTED_ATTEMPT_RECEIPT_MAX_BYTES = 128 * 1024;
export const LEARN_VISUAL_REJECTED_ATTEMPT_VISUAL_MAX_BYTES = 1024 * 1024;

const SNAPSHOT_ROOT = path.join(".breadboard", "learn-run-snapshots");
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const REJECTION_CATEGORIES = new Set<GeneratedVisualRejectedAttempt["category"]>([
  "generation_transport",
  "generation",
  "validation",
  "runtime",
  "critic_transport",
  "critic",
]);
const WINDOWS_LOCAL_PATH_PATTERN = /[A-Za-z]:[\\/][^\r\n"'`,;)}\]]+/g;
const UNC_LOCAL_PATH_PATTERN = /\\\\[^\\\s]+\\[^\r\n"'`,;)}\]]+/g;
const FILE_URI_PATTERN = /file:\/\/[^\s"'`,;)}\]]+/gi;
const UNIX_LOCAL_PATH_PATTERN =
  /(^|[\s([{=])\/(?!\/)(?:[^\s/"'`,;)}\]]+\/)*[^\s"'`,;)}\]]+/g;
const BROWSER_COMPLETIONS = new Set([
  "process_exit",
  "observed_dom",
  "observed_capture",
]);
const BROWSER_CLEANUP_METHODS = new Set([
  "natural-exit",
  "taskkill-tree",
  "process-group-sigkill",
  "process-kill",
]);
const VISUAL_LIFECYCLE_STATUSES = new Set([
  "draft",
  "validated",
  "compiled",
  "tested",
  "critic_approved",
  "published",
  "rejected",
]);

export interface LearnVisualRejectedAttemptAuditReceipt {
  schemaVersion: 1;
  gardenId: string;
  jobId: string;
  visualizationId: string;
  runId: string;
  attempt: number;
  category: GeneratedVisualRejectedAttempt["category"];
  rejectedAt: string;
  candidateSource: null | {
    source: string;
    fullByteLength: number;
    sha256: string;
    truncated: boolean;
    redacted: boolean;
  };
  errors: string[];
  validation?: Record<string, unknown>;
  tests?: Record<string, unknown>;
  critic?: Record<string, unknown>;
  previewMatrixReceipt?: Record<string, unknown>;
  lifecycle: Array<Record<string, unknown>>;
  evidenceTruncated?: boolean;
}

function assertSafeSegment(label: string, value: string): void {
  if (!SEGMENT_PATTERN.test(value)) {
    throw new Error(`Unsafe ${label} for rejected-attempt audit`);
  }
}

function assertAttempt(attempt: number): void {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 8) {
    throw new Error("Rejected-attempt audit attempt must be an integer from 1 through 8");
  }
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === "" || (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    return;
  }
  throw new Error("Rejected-attempt audit path escaped its garden snapshot root");
}

function assertRealContainment(gardenDir: string, snapshotRoot: string): void {
  const realGarden = fs.realpathSync(gardenDir);
  const realSnapshotRoot = fs.realpathSync(snapshotRoot);
  assertInside(realGarden, realSnapshotRoot);
}

function ensureDirectoryWithoutLinks(root: string, segments: string[]): string {
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error("Rejected-attempt audit root cannot be a symbolic link");
  }
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    assertInside(root, current);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("Rejected-attempt audit path contains a link or non-directory");
      }
    } else {
      fs.mkdirSync(current);
    }
  }
  return current;
}

function existingDirectoryWithoutLinks(
  root: string,
  segments: string[],
): string | null {
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    assertInside(root, current);
    if (!fs.existsSync(current)) return null;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Rejected-attempt audit path contains a link or non-directory");
    }
  }
  return current;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, Math.max(0, end)).toString("utf8");
}

function redactLocalPaths(value: string): string {
  return value
    .replace(FILE_URI_PATTERN, "[local-path]")
    .replace(UNC_LOCAL_PATH_PATTERN, "[local-path]")
    .replace(WINDOWS_LOCAL_PATH_PATTERN, "[local-path]")
    .replace(UNIX_LOCAL_PATH_PATTERN, (_match, prefix: string) => `${prefix}[local-path]`);
}

function boundedDiagnostic(value: unknown, maxBytes = 768): string {
  return truncateUtf8(redactLocalPaths(String(value ?? "")), maxBytes);
}

function boundedStrings(values: readonly unknown[] | undefined, count: number, bytes: number): string[] {
  return (values ?? []).slice(0, count).map((value) => boundedDiagnostic(value, bytes));
}

function safeNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, value));
}

function safeIso(value: unknown): string | undefined {
  return typeof value === "string" && ISO_PATTERN.test(value) ? value : undefined;
}

function safeBrowserCompletion(value: unknown): string | undefined {
  return typeof value === "string" && BROWSER_COMPLETIONS.has(value)
    ? value
    : undefined;
}

function safeBrowserCleanupMethod(value: unknown): string | undefined {
  return typeof value === "string" && BROWSER_CLEANUP_METHODS.has(value)
    ? value
    : undefined;
}

function safeLifecycleStatus(value: unknown): string {
  return typeof value === "string" && VISUAL_LIFECYCLE_STATUSES.has(value)
    ? value
    : "rejected";
}

function sanitizeTestCases(
  values: Array<{ name: string; passed: boolean; detail?: string }> | undefined,
): Array<Record<string, unknown>> {
  return (values ?? []).slice(0, 20).map((entry) => ({
    name: boundedDiagnostic(entry.name, 192),
    passed: Boolean(entry.passed),
    ...(entry.detail ? { detail: boundedDiagnostic(entry.detail, 512) } : {}),
  }));
}

function sanitizePreviewMatrixReceipt(
  receipt: GeneratedVisualPreviewMatrixReceipt | undefined,
): Record<string, unknown> | undefined {
  if (!receipt) return undefined;
  return {
    expectedCount: safeNumber(receipt.expectedCount, 0, 64) ?? 0,
    capturedCount: safeNumber(receipt.capturedCount, 0, 64) ?? 0,
    cells: receipt.cells.slice(0, 16).map((cell) => ({
      id: boundedDiagnostic(cell.id, 160),
      viewport: {
        width: safeNumber(cell.viewport.width, 1, 10_000) ?? 1,
        height: safeNumber(cell.viewport.height, 1, 10_000) ?? 1,
      },
      theme: cell.theme === "dark" ? "dark" : "light",
      selectState: cell.selectState.slice(0, 8).map((state) => ({
        controlId: boundedDiagnostic(state.controlId, 128),
        optionIndex: safeNumber(state.optionIndex, 0, 128) ?? 0,
        optionLabel: boundedDiagnostic(state.optionLabel, 192),
      })),
      defaultState: Boolean(cell.defaultState),
      selectStateCoverageTruncated: Boolean(cell.selectStateCoverageTruncated),
      captured: Boolean(cell.captured),
      attempts: cell.attempts.slice(0, 4).map((attempt) => ({
        attempt: safeNumber(attempt.attempt, 1, 8) ?? 1,
        status: attempt.status === null ? null : safeNumber(attempt.status, -1, 999) ?? null,
        signal: attempt.signal ? boundedDiagnostic(attempt.signal, 64) : null,
        screenshotCreated: Boolean(attempt.screenshotCreated),
        ...(safeNumber(attempt.screenshotBytes, 0, Number.MAX_SAFE_INTEGER) !== undefined
          ? { screenshotBytes: safeNumber(attempt.screenshotBytes, 0, Number.MAX_SAFE_INTEGER) }
          : {}),
        ...(typeof attempt.previewPrimarySpatialFrameValidated === "boolean"
          ? { previewPrimarySpatialFrameValidated: attempt.previewPrimarySpatialFrameValidated }
          : {}),
        ...(typeof attempt.timedOut === "boolean" ? { timedOut: attempt.timedOut } : {}),
        ...(attempt.errorCode ? { errorCode: boundedDiagnostic(attempt.errorCode, 96) } : {}),
        ...(safeBrowserCompletion(attempt.completion)
          ? { completion: safeBrowserCompletion(attempt.completion) }
          : {}),
        ...(typeof attempt.browserExitedNaturally === "boolean"
          ? { browserExitedNaturally: attempt.browserExitedNaturally }
          : {}),
        ...(safeBrowserCleanupMethod(attempt.cleanupMethod)
          ? { cleanupMethod: safeBrowserCleanupMethod(attempt.cleanupMethod) }
          : {}),
        ...(typeof attempt.cleanupConfirmed === "boolean"
          ? { cleanupConfirmed: attempt.cleanupConfirmed }
          : {}),
        ...(safeNumber(attempt.retryDelayMs, 0, 900_000) !== undefined
          ? { retryDelayMs: safeNumber(attempt.retryDelayMs, 0, 900_000) }
          : {}),
      })),
    })),
  };
}

function sanitizeMountReceipts(
  receipts: GeneratedVisualBrowserMountReceipt[] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!receipts) return undefined;
  return receipts.slice(0, 12).map((receipt) => ({
    scenario: boundedDiagnostic(receipt.scenario, 160),
    viewport: boundedDiagnostic(receipt.viewport, 96),
    theme: receipt.theme === "dark" ? "dark" : "light",
    mounted: Boolean(receipt.mounted),
    attempts: receipt.attempts.slice(0, 4).map((attempt) => ({
      attempt: safeNumber(attempt.attempt, 1, 8) ?? 1,
      status: attempt.status === null ? null : safeNumber(attempt.status, -1, 999) ?? null,
      signal: attempt.signal ? boundedDiagnostic(attempt.signal, 64) : null,
      mounted: Boolean(attempt.mounted),
      ...(typeof attempt.timedOut === "boolean" ? { timedOut: attempt.timedOut } : {}),
      ...(attempt.errorCode ? { errorCode: boundedDiagnostic(attempt.errorCode, 96) } : {}),
      ...(attempt.transientFailureCode
        ? { transientFailureCode: boundedDiagnostic(attempt.transientFailureCode, 96) }
        : {}),
      ...(safeBrowserCompletion(attempt.completion)
        ? { completion: safeBrowserCompletion(attempt.completion) }
        : {}),
      ...(typeof attempt.cleanupConfirmed === "boolean"
        ? { cleanupConfirmed: attempt.cleanupConfirmed }
        : {}),
    })),
  }));
}

function buildReceipt(input: {
  gardenId: string;
  jobId: string;
  rejectedAttempt: GeneratedVisualRejectedAttempt;
}): LearnVisualRejectedAttemptAuditReceipt {
  const attempt = input.rejectedAttempt;
  const source = attempt.candidate?.sourceCode;
  const sourceBytes = source === undefined ? undefined : Buffer.from(source, "utf8");
  const redactedSource = source === undefined ? undefined : redactLocalPaths(source);
  const redactedSourceBytes =
    redactedSource === undefined ? undefined : Buffer.byteLength(redactedSource, "utf8");
  const validation = attempt.evidence?.validation;
  const tests = attempt.evidence?.tests;
  const critic = attempt.evidence?.critic;
  const previewMatrixReceipt = sanitizePreviewMatrixReceipt(
    tests?.browser?.previewMatrixReceipt,
  );
  return {
    schemaVersion: 1,
    gardenId: boundedDiagnostic(input.gardenId, 128),
    jobId: input.jobId,
    visualizationId: attempt.visualizationId,
    runId: attempt.runId,
    attempt: attempt.attempt,
    category: attempt.category,
    rejectedAt: safeIso(attempt.rejectedAt) ?? new Date().toISOString(),
    candidateSource:
      source === undefined ||
      sourceBytes === undefined ||
      redactedSource === undefined ||
      redactedSourceBytes === undefined
        ? null
        : {
            source: truncateUtf8(
              redactedSource,
              LEARN_VISUAL_REJECTED_ATTEMPT_SOURCE_MAX_BYTES,
            ),
            fullByteLength: sourceBytes.byteLength,
            sha256: crypto.createHash("sha256").update(sourceBytes).digest("hex"),
            truncated:
              sourceBytes.byteLength > LEARN_VISUAL_REJECTED_ATTEMPT_SOURCE_MAX_BYTES ||
              redactedSourceBytes > LEARN_VISUAL_REJECTED_ATTEMPT_SOURCE_MAX_BYTES,
            redacted: redactedSource !== source,
          },
    errors: boundedStrings(attempt.errors, 20, 768),
    ...(validation
      ? {
          validation: {
            valid: Boolean(validation.valid),
            checkedAt: safeIso(validation.checkedAt),
            astNodeCount: safeNumber(validation.astNodeCount, 0, 1_000_000),
            sourceBytes: safeNumber(validation.sourceBytes, 0, 10_000_000),
            imports: boundedStrings(validation.imports, 12, 192),
            errors: boundedStrings(validation.errors, 20, 512),
            warnings: boundedStrings(validation.warnings, 20, 512),
          },
        }
      : {}),
    ...(tests
      ? {
          tests: {
            passed: Boolean(tests.passed),
            checkedAt: safeIso(tests.checkedAt),
            staticTests: sanitizeTestCases(tests.staticTests),
            semanticTests: sanitizeTestCases(tests.semanticTests),
            runtimeTests: sanitizeTestCases(tests.runtimeTests),
            ...(tests.browser
              ? {
                  browser: {
                    viewports: boundedStrings(tests.browser.viewports, 16, 96),
                    screenshotCreated: Boolean(tests.browser.screenshotCreated),
                    previewCount: safeNumber(tests.browser.previewCount, 0, 64),
                    selectStateCount: safeNumber(tests.browser.selectStateCount, 0, 64),
                    selectStateCoverageTruncated: Boolean(
                      tests.browser.selectStateCoverageTruncated,
                    ),
                    previewMatrixComplete: Boolean(tests.browser.previewMatrixComplete),
                    mountReceipts: sanitizeMountReceipts(tests.browser.mountReceipts),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(critic
      ? {
          critic: {
            approved: Boolean(critic.approved),
            checkedAt: safeIso(critic.checkedAt),
            reason: boundedDiagnostic(critic.reason, 1_024),
            requestedChanges: boundedStrings(critic.requestedChanges, 16, 768),
            scores: {
              pedagogicalValue: safeNumber(critic.scores.pedagogicalValue, 0, 1),
              sourceFidelity: safeNumber(critic.scores.sourceFidelity, 0, 1),
              usability: safeNumber(critic.scores.usability, 0, 1),
              accessibility: safeNumber(critic.scores.accessibility, 0, 1),
            },
            ...(typeof critic.providerApproved === "boolean"
              ? { providerApproved: critic.providerApproved }
              : {}),
          },
        }
      : {}),
    ...(previewMatrixReceipt ? { previewMatrixReceipt } : {}),
    lifecycle: attempt.lifecycle.slice(0, 16).map((entry) => ({
      status: safeLifecycleStatus(entry.status),
      at: safeIso(entry.at),
      attempt: safeNumber(entry.attempt, 1, 8),
      ...(entry.detail ? { detail: boundedDiagnostic(entry.detail, 512) } : {}),
    })),
  };
}

function serializeBoundedReceipt(
  receipt: LearnVisualRejectedAttemptAuditReceipt,
): { receipt: LearnVisualRejectedAttemptAuditReceipt; bytes: Buffer } {
  let bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  if (bytes.byteLength <= LEARN_VISUAL_REJECTED_ATTEMPT_RECEIPT_MAX_BYTES) {
    return { receipt, bytes };
  }
  const bounded: LearnVisualRejectedAttemptAuditReceipt = {
    schemaVersion: receipt.schemaVersion,
    gardenId: receipt.gardenId,
    jobId: receipt.jobId,
    visualizationId: receipt.visualizationId,
    runId: receipt.runId,
    attempt: receipt.attempt,
    category: receipt.category,
    rejectedAt: receipt.rejectedAt,
    candidateSource: receipt.candidateSource,
    errors: receipt.errors.slice(0, 8).map((error) => boundedDiagnostic(error, 384)),
    lifecycle: receipt.lifecycle.slice(-8).map((entry) => ({
      status: entry.status,
      at: entry.at,
      attempt: entry.attempt,
    })),
    evidenceTruncated: true,
  };
  bytes = Buffer.from(`${JSON.stringify(bounded, null, 2)}\n`, "utf8");
  if (bytes.byteLength > LEARN_VISUAL_REJECTED_ATTEMPT_RECEIPT_MAX_BYTES) {
    throw new Error("Rejected-attempt audit receipt exceeded its hard byte limit");
  }
  return { receipt: bounded, bytes };
}

function snapshotDirectory(gardenDir: string, jobId: string): string {
  assertSafeSegment("job id", jobId);
  const resolvedGarden = path.resolve(gardenDir);
  if (!fs.existsSync(resolvedGarden) || !fs.statSync(resolvedGarden).isDirectory()) {
    throw new Error("Rejected-attempt audit garden directory does not exist");
  }
  const root = path.resolve(resolvedGarden, SNAPSHOT_ROOT);
  assertInside(resolvedGarden, root);
  if (!fs.existsSync(root)) {
    throw new Error("Rejected-attempt audit snapshot root does not exist");
  }
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Rejected-attempt audit root cannot be a symbolic link or non-directory");
  }
  assertRealContainment(resolvedGarden, root);
  const snapshotDir = existingDirectoryWithoutLinks(root, [jobId]);
  if (!snapshotDir) {
    throw new Error("Rejected-attempt audit Learn job snapshot does not exist");
  }
  return snapshotDir;
}

function assertSnapshotManifest(
  snapshotDir: string,
  gardenId: string,
  jobId: string,
): void {
  const manifestPath = path.join(snapshotDir, "manifest.json");
  const manifestStat = fs.lstatSync(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error("Rejected-attempt audit snapshot manifest must be a regular file");
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    schemaVersion?: unknown;
    gardenId?: unknown;
    jobId?: unknown;
  };
  if (parsed.schemaVersion !== 1 || parsed.gardenId !== gardenId || parsed.jobId !== jobId) {
    throw new Error("Rejected-attempt audit snapshot manifest does not match its Learn job");
  }
}

function jsonBytesUnder(root: string): number {
  let total = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      assertInside(root, entryPath);
      if (entry.isSymbolicLink()) {
        throw new Error("Rejected-attempt audit tree cannot contain symbolic links");
      }
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        total += fs.statSync(entryPath).size;
      }
    }
  }
  return total;
}

export function persistLearnVisualRejectedAttemptAudit(input: {
  gardenDir: string;
  gardenId: string;
  jobId: string;
  rejectedAttempt: GeneratedVisualRejectedAttempt;
}): { filePath: string; receipt: LearnVisualRejectedAttemptAuditReceipt } {
  assertSafeSegment("visualization id", input.rejectedAttempt.visualizationId);
  assertSafeSegment("run id", input.rejectedAttempt.runId);
  assertAttempt(input.rejectedAttempt.attempt);
  if (!REJECTION_CATEGORIES.has(input.rejectedAttempt.category)) {
    throw new Error("Rejected-attempt audit category is not allowlisted");
  }
  const snapshotDir = snapshotDirectory(input.gardenDir, input.jobId);
  assertSnapshotManifest(snapshotDir, input.gardenId, input.jobId);
  const visualDir = ensureDirectoryWithoutLinks(snapshotDir, [
    "failed-generated-visuals",
    input.rejectedAttempt.visualizationId,
    input.rejectedAttempt.runId,
  ]);
  const built = serializeBoundedReceipt(buildReceipt(input));
  const fileName = `attempt-${input.rejectedAttempt.attempt}.json`;
  const filePath = path.join(visualDir, fileName);
  assertInside(snapshotDir, filePath);
  let existingBytes = 0;
  if (fs.existsSync(filePath)) {
    const existingStat = fs.lstatSync(filePath);
    if (existingStat.isSymbolicLink() || !existingStat.isFile()) {
      throw new Error("Rejected-attempt audit destination must be a regular file");
    }
    existingBytes = existingStat.size;
  }
  const currentVisualBytes = jsonBytesUnder(
    path.join(
      snapshotDir,
      "failed-generated-visuals",
      input.rejectedAttempt.visualizationId,
    ),
  );
  if (
    currentVisualBytes - existingBytes + built.bytes.byteLength >
    LEARN_VISUAL_REJECTED_ATTEMPT_VISUAL_MAX_BYTES
  ) {
    throw new Error("Rejected-attempt audit exceeded its per-visual byte limit");
  }
  const temporaryPath = path.join(
    visualDir,
    `.${fileName}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  assertInside(snapshotDir, temporaryPath);
  try {
    fs.writeFileSync(temporaryPath, built.bytes, { flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the primary audit result; a failed temp cleanup is retriable.
    }
  }
  return { filePath, receipt: built.receipt };
}

export function removeLearnVisualRejectedAttemptAudit(input: {
  gardenDir: string;
  jobId: string;
  visualizationId: string;
}): void {
  assertSafeSegment("job id", input.jobId);
  assertSafeSegment("visualization id", input.visualizationId);
  const root = path.resolve(input.gardenDir, SNAPSHOT_ROOT);
  if (!fs.existsSync(root)) return;
  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error("Rejected-attempt audit root cannot be a symbolic link");
  }
  assertRealContainment(input.gardenDir, root);
  const target = existingDirectoryWithoutLinks(root, [
    input.jobId,
    "failed-generated-visuals",
    input.visualizationId,
  ]);
  if (!target) return;
  fs.rmSync(target, { recursive: true, force: true });
}

/** Clear diagnostic subtrees across sibling snapshots after a terminal cleanup
 * or successful Learn publication. Manifests and rollback files are untouched. */
export function removeAllLearnVisualRejectedAttemptAudits(gardenDir: string): number {
  const root = path.resolve(gardenDir, SNAPSHOT_ROOT);
  if (!fs.existsSync(root)) return 0;
  assertRealContainment(gardenDir, root);
  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error("Rejected-attempt audit root cannot be a symbolic link");
  }
  let removed = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SEGMENT_PATTERN.test(entry.name)) continue;
    const target = path.join(root, entry.name, "failed-generated-visuals");
    assertInside(root, target);
    if (!fs.existsSync(target)) continue;
    if (fs.lstatSync(target).isSymbolicLink()) {
      throw new Error("Rejected-attempt audit cleanup target cannot be a symbolic link");
    }
    fs.rmSync(target, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

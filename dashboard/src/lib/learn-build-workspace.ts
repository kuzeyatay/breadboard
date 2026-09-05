/**
 * Run-isolated Learn build workspace (Parts 1-2).
 *
 * A Learn run must NEVER mutate the published garden tree directly. The
 * repository garden (…/quartz/content/<garden>, often inside a OneDrive-synced
 * folder) is a *publication destination*, not a build scratch space: generating
 * in place is exactly what let an old and a new generation tree coexist under a
 * single active `learning/` directory and produce duplicate unit mappings.
 *
 * Every run gets its own workspace under a non-synchronized location. Fresh
 * generation seeds only durable inputs. Additive updates also seed the prior
 * generated-visual implementations so unchanged lesson bodies can keep their
 * validated interactives; the old `learning/` paths themselves are still left
 * behind and are reconstructed by stable learning-unit id. The finished,
 * validated staging tree is later promoted atomically (see
 * learn-atomic-promotion.ts). A workspace is disposable only after success,
 * explicit cancellation, or supersession. Ordinary failures retain the exact
 * staged candidate for diagnosis and continuation.
 */

import type { Dirent, Stats } from "node:fs";
import os from "node:os";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import crypto from "node:crypto";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import {
  isTransientFileOpenError,
  withTransientFileOpenRetry,
} from "./resilient-fs.ts";

export interface LearnBuildWorkspace {
  buildId: string;
  jobId: string;
  gardenSlug: string;

  mode: "generate" | "regenerate" | "update";

  repositoryGardenDir: string;
  previousPublishedGardenDir?: string;

  workspaceRoot: string;
  stagingGardenDir: string;
  stagingLearningDir: string;

  contractFingerprint: string;
  sourceSetFingerprint: string;
  /** Fingerprint of every durable input copied from the repository. Promotion
   * is refused when it changes while generation is running. */
  durableInputFingerprint: string;

  /** Byte-level identity captured from the authoritative source-anchor ledger
   * while this isolated workspace was seeded. Generation re-verifies it before
   * any canonical-anchor validation or contract write. */
  authoritativeSourceAnchorLedger?: AuthoritativeSourceAnchorLedgerSnapshot;

  createdAt: string;

  /** Active while a worker owns the build. A non-cancelled generation failure
   * changes this to `retained_after_failure` instead of deleting the candidate. */
  lifecycle: "active" | "retained_after_failure";
  retainedAt?: string;
  retentionReason?: "generation_failure" | "abandoned_worker";
  retentionStage?: string;

  /** Present only on a new active workspace cloned from a compatible retained
   * candidate. The retained source tree remains immutable and available for
   * audit while this job continues its exact staged checkpoints. */
  resumedFromBuildId?: string;
  resumedFromJobId?: string;
  resumedFromWorkspaceRoot?: string;
  /** True when workspace creation removed the source job's acceptance receipt
   * after cloning. Any later receipt therefore belongs to this job. */
  inheritedAcceptanceStatusCleared?: true;
}

export interface AuthoritativeSourceAnchorLedgerSnapshot {
  relativePath: ".breadboard/source-anchors.json";
  byteLength: number;
  sha256: string;
}

/** Directory / top-level names that are DISPOSABLE build output, never seeded
 * into a fresh workspace. Anything not on this list and not under `.breadboard`
 * is treated as a durable input and copied. */
const DISPOSABLE_TOP_LEVEL = new Set([
  "learning",
  ".breadboard",
  ".previous-builds",
  ".tmp",
  "node_modules",
]);

/** Durable subtrees inside `.breadboard` that ARE seeded (canonical source
 * extraction records the new run must not recompute). Everything else under
 * `.breadboard` is disposable projection output. */
const DURABLE_BREADBOARD_ENTRIES = new Set([
  "source-visuals.json", // canonical source extraction ledger
  "source-visual-source-index.json", // durable garden-global S<n> ownership
  "source-formula-reviews", // AI-authored formula fidelity records + PDF-render evidence
  "source-formula-review-set.json", // stable reviewed-formula set/source-hash binding
  "source-normalization-receipt.json", // exact pre/post source-byte normalization provenance
  "source-anchors.json", // canonical model-selected source-anchor ledger
  // The current confirmed planning contract is an input to generation. Its
  // independent staged copy binds syllabus evidence-recovery before writers
  // can replace it, so omitting it would make a valid recovered plan fail
  // closed solely because the workspace lacks the receipt to verify.
  "learning-unit-contract.json",
  "sources", // extracted per-source markdown, if present here
  "events.jsonl", // append-only operational history; merged before promotion
]);

/** Known Learn projections that must be rebuilt from scratch. Unknown
 * `.breadboard` entries are preserved because they may belong to another
 * subsystem and atomic promotion must never erase them. */
const DISPOSABLE_BREADBOARD_ENTRIES = new Set([
  "internal",
  "backups",
  "build-workspace.json",
  "canonical-shadow",
  "debug",
  "learn-run-snapshots",
  "planning",
  "quarantine",
  "source-snapshots",
  "acceptance-status.json",
  "active-build-manifest.json",
  "anchor-critic-decisions.json",
  "anchor-replacement-plan.json",
  "anchor-replacement-plan.md",
  "claims.json",
  "claims-history.json",
  "concept-registry.json",
  "concept-registry-history.json",
  "critic-issues.json",
  "critic-loop.json",
  "critic-report.md",
  "formula-assignment-plan.json",
  "formula-identities.json",
  "humanizer",
  "learn-build.lock.json",
  "repair-log.json",
  "repair-report.md",
  "render-manifest.json",
  "scoped-repair.json",
  "scoped-repair.md",
  "semantic-migration.json",
  "source-anchor-evidence.json",
  "source-anchor-evidence.md",
  "source-anchor-migration.json",
  "source-anchor-migration.md",
  "source-anchors.json",
  "validation-report.md",
  "visual-index.json",
  "visual-contract-executability-reviews.json",
  "visual-decision-records.json",
  "visual-necessity-decisions.json",
  "visual-necessity-decisions.md",
  "visualization-coverage.json",
  "visualization-coverage.md",
  "visualization-events.json",
  "visualization-plan.json",
  "visualization-report.md",
  "visuals",
  "weak-anchor-self-healing.json",
  "weak-anchor-self-healing.md",
]);

/** Generated assets referenced by a reused lesson body. They are safe to seed
 * only for an additive update; the final exact-live-id prune removes anything
 * the merged curriculum no longer references before publication. */
const INCREMENTAL_BREADBOARD_ENTRIES = [
  "visuals",
  "visual-index.json",
] as const;

/** Windows paths are case-insensitive, so exclusion policy must be too. */
function normalizedEntryName(value: string): string {
  return value.toLowerCase();
}

function shortHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function temporaryBuildsBaseDir(): string {
  return path.join(os.tmpdir(), "breadboard-learn");
}

function runtimeWorkerBuildsBaseDir(): string | null {
  const runtimeRoot = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR?.trim();
  return runtimeRoot && path.isAbsolute(runtimeRoot)
    ? path.join(runtimeRoot, "builds")
    : null;
}

function runtimeWorkerRetainedBuildsBaseDir(): string | null {
  const runtimeRoot = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR?.trim();
  return runtimeRoot && path.isAbsolute(runtimeRoot)
    ? path.join(runtimeRoot, "retained-builds")
    : null;
}

function configuredDataBuildsBaseDir(): string | null {
  const dataRoot = process.env.BREADBOARD_DATA_DIR?.trim();
  return dataRoot && path.isAbsolute(dataRoot)
    ? path.join(dataRoot, "runtime", "learn-workers", "builds")
    : null;
}

function configuredDataRetainedBuildsBaseDir(): string | null {
  const dataRoot = process.env.BREADBOARD_DATA_DIR?.trim();
  return dataRoot && path.isAbsolute(dataRoot)
    ? path.join(dataRoot, "runtime", "learn-workers", "retained-builds")
    : null;
}

function developmentWorkerBuildsBaseDir(): string | null {
  const configuredDashboard =
    process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR?.trim();
  const dashboardRoot = configuredDashboard && path.isAbsolute(configuredDashboard)
    ? configuredDashboard
    : path.basename(process.cwd()).toLowerCase() === "dashboard"
      ? process.cwd()
      : null;
  return dashboardRoot
    ? path.join(path.dirname(dashboardRoot), "runtime", "learn-workers", "builds")
    : null;
}

function systemTemporaryBuildsBaseDir(): string | null {
  if (process.platform !== "win32") return null;
  const systemRoot = process.env.SystemRoot?.trim();
  return systemRoot && path.isAbsolute(systemRoot)
    ? path.join(systemRoot, "Temp", "breadboard-learn")
    : null;
}

function retainedBuildsBaseDir(): string | null {
  const localAppData = process.env.LOCALAPPDATA?.trim();
  return localAppData
    ? path.join(localAppData, "Breadboard", "retained-builds")
    : null;
}

function learnWorkspaceBaseCandidates(): string[] {
  const candidateBases = [
    buildsBaseDir(),
    runtimeWorkerBuildsBaseDir(),
    runtimeWorkerRetainedBuildsBaseDir(),
    configuredDataBuildsBaseDir(),
    configuredDataRetainedBuildsBaseDir(),
    developmentWorkerBuildsBaseDir(),
    process.env.LOCALAPPDATA?.trim()
      ? path.join(process.env.LOCALAPPDATA.trim(), "Breadboard", "builds")
      : null,
    retainedBuildsBaseDir(),
    temporaryBuildsBaseDir(),
    systemTemporaryBuildsBaseDir(),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return [...new Set(candidateBases.map((base) => path.resolve(base)))];
}

function buildsBaseDir(): string {
  const runtimeWorkerRoot = runtimeWorkerBuildsBaseDir();
  if (runtimeWorkerRoot) return runtimeWorkerRoot;
  const configuredDataRoot = configuredDataBuildsBaseDir();
  if (configuredDataRoot) return configuredDataRoot;
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData && localAppData.trim()) {
    return path.join(localAppData, "Breadboard", "builds");
  }
  return temporaryBuildsBaseDir();
}

/** Compute the default (non-synchronized) workspace root for a run. */
export function defaultWorkspaceRoot(gardenSlug: string, jobId: string): string {
  return path.join(buildsBaseDir(), gardenSlug, jobId);
}

/**
 * Fallback scratch root for a default LOCALAPPDATA workspace whose directory
 * operations are temporarily denied. OS temp remains outside the published
 * garden and is safe for fully isolated, disposable Learn staging.
 */
export function temporaryWorkspaceRoot(gardenSlug: string, jobId: string): string {
  return path.join(temporaryBuildsBaseDir(), gardenSlug, jobId);
}

/** All known isolated roots for a job, in preference order. A root is only
 * disposable after the caller has established success, cancellation, or
 * supersession; failed candidates may be retained at either location. */
export function learnWorkspaceRootCandidates(
  gardenSlug: string,
  jobId: string,
): string[] {
  return [...new Set(learnWorkspaceBaseCandidates().map((base) =>
    path.resolve(base, gardenSlug, jobId)
  ))];
}

function workspaceRootUnavailable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code?.toUpperCase();
  return isTransientFileOpenError(error) || code === "ENOTDIR" || code === "EROFS";
}

function pathIsWithinOrEqual(candidate: string, container: string): boolean {
  const relative = path.relative(path.resolve(container), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function assertIsolatedWorkspaceRoot(
  workspaceRoot: string,
  repositoryGardenDir: string,
): void {
  if (
    pathIsWithinOrEqual(workspaceRoot, repositoryGardenDir) ||
    pathIsWithinOrEqual(repositoryGardenDir, workspaceRoot)
  ) {
    throw new Error(
      "Learn workspace must be outside the authoritative repository garden.",
    );
  }
}

export interface LearnWorkspaceDirectoryFileSystem {
  rmSync(directoryPath: string, options: { recursive: true; force: true }): void;
  mkdirSync(directoryPath: string, options: { recursive: true }): string | undefined;
}

export interface PrepareLearnWorkspaceRootOptions {
  workspaceRoot: string;
  fallbackWorkspaceRoot?: string;
  repositoryGardenDir: string;
  stagingDirectoryName: string;
  /** Explicit caller roots remain authoritative and are never relocated. */
  allowFallback: boolean;
  retryDelaysMs?: readonly number[];
  sleep?: (milliseconds: number) => void;
  fileSystem?: LearnWorkspaceDirectoryFileSystem;
}

export interface PreparedLearnWorkspaceRoot {
  workspaceRoot: string;
  stagingGardenDir: string;
  stagingLearningDir: string;
  usedFallback: boolean;
}

const NODE_WORKSPACE_DIRECTORY_FILE_SYSTEM: LearnWorkspaceDirectoryFileSystem = {
  rmSync(directoryPath, options) {
    fs.rmSync(directoryPath, options);
  },
  mkdirSync(directoryPath, options) {
    return fs.mkdirSync(directoryPath, options);
  },
};

/**
 * Prepare a clean, isolated staging root. The only fallback is from the
 * automatic LOCALAPPDATA location to OS temp after bounded, transient
 * directory-operation retries. It never masks a caller-selected root or a
 * durable source/seed failure.
 */
export function prepareLearnWorkspaceRoot(
  options: PrepareLearnWorkspaceRootOptions,
): PreparedLearnWorkspaceRoot {
  const fileSystem = options.fileSystem ?? NODE_WORKSPACE_DIRECTORY_FILE_SYSTEM;
  const removeRootBestEffort = (workspaceRoot: string): void => {
    try {
      fileSystem.rmSync(workspaceRoot, { recursive: true, force: true });
    } catch {
      // A locked disposable workspace is never publication authority. Preserve
      // the original setup error and leave it for later OS cleanup.
    }
  };
  const reset = (workspaceRoot: string): void => {
    const stagingGardenDir = path.join(workspaceRoot, options.stagingDirectoryName);
    assertIsolatedWorkspaceRoot(workspaceRoot, options.repositoryGardenDir);
    // This new job identity cannot already own a retained failed candidate.
    // Retry only transient filesystem boundaries; durable source seeding below
    // remains fail-closed.
    withTransientFileOpenRetry(() => {
      fileSystem.rmSync(workspaceRoot, { recursive: true, force: true });
      fileSystem.mkdirSync(stagingGardenDir, { recursive: true });
    }, {
      retryDelaysMs: options.retryDelaysMs,
      sleep: options.sleep,
    });
  };
  const prepared = (workspaceRoot: string, usedFallback: boolean): PreparedLearnWorkspaceRoot => {
    const stagingGardenDir = path.join(workspaceRoot, options.stagingDirectoryName);
    return {
      workspaceRoot,
      stagingGardenDir,
      stagingLearningDir: path.join(stagingGardenDir, "learning"),
      usedFallback,
    };
  };

  // This establishes that every later best-effort cleanup below targets an
  // isolated, disposable location. Do it outside the try/catch so an unsafe
  // caller root is rejected rather than ever becoming a delete target.
  assertIsolatedWorkspaceRoot(options.workspaceRoot, options.repositoryGardenDir);
  try {
    reset(options.workspaceRoot);
    return prepared(options.workspaceRoot, false);
  } catch (error) {
    const fallbackRoot = options.fallbackWorkspaceRoot;
    if (
      !options.allowFallback ||
      !fallbackRoot ||
      !workspaceRootUnavailable(error) ||
      path.resolve(fallbackRoot) === path.resolve(options.workspaceRoot)
    ) {
      removeRootBestEffort(options.workspaceRoot);
      throw error;
    }
    // A recursive mkdir can have made a partial job tree before an EPERM. It
    // is disposable and gets one best-effort cleanup before this job moves to
    // a distinct root; abandoned-job recovery also covers both roots later.
    removeRootBestEffort(options.workspaceRoot);
    // Validate before entering the cleanup guard: a rejected candidate must
    // never become a recursive-delete target.
    assertIsolatedWorkspaceRoot(fallbackRoot, options.repositoryGardenDir);
    try {
      reset(fallbackRoot);
    } catch (fallbackError) {
      // `mkdir -p` can leave a partial temp job tree before a later directory
      // operation fails. This run is terminal if fallback setup fails, so
      // remove that known-safe disposable root immediately rather than rely on
      // abandoned-worker recovery (which only sweeps interrupted jobs).
      removeRootBestEffort(fallbackRoot);
      throw fallbackError;
    }
    return prepared(fallbackRoot, true);
  }
}

function disposeWorkspaceRootBestEffort(workspaceRoot: string): void {
  try {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  } catch {
    // A locked disposable workspace is never publication authority. Preserve
    // the original validation/seed error and leave it for later OS cleanup.
  }
}

function copyFileResilient(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const SOURCE_ANCHOR_LEDGER_RELATIVE_PATH = ".breadboard/source-anchors.json" as const;

function sourceAnchorLedgerPath(gardenDir: string): string {
  return path.join(gardenDir, ".breadboard", "source-anchors.json");
}

function readRequiredRegularFile(absolutePath: string, label: string): Buffer {
  let stat: Stats;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${label} is missing: ${SOURCE_ANCHOR_LEDGER_RELATIVE_PATH}`);
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(
      `${label} must be a regular file: ${SOURCE_ANCHOR_LEDGER_RELATIVE_PATH}`,
    );
  }
  return fs.readFileSync(absolutePath);
}

function captureExactSourceAnchorLedger(
  repositoryGardenDir: string,
  stagingGardenDir: string,
): AuthoritativeSourceAnchorLedgerSnapshot {
  const authoritativePath = sourceAnchorLedgerPath(repositoryGardenDir);
  const stagedPath = sourceAnchorLedgerPath(stagingGardenDir);
  const authoritativeBefore = readRequiredRegularFile(
    authoritativePath,
    "Authoritative source-anchor ledger",
  );
  const stagedBefore = readRequiredRegularFile(stagedPath, "Staged source-anchor ledger");
  const authoritativeAfter = readRequiredRegularFile(
    authoritativePath,
    "Authoritative source-anchor ledger",
  );
  const stagedAfter = readRequiredRegularFile(stagedPath, "Staged source-anchor ledger");

  if (!authoritativeBefore.equals(authoritativeAfter)) {
    throw new Error(
      `Authoritative source-anchor ledger changed while Learn was verifying ${SOURCE_ANCHOR_LEDGER_RELATIVE_PATH}.`,
    );
  }
  if (!stagedBefore.equals(stagedAfter)) {
    throw new Error(
      `Staged source-anchor ledger changed while Learn was verifying ${SOURCE_ANCHOR_LEDGER_RELATIVE_PATH}.`,
    );
  }
  if (!authoritativeAfter.equals(stagedAfter)) {
    throw new Error(
      `Staged source-anchor ledger is not byte-for-byte identical to the authoritative ${SOURCE_ANCHOR_LEDGER_RELATIVE_PATH}.`,
    );
  }

  return {
    relativePath: SOURCE_ANCHOR_LEDGER_RELATIVE_PATH,
    byteLength: authoritativeAfter.byteLength,
    sha256: crypto.createHash("sha256").update(authoritativeAfter).digest("hex"),
  };
}

/**
 * Fail closed unless the authoritative and staged source-anchor ledgers still
 * match the exact bytes captured during workspace creation. This deliberately
 * does not parse, normalize, infer, or rewrite any anchor record.
 */
export function verifyAuthoritativeSourceAnchorLedger(
  workspace: LearnBuildWorkspace,
): void {
  const expected = workspace.authoritativeSourceAnchorLedger;
  if (!expected) {
    throw new Error(
      `Learn workspace has no authoritative source-anchor ledger snapshot for ${SOURCE_ANCHOR_LEDGER_RELATIVE_PATH}.`,
    );
  }
  const current = captureExactSourceAnchorLedger(
    workspace.repositoryGardenDir,
    workspace.stagingGardenDir,
  );
  if (
    current.relativePath !== expected.relativePath ||
    current.byteLength !== expected.byteLength ||
    current.sha256 !== expected.sha256
  ) {
    throw new Error(
      `Authoritative source-anchor ledger changed after Learn seeded ${SOURCE_ANCHOR_LEDGER_RELATIVE_PATH}; generation cannot continue safely.`,
    );
  }
}

function copyTree(srcDir: string, destDir: string, filter?: (rel: string) => boolean): void {
  const walk = (rel: string) => {
    const absSrc = path.join(srcDir, rel);
    const entries = fs.readdirSync(absSrc, { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (filter && !filter(childRel)) continue;
      if (entry.isDirectory()) walk(childRel);
      else if (entry.isFile()) copyFileResilient(path.join(srcDir, childRel), path.join(destDir, childRel));
      else if (entry.isSymbolicLink()) {
        throw new Error(`Learn durable input contains unsupported symbolic link: ${childRel}`);
      }
    }
  };
  walk("");
}

function seedIncrementalGeneratedAssets(
  repositoryGardenDir: string,
  stagingGardenDir: string,
): void {
  for (const name of INCREMENTAL_BREADBOARD_ENTRIES) {
    const source = path.join(repositoryGardenDir, ".breadboard", name);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(stagingGardenDir, ".breadboard", name);
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Learn incremental input contains unsupported symbolic link: .breadboard/${name}`,
      );
    }
    if (stat.isDirectory()) copyTree(source, destination);
    else if (stat.isFile()) copyFileResilient(source, destination);
  }
}

/**
 * Create an isolated workspace. The old learning tree is never copied: even an
 * additive update reconstructs it from stable unit ids, so stale paths cannot
 * coexist with the merged order. Update mode additionally carries forward only
 * generated-visual implementations that a reused lesson body may reference.
 */
export function createLearnBuildWorkspace(input: {
  gardenSlug: string;
  jobId: string;
  mode: "generate" | "regenerate" | "update";
  repositoryGardenDir: string;
  contractFingerprint: string;
  sourceSetFingerprint: string;
  workspaceRoot?: string;
  previousPublishedGardenDir?: string;
  /** Require and snapshot the canonical source-anchor ledger. Production
   * generation enables this so a missing ledger fails before model work. */
  requireAuthoritativeSourceAnchorLedger?: boolean;
  /** Defaults to `staging`. Production uses the real garden slug so helpers
   * receiving a content root continue to resolve `<root>/<gardenSlug>`. */
  stagingDirectoryName?: string;
}): LearnBuildWorkspace {
  const buildId = `build_${Date.now().toString(36)}_${shortHash(`${input.gardenSlug}:${input.jobId}:${input.sourceSetFingerprint}`)}`;
  const stagingDirectoryName = input.stagingDirectoryName?.trim() || "staging";
  const requestedWorkspaceRoot = input.workspaceRoot ?? defaultWorkspaceRoot(
    input.gardenSlug,
    input.jobId,
  );
  const durableInputFingerprint = fingerprintDurableGardenState(
    input.repositoryGardenDir,
  );
  const resumableWorkspace = input.workspaceRoot === undefined
    ? findLatestCompatibleRetainedLearnBuildWorkspace({
        gardenSlug: input.gardenSlug,
        excludeJobId: input.jobId,
        mode: input.mode,
        repositoryGardenDir: input.repositoryGardenDir,
        contractFingerprint: input.contractFingerprint,
        sourceSetFingerprint: input.sourceSetFingerprint,
        requireAuthoritativeSourceAnchorLedger:
          input.requireAuthoritativeSourceAnchorLedger === true,
      })
    : null;
  const preparedWorkspaceRoot = prepareLearnWorkspaceRoot({
    workspaceRoot: requestedWorkspaceRoot,
    fallbackWorkspaceRoot: temporaryWorkspaceRoot(input.gardenSlug, input.jobId),
    repositoryGardenDir: input.repositoryGardenDir,
    stagingDirectoryName,
    allowFallback: input.workspaceRoot === undefined,
  });
  const { workspaceRoot, stagingGardenDir, stagingLearningDir } = preparedWorkspaceRoot;
  let authoritativeSourceAnchorLedger:
    | AuthoritativeSourceAnchorLedgerSnapshot
    | undefined;

  try {
    if (resumableWorkspace) {
      copyTree(resumableWorkspace.stagingGardenDir, stagingGardenDir);
      synchronizeDurableInputs(input.repositoryGardenDir, stagingGardenDir);
      // Acceptance is evidence about the exact candidate that produced it.
      // A resumed workspace may reuse pages and visual checkpoints, but it must
      // earn its own deterministic/critic decision before that receipt can
      // influence future recovery ranking.
      fs.rmSync(
        path.join(stagingGardenDir, ".breadboard", "acceptance-status.json"),
        { force: true },
      );
    } else {
      seedDurableInputs(input.repositoryGardenDir, stagingGardenDir);
      if (input.mode === "update") {
        seedIncrementalGeneratedAssets(
          input.repositoryGardenDir,
          stagingGardenDir,
        );
      }
    }
    const copiedInputFingerprint = fingerprintDurableGardenState(stagingGardenDir);
    const currentInputFingerprint = fingerprintDurableGardenState(
      input.repositoryGardenDir,
    );
    if (
      durableInputFingerprint !== currentInputFingerprint ||
      durableInputFingerprint !== copiedInputFingerprint
    ) {
      throw new Error(
        "Garden inputs changed while Learn was creating its isolated workspace. No published files were changed; retry the operation.",
      );
    }
    if (input.requireAuthoritativeSourceAnchorLedger) {
      authoritativeSourceAnchorLedger = captureExactSourceAnchorLedger(
        input.repositoryGardenDir,
        stagingGardenDir,
      );
    }
  } catch (error) {
    disposeWorkspaceRootBestEffort(workspaceRoot);
    throw error;
  }

  const workspace: LearnBuildWorkspace = {
    buildId,
    jobId: input.jobId,
    gardenSlug: input.gardenSlug,
    mode: input.mode,
    repositoryGardenDir: input.repositoryGardenDir,
    previousPublishedGardenDir: input.previousPublishedGardenDir,
    workspaceRoot,
    stagingGardenDir,
    stagingLearningDir,
    contractFingerprint: input.contractFingerprint,
    sourceSetFingerprint: input.sourceSetFingerprint,
    durableInputFingerprint,
    authoritativeSourceAnchorLedger,
    createdAt: new Date().toISOString(),
    lifecycle: "active",
    ...(resumableWorkspace
      ? {
          resumedFromBuildId: resumableWorkspace.buildId,
          resumedFromJobId: resumableWorkspace.jobId,
          resumedFromWorkspaceRoot: resumableWorkspace.workspaceRoot,
          inheritedAcceptanceStatusCleared: true as const,
        }
      : {}),
  };
  try {
    writeWorkspaceDescriptor(workspace);
    return workspace;
  } catch (error) {
    // The workspace has not been handed to the caller yet. If its local-only
    // descriptor cannot be written, remove the isolated staging tree now so a
    // terminal setup failure cannot strand disposable files.
    disposeWorkspaceRootBestEffort(workspaceRoot);
    throw error;
  }
}

/** Copy durable inputs (sources, config, approved non-learning files, and the
 * canonical source-extraction records) into the staging garden. The old
 * generated learning tree and every disposable projection are excluded. */
export function seedDurableInputs(repositoryGardenDir: string, stagingGardenDir: string): {
  seeded: string[];
  skipped: string[];
} {
  const seeded: string[] = [];
  const skipped: string[] = [];
  const topLevel = fs.readdirSync(repositoryGardenDir, { withFileTypes: true });
  for (const entry of topLevel) {
    const normalizedName = normalizedEntryName(entry.name);
    if (normalizedName === ".breadboard") {
      if (entry.isSymbolicLink()) {
        throw new Error(`Learn durable input contains unsupported symbolic link: ${entry.name}`);
      }
      if (!entry.isDirectory()) {
        skipped.push(entry.name);
        continue;
      }
      seedDurableBreadboardEntries(
        path.join(repositoryGardenDir, entry.name),
        path.join(stagingGardenDir, ".breadboard"),
        seeded,
        skipped,
      );
      continue;
    }
    if (DISPOSABLE_TOP_LEVEL.has(normalizedName)) {
      skipped.push(entry.name);
      continue;
    }
    const src = path.join(repositoryGardenDir, entry.name);
    const dest = path.join(stagingGardenDir, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else if (entry.isFile()) copyFileResilient(src, dest);
    else if (entry.isSymbolicLink()) {
      throw new Error(`Learn durable input contains unsupported symbolic link: ${entry.name}`);
    }
    seeded.push(entry.name);
  }
  return { seeded, skipped };
}

/** Overlay the repository's current durable inputs onto a cloned retained
 * candidate while leaving generated lessons and disposable projections intact.
 * This permits safe continuation when operational ledgers evolved after the
 * failed build, without carrying stale source inputs into the resumed job. */
function synchronizeDurableInputs(
  repositoryGardenDir: string,
  stagingGardenDir: string,
): void {
  const removeExactStagedEntry = (entryPath: string): void => {
    if (!pathIsWithinOrEqual(entryPath, stagingGardenDir)) {
      throw new Error("Retained Learn durable-input synchronization escaped staging.");
    }
    fs.rmSync(entryPath, { recursive: true, force: true });
  };
  for (const entry of fs.readdirSync(stagingGardenDir, { withFileTypes: true })) {
    const normalizedName = normalizedEntryName(entry.name);
    if (
      normalizedName !== ".breadboard" &&
      !DISPOSABLE_TOP_LEVEL.has(normalizedName)
    ) {
      removeExactStagedEntry(path.join(stagingGardenDir, entry.name));
    }
  }

  const repositoryBreadboard = path.join(repositoryGardenDir, ".breadboard");
  const stagingBreadboard = path.join(stagingGardenDir, ".breadboard");
  const breadboardNames = new Set<string>();
  for (const directory of [repositoryBreadboard, stagingBreadboard]) {
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        breadboardNames.add(entry.name);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  for (const name of breadboardNames) {
    const normalizedName = normalizedEntryName(name);
    const seededDurableEntry =
      DURABLE_BREADBOARD_ENTRIES.has(normalizedName) ||
      !DISPOSABLE_BREADBOARD_ENTRIES.has(normalizedName);
    // Preserve the retained append-only history. Promotion already performs
    // the authoritative events.jsonl union with events added after retention.
    if (seededDurableEntry && normalizedName !== "events.jsonl") {
      removeExactStagedEntry(path.join(stagingBreadboard, name));
    }
  }

  const topLevel = fs.readdirSync(repositoryGardenDir, { withFileTypes: true });
  for (const entry of topLevel) {
    const normalizedName = normalizedEntryName(entry.name);
    if (normalizedName === ".breadboard") {
      if (entry.isSymbolicLink()) {
        throw new Error(`Learn durable input contains unsupported symbolic link: ${entry.name}`);
      }
      if (!entry.isDirectory()) continue;
      for (const breadboardEntry of fs.readdirSync(repositoryBreadboard, {
        withFileTypes: true,
      })) {
        const normalizedBreadboardName = normalizedEntryName(breadboardEntry.name);
        const seededDurableEntry =
          DURABLE_BREADBOARD_ENTRIES.has(normalizedBreadboardName) ||
          !DISPOSABLE_BREADBOARD_ENTRIES.has(normalizedBreadboardName);
        if (!seededDurableEntry || normalizedBreadboardName === "events.jsonl") {
          continue;
        }
        const source = path.join(repositoryBreadboard, breadboardEntry.name);
        const destination = path.join(stagingBreadboard, breadboardEntry.name);
        if (breadboardEntry.isDirectory()) copyTree(source, destination);
        else if (breadboardEntry.isFile()) copyFileResilient(source, destination);
        else if (breadboardEntry.isSymbolicLink()) {
          throw new Error(
            `Learn durable input contains unsupported symbolic link: .breadboard/${breadboardEntry.name}`,
          );
        }
      }
      continue;
    }
    if (DISPOSABLE_TOP_LEVEL.has(normalizedName)) continue;
    const source = path.join(repositoryGardenDir, entry.name);
    const destination = path.join(stagingGardenDir, entry.name);
    if (entry.isDirectory()) copyTree(source, destination);
    else if (entry.isFile()) copyFileResilient(source, destination);
    else if (entry.isSymbolicLink()) {
      throw new Error(`Learn durable input contains unsupported symbolic link: ${entry.name}`);
    }
  }
}

function seedDurableBreadboardEntries(
  srcBreadboard: string,
  destBreadboard: string,
  seeded: string[],
  skipped: string[],
): void {
  const entries = fs.readdirSync(srcBreadboard, { withFileTypes: true });
  for (const entry of entries) {
    const normalizedName = normalizedEntryName(entry.name);
    if (
      !DURABLE_BREADBOARD_ENTRIES.has(normalizedName) &&
      DISPOSABLE_BREADBOARD_ENTRIES.has(normalizedName)
    ) {
      skipped.push(`.breadboard/${entry.name}`);
      continue;
    }
    const src = path.join(srcBreadboard, entry.name);
    const dest = path.join(destBreadboard, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else if (entry.isFile()) copyFileResilient(src, dest);
    else if (entry.isSymbolicLink()) {
      throw new Error(
        `Learn durable input contains unsupported symbolic link: .breadboard/${entry.name}`,
      );
    }
    seeded.push(`.breadboard/${entry.name}`);
  }
}

function durableFingerprintIncludes(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const [top, second] = normalized.split("/");
  if (!top) return false;
  const normalizedTop = normalizedEntryName(top);
  if (normalizedTop !== ".breadboard") return !DISPOSABLE_TOP_LEVEL.has(normalizedTop);
  if (!second) return true;
  const normalizedSecond = normalizedEntryName(second);
  if (normalizedSecond === "events.jsonl" || normalizedSecond === "learn-build.lock.json") {
    return false;
  }
  if (DURABLE_BREADBOARD_ENTRIES.has(normalizedSecond)) return true;
  return !DISPOSABLE_BREADBOARD_ENTRIES.has(normalizedSecond);
}

function durableFingerprintRecordPath(relPath: string): string {
  const segments = relPath.replace(/\\/g, "/").split("/");
  if (segments[0] && normalizedEntryName(segments[0]) === ".breadboard") {
    // Seeding canonicalizes the container directory to `.breadboard`; its
    // spelling must not make the source and staging fingerprints diverge.
    segments[0] = ".breadboard";
  }
  return segments.join("/");
}

/** Stable content fingerprint used as the optimistic publication boundary. */
export function fingerprintDurableGardenState(gardenDir: string): string {
  const records: string[] = [];
  const visit = (directory: string, relative = ""): void => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      if (!durableFingerprintIncludes(relPath)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, relPath);
      } else if (entry.isFile()) {
        const digest = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
        records.push(`${durableFingerprintRecordPath(relPath)}\0${digest}`);
      } else if (entry.isSymbolicLink()) {
        throw new Error(`Learn durable input contains unsupported symbolic link: ${relPath}`);
      }
    }
  };
  visit(gardenDir);
  return crypto.createHash("sha256").update(records.sort().join("\n")).digest("hex");
}

const WORKSPACE_DESCRIPTOR = "build-workspace.json";

function normalizedRetentionStage(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 240) : undefined;
}

function writeWorkspaceDescriptor(workspace: LearnBuildWorkspace): void {
  // This descriptor contains local repository/workspace paths and is useful
  // only while diagnosing the isolated build. Keep it beside the staging
  // garden so atomic publication can never expose host filesystem details.
  const abs = path.join(workspace.workspaceRoot, WORKSPACE_DESCRIPTOR);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(workspace, null, 2)}\n`);
}

/**
 * Mark an exact staged candidate as retained. This function never moves the
 * tree and never copies it into the published garden; it only makes the local
 * failure lifecycle durable beside the already-isolated build.
 */
export function retainLearnBuildWorkspace(
  workspace: LearnBuildWorkspace,
  input: {
    reason: "generation_failure" | "abandoned_worker";
    failureStage?: string;
    retainedAt?: string;
  },
): void {
  workspace.lifecycle = "retained_after_failure";
  workspace.retainedAt = input.retainedAt ?? new Date().toISOString();
  workspace.retentionReason = input.reason;
  workspace.retentionStage = normalizedRetentionStage(input.failureStage);
  writeWorkspaceDescriptor(workspace);
}

function sameResolvedWorkspacePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function workspaceDescriptorAt(workspaceRoot: string): LearnBuildWorkspace | null {
  const descriptorPath = path.join(workspaceRoot, WORKSPACE_DESCRIPTOR);
  let candidate: unknown;
  try {
    const descriptorStat = fs.lstatSync(descriptorPath);
    if (!descriptorStat.isFile() || descriptorStat.isSymbolicLink()) return null;
    candidate = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  } catch {
    return null;
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Partial<LearnBuildWorkspace>;
  if (
    typeof record.jobId !== "string" ||
    typeof record.gardenSlug !== "string" ||
    !sameResolvedWorkspacePath(record.workspaceRoot ?? "", workspaceRoot) ||
    typeof record.stagingGardenDir !== "string" ||
    typeof record.stagingLearningDir !== "string" ||
    !pathIsWithinOrEqual(record.stagingGardenDir, workspaceRoot) ||
    !sameResolvedWorkspacePath(
      record.stagingLearningDir,
      path.resolve(record.stagingGardenDir, "learning"),
    ) ||
    typeof record.buildId !== "string" ||
    typeof record.repositoryGardenDir !== "string" ||
    typeof record.contractFingerprint !== "string" ||
    typeof record.sourceSetFingerprint !== "string" ||
    typeof record.durableInputFingerprint !== "string" ||
    typeof record.createdAt !== "string" ||
    !["generate", "regenerate", "update"].includes(record.mode ?? "")
  ) {
    return null;
  }
  // Descriptors written before lifecycle retention was introduced represent
  // active candidates and remain eligible for crash recovery.
  record.lifecycle = record.lifecycle === "retained_after_failure"
    ? "retained_after_failure"
    : "active";
  return record as LearnBuildWorkspace;
}

function retainedWorkspaceDescriptorAt(
  workspaceRoot: string,
  gardenSlug: string,
  jobId: string,
): LearnBuildWorkspace | null {
  const workspace = workspaceDescriptorAt(workspaceRoot);
  return workspace?.jobId === jobId && workspace.gardenSlug === gardenSlug
    ? workspace
    : null;
}

/** Select the newest exact retained candidate whose immutable generation
 * contract and repository inputs still match. A candidate with stale sources,
 * a different mode, or an unsafe/missing staging tree is never resumed. */
export function findLatestCompatibleRetainedLearnBuildWorkspace(input: {
  gardenSlug: string;
  excludeJobId: string;
  mode: "generate" | "regenerate" | "update";
  repositoryGardenDir: string;
  contractFingerprint: string;
  sourceSetFingerprint: string;
  requireAuthoritativeSourceAnchorLedger: boolean;
}): LearnBuildWorkspace | null {
  const candidates: Array<{
    workspace: LearnBuildWorkspace;
    retainedAt: number;
    checkpointRank: number;
  }> = [];
  const seenRoots = new Set<string>();
  for (const baseDir of learnWorkspaceBaseCandidates()) {
    const gardenRoot = path.resolve(baseDir, input.gardenSlug);
    if (!sameResolvedWorkspacePath(path.dirname(gardenRoot), baseDir)) continue;
    let entries: Dirent[];
    try {
      entries = fs.readdirSync(gardenRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const workspaceRoot = path.resolve(gardenRoot, entry.name);
      const rootKey = process.platform === "win32"
        ? workspaceRoot.toLowerCase()
        : workspaceRoot;
      if (seenRoots.has(rootKey)) continue;
      seenRoots.add(rootKey);
      const workspace = workspaceDescriptorAt(workspaceRoot);
      if (
        !workspace ||
        workspace.lifecycle !== "retained_after_failure" ||
        workspace.jobId === input.excludeJobId ||
        workspace.gardenSlug !== input.gardenSlug ||
        workspace.mode !== input.mode ||
        !sameResolvedWorkspacePath(
          workspace.repositoryGardenDir,
          input.repositoryGardenDir,
        ) ||
        workspace.contractFingerprint !== input.contractFingerprint ||
        workspace.sourceSetFingerprint !== input.sourceSetFingerprint
      ) {
        continue;
      }
      if (input.requireAuthoritativeSourceAnchorLedger) {
        const expectedLedger = workspace.authoritativeSourceAnchorLedger;
        if (!expectedLedger) continue;
        try {
          const currentLedger = readRequiredRegularFile(
            sourceAnchorLedgerPath(input.repositoryGardenDir),
            "Authoritative source-anchor ledger",
          );
          if (
            currentLedger.byteLength !== expectedLedger.byteLength ||
            crypto.createHash("sha256").update(currentLedger).digest("hex") !==
              expectedLedger.sha256
          ) {
            continue;
          }
        } catch {
          continue;
        }
      }
      try {
        const stagingStat = fs.lstatSync(workspace.stagingGardenDir);
        const learningStat = fs.lstatSync(workspace.stagingLearningDir);
        if (
          !stagingStat.isDirectory() ||
          stagingStat.isSymbolicLink() ||
          !learningStat.isDirectory() ||
          learningStat.isSymbolicLink()
        ) {
          continue;
        }
      } catch {
        continue;
      }
      const retainedAt = Date.parse(workspace.retainedAt ?? workspace.createdAt);
      if (!Number.isFinite(retainedAt)) continue;
      // Prefer the nearest safe durable checkpoint over a newer candidate whose
      // own final receipt proves deterministic corruption. The rejected tree is
      // still retained for diagnosis and remains the fallback when it is the
      // only compatible checkpoint.
      let checkpointRank = 1;
      try {
        const statusPath = path.join(
          workspace.stagingGardenDir,
          ".breadboard",
          "acceptance-status.json",
        );
        const statusStat = fs.statSync(statusPath);
        const workspaceCreatedAt = Date.parse(workspace.createdAt);
        // Fresh workspaces start without an acceptance receipt, and current
        // resumed workspaces explicitly remove the inherited one. The mtime
        // comparison remains only for descriptors created before that reset
        // marker existed.
        const receiptBelongsToWorkspace =
          !workspace.resumedFromBuildId ||
          workspace.inheritedAcceptanceStatusCleared === true ||
          (Number.isFinite(workspaceCreatedAt) &&
            statusStat.mtimeMs >= workspaceCreatedAt);
        if (receiptBelongsToWorkspace) {
          const status = JSON.parse(fs.readFileSync(statusPath, "utf8")) as Record<string, unknown>;
          if (status.deterministicPass === false) checkpointRank = 0;
          // A deterministic-valid semantic-repair checkpoint is safe to resume
          // even when its critic receipt still has a blocker. Rank it alongside
          // a publish-ready checkpoint so recency preserves later successful
          // repairs; only deterministically corrupt candidates fall behind.
          else if (status.deterministicPass === true) checkpointRank = 2;
        }
      } catch {
        // Missing/partial acceptance state is an ordinary resumable checkpoint.
      }
      candidates.push({ workspace, retainedAt, checkpointRank });
    }
  }
  candidates.sort((left, right) =>
    right.checkpointRank - left.checkpointRank ||
    right.retainedAt - left.retainedAt,
  );
  return candidates[0]?.workspace ?? null;
}

/** Mark every exact known staging root for an abandoned non-cancelled job as
 * retained. An unreadable descriptor is left untouched rather than deleted. */
export function retainFailedLearnWorkspacesForJob(input: {
  gardenSlug: string;
  jobId: string;
  reason: "generation_failure" | "abandoned_worker";
  failureStage?: string;
  retainedAt?: string;
}): string[] {
  const retainedRoots: string[] = [];
  for (const workspaceRoot of learnWorkspaceRootCandidates(
    input.gardenSlug,
    input.jobId,
  )) {
    const workspace = retainedWorkspaceDescriptorAt(
      workspaceRoot,
      input.gardenSlug,
      input.jobId,
    );
    if (!workspace) continue;
    retainLearnBuildWorkspace(workspace, input);
    retainedRoots.push(workspaceRoot);
  }
  return retainedRoots;
}

/** Best-effort cleanup after success, cancellation, or supersession. Never throws. */
export function disposeLearnBuildWorkspace(workspace: LearnBuildWorkspace): void {
  disposeWorkspaceRootBestEffort(workspace.workspaceRoot);
}

/**
 * Run-isolated Learn build workspace (Parts 1-2).
 *
 * A Learn run must NEVER mutate the published garden tree directly. The
 * repository garden (…/quartz/content/<garden>, often inside a OneDrive-synced
 * folder) is a *publication destination*, not a build scratch space: generating
 * in place is exactly what let an old and a new generation tree coexist under a
 * single active `learning/` directory and produce duplicate unit mappings.
 *
 * Every run gets its own workspace under a non-synchronized location. Only
 * durable inputs (sources, stable config, approved non-learning files) are
 * seeded in; the old generated `learning/` tree and every disposable projection
 * are deliberately left behind. The finished, validated staging tree is later
 * promoted atomically (see learn-atomic-promotion.ts).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
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

function buildsBaseDir(): string {
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

/** All known disposable roots for a job, in preference order. Recovery uses
 * this only for best-effort cleanup; neither location is authoritative. */
export function learnWorkspaceRootCandidates(
  gardenSlug: string,
  jobId: string,
): string[] {
  return [...new Set([
    defaultWorkspaceRoot(gardenSlug, jobId),
    temporaryWorkspaceRoot(gardenSlug, jobId),
  ].map((candidate) => path.resolve(candidate)))];
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
    // The workspace is entirely disposable. Retry only transient filesystem
    // boundaries; durable source seeding below remains fail-closed.
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
  let stat: fs.Stats;
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

/**
 * Create an isolated workspace and seed ONLY durable inputs from the repository
 * garden. The old learning tree and disposable projections are never copied —
 * in generate/regenerate mode the staging `learning/` directory starts empty,
 * so mixed-generation active state is structurally impossible from the outset.
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
    seedDurableInputs(input.repositoryGardenDir, stagingGardenDir);
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

function writeWorkspaceDescriptor(workspace: LearnBuildWorkspace): void {
  // This descriptor contains local repository/workspace paths and is useful
  // only while diagnosing the isolated build. Keep it beside the staging
  // garden so atomic publication can never expose host filesystem details.
  const abs = path.join(workspace.workspaceRoot, WORKSPACE_DESCRIPTOR);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(workspace, null, 2)}\n`);
}

/** Best-effort cleanup of a finished/abandoned workspace. Never throws. */
export function disposeLearnBuildWorkspace(workspace: LearnBuildWorkspace): void {
  disposeWorkspaceRootBestEffort(workspace.workspaceRoot);
}

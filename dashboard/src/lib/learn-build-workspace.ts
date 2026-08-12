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

  createdAt: string;
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
  "learn-build.lock.json",
  "learning-unit-contract.json",
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

function buildsBaseDir(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData && localAppData.trim()) {
    return path.join(localAppData, "Breadboard", "builds");
  }
  return path.join(os.tmpdir(), "breadboard-learn");
}

/** Compute the default (non-synchronized) workspace root for a run. */
export function defaultWorkspaceRoot(gardenSlug: string, jobId: string): string {
  return path.join(buildsBaseDir(), gardenSlug, jobId);
}

function copyFileResilient(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
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
  /** Defaults to `staging`. Production uses the real garden slug so helpers
   * receiving a content root continue to resolve `<root>/<gardenSlug>`. */
  stagingDirectoryName?: string;
}): LearnBuildWorkspace {
  const buildId = `build_${Date.now().toString(36)}_${shortHash(`${input.gardenSlug}:${input.jobId}:${input.sourceSetFingerprint}`)}`;
  const workspaceRoot = input.workspaceRoot ?? defaultWorkspaceRoot(input.gardenSlug, input.jobId);
  const stagingGardenDir = path.join(
    workspaceRoot,
    input.stagingDirectoryName?.trim() || "staging",
  );
  const stagingLearningDir = path.join(stagingGardenDir, "learning");
  const durableInputFingerprint = fingerprintDurableGardenState(
    input.repositoryGardenDir,
  );

  // Start from a clean staging garden. A stale workspace directory from a
  // previous crashed run of the same job id is removed first.
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingGardenDir, { recursive: true });

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
  } catch (error) {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
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
    createdAt: new Date().toISOString(),
  };
  writeWorkspaceDescriptor(workspace);
  return workspace;
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
  try {
    fs.rmSync(workspace.workspaceRoot, { recursive: true, force: true });
  } catch {
    // A locked temp workspace is harmless; leave it for OS temp cleanup.
  }
}

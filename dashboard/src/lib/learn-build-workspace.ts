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
]);

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
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absSrc, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (filter && !filter(childRel)) continue;
      if (entry.isDirectory()) walk(childRel);
      else if (entry.isFile()) copyFileResilient(path.join(srcDir, childRel), path.join(destDir, childRel));
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
}): LearnBuildWorkspace {
  const buildId = `build_${Date.now().toString(36)}_${shortHash(`${input.gardenSlug}:${input.jobId}:${input.sourceSetFingerprint}`)}`;
  const workspaceRoot = input.workspaceRoot ?? defaultWorkspaceRoot(input.gardenSlug, input.jobId);
  const stagingGardenDir = path.join(workspaceRoot, "staging");
  const stagingLearningDir = path.join(stagingGardenDir, "learning");

  // Start from a clean staging garden. A stale workspace directory from a
  // previous crashed run of the same job id is removed first.
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingGardenDir, { recursive: true });

  seedDurableInputs(input.repositoryGardenDir, stagingGardenDir);

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
  let topLevel: fs.Dirent[];
  try {
    topLevel = fs.readdirSync(repositoryGardenDir, { withFileTypes: true });
  } catch {
    return { seeded, skipped };
  }
  for (const entry of topLevel) {
    if (entry.name === ".breadboard") {
      seedDurableBreadboardEntries(
        path.join(repositoryGardenDir, ".breadboard"),
        path.join(stagingGardenDir, ".breadboard"),
        seeded,
        skipped,
      );
      continue;
    }
    if (DISPOSABLE_TOP_LEVEL.has(entry.name)) {
      skipped.push(entry.name);
      continue;
    }
    const src = path.join(repositoryGardenDir, entry.name);
    const dest = path.join(stagingGardenDir, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else if (entry.isFile()) copyFileResilient(src, dest);
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
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcBreadboard, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!DURABLE_BREADBOARD_ENTRIES.has(entry.name)) {
      skipped.push(`.breadboard/${entry.name}`);
      continue;
    }
    const src = path.join(srcBreadboard, entry.name);
    const dest = path.join(destBreadboard, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else if (entry.isFile()) copyFileResilient(src, dest);
    seeded.push(`.breadboard/${entry.name}`);
  }
}

const WORKSPACE_DESCRIPTOR = ".breadboard/build-workspace.json";

function writeWorkspaceDescriptor(workspace: LearnBuildWorkspace): void {
  const abs = path.join(workspace.stagingGardenDir, WORKSPACE_DESCRIPTOR);
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

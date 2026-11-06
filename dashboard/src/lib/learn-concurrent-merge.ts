import crypto from "node:crypto";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { durableGardenFileDigests } from "./learn-build-workspace.ts";

/**
 * Uploads may write a garden while a Learn build runs from an isolated copy.
 * Publishing that copy swaps the whole garden directory, so every durable file
 * the live garden changed since the copy was taken is carried into the
 * candidate first. The result is the garden an upload made just after Learn
 * published, which is an ordinary state.
 *
 * Navigation indexes and user folders are not durable paths: publication
 * already merges user folders and rebuilds navigation from the merged tree.
 */
export interface ConcurrentGardenMergeResult {
  carried: string[];
  removed: string[];
  conflicts: string[];
}

function fileDigest(filePath: string): string | undefined {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined;
    throw error;
  }
}

function withinGarden(root: string, relPath: string): string {
  const resolved = path.resolve(root, ...relPath.split("/"));
  if (!resolved.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`Concurrent garden merge escaped the garden: ${relPath}`);
  }
  return resolved;
}

/** An existing source note is a Learn input: rewriting it mid-run invalidates
 * the course built from it, so publication refuses rather than mixing them. */
function isLearnInputPath(relPath: string): boolean {
  return relPath.toLowerCase().startsWith("sources/");
}

/**
 * Carry live changes made since `base` into `incomingDir`. Nothing is written
 * when any conflict is found, so a refused merge leaves the candidate intact.
 */
export function mergeConcurrentGardenChanges(input: {
  currentDir: string;
  incomingDir: string;
  base: ReadonlyMap<string, string>;
  separateUserContent: boolean;
}): ConcurrentGardenMergeResult {
  const live = durableGardenFileDigests(input.currentDir, input.separateUserContent);
  const changed = new Set<string>();
  for (const [relPath, digest] of live) if (input.base.get(relPath) !== digest) changed.add(relPath);
  for (const relPath of input.base.keys()) if (!live.has(relPath)) changed.add(relPath);

  const result: ConcurrentGardenMergeResult = { carried: [], removed: [], conflicts: [] };
  const plan: Array<{ relPath: string; remove: boolean }> = [];
  for (const relPath of [...changed].sort()) {
    const baseDigest = input.base.get(relPath);
    const liveDigest = live.get(relPath);
    const incomingDigest = fileDigest(withinGarden(input.incomingDir, relPath));
    if (incomingDigest === liveDigest) continue;
    if (baseDigest !== undefined && isLearnInputPath(relPath)) {
      result.conflicts.push(`${relPath} (source changed during the Learn run)`);
      continue;
    }
    if (incomingDigest !== baseDigest) {
      result.conflicts.push(`${relPath} (changed by both Learn and a concurrent writer)`);
      continue;
    }
    plan.push({ relPath, remove: liveDigest === undefined });
  }
  if (result.conflicts.length > 0) return result;

  for (const { relPath, remove } of plan) {
    const target = withinGarden(input.incomingDir, relPath);
    if (remove) {
      fs.rmSync(target, { force: true });
      result.removed.push(relPath);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(withinGarden(input.currentDir, relPath), target);
    result.carried.push(relPath);
  }
  return result;
}

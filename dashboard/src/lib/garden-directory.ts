// Where a Garden lives on disk, and the guarantee that nothing escapes it.
//
// This is deliberately a leaf: resolving a Garden's directory is the one thing
// every reader and writer needs, and it should not drag the whole knowledge
// pipeline in behind it. `garden-filesystem.ts` re-exports both names, so the
// existing callers are unaffected.

import type { Dirent } from "node:fs";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { INTERNAL_CONCEPT_FOLDER } from "./learning-garden.ts";

/**
 * A failure with the HTTP shape the folders route already returns.
 *
 * `status` is assigned in the body rather than declared as a constructor
 * parameter property: Node runs this repo's TypeScript in strip-only mode,
 * which rejects parameter properties outright.
 */
export class GardenFilesystemError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GardenFilesystemError";
    this.status = status;
  }
}

export function gardenContentRoot(): string {
  const value = process.env.QUARTZ_CONTENT_PATH;
  if (!value) {
    throw new GardenFilesystemError("QUARTZ_CONTENT_PATH not configured", 500);
  }
  return value;
}

/** Resolve the Garden's own directory, refusing anything outside the root. */
export function gardenDirectory(
  clusterSlug: string,
  contentPath = gardenContentRoot(),
): string {
  const root = path.resolve(contentPath);
  const clusterDir = path.resolve(root, clusterSlug.trim());
  if (clusterDir !== root && !clusterDir.startsWith(root + path.sep)) {
    throw new GardenFilesystemError("Invalid garden path", 400);
  }
  return clusterDir;
}

/**
 * How many notes a Garden holds, counted the way a reader would see it:
 * recursively, so notes in `sources/`, `learning/` and any other sub-folder
 * count, and without the `Internal/` namespace, whose ConceptNodes are
 * machinery rather than pages. Same traversal rules as `walkClusterMarkdown`
 * in `knowledge.ts` (which re-exports this), but it never stats a file — this
 * runs once per Garden on every dashboard load, so it stays a directory walk.
 */
export function countClusterMarkdown(clusterDir: string): number {
  if (!fs.existsSync(clusterDir)) return 0;

  const internalRoot = INTERNAL_CONCEPT_FOLDER.split("/")[0];
  let count = 0;
  const walk = (dir: string, depth: number) => {
    let dirents: Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const name = dirent.name;
      if (dirent.isDirectory()) {
        if (name === "assets" || name.startsWith(".")) continue;
        if (depth === 0 && name === internalRoot) continue;
        walk(path.join(dir, name), depth + 1);
        continue;
      }
      if (!dirent.isFile() || !name.endsWith(".md")) continue;
      const lower = name.toLowerCase();
      if (lower === "_index.md" || lower === "index.md") continue;
      count += 1;
    }
  };

  walk(clusterDir, 0);
  return count;
}

/** The same count for background refreshes, without blocking the server's event loop. */
export async function countClusterMarkdownAsync(clusterDir: string): Promise<number> {
  const internalRoot = INTERNAL_CONCEPT_FOLDER.split("/")[0];
  const walk = async (dir: string, depth: number): Promise<number> => {
    let dirents: Dirent[];
    try {
      dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    let count = 0;
    for (const dirent of dirents) {
      const name = dirent.name;
      if (dirent.isDirectory()) {
        if (name === "assets" || name.startsWith(".") || (depth === 0 && name === internalRoot)) continue;
        count += await walk(path.join(dir, name), depth + 1);
      } else if (dirent.isFile() && name.endsWith(".md")) {
        const lower = name.toLowerCase();
        if (lower !== "_index.md" && lower !== "index.md") count += 1;
      }
    }
    return count;
  };
  return walk(clusterDir, 0);
}

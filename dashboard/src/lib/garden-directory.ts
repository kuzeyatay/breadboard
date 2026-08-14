// Where a Garden lives on disk, and the guarantee that nothing escapes it.
//
// This is deliberately a leaf: resolving a Garden's directory is the one thing
// every reader and writer needs, and it should not drag the whole knowledge
// pipeline in behind it. `garden-filesystem.ts` re-exports both names, so the
// existing callers are unaffected.

import path from "node:path";

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

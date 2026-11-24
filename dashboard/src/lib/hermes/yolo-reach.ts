// YOLO's reach: the whole machine, for one turn, without a single card.
//
// YOLO used to approve only what the lexical planner asked for, and only for a
// folder the message happened to name. "Apply the fix in mendix and test it"
// names no folder, so the turn could look but not touch, and the model spent
// it explaining that it lacked write access. These grants make YOLO mean what
// the switch says: read, write and run anywhere on the user's local drives.
//
// They are synthesized per turn and never persisted, so turning YOLO off
// takes them away on the very next turn. The user's autonomy tier is still the
// ceiling: below "write" the turn gets no reach grant and the normal card
// flow applies. Isolated/public sessions never reach this (the caller and the
// broker both refuse them).

import fs from "node:fs";
import path from "node:path";
import type { ApprovedFilesystemRoot } from "./filesystem-paths.ts";

export const YOLO_REACH_GRANT_PREFIX = "yolo-reach:";

/** Every local drive root: C:\, D:\ … on Windows; / elsewhere. */
export function localDriveRoots(platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== "win32") return ["/"];
  const roots: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch {
      // An unready removable drive is simply not part of the reach.
    }
  }
  return roots;
}

export function yoloReachGrants(
  userId: number,
  roots: readonly string[] = localDriveRoots(),
  now = new Date(),
): ApprovedFilesystemRoot[] {
  return roots.map((root) => ({
    id: `${YOLO_REACH_GRANT_PREFIX}${root}`,
    userId,
    canonicalPath: root,
    displayName: `YOLO reach (${root})`,
    permissions: {
      read: true,
      create: true,
      modify: true,
      move: true,
      delete: true,
      execute: true,
    },
    scope: "one_time",
    createdAt: now.toISOString(),
    revokedAt: null,
  }) as ApprovedFilesystemRoot);
}

/**
 * A filesystem root (a drive, or `/`) is reach, not a destination. The
 * end-of-turn produced-file sweep must not walk one, or every file any other
 * program touched during the turn would surface as the agent's artifact.
 */
export function isFilesystemRoot(value: string): boolean {
  const resolved = path.resolve(value);
  return path.parse(resolved).root === resolved;
}

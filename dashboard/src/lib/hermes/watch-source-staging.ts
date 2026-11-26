// Bringing a video the user can already reach into the one place Watch opens.
//
// Watch only opens local files inside the session workspace. That kept it from
// reading anything the user had not shared, but it also turned away videos the
// user plainly had shared: a recording in a folder they approved (the Terminal
// could list and copy it a moment earlier), or the stored copy of their own
// upload. The agent then copied the file over by hand and tried again.
//
// This does that step on the server, and only for those two cases. A path is
// staged when the user's folder grants allow reading it, or when it is the
// user's own stored chat video. It is linked (or copied) into
// `.breadboard/uploads/` and Watch gets that path, so Watch's own containment
// check is unchanged and still the last word. Anything else is left untouched
// and fails exactly as before.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalizePath,
  isWithinRoot,
  realPathAllowingMissing,
} from "./filesystem-paths.ts";
import { linkIntoWorkspace } from "./watch-turn.ts";
import { findVideoBlob } from "../conversations/video-blob-store.ts";
import { videoAttachmentFormat } from "../video-attachments.ts";

export interface WatchSourceStagingDeps {
  canRead(userId: number, canonicalPath: string): boolean | Promise<boolean>;
  isOwnStoredVideo(userId: number, realPath: string): boolean;
}

const DEFAULT_DEPS: WatchSourceStagingDeps = {
  // Loaded on use: the grant store opens the app database.
  canRead: async (userId, canonicalPath) =>
    (await import("./filesystem-grant-store.ts")).authorizePath(userId, canonicalPath, "read").allowed,
  isOwnStoredVideo: (userId, realPath) => {
    const blobId = path.basename(realPath).replace(/\.[^.]+$/, "");
    const blob = findVideoBlob({ userId, blobId });
    if (!blob) return false;
    try {
      return comparable(fs.realpathSync.native(blob.path)) === comparable(realPath);
    } catch {
      return false;
    }
  },
};

function comparable(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * The `source` to hand Watch. Returns the original value unless it is a local
 * video outside the workspace that this user may read, in which case it is the
 * staged path inside the workspace.
 */
export async function stageWatchSource(input: {
  userId: number;
  source: string;
  workspaceRoot: string;
  deps?: WatchSourceStagingDeps;
}): Promise<string> {
  const source = input.source.trim();
  // URLs and relative paths are Watch's own business.
  if (!source || /^[a-z][a-z0-9+.-]*:\/\//i.test(source)) return input.source;
  const canonical = canonicalizePath(source);
  if (!canonical) return input.source;
  const root = realPathAllowingMissing(path.resolve(input.workspaceRoot));
  let real: string;
  try {
    real = fs.realpathSync.native(canonical);
    const stats = fs.statSync(real);
    if (!stats.isFile()) return input.source;
  } catch {
    return input.source;
  }
  if (isWithinRoot(root, real)) return input.source;
  const format = videoAttachmentFormat(real);
  if (!format) return input.source;
  const deps = input.deps ?? DEFAULT_DEPS;
  const ownUpload = deps.isOwnStoredVideo(input.userId, real);
  if (!ownUpload && !(await deps.canRead(input.userId, canonical))) return input.source;
  // Named by where it came from, so the same file staged twice is reused and
  // two files that share a name never overwrite each other.
  const tag = createHash("sha256").update(comparable(real)).digest("hex").slice(0, 12);
  const base = path.basename(real, path.extname(real)).replace(/[^\w.-]+/g, "_").slice(0, 80) || "video";
  const fileName = `${tag}-${base}.${format}`;
  const byteSize = fs.statSync(real).size;
  // The user's own upload is linked the way an attachment always is. A file
  // from a granted folder is copied: a hard link would let a write inside the
  // workspace change the original, which a read grant never allowed.
  const staged = ownUpload
    ? linkIntoWorkspace({ sourcePath: real, workspaceRoot: root, fileName, byteSize })
    : copyIntoWorkspace({ sourcePath: real, workspaceRoot: root, fileName, byteSize });
  return staged ?? input.source;
}

function copyIntoWorkspace(input: {
  sourcePath: string;
  workspaceRoot: string;
  fileName: string;
  byteSize: number;
}): string | null {
  const directory = path.join(input.workspaceRoot, ".breadboard", "uploads");
  const destination = path.join(directory, input.fileName);
  try {
    const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
    if (existing?.isFile() && existing.nlink === 1 && existing.size === input.byteSize) return destination;
    fs.mkdirSync(directory, { recursive: true });
    if (existing) fs.rmSync(destination, { force: true });
    fs.copyFileSync(input.sourcePath, destination);
    return destination;
  } catch {
    return null;
  }
}

// Pure path canonicalization and containment logic for filesystem grants.
//
// OpenHarness sessions run inside an ephemeral `.runtime/openharness` workspace.
// That workspace is the right default, but it made every request about the
// user's own files ("what is in my Documents folder?") impossible to satisfy,
// so the agent answered with a generic refusal. This module is the missing
// authority layer: a grant is the ONLY way a path outside the session workspace
// becomes reachable.
//
// Security properties enforced here (not in prompts, not in the client):
//
//   * Grants are per-user. One user's grants are never visible or usable by
//     another, and the browser cannot name a path to be trusted — it can only
//     ask, which produces a permission request the user must approve.
//   * Paths are canonicalized AND symlink-resolved server-side, on both the
//     grant root and the target, before containment is checked. A junction,
//     symlink, or `..` segment therefore cannot escape a granted root.
//   * Permissions are per-operation. Read never implies write; write never
//     implies delete; nothing implies execute.
//   * A path appearing in a chat message never implies approval. Aliases like
//     "Documents" resolve only against roots the user already granted.
//
// Windows is a first-class target: drive letters, UNC shares, OneDrive
// redirected folders, and case-insensitive comparison are all handled.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type FilesystemOperation =
  | "read"
  | "create"
  | "modify"
  | "move"
  | "delete"
  | "execute";

export const FILESYSTEM_OPERATIONS: readonly FilesystemOperation[] = [
  "read",
  "create",
  "modify",
  "move",
  "delete",
  "execute",
] as const;

export type GrantScope = "remembered" | "one_time";

export interface FilesystemPermissions {
  read: boolean;
  create: boolean;
  modify: boolean;
  move: boolean;
  delete: boolean;
  execute: boolean;
}

export interface ApprovedFilesystemRoot {
  id: string;
  userId: number;
  canonicalPath: string;
  displayName: string;
  permissions: FilesystemPermissions;
  scope: GrantScope;
  createdAt: string;
  revokedAt: string | null;
}

interface GrantRow {
  id: number;
  user_id: number;
  canonical_path: string;
  display_name: string;
  perm_read: number;
  perm_create: number;
  perm_modify: number;
  perm_move: number;
  perm_delete: number;
  perm_execute: number;
  scope: GrantScope;
  created_at: string;
  revoked_at: string | null;
}

const WINDOWS = process.platform === "win32";

/* ------------------------------------------------------------------ */
/* Canonicalization                                                    */
/* ------------------------------------------------------------------ */

/**
 * Expand a leading `~` against the current user's home directory. Only a bare
 * `~` or `~/...` is expanded; `~user` is not, because resolving another
 * account's home is never something a grant should do implicitly.
 */
function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (/^~[\\/]/.test(value)) return path.join(os.homedir(), value.slice(2));
  return value;
}

/**
 * Canonicalize a path *lexically*: expand `~`, normalize separators and `..`,
 * make absolute, and upper-case a Windows drive letter so comparisons are
 * stable. This does not touch the filesystem.
 */
export function canonicalizePath(input: string): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  // Reject NUL and other control characters outright rather than letting them
  // reach a syscall.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  const expanded = expandHome(trimmed);
  if (!path.isAbsolute(expanded)) return null;
  let resolved = path.resolve(expanded);
  if (WINDOWS && /^[a-z]:/.test(resolved)) {
    resolved = resolved[0].toUpperCase() + resolved.slice(1);
  }
  // Strip a trailing separator except for a drive/UNC root.
  if (resolved.length > 3 && /[\\/]$/.test(resolved)) {
    resolved = resolved.replace(/[\\/]+$/, "");
  }
  return resolved;
}

/**
 * Resolve a path through symlinks/junctions. For a path that does not exist
 * yet (a file about to be created), resolve the nearest existing ancestor and
 * re-append the remainder, so a create target is still checked against the
 * *real* location of its parent directory.
 */
export function realPathAllowingMissing(target: string): string {
  let current = target;
  const suffix: string[] = [];
  // Walk up until something exists. The loop terminates at the filesystem root
  // because path.dirname(root) === root.
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return suffix.length ? path.join(real, ...suffix.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

function comparablePath(value: string): string {
  const normalized = path.resolve(value);
  return WINDOWS ? normalized.toLowerCase() : normalized;
}

/**
 * True when `target` is the same as, or nested inside, `root`. Comparison is
 * segment-aware, so `C:\Docs2` is not treated as inside `C:\Docs`.
 */
export function isWithinRoot(root: string, target: string): boolean {
  const a = comparablePath(root);
  const b = comparablePath(target);
  if (a === b) return true;
  const relative = path.relative(a, b);
  if (!relative) return true;
  if (relative.startsWith("..")) return false;
  if (path.isAbsolute(relative)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Aliases                                                             */
/* ------------------------------------------------------------------ */

/**
 * Well-known folder aliases a user may say in chat. Resolving an alias
 * produces *candidate* paths only; a candidate becomes reachable solely by
 * matching an existing grant. Saying "Documents" never creates authority.
 */
export function candidatePathsForAlias(alias: string): string[] {
  const key = alias.trim().toLowerCase().replace(/\s+/g, " ");
  const home = os.homedir();
  const oneDrive =
    process.env.OneDrive ||
    process.env.OneDriveConsumer ||
    process.env.OneDriveCommercial ||
    null;
  const bases = [home, ...(oneDrive ? [oneDrive] : [])];
  const folders: Record<string, string[]> = {
    documents: ["Documents"],
    document: ["Documents"],
    desktop: ["Desktop"],
    downloads: ["Downloads"],
    download: ["Downloads"],
    pictures: ["Pictures"],
    picture: ["Pictures"],
    videos: ["Videos"],
    music: ["Music"],
  };
  if (key === "home" || key === "home folder" || key === "home directory") {
    return [home];
  }
  if (key === "onedrive") return oneDrive ? [oneDrive] : [];
  const names = folders[key];
  if (!names) return [];
  const out: string[] = [];
  for (const base of bases) {
    for (const name of names) {
      const candidate = canonicalizePath(path.join(base, name));
      if (candidate) out.push(candidate);
    }
  }
  return out;
}

/**
 * Map a spoken alias to a granted root, if the user has already approved one
 * of its candidate locations. Returns null when nothing is approved, which is
 * the signal to raise a permission request rather than to guess.
 */
export function resolveAliasToGrant(
  alias: string,
  grants: readonly ApprovedFilesystemRoot[],
): ApprovedFilesystemRoot | null {
  const candidates = candidatePathsForAlias(alias);
  if (candidates.length === 0) return null;
  for (const candidate of candidates) {
    const real = realPathAllowingMissing(candidate);
    // An alias matches a grant when the grant is at, or above, the alias
    // location — approving the home folder covers Documents beneath it.
    const match = grants.find((grant) =>
      isWithinRoot(realPathAllowingMissing(grant.canonicalPath), real),
    );
    if (match) return match;
  }
  return null;
}

/**
 * The permission set a task plan's capabilities imply, used to build a
 * concrete permission request ("read filenames and move files, not delete").
 */
export function permissionsForCapabilities(
  capabilities: readonly string[],
): FilesystemPermissions {
  const has = (c: string) => capabilities.includes(c);
  return {
    read: has("filesystem_read") || has("filesystem_write") || has("destructive_filesystem"),
    create: has("filesystem_write"),
    modify: has("filesystem_write") || has("coding"),
    move: has("filesystem_write"),
    delete: has("destructive_filesystem"),
    execute: has("command_execution") || has("coding"),
  };
}

/** Render a permission set as concrete, non-technical prose for a prompt. */
export function describePermissions(permissions: FilesystemPermissions): string {
  const yes: string[] = [];
  const no: string[] = [];
  const label: Record<FilesystemOperation, string> = {
    read: "read files and filenames",
    create: "create files and folders",
    modify: "change file contents",
    move: "move and rename files",
    delete: "delete files",
    execute: "run programs",
  };
  for (const operation of FILESYSTEM_OPERATIONS) {
    (permissions[operation] ? yes : no).push(label[operation]);
  }
  const granted = yes.length ? `I need permission to ${yes.join(", ")}.` : "";
  const withheld = no.length ? ` I will not ${no.join(", ")}.` : "";
  return `${granted}${withheld}`.trim();
}

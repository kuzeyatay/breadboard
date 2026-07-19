// Persistent, per-user grants over real local folders.
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
//   * Paths are canonicalized AND symlink-resolved on both the grant root and
//     the target before containment is tested, so a junction, symlink, or `..`
//     segment cannot escape a granted root.
//   * Permissions are per-operation. Read never implies write; write never
//     implies delete; nothing implies execute.
//   * A path appearing in a chat message never implies approval.
//
// The store is built through `createFilesystemGrantStore(database)` so the
// authorization logic can be exercised against a throwaway in-memory database
// in tests without touching brain.db. The module-level functions bind that
// factory to the application database.

import {
  canonicalizePath,
  isWithinRoot,
  realPathAllowingMissing,
  resolveAliasToGrant,
  type ApprovedFilesystemRoot,
  type FilesystemOperation,
  type FilesystemPermissions,
  type GrantScope,
} from "./filesystem-paths.ts";
import fs from "node:fs";
import path from "node:path";

export type {
  ApprovedFilesystemRoot,
  FilesystemOperation,
  FilesystemPermissions,
  GrantScope,
};

/** DDL for the grant table, shared with the migration and with tests. */
export const FILESYSTEM_GRANT_DDL = `
  CREATE TABLE IF NOT EXISTS openharness_filesystem_grants (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    canonical_path TEXT    NOT NULL,
    display_name   TEXT    NOT NULL,
    perm_read      INTEGER NOT NULL DEFAULT 1,
    perm_create    INTEGER NOT NULL DEFAULT 0,
    perm_modify    INTEGER NOT NULL DEFAULT 0,
    perm_move      INTEGER NOT NULL DEFAULT 0,
    perm_delete    INTEGER NOT NULL DEFAULT 0,
    perm_execute   INTEGER NOT NULL DEFAULT 0,
    scope          TEXT    NOT NULL DEFAULT 'remembered'
                   CHECK (scope IN ('remembered','one_time')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    revoked_at     TEXT,
    UNIQUE(user_id, canonical_path)
  );
`;

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

/** Minimal surface of better-sqlite3 this module depends on. */
interface DatabaseHandle {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
}

export class GrantError extends Error {
  // Declared as a field rather than a constructor parameter property so the
  // module stays loadable under Node's strip-only TypeScript mode, which the
  // test runner uses.
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GrantError";
    this.code = code;
  }
}

export interface GrantRequest {
  userId: number;
  requestedPath: string;
  displayName?: string;
  permissions: Partial<FilesystemPermissions>;
  scope?: GrantScope;
}

export type PathAuthorization =
  | { allowed: true; canonicalPath: string; grant: ApprovedFilesystemRoot }
  | {
      allowed: false;
      reason:
        | "invalid_path"
        | "no_grant"
        | "operation_not_permitted"
        | "escapes_root";
      /** Concrete, non-technical explanation suitable for a permission prompt. */
      message: string;
      /** The grant covering the location but lacking the operation, if any. */
      grant?: ApprovedFilesystemRoot;
      canonicalPath?: string;
    };

function toGrant(row: GrantRow): ApprovedFilesystemRoot {
  return {
    id: String(row.id),
    userId: row.user_id,
    canonicalPath: row.canonical_path,
    displayName: row.display_name,
    permissions: {
      read: row.perm_read === 1,
      create: row.perm_create === 1,
      modify: row.perm_modify === 1,
      move: row.perm_move === 1,
      delete: row.perm_delete === 1,
      execute: row.perm_execute === 1,
    },
    scope: row.scope,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export interface FilesystemGrantStore {
  grant(request: GrantRequest): ApprovedFilesystemRoot;
  list(userId: number, includeRevoked?: boolean): ApprovedFilesystemRoot[];
  revoke(userId: number, grantId: string): boolean;
  expireOneTime(userId: number): number;
  authorize(
    userId: number,
    requestedPath: string,
    operation: FilesystemOperation,
  ): PathAuthorization;
  resolveAlias(userId: number, alias: string): ApprovedFilesystemRoot | null;
}

export function createFilesystemGrantStore(
  database: DatabaseHandle,
): FilesystemGrantStore {
  function list(userId: number, includeRevoked = false): ApprovedFilesystemRoot[] {
    const rows = database
      .prepare(
        `SELECT * FROM openharness_filesystem_grants
          WHERE user_id = ?${includeRevoked ? "" : " AND revoked_at IS NULL"}
          ORDER BY created_at DESC, id DESC`,
      )
      .all(userId) as GrantRow[];
    return rows.map(toGrant);
  }

  function grant(request: GrantRequest): ApprovedFilesystemRoot {
    const canonical = canonicalizePath(request.requestedPath);
    if (!canonical) {
      throw new GrantError("invalid_path", "A grant requires an absolute path.");
    }
    let stats: fs.Stats;
    try {
      stats = fs.statSync(canonical);
    } catch {
      throw new GrantError("path_not_found", "That folder does not exist.");
    }
    if (!stats.isDirectory()) {
      throw new GrantError("not_a_directory", "A grant must target a folder.");
    }
    // Store the symlink-resolved location so replacing the link later cannot
    // silently redirect an existing grant somewhere else.
    const real = realPathAllowingMissing(canonical);
    const permissions: FilesystemPermissions = {
      read: request.permissions.read ?? true,
      create: request.permissions.create ?? false,
      modify: request.permissions.modify ?? false,
      move: request.permissions.move ?? false,
      delete: request.permissions.delete ?? false,
      execute: request.permissions.execute ?? false,
    };
    database
      .prepare(
        `INSERT INTO openharness_filesystem_grants
           (user_id, canonical_path, display_name, perm_read, perm_create,
            perm_modify, perm_move, perm_delete, perm_execute, scope, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(user_id, canonical_path) DO UPDATE SET
           display_name = excluded.display_name,
           perm_read    = excluded.perm_read,
           perm_create  = excluded.perm_create,
           perm_modify  = excluded.perm_modify,
           perm_move    = excluded.perm_move,
           perm_delete  = excluded.perm_delete,
           perm_execute = excluded.perm_execute,
           scope        = excluded.scope,
           revoked_at   = NULL`,
      )
      .run(
        request.userId,
        real,
        request.displayName?.trim() || path.basename(real) || real,
        permissions.read ? 1 : 0,
        permissions.create ? 1 : 0,
        permissions.modify ? 1 : 0,
        permissions.move ? 1 : 0,
        permissions.delete ? 1 : 0,
        permissions.execute ? 1 : 0,
        request.scope ?? "remembered",
      );
    const row = database
      .prepare(
        "SELECT * FROM openharness_filesystem_grants WHERE user_id = ? AND canonical_path = ?",
      )
      .get(request.userId, real) as GrantRow;
    return toGrant(row);
  }

  function revoke(userId: number, grantId: string): boolean {
    return (
      database
        .prepare(
          `UPDATE openharness_filesystem_grants
              SET revoked_at = datetime('now')
            WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        )
        .run(Number(grantId), userId).changes > 0
    );
  }

  function expireOneTime(userId: number): number {
    return database
      .prepare(
        `UPDATE openharness_filesystem_grants
            SET revoked_at = datetime('now')
          WHERE user_id = ? AND scope = 'one_time' AND revoked_at IS NULL`,
      )
      .run(userId).changes;
  }

  function authorize(
    userId: number,
    requestedPath: string,
    operation: FilesystemOperation,
  ): PathAuthorization {
    const canonical = canonicalizePath(requestedPath);
    if (!canonical) {
      return {
        allowed: false,
        reason: "invalid_path",
        message: "That is not an absolute path I can resolve.",
      };
    }
    const realTarget = realPathAllowingMissing(canonical);
    const grants = list(userId);

    // Containment is tested between *real* paths on both sides.
    const containing = grants.filter((entry) =>
      isWithinRoot(realPathAllowingMissing(entry.canonicalPath), realTarget),
    );
    if (containing.length === 0) {
      // Distinguish "no grant here" from "a link tried to leave one": the
      // second is a security-relevant event and reads differently to the user.
      const lexicallyInside = grants.find((entry) =>
        isWithinRoot(entry.canonicalPath, canonical),
      );
      if (lexicallyInside) {
        return {
          allowed: false,
          reason: "escapes_root",
          message: `That path resolves outside ${lexicallyInside.displayName} through a link, so your approval does not cover it.`,
          grant: lexicallyInside,
          canonicalPath: realTarget,
        };
      }
      return {
        allowed: false,
        reason: "no_grant",
        message: `I do not have access to ${canonical}. You can approve that folder and I will continue.`,
        canonicalPath: canonical,
      };
    }

    // Prefer the most specific (deepest) matching grant.
    const ordered = [...containing].sort(
      (a, b) => b.canonicalPath.length - a.canonicalPath.length,
    );
    const permitted = ordered.find((entry) => entry.permissions[operation]);
    if (!permitted) {
      return {
        allowed: false,
        reason: "operation_not_permitted",
        message: `Your approval for ${ordered[0].displayName} does not include permission to ${operation} files there.`,
        grant: ordered[0],
        canonicalPath: realTarget,
      };
    }
    return { allowed: true, canonicalPath: realTarget, grant: permitted };
  }

  return {
    grant,
    list,
    revoke,
    expireOneTime,
    authorize,
    resolveAlias: (userId, alias) => resolveAliasToGrant(alias, list(userId)),
  };
}

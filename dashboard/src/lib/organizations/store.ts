import db from "../db.ts";
import type Database from "better-sqlite3";
import type {
  Organization,
  OrganizationMember,
  OrganizationPendingInvite,
  OrganizationRole,
  ReceivedInvite,
} from "./types.ts";

export type {
  Organization,
  OrganizationMember,
  OrganizationPendingInvite,
  OrganizationRole,
  ReceivedInvite,
};

/** Carries an HTTP status so a route can answer with the real reason. */
export class OrganizationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_NAME_LENGTH = 80;

function normalizeRole(value: unknown): OrganizationRole {
  return value === "owner" || value === "admin" ? value : "member";
}

function rank(role: OrganizationRole): number {
  return role === "owner" ? 3 : role === "admin" ? 2 : 1;
}

export function memberRole(
  organizationId: number,
  userId: number,
): OrganizationRole | null {
  const row = db
    .prepare(
      "SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ?",
    )
    .get(organizationId, userId) as { role: string } | undefined;
  return row ? normalizeRole(row.role) : null;
}

function requireRole(
  organizationId: number,
  userId: number,
  minimum: OrganizationRole,
): OrganizationRole {
  const role = memberRole(organizationId, userId);
  if (!role) throw new OrganizationError(404, "Organization not found");
  if (rank(role) < rank(minimum)) {
    throw new OrganizationError(403, "You cannot do that in this organization");
  }
  return role;
}

/** Every organization the account belongs to, ids only, for garden queries. */
export function organizationIdsForUser(userId: number): number[] {
  if (!Number.isFinite(userId) || userId <= 0) return [];
  const rows = db
    .prepare(
      "SELECT organization_id FROM organization_members WHERE user_id = ?",
    )
    .all(userId) as { organization_id: number }[];
  return rows.map((row) => row.organization_id);
}

/**
 * A SQL fragment matching gardens shared with any organization the account
 * belongs to. The ids are integers read straight from the database, so they are
 * safe to inline, which keeps callers free to place the clause anywhere in a
 * query without rearranging their bound parameters. `0` is false in SQLite, so
 * an account with no organization simply matches nothing.
 */
export function organizationClusterClause(
  userId: number,
  alias = "c",
): string {
  const ids = organizationIdsForUser(userId);
  if (ids.length === 0) return "0";
  return `(${alias}.visibility = 'organization' AND ${alias}.organization_id IN (${ids.join(",")}))`;
}

/** Organizations both accounts belong to. */
export function sharedOrganizationIds(
  userId: number,
  otherUserId: number,
): number[] {
  const rows = db
    .prepare(
      `SELECT a.organization_id AS id
       FROM organization_members a
       JOIN organization_members b
         ON b.organization_id = a.organization_id AND b.user_id = ?
       WHERE a.user_id = ?`,
    )
    .all(otherUserId, userId) as { id: number }[];
  return rows.map((row) => row.id);
}

function readMembers(
  organizationId: number,
  database: Database.Database = db,
): OrganizationMember[] {
  const rows = database
    .prepare(
      `SELECT m.user_id, m.role, m.joined_at, u.username, u.email
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = ?
       ORDER BY
         CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
         lower(u.username)`,
    )
    .all(organizationId) as {
    user_id: number;
    role: string;
    joined_at: string;
    username: string;
    email: string;
  }[];

  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    email: row.email,
    role: normalizeRole(row.role),
    joinedAt: row.joined_at,
  }));
}

function readPendingInvites(
  organizationId: number,
  database: Database.Database = db,
): OrganizationPendingInvite[] {
  const rows = database
    .prepare(
      `SELECT i.id, i.role, i.created_at, u.username, u.email
       FROM organization_invites i
       JOIN users u ON u.id = i.invited_user_id
       WHERE i.organization_id = ? AND i.status = 'pending'
       ORDER BY i.created_at DESC`,
    )
    .all(organizationId) as {
    id: number;
    role: string;
    created_at: string;
    username: string;
    email: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    role: normalizeRole(row.role),
    createdAt: row.created_at,
  }));
}

export function listOrganizations(
  userId: number,
  database: Database.Database = db,
): Organization[] {
  const rows = database
    .prepare(
      `SELECT o.id, o.name, o.created_at, m.role
       FROM organization_members m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = ?
       ORDER BY lower(o.name)`,
    )
    .all(userId) as {
    id: number;
    name: string;
    created_at: string;
    role: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    role: normalizeRole(row.role),
    members: readMembers(row.id, database),
    invites: readPendingInvites(row.id, database),
  }));
}

export function listReceivedInvites(userId: number): ReceivedInvite[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.role, i.created_at, o.id AS organization_id, o.name,
              u.username AS invited_by
       FROM organization_invites i
       JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN users u ON u.id = i.invited_by_user_id
       WHERE i.invited_user_id = ? AND i.status = 'pending'
       ORDER BY i.created_at DESC`,
    )
    .all(userId) as {
    id: number;
    role: string;
    created_at: string;
    organization_id: number;
    name: string;
    invited_by: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.name,
    role: normalizeRole(row.role),
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  }));
}

export function createOrganization(userId: number, name: string): number {
  const clean = name.trim();
  if (!clean) throw new OrganizationError(400, "A name is required");
  if (clean.length > MAX_NAME_LENGTH) {
    throw new OrganizationError(400, "That name is too long");
  }

  const create = db.transaction(() => {
    const result = db
      .prepare(
        "INSERT INTO organizations (name, created_by_user_id) VALUES (?, ?)",
      )
      .run(clean, userId);
    const organizationId = Number(result.lastInsertRowid);
    db.prepare(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'owner')",
    ).run(organizationId, userId);
    return organizationId;
  });

  return create();
}

export function renameOrganization(
  organizationId: number,
  userId: number,
  name: string,
): void {
  requireRole(organizationId, userId, "admin");
  const clean = name.trim();
  if (!clean) throw new OrganizationError(400, "A name is required");
  if (clean.length > MAX_NAME_LENGTH) {
    throw new OrganizationError(400, "That name is too long");
  }
  db.prepare("UPDATE organizations SET name = ? WHERE id = ?").run(
    clean,
    organizationId,
  );
}

/** Look someone up the way a person would type them: username or email. */
function findUserByHandle(
  handle: string,
): { id: number; username: string } | null {
  const clean = handle.trim();
  if (!clean) return null;
  const row = db
    .prepare(
      "SELECT id, username FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)",
    )
    .get(clean, clean) as { id: number; username: string } | undefined;
  return row ?? null;
}

export function inviteMember(
  organizationId: number,
  userId: number,
  handle: string,
  role: OrganizationRole,
): { username: string } {
  requireRole(organizationId, userId, "admin");

  const invitee = findUserByHandle(handle);
  if (!invitee) throw new OrganizationError(404, "No account by that name");
  if (memberRole(organizationId, invitee.id)) {
    throw new OrganizationError(409, `${invitee.username} is already a member`);
  }

  const wanted = normalizeRole(role) === "admin" ? "admin" : "member";
  db.prepare(
    `INSERT INTO organization_invites
       (organization_id, invited_user_id, invited_by_user_id, role, status)
     VALUES (?, ?, ?, ?, 'pending')
     ON CONFLICT(organization_id, invited_user_id) DO UPDATE SET
       invited_by_user_id = excluded.invited_by_user_id,
       role = excluded.role,
       status = 'pending',
       created_at = datetime('now'),
       responded_at = NULL`,
  ).run(organizationId, invitee.id, userId, wanted);

  return { username: invitee.username };
}

export function cancelInvite(inviteId: number, userId: number): void {
  const invite = db
    .prepare("SELECT organization_id FROM organization_invites WHERE id = ?")
    .get(inviteId) as { organization_id: number } | undefined;
  if (!invite) throw new OrganizationError(404, "Invite not found");
  requireRole(invite.organization_id, userId, "admin");
  db.prepare("DELETE FROM organization_invites WHERE id = ?").run(inviteId);
}

export function respondToInvite(
  inviteId: number,
  userId: number,
  accept: boolean,
): void {
  const invite = db
    .prepare(
      `SELECT id, organization_id, role
       FROM organization_invites
       WHERE id = ? AND invited_user_id = ? AND status = 'pending'`,
    )
    .get(inviteId, userId) as
    | { id: number; organization_id: number; role: string }
    | undefined;
  if (!invite) throw new OrganizationError(404, "Invite not found");

  const respond = db.transaction(() => {
    db.prepare(
      "UPDATE organization_invites SET status = ?, responded_at = datetime('now') WHERE id = ?",
    ).run(accept ? "accepted" : "declined", inviteId);
    if (accept) {
      db.prepare(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT(organization_id, user_id) DO NOTHING`,
      ).run(invite.organization_id, userId, normalizeRole(invite.role));
    }
  });

  respond();
}

/**
 * Put an account into an organization outright, no invite round trip.
 *
 * The invite flow exists for the case where the other person decides; this is
 * the case where the organization's own admin does. Buzz needs it because
 * bringing someone into a room is how people join a community now — there is
 * no separate screen to accept an invitation on — and a room member who is not
 * an organization member cannot read the room they were just added to.
 *
 * Idempotent: already being in the organization is a success, not a clash, so
 * two people adding the same colleague at once cannot fail the second one.
 */
export function addOrganizationMember(
  organizationId: number,
  actingUserId: number,
  targetUserId: number,
  role: OrganizationRole = "member",
): void {
  requireRole(organizationId, actingUserId, "admin");
  db.prepare(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT(organization_id, user_id) DO NOTHING`,
  ).run(organizationId, targetUserId, normalizeRole(role));
}

/**
 * Accounts matching a query, for the "add someone" pickers.
 *
 * Deliberately the whole account table rather than one organization's roster:
 * this is how a person is brought into a community in the first place, so a
 * search that could only find people already in it would never add anyone.
 * Answers the two things a picker shows and nothing else — no email hashes, no
 * timestamps, no role.
 */
/** One account, by id — the name a picker's chosen row belongs to. */
export function getAccount(
  userId: number,
): { userId: number; username: string } | null {
  const row = db
    .prepare("SELECT id, username FROM users WHERE id = ?")
    .get(userId) as { id: number; username: string } | undefined;
  return row ? { userId: row.id, username: row.username } : null;
}

export function searchAccounts(
  query: string,
  options: { excludeUserIds?: readonly number[]; limit?: number } = {},
): Array<{ userId: number; username: string }> {
  const needle = query.trim();
  const excluded = new Set(options.excludeUserIds ?? []);
  const rows = db
    .prepare(
      `SELECT id, username FROM users
       WHERE (@needle = '' OR username LIKE @like ESCAPE '\\' OR email LIKE @like ESCAPE '\\')
       ORDER BY username
       LIMIT @limit`,
    )
    .all({
      needle,
      // The wildcards are ours; whatever was typed stays literal.
      like: `%${needle.replace(/[\\%_]/g, (character) => `\\${character}`)}%`,
      limit: (options.limit ?? 20) + excluded.size,
    }) as Array<{ id: number; username: string }>;
  return rows
    .filter((row) => !excluded.has(row.id))
    .slice(0, options.limit ?? 20)
    .map((row) => ({ userId: row.id, username: row.username }));
}

export function setMemberRole(
  organizationId: number,
  userId: number,
  targetUserId: number,
  role: OrganizationRole,
): void {
  const actorRole = requireRole(organizationId, userId, "admin");
  const targetRole = memberRole(organizationId, targetUserId);
  if (!targetRole) throw new OrganizationError(404, "Not a member");
  if (targetRole === "owner") {
    throw new OrganizationError(403, "The owner keeps their role");
  }

  const wanted = normalizeRole(role);
  if (wanted === "owner") {
    if (actorRole !== "owner") {
      throw new OrganizationError(403, "Only the owner can hand over the organization");
    }
    const handOver = db.transaction(() => {
      db.prepare(
        "UPDATE organization_members SET role = 'member' WHERE organization_id = ? AND user_id = ?",
      ).run(organizationId, userId);
      db.prepare(
        "UPDATE organization_members SET role = 'owner' WHERE organization_id = ? AND user_id = ?",
      ).run(organizationId, targetUserId);
    });
    handOver();
    return;
  }

  db.prepare(
    "UPDATE organization_members SET role = ? WHERE organization_id = ? AND user_id = ?",
  ).run(wanted, organizationId, targetUserId);
}

/**
 * Remove someone, or yourself. The owner cannot walk out on an organization
 * that still has other people in it, because the gardens shared into it would
 * be left without anyone able to manage membership.
 */
export function removeMember(
  organizationId: number,
  userId: number,
  targetUserId: number,
): void {
  const actorRole = memberRole(organizationId, userId);
  if (!actorRole) throw new OrganizationError(404, "Organization not found");

  const leaving = targetUserId === userId;
  if (!leaving && rank(actorRole) < rank("admin")) {
    throw new OrganizationError(403, "You cannot remove people here");
  }

  const targetRole = memberRole(organizationId, targetUserId);
  if (!targetRole) throw new OrganizationError(404, "Not a member");
  if (targetRole === "owner" && !leaving) {
    throw new OrganizationError(403, "The owner cannot be removed");
  }
  if (targetRole === "owner") {
    const others = db
      .prepare(
        "SELECT COUNT(*) AS count FROM organization_members WHERE organization_id = ? AND user_id <> ?",
      )
      .get(organizationId, userId) as { count: number };
    if (others.count > 0) {
      throw new OrganizationError(
        409,
        "Hand the organization to someone else before leaving",
      );
    }
    deleteOrganization(organizationId, userId);
    return;
  }

  const remove = db.transaction(() => {
    db.prepare(
      "DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?",
    ).run(organizationId, targetUserId);
    // Gardens the departing account shared here lose their audience with them.
    db.prepare(
      `UPDATE clusters SET visibility = 'private', organization_id = NULL
       WHERE user_id = ? AND visibility = 'organization' AND organization_id = ?`,
    ).run(targetUserId, organizationId);
  });
  remove();
}

export function deleteOrganization(
  organizationId: number,
  userId: number,
): void {
  const role = memberRole(organizationId, userId);
  if (role !== "owner") {
    throw new OrganizationError(403, "Only the owner can delete an organization");
  }
  const remove = db.transaction(() => {
    db.prepare(
      `UPDATE clusters SET visibility = 'private', organization_id = NULL
       WHERE visibility = 'organization' AND organization_id = ?`,
    ).run(organizationId);
    db.prepare("DELETE FROM organizations WHERE id = ?").run(organizationId);
  });
  remove();
}

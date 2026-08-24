// Reads and writes for Buzz rooms.
//
// The room transcript is the source of truth for what the page shows. An
// agent's private reasoning lives in an ordinary conversation (see
// `schema.ts`); nothing in this file talks to a model — it only records what
// was said and by whom, so the shape can be exercised against an in-memory
// database.

import crypto from "node:crypto";
import type Database from "better-sqlite3";

import {
  BREAD_ACCENT,
  BREAD_HANDLE,
  BREAD_NAME,
  BREAD_SLUG,
} from "./bread.ts";

export type BuzzRoomKind = "channel" | "dm";
export type BuzzRoomVisibility = "public" | "private";
export type BuzzMemberKind = "human" | "agent";
export type BuzzRespondTo = "always" | "mention" | "never";
export type BuzzAuthorKind = "human" | "agent" | "system";
export type BuzzMessageStatus =
  | "pending"
  | "streaming"
  | "complete"
  | "failed"
  | "aborted";

export interface BuzzRoom {
  id: number;
  publicId: string;
  organizationId: number;
  createdByUserId: number | null;
  slug: string;
  name: string;
  topic: string;
  purpose: string;
  kind: BuzzRoomKind;
  visibility: BuzzRoomVisibility;
  archivedAt: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuzzMember {
  id: number;
  roomId: number;
  kind: BuzzMemberKind;
  userId: number | null;
  personaSlug: string | null;
  displayName: string;
  handle: string;
  accent: string;
  respondTo: BuzzRespondTo;
  model: string | null;
  conversationId: number | null;
  muted: boolean;
  joinedAt: string;
}

export interface BuzzMessage {
  id: number;
  roomId: number;
  clientMessageId: string;
  memberId: number | null;
  authorKind: BuzzAuthorKind;
  authorName: string;
  authorHandle: string;
  personaSlug: string | null;
  body: string;
  parentId: number | null;
  status: BuzzMessageStatus;
  runId: string | null;
  metadata: Record<string, unknown> | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Replies hanging off this message. Only set for spine messages. */
  replyCount?: number;
  lastReplyAt?: string | null;
  reactions?: BuzzReaction[];
}

export interface BuzzReaction {
  emoji: string;
  count: number;
  /** Whether the reading account is one of the reactors. */
  mine: boolean;
}

/* ── identity ────────────────────────────────────────────────────────────── */

function publicRoomId(): string {
  return `room_${crypto.randomBytes(12).toString("base64url")}`;
}

/**
 * Buzz channel names are lowercase and hyphenated, the way IRC and Slack
 * taught everyone to expect. The display name keeps whatever was typed.
 */
export function canonicalRoomSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "room";
}

/**
 * A member handle is what `@` completes against. Agents get their persona
 * slug, which is already canonical and already unique in the roster.
 */
export function canonicalHandle(value: string): string {
  const handle = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return handle || "member";
}

function uniqueSlug(
  database: Database.Database,
  organizationId: number,
  base: string,
): string {
  let candidate = base;
  let suffix = 2;
  const taken = database.prepare(
    "SELECT 1 FROM buzz_rooms WHERE organization_id = ? AND slug = ?",
  );
  while (taken.get(organizationId, candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/* ── row mapping ─────────────────────────────────────────────────────────── */

interface RoomRow {
  id: number;
  public_id: string;
  organization_id: number;
  created_by_user_id: number | null;
  slug: string;
  name: string;
  topic: string;
  purpose: string;
  kind: BuzzRoomKind;
  visibility: BuzzRoomVisibility;
  archived_at: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

function toRoom(row: RoomRow): BuzzRoom {
  return {
    id: row.id,
    publicId: row.public_id,
    organizationId: row.organization_id,
    createdByUserId: row.created_by_user_id,
    slug: row.slug,
    name: row.name,
    topic: row.topic,
    purpose: row.purpose,
    kind: row.kind,
    visibility: row.visibility,
    archivedAt: row.archived_at,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface MemberRow {
  id: number;
  room_id: number;
  kind: BuzzMemberKind;
  user_id: number | null;
  persona_slug: string | null;
  display_name: string;
  handle: string;
  accent: string;
  respond_to: BuzzRespondTo;
  model: string | null;
  conversation_id: number | null;
  muted: number;
  joined_at: string;
}

function toMember(row: MemberRow): BuzzMember {
  return {
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    userId: row.user_id,
    personaSlug: row.persona_slug,
    displayName: row.display_name,
    handle: row.handle,
    accent: row.accent,
    respondTo: row.respond_to,
    model: row.model,
    conversationId: row.conversation_id,
    muted: row.muted === 1,
    joinedAt: row.joined_at,
  };
}

interface MessageRow {
  id: number;
  room_id: number;
  client_message_id: string;
  member_id: number | null;
  author_kind: BuzzAuthorKind;
  author_name: string;
  author_handle: string;
  persona_slug: string | null;
  body: string;
  parent_id: number | null;
  status: BuzzMessageStatus;
  run_id: string | null;
  metadata: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  reply_count?: number;
  last_reply_at?: string | null;
}

function toMessage(row: MessageRow): BuzzMessage {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      const parsed: unknown = JSON.parse(row.metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      // A message is still readable without its metadata; losing the sidecar
      // must never take the transcript down with it.
      metadata = null;
    }
  }
  return {
    id: row.id,
    roomId: row.room_id,
    clientMessageId: row.client_message_id,
    memberId: row.member_id,
    authorKind: row.author_kind,
    authorName: row.author_name,
    authorHandle: row.author_handle,
    personaSlug: row.persona_slug,
    body: row.body,
    parentId: row.parent_id,
    status: row.status,
    runId: row.run_id,
    metadata,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.reply_count === undefined
      ? {}
      : { replyCount: row.reply_count, lastReplyAt: row.last_reply_at ?? null }),
  };
}

/* ── rooms ───────────────────────────────────────────────────────────────── */

/** Every room in one organization. */
export function listRooms(
  database: Database.Database,
  organizationId: number,
  options: { includeArchived?: boolean } = {},
): BuzzRoom[] {
  const rows = database
    .prepare(
      `SELECT * FROM buzz_rooms
       WHERE organization_id = ?
         AND (? = 1 OR archived_at IS NULL)
       ORDER BY kind = 'dm', last_activity_at DESC, id DESC`,
    )
    .all(organizationId, options.includeArchived ? 1 : 0) as RoomRow[];
  return rows.map(toRoom);
}

/**
 * A room the reader is allowed to open.
 *
 * Membership of the owning organization is the whole access rule, and it is
 * enforced in the query rather than by the caller — a room in an organization
 * the reader does not belong to is indistinguishable from one that does not
 * exist.
 *
 * A private room narrows that further: it opens only for someone already
 * enrolled in it, so an organization-wide reader cannot walk into a side
 * conversation just by knowing its id.
 */
export function getRoomForUser(
  database: Database.Database,
  userId: number,
  publicId: string,
): BuzzRoom | null {
  const row = database
    .prepare(
      `SELECT r.* FROM buzz_rooms r
       JOIN organization_members om
         ON om.organization_id = r.organization_id AND om.user_id = ?
       WHERE r.public_id = ?
         AND (
           r.visibility = 'public'
           OR EXISTS (
             SELECT 1 FROM buzz_room_members m
             WHERE m.room_id = r.id AND m.user_id = ?
           )
         )`,
    )
    .get(userId, publicId, userId) as RoomRow | undefined;
  return row ? toRoom(row) : null;
}

/** Rooms across every organization the reader belongs to. */
export function listRoomsForUser(
  database: Database.Database,
  userId: number,
  options: { includeArchived?: boolean } = {},
): BuzzRoom[] {
  const rows = database
    .prepare(
      `SELECT r.* FROM buzz_rooms r
       JOIN organization_members om
         ON om.organization_id = r.organization_id AND om.user_id = ?
       WHERE (? = 1 OR r.archived_at IS NULL)
         AND (
           r.visibility = 'public'
           OR EXISTS (
             SELECT 1 FROM buzz_room_members m
             WHERE m.room_id = r.id AND m.user_id = ?
           )
         )
       ORDER BY r.organization_id, r.kind = 'dm', r.last_activity_at DESC, r.id DESC`,
    )
    .all(userId, options.includeArchived ? 1 : 0, userId) as RoomRow[];
  return rows.map(toRoom);
}

export interface CreateRoomInput {
  name: string;
  topic?: string;
  purpose?: string;
  kind?: BuzzRoomKind;
  visibility?: BuzzRoomVisibility;
}

export function createRoom(
  database: Database.Database,
  organizationId: number,
  createdByUserId: number,
  input: CreateRoomInput,
): BuzzRoom {
  const name = input.name.trim().slice(0, 80) || "new-room";
  const slug = uniqueSlug(database, organizationId, canonicalRoomSlug(name));
  const info = database
    .prepare(
      `INSERT INTO buzz_rooms
         (public_id, organization_id, created_by_user_id, slug, name, topic,
          purpose, kind, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      publicRoomId(),
      organizationId,
      createdByUserId,
      slug,
      name,
      (input.topic ?? "").slice(0, 240),
      (input.purpose ?? "").slice(0, 1000),
      input.kind ?? "channel",
      input.visibility ?? "public",
    );
  const row = database
    .prepare("SELECT * FROM buzz_rooms WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as RoomRow;
  const room = toRoom(row);
  ensureBreadMember(database, room.id);
  return room;
}

/**
 * Seat Bread, if it is not seated already.
 *
 * Called from `createRoom` so a new room has it from its first message, and
 * again whenever a room is opened, so the rooms that existed before Bread did
 * gain it too rather than staying permanently agentless. Idempotent by the
 * unique index on `(room_id, persona_slug)`, so two readers opening one room at
 * once cannot seat it twice.
 */
export function ensureBreadMember(
  database: Database.Database,
  roomId: number,
): BuzzMember {
  const existing = listMembers(database, roomId).find(
    (member) => member.personaSlug === BREAD_SLUG,
  );
  if (existing) return existing;
  return addMember(database, roomId, {
    kind: "agent",
    personaSlug: BREAD_SLUG,
    displayName: BREAD_NAME,
    handle: BREAD_HANDLE,
    accent: BREAD_ACCENT,
    // The one agent that speaks unasked. See `bread.ts` for why this is the
    // exception to the room's mention-by-default rule.
    respondTo: "always",
  });
}

export function updateRoom(
  database: Database.Database,
  roomId: number,
  patch: Partial<Pick<BuzzRoom, "name" | "topic" | "purpose" | "visibility">>,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof patch.name === "string") {
    sets.push("name = ?");
    values.push(patch.name.trim().slice(0, 80));
  }
  if (typeof patch.topic === "string") {
    sets.push("topic = ?");
    values.push(patch.topic.slice(0, 240));
  }
  if (typeof patch.purpose === "string") {
    sets.push("purpose = ?");
    values.push(patch.purpose.slice(0, 1000));
  }
  if (patch.visibility === "public" || patch.visibility === "private") {
    sets.push("visibility = ?");
    values.push(patch.visibility);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  database
    .prepare(`UPDATE buzz_rooms SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values, roomId);
}

/** Archiving keeps the transcript; it only takes the room out of the rail. */
export function setRoomArchived(
  database: Database.Database,
  roomId: number,
  archived: boolean,
): void {
  database
    .prepare(
      `UPDATE buzz_rooms
       SET archived_at = ${archived ? "datetime('now')" : "NULL"},
           updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(roomId);
}

export function deleteRoom(database: Database.Database, roomId: number): void {
  database.prepare("DELETE FROM buzz_rooms WHERE id = ?").run(roomId);
}

function touchRoom(database: Database.Database, roomId: number): void {
  database
    .prepare(
      "UPDATE buzz_rooms SET last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    )
    .run(roomId);
}

/* ── members ─────────────────────────────────────────────────────────────── */

export function listMembers(
  database: Database.Database,
  roomId: number,
): BuzzMember[] {
  const rows = database
    .prepare(
      `SELECT * FROM buzz_room_members
       WHERE room_id = ?
       ORDER BY kind = 'agent', joined_at, id`,
    )
    .all(roomId) as MemberRow[];
  return rows.map(toMember);
}

export function getMember(
  database: Database.Database,
  memberId: number,
): BuzzMember | null {
  const row = database
    .prepare("SELECT * FROM buzz_room_members WHERE id = ?")
    .get(memberId) as MemberRow | undefined;
  return row ? toMember(row) : null;
}

export interface AddMemberInput {
  kind: BuzzMemberKind;
  userId?: number | null;
  personaSlug?: string | null;
  displayName: string;
  handle?: string;
  accent?: string;
  respondTo?: BuzzRespondTo;
  model?: string | null;
}

export function addMember(
  database: Database.Database,
  roomId: number,
  input: AddMemberInput,
): BuzzMember {
  const handleBase = canonicalHandle(
    input.handle ?? input.personaSlug ?? input.displayName,
  );
  let handle = handleBase;
  let suffix = 2;
  const taken = database.prepare(
    "SELECT 1 FROM buzz_room_members WHERE room_id = ? AND handle = ?",
  );
  while (taken.get(roomId, handle)) {
    handle = `${handleBase}-${suffix}`;
    suffix += 1;
  }

  const info = database
    .prepare(
      `INSERT INTO buzz_room_members
         (room_id, kind, user_id, persona_slug, display_name, handle, accent, respond_to, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      roomId,
      input.kind,
      input.userId ?? null,
      input.personaSlug ?? null,
      input.displayName.slice(0, 80),
      handle,
      input.accent ?? "#8839ef",
      // A human member is never asked to speak on a schedule; the column still
      // carries a value so the check constraint has something to hold.
      input.kind === "human" ? "never" : (input.respondTo ?? "mention"),
      input.model ?? null,
    );
  const row = database
    .prepare("SELECT * FROM buzz_room_members WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as MemberRow;
  return toMember(row);
}

export function updateMember(
  database: Database.Database,
  memberId: number,
  patch: Partial<Pick<BuzzMember, "respondTo" | "model" | "muted" | "displayName">>,
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (
    patch.respondTo === "always" ||
    patch.respondTo === "mention" ||
    patch.respondTo === "never"
  ) {
    sets.push("respond_to = ?");
    values.push(patch.respondTo);
  }
  if (patch.model !== undefined) {
    sets.push("model = ?");
    values.push(patch.model);
  }
  if (typeof patch.muted === "boolean") {
    sets.push("muted = ?");
    values.push(patch.muted ? 1 : 0);
  }
  if (typeof patch.displayName === "string") {
    sets.push("display_name = ?");
    values.push(patch.displayName.slice(0, 80));
  }
  if (sets.length === 0) return;
  database
    .prepare(`UPDATE buzz_room_members SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values, memberId);
}

export function removeMember(
  database: Database.Database,
  memberId: number,
): void {
  database.prepare("DELETE FROM buzz_room_members WHERE id = ?").run(memberId);
}

/** Bind an agent member to the conversation it thinks in for this room. */
export function setMemberConversation(
  database: Database.Database,
  memberId: number,
  conversationId: number,
): void {
  database
    .prepare("UPDATE buzz_room_members SET conversation_id = ? WHERE id = ?")
    .run(conversationId, memberId);
}

/* ── messages ────────────────────────────────────────────────────────────── */

const SPINE_SELECT = `
  SELECT m.*,
         (SELECT COUNT(*) FROM buzz_room_messages r
           WHERE r.parent_id = m.id AND r.deleted_at IS NULL) AS reply_count,
         (SELECT MAX(r.created_at) FROM buzz_room_messages r
           WHERE r.parent_id = m.id AND r.deleted_at IS NULL) AS last_reply_at
  FROM buzz_room_messages m
`;

/** The channel spine: root messages only, oldest first. */
export function listSpineMessages(
  database: Database.Database,
  roomId: number,
  limit = 200,
): BuzzMessage[] {
  const rows = database
    .prepare(
      `${SPINE_SELECT}
       WHERE m.room_id = ? AND m.parent_id IS NULL
       ORDER BY m.id DESC
       LIMIT ?`,
    )
    .all(roomId, limit) as MessageRow[];
  return rows.reverse().map(toMessage);
}

/** One thread's replies, oldest first. */
export function listThreadMessages(
  database: Database.Database,
  roomId: number,
  parentId: number,
): BuzzMessage[] {
  const rows = database
    .prepare(
      `SELECT * FROM buzz_room_messages
       WHERE room_id = ? AND parent_id = ?
       ORDER BY id`,
    )
    .all(roomId, parentId) as MessageRow[];
  return rows.map(toMessage);
}

export function getMessage(
  database: Database.Database,
  messageId: number,
): BuzzMessage | null {
  const row = database
    .prepare("SELECT * FROM buzz_room_messages WHERE id = ?")
    .get(messageId) as MessageRow | undefined;
  return row ? toMessage(row) : null;
}

export interface PostMessageInput {
  clientMessageId: string;
  memberId: number | null;
  authorKind: BuzzAuthorKind;
  authorName: string;
  authorHandle?: string;
  personaSlug?: string | null;
  body: string;
  parentId?: number | null;
  status?: BuzzMessageStatus;
  runId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function postMessage(
  database: Database.Database,
  roomId: number,
  input: PostMessageInput,
): BuzzMessage {
  // Re-posting the same client id is a retry, not a second message: the
  // composer generates the id before the request leaves the browser, so a
  // dropped response must not duplicate the line.
  const existing = database
    .prepare(
      "SELECT * FROM buzz_room_messages WHERE room_id = ? AND client_message_id = ?",
    )
    .get(roomId, input.clientMessageId) as MessageRow | undefined;
  if (existing) return toMessage(existing);

  const info = database
    .prepare(
      `INSERT INTO buzz_room_messages
         (room_id, client_message_id, member_id, author_kind, author_name,
          author_handle, persona_slug, body, parent_id, status, run_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      roomId,
      input.clientMessageId,
      input.memberId,
      input.authorKind,
      input.authorName.slice(0, 80),
      input.authorHandle ?? "",
      input.personaSlug ?? null,
      input.body,
      input.parentId ?? null,
      input.status ?? "complete",
      input.runId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    );
  touchRoom(database, roomId);
  const row = database
    .prepare("SELECT * FROM buzz_room_messages WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as MessageRow;
  return toMessage(row);
}

/** Replace a streaming reply's body as it arrives. */
export function updateMessageBody(
  database: Database.Database,
  messageId: number,
  body: string,
  status: BuzzMessageStatus,
  metadata?: Record<string, unknown> | null,
): void {
  database
    .prepare(
      `UPDATE buzz_room_messages
       SET body = ?, status = ?,
           metadata = COALESCE(?, metadata),
           updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(body, status, metadata ? JSON.stringify(metadata) : null, messageId);
}

export function editMessage(
  database: Database.Database,
  messageId: number,
  body: string,
): void {
  database
    .prepare(
      `UPDATE buzz_room_messages
       SET body = ?, edited_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(body, messageId);
}

/**
 * Deleting keeps the row. A thread hangs off its root, and a hard delete would
 * take the replies with it — so the body is cleared and the line is marked
 * instead, exactly as upstream does.
 */
export function softDeleteMessage(
  database: Database.Database,
  messageId: number,
): void {
  database
    .prepare(
      `UPDATE buzz_room_messages
       SET body = '', deleted_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(messageId);
}

/** Any reply still being written, so a reload can re-attach to it. */
export function listLiveMessages(
  database: Database.Database,
  roomId: number,
): BuzzMessage[] {
  const rows = database
    .prepare(
      `SELECT * FROM buzz_room_messages
       WHERE room_id = ? AND status IN ('pending','streaming')
       ORDER BY id`,
    )
    .all(roomId) as MessageRow[];
  return rows.map(toMessage);
}

/* ── reactions ───────────────────────────────────────────────────────────── */

export function toggleReaction(
  database: Database.Database,
  messageId: number,
  memberId: number,
  emoji: string,
): void {
  const existing = database
    .prepare(
      "SELECT 1 FROM buzz_room_reactions WHERE message_id = ? AND member_id = ? AND emoji = ?",
    )
    .get(messageId, memberId, emoji);
  if (existing) {
    database
      .prepare(
        "DELETE FROM buzz_room_reactions WHERE message_id = ? AND member_id = ? AND emoji = ?",
      )
      .run(messageId, memberId, emoji);
    return;
  }
  database
    .prepare(
      "INSERT INTO buzz_room_reactions (message_id, member_id, emoji) VALUES (?, ?, ?)",
    )
    .run(messageId, memberId, emoji);
}

export function reactionsForRoom(
  database: Database.Database,
  roomId: number,
  viewerMemberId: number | null,
): Map<number, BuzzReaction[]> {
  const rows = database
    .prepare(
      `SELECT x.message_id, x.emoji, COUNT(*) AS count,
              MAX(CASE WHEN x.member_id = ? THEN 1 ELSE 0 END) AS mine
       FROM buzz_room_reactions x
       JOIN buzz_room_messages m ON m.id = x.message_id
       WHERE m.room_id = ?
       GROUP BY x.message_id, x.emoji
       ORDER BY count DESC, x.emoji`,
    )
    .all(viewerMemberId ?? -1, roomId) as Array<{
    message_id: number;
    emoji: string;
    count: number;
    mine: number;
  }>;

  const byMessage = new Map<number, BuzzReaction[]>();
  for (const row of rows) {
    const list = byMessage.get(row.message_id) ?? [];
    list.push({ emoji: row.emoji, count: row.count, mine: row.mine === 1 });
    byMessage.set(row.message_id, list);
  }
  return byMessage;
}

/* ── read state ──────────────────────────────────────────────────────────── */

export function markRoomRead(
  database: Database.Database,
  roomId: number,
  userId: number,
  lastReadMessageId: number,
): void {
  database
    .prepare(
      `INSERT INTO buzz_room_reads (room_id, user_id, last_read_message_id, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(room_id, user_id) DO UPDATE SET
         -- Never move the marker backwards: opening an older thread must not
         -- resurrect unread badges the reader has already cleared.
         last_read_message_id = MAX(excluded.last_read_message_id, last_read_message_id),
         updated_at = excluded.updated_at`,
    )
    .run(roomId, userId, lastReadMessageId);
}

/**
 * Unread counts per room, for the sidebar badges.
 *
 * Unread means "posted by someone other than me". In a room with several
 * people another person's message is exactly as unread as an agent's, so the
 * reader's own lines are excluded by member identity rather than by author
 * kind — which is what makes the count right for a shared room.
 */
export function unreadCounts(
  database: Database.Database,
  userId: number,
): Map<number, number> {
  const rows = database
    .prepare(
      `SELECT m.room_id, COUNT(*) AS unread
       FROM buzz_room_messages m
       JOIN buzz_rooms r ON r.id = m.room_id
       JOIN organization_members om
         ON om.organization_id = r.organization_id AND om.user_id = ?
       LEFT JOIN buzz_room_members author ON author.id = m.member_id
       LEFT JOIN buzz_room_reads rd
         ON rd.room_id = m.room_id AND rd.user_id = ?
       WHERE m.deleted_at IS NULL
         AND COALESCE(author.user_id, -1) <> ?
         AND m.id > COALESCE(rd.last_read_message_id, 0)
       GROUP BY m.room_id`,
    )
    .all(userId, userId, userId) as Array<{ room_id: number; unread: number }>;
  return new Map(rows.map((row) => [row.room_id, row.unread]));
}

/* ── search and inbox ────────────────────────────────────────────────────── */

/**
 * A message with enough of its room attached to be shown outside it.
 *
 * Search results and inbox items are read across every room at once, so a hit
 * has to say where it came from — the caller has no room in hand to look it up
 * in, and jumping to a hit means opening its room first.
 */
export interface BuzzMessageHit {
  message: BuzzMessage;
  roomPublicId: string;
  roomName: string;
  roomSlug: string;
  roomKind: BuzzRoomKind;
  organizationId: number;
  /** True when the body names the reader by handle. */
  mentionsYou: boolean;
}

/**
 * The access rule from `listRoomsForUser`, as a fragment.
 *
 * Search and the inbox read messages rather than rooms, but they must not
 * widen who can see what by one row: both join through this so a private room
 * the reader is not enrolled in stays as invisible to a search as it is to the
 * sidebar.
 */
const VISIBLE_ROOM_JOIN = `
  JOIN buzz_rooms r ON r.id = m.room_id
  JOIN organization_members om
    ON om.organization_id = r.organization_id AND om.user_id = @userId
  AND (
    r.visibility = 'public'
    OR EXISTS (
      SELECT 1 FROM buzz_room_members rm
      WHERE rm.room_id = r.id AND rm.user_id = @userId
    )
  )
`;

interface HitRow extends MessageRow {
  room_public_id: string;
  room_name: string;
  room_slug: string;
  room_kind: BuzzRoomKind;
  organization_id: number;
}

function toHit(row: HitRow, handles: ReadonlySet<string>): BuzzMessageHit {
  return {
    message: toMessage(row),
    roomPublicId: row.room_public_id,
    roomName: row.room_name,
    roomSlug: row.room_slug,
    roomKind: row.room_kind,
    organizationId: row.organization_id,
    mentionsYou: mentionsAnyHandle(row.body, handles),
  };
}

/** Whether a body names one of these handles — `@ada`, not `ada@example.com`. */
function mentionsAnyHandle(body: string, handles: ReadonlySet<string>): boolean {
  if (handles.size === 0) return false;
  const pattern = /(^|[^\w@.])@([a-z0-9][a-z0-9-]{0,39})/gi;
  let match = pattern.exec(body);
  while (match) {
    if (handles.has(match[2].toLowerCase())) return true;
    match = pattern.exec(body);
  }
  return false;
}

/** Every handle the reader posts under, across their rooms. */
export function handlesForUser(
  database: Database.Database,
  userId: number,
): Set<string> {
  const rows = database
    .prepare("SELECT DISTINCT handle FROM buzz_room_members WHERE user_id = ?")
    .all(userId) as Array<{ handle: string }>;
  return new Set(rows.map((row) => row.handle.toLowerCase()));
}

/**
 * Messages matching a query, newest first, across every room the reader can
 * open.
 *
 * A substring match rather than FTS: rooms hold thousands of messages, not
 * millions, and an index Buzz would have to keep in step with edits, deletes
 * and half-written agent answers is a second source of truth for the one thing
 * that must never disagree with the transcript.
 */
export function searchMessages(
  database: Database.Database,
  userId: number,
  query: string,
  limit = 40,
): BuzzMessageHit[] {
  const needle = query.trim();
  if (needle === "") return [];
  const handles = handlesForUser(database, userId);
  const rows = database
    .prepare(
      `SELECT m.*, r.public_id AS room_public_id, r.name AS room_name,
              r.slug AS room_slug, r.kind AS room_kind,
              r.organization_id AS organization_id
       FROM buzz_room_messages m
       ${VISIBLE_ROOM_JOIN}
       WHERE m.deleted_at IS NULL
         AND m.body <> ''
         AND m.body LIKE @needle ESCAPE '\\'
       ORDER BY m.id DESC
       LIMIT @limit`,
    )
    .all({
      userId,
      // The wildcards are ours; anything the reader typed is a literal.
      needle: `%${needle.replace(/[\\%_]/g, (character) => `\\${character}`)}%`,
      limit,
    }) as HitRow[];
  return rows.map((row) => toHit(row, handles));
}

/**
 * What is waiting for the reader: every message posted since they last read
 * its room, newest first.
 *
 * The same "not mine" rule the badges use, so the inbox and the unread counts
 * can never tell two different stories about the same room.
 */
export function listUnreadMessages(
  database: Database.Database,
  userId: number,
  limit = 60,
): BuzzMessageHit[] {
  const handles = handlesForUser(database, userId);
  const rows = database
    .prepare(
      `SELECT m.*, r.public_id AS room_public_id, r.name AS room_name,
              r.slug AS room_slug, r.kind AS room_kind,
              r.organization_id AS organization_id
       FROM buzz_room_messages m
       ${VISIBLE_ROOM_JOIN}
       LEFT JOIN buzz_room_members author ON author.id = m.member_id
       LEFT JOIN buzz_room_reads rd
         ON rd.room_id = m.room_id AND rd.user_id = @userId
       WHERE m.deleted_at IS NULL
         AND m.parent_id IS NULL
         AND COALESCE(author.user_id, -1) <> @userId
         AND m.id > COALESCE(rd.last_read_message_id, 0)
       ORDER BY m.id DESC
       LIMIT @limit`,
    )
    .all({ userId, limit }) as HitRow[];
  return rows.map((row) => toHit(row, handles));
}

/** Every agent seat the reader shares a room with, newest room first. */
export interface BuzzAgentSeat {
  member: BuzzMember;
  roomPublicId: string;
  roomName: string;
  roomSlug: string;
  organizationId: number;
}

export function listAgentSeats(
  database: Database.Database,
  userId: number,
): BuzzAgentSeat[] {
  const rows = database
    .prepare(
      `SELECT m.*, r.public_id AS room_public_id, r.name AS room_name,
              r.slug AS room_slug, r.organization_id AS organization_id
       FROM buzz_room_members m
       JOIN buzz_rooms r ON r.id = m.room_id
       JOIN organization_members om
         ON om.organization_id = r.organization_id AND om.user_id = ?
       WHERE m.kind = 'agent'
         AND r.archived_at IS NULL
         AND (
           r.visibility = 'public'
           OR EXISTS (
             SELECT 1 FROM buzz_room_members rm
             WHERE rm.room_id = r.id AND rm.user_id = ?
           )
         )
       ORDER BY r.last_activity_at DESC, r.id DESC, m.display_name`,
    )
    .all(userId, userId) as Array<
    MemberRow & {
      room_public_id: string;
      room_name: string;
      room_slug: string;
      organization_id: number;
    }
  >;
  return rows.map((row) => ({
    member: toMember(row),
    roomPublicId: row.room_public_id,
    roomName: row.room_name,
    roomSlug: row.room_slug,
    organizationId: row.organization_id,
  }));
}

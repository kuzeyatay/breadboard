// Organization messaging over the encrypted store.
//
// The Organization page keeps its own rooms and transcript on this machine.
// This bridge makes an encrypted Crumbs organization appear there as a
// community: its rooms become local rooms, what is written locally is
// encrypted and sent to the organization store, and what other members wrote
// is fetched, decrypted here, and added to the local transcript. The page
// itself is unchanged; the store only ever relays ciphertext.
//
// New messages and new rooms travel both ways, and so do edits, deletions and
// reactions: each is its own small encrypted event in the room's channel,
// applied on arrival only when its sender may make that change. Every event is
// idempotent, so relaying one twice changes nothing.
//
// An organization made on the Organization page is put on Crumbs by itself
// once its owner is signed in, so members on other machines can be added.
import type Database from "better-sqlite3";
import { addMember, createRoom, editMessage, listMembers, postMessage, softDeleteMessage } from "../buzz/store.ts";
import { CrumbsError, type ChatCrumb, type ChatEvent, type ChatFile, type Crumbs, type OrgSignal } from "./core.ts";
import { ensureCrumbsSchema, getAccount } from "./store.ts";
import { annotationRootMessage, ensureBrowserAnnotationsSchema } from "../browser-annotations-store.ts";
import { shortHandle } from "./handle.ts";

const initialized = new WeakSet<Database.Database>();
function ensureBridgeSchema(db: Database.Database) {
  if (initialized.has(db)) return;
  const firstDetached = !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='crumbs_buzz_detached'").get();
  db.exec(`
    CREATE TABLE IF NOT EXISTS crumbs_buzz_orgs (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, org_id TEXT NOT NULL,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, PRIMARY KEY(user_id, org_id)
    );
    CREATE TABLE IF NOT EXISTS crumbs_buzz_rooms (
      room_id INTEGER PRIMARY KEY REFERENCES buzz_rooms(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL, channel TEXT NOT NULL, pulled_at TEXT NOT NULL DEFAULT '', pushed_id INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS crumbs_buzz_messages (
      remote_id TEXT PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES buzz_rooms(id) ON DELETE CASCADE, message_id INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crumbs_buzz_messages_local ON crumbs_buzz_messages(room_id, message_id);
    CREATE TABLE IF NOT EXISTS crumbs_buzz_people (
      room_id INTEGER NOT NULL REFERENCES buzz_rooms(id) ON DELETE CASCADE, did TEXT NOT NULL, member_id INTEGER NOT NULL, avatar TEXT, PRIMARY KEY(room_id, did)
    );
    -- Edits, deletions and reactions made here, waiting to be relayed by the next sync of their room.
    CREATE TABLE IF NOT EXISTS crumbs_buzz_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES buzz_rooms(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('edit','delete','react')), emoji TEXT, on_flag INTEGER NOT NULL DEFAULT 1
    );
    -- Organizations that were linked once and then dropped (left, deleted, servers moved). They are not put back
    -- on Crumbs by themselves: a twin of someone else's organization must never be republished as a new one.
    -- Where each file shared from here went, so a file sent twice is uploaded once.
    CREATE TABLE IF NOT EXISTS crumbs_buzz_files (
      user_id INTEGER NOT NULL, blob_id TEXT NOT NULL, drive TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(user_id, blob_id)
    );
    -- Files other members shared that have not been fetched yet, tried again on each sync of their room.
    CREATE TABLE IF NOT EXISTS crumbs_buzz_pending_files (
      message_id INTEGER NOT NULL REFERENCES buzz_room_messages(id) ON DELETE CASCADE, position INTEGER NOT NULL,
      room_id INTEGER NOT NULL, ref TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(message_id, position)
    );
    CREATE TABLE IF NOT EXISTS crumbs_buzz_detached (
      organization_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE
    );
  `);
  // Who sent each relayed message, so an edit or deletion is applied only when it comes from them.
  if (!(db.prepare("PRAGMA table_info(crumbs_buzz_messages)").all() as Array<{ name: string }>).some(column => column.name === "sender")) {
    db.exec("ALTER TABLE crumbs_buzz_messages ADD COLUMN sender TEXT");
  }
  // The text an agent answer was last relayed with, so a regenerated answer is sent again as an edit.
  // Answers relayed before this column existed start from how they read now.
  if (!(db.prepare("PRAGMA table_info(crumbs_buzz_messages)").all() as Array<{ name: string }>).some(column => column.name === "pushed_body")) {
    db.exec(`ALTER TABLE crumbs_buzz_messages ADD COLUMN pushed_body TEXT;
      UPDATE crumbs_buzz_messages SET pushed_body=(SELECT m.body FROM buzz_room_messages m WHERE m.id=message_id)
        WHERE message_id IN (SELECT id FROM buzz_room_messages WHERE author_kind='agent')`);
  }
  // Links dropped before this table existed left no mark. An unlinked organization whose rooms hold relayed
  // messages was linked once, so it is treated as dropped rather than as one made here.
  if (firstDetached) db.exec(`INSERT OR IGNORE INTO crumbs_buzz_detached(organization_id)
    SELECT DISTINCT r.organization_id FROM buzz_rooms r JOIN buzz_room_messages m ON m.room_id=r.id
    WHERE m.client_message_id LIKE 'crumbs:%' AND r.organization_id NOT IN (SELECT organization_id FROM crumbs_buzz_orgs)`);
  // The organization's picture, synced from its admins' settings record (see organizations/schema.ts).
  const organizationColumns = db.prepare("PRAGMA table_info(organizations)").all() as Array<{ name: string }>;
  if (organizationColumns.length && !organizationColumns.some(column => column.name === "image")) db.exec("ALTER TABLE organizations ADD COLUMN image TEXT");
  initialized.add(db);
}

/** A message worth sending: words, or files with none. */
const HAS_CONTENT = "(m.body<>'' OR m.metadata LIKE '%\"attachments\"%')";

/**
 * How shared files leave and arrive. Supplied by the server: files leave this
 * machine encrypted, through the sender's Google Drive, and arrive in the
 * reader's own file store. Without it, messages relay and their files stay here.
 */
export interface BridgeFiles {
  /** Encrypt and upload one stored file; answers where it went and the key. */
  upload(userId: number, file: { blobId: string; name: string }): Promise<ChatFile>;
  /** Fetch, decrypt and store a file another member shared; answers the local copy. */
  receive(userId: number, file: ChatFile): Promise<{ blobId: string; format: string; sizeBytes: number }>;
  /** Whether a failure should be tried again later, or the file given up on. */
  retryable(error: unknown): boolean;
}
type FileAttachment = { type: "file"; name: string; sizeBytes?: number; blobId?: string; format?: string; unavailable?: string };

export type BridgeChange = { kind: "edit" } | { kind: "delete" } | { kind: "react"; emoji: string; on: boolean };

/**
 * The Crumbs account that sent a relayed message. Rows linked before the sender
 * was recorded fall back to what the message carries: one that arrived from the
 * store names its sender in its metadata, and one without that was written here.
 */
function senderOf(row: { sender: string | null; metadata: string | null }, me: string): string {
  if (row.sender) return row.sender;
  try {
    const crumbs = row.metadata ? (JSON.parse(row.metadata) as { crumbs?: { did?: unknown } }).crumbs : undefined;
    if (typeof crumbs?.did === "string") return crumbs.did;
  } catch { /* written here */ }
  return me;
}

interface RoomLink { room_id: number; user_id: number; org_id: string; channel: string; pulled_at: string; pushed_id: number }
interface LocalMessage { id: number; member_id: number | null; author_kind: string; author_name: string; author_handle: string; body: string; parent_id: number | null; metadata: string | null; target_json: string | null }

export function createBuzzBridge({ db, crumbs, files }: { db: Database.Database; crumbs: Crumbs; files?: BridgeFiles }) {
  ensureCrumbsSchema(db);
  ensureBridgeSchema(db);
  ensureBrowserAnnotationsSchema(db);
  const busy = new Map<string, Promise<void>>();
  /** One run at a time per key; callers that arrive meanwhile share it. */
  function once(key: string, work: () => Promise<void>): Promise<void> {
    let running = busy.get(key);
    if (!running) { running = work().finally(() => busy.delete(key)); busy.set(key, running); }
    return running;
  }
  const linkOf = (roomId: number) => db.prepare("SELECT * FROM crumbs_buzz_rooms WHERE room_id=?").get(roomId) as RoomLink | undefined;

  /** Put one Breadboard organization on Crumbs as an encrypted twin. Its rooms are linked by the sync that follows. */
  async function linkOrganization(userId: number, local: { id: number; name: string }) {
    const created = await crumbs.createOrg(userId, local.name);
    db.transaction(() => {
      db.prepare("INSERT INTO crumbs_buzz_orgs(user_id, org_id, organization_id) VALUES(?,?,?)").run(userId, created.id, local.id);
      db.prepare("DELETE FROM crumbs_buzz_detached WHERE organization_id=?").run(local.id);
    })();
  }
  /** When a failed automatic connection may be tried again; the store allows a few new organizations an hour. */
  const retryAt = new Map<string, number>();

  /** Make every encrypted organization, and every room in it, exist on the Organization page. */
  function syncOrganizations(userId: number): Promise<void> {
    return once(`orgs:${userId}`, async () => {
      if (!crumbs.status(userId).signedIn) return;
      // Organizations made here go on Crumbs by themselves, so people on other machines can be added to them.
      for (const local of localOrganizations(userId, { automatic: true })) {
        const key = `${userId}:${local.id}`;
        if ((retryAt.get(key) ?? 0) > Date.now()) continue;
        try { await linkOrganization(userId, local); retryAt.delete(key); }
        catch { retryAt.set(key, Date.now() + 10 * 60_000); }
      }
      const orgs = await crumbs.listOrgs(userId);
      // A link to an organization the store no longer lists (you left, it was deleted, or Breadboard moved to
      // other servers) is dropped. The Breadboard organization and its rooms stay, and it can be connected again
      // by hand; it is not reconnected by itself, or leaving someone else's organization would republish it.
      const current = new Set(orgs.map(org => org.id));
      for (const { org_id: gone, organization_id: organizationId } of db.prepare("SELECT org_id, organization_id FROM crumbs_buzz_orgs WHERE user_id=?").all(userId) as Array<{ org_id: string; organization_id: number }>) {
        if (current.has(gone)) continue;
        db.transaction(() => {
          db.prepare("DELETE FROM crumbs_buzz_outbox WHERE room_id IN (SELECT room_id FROM crumbs_buzz_rooms WHERE user_id=? AND org_id=?)").run(userId, gone);
          db.prepare("DELETE FROM crumbs_buzz_messages WHERE room_id IN (SELECT room_id FROM crumbs_buzz_rooms WHERE user_id=? AND org_id=?)").run(userId, gone);
          db.prepare("DELETE FROM crumbs_buzz_rooms WHERE user_id=? AND org_id=?").run(userId, gone);
          db.prepare("DELETE FROM crumbs_buzz_orgs WHERE user_id=? AND org_id=?").run(userId, gone);
          db.prepare("INSERT INTO crumbs_buzz_detached(organization_id) VALUES(?) ON CONFLICT DO NOTHING").run(organizationId);
        })();
      }
      for (const org of orgs) {
        if (!org.ready) continue;
        let mapped = db.prepare("SELECT o.id, o.name FROM crumbs_buzz_orgs m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? AND m.org_id=?").get(userId, org.id) as { id: number; name: string } | undefined;
        if (!mapped) {
          const id = db.transaction(() => {
            const created = Number(db.prepare("INSERT INTO organizations(name, created_by_user_id) VALUES(?, ?)").run(org.name.slice(0, 80), userId).lastInsertRowid);
            // The local twin is this machine's copy; who runs the organization is decided on Crumbs, not by this role.
            db.prepare("INSERT INTO organization_members(organization_id, user_id, role) VALUES(?, ?, 'owner')").run(created, userId);
            db.prepare("INSERT INTO crumbs_buzz_orgs(user_id, org_id, organization_id) VALUES(?,?,?) ON CONFLICT(user_id, org_id) DO UPDATE SET organization_id=excluded.organization_id").run(userId, org.id, created);
            return created;
          })();
          mapped = { id, name: org.name };
        }
        // The name and picture an admin set in the organization's settings win over the name it was created with.
        const profile = await crumbs.readOrgProfile(userId, org.id).catch(() => null);
        const name = (profile?.name ?? org.name).slice(0, 80);
        if (mapped.name !== name) db.prepare("UPDATE organizations SET name=? WHERE id=?").run(name, mapped.id);
        if (profile) db.prepare("UPDATE organizations SET image=? WHERE id=? AND image IS NOT ?").run(profile.image, mapped.id, profile.image);

        const remote = await crumbs.listRooms(userId, org.id);
        const links = db.prepare("SELECT * FROM crumbs_buzz_rooms WHERE user_id=? AND org_id=?").all(userId, org.id) as RoomLink[];
        for (const room of remote) {
          if (links.some(link => link.channel === room.id)) continue;
          // A room this machine already has under that name is the same room, not a second one.
          const same = db.prepare("SELECT id FROM buzz_rooms WHERE organization_id=? AND archived_at IS NULL AND lower(name)=lower(?) AND id NOT IN (SELECT room_id FROM crumbs_buzz_rooms)").get(mapped.id, room.name) as { id: number } | undefined;
          const local = same ?? createRoom(db, mapped.id, userId, { name: room.name, visibility: "public" });
          db.prepare("INSERT INTO crumbs_buzz_rooms(room_id, user_id, org_id, channel) VALUES(?,?,?,?)").run(local.id, userId, org.id, room.id);
        }
        // A room made on the Organization page inside this community is announced to the other members.
        const unlinked = db.prepare("SELECT id, name FROM buzz_rooms WHERE organization_id=? AND archived_at IS NULL AND id NOT IN (SELECT room_id FROM crumbs_buzz_rooms)").all(mapped.id) as Array<{ id: number; name: string }>;
        for (const local of unlinked) {
          const known = new Set((await crumbs.listRooms(userId, org.id)).map(room => room.id));
          const created = (await crumbs.createRoom(userId, org.id, local.name)).find(room => !known.has(room.id));
          if (created) db.prepare("INSERT INTO crumbs_buzz_rooms(room_id, user_id, org_id, channel) VALUES(?,?,?,?)").run(local.id, userId, org.id, created.id);
        }
      }
    });
  }

  /** Send what was written here, then fetch what others wrote. Rooms that are not linked are left alone. */
  function syncRoom(userId: number, roomId: number): Promise<void> {
    const link = linkOf(roomId);
    if (!link || link.user_id !== userId) return Promise.resolve();
    return once(`room:${roomId}`, async () => {
      const me = getAccount(db, userId);
      if (!me || me.needsSignIn) return;
      const remoteOf = db.prepare("SELECT remote_id FROM crumbs_buzz_messages WHERE room_id=? AND message_id=?");
      const localOf = db.prepare("SELECT message_id FROM crumbs_buzz_messages WHERE remote_id=?");
      const record = db.prepare("INSERT INTO crumbs_buzz_messages(remote_id, room_id, message_id, sender) VALUES(?,?,?,?) ON CONFLICT(remote_id) DO NOTHING");

      // Outbound: finished messages from people and agents that did not come from the store.
      const outgoing = db.prepare(`SELECT m.id, m.member_id, m.author_kind, m.author_name, m.author_handle, m.body, m.parent_id, m.metadata,
          (SELECT t.target_json FROM browser_annotation_threads t WHERE t.root_message_id=m.parent_id) AS target_json FROM buzz_room_messages m
        WHERE m.room_id=? AND m.id>? AND m.deleted_at IS NULL AND m.status='complete' AND m.author_kind IN ('human','agent') AND ${HAS_CONTENT}
          AND m.id NOT IN (SELECT message_id FROM crumbs_buzz_messages WHERE room_id=?) ORDER BY m.id LIMIT 100`).all(roomId, link.pushed_id, roomId) as LocalMessage[];
      for (const message of outgoing) {
        const mine = message.author_kind === "human";
        const parent = message.parent_id ? (remoteOf.get(roomId, message.parent_id) as { remote_id: string } | undefined)?.remote_id : undefined;
        // A crumb's root post is made on each machine, so the passage travels with every comment on it.
        let crumb: ChatCrumb | undefined;
        if (message.target_json) {
          let meta: Record<string, unknown> = {};
          try { meta = message.metadata ? JSON.parse(message.metadata) as Record<string, unknown> : {}; } catch { /* a plain reply */ }
          crumb = { target: JSON.parse(message.target_json) as ChatCrumb["target"], body: typeof meta.annotationBody === "string" ? meta.annotationBody : message.body, source: typeof meta.annotationSource === "string" ? meta.annotationSource : null };
        }
        // Files go up to the sender's Google Drive first. One that cannot go up yet holds this message and the
        // ones after it for the next sync, so the room keeps its order.
        const shared = await outgoingFiles(userId, message.metadata);
        if (shared === null) break;
        if (!message.body.trim() && !shared.length) { db.prepare("UPDATE crumbs_buzz_rooms SET pushed_id=? WHERE room_id=?").run(message.id, roomId); continue; }
        const sent = await crumbs.sendChat(userId, link.org_id, link.channel, message.body.slice(0, 12000), {
          ...(mine ? {} : { agent: true, author: { handle: null, displayName: message.author_name, avatar: null } }), ...(parent ? { parent } : {}), ...(crumb ? { crumb } : {}), ...(shared.length ? { files: shared } : {}) });
        record.run(sent.id, roomId, message.id, me.did);
        if (!mine) db.prepare("UPDATE crumbs_buzz_messages SET pushed_body=? WHERE remote_id=?").run(message.body, sent.id);
        db.prepare("UPDATE crumbs_buzz_rooms SET pushed_id=? WHERE room_id=?").run(message.id, roomId);
      }

      // Agent answers run here and then regenerated: the same message now reads differently, so the new
      // answer goes out as an edit of the one members already have. Only once it has finished.
      const regenerated = db.prepare(`SELECT x.remote_id, m.body FROM crumbs_buzz_messages x JOIN buzz_room_messages m ON m.id=x.message_id
        WHERE x.room_id=? AND x.sender=? AND x.pushed_body IS NOT NULL AND m.author_kind='agent' AND m.status='complete'
          AND m.deleted_at IS NULL AND m.body<>'' AND m.body<>x.pushed_body LIMIT 50`).all(roomId, me.did) as Array<{ remote_id: string; body: string }>;
      for (const answer of regenerated) {
        await crumbs.sendChatEvent(userId, link.org_id, link.channel, { kind: "edit", target: answer.remote_id, body: answer.body.slice(0, 12000) });
        db.prepare("UPDATE crumbs_buzz_messages SET pushed_body=? WHERE remote_id=?").run(answer.body, answer.remote_id);
      }

      // Outbound changes. One whose message never left this machine is dropped: a deleted message is never
      // sent, and an edited one is sent as it now reads.
      const pending = db.prepare("SELECT * FROM crumbs_buzz_outbox WHERE room_id=? ORDER BY id").all(roomId) as Array<{ id: number; message_id: number; kind: BridgeChange["kind"]; emoji: string | null; on_flag: number }>;
      for (const change of pending) {
        const target = (remoteOf.get(roomId, change.message_id) as { remote_id: string } | undefined)?.remote_id;
        const local = db.prepare("SELECT body, deleted_at FROM buzz_room_messages WHERE id=?").get(change.message_id) as { body: string; deleted_at: string | null } | undefined;
        if (target && local) {
          if (change.kind === "edit" && !local.deleted_at && local.body.trim()) await crumbs.sendChatEvent(userId, link.org_id, link.channel, { kind: "edit", target, body: local.body.slice(0, 12000) });
          if (change.kind === "delete") {
            await crumbs.sendChatEvent(userId, link.org_id, link.channel, { kind: "delete", target });
            // The original goes from the store too, so members who join later never receive it.
            await crumbs.deleteChat(userId, link.org_id, target).catch(() => {});
          }
          if (change.kind === "react" && change.emoji) await crumbs.sendChatEvent(userId, link.org_id, link.channel, { kind: "react", target, emoji: change.emoji, on: Boolean(change.on_flag) });
        }
        db.prepare("DELETE FROM crumbs_buzz_outbox WHERE id=?").run(change.id);
      }

      // Inbound: decrypted on this machine, then added to the local transcript.
      await retryPendingFiles(userId, roomId);
      const { messages, events } = await crumbs.readChat(userId, link.org_id, link.channel, link.pulled_at || null);
      const members = listMembers(db, roomId);
      const room = { id: roomId, publicId: (db.prepare("SELECT public_id FROM buzz_rooms WHERE id=?").get(roomId) as { public_id: string }).public_id };
      /** This room's seat for a Crumbs account: yours, or a member on another machine (seated on first sight). */
      const seatOf = (did: string, name: string, handle: string | null, avatar: string | null): number => {
        if (did === me.did) return (members.find(member => member.userId === userId) ?? addMember(db, roomId, { kind: "human", userId, displayName: me.displayName || shortHandle(me.handle) || "You", handle: me.handle?.split(".")[0] })).id;
        const known = db.prepare("SELECT member_id FROM crumbs_buzz_people WHERE room_id=? AND did=?").get(roomId, did) as { member_id: number } | undefined;
        const memberId = known?.member_id ?? addMember(db, roomId, { kind: "human", userId: null, displayName: name, handle: handle?.split(".")[0] ?? name }).id;
        db.prepare("INSERT INTO crumbs_buzz_people(room_id, did, member_id, avatar) VALUES(?,?,?,?) ON CONFLICT(room_id, did) DO UPDATE SET avatar=COALESCE(excluded.avatar, avatar)").run(roomId, did, memberId, avatar);
        return memberId;
      };
      for (const message of messages) {
        if (!localOf.get(message.id)) {
          const memberId = message.agent ? null : seatOf(message.did, message.author, message.handle, message.avatar);
          const parent = message.crumb ? annotationRootMessage(db, room, message.crumb.target)
            : message.parent ? (localOf.get(message.parent) as { message_id: number } | undefined)?.message_id ?? null : null;
          const local = postMessage(db, roomId, { clientMessageId: `crumbs:${message.id}`, memberId, authorKind: message.agent ? "agent" : "human", authorName: message.author, authorHandle: message.handle ?? "",
            body: message.body, parentId: parent, metadata: { crumbs: { did: message.did, avatar: message.avatar, ...(message.unverified ? { unverified: true } : {}) },
              ...(message.crumb ? { annotationBody: message.crumb.body, annotationSource: message.crumb.source } : {}),
              // Shown by name at once; each fills in when its bytes have been fetched and decrypted.
              ...(message.files ? { attachments: message.files.map(file => ({ type: "file", name: file.name, sizeBytes: file.size })) } : {}) } });
          record.run(message.id, roomId, local.id, message.did);
          if (message.files) await receiveFiles(userId, roomId, local.id, message.files);
        }
        db.prepare("UPDATE crumbs_buzz_rooms SET pulled_at=? WHERE room_id=? AND pulled_at<?").run(message.createdAt, roomId, message.createdAt);
      }

      // Inbound changes, in the order they were made.
      let admins: Set<string> | null = null;
      const isAdmin = async (did: string) => (admins ??= new Set((await crumbs.orgDetail(userId, link.org_id).catch(() => null))?.members.filter(member => member.role === "admin").map(member => member.did) ?? [])).has(did);
      for (const event of events) {
        applyEvent: {
          const target = db.prepare("SELECT x.message_id, x.sender, m.deleted_at, m.metadata, m.author_kind FROM crumbs_buzz_messages x JOIN buzz_room_messages m ON m.id=x.message_id WHERE x.remote_id=? AND x.room_id=?")
            .get(event.target, roomId) as { message_id: number; sender: string | null; deleted_at: string | null; metadata: string | null; author_kind: string } | undefined;
          if (!target || target.deleted_at) break applyEvent;
          const author = senderOf(target, me.did);
          if (event.kind === "edit") {
            if (event.did !== author) break applyEvent;
            if (target.author_kind === "human") editMessage(db, target.message_id, event.body);
            // A regenerated answer reads as it does on the machine that ran it: replaced, not marked edited.
            else if (target.author_kind === "agent") db.prepare("UPDATE buzz_room_messages SET body=?, updated_at=datetime('now') WHERE id=?").run(event.body, target.message_id);
          }
          else if (event.kind === "delete") { if (event.did === author || await isAdmin(event.did)) softDeleteMessage(db, target.message_id); }
          else applyReaction(target.message_id, seatOf(event.did, reactorName(roomId, event), null, null), event);
        }
        db.prepare("UPDATE crumbs_buzz_rooms SET pulled_at=? WHERE room_id=? AND pulled_at<?").run(event.createdAt, roomId, event.createdAt);
      }
    });
  }

  const attachmentsOf = (metadata: string | null): FileAttachment[] => {
    try {
      const list = (metadata ? JSON.parse(metadata) as { attachments?: unknown } : {}).attachments;
      return Array.isArray(list) ? list.filter((item): item is FileAttachment => Boolean(item) && typeof item === "object" && (item as FileAttachment).type === "file" && typeof (item as FileAttachment).name === "string") : [];
    } catch { return []; }
  };

  /**
   * The files of a message about to be sent, each uploaded once. `null` means
   * one could not go up yet and the message should wait. A file that can never
   * go (Drive not connected, link sharing forbidden, too large) is left out, so
   * the rest of the message still reaches people.
   */
  async function outgoingFiles(userId: number, metadata: string | null): Promise<ChatFile[] | null> {
    const attached = attachmentsOf(metadata).filter(item => typeof item.blobId === "string");
    if (!attached.length) return [];
    const out: ChatFile[] = [];
    for (const item of attached) {
      const known = db.prepare("SELECT drive, key FROM crumbs_buzz_files WHERE user_id=? AND blob_id=?").get(userId, item.blobId) as { drive: string; key: string } | undefined;
      if (known) { out.push({ drive: known.drive, key: known.key, name: item.name, size: item.sizeBytes ?? 0 }); continue; }
      if (!files) continue;
      try {
        const ref = await files.upload(userId, { blobId: item.blobId!, name: item.name });
        db.prepare("INSERT OR REPLACE INTO crumbs_buzz_files(user_id, blob_id, drive, key) VALUES(?,?,?,?)").run(userId, item.blobId, ref.drive, ref.key);
        out.push(ref);
      } catch (error) {
        if (files.retryable(error)) return null;
      }
    }
    return out;
  }

  function setAttachment(messageId: number, position: number, attachment: FileAttachment) {
    const row = db.prepare("SELECT metadata FROM buzz_room_messages WHERE id=?").get(messageId) as { metadata: string | null } | undefined;
    if (!row) return;
    let meta: Record<string, unknown> = {};
    try { meta = row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : {}; } catch { /* rebuilt below */ }
    const list = Array.isArray(meta.attachments) ? [...meta.attachments] : [];
    list[position] = attachment;
    db.prepare("UPDATE buzz_room_messages SET metadata=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify({ ...meta, attachments: list }), messageId);
  }

  async function receiveOne(userId: number, roomId: number, messageId: number, position: number, ref: ChatFile, tries: number): Promise<void> {
    if (!files) return;
    const shown: FileAttachment = { type: "file", name: ref.name, sizeBytes: ref.size };
    try {
      const local = await files.receive(userId, ref);
      setAttachment(messageId, position, { ...shown, blobId: local.blobId, format: local.format, sizeBytes: local.sizeBytes });
      // Remembered by its Drive id too, so the same file shared again is not fetched twice.
      db.prepare("INSERT OR IGNORE INTO crumbs_buzz_files(user_id, blob_id, drive, key) VALUES(?,?,?,?)").run(userId, local.blobId, ref.drive, ref.key);
      db.prepare("DELETE FROM crumbs_buzz_pending_files WHERE message_id=? AND position=?").run(messageId, position);
    } catch (error) {
      if (!files.retryable(error) || tries >= 12) {
        setAttachment(messageId, position, { ...shown, unavailable: error instanceof Error ? error.message : "This file could not be fetched." });
        db.prepare("DELETE FROM crumbs_buzz_pending_files WHERE message_id=? AND position=?").run(messageId, position);
        return;
      }
      // Backs off from 30 seconds to about half an hour.
      db.prepare(`INSERT INTO crumbs_buzz_pending_files(message_id, position, room_id, ref, tries, next_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(message_id, position) DO UPDATE SET tries=excluded.tries, next_at=excluded.next_at`)
        .run(messageId, position, roomId, JSON.stringify(ref), tries + 1, Date.now() + Math.min(30_000 * 2 ** tries, 30 * 60_000));
    }
  }
  async function receiveFiles(userId: number, roomId: number, messageId: number, refs: ChatFile[]) {
    for (const [position, ref] of refs.entries()) {
      const known = db.prepare("SELECT blob_id FROM crumbs_buzz_files WHERE user_id=? AND drive=?").get(userId, ref.drive) as { blob_id: string } | undefined;
      if (known) { setAttachment(messageId, position, { type: "file", name: ref.name, sizeBytes: ref.size, blobId: known.blob_id }); continue; }
      await receiveOne(userId, roomId, messageId, position, ref, 0);
    }
  }
  async function retryPendingFiles(userId: number, roomId: number) {
    const due = db.prepare("SELECT * FROM crumbs_buzz_pending_files WHERE room_id=? AND next_at<=? ORDER BY message_id, position LIMIT 20").all(roomId, Date.now()) as Array<{ message_id: number; position: number; ref: string; tries: number }>;
    for (const item of due) await receiveOne(userId, roomId, item.message_id, item.position, JSON.parse(item.ref) as ChatFile, item.tries);
  }

  /** Reactions are set, not toggled, so the same event arriving twice leaves them as they are. */
  function applyReaction(messageId: number, memberId: number, event: Extract<ChatEvent, { kind: "react" }>) {
    if (event.on) db.prepare("INSERT OR IGNORE INTO buzz_room_reactions(message_id, member_id, emoji) VALUES(?,?,?)").run(messageId, memberId, event.emoji);
    else db.prepare("DELETE FROM buzz_room_reactions WHERE message_id=? AND member_id=? AND emoji=?").run(messageId, memberId, event.emoji);
  }
  /** A reaction carries no name; someone not seated yet is named by what they last sent here, if anything. */
  function reactorName(roomId: number, event: ChatEvent): string {
    const row = db.prepare(`SELECT m.author_name FROM crumbs_buzz_messages x JOIN buzz_room_messages m ON m.id=x.message_id
      WHERE x.room_id=? AND x.sender=? ORDER BY m.id DESC LIMIT 1`).get(roomId, event.did) as { author_name: string } | undefined;
    return row?.author_name ?? "A member";
  }

  /**
   * Record an edit, deletion or reaction made on this machine, for the next sync
   * of its room to relay. Rooms that are not linked are left alone.
   */
  function recordChange(roomId: number, messageId: number, change: BridgeChange): void {
    if (!linkOf(roomId)) return;
    db.prepare("INSERT INTO crumbs_buzz_outbox(room_id, message_id, kind, emoji, on_flag) VALUES(?,?,?,?,?)")
      .run(roomId, messageId, change.kind, change.kind === "react" ? change.emoji : null, change.kind === "react" ? Number(change.on) : 1);
  }

  /**
   * Act on one live signal from the organization store, and answer which local
   * rooms may have changed (null when it could be any, after a full sync).
   * A message signal is matched to its room by page index, computed from the
   * keys on this machine, so only that room is fetched.
   */
  async function handleSignal(userId: number, event: OrgSignal): Promise<number[] | null> {
    if (event.kind === "ready" || event.kind === "membership" || event.kind === "keys") { await syncAll(userId); return null; }
    if (event.kind !== "message") return [];
    const links = db.prepare("SELECT * FROM crumbs_buzz_rooms WHERE user_id=? AND org_id=?").all(userId, event.org) as RoomLink[];
    if (!links.length) { await syncOrganizations(userId); return null; } // an organization this machine has not listed yet
    if (crumbs.chatIndexes(userId, event.org, "rooms").includes(event.index)) { await syncAll(userId); return null; } // a new room
    const link = links.find(candidate => crumbs.chatIndexes(userId, event.org, candidate.channel).includes(event.index));
    if (!link) return []; // a crumb on a page, or a room this machine does not show
    await syncRoom(userId, link.room_id);
    return [link.room_id];
  }

  /**
   * Whether a linked room (or any of this account's) holds something written
   * here and not yet sent: a finished message, or an edit, deletion or reaction.
   * Answered from this machine alone, so it is cheap to ask often.
   */
  function hasOutgoing(userId: number, roomId?: number): boolean {
    const scope = roomId === undefined ? "l.user_id=?" : "l.user_id=? AND l.room_id=?";
    const me = getAccount(db, userId)?.did ?? "";
    const params = roomId === undefined ? [userId, me] : [userId, roomId, me];
    return Boolean(db.prepare(`SELECT 1 FROM crumbs_buzz_rooms l WHERE ${scope} AND (
        EXISTS (SELECT 1 FROM crumbs_buzz_outbox o WHERE o.room_id=l.room_id)
        OR EXISTS (SELECT 1 FROM crumbs_buzz_messages x JOIN buzz_room_messages m ON m.id=x.message_id WHERE x.room_id=l.room_id AND x.sender=?
          AND x.pushed_body IS NOT NULL AND m.author_kind='agent' AND m.status='complete' AND m.deleted_at IS NULL AND m.body<>'' AND m.body<>x.pushed_body)
        OR EXISTS (SELECT 1 FROM buzz_room_messages m WHERE m.room_id=l.room_id AND m.id>l.pushed_id AND m.deleted_at IS NULL AND m.status='complete'
          AND m.author_kind IN ('human','agent') AND ${HAS_CONTENT} AND m.id NOT IN (SELECT message_id FROM crumbs_buzz_messages x WHERE x.room_id=l.room_id))
      ) LIMIT 1`).get(...params));
  }

  /** Every linked room of this user: used when the page loads and when the rails refresh. */
  async function syncAll(userId: number): Promise<void> {
    await syncOrganizations(userId);
    for (const link of db.prepare("SELECT room_id FROM crumbs_buzz_rooms WHERE user_id=?").all(userId) as Array<{ room_id: number }>) await syncRoom(userId, link.room_id).catch(() => {});
  }

  /**
   * Change an organization's name or picture. A shared one is changed on Crumbs,
   * where its admins decide and every member's machine picks it up; one that
   * lives only here is changed here.
   */
  async function updateOrganization(userId: number, organizationId: number, input: { name?: string; image?: string | null }): Promise<void> {
    const link = db.prepare("SELECT org_id FROM crumbs_buzz_orgs WHERE user_id=? AND organization_id=?").get(userId, organizationId) as { org_id: string } | undefined;
    if (!link) {
      const role = (db.prepare("SELECT role FROM organization_members WHERE organization_id=? AND user_id=?").get(organizationId, userId) as { role: string } | undefined)?.role;
      if (role !== "owner" && role !== "admin") throw new CrumbsError(403, "Only the organization's admins can change its settings.");
      const name = input.name?.trim().slice(0, 80);
      if (input.name !== undefined && !name) throw new CrumbsError(400, "A name is required.");
      db.prepare("UPDATE organizations SET name=COALESCE(?, name), image=CASE WHEN ? THEN ? ELSE image END WHERE id=?").run(name ?? null, input.image !== undefined ? 1 : 0, input.image ?? null, organizationId);
      return;
    }
    const saved = await crumbs.writeOrgProfile(userId, link.org_id, input);
    db.prepare("UPDATE organizations SET name=COALESCE(?, name), image=? WHERE id=?").run(saved.name, saved.image, organizationId);
  }

  /** Profile photos for a room: members on this Breadboard by their linked account, others by what they sent. */
  function memberAvatars(roomId: number): Record<number, string> {
    const out: Record<number, string> = {};
    for (const row of db.prepare("SELECT m.id, a.avatar FROM buzz_room_members m JOIN crumbs_accounts a ON a.user_id=m.user_id WHERE m.room_id=? AND a.avatar IS NOT NULL").all(roomId) as Array<{ id: number; avatar: string }>) out[row.id] = row.avatar;
    for (const row of db.prepare("SELECT member_id, avatar FROM crumbs_buzz_people WHERE room_id=? AND avatar IS NOT NULL").all(roomId) as Array<{ member_id: number; avatar: string }>) out[row.member_id] = row.avatar;
    return out;
  }
  /**
   * Breadboard organizations this account runs that are not on Crumbs. With
   * `automatic`, only those the sync may connect by itself: ones that were
   * linked once and dropped wait for a person to connect them again.
   */
  function localOrganizations(userId: number, options: { automatic?: boolean } = {}): Array<{ id: number; name: string }> {
    return db.prepare(`SELECT o.id, o.name FROM organizations o JOIN organization_members m ON m.organization_id=o.id
      WHERE m.user_id=? AND m.role IN ('owner','admin') AND o.id NOT IN (SELECT organization_id FROM crumbs_buzz_orgs)
      ${options.automatic ? "AND o.id NOT IN (SELECT organization_id FROM crumbs_buzz_detached)" : ""} ORDER BY o.name`).all(userId) as Array<{ id: number; name: string }>;
  }

  /**
   * Put one Breadboard organization on Crumbs: an encrypted twin is made and its
   * rooms are linked, so its messages relay like any Crumbs organization's.
   * The sync does this by itself for organizations made here; this is for one
   * that was dropped and is wanted back.
   */
  async function connectOrganization(userId: number, organizationId: number): Promise<void> {
    const local = localOrganizations(userId).find(org => org.id === organizationId);
    if (!local) throw new CrumbsError(404, "That organization is not yours to connect, or it is already connected.");
    await linkOrganization(userId, local);
    await syncOrganizations(userId);
  }

  /** The Crumbs organization a Breadboard organization is linked to, for this account. */
  function crumbsOrgOf(userId: number, organizationId: number): string | null {
    const row = db.prepare("SELECT org_id FROM crumbs_buzz_orgs WHERE user_id=? AND organization_id=?").get(userId, organizationId) as { org_id: string } | undefined;
    return row?.org_id ?? null;
  }
  const roomOrganization = (roomId: number) => (db.prepare("SELECT organization_id FROM buzz_rooms WHERE id=?").get(roomId) as { organization_id: number } | undefined)?.organization_id ?? null;

  /**
   * People who could be added to a room of a linked organization: Crumbs
   * accounts matching the search, without you and without whoever is already
   * seated. An unlinked room answers nothing; its people are local accounts.
   */
  async function findPeople(userId: number, roomId: number, query: string): Promise<Array<{ did: string; handle: string; displayName: string | null }>> {
    const organizationId = roomOrganization(roomId);
    if (organizationId === null || !crumbsOrgOf(userId, organizationId)) return [];
    const me = getAccount(db, userId);
    const seated = new Set((db.prepare("SELECT did FROM crumbs_buzz_people WHERE room_id=?").all(roomId) as Array<{ did: string }>).map(row => row.did));
    return (await crumbs.typeahead(query)).filter(person => person.did !== me?.did && !seated.has(person.did) && person.handle)
      .map(person => ({ did: person.did, handle: person.handle!, displayName: person.displayName }));
  }

  /**
   * Add a Crumbs account to a linked organization and seat them in this room.
   * They become a member at once (Crumbs has no pending invitations): their
   * Breadboard receives the organization's key and lists it on its next sync.
   */
  async function addPerson(userId: number, roomId: number, did: string) {
    const organizationId = roomOrganization(roomId);
    const orgId = organizationId === null ? null : crumbsOrgOf(userId, organizationId);
    if (!orgId) throw new CrumbsError(409, "This organization is not on Crumbs yet. Sign in to Crumbs and try again.");
    const detail = await crumbs.addOrgMember(userId, orgId, did, "member");
    const person = detail.members.find(member => member.did === did);
    const name = person?.displayName || shortHandle(person?.handle ?? null) || "A member";
    const known = db.prepare("SELECT member_id FROM crumbs_buzz_people WHERE room_id=? AND did=?").get(roomId, did) as { member_id: number } | undefined;
    const memberId = known?.member_id ?? addMember(db, roomId, { kind: "human", userId: null, displayName: name, handle: person?.handle?.split(".")[0] ?? name }).id;
    db.prepare("INSERT INTO crumbs_buzz_people(room_id, did, member_id, avatar) VALUES(?,?,?,?) ON CONFLICT(room_id, did) DO UPDATE SET avatar=COALESCE(excluded.avatar, avatar)").run(roomId, did, memberId, person?.avatar ?? null);
    return listMembers(db, roomId).find(member => member.id === memberId)!;
  }

  /** The crumbs room of the Breadboard organization this Crumbs organization is connected to, if it is. */
  function crumbsRoomOf(userId: number, orgId: string): string | null {
    const row = db.prepare(`SELECT r.public_id FROM crumbs_buzz_orgs b JOIN buzz_rooms r ON r.organization_id=b.organization_id AND r.slug='crumbs' AND r.archived_at IS NULL
      WHERE b.user_id=? AND b.org_id=?`).get(userId, orgId) as { public_id: string } | undefined;
    return row?.public_id ?? null;
  }

  return { syncOrganizations, syncRoom, syncAll, memberAvatars, updateOrganization, localOrganizations, connectOrganization, crumbsRoomOf, crumbsOrgOf, findPeople, addPerson, recordChange, handleSignal, hasOutgoing,
    isLinked: (roomId: number) => Boolean(linkOf(roomId)) };
}
export type BuzzBridge = ReturnType<typeof createBuzzBridge>;

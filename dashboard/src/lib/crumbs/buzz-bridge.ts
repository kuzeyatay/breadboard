// Organization messaging over the encrypted store.
//
// The Organization page keeps its own rooms and transcript on this machine.
// This bridge makes an encrypted Crumbs organization appear there as a
// community: its rooms become local rooms, what is written locally is
// encrypted and sent to the organization store, and what other members wrote
// is fetched, decrypted here, and added to the local transcript. The page
// itself is unchanged; the store only ever relays ciphertext.
//
// ponytail: new messages and new rooms travel both ways. Edits, deletions and
// reactions stay on the machine they were made on. Carry them as their own
// encrypted events if people start relying on them across machines.
import type Database from "better-sqlite3";
import { addMember, createRoom, listMembers, postMessage } from "../buzz/store.ts";
import { CrumbsError, type ChatCrumb, type Crumbs } from "./core.ts";
import { ensureCrumbsSchema, getAccount } from "./store.ts";
import { annotationRootMessage, ensureBrowserAnnotationsSchema } from "../browser-annotations-store.ts";
import { shortHandle } from "./handle.ts";

const initialized = new WeakSet<Database.Database>();
function ensureBridgeSchema(db: Database.Database) {
  if (initialized.has(db)) return;
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
  `);
  initialized.add(db);
}

interface RoomLink { room_id: number; user_id: number; org_id: string; channel: string; pulled_at: string; pushed_id: number }
interface LocalMessage { id: number; member_id: number | null; author_kind: string; author_name: string; author_handle: string; body: string; parent_id: number | null; metadata: string | null; target_json: string | null }

export function createBuzzBridge({ db, crumbs }: { db: Database.Database; crumbs: Crumbs }) {
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

  /** Make every encrypted organization, and every room in it, exist on the Organization page. */
  function syncOrganizations(userId: number): Promise<void> {
    return once(`orgs:${userId}`, async () => {
      if (!crumbs.status(userId).signedIn) return;
      for (const org of await crumbs.listOrgs(userId)) {
        if (!org.ready) continue;
        let mapped = db.prepare("SELECT o.id, o.name FROM crumbs_buzz_orgs m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? AND m.org_id=?").get(userId, org.id) as { id: number; name: string } | undefined;
        if (!mapped) {
          const id = db.transaction(() => {
            const created = Number(db.prepare("INSERT INTO organizations(name, created_by_user_id) VALUES(?, ?)").run(org.name.slice(0, 80), userId).lastInsertRowid);
            db.prepare("INSERT INTO organization_members(organization_id, user_id, role) VALUES(?, ?, 'owner')").run(created, userId);
            db.prepare("INSERT INTO crumbs_buzz_orgs(user_id, org_id, organization_id) VALUES(?,?,?) ON CONFLICT(user_id, org_id) DO UPDATE SET organization_id=excluded.organization_id").run(userId, org.id, created);
            return created;
          })();
          mapped = { id, name: org.name };
        } else if (mapped.name !== org.name.slice(0, 80)) db.prepare("UPDATE organizations SET name=? WHERE id=?").run(org.name.slice(0, 80), mapped.id);

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
      const record = db.prepare("INSERT INTO crumbs_buzz_messages(remote_id, room_id, message_id) VALUES(?,?,?) ON CONFLICT(remote_id) DO NOTHING");

      // Outbound: finished messages from people and agents that did not come from the store.
      const outgoing = db.prepare(`SELECT m.id, m.member_id, m.author_kind, m.author_name, m.author_handle, m.body, m.parent_id, m.metadata,
          (SELECT t.target_json FROM browser_annotation_threads t WHERE t.root_message_id=m.parent_id) AS target_json FROM buzz_room_messages m
        WHERE m.room_id=? AND m.id>? AND m.deleted_at IS NULL AND m.status='complete' AND m.author_kind IN ('human','agent') AND m.body<>''
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
        const sent = await crumbs.sendChat(userId, link.org_id, link.channel, message.body.slice(0, 12000), {
          ...(mine ? {} : { agent: true, author: { handle: null, displayName: message.author_name, avatar: null } }), ...(parent ? { parent } : {}), ...(crumb ? { crumb } : {}) });
        record.run(sent.id, roomId, message.id);
        db.prepare("UPDATE crumbs_buzz_rooms SET pushed_id=? WHERE room_id=?").run(message.id, roomId);
      }

      // Inbound: decrypted on this machine, then added to the local transcript.
      const { messages } = await crumbs.readChat(userId, link.org_id, link.channel, link.pulled_at || null);
      const members = listMembers(db, roomId);
      const room = { id: roomId, publicId: (db.prepare("SELECT public_id FROM buzz_rooms WHERE id=?").get(roomId) as { public_id: string }).public_id };
      for (const message of messages) {
        if (!localOf.get(message.id)) {
          let memberId: number | null = null;
          if (!message.agent) {
            if (message.did === me.did) memberId = (members.find(member => member.userId === userId) ?? addMember(db, roomId, { kind: "human", userId, displayName: me.displayName || shortHandle(me.handle) || "You", handle: me.handle?.split(".")[0] })).id;
            else {
              const known = db.prepare("SELECT member_id FROM crumbs_buzz_people WHERE room_id=? AND did=?").get(roomId, message.did) as { member_id: number } | undefined;
              memberId = known?.member_id ?? addMember(db, roomId, { kind: "human", userId: null, displayName: message.author, handle: message.handle?.split(".")[0] ?? message.author }).id;
              db.prepare("INSERT INTO crumbs_buzz_people(room_id, did, member_id, avatar) VALUES(?,?,?,?) ON CONFLICT(room_id, did) DO UPDATE SET avatar=excluded.avatar").run(roomId, message.did, memberId, message.avatar);
            }
          }
          const parent = message.crumb ? annotationRootMessage(db, room, message.crumb.target)
            : message.parent ? (localOf.get(message.parent) as { message_id: number } | undefined)?.message_id ?? null : null;
          const local = postMessage(db, roomId, { clientMessageId: `crumbs:${message.id}`, memberId, authorKind: message.agent ? "agent" : "human", authorName: message.author, authorHandle: message.handle ?? "",
            body: message.body, parentId: parent, metadata: { crumbs: { did: message.did, avatar: message.avatar, ...(message.unverified ? { unverified: true } : {}) },
              ...(message.crumb ? { annotationBody: message.crumb.body, annotationSource: message.crumb.source } : {}) } });
          record.run(message.id, roomId, local.id);
        }
        db.prepare("UPDATE crumbs_buzz_rooms SET pulled_at=? WHERE room_id=? AND pulled_at<?").run(message.createdAt, roomId, message.createdAt);
      }
    });
  }

  /** Every linked room of this user: used when the page loads and when the rails refresh. */
  async function syncAll(userId: number): Promise<void> {
    await syncOrganizations(userId);
    for (const link of db.prepare("SELECT room_id FROM crumbs_buzz_rooms WHERE user_id=?").all(userId) as Array<{ room_id: number }>) await syncRoom(userId, link.room_id).catch(() => {});
  }

  /** Profile photos for a room: members on this Breadboard by their linked account, others by what they sent. */
  function memberAvatars(roomId: number): Record<number, string> {
    const out: Record<number, string> = {};
    for (const row of db.prepare("SELECT m.id, a.avatar FROM buzz_room_members m JOIN crumbs_accounts a ON a.user_id=m.user_id WHERE m.room_id=? AND a.avatar IS NOT NULL").all(roomId) as Array<{ id: number; avatar: string }>) out[row.id] = row.avatar;
    for (const row of db.prepare("SELECT member_id, avatar FROM crumbs_buzz_people WHERE room_id=? AND avatar IS NOT NULL").all(roomId) as Array<{ member_id: number; avatar: string }>) out[row.member_id] = row.avatar;
    return out;
  }
  /** Breadboard organizations this account runs that are not on Crumbs. They stay local until connected. */
  function localOrganizations(userId: number): Array<{ id: number; name: string }> {
    return db.prepare(`SELECT o.id, o.name FROM organizations o JOIN organization_members m ON m.organization_id=o.id
      WHERE m.user_id=? AND m.role IN ('owner','admin') AND o.id NOT IN (SELECT organization_id FROM crumbs_buzz_orgs) ORDER BY o.name`).all(userId) as Array<{ id: number; name: string }>;
  }

  /**
   * Put one Breadboard organization on Crumbs: an encrypted twin is made and its
   * rooms are linked, so its messages relay like any Crumbs organization's.
   * ponytail: members are not invited; Crumbs adds people by Bluesky handle and
   * local accounts have none. They are added from the Crumbs organization.
   */
  async function connectOrganization(userId: number, organizationId: number): Promise<void> {
    const local = localOrganizations(userId).find(org => org.id === organizationId);
    if (!local) throw new CrumbsError(404, "That organization is not yours to connect, or it is already connected.");
    const created = await crumbs.createOrg(userId, local.name);
    db.prepare("INSERT INTO crumbs_buzz_orgs(user_id, org_id, organization_id) VALUES(?,?,?)").run(userId, created.id, local.id);
    await syncOrganizations(userId);
  }

  /** The crumbs room of the Breadboard organization this Crumbs organization is connected to, if it is. */
  function crumbsRoomOf(userId: number, orgId: string): string | null {
    const row = db.prepare(`SELECT r.public_id FROM crumbs_buzz_orgs b JOIN buzz_rooms r ON r.organization_id=b.organization_id AND r.slug='crumbs' AND r.archived_at IS NULL
      WHERE b.user_id=? AND b.org_id=?`).get(userId, orgId) as { public_id: string } | undefined;
    return row?.public_id ?? null;
  }

  return { syncOrganizations, syncRoom, syncAll, memberAvatars, localOrganizations, connectOrganization, crumbsRoomOf, isLinked: (roomId: number) => Boolean(linkOf(roomId)) };
}
export type BuzzBridge = ReturnType<typeof createBuzzBridge>;

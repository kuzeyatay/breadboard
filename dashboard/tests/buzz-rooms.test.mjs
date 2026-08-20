// Buzz rooms: organization-scoped access, membership, the transcript and its
// threads, and the rule that decides which members answer a message.
//
// All of it runs against an in-memory database. The store takes its connection
// as an argument for exactly this reason, so the rules can be exercised without
// a server, a session, or a model.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { ensureBuzzSchema } from "../src/lib/buzz/schema.ts";
import { mentionedHandles, resolveResponders } from "../src/lib/buzz/mentions.ts";
import {
  addMember,
  canonicalRoomSlug,
  createRoom,
  getRoomForUser,
  listAgentSeats,
  listMembers,
  listRooms,
  listRoomsForUser,
  listSpineMessages,
  listThreadMessages,
  listUnreadMessages,
  markRoomRead,
  postMessage,
  reactionsForRoom,
  searchMessages,
  softDeleteMessage,
  toggleReaction,
  unreadCounts,
} from "../src/lib/buzz/store.ts";

/**
 * The tables Buzz points at, and nothing else. `conversations` is here only
 * because the schema adds its `buzz_room_id` column.
 */
function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE organization_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      UNIQUE(organization_id, user_id)
    );
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureBuzzSchema(db);
  return db;
}

/** Two organizations: Ada and Grace share the first, Lin is alone in the second. */
function seed(db) {
  db.exec(`
    INSERT INTO users (id, email) VALUES
      (1,'ada@example.com'), (2,'grace@example.com'), (3,'lin@example.com');
    INSERT INTO organizations (id, name) VALUES (10,'Fieldwork'), (20,'Outside');
    INSERT INTO organization_members (organization_id, user_id) VALUES
      (10,1), (10,2), (20,3);
  `);
}

function agent(overrides = {}) {
  return {
    id: 1,
    kind: "agent",
    handle: "researcher",
    muted: false,
    respondTo: "mention",
    ...overrides,
  };
}

test("a room belongs to an organization, and only its members can open it", () => {
  const db = createDatabase();
  seed(db);

  const room = createRoom(db, 10, 1, { name: "Field Notes" });
  assert.equal(room.organizationId, 10);
  assert.equal(room.createdByUserId, 1);
  assert.equal(room.slug, "field-notes");

  // Ada created it and Grace shares the organization: both see it.
  assert.ok(getRoomForUser(db, 1, room.publicId));
  assert.ok(getRoomForUser(db, 2, room.publicId));
  // Lin is in a different organization, so the room does not exist for them.
  assert.equal(getRoomForUser(db, 3, room.publicId), null);

  assert.equal(listRoomsForUser(db, 2).length, 1);
  assert.equal(listRoomsForUser(db, 3).length, 0);
});

test("a private room opens only for someone enrolled in it", () => {
  const db = createDatabase();
  seed(db);

  const room = createRoom(db, 10, 1, { name: "pay-review", visibility: "private" });
  addMember(db, room.id, { kind: "human", userId: 1, displayName: "ada" });

  // Ada is a member of the room itself.
  assert.ok(getRoomForUser(db, 1, room.publicId));
  // Grace is in the organization but not in this room, so it stays hidden —
  // organization membership alone is not enough for a private room.
  assert.equal(getRoomForUser(db, 2, room.publicId), null);
  assert.equal(listRoomsForUser(db, 2).length, 0);

  addMember(db, room.id, { kind: "human", userId: 2, displayName: "grace" });
  assert.ok(getRoomForUser(db, 2, room.publicId));
});

test("room slugs are unique per organization, not globally", () => {
  const db = createDatabase();
  seed(db);

  const first = createRoom(db, 10, 1, { name: "general" });
  const second = createRoom(db, 10, 1, { name: "general" });
  // The same organization cannot hold two #general rooms.
  assert.equal(first.slug, "general");
  assert.equal(second.slug, "general-2");

  // A different organization is free to use the name it wants.
  const elsewhere = createRoom(db, 20, 3, { name: "general" });
  assert.equal(elsewhere.slug, "general");

  assert.equal(listRooms(db, 10).length, 2);
  assert.equal(listRooms(db, 20).length, 1);
});

test("canonical slugs are lowercase and hyphenated", () => {
  assert.equal(canonicalRoomSlug("Product Launch!"), "product-launch");
  assert.equal(canonicalRoomSlug("  spaced  out  "), "spaced-out");
  assert.equal(canonicalRoomSlug("***"), "room");
});

test("people and agents are peers in one member list", () => {
  const db = createDatabase();
  seed(db);
  const room = createRoom(db, 10, 1, { name: "general" });

  addMember(db, room.id, { kind: "human", userId: 1, displayName: "ada" });
  addMember(db, room.id, { kind: "human", userId: 2, displayName: "grace" });
  addMember(db, room.id, {
    kind: "agent",
    personaSlug: "researcher",
    displayName: "Researcher",
  });

  const members = listMembers(db, room.id);
  assert.equal(members.length, 3);
  assert.equal(members.filter((member) => member.kind === "human").length, 2);
  assert.equal(members.filter((member) => member.kind === "agent").length, 1);

  // A person joins with `never`: nothing may put words in a colleague's mouth.
  const ada = members.find((member) => member.userId === 1);
  assert.equal(ada.respondTo, "never");
});

test("a clashing handle is suffixed rather than rejected", () => {
  const db = createDatabase();
  seed(db);
  const room = createRoom(db, 10, 1, { name: "general" });

  const first = addMember(db, room.id, { kind: "human", userId: 1, displayName: "Sam" });
  const second = addMember(db, room.id, { kind: "human", userId: 2, displayName: "Sam" });
  assert.equal(first.handle, "sam");
  assert.equal(second.handle, "sam-2");
});

test("re-posting a client message id is a retry, not a second message", () => {
  const db = createDatabase();
  seed(db);
  const room = createRoom(db, 10, 1, { name: "general" });

  const once = postMessage(db, room.id, {
    clientMessageId: "abc",
    memberId: null,
    authorKind: "human",
    authorName: "ada",
    body: "hello",
  });
  const twice = postMessage(db, room.id, {
    clientMessageId: "abc",
    memberId: null,
    authorKind: "human",
    authorName: "ada",
    body: "hello",
  });

  assert.equal(once.id, twice.id);
  assert.equal(listSpineMessages(db, room.id).length, 1);
});

test("replies hang off a root and are counted on it, not on the spine", () => {
  const db = createDatabase();
  seed(db);
  const room = createRoom(db, 10, 1, { name: "general" });

  const root = postMessage(db, room.id, {
    clientMessageId: "root",
    memberId: null,
    authorKind: "human",
    authorName: "ada",
    body: "what do we think?",
  });
  for (const id of ["r1", "r2"]) {
    postMessage(db, room.id, {
      clientMessageId: id,
      memberId: null,
      authorKind: "agent",
      authorName: "Researcher",
      body: "a thought",
      parentId: root.id,
    });
  }

  const spine = listSpineMessages(db, room.id);
  assert.equal(spine.length, 1, "replies stay out of the spine");
  assert.equal(spine[0].replyCount, 2);
  assert.equal(listThreadMessages(db, room.id, root.id).length, 2);
});

test("a deleted message keeps its row so its thread survives", () => {
  const db = createDatabase();
  seed(db);
  const room = createRoom(db, 10, 1, { name: "general" });

  const root = postMessage(db, room.id, {
    clientMessageId: "root",
    memberId: null,
    authorKind: "human",
    authorName: "ada",
    body: "original",
  });
  postMessage(db, room.id, {
    clientMessageId: "reply",
    memberId: null,
    authorKind: "human",
    authorName: "grace",
    body: "still here",
    parentId: root.id,
  });

  softDeleteMessage(db, root.id);

  const spine = listSpineMessages(db, room.id);
  assert.equal(spine.length, 1);
  assert.equal(spine[0].body, "", "the words are gone");
  assert.ok(spine[0].deletedAt, "but the row is marked rather than removed");
  assert.equal(
    listThreadMessages(db, room.id, root.id).length,
    1,
    "the reply is not taken down with it",
  );
});

test("unread counts another person's message, never your own", () => {
  const db = createDatabase();
  seed(db);
  const room = createRoom(db, 10, 1, { name: "general" });
  const ada = addMember(db, room.id, { kind: "human", userId: 1, displayName: "ada" });
  const grace = addMember(db, room.id, {
    kind: "human",
    userId: 2,
    displayName: "grace",
  });

  postMessage(db, room.id, {
    clientMessageId: "m1",
    memberId: ada.id,
    authorKind: "human",
    authorName: "ada",
    body: "mine",
  });
  postMessage(db, room.id, {
    clientMessageId: "m2",
    memberId: grace.id,
    authorKind: "human",
    authorName: "grace",
    body: "hers",
  });

  // Ada has one unread — Grace's line, not her own.
  assert.equal(unreadCounts(db, 1).get(room.id), 1);
  // Grace has one unread for the same reason, the other way round.
  assert.equal(unreadCounts(db, 2).get(room.id), 1);
  // Lin is in another organization and sees nothing at all.
  assert.equal(unreadCounts(db, 3).size, 0);
});

test("the read marker never moves backwards", () => {
  const db = createDatabase();
  seed(db);
  const room = createRoom(db, 10, 1, { name: "general" });
  const grace = addMember(db, room.id, {
    kind: "human",
    userId: 2,
    displayName: "grace",
  });

  const first = postMessage(db, room.id, {
    clientMessageId: "m1",
    memberId: grace.id,
    authorKind: "human",
    authorName: "grace",
    body: "one",
  });
  const second = postMessage(db, room.id, {
    clientMessageId: "m2",
    memberId: grace.id,
    authorKind: "human",
    authorName: "grace",
    body: "two",
  });

  markRoomRead(db, room.id, 1, second.id);
  assert.equal(unreadCounts(db, 1).get(room.id), undefined);

  // Opening an older thread must not resurrect badges already cleared.
  markRoomRead(db, room.id, 1, first.id);
  assert.equal(unreadCounts(db, 1).get(room.id), undefined);
});

test("a reaction toggles, and is reported from the reader's side", () => {
  const db = createDatabase();
  seed(db);
  const room = createRoom(db, 10, 1, { name: "general" });
  const ada = addMember(db, room.id, { kind: "human", userId: 1, displayName: "ada" });
  const grace = addMember(db, room.id, {
    kind: "human",
    userId: 2,
    displayName: "grace",
  });
  const message = postMessage(db, room.id, {
    clientMessageId: "m1",
    memberId: ada.id,
    authorKind: "human",
    authorName: "ada",
    body: "ship it",
  });

  toggleReaction(db, message.id, ada.id, "🎉");
  toggleReaction(db, message.id, grace.id, "🎉");

  const forAda = reactionsForRoom(db, room.id, ada.id).get(message.id);
  assert.deepEqual(forAda, [{ emoji: "🎉", count: 2, mine: true }]);

  const forNobody = reactionsForRoom(db, room.id, null).get(message.id);
  assert.equal(forNobody[0].mine, false);

  // The same reaction again takes it back.
  toggleReaction(db, message.id, ada.id, "🎉");
  assert.deepEqual(reactionsForRoom(db, room.id, ada.id).get(message.id), [
    { emoji: "🎉", count: 1, mine: false },
  ]);
});

test("mentions name a handle, and an email address names nobody", () => {
  assert.deepEqual(mentionedHandles("@researcher what do you think?"), ["researcher"]);
  assert.deepEqual(mentionedHandles("ask @ada and @grace-b"), ["ada", "grace-b"]);
  assert.deepEqual(mentionedHandles("write to ada@example.com"), []);
  assert.deepEqual(mentionedHandles("no mentions here"), []);
});

test("only mentioned agents answer, unless they are set to always", () => {
  const members = [
    { ...agent({ id: 1, handle: "researcher", respondTo: "mention" }) },
    { ...agent({ id: 2, handle: "editor", respondTo: "always" }) },
    { ...agent({ id: 3, handle: "archivist", respondTo: "never" }) },
    { ...agent({ id: 4, handle: "muted-one", respondTo: "always", muted: true }) },
    { id: 5, kind: "human", handle: "ada", muted: false, respondTo: "never" },
  ];

  // Nobody named: only the always-on agent speaks.
  assert.deepEqual(
    resolveResponders(members, "just thinking out loud").map((m) => m.handle),
    ["editor"],
  );

  // Naming an agent brings it in alongside the always-on one.
  assert.deepEqual(
    resolveResponders(members, "@researcher take a look").map((m) => m.handle),
    ["researcher", "editor"],
  );

  // `never` stays silent even when named, and a muted member never speaks.
  assert.deepEqual(
    resolveResponders(members, "@archivist @muted-one hello").map((m) => m.handle),
    ["editor"],
  );

  // Mentioning a person notifies them; it does not make an agent of them.
  assert.deepEqual(
    resolveResponders(members, "@ada thoughts?").map((m) => m.handle),
    ["editor"],
  );
});

/* ── search, inbox and the agent roster ──────────────────────────────────── */

/**
 * These three read across every room at once rather than inside one, which is
 * exactly where an access rule is easiest to lose: the room queries enforce
 * organization membership in their own JOIN, and a message query that forgot
 * to would happily return a private room's transcript to a search box.
 */
test("search reads only rooms the reader can open", () => {
  const db = createDatabase();
  seed(db);

  const open = createRoom(db, 10, 1, { name: "field-notes" });
  const secret = createRoom(db, 10, 1, { name: "pay-review", visibility: "private" });
  const elsewhere = createRoom(db, 20, 3, { name: "outside" });

  const ada = addMember(db, open.id, { kind: "human", userId: 1, displayName: "ada" });
  const inSecret = addMember(db, secret.id, {
    kind: "human",
    userId: 1,
    displayName: "ada",
  });
  const lin = addMember(db, elsewhere.id, {
    kind: "human",
    userId: 3,
    displayName: "lin",
  });

  postMessage(db, open.id, {
    clientMessageId: "a",
    memberId: ada.id,
    authorKind: "human",
    authorName: "ada",
    body: "the kestrel survey is done",
  });
  postMessage(db, secret.id, {
    clientMessageId: "b",
    memberId: inSecret.id,
    authorKind: "human",
    authorName: "ada",
    body: "kestrel band review",
  });
  postMessage(db, elsewhere.id, {
    clientMessageId: "c",
    memberId: lin.id,
    authorKind: "human",
    authorName: "lin",
    body: "kestrel sighting",
  });

  // Ada is enrolled in the private room, so both of hers come back.
  assert.deepEqual(
    searchMessages(db, 1, "kestrel").map((hit) => hit.roomSlug).sort(),
    ["field-notes", "pay-review"],
  );

  // Grace shares the organization but not the private room.
  assert.deepEqual(
    searchMessages(db, 2, "kestrel").map((hit) => hit.roomSlug),
    ["field-notes"],
  );

  // Lin's organization is a different world entirely.
  assert.deepEqual(
    searchMessages(db, 3, "kestrel").map((hit) => hit.roomSlug),
    ["outside"],
  );

  // An empty query is not "everything".
  assert.equal(searchMessages(db, 1, "   ").length, 0);
});

test("search treats wildcards as literal text", () => {
  const db = createDatabase();
  seed(db);
  const room = createRoom(db, 10, 1, { name: "field-notes" });
  const ada = addMember(db, room.id, { kind: "human", userId: 1, displayName: "ada" });
  postMessage(db, room.id, {
    clientMessageId: "a",
    memberId: ada.id,
    authorKind: "human",
    authorName: "ada",
    body: "100% of the transects",
  });

  // `%` is a LIKE wildcard. Unescaped, "%" alone would match every message.
  assert.equal(searchMessages(db, 1, "100%").length, 1);
  assert.equal(searchMessages(db, 1, "%").length, 1);
  assert.equal(searchMessages(db, 1, "50%").length, 0);
});

test("the inbox lists what is unread, and marks what names you", () => {
  const db = createDatabase();
  seed(db);

  const room = createRoom(db, 10, 1, { name: "field-notes" });
  const ada = addMember(db, room.id, { kind: "human", userId: 1, displayName: "ada" });
  const grace = addMember(db, room.id, {
    kind: "human",
    userId: 2,
    displayName: "grace",
  });

  const mine = postMessage(db, room.id, {
    clientMessageId: "a",
    memberId: ada.id,
    authorKind: "human",
    authorName: "ada",
    body: "starting the survey",
  });
  postMessage(db, room.id, {
    clientMessageId: "b",
    memberId: grace.id,
    authorKind: "human",
    authorName: "grace",
    body: "@ada can you check the north transect?",
  });
  postMessage(db, room.id, {
    clientMessageId: "c",
    memberId: grace.id,
    authorKind: "human",
    authorName: "grace",
    body: "never mind, found it",
  });

  const waiting = listUnreadMessages(db, 1);
  // Ada's own line is not waiting for Ada.
  assert.deepEqual(
    waiting.map((hit) => hit.message.clientMessageId),
    ["c", "b"],
  );
  assert.deepEqual(
    waiting.map((hit) => hit.mentionsYou),
    [false, true],
  );
  assert.equal(waiting[0].roomSlug, "field-notes");

  // Reading the room empties it.
  markRoomRead(db, room.id, 1, mine.id + 3);
  assert.equal(listUnreadMessages(db, 1).length, 0);
});

test("the agent roster names every seat and the room it sits in", () => {
  const db = createDatabase();
  seed(db);

  const one = createRoom(db, 10, 1, { name: "field-notes" });
  const two = createRoom(db, 10, 1, { name: "ringing" });
  const hidden = createRoom(db, 10, 1, { name: "pay-review", visibility: "private" });

  for (const room of [one, two, hidden]) {
    addMember(db, room.id, {
      kind: "agent",
      personaSlug: "researcher",
      displayName: "Researcher",
      handle: "researcher",
    });
  }
  addMember(db, one.id, { kind: "human", userId: 1, displayName: "ada" });

  // Grace can see the two public seats, not the private room's.
  assert.deepEqual(
    listAgentSeats(db, 2).map((seat) => seat.roomSlug).sort(),
    ["field-notes", "ringing"],
  );
  assert.ok(listAgentSeats(db, 2).every((seat) => seat.member.kind === "agent"));

  // Lin is in another organization and sees none of them.
  assert.equal(listAgentSeats(db, 3).length, 0);
});

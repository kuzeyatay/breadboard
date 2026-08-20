import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import Database from "better-sqlite3";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-brain-auth-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
process.env.BRAIN_GRAPH_ID_SECRET = "brain-authorization-fixture";

const { ensureBuzzSchema } = await import("../src/lib/buzz/schema.ts");
const buzz = await import("../src/lib/buzz/store.ts");
const { default: singletonDb } = await import("../src/lib/db.ts");
const {
  BrainGraphAccessError,
  buildBrainGraphAccessContext,
  parseBrainScope,
} = await import("../src/lib/profile/brain-graph-auth.ts");
const { organizationPublicId, buzzRoomNodeId } = await import(
  "../src/lib/profile/brain-graph-ids.ts"
);
const { normalizeBrainGraph } = await import("../src/lib/profile/brain-graph-normalize.ts");
const { buzzBrainSource } = await import("../src/lib/profile/brain-graph-sources/buzz.ts");
const { DEFAULT_BRAIN_GRAPH_LIMITS } = await import(
  "../src/lib/profile/brain-graph-types.ts"
);

after(() => {
  singletonDb.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

function database() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL
    );
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE organization_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(organization_id, user_id)
    );
    CREATE TABLE organization_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      invited_user_id INTEGER NOT NULL,
      invited_by_user_id INTEGER,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE clusters (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      visibility TEXT NOT NULL,
      organization_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_viewed_at TEXT,
      view_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO users (id, username, email) VALUES
      (1, 'ada', 'ada@example.test'),
      (2, 'grace', 'grace@example.test'),
      (3, 'lin', 'lin@example.test');
    INSERT INTO organizations (id, name) VALUES (10, 'Fieldwork'), (20, 'Outside');
    INSERT INTO organization_members (organization_id, user_id, role) VALUES
      (10, 1, 'owner'), (10, 2, 'member'), (20, 3, 'owner');
    INSERT INTO clusters (id, user_id, name, slug, visibility, organization_id) VALUES
      (101, 1, 'Ada private', 'ada-private', 'private', NULL),
      (102, 1, 'Field notes', 'field-notes', 'organization', 10),
      (201, 3, 'Outside notes', 'outside-notes', 'organization', 20);
  `);
  ensureBuzzSchema(db);
  return db;
}

function params(scope, organization) {
  const value = new URLSearchParams({ scope });
  if (organization) value.set("organization", organization);
  return value;
}

test("scope authorization is session-derived, opaque, and revoked immediately", () => {
  const db = database();
  const ada = buildBrainGraphAccessContext(1, db);
  const lin = buildBrainGraphAccessContext(3, db);
  const fieldwork = organizationPublicId(10);

  assert.equal(ada.username, "ada");
  assert.deepEqual(ada.readableGardens.map((garden) => garden.slug).sort(), ["ada-private", "field-notes"]);
  assert.deepEqual(lin.readableGardens.map((garden) => garden.slug), ["outside-notes"]);
  assert.deepEqual(parseBrainScope(params("organization", fieldwork), ada), {
    kind: "organization",
    organizationId: fieldwork,
  });
  assert.throws(
    () => parseBrainScope(params("organization", fieldwork), lin),
    (error) => error instanceof BrainGraphAccessError && error.status === 404,
  );
  assert.throws(
    () => parseBrainScope(params("organization", "org_forged"), ada),
    (error) => error instanceof BrainGraphAccessError && error.status === 404,
  );

  db.prepare("DELETE FROM organization_members WHERE organization_id = 10 AND user_id = 2").run();
  const graceAfterRemoval = buildBrainGraphAccessContext(2, db);
  assert.equal(graceAfterRemoval.organizations.length, 0);
  assert.equal(graceAfterRemoval.readableGardens.length, 0);
  assert.throws(
    () => parseBrainScope(params("organization", fieldwork), graceAfterRemoval),
    (error) => error instanceof BrainGraphAccessError && error.status === 404,
  );
  db.close();
});

test("Buzz channels, private threads, DMs, and group DMs keep their effective access", () => {
  const db = database();
  const publicChannel = buzz.createRoom(db, 10, 1, { name: "general" });
  const privateAda = buzz.createRoom(db, 10, 1, { name: "owner-room", visibility: "private" });
  const privateGrace = buzz.createRoom(db, 10, 2, { name: "member-room", visibility: "private" });
  const dmAda = buzz.createRoom(db, 10, 1, { name: "ada-dm", kind: "dm", visibility: "public" });
  const groupDm = buzz.createRoom(db, 10, 1, { name: "project-dm", kind: "dm", visibility: "private" });
  const outside = buzz.createRoom(db, 20, 3, { name: "outside" });

  const publicAda = buzz.addMember(db, publicChannel.id, { kind: "human", userId: 1, displayName: "Ada" });
  const privateAdaMember = buzz.addMember(db, privateAda.id, { kind: "human", userId: 1, displayName: "Ada" });
  buzz.addMember(db, privateGrace.id, { kind: "human", userId: 2, displayName: "Grace" });
  buzz.addMember(db, dmAda.id, { kind: "human", userId: 1, displayName: "Ada" });
  buzz.addMember(db, groupDm.id, { kind: "human", userId: 1, displayName: "Ada" });
  buzz.addMember(db, groupDm.id, { kind: "human", userId: 2, displayName: "Grace" });
  buzz.addMember(db, outside.id, { kind: "human", userId: 3, displayName: "Lin" });

  const root = buzz.postMessage(db, privateAda.id, {
    clientMessageId: "private-root",
    memberId: privateAdaMember.id,
    authorKind: "human",
    authorName: "Ada",
    body: "Private decision thread",
  });
  buzz.postMessage(db, privateAda.id, {
    clientMessageId: "private-reply",
    memberId: privateAdaMember.id,
    authorKind: "human",
    authorName: "Ada",
    body: "Bounded reply",
    parentId: root.id,
  });
  buzz.postMessage(db, publicChannel.id, {
    clientMessageId: "public-root",
    memberId: publicAda.id,
    authorKind: "human",
    authorName: "Ada",
    body: "Public room root",
    metadata: { pinned: true },
  });

  const ada = buildBrainGraphAccessContext(1, db);
  const grace = buildBrainGraphAccessContext(2, db);
  const all = { kind: "all" };
  const org = { kind: "organization", organizationId: organizationPublicId(10) };
  const adaAll = buzzBrainSource.buildOverview(ada, all, DEFAULT_BRAIN_GRAPH_LIMITS);
  const graceAll = buzzBrainSource.buildOverview(grace, all, DEFAULT_BRAIN_GRAPH_LIMITS);
  const adaOrg = buzzBrainSource.buildOverview(ada, org, DEFAULT_BRAIN_GRAPH_LIMITS);

  const adaIds = new Set(adaAll.nodes.map((node) => node.id));
  const graceIds = new Set(graceAll.nodes.map((node) => node.id));
  const orgIds = new Set(adaOrg.nodes.map((node) => node.id));
  assert.ok(adaIds.has(buzzRoomNodeId(publicChannel.publicId)));
  assert.ok(adaIds.has(buzzRoomNodeId(privateAda.publicId)));
  assert.ok(!graceIds.has(buzzRoomNodeId(privateAda.publicId)), "private channel and its thread are absent");
  assert.ok(graceIds.has(buzzRoomNodeId(privateGrace.publicId)));
  assert.ok(adaIds.has(buzzRoomNodeId(dmAda.publicId)), "DM creator is a participant even if legacy visibility says public");
  assert.ok(!graceIds.has(buzzRoomNodeId(dmAda.publicId)), "organization membership cannot reveal a DM");
  assert.ok(adaIds.has(buzzRoomNodeId(groupDm.publicId)));
  assert.ok(graceIds.has(buzzRoomNodeId(groupDm.publicId)));
  assert.ok(!adaIds.has(buzzRoomNodeId(outside.publicId)));
  assert.ok(!orgIds.has(buzzRoomNodeId(dmAda.publicId)), "organization scope does not absorb personal DMs");
  assert.ok(adaAll.nodes.some((node) => node.kind === "buzz_thread" && node.label.includes("Private decision")));
  assert.ok(!graceAll.nodes.some((node) => node.label.includes("Private decision")));

  const normalized = normalizeBrainGraph(
    [
      adaAll,
      {
        nodes: [],
        edges: [
          {
            id: "cross-org-secret",
            source: buzzRoomNodeId(publicChannel.publicId),
            target: buzzRoomNodeId(outside.publicId),
            relation: "related_to",
            origin: "buzz",
            explicit: true,
          },
        ],
      },
    ],
    { maxNodes: 2_000, maxEdges: 5_000 },
  );
  assert.ok(!normalized.edges.some((edge) => edge.id === "cross-org-secret"));
  assert.equal(normalized.counts.total, normalized.nodes.length);
  assert.equal(normalized.nodes.some((node) => node.label === "outside"), false);
  db.close();
});

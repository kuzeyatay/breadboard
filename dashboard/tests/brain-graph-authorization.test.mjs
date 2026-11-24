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

const { default: singletonDb } = await import("../src/lib/db.ts");
const {
  BrainGraphAccessError,
  buildBrainGraphAccessContext,
  parseBrainScope,
} = await import("../src/lib/profile/brain-graph-auth.ts");
const { organizationPublicId } = await import("../src/lib/profile/brain-graph-ids.ts");

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


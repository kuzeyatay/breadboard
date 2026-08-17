// Organizations: who is in one, who may change it, and which gardens a member
// can see. The interesting parts are the refusals — an admin who cannot touch
// the owner, an owner who cannot walk out on a group that still has people in
// it — and the fact that leaving takes the departing account's shared gardens
// out of the group with them.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-organizations-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/organizations/store.ts");

const ANNA = 1;
const BEN = 2;
const CHLOE = 3;

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM organization_invites;
    DELETE FROM organization_members;
    DELETE FROM organizations;
    DELETE FROM clusters;
    DELETE FROM users;
  `);
  const insert = db.prepare(
    "INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, 'x')",
  );
  insert.run(ANNA, "anna", "anna@example.com");
  insert.run(BEN, "ben", "ben@example.com");
  insert.run(CHLOE, "chloe", "chloe@example.com");
});

function addGarden(userId, slug, visibility, organizationId = null) {
  db.prepare(
    `INSERT INTO clusters (user_id, name, slug, visibility, organization_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, slug, slug, visibility, organizationId);
}

test("the creator owns the organization it created", () => {
  const id = store.createOrganization(ANNA, "  Studio  ");
  const [organization] = store.listOrganizations(ANNA);
  assert.equal(organization.id, id);
  assert.equal(organization.name, "Studio");
  assert.equal(organization.role, "owner");
  assert.deepEqual(
    organization.members.map((member) => member.username),
    ["anna"],
  );
});

test("an invite grants nothing until it is accepted", () => {
  const id = store.createOrganization(ANNA, "Studio");
  store.inviteMember(id, ANNA, "ben@example.com", "member");

  assert.equal(store.memberRole(id, BEN), null);
  assert.deepEqual(store.organizationIdsForUser(BEN), []);

  const [invite] = store.listReceivedInvites(BEN);
  assert.equal(invite.organizationName, "Studio");
  assert.equal(invite.invitedBy, "anna");

  store.respondToInvite(invite.id, BEN, true);
  assert.equal(store.memberRole(id, BEN), "member");
  assert.deepEqual(store.listReceivedInvites(BEN), []);
});

test("a declined invite stays declined", () => {
  const id = store.createOrganization(ANNA, "Studio");
  store.inviteMember(id, ANNA, "ben", "member");
  const [invite] = store.listReceivedInvites(BEN);

  store.respondToInvite(invite.id, BEN, false);
  assert.equal(store.memberRole(id, BEN), null);
  assert.throws(
    () => store.respondToInvite(invite.id, BEN, true),
    /Invite not found/,
  );
});

test("only a member above the rank may invite or promote", () => {
  const id = store.createOrganization(ANNA, "Studio");
  store.inviteMember(id, ANNA, "ben", "member");
  store.respondToInvite(store.listReceivedInvites(BEN)[0].id, BEN, true);

  assert.throws(() => store.inviteMember(id, BEN, "chloe", "member"), /cannot/);

  store.setMemberRole(id, ANNA, BEN, "admin");
  assert.equal(store.memberRole(id, BEN), "admin");

  // An admin may now invite, but still cannot touch the owner.
  store.inviteMember(id, BEN, "chloe", "member");
  assert.throws(() => store.setMemberRole(id, BEN, ANNA, "member"), /owner/);
  assert.throws(() => store.removeMember(id, BEN, ANNA), /owner/);
});

test("handing over the organization swaps the two roles", () => {
  const id = store.createOrganization(ANNA, "Studio");
  store.inviteMember(id, ANNA, "ben", "member");
  store.respondToInvite(store.listReceivedInvites(BEN)[0].id, BEN, true);

  store.setMemberRole(id, ANNA, BEN, "owner");
  assert.equal(store.memberRole(id, BEN), "owner");
  assert.equal(store.memberRole(id, ANNA), "member");
});

test("the owner cannot leave a group that still has people in it", () => {
  const id = store.createOrganization(ANNA, "Studio");
  store.inviteMember(id, ANNA, "ben", "member");
  store.respondToInvite(store.listReceivedInvites(BEN)[0].id, BEN, true);

  assert.throws(() => store.removeMember(id, ANNA, ANNA), /Hand the organization/);

  store.removeMember(id, BEN, BEN);
  store.removeMember(id, ANNA, ANNA);
  assert.deepEqual(store.listOrganizations(ANNA), []);
});

test("only gardens shared with a group the account is in are matched", () => {
  const studio = store.createOrganization(ANNA, "Studio");
  const other = store.createOrganization(CHLOE, "Other");
  store.inviteMember(studio, ANNA, "ben", "member");
  store.respondToInvite(store.listReceivedInvites(BEN)[0].id, BEN, true);

  addGarden(ANNA, "shared", "organization", studio);
  addGarden(ANNA, "kept", "private");
  addGarden(CHLOE, "elsewhere", "organization", other);

  const visible = (userId) =>
    db
      .prepare(
        `SELECT slug FROM clusters c WHERE ${store.organizationClusterClause(userId, "c")}`,
      )
      .all()
      .map((row) => row.slug);

  assert.deepEqual(visible(BEN), ["shared"]);
  assert.deepEqual(visible(CHLOE), ["elsewhere"]);
});

test("an account with no organization matches no shared garden", () => {
  const studio = store.createOrganization(ANNA, "Studio");
  addGarden(ANNA, "shared", "organization", studio);

  assert.equal(store.organizationClusterClause(BEN, "c"), "0");
  const rows = db
    .prepare(
      `SELECT slug FROM clusters c WHERE ${store.organizationClusterClause(BEN, "c")}`,
    )
    .all();
  assert.deepEqual(rows, []);
});

test("leaving takes the departing account's shared gardens with it", () => {
  const studio = store.createOrganization(ANNA, "Studio");
  store.inviteMember(studio, ANNA, "ben", "member");
  store.respondToInvite(store.listReceivedInvites(BEN)[0].id, BEN, true);

  addGarden(BEN, "bens-garden", "organization", studio);
  addGarden(ANNA, "annas-garden", "organization", studio);

  store.removeMember(studio, ANNA, BEN);

  const read = (slug) =>
    db.prepare("SELECT visibility, organization_id FROM clusters WHERE slug = ?").get(slug);
  assert.deepEqual(read("bens-garden"), { visibility: "private", organization_id: null });
  assert.deepEqual(read("annas-garden"), {
    visibility: "organization",
    organization_id: studio,
  });
});

test("deleting an organization makes every garden shared with it private", () => {
  const studio = store.createOrganization(ANNA, "Studio");
  addGarden(ANNA, "shared", "organization", studio);

  store.deleteOrganization(studio, ANNA);
  const row = db
    .prepare("SELECT visibility, organization_id FROM clusters WHERE slug = ?")
    .get("shared");
  assert.deepEqual(row, { visibility: "private", organization_id: null });
});

test("someone already in the group cannot be invited again", () => {
  const studio = store.createOrganization(ANNA, "Studio");
  store.inviteMember(studio, ANNA, "ben", "member");
  store.respondToInvite(store.listReceivedInvites(BEN)[0].id, BEN, true);

  assert.throws(() => store.inviteMember(studio, ANNA, "ben", "member"), /already a member/);
  assert.throws(() => store.inviteMember(studio, ANNA, "nobody", "member"), /No account/);
});

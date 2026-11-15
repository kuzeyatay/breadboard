// End to end: real request signatures checked against keys published on a
// (fake) data server, real envelopes and real message encryption from the
// Breadboard client library. Runs once on SQLite and once on Postgres (PGlite).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { openDatabase, postgresAdapter } from "../lib/db.mjs";
import { serve } from "../lib/http.mjs";
import { createOrgStore, settings } from "../org-store.mjs";
import { did, startFakeNetwork } from "./fake-network.mjs";
import * as crypto from "../../dashboard/src/lib/crumbs/crypto.ts";

const K = "com.breadboard.key";
const net = await startFakeNetwork();
after(async () => { await net.close(); });

function device(owner) {
  const keys = crypto.generateDeviceKeys();
  net.put(owner, K, keys.deviceId, crypto.deviceKeyRecord(keys, "test device"));
  return { did: owner, keys };
}

for (const engine of ["sqlite", "postgres"]) describe(`organization store on ${engine}`, () => {
  let db, server, base;
  const alice = device(did(11)), bob = device(did(12)), carol = device(did(13)), stranger = device(did(14));
  const call = async (who, method, path, body) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const response = await fetch(base + path, { method, body: text || undefined, headers: { "content-type": "application/json", authorization: crypto.signRequest(who.keys, who.did, method, path, text) } });
    return { status: response.status, ...(await response.json()) };
  };
  const envelope = (orgId, epoch, key, to) => ({ did: to.did, device: to.keys.deviceId, envelope: crypto.wrapKey(key, to.keys.agreement, crypto.envelopeContext(orgId, epoch, to.did, to.keys.deviceId)) });
  const context = (orgId, epoch) => `${orgId}\n${epoch}`;
  let orgId, key1, key2;
  const page = "https://example.com/secret-plan";

  before(async () => {
    db = engine === "sqlite" ? await openDatabase({ file: ":memory:" }) : postgresAdapter(new PGlite());
    const store = await createOrgStore({ db, config: { ...settings({}), adminToken: "admin-secret", abuseEmail: "abuse@crumbs.test" } });
    server = await serve({ port: 0, host: "127.0.0.1", handler: store.api, name: "org-test" });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { await new Promise(r => server.close(r)); await db.close(); });

  test("requests need a valid signature from a published device key", async () => {
    assert.equal((await fetch(`${base}/orgs`)).status, 401);
    const forged = crypto.generateDeviceKeys();
    const header = crypto.signRequest({ ...forged, deviceId: alice.keys.deviceId }, alice.did, "GET", "/orgs", "");
    assert.equal((await fetch(`${base}/orgs`, { headers: { authorization: header } })).status, 401, "a key that is not the published one");
    const stale = crypto.signRequest(alice.keys, alice.did, "GET", "/orgs", "", Date.now() - 10 * 60_000);
    assert.equal((await fetch(`${base}/orgs`, { headers: { authorization: stale } })).status, 401, "an old signature");
    const wrongPath = crypto.signRequest(alice.keys, alice.did, "GET", "/orgs/other", "");
    assert.equal((await fetch(`${base}/orgs`, { headers: { authorization: wrongPath } })).status, 401, "a signature for another path");
    assert.equal((await call(alice, "GET", "/orgs")).status, 200);
  });

  test("an admin creates an organization, adds a member, and only members can see it", async () => {
    key1 = crypto.newEpochKey();
    // The id is chosen by the server, so the first envelope is bound to a placeholder and replaced below.
    const created = await call(alice, "POST", "/orgs", { nameCt: "pending", envelopes: [{ did: alice.did, device: alice.keys.deviceId, envelope: "pending" }] });
    assert.equal(created.status, 200);
    orgId = created.id;
    assert.equal((await call(alice, "POST", `/orgs/${orgId}/members`, { did: bob.did })).role, "member");
    assert.equal((await call(bob, "POST", `/orgs/${orgId}/members`, { did: carol.did })).status, 403, "members cannot add people");
    assert.equal((await call(stranger, "GET", `/orgs/${orgId}`)).status, 404, "outsiders cannot tell it exists");
    // The admin starts epoch 2 with real envelopes for both members.
    key1 = crypto.newEpochKey();
    const rotated = await call(alice, "POST", `/orgs/${orgId}/epochs`, { epoch: 2, nameCt: crypto.encryptJson(key1, { name: "Research group" }, context(orgId, 2)), envelopes: [envelope(orgId, 2, key1, alice), envelope(orgId, 2, key1, bob), envelope(orgId, 2, key1, stranger)] });
    assert.equal(rotated.epoch, 2);
    const detail = await call(bob, "GET", `/orgs/${orgId}`);
    assert.deepEqual(detail.members.map(m => [m.did, m.role]), [[alice.did, "admin"], [bob.did, "member"]]);
    assert.ok(!detail.envelopeIndex.some(item => item.did === stranger.did), "no key is stored for a non-member");
    assert.deepEqual(crypto.decryptJson(key1, detail.nameCt, context(orgId, 2)), { name: "Research group" });
  });

  test("a member opens their envelope and reads what another member wrote; the store sees only ciphertext", async () => {
    const mine = (await call(bob, "GET", `/orgs/${orgId}/envelopes`)).envelopes.find(item => item.epoch === 2);
    const bobKey = crypto.unwrapKey(mine.envelope, bob.keys.agreement, crypto.envelopeContext(orgId, 2, bob.did, bob.keys.deviceId));
    assert.ok(bobKey.equals(key1));
    assert.throws(() => crypto.unwrapKey(mine.envelope, carol.keys.agreement, crypto.envelopeContext(orgId, 2, bob.did, bob.keys.deviceId)), "another device cannot open it");

    const id = "11111111-aaaa-4bbb-8ccc-000000000001";
    const ciphertext = crypto.encryptJson(key1, { target: { kind: "text", url: page, title: "Plan", quote: "the launch date" }, body: "Is this still right?", author: "alice.test" }, context(orgId, 2));
    const sig = crypto.signBytes(alice.keys.signing, crypto.messageSigningInput(orgId, 2, id, ciphertext));
    assert.equal((await call(alice, "POST", `/orgs/${orgId}/messages`, { id, epoch: 2, pageIndex: crypto.pageIndex(key1, page), ciphertext, sig })).status, 200);

    const stored = await db.all("SELECT * FROM messages");
    assert.ok(!JSON.stringify(stored).includes("launch date") && !JSON.stringify(stored).includes("example.com"), "no plaintext or page address reaches the store");

    const { messages } = await call(bob, "GET", `/orgs/${orgId}/messages?index=${crypto.pageIndex(bobKey, page)}`);
    assert.equal(messages.length, 1);
    assert.equal(crypto.decryptJson(bobKey, messages[0].ciphertext, context(orgId, 2)).body, "Is this still right?");
    assert.ok(crypto.verifyBytes(alice.keys.signing, crypto.messageSigningInput(orgId, 2, messages[0].id, messages[0].ciphertext), messages[0].sig), "the sender's signature verifies");
    assert.equal((await call(bob, "GET", `/orgs/${orgId}/messages?index=${crypto.pageIndex(bobKey, "https://example.com/other")}`)).messages.length, 0);
    assert.equal((await call(bob, "GET", `/orgs/${orgId}/messages`)).messages.length, 1, "recent messages for the feed");
    assert.equal((await call(stranger, "GET", `/orgs/${orgId}/messages`)).status, 404);
  });

  test("a second device of a member gets the key from any member, never for an outsider", async () => {
    const bobLaptop = device(bob.did);
    assert.equal((await call(bobLaptop, "GET", `/orgs/${orgId}/envelopes`)).envelopes.length, 0);
    assert.equal((await call(bob, "POST", `/orgs/${orgId}/envelopes`, { epoch: 2, envelopes: [envelope(orgId, 2, key1, bobLaptop), envelope(orgId, 2, key1, stranger)] })).status, 200);
    const got = (await call(bobLaptop, "GET", `/orgs/${orgId}/envelopes`)).envelopes[0];
    assert.ok(crypto.unwrapKey(got.envelope, bobLaptop.keys.agreement, crypto.envelopeContext(orgId, 2, bob.did, bobLaptop.keys.deviceId)).equals(key1));
    assert.ok(!(await call(alice, "GET", `/orgs/${orgId}`)).envelopeIndex.some(item => item.did === stranger.did));
  });

  test("members report to the admin; the admin reads the reason and deletes the message", async () => {
    const id = "11111111-aaaa-4bbb-8ccc-000000000002";
    const ciphertext = crypto.encryptJson(key1, { body: "something rude" }, context(orgId, 2));
    await call(bob, "POST", `/orgs/${orgId}/messages`, { id, epoch: 2, pageIndex: crypto.pageIndex(key1, page), ciphertext, sig: crypto.signBytes(bob.keys.signing, crypto.messageSigningInput(orgId, 2, id, ciphertext)) });
    assert.equal((await call(alice, "POST", `/orgs/${orgId}/reports`, { messageId: id, epoch: 2, reasonCt: crypto.encryptJson(key1, { reason: "Not okay" }, context(orgId, 2)) })).status, 200);
    assert.equal((await call(bob, "GET", `/orgs/${orgId}/reports`)).status, 403, "only admins read reports");
    const { reports } = await call(alice, "GET", `/orgs/${orgId}/reports`);
    assert.equal(crypto.decryptJson(key1, reports[0].reasonCt, context(orgId, 2)).reason, "Not okay");
    assert.equal((await call(alice, "DELETE", `/orgs/${orgId}/messages/${id}`)).deleted, true, "an admin can delete anyone's message");
    assert.equal((await call(alice, "GET", `/orgs/${orgId}/reports`)).reports.length, 0);
    assert.equal((await call(bob, "DELETE", `/orgs/${orgId}/messages/11111111-aaaa-4bbb-8ccc-000000000001`)).status, 404, "a member cannot delete someone else's message");
  });

  test("removing a member rotates the key: they keep old messages but can read nothing new", async () => {
    await call(alice, "POST", `/orgs/${orgId}/members`, { did: carol.did });
    await call(alice, "POST", `/orgs/${orgId}/envelopes`, { epoch: 2, envelopes: [envelope(orgId, 2, key1, carol)] });
    assert.equal((await call(carol, "GET", `/orgs/${orgId}/messages`)).messages.length, 1);

    key2 = crypto.newEpochKey();
    assert.equal((await call(bob, "POST", `/orgs/${orgId}/epochs`, { epoch: 3, nameCt: "x", envelopes: [envelope(orgId, 3, key2, bob)], remove: [carol.did] })).status, 403, "only admins rotate");
    const rotated = await call(alice, "POST", `/orgs/${orgId}/epochs`, { epoch: 3, remove: [carol.did], nameCt: crypto.encryptJson(key2, { name: "Research group" }, context(orgId, 3)),
      envelopes: [envelope(orgId, 3, key2, alice), envelope(orgId, 3, key2, bob), envelope(orgId, 3, key2, carol)] });
    assert.equal(rotated.epoch, 3);
    assert.equal((await call(carol, "GET", `/orgs/${orgId}/messages`)).status, 404, "the removed member is locked out");
    assert.equal((await call(carol, "GET", `/orgs/${orgId}/envelopes`)).status, 404);
    assert.equal((await db.all("SELECT 1 AS x FROM envelopes WHERE did=?", [carol.did])).length, 0, "no envelope for the removed member, old or new");

    assert.equal((await call(alice, "POST", `/orgs/${orgId}/messages`, { id: "11111111-aaaa-4bbb-8ccc-000000000003", epoch: 2, pageIndex: crypto.pageIndex(key1, page), ciphertext: "v1.a.b.c", sig: "s" })).status, 409, "the old key is refused for new messages");
    const id = "11111111-aaaa-4bbb-8ccc-000000000004";
    const ciphertext = crypto.encryptJson(key2, { body: "After the rotation" }, context(orgId, 3));
    await call(alice, "POST", `/orgs/${orgId}/messages`, { id, epoch: 3, pageIndex: crypto.pageIndex(key2, page), ciphertext, sig: crypto.signBytes(alice.keys.signing, crypto.messageSigningInput(orgId, 3, id, ciphertext)) });
    assert.throws(() => crypto.decryptJson(key1, ciphertext, context(orgId, 3)), "the key the removed member held does not open new messages");
    // Bob reads the page across both epochs by asking with one index per key he holds.
    const both = await call(bob, "GET", `/orgs/${orgId}/messages?index=${crypto.pageIndex(key1, page)},${crypto.pageIndex(key2, page)}`);
    assert.deepEqual(both.messages.map(m => m.epoch), [2, 3]);
    assert.equal((await call(alice, "POST", `/orgs/${orgId}/epochs`, { epoch: 3, nameCt: "x", envelopes: [envelope(orgId, 3, key2, alice)] })).status, 409, "a stale epoch number is refused");
  });

  test("leaving flags the organization for a key change, and the last admin cannot abandon members", async () => {
    assert.equal((await call(alice, "DELETE", `/orgs/${orgId}/members/me`)).status, 409);
    assert.equal((await call(bob, "DELETE", `/orgs/${orgId}/members/me`)).left, true);
    assert.equal((await call(alice, "GET", `/orgs/${orgId}`)).needsRotation, true);
    assert.deepEqual((await call(bob, "GET", "/orgs")).orgs, []);
  });

  test("the operator can suspend an organization, and an admin can delete it", async () => {
    assert.equal((await fetch(`${base}/admin/orgs/${orgId}/suspend`, { method: "POST" })).status, 401);
    const admin = { method: "POST", headers: { authorization: "Bearer admin-secret", "content-type": "application/json" } };
    assert.equal((await fetch(`${base}/admin/orgs/${orgId}/suspend`, { ...admin, body: "{}" })).status, 200);
    const blocked = await call(alice, "GET", `/orgs/${orgId}/messages`);
    assert.equal(blocked.status, 403);
    assert.match(blocked.error, /suspended.*abuse@crumbs\.test/);
    await fetch(`${base}/admin/orgs/${orgId}/suspend`, { ...admin, body: JSON.stringify({ suspended: false }) });
    assert.equal((await call(alice, "DELETE", `/orgs/${orgId}`)).deleted, true);
    for (const table of ["orgs", "members", "envelopes", "messages", "reports"]) assert.equal((await db.all(`SELECT 1 AS x FROM ${table}`)).length, 0, `${table} is empty`);
  });
});

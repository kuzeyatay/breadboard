import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openDatabase } from "../lib/db.mjs";
import { serve } from "../lib/http.mjs";
import { createIndexer, settings } from "../indexer.mjs";
import { did, startFakeNetwork } from "./fake-network.mjs";

const H = "com.breadboard.highlight";
const page = "https://example.com/article";
const highlight = (comment, quote = "the exact passage", extra = {}) => ({ $type: H, url: page, title: "An article", target: { kind: "text", quote, prefix: "before ", suffix: " after" }, comment, createdAt: "2026-11-15T10:00:00.000Z", ...extra });

let net, db, indexer, server, base, stop;
const alice = did(1), bob = did(2), carol = did(3), dave = did(4), mallory = did(5);
const get = path => fetch(base + path).then(r => r.json());
const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json()) }));
const until = async (check, label) => { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 30)); } assert.fail(`timed out: ${label}`); };

before(async () => {
  net = await startFakeNetwork();
  for (const [id, handle] of [[alice, "alice.test"], [bob, "bob.test"], [carol, "carol.test"], [dave, "dave.test"], [mallory, "mallory.test"]]) net.account(id, handle);
  db = await openDatabase({ file: ":memory:" });
  const config = { ...settings({}), jetstream: net.jetstream, relay: net.origin, reportThreshold: 2, adminToken: "admin-secret", handleDomain: "crumbs.test", publicUrl: "https://crumbs.test" };
  indexer = await createIndexer({ db, config });
  server = await serve({ port: 0, host: "127.0.0.1", handler: indexer.api, name: "indexer-test" });
  base = `http://127.0.0.1:${server.address().port}`;
  stop = indexer.follow(() => {});
  await until(() => net.state.sockets.size === 1, "jetstream connection");
});
after(async () => { await stop(); await new Promise(r => server.close(r)); await db.close(); await net.close(); });

test("subscribes to Breadboard record types only", () => {
  assert.match(net.state.subscribeUrls[0], /wantedCollections=com\.breadboard\.\*/);
});

test("a highlight arriving on Jetstream shows up on its page, grouped by passage", async () => {
  net.push(net.put(alice, H, "a1", highlight("First thought")));
  net.push(net.put(bob, H, "b1", highlight("A reply on the same passage")));
  net.push(net.put(bob, H, "b2", highlight("About something else", "another passage")));
  await until(async () => (await get(`/highlights?url=${encodeURIComponent(page)}`)).threads.length === 2, "two threads");
  const { threads } = await get(`/highlights?url=${encodeURIComponent(page + "#:~:text=ignored")}`);
  assert.deepEqual(threads[0].items.map(item => [item.handle, item.comment]), [["alice.test", "First thought"], ["bob.test", "A reply on the same passage"]]);
  assert.equal(threads[0].target.quote, "the exact passage");
  assert.equal(threads[0].items[0].avatar, "https://cdn.test/alice.test.jpg");
});

test("the moderation gate keeps a failing highlight out of every listing", async () => {
  net.push(net.put(mallory, H, "m1", highlight("you should kill yourself")));
  net.push(net.put(mallory, H, "m2", highlight("buy cheap followers now http://a.test http://b.test")));
  await until(async () => (await get(`/actor?did=${mallory}&all=1`)).items.length === 2, "indexed");
  const mine = await get(`/actor?did=${mallory}&all=1`);
  assert.deepEqual(mine.items.map(item => item.state), ["rejected", "rejected"]);
  assert.equal((await get(`/actor?did=${mallory}`)).items.length, 0);
  const { threads } = await get(`/highlights?url=${encodeURIComponent(page)}`);
  assert.ok(threads.every(thread => thread.items.every(item => item.did !== mallory)));
});

test("an unavailable moderation service holds a highlight as pending, then a retry releases it", async () => {
  const pendingDb = await openDatabase({ file: ":memory:" });
  let up = false;
  const held = await createIndexer({ db: pendingDb, config: { ...settings({}), reportThreshold: 2 }, gate: async () => up ? { status: "visible", reason: null } : { status: "pending", reason: "down" } });
  await held.handleEvent(net.put(carol, H, "c-pending", highlight("Held for review")));
  const read = () => held.api({ method: "GET", path: "/highlights", query: new URLSearchParams({ url: page }), host: "", ip: "", body: {}, headers: {} });
  assert.equal((await read()).threads.length, 0);
  up = true; await held.retryPending();
  assert.equal((await read()).threads[0].items[0].comment, "Held for review");
  net.remove(carol, H, "c-pending"); await pendingDb.close();
});

test("enough reports from other people hide a highlight; the author cannot report-bomb or self-clear", async () => {
  const subject = `at://${alice}/${H}/a1`;
  net.push(net.put(alice, "com.breadboard.report", "self", { subject, reason: "mine" }));
  net.push(net.put(carol, "com.breadboard.report", "r1", { subject, reason: "spam" }));
  await until(async () => (await db.get("SELECT count(*) AS n FROM reports")).n === 2, "reports stored");
  assert.equal((await get(`/highlights?url=${encodeURIComponent(page)}`)).threads[0].items[0].did, alice, "one outside report is below the threshold");
  net.push(net.put(dave, "com.breadboard.report", "r1", { subject, reason: "spam" }));
  await until(async () => (await get(`/highlights?url=${encodeURIComponent(page)}`)).threads[0].items[0].did === bob, "hidden after two reports");
  assert.equal((await get(`/actor?did=${alice}&all=1`)).items.find(item => item.uri === subject).state, "reported");
  // A reporter withdrawing (deleting the record) brings it back.
  net.push(net.remove(dave, "com.breadboard.report", "r1"));
  await until(async () => (await get(`/highlights?url=${encodeURIComponent(page)}`)).threads[0].items[0].did === alice, "restored");
});

test("the admin queue lists reported and rejected items, and a review overrides both", async () => {
  assert.equal((await fetch(`${base}/admin/queue`)).status, 401);
  const auth = { authorization: "Bearer admin-secret" };
  const queue = await fetch(`${base}/admin/queue`, { headers: auth }).then(r => r.json());
  assert.ok(queue.items.some(item => item.uri.includes(mallory) && item.status === "rejected"));
  assert.ok(queue.items.some(item => item.uri === `at://${alice}/${H}/a1` && item.reports === 1));
  await post("/admin/review", { uri: `at://${bob}/${H}/b2`, state: "hidden" }, auth);
  assert.equal((await get(`/highlights?url=${encodeURIComponent(page)}`)).threads.length, 1);
  await post("/admin/review", { uri: `at://${bob}/${H}/b2`, state: "" }, auth);
  assert.equal((await get(`/highlights?url=${encodeURIComponent(page)}`)).threads.length, 2);
});

test("Bluesky labels hide an account, and a takedown removes everything it posted", async () => {
  net.push(net.put(carol, H, "c1", highlight("Carol was here", "carol passage")));
  await until(async () => (await get(`/actor?did=${carol}`)).items.length === 1, "carol indexed");
  net.state.labels.push({ uri: carol, val: "spam", cts: "2026-11-15T11:00:00Z" });
  await db.run("UPDATE accounts SET checked_at=? WHERE did=?", [new Date(0).toISOString(), carol]);
  await indexer.refreshAccounts();
  assert.equal((await get(`/actor?did=${carol}`)).items.length, 0, "labelled account is hidden");
  net.state.labels.push({ uri: carol, val: "spam", neg: true, cts: "2026-11-15T12:00:00Z" });
  await db.run("UPDATE accounts SET checked_at=? WHERE did=?", [new Date(0).toISOString(), carol]);
  await indexer.refreshAccounts();
  assert.equal((await get(`/actor?did=${carol}`)).items.length, 1, "a withdrawn label restores it");
  net.push({ did: carol, time_us: 1, kind: "account", account: { did: carol, active: false, status: "takendown" } });
  await until(async () => (await db.get("SELECT count(*) AS n FROM highlights WHERE did=?", [carol])).n === 0, "takedown purge");
});

test("deleting a record removes it, and the feed follows the requested people newest first", async () => {
  net.push(net.put(dave, H, "d1", highlight("Dave, newest", "dave passage", { createdAt: "2026-11-15T12:00:00.000Z" })));
  net.push(net.put(dave, H, "d2", highlight("Dave, to delete", "dave passage 2")));
  await until(async () => (await get(`/actor?did=${dave}`)).items.length === 2, "dave indexed");
  net.push(net.remove(dave, H, "d2"));
  await until(async () => (await get(`/actor?did=${dave}`)).items.length === 1, "deleted");
  const feed = await post("/feed", { actors: [dave, bob] });
  assert.deepEqual(feed.items.map(item => item.comment), ["Dave, newest", "About something else", "A reply on the same passage"]);
  assert.equal(feed.items[2].threadCount, 2);
  const everyone = await post("/feed", { limit: 2 });
  assert.equal(everyone.items.length, 2);
  assert.ok(everyone.before, "a full page carries a cursor");
  const next = await post("/feed", { limit: 2, before: everyone.before });
  assert.ok(next.items.every(item => item.createdAt < everyone.before));
});

test("notify indexes straight from the author's server without waiting for the stream", async () => {
  net.put(dave, H, "d3", highlight("Posted a second ago", "fresh passage"));
  const result = await post("/notify", { uri: `at://${dave}/${H}/d3` });
  assert.equal(result.status, "visible");
  assert.ok((await get(`/actor?did=${dave}`)).items.some(item => item.comment === "Posted a second ago"));
  assert.equal((await post("/notify", { uri: "at://did:plc:x/app.bsky.feed.post/1" })).status, 400);
});

test("follows and Breadboard handles", async () => {
  net.push(net.put(alice, "com.breadboard.follow", "f1", { subject: bob }));
  net.push(net.put(alice, "com.breadboard.handle", "self", { name: "alice" }));
  net.push(net.put(bob, "com.breadboard.handle", "self", { name: "alice" }));
  net.push(net.put(bob, "com.breadboard.handle", "other", { name: "bobby" }));
  net.push(net.put(carol, "com.breadboard.handle", "self", { name: "admin" }));
  await until(async () => (await get(`/actor?did=${alice}`)).crumbsHandle === "alice.crumbs.test", "handle claimed");
  const actor = await get(`/actor?did=${alice}`);
  assert.deepEqual(actor.follows.map(row => [row.did, row.handle]), [[bob, "bob.test"]]);
  assert.equal((await get(`/actor?did=${bob}`)).followers, 1);
  assert.equal((await get(`/actor?did=${bob}`)).crumbsHandle, null, "a taken name stays with its first owner");
  assert.deepEqual(await get("/handle?name=alice"), { available: false, owner: alice, handle: "alice.crumbs.test" });
  assert.equal((await get("/handle?name=admin")).available, false);
  assert.equal((await get("/handle?name=free-name")).available, true);
  const proof = host => indexer.api({ method: "GET", path: "/.well-known/atproto-did", query: new URLSearchParams(), host, ip: "", body: {}, headers: {} });
  assert.equal((await proof("alice.crumbs.test")).text, alice);
  await assert.rejects(proof("nobody.crumbs.test"), /No such handle/);
});

test("client metadata describes a native app with a loopback redirect", async () => {
  const meta = await get("/client-metadata.json");
  assert.equal(meta.client_id, "https://crumbs.test/client-metadata.json");
  assert.equal(meta.dpop_bound_access_tokens, true);
  assert.deepEqual(meta.redirect_uris, ["http://127.0.0.1/api/crumbs/oauth/callback"]);
  assert.match(await fetch(`${base}/terms`).then(r => r.text()), /Crumbs terms/);
});

test("a rebuild restores every record from the network after the database is lost", async () => {
  const fresh = await openDatabase({ file: ":memory:" });
  const rebuilt = await createIndexer({ db: fresh, config: { ...settings({}), relay: net.origin, reportThreshold: 2 } });
  const summary = await rebuilt.rebuild(() => {});
  assert.ok(summary.accounts >= 4 && summary.records >= 8);
  const read = await rebuilt.api({ method: "GET", path: "/highlights", query: new URLSearchParams({ url: page }), host: "", ip: "", body: {}, headers: {} });
  assert.ok(read.threads.some(thread => thread.items.some(item => item.comment === "First thought")));
  await fresh.close();
});

test("the cursor is saved so a restart resumes instead of starting over", async () => {
  await stop();
  assert.ok(Number((await db.get("SELECT value FROM meta WHERE key='cursor'")).value) > 1_700_000_000_000_000);
  stop = indexer.follow(() => {});
  await until(() => net.state.subscribeUrls.length >= 2 && net.state.sockets.size === 1, "reconnected");
  assert.match(net.state.subscribeUrls.at(-1), /cursor=\d+/);
});

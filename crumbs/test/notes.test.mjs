// Community notes: readers add context to a crumb, others rate it, and a note
// is shown once enough people other than its author find it helpful.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openDatabase } from "../lib/db.mjs";
import { createIndexer, settings } from "../indexer.mjs";
import { did, startFakeNetwork } from "./fake-network.mjs";

const H = "com.breadboard.highlight", N = "com.breadboard.note", R = "com.breadboard.rating";
const page = "https://example.com/claims";
const [author, noter, ann, ben, cy] = [did(51), did(52), did(53), did(54), did(55)];
const crumb = `at://${author}/${H}/c1`, note = `at://${noter}/${N}/n1`;
let net, db, indexer;
const call = (method, path, query = {}, body = {}) => indexer.api({ method, path, query: new URLSearchParams(query), host: "", ip: "", body, headers: {} });
const onPage = async () => (await call("GET", "/highlights", { url: page })).threads[0].items[0];

before(async () => {
  net = await startFakeNetwork();
  for (const [id, handle] of [[author, "author.test"], [noter, "noter.test"], [ann, "ann.test"], [ben, "ben.test"], [cy, "cy.test"]]) net.account(id, handle);
  db = await openDatabase({ file: ":memory:" });
  indexer = await createIndexer({ db, config: { ...settings({}), noteThreshold: 2 } });
  await indexer.handleEvent(net.put(author, H, "c1", { url: page, title: "Claims", target: { kind: "text", quote: "the moon is cheese" }, comment: "This is definitely true", createdAt: "2026-11-15T10:00:00.000Z" }));
});
after(async () => { await db.close(); await net.close(); });

test("a note is collected but not shown until readers rate it helpful", async () => {
  await indexer.handleEvent(net.put(noter, N, "n1", { subject: crumb, body: "Lunar samples are rock, not dairy.", source: "https://example.org/apollo", createdAt: "2026-11-15T10:05:00.000Z" }));
  assert.deepEqual([(await onPage()).noteCount, (await onPage()).note], [1, undefined]);
  // The author rating their own note does not count.
  await indexer.handleEvent(net.put(noter, R, "r", { subject: note, helpful: true }));
  await indexer.handleEvent(net.put(ann, R, "r", { subject: note, helpful: true }));
  assert.equal((await onPage()).note, undefined, "one outside rating is not enough");
  await indexer.handleEvent(net.put(ben, R, "r", { subject: note, helpful: true }));
  assert.deepEqual((await onPage()).note, { uri: note, body: "Lunar samples are rock, not dairy.", source: "https://example.org/apollo", helpful: 2 });
  assert.equal((await call("POST", "/feed", {}, {})).items[0].note.body, "Lunar samples are rock, not dairy.", "the feed carries it too");
});

test("readers who disagree can take a note down again, and a rating can be changed or withdrawn", async () => {
  await indexer.handleEvent(net.put(cy, R, "r", { subject: note, helpful: false }));
  assert.equal((await onPage()).note, undefined, "helpful must lead by the threshold");
  const listed = (await call("GET", "/notes", { subject: crumb, viewer: cy })).notes;
  assert.deepEqual(listed.map(item => [item.handle, item.helpful, item.unhelpful, item.shown, item.myRating]), [["noter.test", 2, 1, false, false]]);
  assert.equal((await call("GET", "/notes", { subject: crumb, viewer: ann })).notes[0].myRating, true);
  assert.equal((await call("GET", "/notes", { subject: crumb })).notes[0].myRating, null);
  await indexer.handleEvent(net.put(cy, R, "r", { subject: note, helpful: true }));
  assert.equal((await onPage()).note.helpful, 3, "changing a rating replaces it");
  await indexer.handleEvent(net.remove(cy, R, "r"));
  await indexer.handleEvent(net.remove(ben, R, "r"));
  assert.equal((await onPage()).note, undefined, "withdrawn ratings stop counting");
  await indexer.handleEvent(net.put(ben, R, "r", { subject: note, helpful: true }));
});

test("notes pass the same moderation gate, and go away with their author or their crumb", async () => {
  await indexer.handleEvent(net.put(ann, N, "bad", { subject: crumb, body: "you should kill yourself", createdAt: "2026-11-15T10:06:00.000Z" }));
  await indexer.handleEvent(net.put(ann, N, "wrong", { subject: "at://did:plc:x/app.bsky.feed.post/1", body: "not a crumb", createdAt: "2026-11-15T10:06:00.000Z" }));
  assert.equal((await call("GET", "/notes", { subject: crumb })).notes.length, 1, "rejected and misdirected notes are not listed");
  await assert.rejects(call("GET", "/notes", { subject: "nonsense" }), /Pass a crumb/);
  await indexer.handleEvent({ did: noter, time_us: 1, kind: "account", account: { did: noter, active: false, status: "takendown" } });
  assert.deepEqual([(await onPage()).noteCount, (await onPage()).note], [0, undefined]);
  net.account(noter, "noter.test");
  await indexer.handleEvent(net.put(ann, N, "n2", { subject: crumb, body: "A second note.", createdAt: "2026-11-15T10:07:00.000Z" }));
  await indexer.handleEvent(net.remove(ann, N, "n2"));
  assert.equal((await db.get("SELECT count(*) AS n FROM notes WHERE uri LIKE '%/n2'")).n, 0);
  // A rebuild brings notes and ratings back from the accounts that hold them.
  const fresh = await openDatabase({ file: ":memory:" });
  const rebuilt = await createIndexer({ db: fresh, config: { ...settings({}), relay: net.origin, noteThreshold: 1 } });
  await rebuilt.rebuild(() => {});
  assert.ok(Number((await fresh.get("SELECT count(*) AS n FROM ratings")).n) >= 2);
  await fresh.close();
});

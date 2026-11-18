// Organization messaging over the encrypted store, the bridge that carries it
// onto the Organization page, and the plan's fallback mode for public crumbs.
// Same setup as crumbs-core.test.mjs: real services in process, a stand-in for
// the AT Protocol network, one local database per person.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Database from 'better-sqlite3';
import { createCrumbs } from '../src/lib/crumbs/core.ts';
import { createBuzzBridge } from '../src/lib/crumbs/buzz-bridge.ts';
import { ensureBuzzSchema } from '../src/lib/buzz/schema.ts';
import { postMessage } from '../src/lib/buzz/store.ts';
import { browserAnnotationFeed, browserAnnotationMine, writeBrowserAnnotation } from '../src/lib/browser-annotations-store.ts';
import { openDatabase } from '../../crumbs/lib/db.mjs';
import { serve } from '../../crumbs/lib/http.mjs';
import { createIndexer, settings as indexerSettings } from '../../crumbs/indexer.mjs';
import { createOrgStore, settings as orgSettings } from '../../crumbs/org-store.mjs';
import { did, startFakeNetwork } from '../../crumbs/test/fake-network.mjs';

process.env.NEXTAUTH_SECRET = 'crumbs-messaging-secret-0123456789';
const E = did(41), F = did(42), B = did(43);
let net, indexerDb, orgDb, servers = [], studio;
const people = {};

function person(name) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT); INSERT INTO users VALUES(1, 'local');
    CREATE TABLE organizations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_by_user_id INTEGER);
    CREATE TABLE organization_members(id INTEGER PRIMARY KEY, organization_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'member', UNIQUE(organization_id, user_id));
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, title TEXT);`);
  ensureBuzzSchema(db);
  const crumbs = createCrumbs({ db });
  return (people[name] = { db, crumbs, bridge: createBuzzBridge({ db, crumbs }) });
}
async function signIn(who, handle) {
  const { url } = await who.crumbs.startSignIn(1, { handle, origin: 'http://localhost:3000' });
  const account = [...net.state.profiles.values()].find(profile => profile.handle === handle);
  assert.equal((await who.crumbs.finishSignIn(net.approve(url, account.did))).error, undefined);
}
const rooms = db => db.prepare('SELECT r.id, r.name, o.name AS org FROM buzz_rooms r JOIN organizations o ON o.id=r.organization_id ORDER BY r.id').all();
const transcript = (db, roomId) => db.prepare("SELECT id, author_name AS author, author_kind AS kind, body, parent_id AS parent, member_id AS member FROM buzz_room_messages WHERE room_id=? AND author_kind<>'system' ORDER BY id").all(roomId);

before(async () => {
  net = await startFakeNetwork();
  net.account(E, 'eve.test'); net.account(F, 'finn.test'); net.account(B, 'bob.test');
  process.env.CRUMBS_SEARCH_URL = net.origin;
  indexerDb = await openDatabase({ file: ':memory:' });
  orgDb = await openDatabase({ file: ':memory:' });
  const indexer = await createIndexer({ db: indexerDb, config: indexerSettings({}) });
  const orgs = await createOrgStore({ db: orgDb, config: orgSettings({}) });
  for (const [name, handler] of [['CRUMBS_INDEXER_URL', indexer.api], ['CRUMBS_ORG_STORE_URL', orgs.api]]) {
    const server = await serve({ port: 0, host: '127.0.0.1', handler, name });
    servers.push(server);
    process.env[name] = `http://127.0.0.1:${server.address().port}`;
  }
  for (const name of ['eve', 'finn', 'bob', 'guest']) person(name);
  await signIn(people.eve, 'eve.test'); await signIn(people.finn, 'finn.test'); await signIn(people.bob, 'bob.test');
});
after(async () => {
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  for (const who of Object.values(people)) who.db.close();
  await indexerDb.close(); await orgDb.close(); await net.close();
});

test('organization chat: rooms and messages are encrypted, verified, and can be polled', async () => {
  const { eve, finn, bob, guest } = people;
  studio = (await eve.crumbs.createOrg(1, 'Studio')).id;
  await eve.crumbs.addOrgMember(1, studio, 'finn.test');
  assert.deepEqual((await eve.crumbs.listRooms(1, studio)).map(room => room.name), ['General']);
  assert.deepEqual((await eve.crumbs.createRoom(1, studio, 'design')).map(room => [room.name, room.own]), [['General', false], ['design', true]]);
  await eve.crumbs.sendChat(1, studio, 'general', 'hello from eve');
  const read = await finn.crumbs.readChat(1, studio, 'general');
  assert.deepEqual(read.messages.map(message => [message.author, message.body, message.own, message.unverified]), [['eve', 'hello from eve', false, undefined]]);
  assert.equal(read.admin, false);
  assert.deepEqual((await finn.crumbs.readChat(1, studio, 'general', read.messages[0].createdAt)).messages, [], 'polling answers only what is new');
  const finnRooms = await finn.crumbs.listRooms(1, studio);
  assert.deepEqual(finnRooms.map(room => [room.name, room.own]), [['General', false], ['design', false]]);
  assert.deepEqual((await finn.crumbs.readChat(1, studio, finnRooms[1].id)).messages, [], 'rooms are separate conversations');
  const stored = JSON.stringify(await orgDb.all('SELECT * FROM messages WHERE org_id=?', [studio]));
  for (const secret of ['hello from eve', 'design', 'crumbs:room']) assert.ok(!stored.includes(secret), `the store never sees "${secret}"`);
  await assert.rejects(guest.crumbs.readChat(1, studio, 'general'), { status: 401 });
  await assert.rejects(bob.crumbs.readChat(1, studio, 'general'), { status: 404 });
  await assert.rejects(finn.crumbs.deleteRoom(1, studio, finnRooms[1].id), { status: 404 }, 'only its creator or an admin removes a room');
  await assert.rejects(eve.crumbs.deleteRoom(1, studio, 'general'), { status: 400 });
  await assert.rejects(eve.crumbs.sendChat(1, studio, 'general', '   '), { status: 400 });
  assert.deepEqual((await eve.crumbs.feed(1, `org:${studio}`)).items, [], 'chat does not show up as crumbs on pages');
});

test('the Organization page: an encrypted organization appears with its rooms, and messages relay both ways', async () => {
  const { eve, finn } = people;
  await eve.bridge.syncAll(1); await finn.bridge.syncAll(1);
  assert.deepEqual(rooms(eve.db).map(room => [room.org, room.name]), [['Studio', 'General'], ['Studio', 'design']]);
  assert.deepEqual(rooms(finn.db).map(room => [room.org, room.name]), [['Studio', 'General'], ['Studio', 'design']]);
  const eveGeneral = rooms(eve.db)[0].id, finnGeneral = rooms(finn.db)[0].id;
  assert.deepEqual(transcript(finn.db, finnGeneral).map(row => [row.author, row.body]), [['eve', 'hello from eve']]);
  assert.deepEqual(transcript(eve.db, eveGeneral).map(row => [row.author, row.body]), [['eve', 'hello from eve']], 'what she sent from elsewhere shows as hers');
  assert.ok(eve.bridge.isLinked(eveGeneral));

  // Finn writes on his Organization page; Eve's page receives it, with his photo.
  const finnSelf = Number(finn.db.prepare("INSERT INTO buzz_room_members(room_id, kind, user_id, display_name, handle, respond_to) VALUES(?, 'human', 1, 'finn', 'finn', 'never')").run(finnGeneral).lastInsertRowid);
  const local = postMessage(finn.db, finnGeneral, { clientMessageId: 'c1', memberId: finnSelf, authorKind: 'human', authorName: 'finn', body: 'hi from finn' });
  await finn.bridge.syncRoom(1, finnGeneral); await eve.bridge.syncRoom(1, eveGeneral);
  const received = transcript(eve.db, eveGeneral).at(-1);
  assert.deepEqual([received.author, received.kind, received.body], ['finn', 'human', 'hi from finn']);
  assert.equal(eve.bridge.memberAvatars(eveGeneral)[received.member], 'https://cdn.test/finn.test.jpg', 'the photo of a member on another machine');
  assert.ok(Object.values(eve.bridge.memberAvatars(eveGeneral)).includes('https://cdn.test/eve.test.jpg'), 'her own photo, from her linked account');

  // A reply in a thread keeps its parent; an agent's finished answer arrives as an agent's.
  postMessage(eve.db, eveGeneral, { clientMessageId: 'c2', memberId: null, authorKind: 'human', authorName: 'eve', body: 'replying in a thread', parentId: received.id });
  postMessage(eve.db, eveGeneral, { clientMessageId: 'c3', memberId: null, authorKind: 'agent', authorName: 'Bread', body: 'An agent answer.' });
  postMessage(eve.db, eveGeneral, { clientMessageId: 'c4', memberId: null, authorKind: 'agent', authorName: 'Bread', body: 'still typing', status: 'streaming' });
  await eve.bridge.syncRoom(1, eveGeneral); await finn.bridge.syncRoom(1, finnGeneral);
  const atFinn = transcript(finn.db, finnGeneral);
  assert.deepEqual(atFinn.slice(-2).map(row => [row.author, row.kind, row.body, row.parent]), [['eve', 'human', 'replying in a thread', local.id], ['Bread', 'agent', 'An agent answer.', null]]);
  assert.ok(!atFinn.some(row => row.body === 'still typing'), 'unfinished answers are not sent');

  // Running again changes nothing: no echoes, no duplicates.
  const count = async () => [transcript(eve.db, eveGeneral).length, transcript(finn.db, finnGeneral).length, (await orgDb.all('SELECT 1 AS x FROM messages WHERE org_id=?', [studio])).length];
  const settled = await count();
  for (let round = 0; round < 2; round++) { await eve.bridge.syncAll(1); await finn.bridge.syncAll(1); }
  assert.deepEqual(await count(), settled);

  // A room made on one Organization page appears on the other.
  const eveOrg = eve.db.prepare('SELECT organization_id AS id FROM buzz_rooms WHERE id=?').get(eveGeneral).id;
  eve.db.prepare("INSERT INTO buzz_rooms(public_id, organization_id, created_by_user_id, slug, name) VALUES('room_planning', ?, 1, 'planning', 'planning')").run(eveOrg);
  await eve.bridge.syncAll(1); await finn.bridge.syncAll(1);
  assert.deepEqual(rooms(finn.db).map(room => room.name), ['General', 'design', 'planning']);

  // Rooms of ordinary, local organizations are never sent anywhere.
  const localOrg = Number(eve.db.prepare("INSERT INTO organizations(name, created_by_user_id) VALUES('Local only', 1)").run().lastInsertRowid);
  const localRoom = Number(eve.db.prepare("INSERT INTO buzz_rooms(public_id, organization_id, created_by_user_id, slug, name) VALUES('room_local', ?, 1, 'local', 'local')").run(localOrg).lastInsertRowid);
  postMessage(eve.db, localRoom, { clientMessageId: 'l1', memberId: null, authorKind: 'human', authorName: 'eve', body: 'stays here' });
  const sent = (await orgDb.all('SELECT 1 AS x FROM messages')).length;
  await eve.bridge.syncAll(1); await eve.bridge.syncRoom(1, localRoom);
  assert.equal((await orgDb.all('SELECT 1 AS x FROM messages')).length, sent);
  assert.equal(eve.bridge.isLinked(localRoom), false);
  assert.ok(!JSON.stringify(await orgDb.all('SELECT * FROM messages')).includes('hi from finn'), 'relayed messages are ciphertext in the store');
});

test('a crumb left in a connected organization reaches the other members as a crumb on that page', async () => {
  const { eve, finn } = people;
  const room = db => db.prepare("SELECT id, public_id AS publicId FROM buzz_rooms WHERE name='design'").get();
  const target = { kind: 'text', url: 'https://example.com/paper', title: 'A paper', quote: 'the result held for twelve weeks' };
  const eveRoom = room(eve.db), finnRoom = room(finn.db);
  eve.db.prepare("INSERT OR IGNORE INTO organization_members(organization_id, user_id, role) SELECT organization_id, 1, 'owner' FROM buzz_rooms WHERE id=?").run(eveRoom.id);
  finn.db.prepare("INSERT OR IGNORE INTO organization_members(organization_id, user_id, role) SELECT organization_id, 1, 'owner' FROM buzz_rooms WHERE id=?").run(finnRoom.id);
  writeBrowserAnnotation(eve.db, 1, 'eve', { scope: `room:${eveRoom.publicId}`, target, action: 'comment', body: 'Worth a second look', source: 'https://example.com/source', operationId: 'op-crumb-1' });
  await eve.bridge.syncRoom(1, eveRoom.id); await finn.bridge.syncRoom(1, finnRoom.id);
  const seen = browserAnnotationFeed(finn.db, 1, `room:${finnRoom.publicId}`);
  assert.deepEqual(seen.map(item => [item.author.displayName, item.comment, item.source, item.target.quote, item.own, item.author.avatar]),
    [['eve', 'Worth a second look', 'https://example.com/source', target.quote, false, 'https://cdn.test/eve.test.jpg']]);
  assert.match(seen[0].url, /example\.com\/paper#:~:text=the%20result/);

  // Finn replies on the same passage; it joins Eve's thread instead of starting a second one.
  writeBrowserAnnotation(finn.db, 1, 'finn', { scope: `room:${finnRoom.publicId}`, target, action: 'comment', body: 'Agreed', operationId: 'op-crumb-2' });
  await finn.bridge.syncRoom(1, finnRoom.id); await eve.bridge.syncRoom(1, eveRoom.id);
  const atEve = browserAnnotationFeed(eve.db, 1, `room:${eveRoom.publicId}`);
  assert.deepEqual(atEve.map(item => [item.comment, item.threadCount, item.own]), [['Worth a second look', 2, true]]);
  assert.deepEqual(browserAnnotationMine(eve.db, 1).map(item => [item.comment, item.audience, item.scope]), [['Worth a second look', 'Studio', `room:${eveRoom.publicId}`]]);
  for (let round = 0; round < 2; round++) { await eve.bridge.syncAll(1); await finn.bridge.syncAll(1); }
  assert.equal(browserAnnotationFeed(eve.db, 1, `room:${eveRoom.publicId}`)[0].threadCount, 2, 'no echoes');
  assert.ok(!JSON.stringify(await orgDb.all('SELECT * FROM messages')).includes('example.com/paper'), 'the store never sees the page');
});

test('a Breadboard organization stays local until it is connected, then appears on Crumbs with its rooms', async () => {
  const { eve } = people;
  const org = Number(eve.db.prepare("INSERT INTO organizations(name, created_by_user_id) VALUES('test organization', 1)").run().lastInsertRowid);
  eve.db.prepare("INSERT INTO organization_members(organization_id, user_id, role) VALUES(?, 1, 'owner')").run(org);
  eve.db.prepare("INSERT INTO buzz_rooms(public_id, organization_id, created_by_user_id, slug, name) VALUES('room_lab', ?, 1, 'lab', 'lab')").run(org);
  await eve.bridge.syncAll(1);
  assert.ok(!(await eve.crumbs.listOrgs(1)).some(item => item.name === 'test organization'), 'syncing alone never publishes a local organization');
  assert.deepEqual(eve.bridge.localOrganizations(1).map(item => item.name), ['test organization']);
  await eve.bridge.connectOrganization(1, org);
  const remote = (await eve.crumbs.listOrgs(1)).find(item => item.name === 'test organization');
  assert.ok(remote, 'connected organizations are listed on Crumbs');
  assert.ok((await eve.crumbs.listRooms(1, remote.id)).some(room => room.name === 'lab'), 'its rooms are announced');
  assert.equal(eve.db.prepare('SELECT COUNT(*) AS n FROM buzz_rooms WHERE organization_id=?').get(org).n, 2, 'the general room it comes with is matched by name, not made twice');
  assert.deepEqual(eve.bridge.localOrganizations(1), []);
  await eve.bridge.syncAll(1);
  assert.equal(eve.db.prepare("SELECT COUNT(*) AS n FROM organizations WHERE name='test organization'").get().n, 1, 'no duplicate local twin');
  await assert.rejects(eve.bridge.connectOrganization(1, org), { status: 404 });
  await assert.rejects(people.finn.bridge.connectOrganization(1, org), { status: 404 }, 'only an owner or admin connects');
  // When the store no longer has it (here: deleted; in life also a move to other servers), the link goes and it can be connected again.
  await eve.crumbs.deleteOrg(1, remote.id);
  await eve.bridge.syncAll(1);
  assert.deepEqual(eve.bridge.localOrganizations(1).map(item => item.name), ['test organization'], 'a stale link is dropped, the organization stays');
  assert.equal(eve.db.prepare('SELECT COUNT(*) AS n FROM buzz_rooms WHERE organization_id=?').get(org).n, 2, 'its rooms stay');
  await eve.bridge.connectOrganization(1, org);
  assert.ok((await eve.crumbs.listOrgs(1)).some(item => item.name === 'test organization'), 'and it connects again');
});

test('fallback mode: a crumb is a normal post with a passage link, read back through Bluesky search', async () => {
  const { bob, guest, eve } = people;
  for (const who of [bob, guest, eve]) who.crumbs.setServers({ publicMode: 'posts' });
  assert.equal(bob.crumbs.status(1).publicMode, 'posts');
  assert.throws(() => bob.crumbs.setServers({ publicMode: 'elsewhere' }), { status: 400 });
  const target = { kind: 'text', url: 'https://example.com/fallback', title: 'Fallback page', quote: 'a passage that is quite a bit longer than twelve words so the link names only its start and its end' };
  await assert.rejects(bob.crumbs.writePublic(1, { target, action: 'comment', body: 'x'.repeat(300) }), { status: 400, message: /300 characters/ });
  const posted = await bob.crumbs.writePublic(1, { target, action: 'comment', body: 'A fallback note' });
  assert.deepEqual(posted.messages.map(message => [message.author, message.body, message.own]), [['bob', 'A fallback note', true]]);
  const [uri, record] = [...net.state.records].find(([key]) => key.startsWith(`at://${B}/app.bsky.feed.post/`));
  assert.equal(record.text, 'A fallback note\n\nexample.com');
  assert.equal(record.facets[0].features[0].uri, 'https://example.com/fallback#:~:text=a%20passage%20that%20is%20quite,its%20start%20and%20its%20end');
  assert.equal(Buffer.from(record.text).subarray(record.facets[0].index.byteStart, record.facets[0].index.byteEnd).toString(), 'example.com', 'the link facet covers the site name');
  assert.equal(record.embed.external.description, target.quote);
  assert.equal((await indexerDb.all('SELECT 1 AS x FROM highlights')).length, 0, 'the Crumbs index is not involved');

  // Anyone reads it without an account, with the exact passage recovered from the link card.
  const seen = await guest.crumbs.readPublic(1, 'https://example.com/fallback');
  assert.equal(seen.threads[0].target.quote, target.quote);
  assert.equal(seen.threads[0].id, posted.thread.id, 'the same passage groups into the same thread');
  assert.deepEqual((await guest.crumbs.readPublic(1, 'https://example.com/fallback', seen.threads[0].id)).messages.map(message => [message.handle, message.body]), [['bob.test', 'A fallback note']]);
  assert.equal((await guest.crumbs.feed(1, 'everyone')).items.find(item => item.id === uri).audience, 'Bluesky');
  assert.deepEqual((await bob.crumbs.feed(1, 'mine')).items.map(item => item.comment), ['A fallback note']);

  // A plain link without a passage is a note on the whole page; a labelled post is not shown.
  net.put(F, 'app.bsky.feed.post', 'p1', { text: 'whole page', createdAt: '2026-11-15T09:00:00.000Z', embed: { external: { uri: 'https://example.com/fallback', title: 'Fallback page' } } });
  net.put(F, 'app.bsky.feed.post', 'p2', { text: 'hidden', createdAt: '2026-11-15T09:01:00.000Z', embed: { external: { uri: 'https://example.com/fallback' } } });
  net.state.postLabels = new Map([[`at://${F}/app.bsky.feed.post/p2`, [{ val: 'spam' }]]]);
  const page = await guest.crumbs.readPublic(1, 'https://example.com/fallback');
  assert.deepEqual(page.threads.map(thread => [thread.target.kind, thread.count]).sort(), [['page', 1], ['text', 1]]);

  // Reports go to Bluesky's moderators; only the author deletes.
  const reported = await eve.crumbs.writePublic(1, { target, action: 'flag', messageId: uri, body: 'spam' });
  assert.match(reported.notice, /Bluesky’s moderators/);
  assert.deepEqual(net.state.moderationReports.map(report => [report.by, report.subject.uri, report.reason]), [[E, uri, 'spam']]);
  await assert.rejects(eve.crumbs.writePublic(1, { target, action: 'delete-comment', messageId: uri }), { status: 404 });
  const afterDelete = await bob.crumbs.writePublic(1, { target, action: 'delete-comment', messageId: uri });
  assert.ok(!afterDelete.threads.some(thread => thread.target.kind === 'text'));
  assert.ok(!net.state.records.has(uri));
  for (const who of [bob, guest, eve]) who.crumbs.setServers({ publicMode: 'records' });
  assert.equal(bob.crumbs.status(1).publicMode, 'records');
});

// Organization messaging over the encrypted store, the bridge that carries it
// onto the Organization page, and the plan's fallback mode for public crumbs.
// Same setup as crumbs-core.test.mjs: real services in process, a stand-in for
// the AT Protocol network, one local database per person.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Database from 'better-sqlite3';
import { createCrumbs } from '../src/lib/crumbs/core.ts';
import { createBuzzBridge } from '../src/lib/crumbs/buzz-bridge.ts';
import { createOrgListener } from '../src/lib/crumbs/org-listener.ts';
import { decryptFile, encryptFile } from '../src/lib/drive/drive-client.ts';
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

// A stand-in Google Drive shared by everyone, holding what the real one would: ciphertext, by id.
const driveFiles = new Map();
const driveTrouble = { failNext: 0, gone: new Set() };
class FakeDriveError extends Error { constructor(retry, message) { super(message); this.retry = retry; } }
/** The server's file adapter, with each person's file store in memory. */
function fakeFiles() {
  const blobs = new Map();
  return { blobs, adapter: {
    async upload(_userId, file) {
      const blob = blobs.get(file.blobId);
      const { ciphertext, key } = encryptFile(blob.bytes);
      const drive = `drv${driveFiles.size + 1}abcdefgh`;
      driveFiles.set(drive, ciphertext);
      return { drive, key, name: file.name, size: blob.bytes.length };
    },
    async receive(_userId, ref) {
      if (driveTrouble.failNext > 0) { driveTrouble.failNext--; throw new FakeDriveError(true, 'Google Drive did not send the file.'); }
      if (driveTrouble.gone.has(ref.drive) || !driveFiles.has(ref.drive)) throw new FakeDriveError(false, 'The sender removed this file from their Google Drive.');
      const blobId = `fil_${String(blobs.size + 1).padStart(32, '0')}`;
      const bytes = decryptFile(driveFiles.get(ref.drive), ref.key);
      blobs.set(blobId, { bytes, name: ref.name });
      return { blobId, format: 'bin', sizeBytes: bytes.length };
    },
    retryable: error => error instanceof FakeDriveError ? error.retry : true,
  } };
}

function person(name) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT); INSERT INTO users VALUES(1, 'local');
    CREATE TABLE organizations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_by_user_id INTEGER);
    CREATE TABLE organization_members(id INTEGER PRIMARY KEY, organization_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'member', UNIQUE(organization_id, user_id));
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, title TEXT);`);
  ensureBuzzSchema(db);
  const crumbs = createCrumbs({ db });
  const files = fakeFiles();
  return (people[name] = { db, crumbs, files: files.blobs, bridge: createBuzzBridge({ db, crumbs, files: files.adapter }) });
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

test('edits, deletions and reactions relay between machines, and only their author can edit or delete', async () => {
  const { eve, finn } = people;
  const general = db => db.prepare("SELECT id FROM buzz_rooms WHERE name='General'").get().id;
  const eveGeneral = general(eve.db), finnGeneral = general(finn.db);
  const row = (db, roomId, body) => db.prepare('SELECT id, body, deleted_at FROM buzz_room_messages WHERE room_id=? AND body=?').get(roomId, body);
  const remoteId = (db, messageId) => db.prepare('SELECT remote_id FROM crumbs_buzz_messages WHERE message_id=?').get(messageId).remote_id;
  const both = async () => { await finn.bridge.syncRoom(1, finnGeneral); await eve.bridge.syncRoom(1, eveGeneral); await finn.bridge.syncRoom(1, finnGeneral); };

  // Finn edits his message; Eve's copy follows.
  const finnLine = row(finn.db, finnGeneral, 'hi from finn');
  finn.db.prepare("UPDATE buzz_room_messages SET body='hi from finn, edited', edited_at=datetime('now') WHERE id=?").run(finnLine.id);
  finn.bridge.recordChange(finnGeneral, finnLine.id, { kind: 'edit' });
  await both();
  const atEve = row(eve.db, eveGeneral, 'hi from finn, edited');
  assert.ok(atEve, 'the edit arrived');

  // Eve reacts to it; Finn sees the reaction under Eve's seat, and taking it back removes it there too.
  const eveSeat = eve.db.prepare('SELECT id FROM buzz_room_members WHERE room_id=? AND user_id=1').get(eveGeneral).id;
  const reactions = () => finn.db.prepare('SELECT r.emoji, m.display_name AS who FROM buzz_room_reactions r JOIN buzz_room_members m ON m.id=r.member_id WHERE r.message_id=?').all(finnLine.id);
  eve.db.prepare("INSERT INTO buzz_room_reactions(message_id, member_id, emoji) VALUES(?, ?, '👍')").run(atEve.id, eveSeat);
  eve.bridge.recordChange(eveGeneral, atEve.id, { kind: 'react', emoji: '👍', on: true });
  await both();
  assert.deepEqual(reactions(), [{ emoji: '👍', who: 'eve' }]);
  for (let round = 0; round < 2; round++) await both();
  assert.deepEqual(reactions(), [{ emoji: '👍', who: 'eve' }], 'relaying again changes nothing');
  eve.db.prepare('DELETE FROM buzz_room_reactions WHERE message_id=? AND member_id=?').run(atEve.id, eveSeat);
  eve.bridge.recordChange(eveGeneral, atEve.id, { kind: 'react', emoji: '👍', on: false });
  await both();
  assert.deepEqual(reactions(), []);

  // Someone else's edit or deletion of Finn's message is ignored on his machine.
  const studioId = eve.db.prepare('SELECT org_id FROM crumbs_buzz_rooms WHERE room_id=?').get(eveGeneral).org_id;
  await finn.crumbs.sendChatEvent(1, studioId, 'general', { kind: 'edit', target: remoteId(eve.db, row(eve.db, eveGeneral, 'hello from eve').id), body: 'forged by finn' });
  await both();
  assert.ok(row(eve.db, eveGeneral, 'hello from eve'), 'a member cannot rewrite what another member wrote');

  // Finn deletes his message: gone on both machines, and the ciphertext leaves the store.
  const before = (await orgDb.all('SELECT id FROM messages WHERE id=?', [remoteId(finn.db, finnLine.id)])).length;
  finn.db.prepare("UPDATE buzz_room_messages SET body='', deleted_at=datetime('now') WHERE id=?").run(finnLine.id);
  finn.bridge.recordChange(finnGeneral, finnLine.id, { kind: 'delete' });
  await both();
  assert.ok(eve.db.prepare('SELECT deleted_at FROM buzz_room_messages WHERE id=?').get(atEve.id).deleted_at, 'deleted on the other machine');
  assert.equal(before, 1);
  assert.equal((await orgDb.all('SELECT id FROM messages WHERE id=?', [remoteId(finn.db, finnLine.id)])).length, 0, 'and removed from the store');

  // A change to a message that never left the machine is dropped, not sent.
  const unsent = postMessage(eve.db, eveGeneral, { clientMessageId: 'never-sent', memberId: eveSeat, authorKind: 'human', authorName: 'eve', body: 'oops' });
  eve.db.prepare("UPDATE buzz_room_messages SET body='', deleted_at=datetime('now') WHERE id=?").run(unsent.id);
  eve.bridge.recordChange(eveGeneral, unsent.id, { kind: 'delete' });
  await eve.bridge.syncRoom(1, eveGeneral);
  assert.equal(eve.db.prepare('SELECT COUNT(*) AS n FROM crumbs_buzz_outbox').get().n, 0);
  assert.ok(!JSON.stringify(await orgDb.all('SELECT * FROM messages')).includes('forged by finn'), 'events are ciphertext too');

  // Bread answers on Eve's machine; she regenerates it. Finn's copy is replaced once the new answer has
  // finished — not while it is being written — and is not marked edited.
  const answer = postMessage(eve.db, eveGeneral, { clientMessageId: 'bread-1', memberId: null, authorKind: 'agent', authorName: 'Bread', body: 'The first answer.' });
  await both();
  const atFinn = row(finn.db, finnGeneral, 'The first answer.');
  assert.equal(finn.db.prepare('SELECT author_kind FROM buzz_room_messages WHERE id=?').get(atFinn.id).author_kind, 'agent');
  eve.db.prepare("UPDATE buzz_room_messages SET body='The second answ', status='pending' WHERE id=?").run(answer.id);
  assert.equal(eve.bridge.hasOutgoing(1, eveGeneral), false, 'nothing to send while it is being written');
  await both();
  assert.equal(finn.db.prepare('SELECT body FROM buzz_room_messages WHERE id=?').get(atFinn.id).body, 'The first answer.');
  eve.db.prepare("UPDATE buzz_room_messages SET body='The second answer.', status='complete' WHERE id=?").run(answer.id);
  assert.equal(eve.bridge.hasOutgoing(1, eveGeneral), true, 'the live push picks it up');
  await both();
  const replaced = finn.db.prepare('SELECT body, edited_at FROM buzz_room_messages WHERE id=?').get(atFinn.id);
  assert.deepEqual([replaced.body, replaced.edited_at], ['The second answer.', null]);
  assert.equal(eve.bridge.hasOutgoing(1, eveGeneral), false, 'sent once');
  // Only the machine that ran the answer can replace it.
  await finn.crumbs.sendChatEvent(1, studioId, 'general', { kind: 'edit', target: remoteId(eve.db, answer.id), body: 'forged answer' });
  await both();
  assert.equal(finn.db.prepare('SELECT body FROM buzz_room_messages WHERE id=?').get(atFinn.id).body, 'The second answer.');
  assert.equal(eve.db.prepare('SELECT body FROM buzz_room_messages WHERE id=?').get(answer.id).body, 'The second answer.');
});

test('people are added to an organization on Crumbs by their Crumbs account, from the Organization page', async () => {
  const { eve, bob } = people;
  const eveGeneral = eve.db.prepare("SELECT id FROM buzz_rooms WHERE name='General'").get().id;
  const found = await eve.bridge.findPeople(1, eveGeneral, 'bo');
  assert.deepEqual(found.map(person => person.handle), ['bob.test']);
  assert.deepEqual((await eve.bridge.findPeople(1, eveGeneral, 'ev')), [], 'never yourself');
  const member = await eve.bridge.addPerson(1, eveGeneral, B);
  assert.deepEqual([member.kind, member.userId, member.displayName], ['human', null, 'bob']);
  assert.deepEqual(await eve.bridge.findPeople(1, eveGeneral, 'bo'), [], 'someone seated is not offered again');
  // Bob's Breadboard lists the organization and can read and write in it.
  await bob.bridge.syncAll(1);
  const bobGeneral = bob.db.prepare("SELECT r.id FROM buzz_rooms r JOIN organizations o ON o.id=r.organization_id WHERE o.name='Studio' AND r.name='General'").get().id;
  assert.ok(transcript(bob.db, bobGeneral).some(row => row.body === 'hello from eve'), 'history arrives with the key');
  // A room of a local organization offers no Crumbs accounts.
  const localRoom = eve.db.prepare("SELECT id FROM buzz_rooms WHERE name='local'").get().id;
  assert.deepEqual(await eve.bridge.findPeople(1, localRoom, 'bo'), []);
  await assert.rejects(eve.bridge.addPerson(1, localRoom, B), { status: 409 });
});

test('a Breadboard organization goes on Crumbs by itself; one that was dropped waits to be connected again', async () => {
  const { eve } = people;
  const org = Number(eve.db.prepare("INSERT INTO organizations(name, created_by_user_id) VALUES('test organization', 1)").run().lastInsertRowid);
  eve.db.prepare("INSERT INTO organization_members(organization_id, user_id, role) VALUES(?, 1, 'owner')").run(org);
  eve.db.prepare("INSERT INTO buzz_rooms(public_id, organization_id, created_by_user_id, slug, name) VALUES('room_lab', ?, 1, 'lab', 'lab')").run(org);
  await eve.bridge.syncAll(1);
  const remote = (await eve.crumbs.listOrgs(1)).find(item => item.name === 'test organization');
  assert.ok(remote, 'an organization its owner made here is put on Crumbs by the sync');
  assert.ok((await eve.crumbs.listRooms(1, remote.id)).some(room => room.name === 'lab'), 'its rooms are announced');
  assert.equal(eve.db.prepare('SELECT COUNT(*) AS n FROM buzz_rooms WHERE organization_id=?').get(org).n, 2, 'the general room it comes with is matched by name, not made twice');
  assert.deepEqual(eve.bridge.localOrganizations(1), []);
  await eve.bridge.syncAll(1);
  assert.equal(eve.db.prepare("SELECT COUNT(*) AS n FROM organizations WHERE name='test organization'").get().n, 1, 'no duplicate local twin');
  assert.equal((await eve.crumbs.listOrgs(1)).filter(item => item.name === 'test organization').length, 1, 'nor a second one on Crumbs');
  await assert.rejects(eve.bridge.connectOrganization(1, org), { status: 404 });
  await assert.rejects(people.finn.bridge.connectOrganization(1, org), { status: 404 }, 'only an owner or admin connects');
  // When the store no longer has it (left, deleted, servers moved), the link goes and it is not put back by itself.
  await eve.crumbs.deleteOrg(1, remote.id);
  await eve.bridge.syncAll(1); await eve.bridge.syncAll(1);
  assert.ok(!(await eve.crumbs.listOrgs(1)).some(item => item.name === 'test organization'), 'a dropped organization is not republished');
  assert.deepEqual(eve.bridge.localOrganizations(1).map(item => item.name), ['test organization'], 'it stays, ready to connect');
  assert.equal(eve.db.prepare('SELECT COUNT(*) AS n FROM buzz_rooms WHERE organization_id=?').get(org).n, 2, 'its rooms stay');
  await eve.bridge.connectOrganization(1, org);
  assert.ok((await eve.crumbs.listOrgs(1)).some(item => item.name === 'test organization'), 'and it connects again by hand');
});

test('live: a message sent on one machine reaches the other through the store signal, with no polling', async () => {
  const { eve, finn } = people;
  const general = db => db.prepare("SELECT r.id FROM buzz_rooms r JOIN organizations o ON o.id=r.organization_id WHERE o.name='Studio' AND r.name='General'").get().id;
  const eveGeneral = general(eve.db), finnGeneral = general(finn.db);
  const changes = [];
  let arrived;
  const waitFor = new Promise(resolve => { arrived = resolve; });
  const listener = createOrgListener({ crumbs: eve.crumbs, bridge: eve.bridge, retryMs: 50,
    onChange: (userId, roomIds) => { changes.push(roomIds); if (roomIds?.includes(eveGeneral)) arrived(); } });
  try {
    listener.start(1);
    for (let i = 0; i < 100 && !listener.isLive(1); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(listener.isLive(1), 'connected and caught up');
    const finnSelf = finn.db.prepare('SELECT id FROM buzz_room_members WHERE room_id=? AND user_id=1').get(finnGeneral).id;
    postMessage(finn.db, finnGeneral, { clientMessageId: 'live-1', memberId: finnSelf, authorKind: 'human', authorName: 'finn', body: 'pushed, not polled' });
    await finn.bridge.syncRoom(1, finnGeneral);
    await Promise.race([waitFor, new Promise((_, reject) => setTimeout(() => reject(new Error('no live signal within 5s')), 5000))]);
    assert.ok(transcript(eve.db, eveGeneral).some(row => row.body === 'pushed, not polled'), 'in her transcript without her syncing');
    assert.ok(eve.bridge.hasOutgoing(1) === false, 'nothing of hers waiting to be sent');
  } finally { listener.stopAll(); }
  assert.equal(listener.isLive(1), false);
});

test('files: shared through Drive encrypted, kept in the reader’s own store, retried, and named when gone', async () => {
  const { eve, finn } = people;
  const general = db => db.prepare("SELECT r.id FROM buzz_rooms r JOIN organizations o ON o.id=r.organization_id WHERE o.name='Studio' AND r.name='General'").get().id;
  const eveGeneral = general(eve.db), finnGeneral = general(finn.db);
  const eveSeat = eve.db.prepare('SELECT id FROM buzz_room_members WHERE room_id=? AND user_id=1').get(eveGeneral).id;
  const attachmentsAt = (db, roomId, clientId) => JSON.parse(db.prepare("SELECT m.metadata FROM buzz_room_messages m WHERE m.room_id=? AND m.client_message_id=?").get(roomId, clientId).metadata).attachments;
  const remote = (db, messageId) => db.prepare('SELECT remote_id FROM crumbs_buzz_messages WHERE message_id=?').get(messageId).remote_id;
  const send = (clientMessageId, body, files) => {
    const attachments = files.map(([blobId, name, text]) => { eve.files.set(blobId, { bytes: Buffer.from(text), name }); return { type: 'file', name, blobId, format: 'bin', sizeBytes: text.length }; });
    return postMessage(eve.db, eveGeneral, { clientMessageId, memberId: eveSeat, authorKind: 'human', authorName: 'eve', body, metadata: { attachments } });
  };

  // A message that is only a file still goes out, and arrives openable on the other machine.
  const only = send('file-1', '', [['fil_eve00000000000000000000000000001', 'plan.pdf', 'PDF bytes of the plan']]);
  await eve.bridge.syncRoom(1, eveGeneral); await finn.bridge.syncRoom(1, finnGeneral);
  const [received] = attachmentsAt(finn.db, finnGeneral, `crumbs:${remote(eve.db, only.id)}`);
  assert.equal(received.name, 'plan.pdf');
  assert.equal(finn.files.get(received.blobId).bytes.toString(), 'PDF bytes of the plan', 'a copy in his own store');
  for (const bytes of driveFiles.values()) assert.ok(!bytes.toString().includes('PDF bytes'), 'Drive holds ciphertext only');
  assert.ok(!JSON.stringify(await orgDb.all('SELECT * FROM messages')).includes('plan.pdf'), 'the store never sees a file name');

  // Sending the same file again uploads nothing new.
  const uploads = driveFiles.size;
  send('file-2', 'the plan again', [['fil_eve00000000000000000000000000001', 'plan.pdf', 'PDF bytes of the plan']]);
  await eve.bridge.syncRoom(1, eveGeneral);
  assert.equal(driveFiles.size, uploads);

  // A download that fails is shown by name, then filled in when it is tried again.
  const flaky = send('file-3', 'figures', [['fil_eve00000000000000000000000000002', 'figures.csv', 'a,b;1,2']]);
  driveTrouble.failNext = 1;
  await eve.bridge.syncRoom(1, eveGeneral); await finn.bridge.syncRoom(1, finnGeneral);
  const flakyAt = `crumbs:${remote(eve.db, flaky.id)}`;
  assert.deepEqual(attachmentsAt(finn.db, finnGeneral, flakyAt).map(item => [item.name, item.blobId]), [['figures.csv', undefined]]);
  assert.equal(finn.db.prepare('SELECT COUNT(*) AS n FROM crumbs_buzz_pending_files').get().n, 1);
  finn.db.prepare('UPDATE crumbs_buzz_pending_files SET next_at=0').run();
  await finn.bridge.syncRoom(1, finnGeneral);
  const filled = attachmentsAt(finn.db, finnGeneral, flakyAt)[0];
  assert.equal(finn.files.get(filled.blobId).bytes.toString(), 'a,b;1,2');
  assert.equal(finn.db.prepare('SELECT COUNT(*) AS n FROM crumbs_buzz_pending_files').get().n, 0);

  // One the sender removed from Drive says so instead of retrying forever.
  const gone = send('file-4', 'old notes', [['fil_eve00000000000000000000000000003', 'notes.md', '# notes']]);
  await eve.bridge.syncRoom(1, eveGeneral);
  driveTrouble.gone.add(eve.db.prepare("SELECT drive FROM crumbs_buzz_files WHERE blob_id='fil_eve00000000000000000000000000003'").get().drive);
  await finn.bridge.syncRoom(1, finnGeneral);
  const missing = attachmentsAt(finn.db, finnGeneral, `crumbs:${remote(eve.db, gone.id)}`)[0];
  assert.deepEqual([missing.name, missing.blobId, missing.unavailable], ['notes.md', undefined, 'The sender removed this file from their Google Drive.']);
  assert.equal(finn.db.prepare('SELECT COUNT(*) AS n FROM crumbs_buzz_pending_files').get().n, 0);
  assert.equal(eve.bridge.hasOutgoing(1), false);
});


test('an admin sets the organization picture and name once, and every member sees them; a member cannot', async () => {
  const { eve, finn } = people;
  const localOf = person => person.db.prepare('SELECT organization_id AS id FROM crumbs_buzz_orgs WHERE org_id=?').get(studio).id;
  const picture = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4IAoAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==';
  await eve.bridge.updateOrganization(1, localOf(eve), { name: 'Studio North', image: picture });
  await finn.bridge.syncOrganizations(1);
  assert.deepEqual(finn.db.prepare('SELECT name, image FROM organizations WHERE id=?').get(localOf(finn)), { name: 'Studio North', image: picture });
  const stored = JSON.stringify(await orgDb.all('SELECT * FROM messages WHERE org_id=?', [studio]));
  assert.ok(!stored.includes('Studio North') && !stored.includes('UklGR'), 'the store never sees the settings');

  // Finn is a member, not an admin: his machine refuses, and the others would ignore his record anyway.
  await assert.rejects(finn.bridge.updateOrganization(1, localOf(finn), { image: null }), { status: 403 });
  // Clearing the picture is a change like any other.
  await eve.bridge.updateOrganization(1, localOf(eve), { image: null });
  await finn.bridge.syncOrganizations(1);
  assert.deepEqual(finn.db.prepare('SELECT name, image FROM organizations WHERE id=?').get(localOf(finn)), { name: 'Studio North', image: null });
});

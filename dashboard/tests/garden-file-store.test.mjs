import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { GardenFileStore, gardenFilePath } from '../src/lib/garden-files/store.ts';
import { gardenFileContentResponse } from '../src/lib/garden-files/content-response.ts';

function fixture(t, limit) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-files-'));
  const database = new Database(path.join(root, 'files.db'));
  database.pragma('foreign_keys = ON');
  database.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE clusters(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2); INSERT INTO clusters VALUES(1),(2)');
  const store = new GardenFileStore(database, path.join(root, 'originals'), limit);
  const scope = { gardenId: 'demo', clusterId: 1, userId: 1, ownerId: 1 };
  t.after(() => { database.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const put = async (name, bytes = 'original', key) => store.import(scope, name, await store.stage(Readable.from([bytes])), key);
  return { store, scope, put, root, database };
}

test('unknown formats and nested Unicode names round-trip without changing bytes', async t => {
  const { store, scope, put } = fixture(t);
  const bytes = Buffer.from([0, 255, 10, 0, 13, 1]);
  const file = await put('Research/Δοκιμή/原本.unknown', bytes);
  assert.equal(file.name, '原本.unknown'); assert.equal(file.capabilities.viewer, 'binary');
  assert.deepEqual(fs.readFileSync(store.content(scope, file.id).path), bytes);
  assert.equal(store.list(scope).filter(entry => entry.kind === 'folder').length, 2);
  assert.equal(file.visibility, 'private');
  const again = await put('Research/Δοκιμή/原本.unknown', 'second');
  assert.equal(again.name, '原本 (2).unknown');
  const zero = await put('empty.txt', Buffer.alloc(0)); assert.equal(zero.size, 0);
});

test('retry is idempotent, failed transfers leave no visible entry or blob', async t => {
  const { store, scope, put, root } = fixture(t, 32);
  const first = await put('data.bin', 'kept', 'same-import');
  const retry = await put('data.bin', 'kept', 'same-import');
  assert.equal(retry.id, first.id);
  await assert.rejects(store.stage(Readable.from([Buffer.alloc(33)])), /upload limit/);
  const broken = Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('disconnected'); })());
  await assert.rejects(store.stage(broken), /disconnected/);
  assert.equal(store.list(scope).length, 1);
  assert.equal(fs.readdirSync(path.join(root, 'originals', 'blobs')).length, 1);
});

test('versions, optimistic saves and copies retain independent original content', async t => {
  const { store, scope, put } = fixture(t);
  const first = await put('draft.txt');
  const second = store.save(scope, first.id, first.revision, await store.stage(Readable.from(['edited'])));
  assert.equal(second.version, 2);
  const obsolete = await store.stage(Readable.from(['stale']));
  assert.throws(() => store.save(scope, first.id, first.revision, obsolete), { code: 'file_revision_conflict' });
  assert.equal(fs.existsSync(store.blobPath(obsolete.blob)), false);
  const copy = store.copy(scope, first.id);
  const restored = store.restoreVersion(scope, first.id, second.revision, 1);
  assert.equal(restored.version, 3);
  assert.equal(fs.readFileSync(store.content(scope, first.id).path, 'utf8'), 'original');
  assert.equal(fs.readFileSync(store.content(scope, copy.id).path, 'utf8'), 'edited');
  assert.equal(store.versions(scope, first.id).length, 3);
});

test('folder rename, copy, trash, restore keep IDs and descendants consistent', async t => {
  const { store, scope, put } = fixture(t);
  const file = await put('Reports/2026/results.csv');
  const folder = store.list(scope).find(entry => entry.path === 'Reports');
  const renamed = store.move(scope, folder.id, folder.revision, 'Results');
  assert.equal(store.get(scope, file.id).path, 'Results/2026/results.csv');
  assert.throws(() => store.move(scope, folder.id, renamed.revision, 'Results/nested'), /inside itself/);
  const copied = store.copy(scope, folder.id);
  assert.equal(copied.path, 'Results (2)');
  store.trash(scope, folder.id, renamed.revision);
  assert.throws(() => store.get(scope, file.id), { status: 404 });
  store.restore(scope, folder.id);
  assert.equal(store.get(scope, file.id).path, 'Results/2026/results.csv');
  assert.equal(store.list(scope, true).length, 0);
});

test('sharing never exposes private files, previous versions or mutation authority', async t => {
  const { store, scope, put } = fixture(t);
  const guest = { ...scope, userId: 2 }, anonymous = { ...scope, userId: null };
  const first = await put('Private/notes.txt');
  assert.deepEqual(store.list(guest), []);
  assert.throws(() => store.content(guest, first.id), { status: 404 });
  const second = store.save(scope, first.id, first.revision, await store.stage(Readable.from(['public revision'])));
  const shared = store.share(scope, first.id, second.revision, 'garden');
  assert.equal(store.list(anonymous).length, 1);
  assert.equal(store.get(guest, first.id).canEdit, false);
  assert.throws(() => store.content(guest, first.id, 1), { status: 403 });
  assert.throws(() => store.trash(guest, first.id, shared.revision), { status: 403 });
  assert.throws(() => store.get({ ...scope, clusterId: 2 }, first.id), { status: 404 });
  store.share(scope, first.id, shared.revision, 'private');
  assert.throws(() => store.content(anonymous, first.id), { status: 404 });
});

test('malformed paths, collisions and file parents cannot corrupt the tree', async t => {
  const { store, scope, put } = fixture(t);
  for (const value of ['../a', '/a', 'a/../b', 'C:/file', 'a\0b', 'a//b', 'a/./b']) assert.throws(() => gardenFilePath(value), { status: 400 });
  const a = await put('A.txt'); await put('B.txt');
  assert.throws(() => store.move(scope, a.id, a.revision, 'b.TXT'), { status: 409 });
  assert.throws(() => store.createFolder(scope, 'A.txt/nested'), { status: 409 });
  assert.equal(store.list(scope).length, 2);
});

test('HTTP byte ranges, HEAD, download names and invalid ranges are correct', async t => {
  const { store, scope, put } = fixture(t);
  const file = await put('α.mp4', Buffer.from('0123456789'));
  const response = (range, method = 'GET') => gardenFileContentResponse(new Request('http://local/file', { method, headers: range ? { Range: range } : {} }), store, scope, file.id);
  let result = response('bytes=2-5'); assert.equal(result.status, 206); assert.equal(await result.text(), '2345');
  assert.equal(result.headers.get('Content-Range'), 'bytes 2-5/10');
  assert.equal(await response('bytes=-3').text(), '789');
  assert.equal(response('bytes=90-100').status, 416); assert.equal(response('bytes=2-1').status, 416);
  assert.equal(response('bytes=0-1,3-4').status, 416);
  result = response(undefined, 'HEAD'); assert.equal(result.headers.get('Content-Length'), '10'); assert.equal(await result.text(), '');
  assert.match(result.headers.get('Content-Disposition'), /filename\*=UTF-8''%CE%B1.mp4/);
});

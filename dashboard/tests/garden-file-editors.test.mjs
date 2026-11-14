import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import AdmZip from 'adm-zip';
import './helpers/genoffice-node-loader.mjs';
import { createOfficeRuntimeFixture } from './helpers/office-runtime-fixture.mjs';
import { GardenFileStore } from '../src/lib/garden-files/store.ts';
import { loadGardenFileEditor, saveGardenFileEditor, saveGardenNativeBytes } from '../src/lib/garden-files/editor.ts';
import { gardenFilePreview } from '../src/lib/garden-files/preview.ts';
import { gardenFileResource } from '../src/lib/garden-files/resources.ts';
import { exportGardenFile } from '../src/lib/garden-files/export.ts';
const { buildBlankDocx } = await import('../src/vendor/genoffice/docx-engine/src/index.ts');

const root = path.resolve(import.meta.dirname, '..');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-file-editor-')), database = new Database(':memory:');
  database.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);CREATE TABLE clusters(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);INSERT INTO clusters VALUES(1)');
  const store = new GardenFileStore(database, path.join(directory, 'files')), scope = { gardenId: 'demo', clusterId: 1, userId: 1, ownerId: 1 };
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, scope, put: async (name, bytes) => store.import(scope, name, await store.stage(Readable.from([bytes]))) };
}

test('text saves preserve BOM/CRLF, conflict copies retain both edits, invalid encodings stay untouched', async t => {
  const { store, scope, put } = fixture(t);
  const first = await put('code.txt', '\uFEFForiginal\r\n'), editor = await loadGardenFileEditor(store, scope, first.id);
  const saved = await saveGardenFileEditor(store, scope, first.id, { revision: first.revision, content: 'external\n' });
  await assert.rejects(saveGardenFileEditor(store, scope, first.id, { revision: first.revision, content: 'mine\n' }), { code: 'file_revision_conflict' });
  const copy = await saveGardenFileEditor(store, scope, first.id, { revision: editor.file.revision, content: 'mine\n', copy: true, baseVersion: editor.file.version });
  assert.equal(fs.readFileSync(store.content(scope, saved.id).path, 'utf8'), '\uFEFFexternal\r\n');
  assert.equal(fs.readFileSync(store.content(scope, copy.id).path, 'utf8'), '\uFEFFmine\r\n');
  assert.equal(copy.name, 'code (2).txt');
  const binary = await put('wrong.txt', Buffer.from([255,254,0,0]));
  await assert.rejects(loadGardenFileEditor(store, scope, binary.id), /binary data/);
  assert.equal(store.versions(scope, binary.id).length, 1);
});

test('native Word saves retain originals, refuse invalid output, and can save a conflict as a copy', async t => {
  const { store, scope, put } = fixture(t), original = Buffer.from(await buildBlankDocx()), zip = new AdmZip(original);
  const first = await put('Draft.docx', original);
  assert.equal((await loadGardenFileEditor(store, scope, first.id)).mode, 'docx');
  zip.addFile('word/document.xml', Buffer.from(zip.readAsText('word/document.xml').replace('<w:p/>', '<w:p><w:r><w:t>Edited document</w:t></w:r></w:p>')));
  const edited = zip.toBuffer(), body = () => Readable.toWeb(Readable.from([edited]));
  const saved = await saveGardenNativeBytes(store, scope, first.id, first.revision, body());
  assert.equal(saved.version, 2);
  assert.deepEqual(fs.readFileSync(store.content(scope, first.id, 1).path), original);
  await assert.rejects(saveGardenNativeBytes(store, scope, first.id, first.revision, body()), { code: 'file_revision_conflict' });
  const copy = await saveGardenNativeBytes(store, scope, first.id, first.revision, body(), undefined, true);
  assert.notEqual(copy.id, first.id); assert.equal(copy.visibility, 'private');
  await assert.rejects(saveGardenNativeBytes(store, scope, first.id, saved.revision, Readable.toWeb(Readable.from(['broken']))), /archive/);
  assert.equal(store.versions(scope, first.id).length, 2);
});

for (const [name, fixturePath, expectedMode] of [
  ['Workbook.xlsx', '../OfficeCLI/examples/excel/cell-formatting.xlsx', 'cells'],
  ['Presentation.pptx', '../genoffice/packages/pptx-engine/tests/fixtures/01_standard_business.pptx', 'blocks'],
]) test(`${name} uses the real Office worker with garden authority and no conversation`, { timeout: 90000 }, async t => {
  const runtime = createOfficeRuntimeFixture();
  t.after(() => runtime.cleanup());
  const { store, scope, put } = fixture(t), original = fs.readFileSync(path.resolve(root, fixturePath)), first = await put(name, original);
  const editor = await loadGardenFileEditor(store, scope, first.id, undefined, runtime.control);
  assert.equal(editor.mode, expectedMode);
  const block = editor.blocks.find(item => item.editable && item.text.trim()); assert.ok(block);
  const saved = await saveGardenFileEditor(store, scope, first.id, { revision: first.revision, patches: [{ anchor: block.anchor, text: 'Library edit verified' }] }, undefined, runtime.control);
  const reopened = await loadGardenFileEditor(store, scope, first.id, undefined, runtime.control);
  assert.equal(reopened.blocks.find(item => item.anchor === block.anchor)?.text, 'Library edit verified');
  assert.deepEqual(fs.readFileSync(store.content(scope, first.id, 1).path), original);
  assert.equal(saved.version, 2);
  assert.equal(store.database.prepare("SELECT name FROM sqlite_master WHERE name = 'conversations'").get(), undefined);
  const preview = await gardenFilePreview(store, scope, first.id);
  assert.ok(preview.markdown || preview.html);
});

test('archives are bounded and companion files obey the same private sharing rules', async t => {
  const { store, scope, put } = fixture(t), zip = new AdmZip();
  zip.addFile('hello.txt', Buffer.from('hello'));
  const archive = await put('Archive.zip', zip.toBuffer());
  assert.deepEqual((await gardenFilePreview(store, scope, archive.id)).entries.map(entry => entry.path), ['hello.txt']);
  zip.addFile('bomb.txt', Buffer.alloc(2 * 1024 * 1024));
  const bomb = await put('Large.zip', zip.toBuffer());
  await assert.rejects(gardenFilePreview(store, scope, bomb.id), /preview limit/);
  let model = await put('scene/model.gltf', '{}'), texture = await put('textures/pixel.png', 'image');
  assert.equal(gardenFileResource(store, scope, model.id, '../textures/pixel.png').id, texture.id);
  model = store.share(scope, model.id, model.revision, 'garden');
  assert.throws(() => gardenFileResource(store, { ...scope, userId: null }, model.id, '../textures/pixel.png'), { code: 'file_resource_missing' });
  assert.throws(() => gardenFileResource(store, scope, model.id, '../../outside'), { code: 'file_resource_path' });
  assert.throws(() => gardenFileResource(store, scope, model.id, 'https://example.com/x'), { code: 'file_resource_path' });
});

test('desktop exports are independent working copies with the original extension', async t => {
  const { store, scope, put } = fixture(t), first = await put('CON.bin', Buffer.from([0,255,2]));
  const exported = exportGardenFile(store, scope, first.id);
  assert.equal(path.basename(exported), '_CON.bin');
  assert.deepEqual(fs.readFileSync(exported), Buffer.from([0,255,2]));
  fs.writeFileSync(exported, 'Changed by an external app');
  assert.deepEqual(fs.readFileSync(store.content(scope, first.id).path), Buffer.from([0,255,2]));
  assert.notEqual(exportGardenFile(store, scope, first.id), exported, 'Export again does not overwrite an earlier working copy');
  assert.throws(() => exportGardenFile(store, { ...scope, userId: null }, first.id), { status: 403 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Database from 'better-sqlite3';
import { enrichGardenSourceVisuals } from '../src/lib/garden-visual-enrichment.ts';
import { backfillGardenVisualDescriptions } from '../src/lib/garden-visual-backfill.ts';
import { readGardenPage } from '../src/lib/hermes/garden-reader.ts';
import { gardenSourceFigures } from '../src/lib/hermes/garden-source-figures.ts';

async function fixture(t, count = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-description-'));
  const garden = path.join(root, 'course');
  fs.mkdirSync(path.join(garden, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(garden, 'sources'));
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#126456' } }).png().toBuffer();
  let markdown = '---\ntitle: Lab notes\nsource_images: []\n---\n## Page 1\nNotes beside a drawing.\n';
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(garden, `assets/image-${i}.png`), png);
    markdown += `\n![Page 1 figure ${i + 1}](../assets/image-${i}.png)\n`;
  }
  fs.writeFileSync(path.join(garden, 'sources/notes.md'), markdown);
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return { root, garden, input: { contentPath: root, gardenSlug: 'course', sourceRelPath: 'sources/notes.md', model: 'test-vision' },
    search: async query => gardenSourceFigures(root, 'course', (await readGardenPage(root, 'course', 'sources/notes.md')).node, { query }) };
}

const description = { caption: 'Optical interferometer', description: 'Two light paths meet at a beam splitter.', visibleText: 'Mirror M2' };

test('pixel descriptions become searchable, persist across retries, and invalidate on changed assets', async t => {
  const f = await fixture(t);
  assert.equal((await f.search('beam splitter')).total, 0);
  let calls = 0;
  const describe = async input => {
    calls++;
    assert.match(input.dataUrl, /^data:image\/jpeg;base64,/);
    assert.match(input.sourceContext, /Notes beside a drawing/);
    return description;
  };
  const result = await enrichGardenSourceVisuals({ ...f.input, describe });
  assert.equal(result.described, 1);
  assert.equal(result.pending, 0);
  const found = await f.search('beam splitter');
  assert.equal(found.total, 1);
  assert.equal(found.figures[0].descriptionSource, 'vision');
  assert.equal((await f.search('mirror M2')).total, 1);
  // Copying into a Learn workspace changes timestamps, but not the pixels.
  const changedTime = new Date(Date.now() + 10_000);
  fs.utimesSync(path.join(f.garden, 'assets/image-0.png'), changedTime, changedTime);
  assert.equal((await f.search('beam splitter')).total, 1);
  assert.equal((await enrichGardenSourceVisuals({ ...f.input, describe })).existing, 1);
  assert.equal(calls, 1);
  fs.writeFileSync(path.join(f.garden, 'assets/image-0.png'), await sharp({ create: { width: 28, height: 28, channels: 3, background: '#ab5522' } }).png().toBuffer());
  assert.equal((await f.search('beam splitter')).total, 0);
  assert.equal((await enrichGardenSourceVisuals({ ...f.input, describe })).described, 1);
  assert.equal(calls, 2);
});

test('provider failure is reported once, preserves the source, and leaves all images retryable', async t => {
  const f = await fixture(t, 3);
  const original = fs.readFileSync(path.join(f.garden, 'sources/notes.md'), 'utf8');
  let calls = 0;
  const result = await enrichGardenSourceVisuals({ ...f.input, describe: async () => { calls++; throw new Error('offline'); } });
  assert.equal(calls, 1);
  assert.equal(result.pending, 3);
  assert.equal(result.described, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.serviceUnavailable, true);
  assert.equal(fs.readFileSync(path.join(f.garden, 'sources/notes.md'), 'utf8'), original);
  assert.equal((await f.search('drawing')).total, 3);
  assert.equal((await enrichGardenSourceVisuals({ ...f.input, describe: async () => description })).described, 3);
});

test('unreadable outputs and canceled runs never become verified descriptions', async t => {
  const f = await fixture(t);
  for (const value of ['invalid JSON', { unreadable: true }, { caption: 'made up' }]) {
    const result = await enrichGardenSourceVisuals({ ...f.input, describe: async () => value });
    assert.equal(result.pending, 1);
    assert.equal(result.described, 0);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(enrichGardenSourceVisuals({ ...f.input, signal: controller.signal }), { name: 'AbortError' });
});

test('all images beyond the first inventory page are enriched', async t => {
  const f = await fixture(t, 53);
  let calls = 0;
  const result = await enrichGardenSourceVisuals({ ...f.input, describe: async () => { calls++; return description; } });
  assert.equal(result.total, 53);
  assert.equal(result.described, 53);
  assert.equal(calls, 53);
});

test('backfill defaults to read-only and applies resumable descriptions through the model API', async t => {
  const f = await fixture(t, 2);
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(description) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const run = async (...args) => {
    const { stdout } = await promisify(execFile)(process.execPath,
      ['--experimental-strip-types', 'scripts/backfill-garden-visual-descriptions.mjs', '--content-path', f.root, '--all', ...args],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 30_000,
        env: { ...process.env, OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, OPENAI_API_KEY: 'local-test' } });
    return JSON.parse(stdout.trim());
  };
  assert.equal((await run()).pending, 2);
  assert.equal(requests.length, 0);
  assert.equal(fs.existsSync(path.join(f.garden, '.breadboard')), false);
  assert.equal((await run('--apply', '--model', 'test-vision')).described, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, 'test-vision');
  assert.match(requests[0].messages[1].content[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal((await run('--apply', '--model', 'test-vision')).pending, 0);
  assert.equal(requests.length, 2, 'completed descriptions must not call the model again');
});

test('batched backfill describes identical pixels once, saves each path, and resumes without requests', async t => {
  const f = await fixture(t, 3);
  let calls = 0;
  const client = { chat: { completions: { create: async payload => {
    calls++;
    assert.equal(payload.model, 'background-vision');
    assert.equal(payload.messages[1].content.filter(x => x.type === 'image_url').length, 1);
    return { choices: [{ message: { content: JSON.stringify({ images: [{ id: 'image_1', ...description }] }) } }] };
  } } } };
  const input = { contentPath: f.root, gardens: ['course'], client, model: 'background-vision' };
  const first = await backfillGardenVisualDescriptions(input);
  assert.equal(first.gardens[0].added, 3);
  assert.equal(first.gardens[0].pending, 0);
  assert.equal(calls, 1);
  assert.equal((await f.search('beam splitter')).total, 3);
  assert.equal((await backfillGardenVisualDescriptions(input)).gardens[0].added, 0);
  assert.equal(calls, 1);
});

test('batch IDs prevent mismatched descriptions and terminal provider failures stop requests', async t => {
  const f = await fixture(t, 3);
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(f.garden, `assets/image-${i}.png`),
    await sharp({ create: { width: 24 + i, height: 24, channels: 3, background: '#345678' } }).png().toBuffer());
  let calls = 0;
  const client = { chat: { completions: { create: async () => {
    calls++;
    return { choices: [{ message: { content: JSON.stringify({ images: [
      { id: 'image_1', ...description }, { id: 'image_1', ...description }, { id: 'image_3', ...description },
    ] }) } }] };
  } } } };
  const input = { contentPath: f.root, gardens: ['course'], client, model: 'background-vision', batchSize: 3, concurrency: 1 };
  const result = await backfillGardenVisualDescriptions(input);
  assert.equal(result.gardens[0].added, 1);
  assert.equal(result.gardens[0].pending, 2);
  assert.equal((await f.search('beam splitter')).figures[0].imagePath, '/course/assets/image-2.png');
  client.chat.completions.create = async () => { calls++; throw Object.assign(new Error('bad request'), { status: 400 }); };
  const failed = await backfillGardenVisualDescriptions(input);
  assert.equal(failed.serviceUnavailable, true);
  assert.equal(failed.gardens[0].pending, 2);
  assert.equal(calls, 2);
});

test('supervisor discovers the live background model, confines ownership, verifies retrieval and signals its handoff', async t => {
  const f = await fixture(t, 2);
  const data = path.join(f.root, 'Data');
  const content = path.join(data, 'quartz/content');
  fs.mkdirSync(content, { recursive: true });
  fs.renameSync(f.garden, path.join(content, 'telecom-1'));
  fs.cpSync(path.join(content, 'telecom-1'), path.join(content, 'private-course'), { recursive: true });
  fs.mkdirSync(path.join(data, 'database'));
  fs.mkdirSync(path.join(data, 'runtime'));
  const db = new Database(path.join(data, 'database/brain.db'));
  db.exec("CREATE TABLE clusters (user_id INTEGER, slug TEXT); INSERT INTO clusters VALUES (1,'telecom-1'),(2,'private-course');");
  db.close();
  let calls = 0;
  const server = http.createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/providers') { response.end(JSON.stringify({ defaultModel: 'background-vision' })); return; }
    let body = ''; for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body); calls++;
    assert.equal(payload.model, 'background-vision');
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ images: [{ id: 'image_1', ...description }] }) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  fs.writeFileSync(path.join(data, 'runtime/endpoints.json'), JSON.stringify({ urls: { chatmock: `http://127.0.0.1:${server.address().port}` } }));
  const status = path.join(f.root, 'handoff.json');
  const report = path.join(f.root, 'report.json');
  fs.writeFileSync(status, JSON.stringify({ readyForSupervisor: false }));
  await promisify(execFile)(process.execPath, ['--experimental-strip-types', 'scripts/run-garden-visual-backfill.mjs',
    '--data-dir', data, '--user-id', '1', '--status-file', status, '--report', report, '--qa-file', path.join(f.root, 'qa.md')],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 30_000 });
  const completion = JSON.parse(fs.readFileSync(status, 'utf8'));
  assert.equal(completion.status, 'complete');
  assert.equal(completion.readyForSupervisor, true);
  assert.equal(completion.savedByThisTask, 2);
  assert.equal(JSON.parse(fs.readFileSync(`${report}.verified.json`, 'utf8')).retrievalVerified, true);
  assert.match(fs.readFileSync(status.replace('.json', '.md'), 'utf8'), /Completed visual backfill/);
  assert.equal(fs.existsSync(path.join(content, 'private-course/.breadboard')), false);
  assert.equal(fs.existsSync(`${status}.worker-lock`), false);
  assert.equal(calls, 1);
});

test('a stopped supervisor never signals completion', async t => {
  const f = await fixture(t);
  const status = path.join(f.root, 'handoff.json');
  fs.writeFileSync(status, JSON.stringify({ readyForSupervisor: false }));
  fs.writeFileSync(`${status}.stop`, 'stop');
  await promisify(execFile)(process.execPath, ['--experimental-strip-types', 'scripts/run-garden-visual-backfill.mjs',
    '--data-dir', f.root, '--user-id', '1', '--status-file', status, '--report', path.join(f.root, 'report.json')],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 10_000 });
  const result = JSON.parse(fs.readFileSync(status, 'utf8'));
  assert.equal(result.status, 'cancelled');
  assert.equal(result.readyForSupervisor, false);
});

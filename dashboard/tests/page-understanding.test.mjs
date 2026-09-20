import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import ts from 'typescript';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-understanding-'));
process.env.BREADBOARD_DATA_DIR = root;
process.env.QUARTZ_CONTENT_PATH = root;
const { default: db } = await import('../src/lib/db.ts');
const { pageUnderstanding: store } = await import('../src/lib/page-understanding.ts');
const types = await import('../src/lib/page-understanding-types.ts');
const { ReviewStore } = await import('../src/lib/review/store.ts');
const { quartzSystemContext } = await import('../src/lib/hermes/quartz-support.ts');
const core = await import('../src/lib/hermes/route-core.ts');
const { seedGarden } = await import('../src/lib/review/cards.ts');
const { resolveUnderstandingPage } = await import('../src/lib/page-understanding-path.ts');
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES (1,'alice','a@example.test','x'),(2,'bob','b@example.test','x')").run();
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test('understanding persists across processes and is isolated by user, garden and full page path', () => {
  assert.equal(store.get(1, 'physics', 'one/lesson'), null);
  const saved = store.set(1, 'physics', 'one/lesson.md', true);
  assert.equal(store.get(1, 'physics', 'one/lesson').understood, true);
  assert.equal(store.get(2, 'physics', 'one/lesson'), null);
  assert.equal(store.get(null, 'physics', 'one/lesson'), null);
  assert.equal(store.get(1, 'chemistry', 'one/lesson'), null);
  assert.equal(store.get(1, 'physics', 'two/lesson'), null);
  assert.deepEqual(store.set(1, 'physics', 'one/lesson', true), saved, 'retry is idempotent');
  const module = new URL('../src/lib/page-understanding.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    `const {pageUnderstanding:s}=await import(${JSON.stringify(module)}); console.log(JSON.stringify(s.get(1,'physics','one/lesson')));`],
    { env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), saved);
  assert.equal(store.set(1, 'physics', 'one/lesson', false).understood, false);
  assert.throws(() => store.set(1, 'physics', '../other', true));
  assert.throws(() => store.set(1, 'physics', 'lesson', 'yes'));
});

test('green is reserved, old green flags do not imply understanding, and manual colors return on uncheck', () => {
  assert.ok(!types.PAGE_FLAG_COLORS.includes('#22c55e'));
  assert.ok(!types.PAGE_FLAG_COLORS.includes('#a3e635'));
  assert.equal(types.pageFlagColor('#fb7185', true), '#22c55e');
  assert.equal(types.pageFlagColor('#fb7185', false), '#fb7185');
  assert.equal(types.pageFlagColor('#22C55E'), '');
  assert.equal(types.understandingPageSlug('Section One\\A & B.md'), 'Section-One/A--and--B');
});

test('delivery prioritizes explicitly un-understood due pages without manufacturing grades or dropping understood reviews', () => {
  const reviews = new ReviewStore(db);
  const ids = ['a', 'b', 'c', 'future'].map((pageSlug, i) => reviews.upsertCard({
    userId: 1, gardenSlug: 'delivery', pageSlug, pageTitle: pageSlug,
    question: 'Explain this.', answer: 'Answer', sourceHash: pageSlug,
    now: new Date(`2026-01-0${i + 1}T00:00:00Z`),
  }).id);
  reviews.setGardenSettings(1, 'delivery', { enabled: true });
  const before = ids.map(id => reviews.card(id));
  store.set(1, 'delivery', 'a', true);
  store.set(1, 'delivery', 'c', false);
  store.set(1, 'delivery', 'future', false);
  store.set(2, 'delivery', 'b', false);
  const due = reviews.due(1, { limit: 10, now: new Date('2026-01-03T12:00:00Z') });
  assert.deepEqual(due.map(card => card.page_slug), ['c', 'a', 'b']);
  assert.deepEqual(ids.map(id => reviews.card(id)), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM review_logs').get().n, 0);
  store.set(1, 'delivery', 'c', true);
  assert.deepEqual(reviews.due(1, { limit: 10, now: new Date('2026-01-03T12:00:00Z') }).map(card => card.page_slug), ['a', 'b', 'c']);
});

test('seeding nested pages migrates old schedules and keeps duplicate filenames distinct', async () => {
  const dir = path.join(root, 'nested');
  for (const folder of ['one', 'two']) fs.mkdirSync(path.join(dir, folder), { recursive: true });
  const prose = 'A learning page contains enough grounded detail to explain a complete idea. '.repeat(8);
  for (const relative of ['one/lesson', 'two/lesson', 'one/unique']) {
    fs.writeFileSync(path.join(dir, relative + '.md'), `---\nknowledge_type: learning-page\ntitle: ${relative}\n---\n\n${prose}`);
  }
  const reviews = new ReviewStore(db);
  const old = reviews.upsertCard({ userId: 1, gardenSlug: 'nested', pageSlug: 'unique', pageTitle: 'Unique', question: 'Explain.', answer: prose, sourceHash: 'old' }).id;
  reviews.grade(old, 3, { now: new Date('2026-01-01T00:00:00Z'), desiredRetention: 0.9 });
  const schedule = reviews.card(old);
  await seedGarden({ store: reviews, userId: 1, gardenSlug: 'nested', contentPath: root, offline: true });
  assert.equal(reviews.card(old).page_slug, 'one/unique');
  assert.equal(reviews.card(old).due, schedule.due);
  assert.equal(reviews.card(old).reps, schedule.reps);
  assert.deepEqual(reviews.listCards(1, 'nested').map(card => card.pageSlug).sort(), ['one/lesson', 'one/unique', 'two/lesson']);
});

test('Hermes receives self-reported understanding and its limits', () => {
  const page = { gardenName: 'Physics', gardenId: 'physics', pageTitle: 'Lesson', pageSlug: 'lesson', backlinks: [], outgoingLinks: [], neighboringConcepts: [], sources: [] };
  assert.match(quartzSystemContext({ ...page, understanding: { understood: true, updatedAt: 'now' } }), /I understand this.*not tested mastery/s);
  assert.match(quartzSystemContext({ ...page, understanding: { understood: false, updatedAt: 'now' } }), /needs more work/);
  assert.match(quartzSystemContext(page), /has not recorded understanding/);
});

test('Hermes page tools read the caller’s saved understanding, never the garden owner’s state', async () => {
  const { executeGardenTool } = await import('../src/lib/hermes/garden-tools.ts');
  const { issueCapabilityToken } = await import('../src/lib/hermes/capability-token.ts');
  db.prepare("INSERT INTO clusters(user_id,name,slug) VALUES (1,'Tool garden','tools')").run();
  fs.mkdirSync(path.join(root, 'tools', 'lessons'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'lessons', 'topic.md'), '# Topic\n\nAn explanation.');
  store.set(1, 'tools', 'lessons/topic', true);
  const read = userId => executeGardenTool({
    rawToken: issueCapabilityToken({ userId, surface: 'garden_chat', hermesSessionId: 'test', gardenId: 'tools', allowedTools: ['garden_get_page'] }),
    tool: 'garden_get_page', args: { gardenId: 'tools', slug: 'lessons/topic' },
  });
  const owner = await read(1);
  assert.equal(owner.ok, true, owner.error);
  assert.equal(owner.data.understanding.understood, true);
  const otherReader = await read(2);
  assert.equal(otherReader.ok, true, otherReader.error);
  assert.equal(otherReader.data.understanding, null);
});

test('page validation visits only its ancestor directories, retains Quartz aliases, and rejects ambiguous or escaping paths', async () => {
  const garden = path.join(root, 'paths');
  fs.mkdirSync(path.join(garden, 'Unit One'), { recursive: true });
  fs.mkdirSync(path.join(garden, 'unrelated', 'many', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(garden, 'Unit One', 'A & B.md'), 'Content');
  fs.writeFileSync(path.join(garden, '_index.md'), 'Index');
  const visited = [];
  const readdir = fs.promises.readdir;
  fs.promises.readdir = async (directory, ...args) => { visited.push(directory); return readdir(directory, ...args); };
  try {
    assert.equal(await resolveUnderstandingPage(root, 'paths', 'Unit-One/A--and--B'), 'Unit One/A & B.md');
  } finally { fs.promises.readdir = readdir; }
  assert.equal(visited.length, 2);
  assert.ok(visited.every(directory => !directory.includes('unrelated')));
  assert.equal(await resolveUnderstandingPage(root, 'paths', 'index'), '_index.md');
  for (const invalid of ['../nested/one/unique', 'Unit-One\\A--and--B', '/index', 'missing', 'assets/file']) {
    assert.equal(await resolveUnderstandingPage(root, 'paths', invalid), null);
  }
  fs.mkdirSync(path.join(garden, 'Unit-One'));
  fs.writeFileSync(path.join(garden, 'Unit-One', 'A & B.md'), 'Other content');
  assert.equal(await resolveUnderstandingPage(root, 'paths', 'Unit-One/A--and--B'), null);
  fs.writeFileSync(path.join(garden, 'index.md'), 'Ambiguous index');
  assert.equal(await resolveUnderstandingPage(root, 'paths', 'index'), null);
});

test('the real API validates access, origin, payload and page existence for reads and writes', async () => {
  let userId = 1;
  let gardenScans = 0;
  fs.mkdirSync(path.join(root, 'api', 'one'), { recursive: true });
  for (const page of ['one/lesson', 'one/legacy', 'index']) fs.writeFileSync(path.join(root, 'api', page + '.md'), 'A page.');
  class RouteError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const auth = { RouteError,
    requireReadableClusterFromSlug: async slug => {
      if (!userId) throw new RouteError(401, 'Unauthorized');
      if (slug !== 'api') throw new RouteError(404, 'Garden not found');
      return { userId, cluster: { slug } };
    }, routeErrorResponse: error => Response.json({ error: error.message }, { status: error.status ?? 500 }),
  };
  const compile = (file, modules) => {
    const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const result = {};
    new Function('require', 'exports', code)(id => { assert.ok(modules[id], id); return modules[id]; }, result);
    return result;
  };
  const origin = compile('../src/lib/request-origin.ts', { '@/lib/server-auth': auth });
  const api = compile('../src/app/api/page-understanding/route.ts', {
    '@/lib/server-auth': auth, '@/lib/request-origin': origin,
    '@/lib/hermes/quartz-support.ts': { corsHeaders: value => ({ 'Access-Control-Allow-Origin': value === 'http://quartz.test' ? value : 'http://dashboard.test' }) },
    '@/lib/hermes/route-helpers.ts': core,
    '@/lib/hermes/garden-reader.ts': { gardenReadEntries: async () => { gardenScans++; return [{ relPath: 'one/lesson.md' }, { relPath: 'one/legacy.md' }, { relPath: 'index.md' }]; } },
    '@/lib/page-understanding-path.ts': { resolveUnderstandingPage },
    '@/lib/page-understanding.ts': { pageUnderstanding: store }, '@/lib/page-understanding-types.ts': types,
    '@/lib/review/instance.ts': { getReviewStore: () => new ReviewStore(db) },
  });
  const post = (body, origin = 'http://quartz.test') => api.POST(new Request('http://dashboard.test/api/page-understanding', { method: 'POST', headers: { origin }, body: JSON.stringify(body) }));
  assert.equal((await post({ gardenSlug: 'api', pageSlug: 'one/lesson', understood: true })).status, 200);
  const read = await post({ gardenSlug: 'api' });
  assert.equal(read.headers.get('cache-control'), 'no-store');
  assert.equal((await read.json()).pages[0].understood, true);
  assert.equal((await post({ gardenSlug: 'api', pageSlug: 'missing', understood: true })).status, 404);
  assert.equal((await post({ gardenSlug: 'api', pageSlug: '../other', understood: true })).status, 404);
  assert.equal((await post({ gardenSlug: 'api', pageSlug: 'index', understood: true })).status, 200);
  assert.equal((await post({ gardenSlug: 'api', pageSlug: 'one/lesson', understood: false })).status, 200);
  assert.equal(gardenScans, 0, 'ordinary toggles never scan the whole garden');
  const reviews = new ReviewStore(db);
  const legacy = reviews.upsertCard({ userId: 1, gardenSlug: 'api', pageSlug: 'legacy', pageTitle: 'Legacy', question: 'Question', answer: 'Answer', sourceHash: 'hash' }).id;
  const schedule = reviews.card(legacy).due;
  assert.equal((await post({ gardenSlug: 'api', pageSlug: 'one/legacy', understood: true })).status, 200);
  assert.equal(reviews.card(legacy).page_slug, 'one/legacy');
  assert.equal(reviews.card(legacy).due, schedule);
  assert.equal((await post({ gardenSlug: 'api', pageSlug: 'one/legacy', understood: false })).status, 200);
  assert.equal(gardenScans, 1, 'only the first legacy migration needs a uniqueness scan');
  assert.equal((await post({ gardenSlug: 'api', pageSlug: 'one/lesson', understood: 'true' })).status, 400);
  assert.equal((await post({ gardenSlug: 'private' })).status, 404);
  assert.equal((await post({ gardenSlug: 'api' }, 'http://attacker.test')).status, 403);
  userId = 2;
  assert.deepEqual((await (await post({ gardenSlug: 'api' })).json()).pages, []);
  userId = 0;
  assert.equal((await post({ gardenSlug: 'api' })).status, 401);
});

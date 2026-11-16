import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { fromMarkdown } from 'mdast-util-from-markdown';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { issueCapabilityToken } from '../src/lib/hermes/capability-token.ts';

test('image endpoint reads the current owned turn and rejects foreign, revoked, future and stopped access', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE conversations(id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY, conversation_id INTEGER, role TEXT, order_index INTEGER, client_message_id TEXT, metadata TEXT);
    CREATE VIEW conversation_message_reads AS SELECT * FROM conversation_messages;
    INSERT INTO conversations VALUES (44,7), (45,8);`);
  const original = await sharp({ create: { width: 256, height: 128, channels: 3, background: 'white' } }).png().toBuffer();
  const dataUrl = `data:image/png;base64,${original.toString('base64')}`;
  const metadata = JSON.stringify({ attachments: [{ type: 'image', name: 'photo.jpg', dataUrl }] });
  const insert = db.prepare('INSERT INTO conversation_messages VALUES(?,?,?,?,?,?)');
  insert.run(1,44,'user',0,'prompt',metadata); insert.run(2,44,'assistant',1,'answer',null);
  insert.run(3,44,'user',2,'future',metadata); insert.run(4,45,'user',0,'foreign',metadata);
  const state = globalThis.__attachmentRouteTest = { db,
    session: { id: 33, user_id: 7, conversation_id: 44 }, run: { id: 'run' },
    decision: { allowedTools: ['attachment_image'] }, token: null };
  const stubs = {
    '@/lib/db': 'export default globalThis.__attachmentRouteTest.db;',
    '@/lib/server-auth': 'export const requireUserId = async () => 7;',
    '@/lib/hermes/tool-service-auth.ts': 'export const capabilityForInternalToolRequest = () => globalThis.__attachmentRouteTest.token;',
    '@/lib/hermes/runtime-store.ts': `export const getRuntimeSessionById = () => globalThis.__attachmentRouteTest.session;
      export const runtimeExternalSessionId = () => 'runtime';
      export const getActiveCapabilityDecision = () => globalThis.__attachmentRouteTest.decision;`,
    '@/lib/hermes/run-store.ts': `export const getActiveRuntimeRun = () => globalThis.__attachmentRouteTest.run;
      export const parseRuntimeRunDispatch = () => ({ clientMessageId: 'answer' });`,
    '@/lib/hermes/route-helpers.ts': `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; } }
      export const requireEnabled = () => {}; export const readJsonBody = req => req.json();
      export const apiErrorResponse = error => Response.json({ error: error.message }, { status: error.status || 500 });`,
  };
  async function loadRoute(entryPoint) {
    const bundle = await build({ entryPoints: [entryPoint],
      bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
      plugins: [{ name: 'owned-image-authority', setup(builder) {
        builder.onResolve({ filter: /^@\// }, args => stubs[args.path] ? { path: args.path, namespace: 'authority' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'authority' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      } }],
    });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    return module.exports;
  }
  const { POST } = await loadRoute('src/app/api/hermes/tools/attachment-image/route.ts');
  const { GET } = await loadRoute('src/app/api/hermes/uploads/[uploadId]/content/route.ts');
  const call = (signal, marks) => POST(new Request('http://localhost/api/hermes/tools/attachment-image',
    { method: 'POST', body: JSON.stringify({ args: { image: 1, marks } }), signal }));
  const getImage = url => GET(new Request(new URL(url, 'http://localhost')), {
    params: Promise.resolve({ uploadId: url.split('/')[4] }),
  });
  const token = overrides => issueCapabilityToken({ userId: 7, conversationId: 44, breadboardSessionId: '33',
    hermesSessionId: 'runtime', surface: 'dashboard_terminal', allowedTools: ['attachment_image'], ...overrides });
  try {
    assert.equal((await call()).status, 403);
    state.token = token();
    const result = await call(); assert.equal(result.status, 200);
    assert.equal((await result.json()).data.url, '/api/hermes/uploads/1-0/content');
    const marks = ['box,125,250,500,750', 'arrow,900,800,520,500', 'label,600,100,A & B'];
    const marked = await call(undefined, marks);
    assert.equal(marked.status, 200);
    const { url, markdown, screenshot } = (await marked.json()).data;
    assert.equal(markdown, `![Annotated image](<${url}>)`);
    assert.equal(fromMarkdown(markdown).children[0].children[0].url, url);
    assert.match(screenshot.dataUrl, /^data:image\/jpeg;base64,/);
    const view = await getImage(url);
    assert.equal(view.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await view.arrayBuffer());
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    assert.deepEqual([info.width, info.height], [256, 128]);
    assert.deepEqual(pixel(12, 12), [255, 255, 255]);
    assert.ok(pixel(32, 60)[0] < 200, 'outline lands at normalized x=125');
    assert.deepEqual(Buffer.from(await (await getImage(url.split('?')[0])).arrayBuffer()), original);
    assert.equal((await getImage(url.replace('/1-0/', '/4-0/'))).status, 404);
    assert.equal((await getImage(url.split('?')[0] + '?mark=box,0,0,1500,300')).status, 400);
    state.token = token({ userId: 8 }); assert.equal((await call()).status, 403);
    state.token = token({ conversationId: 45 }); assert.equal((await call()).status, 403);
    state.token = token(); state.decision.allowedTools = []; assert.equal((await call()).status, 403);
    state.decision.allowedTools = ['attachment_image']; state.run = null; assert.equal((await call()).status, 403);
    state.run = { id: 'run' }; const abort = new AbortController(); abort.abort();
    assert.equal((await call(abort.signal)).status, 409);
    db.prepare('DELETE FROM conversation_messages WHERE id=1').run();
    assert.equal((await call()).status, 400, 'future and foreign images cannot fill a missing source');
  } finally { db.close(); delete globalThis.__attachmentRouteTest; }
});

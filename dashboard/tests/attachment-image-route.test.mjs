import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { issueCapabilityToken } from '../src/lib/hermes/capability-token.ts';

test('image endpoint reads the current owned turn and rejects foreign, revoked, future and stopped access', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE conversations(id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY, conversation_id INTEGER, role TEXT, order_index INTEGER, client_message_id TEXT, metadata TEXT);
    INSERT INTO conversations VALUES (44,7), (45,8);`);
  const dataUrl = `data:image/png;base64,${(await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).png().toBuffer()).toString('base64')}`;
  const metadata = JSON.stringify({ attachments: [{ type: 'image', name: 'photo.jpg', dataUrl }] });
  const insert = db.prepare('INSERT INTO conversation_messages VALUES(?,?,?,?,?,?)');
  insert.run(1,44,'user',0,'prompt',metadata); insert.run(2,44,'assistant',1,'answer',null);
  insert.run(3,44,'user',2,'future',metadata); insert.run(4,45,'user',0,'foreign',metadata);
  const state = globalThis.__attachmentRouteTest = { db,
    session: { id: 33, user_id: 7, conversation_id: 44 }, run: { id: 'run' },
    decision: { allowedTools: ['attachment_image'] }, token: null };
  const stubs = {
    '@/lib/db': 'export default globalThis.__attachmentRouteTest.db;',
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
  const bundle = await build({ entryPoints: ['src/app/api/hermes/tools/attachment-image/route.ts'],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'owned-image-authority', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => stubs[args.path] ? { path: args.path, namespace: 'authority' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'authority' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const call = signal => module.exports.POST(new Request('http://localhost/api/hermes/tools/attachment-image',
    { method: 'POST', body: JSON.stringify({ args: { image: 1 } }), signal }));
  const token = overrides => issueCapabilityToken({ userId: 7, conversationId: 44, breadboardSessionId: '33',
    hermesSessionId: 'runtime', surface: 'dashboard_terminal', allowedTools: ['attachment_image'], ...overrides });
  try {
    assert.equal((await call()).status, 403);
    state.token = token();
    const result = await call(); assert.equal(result.status, 200);
    assert.equal((await result.json()).data.url, '/api/hermes/uploads/1-0/content');
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

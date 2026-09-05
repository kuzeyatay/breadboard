import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { issueCapabilityToken } from '../src/lib/hermes/capability-token.ts';
import { setBrowserTerminalContext } from '../src/lib/hermes/browser-terminal-context.ts';
import { allowedToolsForSurface } from '../src/lib/hermes/tool-scopes.ts';

test('browser tool requires an owned, active Terminal session and uses only its server-bound connection', async () => {
  const state = globalThis.__browserTerminalRouteTest = {
    session: { id: 33, user_id: 7, surface: 'dashboard_terminal', conversation_id: 44 },
    conversation: { id: 44, user_id: 7 }, run: { id: 'run' }, calls: [], token: null,
  };
  const stubs = {
    '@/lib/hermes/tool-service-auth.ts': 'export const capabilityForInternalToolRequest = () => globalThis.__browserTerminalRouteTest.token;',
    '@/lib/hermes/runtime-store.ts': 'export const getRuntimeSessionById = id => id === 33 ? globalThis.__browserTerminalRouteTest.session : null; export const runtimeExternalSessionId = () => "runtime";',
    '@/lib/hermes/run-store.ts': 'export const getActiveRuntimeRun = () => globalThis.__browserTerminalRouteTest.run;',
    '@/lib/conversations/store.ts': 'export const getConversationById = () => globalThis.__browserTerminalRouteTest.conversation;',
    '@/lib/hermes/route-helpers.ts': `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
      export const requireEnabled = () => {};
      export const readJsonBody = req => req.json();
      export const apiErrorResponse = error => Response.json({ error: error.message }, { status: error.status || 500 });`,
  };
  const bundle = await build({
    entryPoints: ['src/app/api/hermes/tools/browser-terminal/route.ts'],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'session-authority', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => stubs[args.path] ? { path: args.path, namespace: 'test-authority' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'test-authority' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const { POST } = module.exports;
  const call = (args = { action: 'read' }) => POST(new Request('http://localhost/api/hermes/tools/browser-terminal', { method: 'POST', body: JSON.stringify({ args }) }));
  const token = (surface = 'dashboard_terminal') => issueCapabilityToken({ userId: 7, conversationId: 44, breadboardSessionId: '33', hermesSessionId: 'runtime', surface, allowedTools: ['browser_terminal'] });
  const originalFetch = globalThis.fetch;
  try {
    for (const surface of ['garden_chat', 'quartz_ai']) assert.ok(!allowedToolsForSurface(surface).includes('browser_terminal'));
    assert.ok(allowedToolsForSurface('dashboard_terminal').includes('browser_terminal'));
    assert.equal((await call()).status, 403);
    state.token = token();
    state.session.surface = 'garden_chat'; assert.equal((await call()).status, 403);
    state.session.surface = 'dashboard_terminal';
    state.conversation.user_id = 8; assert.equal((await call()).status, 403);
    state.conversation.user_id = 7;
    state.run = null; assert.equal((await call()).status, 409);
    state.run = { id: 'run' }; assert.equal((await call()).status, 409);
    setBrowserTerminalContext(33, { port: 41000, token: 'd'.repeat(64) });
    globalThis.fetch = async (url, options) => {
      state.calls.push([url, options]);
      return Response.json({ url: 'https://linked.example/', title: 'Linked page', text: 'Current content' });
    };
    assert.equal((await call({ action: 'click' })).status, 400);
    assert.equal((await call({ action: 'scroll', direction: 'sideways' })).status, 400);
    const result = await call({ action: 'read', port: 42000, token: 'e'.repeat(64), tabId: 999 });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).data.title, 'Linked page');
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0][0], 'http://127.0.0.1:41000/browser-terminal');
    assert.equal(state.calls[0][1].headers.Authorization, `Bearer ${'d'.repeat(64)}`);
    // A Garden chat opened inside the Terminal retains its original surface.
    state.session.surface = 'garden_chat'; state.token = token('garden_chat');
    assert.equal((await call()).status, 200);
    setBrowserTerminalContext(33);
    assert.equal((await call()).status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserTerminalContext(33);
    delete globalThis.__browserTerminalRouteTest;
  }
});

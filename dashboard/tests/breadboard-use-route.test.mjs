import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { issueCapabilityToken } from '../src/lib/hermes/capability-token.ts';

for (const action of ['state', 'launch_clicky']) {
test(`app control ${action} requires an owned active private conversation and uses server identity`, async () => {
  const state = globalThis.__breadboardUseRouteTest = {
    session: { id: 33, user_id: 7, surface: 'dashboard_terminal', conversation_id: 44 },
    conversation: { id: 44, user_id: 7 }, run: { id: 'run' }, calls: [], token: null,
  };
  const stubs = {
    '@/lib/hermes/tool-service-auth.ts': 'export const capabilityForInternalToolRequest = () => globalThis.__breadboardUseRouteTest.token;',
    '@/lib/hermes/runtime-store.ts': 'export const getRuntimeSessionById = id => id === 33 ? globalThis.__breadboardUseRouteTest.session : null; export const runtimeExternalSessionId = () => "runtime";',
    '@/lib/hermes/run-store.ts': 'export const getActiveRuntimeRun = () => globalThis.__breadboardUseRouteTest.run;',
    '@/lib/conversations/store.ts': 'export const getConversationById = () => globalThis.__breadboardUseRouteTest.conversation;',
    '@/lib/hermes/breadboard-use.ts': 'export const useBreadboard = async (...args) => { globalThis.__breadboardUseRouteTest.calls.push(args); return { targets: [] }; };',
    '@/lib/hermes/route-helpers.ts': `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
      export const requireEnabled = () => {};
      export const readJsonBody = req => req.json();
      export const apiErrorResponse = error => Response.json({ error: error.message }, { status: error.status || 500 });`,
  };
  const bundle = await build({ entryPoints: ['src/app/api/hermes/tools/breadboard-use/route.ts'],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'session-authority', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => stubs[args.path] ? { path: args.path, namespace: 'test-authority' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'test-authority' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const call = () => module.exports.POST(new Request('http://localhost/api/hermes/tools/breadboard-use', {
    method: 'POST', body: JSON.stringify({ args: { action, sessionId: 'forged', userId: 99 } }),
  }));
  const token = (surface = 'dashboard_terminal', allowedTools = ['breadboard_use']) => issueCapabilityToken({
    userId: 7, conversationId: 44, breadboardSessionId: '33', hermesSessionId: 'runtime', surface, allowedTools,
  });
  try {
    assert.equal((await call()).status, 403);
    state.token = token('dashboard_terminal', []); assert.equal((await call()).status, 403);
    state.token = token();
    state.conversation.user_id = 8; assert.equal((await call()).status, 403);
    state.conversation.user_id = 7;
    state.run = null; assert.equal((await call()).status, 409);
    state.run = { id: 'run' };
    assert.equal(state.calls.length, 0);
    for (const surface of ['dashboard_terminal', 'garden_chat']) {
      state.session.surface = surface; state.token = token(surface);
      assert.equal((await call()).status, 200);
      assert.equal(state.calls.at(-1)[0].action, action);
      assert.deepEqual(state.calls.at(-1).slice(1), ['33', 7]);
    }
    state.session.surface = 'quartz_ai'; state.token = token('quartz_ai');
    assert.equal((await call()).status, 403);
    state.session.surface = 'garden_chat'; state.token = token('dashboard_terminal');
    assert.equal((await call()).status, 403);
  } finally { delete globalThis.__breadboardUseRouteTest; }
});
}

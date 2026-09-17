import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { issueCapabilityToken } from '../src/lib/hermes/capability-token.ts';

test('real image-search route binds user, conversation, surface and active tool grant', async () => {
  const state = globalThis.__imageSearchRouteTest = {
    token: null, session: { id: 33, user_id: 7, conversation_id: 44, surface: 'dashboard_terminal', garden_id: null },
    conversation: { id: 44, user_id: 7, public_id: 'owned-chat' },
    decision: { allowedTools: ['image_search'] }, calls: [], audit: [], failure: null,
  };
  const stubs = {
    '@/lib/hermes/tool-service-auth.ts': 'export const capabilityForInternalToolRequest = () => globalThis.__imageSearchRouteTest.token;',
    '@/lib/hermes/runtime-store.ts': `const state = globalThis.__imageSearchRouteTest;
      export const getRuntimeSessionById = id => id === 33 ? state.session : null;
      export const runtimeExternalSessionId = () => 'runtime';
      export const getActiveCapabilityDecision = () => state.decision;
      export const recordAuditEvent = event => state.audit.push(event);`,
    '@/lib/conversations/store.ts': 'export const getConversationById = () => globalThis.__imageSearchRouteTest.conversation;',
    '@/lib/hermes/image-search-service.ts': `export class ImageSearchServiceError extends Error { constructor(code) { super(code); this.code = code; } }
      export const searchImages = async (args, options) => {
        const state = globalThis.__imageSearchRouteTest;
        state.calls.push({ args, options });
        if (state.failure) throw new ImageSearchServiceError(state.failure);
        return { query: args.query, itemsReturned: 1, display: { query: args.query, items: [{ image: 'https://example.com/photo.jpg' }] }, screenshot: { dataUrl: 'private-image-bytes' } };
      };`,
    '@/lib/hermes/route-helpers.ts': `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
      export const requireEnabled = () => {}; export const readJsonBody = request => request.json();
      export const apiErrorResponse = error => Response.json({ error: error.message, code: error.code }, { status: error.status || 500 });`,
  };
  const bundle = await build({ entryPoints: ['src/app/api/hermes/tools/image-search/route.ts'], bundle: true,
    write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'image-search-authority', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => stubs[args.path] ? { path: args.path, namespace: 'authority' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'authority' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const token = overrides => issueCapabilityToken({ userId: 7, conversationId: 44, breadboardSessionId: '33',
    hermesSessionId: 'runtime', surface: 'dashboard_terminal', allowedTools: ['image_search'], ...overrides });
  const call = () => module.exports.POST(new Request('http://localhost/api/hermes/tools/image-search', {
    method: 'POST', body: JSON.stringify({ args: { query: 'portrait', count: 1 } }),
  }));
  try {
    assert.equal((await call()).status, 403);
    for (const overrides of [{ userId: 8 }, { conversationId: 45 }, { breadboardSessionId: '34' },
      { hermesSessionId: 'other-runtime' }, { surface: 'garden_chat' }, { allowedTools: [] }]) {
      state.token = token(overrides);
      assert.equal((await call()).status, 403, JSON.stringify(overrides));
    }
    state.token = token();
    for (const decision of [null, { allowedTools: [] }]) {
      state.decision = decision;
      assert.equal((await call()).status, 403);
    }
    state.decision = { allowedTools: ['image_search'] };
    state.conversation.user_id = 8;
    assert.equal((await call()).status, 403);
    state.conversation.user_id = 7;
    assert.equal(state.calls.length, 0, 'denied requests never invoke search or preview downloads');
    const response = await call();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.screenshot.dataUrl, 'private-image-bytes');
    assert.deepEqual(state.calls[0].options.scope, { userId: 7, gardenId: null, conversationId: 'owned-chat' });
    assert.deepEqual(state.calls[0].args, { query: 'portrait', count: 1 });
    assert.ok(state.calls[0].options.signal instanceof AbortSignal);
    assert.ok(!JSON.stringify(state.audit).includes('private-image-bytes'), 'audit does not retain image payloads');
    for (const [failure, status] of [['image_search_aborted', 499], ['image_search_invalid_arguments', 400],
      ['image_search_preview_failed', 502], ['image_search_unconfigured', 503]]) {
      state.failure = failure;
      const response = await call();
      assert.equal(response.status, status);
      assert.equal((await response.json()).code, failure);
    }
  } finally {
    delete globalThis.__imageSearchRouteTest;
  }
});

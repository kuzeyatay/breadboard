import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

test('agent and direct voice requests retain current-view access in Garden chats and exclude public Quartz', async () => {
  const state = globalThis.__voiceScreenRoutes = { surface: 'garden_chat', calls: [] };
  const stubs = {
    'next/server': 'export const NextResponse = Response;',
    '@/lib/server-auth': 'export const requireUserId = async () => 7;',
    '@/lib/conversations/store.ts': `export const getConversationForUser = () => ({ id: 44, user_id: 7, public_id: 'chat-44', surface: globalThis.__voiceScreenRoutes.surface }); export const failAssistantMessage = () => {};`,
    '@/lib/conversations/turn-service.ts': `export const startConversationTurn = async input => { globalThis.__voiceScreenRoutes.calls.push(input); return { accepted: true, run: { id: 'run' } }; };`,
    '@/lib/conversations/direct-turn-service.ts': `export const startDirectProviderTurn = async input => { globalThis.__voiceScreenRoutes.calls.push(input); return Response.json({ accepted: true }); };`,
    '@/lib/hermes/route-helpers.ts': `export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; } }
      export const requireEnabled = () => {}; export const readJsonBody = req => req.json(); export const requireString = value => value;
      export const apiErrorResponse = error => Response.json({ error: error.message }, { status: error.status || 500 });`,
    '@/lib/hermes/config.ts': `export const HERMES_SURFACES = ['dashboard_terminal', 'garden_chat', 'garden_assistant', 'quartz_ai'];`,
    '@/lib/chat-attachments-request.ts': 'export const parseChatAttachments = () => [];',
    '@/lib/document-attachments-server.ts': 'export const hydrateDocumentAttachments = async (user, attachments) => attachments;',
    '@/lib/colpali/retrieval.ts': 'export const retrieveDocumentAttachments = async (user, attachments) => attachments;',
    '@/lib/conversations/branch-history.ts': 'export const parseConversationBranchHistory = () => undefined; export const resolveConversationBranchHistory = () => undefined;',
    '@/lib/chat-text-selection.ts': 'export const normalizeChatTextSelectionReference = () => undefined;',
    '@/lib/hermes/current-location-context.ts': 'export const parseCurrentLocationPayload = () => undefined;',
    '@/lib/supervisor-control.ts': 'export class SupervisorResourceExhaustedError extends Error {}',
    '@/lib/hermes/event-stream.ts': 'export const startSessionEventPump = () => {};',
    '@/lib/schedules/receipt-server.ts': 'export const scheduledChatReceiptForUser = () => undefined;',
    '@/lib/hermes/route-core.ts': 'export const describeError = () => ({ status: 500 });',
    '@/lib/hermes/error-diagnostic.ts': 'export const unexpectedErrorDiagnostic = () => ({});',
    '@/lib/hermes/runtime-store.ts': 'export const recordAuditEvent = () => {};',
    // The actual surface resolver is used; only its storage dependencies are replaced.
    '../db.ts': 'export default { prepare: () => ({ get: () => undefined }) };',
    './runtime-store.ts': 'export const getRuntimeSessionByConversation = () => ({ garden_id: "garden-a", page_slug: "notes" });',
  };
  const access = { port: 43210, token: 'a'.repeat(64) };
  try {
    for (const endpoint of ['messages', 'direct']) {
      const bundle = await build({
        entryPoints: [`src/app/api/hermes/sessions/[sessionId]/${endpoint}/route.ts`],
        bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
        plugins: [{ name: 'voice-route-authority', setup(builder) {
          builder.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }));
        } }],
      });
      const module = { exports: {} };
      new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
      const call = async (surface, browserAccess) => {
        const response = await module.exports.POST(new Request('http://localhost/api/hermes/sessions/chat-44/' + endpoint, {
          method: 'POST', body: JSON.stringify({ surface, browserAccess, voice: true, text: 'What is on this screen?', clientMessageId: 'voice-turn' }),
        }), { params: Promise.resolve({ sessionId: 'chat-44' }) });
        assert.equal(response.status, 200, await response.text());
        return state.calls.at(-1);
      };
      state.surface = 'garden_chat';
      for (const surface of ['garden_chat', 'garden_assistant', 'dashboard_terminal']) {
        const result = await call(surface, access);
        assert.deepEqual(result.browserAccess, access, `${endpoint}/${surface}`);
        assert.equal(result.text, 'What is on this screen?');
        if (endpoint === 'messages') assert.equal(result.voice, true);
      }
      assert.equal((await call('garden_chat', null)).browserAccess, undefined);
      assert.equal((await call('garden_chat', { port: 80, token: 'invalid' })).browserAccess, undefined);
      assert.equal((await call('quartz_ai', access)).browserAccess, undefined);
      // A public conversation cannot acquire screen access by presenting as a Terminal.
      state.surface = 'quartz_ai';
      assert.equal((await call('dashboard_terminal', access)).browserAccess, undefined);
    }
  } finally { delete globalThis.__voiceScreenRoutes; }
});

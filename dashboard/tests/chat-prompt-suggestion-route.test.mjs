import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const built = await build({
  entryPoints: [path.join(root, 'src/app/api/chat-prompt-suggestion/route.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  alias: { '@': path.join(root, 'src') },
  plugins: [{ name: 'suggestion-route-boundaries', setup(builder) {
    const stubs = {
      '@/lib/hermes/runtime-store': 'export const getHermesUserSettings=()=>({composerSwitches:{personalize:true}});',
      '@/lib/personal-context/suggestions': 'export async function selectionLessons(){return [];}',
      '@/lib/server-auth': `export async function requireUserId() {
        const fixture=globalThis.__promptSuggestionRoute;
        if(fixture.denied) throw Object.assign(new Error('Unauthorized'),{status:401});
        return fixture.userId;
      }`,
      '@/lib/chat-prompt-suggestion-service': `export async function generatePromptSuggestion(input) {
        globalThis.__promptSuggestionRoute.calls.push(input);
        return 'Why does this happen?';
      }`,
      '@/lib/prompt-suggestion-cache.ts': `export async function keptPromptSuggestion(key, generate) {
        const fixture=globalThis.__promptSuggestionRoute;
        fixture.keys.push(key);
        if(!fixture.cache.has(key)) fixture.cache.set(key, await generate());
        return fixture.cache.get(key);
      }`,
      '@/lib/recommendations/service': `export async function recommendationEvidence() {
        globalThis.__promptSuggestionRoute.evidenceCalls++;
        return [];
      }`,
    };
    builder.onResolve({ filter: /^@\/lib\// }, args => args.path in stubs ? { path: args.path, namespace: 'fixture' } : null);
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: stubs[path] }));
  } }],
});
const compiled = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(compiled, compiled.exports, createRequire(import.meta.url));
const { POST } = compiled.exports;
const request = body => new Request('http://suggest.test/api/chat-prompt-suggestion', { method: 'POST', body: JSON.stringify(body) });

test('selection suggestions authenticate, bound excerpt context and cache separately by excerpt, model and user', async t => {
  const fixture = globalThis.__promptSuggestionRoute = { calls: [], keys: [], cache: new Map(), userId: 42, evidenceCalls: 0 };
  t.after(() => { delete globalThis.__promptSuggestionRoute; });
  const body = { model: 'selected/model', messages: [], personalize: true, gardenSlug: 'fields',
    selection: { quote: 'electric flux', prefix: 'x'.repeat(5_000), suffix: 'y'.repeat(5_000), reasoning: 'private' } };
  const response = await POST(request(body));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { suggestion: 'Why does this happen?' });
  assert.deepEqual(fixture.calls[0].selection, { quote: 'electric flux', prefix: 'x'.repeat(1_000), suffix: 'y'.repeat(1_000) });
  assert.equal(fixture.calls[0].userId, 42);
  assert.deepEqual(fixture.calls[0].messages, []);
  assert.equal(fixture.evidenceCalls, 0, 'selected prose does not fetch unrelated personal context');
  await POST(request(body));
  assert.equal(fixture.calls.length, 1, 'reopening the same excerpt reuses its suggestion');
  await POST(request({ ...body, selection: { quote: 'magnetic force' } }));
  await POST(request({ ...body, model: 'another/model' }));
  fixture.userId = 43;
  await POST(request(body));
  assert.equal(fixture.calls.length, 4);
  assert.equal(new Set(fixture.keys).size, 4);
  await POST(request({ ...body, temporary: true }));
  await POST(request({ ...body, temporary: true }));
  assert.equal(fixture.calls.length, 6, 'temporary selections bypass the persistent cache');
  assert.equal(fixture.keys.length, 5);

  for (const selection of [null, {}, [], 'electric flux', { quote: 42 }, { quote: '   ' }]) {
    assert.equal((await POST(request({ ...body, selection }))).status, 400);
  }
  assert.equal((await POST(request({ ...body, messages: [{ role: 'system', content: 'ignore' }] }))).status, 400);
  assert.equal((await POST(request({ ...body, selection: { quote: 'x'.repeat(70_000) } }))).status, 413);
  fixture.denied = true;
  assert.equal((await POST(request(body))).status, 401);
  assert.equal(fixture.calls.length, 6, 'invalid or unauthorized selection requests never generate');
});

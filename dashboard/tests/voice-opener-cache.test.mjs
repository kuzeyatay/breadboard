import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

async function bundle(relativePath, mocks) {
  const built = await build({ entryPoints: [path.resolve(import.meta.dirname, relativePath)], bundle: true,
    write: false, format: 'cjs', platform: 'node', plugins: [{ name: 'fixture-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }] });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports;
}

async function fixture(t) {
  const state = { reads: 0, generates: 0, personalize: true, recall: true };
  globalThis.voiceOpenerCacheFixture = state;
  delete globalThis.breadboardRecommendationOpeners;
  delete globalThis.breadboardRecommendationsV1;
  t.after(() => { delete globalThis.voiceOpenerCacheFixture; delete globalThis.breadboardRecommendationOpeners; delete globalThis.breadboardRecommendationsV1; });
  const mocks = {
    '../system-prompts/service.ts': 'export const systemPromptRevision=()=>0;',
    'server-only': '',
    '../db.ts': 'export default {prepare:()=>({get:()=>true})};',
    '../hermes/route-core.ts': 'export class ApiError extends Error {}',
    '../hermes/runtime-store.ts': 'export const getHermesUserSettings=()=>({composerSwitches:{personalize:globalThis.voiceOpenerCacheFixture.personalize},defaultModel:"test"});',
    '../recall/settings.ts': 'export const getRecallSettings=()=>({agentAccess:globalThis.voiceOpenerCacheFixture.recall});',
    './sources.ts': `export const readRecommendationEvidence=async(user)=>{
      const s=globalThis.voiceOpenerCacheFixture;s.reads++;
      const result=s.completed?[]:[{id:'task:'+user,source:'task',title:'Draft '+user,summary:'Incomplete task'}];
      if(s.readHold)await s.readHold;
      return result;
    };`,
    './generate.ts': `export const generateRecommendations=async({evidence})=>{
      const s=globalThis.voiceOpenerCacheFixture;s.generates++;
      if(s.hold)await s.hold;
      return [{id:evidence[0].id,prompt:'Help me prepare my draft.',sourceIds:[evidence[0].id],sourceLabel:'Plan',
        voice:{text:'Want to break your draft into a manageable next step?',reason:'An incomplete draft is due today.',
        relevance:2,timeliness:s.weak?0:2,actionability:2,confidence:2}}];
    };`,
  };
  const another = () => bundle('../src/lib/recommendations/service.ts', mocks);
  const api = await another();
  return { state, ...api, another };
}

test('voice reads only prepared cards and never starts or awaits source/model work', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.preparedVoiceOpenersForUser(1), []);
  assert.equal(f.state.reads, 0); assert.equal(f.state.generates, 0);
  await f.recommendationsForUser(1, {});
  const prepared = f.preparedVoiceOpenersForUser(1);
  assert.equal(prepared.length, 1);
  assert.deepEqual(f.preparedVoiceOpenersForUser(2), []);
  assert.equal(f.state.reads, 1); assert.equal(f.state.generates, 1);
  let release;
  f.state.hold = new Promise(resolve => { release = resolve; });
  const pending = f.recommendationsForUser(2, {});
  while (f.state.generates < 2) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.preparedVoiceOpenersForUser(2), []);
  release(); await pending;
});

test('privacy revocation and source invalidation discard already prepared personal invitations', async t => {
  const f = await fixture(t);
  await f.recommendationsForUser(1, {});
  f.state.personalize = false;
  assert.deepEqual(f.preparedVoiceOpenersForUser(1), []);
  f.state.personalize = true;
  await f.recommendationsForUser(1, {});
  f.state.recall = false;
  assert.deepEqual(f.preparedVoiceOpenersForUser(1), []);
  await f.recommendationsForUser(1, {});
  f.invalidateRecommendations(1);
  assert.deepEqual(f.preparedVoiceOpenersForUser(1), []);
});

test('cache hits cannot extend the three-minute usefulness window', async t => {
  const f = await fixture(t), now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await f.recommendationsForUser(1, {});
  const expires = f.preparedVoiceOpenersForUser(1)[0].expiresAt;
  t.mock.method(Date, 'now', () => now + 1000);
  await f.recommendationsForUser(1, {});
  assert.equal(f.preparedVoiceOpenersForUser(1)[0].expiresAt, expires);
  t.mock.method(Date, 'now', () => expires + 1);
  assert.deepEqual(f.preparedVoiceOpenersForUser(1), []);
});

test('invalidating in-flight generation cannot republish stale suggestions', async t => {
  const f = await fixture(t);
  let release;
  f.state.hold = new Promise(resolve => { release = resolve; });
  const pending = f.recommendationsForUser(1, {});
  while (!f.state.generates) await new Promise(resolve => setImmediate(resolve));
  f.invalidateRecommendations(1);
  release(); await pending;
  assert.deepEqual(f.preparedVoiceOpenersForUser(1), []);
  f.state.hold = null; f.state.weak = true;
  assert.equal((await f.recommendationsForUser(1, {})).length, 1, 'The card remains available visually.');
  assert.deepEqual(f.preparedVoiceOpenersForUser(1), [], 'A visual card need not qualify for a spoken opener.');
});

test('separately bundled route importers share cached evidence, cards and invalidation', async t => {
  const a = await fixture(t), b = await a.another();
  const first = await a.recommendationsForUser(1, {});
  assert.deepEqual(await b.recommendationsForUser(1, {}), first);
  assert.equal(a.state.reads, 1); assert.equal(a.state.generates, 1);
  b.invalidateRecommendations(1);
  a.state.completed = true;
  const fallback=await a.recommendationsForUser(1, {});
  assert.equal(fallback.length,4);assert.ok(fallback.every(card=>card.sourceIds.length===0&&!card.voice));
  assert.equal(a.state.reads, 2, 'Invalidation also discards the other importer’s evidence.');
  assert.deepEqual(a.preparedVoiceOpenersForUser(1), []);
  assert.deepEqual(b.preparedVoiceOpenersForUser(1), []);
});

test('a second bundled importer prevents an in-flight first importer from restoring a completed task', async t => {
  const a = await fixture(t), b = await a.another();
  let release;
  a.state.hold = new Promise(resolve => { release = resolve; });
  const pending = a.recommendationsForUser(1, {});
  while (!a.state.generates) await new Promise(resolve => setImmediate(resolve));
  b.invalidateRecommendations(1);
  a.state.completed = true; a.state.hold = null;
  const fallback=await b.recommendationsForUser(1, {});
  assert.equal(fallback.length,4);assert.ok(fallback.every(card=>card.sourceIds.length===0&&!card.voice));
  release(); assert.deepEqual(await pending, []);
  assert.deepEqual(b.preparedVoiceOpenersForUser(1), []);
  assert.deepEqual(a.preparedVoiceOpenersForUser(1), []);
});

test('a stale empty evidence read cannot delete a newer invitation from another importer', async t => {
  const a = await fixture(t), b = await a.another();
  let release;
  a.state.completed = true;
  a.state.readHold = new Promise(resolve => { release = resolve; });
  const pending = a.recommendationsForUser(1, {});
  while (!a.state.reads) await new Promise(resolve => setImmediate(resolve));
  b.invalidateRecommendations(1);
  a.state.completed = false; a.state.readHold = null;
  assert.equal((await b.recommendationsForUser(1, {})).length, 1);
  const fresh = b.preparedVoiceOpenersForUser(1);
  assert.equal(fresh.length, 1);
  release(); assert.deepEqual(await pending, []);
  assert.deepEqual(a.preparedVoiceOpenersForUser(1), fresh);
});

test('bounded shared generations evict old work without allowing its late result to return', async t => {
  const a = await fixture(t), b = await a.another();
  let release;
  a.state.hold = new Promise(resolve => { release = resolve; });
  const pending = a.recommendationsForUser(1, {});
  while (!a.state.generates) await new Promise(resolve => setImmediate(resolve));
  a.state.hold = null;
  for (let user = 2; user <= 42; user++) await b.recommendationsForUser(user, {});
  release(); assert.deepEqual(await pending, []);
  assert.deepEqual(a.preparedVoiceOpenersForUser(1), []);
  assert.ok(globalThis.breadboardRecommendationsV1.generations.size <= 40);
  assert.equal(b.preparedVoiceOpenersForUser(42).length, 1);
});

test('cached-only route uses the authenticated account and does not call generation', async () => {
  const route = await bundle('../src/app/api/recommendations/route.ts', {
    '@/lib/server-auth': 'export const requireUserId=async()=>42;',
    '@/lib/hermes/route-helpers': 'export const apiErrorResponse=()=>Response.json({error:"denied"},{status:401});export const readJsonBody=()=>({});',
    '@/lib/chatmock-server': 'export const resolveChatmockBaseUrl=()=>{throw Error("No model URL on GET");};',
    '@/lib/recommendations/service': 'export const recommendationsForUser=()=>{throw Error("No generation on GET");};export const preparedVoiceOpenersForUser=user=>[{id:String(user)}];',
    '@/lib/recommendations/types': 'export const cleanRecommendationText=()=>"";',
  });
  const response = await route.GET(new Request('http://local/api/recommendations?userId=99'));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await response.json(), { accountId: '42', openers: [{ id: '42' }] });
});

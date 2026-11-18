import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const built = await build({
  entryPoints: [path.join(root, 'src/app/api/sentence-completion/route.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  alias: { '@': path.join(root, 'src') },
  plugins: [{ name: 'sentence-route-boundaries', setup(builder) {
    builder.onResolve({filter:/^@\/lib\/(?:db|personal-context\/room)$/},args=>({path:args.path,namespace:'room-test'}));
    builder.onLoad({filter:/.*/,namespace:'room-test'},({path:name})=>({contents:name.endsWith('/room')?'export const roomLessons=()=>[];':'export default {};'}));
    builder.onResolve({ filter: /^@\/lib\/(?:server-auth|sentence-completion-service|hermes\/runtime-store|personal-context\/suggestions)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ contents:
      name.endsWith('runtime-store')
        ? "export const getHermesUserSettings=()=>({composerSwitches:{personalize:globalThis.__sentenceCompletionRoute.enabled !== false}});"
        : name.endsWith('suggestions')
        ? "export const selectionLessons=async(user,id)=>{globalThis.__sentenceCompletionRoute.reads.push([user,id]);return []};export const learnedEvidence=async(user,slug)=>{globalThis.__sentenceCompletionRoute.reads.push([user,slug]);return [{id:'lesson:map',title:'Catchment map',summary:'Draw the watershed first'}]};"
        : name.endsWith('server-auth')
        ? `export async function requireUserId() {
            const fixture=globalThis.__sentenceCompletionRoute;
            if(fixture.denied) throw Object.assign(new Error('Unauthorized'),{status:401});
            return 42;
          }`
        : `export async function generateSentenceCompletion(input) {
            globalThis.__sentenceCompletionRoute.calls.push(input);
            return ' a practical example?';
          }`,
    }));
  } }],
});

test('typed predictions read lessons only for the requested eligible scope',async t=>{
  const state=globalThis.__sentenceCompletionRoute={calls:[],reads:[]};
  t.after(()=>{delete globalThis.__sentenceCompletionRoute;});
  for(const extra of [{temporary:true},{scope:'public'},{personalize:false},{}]){
    await POST(request({draft:'Draw a catchment',gardenSlug:'headwater',personalize:true,...extra}));
  }
  assert.deepEqual(state.reads,[[42,'headwater']]);
  assert.match(state.calls.at(-1).learned.join(' '),/watershed/);
  await POST(request({draft:'Draw a catchment',personalize:true,documentConversationId:'temp-document'}));
  assert.deepEqual(state.reads.at(-1),[42,'temp-document']);
  assert.deepEqual(state.calls.at(-1).learned,[]);
  state.enabled=false;
  await POST(request({draft:'Draw a catchment',personalize:true}));
  assert.deepEqual(state.calls.at(-1).learned,[]);
});
const module = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
const { POST } = module.exports;
const request = (body, signal) => new Request('http://completion.test/api/sentence-completion', {
  method: 'POST', body: JSON.stringify(body), signal,
});

test('completion route authenticates, bounds context, preserves the draft and forwards cancellation', async t => {
  const fixture = globalThis.__sentenceCompletionRoute = { calls: [], denied: false };
  t.after(() => { delete globalThis.__sentenceCompletionRoute; });
  const controller = new AbortController();
  const incoming = request({ draft: 'Can you show ', model: 'chat-model', messages: [
    { role: 'assistant', content: 'Here are some circuit ideas.', reasoning: 'private' },
  ] }, controller.signal);
  const response = await POST(incoming);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { completion: ' a practical example?' });
  assert.equal(fixture.calls[0].userId, 42);
  assert.equal(fixture.calls[0].draft, 'Can you show ');
  assert.equal('model' in fixture.calls[0], false);
  assert.deepEqual(fixture.calls[0].messages, [{ role: 'assistant', content: 'Here are some circuit ideas.' }]);
  assert.equal(fixture.calls[0].signal.aborted, false);
  controller.abort();
  assert.equal(fixture.calls[0].signal.aborted, true);

  for (const body of [
    {}, { draft: '' }, { draft: 'x'.repeat(4001) },
    { draft: 'Can you show', messages: 'wrong' },
    { draft: 'Can you show', messages: Array(5).fill({ role: 'user', content: 'hello' }) },
    { draft: 'Can you show', messages: [{ role: 'system', content: 'wrong role' }] },
    { draft: 'Can you show', messages: [{ role: 'user', content: 'x'.repeat(1001) }] },
    { draft: 'Can you show', messages: [null] },
  ]) assert.equal((await POST(request(body))).status, 400, JSON.stringify(body));
  assert.equal((await POST(request({ draft: 'x'.repeat(70_000) }))).status, 413);
  fixture.denied = true;
  assert.equal((await POST(request({ draft: 'Can you show' }))).status, 401);
  assert.equal(fixture.calls.length, 1, 'invalid and unauthorized requests never reach the model');
});

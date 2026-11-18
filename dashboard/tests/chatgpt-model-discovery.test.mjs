import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';
import { loadChatmockModelCatalog } from '../src/lib/chatmock-model-catalog.ts';
import { resolveAvailableHermesEngine } from '../src/lib/hermes/model-selection.ts';
import { formatAssistantModelName } from '../src/lib/ai-models.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-model-discovery-'));
process.env.BREADBOARD_DATA_DIR = root;
process.env.HERMES_ROOT = path.join(root, 'hermes');
const { HermesRuntimeAdapter } = await import('../src/lib/agent-runtime/adapters/hermes.ts');
const { default: db } = await import('../src/lib/db.ts');
const discovered = {id:'gpt-9.9-sol',object:'model',owned_by:'chatgpt',name:'GPT-9.9 Sol',reasoning_efforts:['low','high','max']};

after(() => {
  db.close();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('breadboard-model-discovery-'));
  fs.rmSync(root, {recursive:true,force:true});
});

test('a discovered model reaches Hermes config and prompt submission unchanged', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('/models')) return Response.json({data:[discovered]});
    throw new Error('unexpected fetch');
  });
  const engine = await resolveAvailableHermesEngine(discovered.id, 'max');
  assert.equal(engine.model.modelID, discovered.id);
  assert.equal(engine.selectedModelID, discovered.id);
  assert.equal(engine.variant, 'max');
  assert.equal(engine.adjusted, false);
  assert.equal(formatAssistantModelName(discovered.id), discovered.name);
  const requests = [];
  const adapter = new HermesRuntimeAdapter({baseUrl:'http://127.0.0.1:9119',chatmockBaseUrl:'http://127.0.0.1:8765/v1',sessionToken:'test',requestTimeoutMs:5000});
  adapter.ensureSessionLease = async () => null;
  adapter.ensureModelServiceLease = async () => null;
  adapter.client = {
    async request(method, params) {
      requests.push({method,params});
      return method === 'session.create' ? {session_id:'live',stored_session_id:'stored'} : {};
    },
    clearSession() {}, close() {},
  };
  t.after(() => adapter.dispose());
  assert.equal((await adapter.listModels())[0].id, discovered.id);
  const session = await adapter.createSession({surface:'dashboard_terminal',sessionKey:'discovered-model'});
  await adapter.startRun({...session,model:engine.model,modelIdentity:{modelID:engine.selectedModelID},variant:engine.variant,text:'Use the selected model',messageId:'turn_discovery'});
  assert.ok(requests.some(row=>row.method==='config.set' && row.params.key==='model' && row.params.value===discovered.id));
  assert.ok(requests.some(row=>row.method==='config.set' && row.params.key==='reasoning' && row.params.value==='max'));
  assert.ok(requests.some(row=>row.method==='prompt.submit'));
});

test('new models can be inherited and their effort is clamped to advertised levels', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({data:[{...discovered,reasoning_efforts:['low','high']}]}));
  const engine = await resolveAvailableHermesEngine(undefined, 'max', discovered.id);
  assert.equal(engine.selectedModelID, discovered.id);
  assert.equal(engine.variant, 'high');
  assert.equal(engine.adjusted, true);
});

test('unadvertised native ids and failed discovery never silently choose another model', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({data:[discovered]}));
  await assert.rejects(resolveAvailableHermesEngine('gpt-unknown', 'high'), error=>error.code==='unsupported_model');
  fetch.mock.mockImplementation(async () => {throw new Error('offline');});
  await assert.rejects(resolveAvailableHermesEngine(discovered.id, 'max'), error=>error.code==='model_catalog_unavailable' && error.status===503);
  assert.equal((await resolveAvailableHermesEngine('gpt-6.2-sol', 'max')).selectedModelID, 'gpt-6.2-sol');
});

test('catalog transport validates responses and keeps metadata for new models', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({data:[discovered,{id:'bad id'},{id:'chat'}]}));
  assert.deepEqual(await loadChatmockModelCatalog('http://127.0.0.1:9999/v1'), [discovered]);
  assert.equal(fetch.mock.calls[0].arguments[0], 'http://127.0.0.1:9999/v1/models');
  fetch.mock.mockImplementation(async () => Response.json({data:[discovered]}, {status:401}));
  await assert.rejects(loadChatmockModelCatalog(), /HTTP 401/);
  fetch.mock.mockImplementation(async () => Response.json({error:'bad response'}));
  await assert.rejects(loadChatmockModelCatalog(), /Invalid model catalog/);
});

test('the models API preserves discovered GPT and provider models without a runtime allowlist', async t => {
  const outfile = path.join(root, 'models-route.mjs');
  await esbuild.build({
    entryPoints:[path.resolve(import.meta.dirname,'../src/app/api/models/route.ts')],
    outfile,bundle:true,platform:'node',format:'esm',packages:'external',
    plugins:[{name:'boundaries',setup(build){
      build.onResolve({filter:/^(next\/server|@\/lib\/(server-auth|cliproxy\/catalog-sync))$/}, args=>({path:args.path,namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'}, args=>({contents: args.path==='next/server'
        ? 'export const NextResponse = {json: (body,init) => Response.json(body,init)};'
        : args.path.endsWith('server-auth') ? 'export class RouteError extends Error {} export const requireUserId=async()=>1; export const routeErrorResponse=()=>Response.json({}, {status:401});'
        : 'export const scheduleSubscriptionCatalogAutoSync=()=>{};'}));
    }}],
  });
  const provider = {...discovered,id:'anthropic/claude-future',owned_by:'anthropic'};
  const fetch = t.mock.method(globalThis,'fetch', async()=>Response.json({data:[discovered,provider]}));
  const route = await import(pathToFileURL(outfile).href);
  assert.deepEqual((await (await route.GET(new Request('http://localhost/api/models'))).json()).data, [discovered,provider]);
  fetch.mock.mockImplementation(async()=>{throw new Error('offline');});
  const fallback = await (await route.GET(new Request('http://localhost/api/models'))).json();
  assert.ok(fallback.data.some(model=>model.id==='gpt-6.2-sol'));
});

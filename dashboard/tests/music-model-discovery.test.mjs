import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const root=process.env.BREADBOARD_TEST_REPO??path.resolve(import.meta.dirname,'../..');
const sourceRoot=process.env.BREADBOARD_TEST_CANDIDATE??root;
const {default:ts}=await import(pathToFileURL(path.join(root,'dashboard/node_modules/typescript/lib/typescript.js')));
const source=fs.readFileSync(path.join(sourceRoot,'dashboard/src/lib/acestep/client.ts'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  .replace('"./capabilities.ts"',JSON.stringify(pathToFileURL(path.join(root,'dashboard/src/lib/acestep/capabilities.ts')).href));
const client=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

async function provider(t,body){
  const requests=[];
  const server=http.createServer((req,res)=>{requests.push({url:req.url,method:req.method,authorization:req.headers.authorization});res.setHeader('content-type','application/json');res.end(JSON.stringify(body));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return {requests,connection:{baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'fixture-only',model:'acestep-v15-turbo'}};
}

test('the pinned OpenRouter model list yields generation identities, not display labels',async t=>{
  const fake=await provider(t,{object:'list',data:[{id:'acestep/acestep-v15-turbo',name:'ACE-Step acestep-v15-turbo',input_modalities:['text','audio'],output_modalities:['audio','text']}]});
  assert.deepEqual(await client.discoverModels(fake.connection),['acestep-v15-turbo']);
  assert.deepEqual(fake.requests,[{url:'/v1/models',method:'GET',authorization:'Bearer fixture-only'}]);
});

test('legacy inventories retain compatibility but do not advertise an explicitly unloaded model',async t=>{
  const fake=await provider(t,{code:200,error:null,data:{models:[{name:'acestep-v15-turbo',is_loaded:true},{name:'acestep-v15-base',is_loaded:false},{name:'legacy-loaded-model'}]}});
  assert.deepEqual(await client.discoverModels(fake.connection),['acestep-v15-turbo','legacy-loaded-model']);
});

test('discovery rejects failed envelopes, untrusted namespaces and malformed inventories',async t=>{
  for(const body of [
    {object:'list',code:500,data:[]},{object:'list',error:'failed',data:[]},
    {object:'list',data:[{id:'other/acestep-v15-turbo'}]},
    {object:'list',data:[{id:'acestep/../acestep-v15-turbo'}]},
    {object:'list',data:[{name:'acestep-v15-turbo'}]},
    {object:'list',data:Array.from({length:33},()=>({id:'acestep/acestep-v15-turbo'}))},
    {code:200,data:{models:[{name:'turbo',is_loaded:'true'}]}},
  ]){
    const fake=await provider(t,body);
    await assert.rejects(()=>client.discoverModels(fake.connection),/invalid_model_discovery|provider_application_error/);
    assert.equal(fake.requests.length,1,'the actual response, not a transport error, must be rejected');
  }
});

test('OpenRouter compatibility cannot turn a task application error into a receipt',async t=>{
  const fake=await provider(t,{object:'list',data:[{task_id:'unexpected'}]});
  await assert.rejects(()=>client.api(fake.connection,'/release_task'),/provider_application_error/);
  assert.equal(fake.requests.length,1);
});

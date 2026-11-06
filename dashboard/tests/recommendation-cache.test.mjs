import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

async function fixture(t) {
  const state = { reads: [], generates: 0, personalize: true, recall: true, allowedGarden: true };
  globalThis.recommendationCacheFixture = state;
  t.after(() => { delete globalThis.recommendationCacheFixture; });
  const mocks = {
    'server-only': '',
    '../db.ts': 'export default {prepare:()=>({get:()=>globalThis.recommendationCacheFixture.allowedGarden})};',
    '../hermes/route-core.ts': 'export class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;}}',
    '../hermes/runtime-store.ts': 'export const getHermesUserSettings=()=>({composerSwitches:{personalize:globalThis.recommendationCacheFixture.personalize},defaultModel:"test"});',
    '../recall/settings.ts': 'export const getRecallSettings=()=>({agentAccess:globalThis.recommendationCacheFixture.recall});',
    './sources.ts': `export const readRecommendationEvidence=async(user,context)=>{
      const s=globalThis.recommendationCacheFixture;s.reads.push({user,context});
      if(s.holdRead)await s.holdRead;
      return [{id:'chat:'+user,source:'chat',title:'Work '+user,summary:''}];
    };`,
    './generate.ts': `export const generateRecommendations=async({evidence})=>{
      const s=globalThis.recommendationCacheFixture;s.generates++;
      if(s.holdGeneration)await s.holdGeneration;
      return [{id:evidence[0].id,prompt:evidence[0].title,sourceIds:[evidence[0].id],sourceLabel:'Recent chat'}];
    };`,
  };
  const built=await build({entryPoints:[path.resolve(import.meta.dirname,'../src/lib/recommendations/service.ts')],bundle:true,write:false,format:'cjs',platform:'node',
    plugins:[{name:'boundaries',setup(b){
      b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));
    }}]});
  const module={exports:{}};
  new Function('module','exports','require',built.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));
  return {state, ...module.exports};
}

test('recommendations share reads across surfaces but never across accounts or gardens', async t=>{
  const f=await fixture(t);
  const same=await Promise.all([f.recommendationsForUser(1,{}),f.recommendationsForUser(1,{})]);
  assert.deepEqual(same[0],same[1]);assert.equal(f.state.reads.length,1);assert.equal(f.state.generates,1);
  const other=await f.recommendationsForUser(2,{});assert.equal(other[0].prompt,'Work 2');
  await f.recommendationsForUser(1,{gardenSlug:'circuits'});assert.equal(f.state.reads.length,3);
  f.state.allowedGarden=false;
  await assert.rejects(f.recommendationsForUser(1,{gardenSlug:'private'}),{status:403});
  f.state.personalize=false;assert.deepEqual(await f.recommendationsForUser(1,{}),[]);
  assert.equal(f.state.reads.length,3);
});

test('Recall revocation while generating suppresses the result and changes the cached evidence policy', async t=>{
  const f=await fixture(t);let release;
  f.state.holdGeneration=new Promise(resolve=>{release=resolve;});
  const result=f.recommendationsForUser(1,{});
  while(!f.state.generates) await new Promise(resolve=>setImmediate(resolve));
  f.state.recall=false;release();assert.deepEqual(await result,[]);
  await f.recommendationsForUser(1,{});assert.equal(f.state.reads.length,2);
});

test('disconnect invalidates in-flight source reads and generated cards', async t=>{
  const f=await fixture(t);let release;
  f.state.holdRead=new Promise(resolve=>{release=resolve;});
  const read=f.recommendationEvidence(1,{});
  f.invalidateRecommendations(1);release();assert.deepEqual(await read,[]);
  f.state.holdRead=null;
  f.state.holdGeneration=new Promise(resolve=>{release=resolve;});
  const result=f.recommendationsForUser(1,{});
  while(!f.state.generates) await new Promise(resolve=>setImmediate(resolve));
  f.invalidateRecommendations(1);release();assert.deepEqual(await result,[]);
  f.state.holdGeneration=null;
  assert.equal((await f.recommendationsForUser(1,{})).length,1);
  assert.equal(f.state.reads.length,3);
});

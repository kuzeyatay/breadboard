import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import {visualizerCommandText} from '../../dashboard/src/lib/hermes/interactive-visualizer-intent.ts';
import {textToCadCommandText} from '../../dashboard/src/lib/hermes/text-to-cad-intent.ts';
import {patentDisclosureCommandText} from '../../dashboard/src/lib/hermes/patent-disclosure-intent.ts';
import {spotifyCommandText} from '../../dashboard/src/lib/hermes/spotify-intent.ts';

const root=path.resolve(import.meta.dirname,'../..');
const stage=process.env.RECOVERY_FIX_SOURCE_ROOT||root;
const require=createRequire(path.join(root,'dashboard/package.json'));
const ts=require('typescript');

// Execute the actual caller blocks, using the real intent selectors. Loading
// the entire turn service would also initialize unrelated product services.
const turnSource=fs.readFileSync(path.join(stage,'dashboard/src/lib/conversations/turn-service.ts'),'utf8');
function routed(name,selector,input){
  const variable={visualizer:'visualizer',textToCad:'textToCad',patentDisclosure:'patentDisclosure'}[name];
  const start=turnSource.indexOf(`const ${variable}Selection = ${name}CommandText({`);
  const end=turnSource.indexOf('\n  });',start)+6;
  assert.ok(start>=0&&end>start,'Production routing block must exist');
  const execute=new Function('input','currentConversationMessages','factcheckSelection','patentDisclosureSelection','watchSelection',`${name}CommandText`,'{'+turnSource.slice(start,end)+`;return ${variable}Selection;}`);
  return execute({surface:'dashboard_terminal',...input},[],{text:input.text},{text:input.text},{text:input.text},selector);
}
const taskContinuation={sourceRunId:'saved-authorized-run'};
test('a saved visualizer request keeps its skill and cannot fall through to Spotify',()=>{
  const text='Create an interactive visualizer of a sine wave with an amplitude slider and pause/play and reset controls.';
  const recovered=routed('visualizer',visualizerCommandText,{text,internalAgentContinuation:true,taskContinuation});
  assert.equal(recovered.automatic,true);
  assert.match(recovered.text,/^\/interactive-visualizer /);
  const playback=spotifyCommandText({text:recovered.text,surface:'dashboard_terminal',authenticated:true});
  assert.equal(playback.automatic,false);
  assert.equal(playback.text,recovered.text);
});
test('saved CAD and patent requests keep their artifact routes',()=>{
  for(const [name,selector,text] of [
    ['textToCad',textToCadCommandText,'Create a parametric STEP model of a mounting bracket.'],
    ['patentDisclosure',patentDisclosureCommandText,'Draft a patent disclosure for my new mechanical invention.'],
  ])assert.equal(routed(name,selector,{text,internalAgentContinuation:true,taskContinuation}).automatic,true,name);
});
test('agent reports remain exempt from artifact creation',()=>{
  for(const [name,selector,text] of [
    ['visualizer',visualizerCommandText,'Create an interactive visualizer of a wave with a slider.'],
    ['textToCad',textToCadCommandText,'Create a parametric STEP model of a bracket.'],
    ['patentDisclosure',patentDisclosureCommandText,'Draft a patent disclosure for my new mechanical invention.'],
  ])assert.equal(routed(name,selector,{text,internalAgentContinuation:true}).automatic,false,name);
});

function fixture(patch={},jobPatch={}){
  let current={id:'sr-fixture',userId:1,conversationId:9,stage:'queued',attempt:0,jobId:'stopped-job',deadline:Date.now()+60000,...patch};
  let authorized=true,phase='stable';const calls=[];
  const job={jobId:'stopped-job',jobType:'source-repair',workerKind:'source-repair-node',gardenId:null,conversationId:null,state:'interrupted',failureMessage:'Worker stopped',...jobPatch};
  const controller={MAX_SOURCE_REPAIR_ATTEMPTS:2,listSourceRepairs:()=>[{...current}],readSourceRepair:()=>({...current}),
    updateSourceRepair:(_data,_id,update)=>current={...current,...update},cancelSourceRepair:()=>{current.stage='cancelled';},readRepairJournal:()=>({phase,active:null})};
  const modules={
    'node:path':path,'node:url':{},'./authority.ts':{sourceRepairAuthority:()=>controller},
    './checkpoint.ts':{repairDataRoot:()=>'/disposable',repairTaskStillCurrent:()=>authorized,releaseRepairCheckpoint:()=>null},
    '../supervisor-control.ts':{inspectRuntimeJob:async()=>{calls.push('inspect');return job;},
      submitRuntimeJob:async(_authority,request)=>{calls.push(request);return {...job,jobId:'fresh-job',state:'queued'};},cancelRuntimeJob:async()=>{calls.push('cancel');}},
    '../hermes/task-recovery.ts':{scheduleTaskRecovery:()=>{calls.push('replay');}},
    '../chatmock-server.ts':{},'../agent-browser/provider.ts':{},
  };
  const code=ts.transpileModule(fs.readFileSync(path.join(stage,'dashboard/src/lib/source-repair/service.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};new Function('require','exports',code)(id=>{assert.ok(id in modules,id);return modules[id];},exports);
  return {service:exports,calls,job,get request(){return current;},set authorized(value){authorized=value;},set phase(value){phase=value;}};
}
test('an interrupted pre-activation repair resumes with a fresh native idempotency key',async()=>{
  const f=fixture();const original={...f.request};
  await f.service.reconcileSourceRepairs();
  assert.equal(f.request.stage,'queued');assert.equal(f.request.jobId,undefined);
  assert.equal(f.request.deadline,original.deadline);assert.equal(f.request.attempt,0);
  assert.equal(f.request.workerRestarts,1);assert.equal(f.request.generation,1);
  await f.service.reconcileSourceRepairs();
  assert.equal(f.request.jobId,'fresh-job');
  assert.equal(f.calls.filter(c=>typeof c==='object').length,1);
  assert.equal(f.calls.find(c=>typeof c==='object').idempotencyKey,'source-repair:sr-fixture:1');
  assert.ok(!f.calls.includes('replay'),'Unverified source cannot resume the user task');
});
test('an interrupted candidate consumes its original attempt and gets a fresh copy',async()=>{
  const f=fixture({stage:'building',attempt:1,candidateRoot:'old-candidate',checks:{old:true},generation:3});
  const deadline=f.request.deadline;await f.service.reconcileSourceRepairs();
  assert.equal(f.request.stage,'queued');assert.equal(f.request.attempt,1);assert.equal(f.request.deadline,deadline);
  assert.equal(f.request.candidateRoot,undefined);assert.equal(f.request.checks,undefined);assert.equal(f.request.generation,4);
});
for(const [name,patch,jobPatch] of [
  ['candidate budget',{attempt:2},{}],['worker restart budget',{workerRestarts:2},{}],
  ['deadline',{deadline:Date.now()-1000},{}],['uncertain outcome',{}, {state:'uncertain'}],
  ['worker cancellation',{}, {state:'cancelled'}],['worker failure',{}, {state:'failed'}],
  ['resource exhaustion',{}, {state:'resource_exhausted'}],['prepared release',{release:{id:'prepared'}},{}],
])test(`${name} cannot be bypassed by worker resumption`,async()=>{
  const f=fixture(patch,jobPatch);await f.service.reconcileSourceRepairs();
  assert.equal(f.request.stage,'blocked');assert.equal(f.request.workerRestarts,patch.workerRestarts);
  assert.equal(f.calls.filter(c=>typeof c==='object').length,0);
});
test('Stop and a newer user request prevent worker and task resumption',async()=>{
  for(const cancelled of [true,false]){const f=fixture(cancelled?{stage:'cancelled'}:{});if(!cancelled)f.authorized=false;
    await f.service.reconcileSourceRepairs();assert.equal(f.request.stage,'cancelled');assert.deepEqual(f.calls,['cancel']);}
});
test('an active release transition prevents an interrupted worker from restarting',async()=>{
  const f=fixture();f.phase='activating';await f.service.reconcileSourceRepairs();assert.equal(f.request.stage,'blocked');assert.equal(f.request.workerRestarts,undefined);
});

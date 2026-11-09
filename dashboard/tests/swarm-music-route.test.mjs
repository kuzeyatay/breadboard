import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {fakeAceStep} from '../tests/helpers/fake-acestep.mjs';

// Real SQLite, conversation ownership, route, facade, worker and artifact bytes.
// Only Runtime admission and ACE-Step/provider I/O are simulated; no native job.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bb-swarm-music-'));
process.env.BREADBOARD_DATA_DIR=root;
delete process.env.BREADBOARD_RUNTIME_V2_CONTROL_URL;
const {default:db}=await import('../src/lib/db.ts');
const conversations=await import('../src/lib/conversations/store.ts');
const sessions=await import('../src/lib/hermes/runtime-store.ts');
const artifactStore=await import('../src/lib/hermes/artifact-store.ts');
const {saveAceStepSettings}=await import('../src/lib/acestep/config.ts');
const invocation=await import('../src/lib/swarm/invocation.ts');
const {SwarmStore}=await import('../src/lib/swarm/store.ts');
const {DEFAULT_SWARM_LIMITS}=await import('../src/lib/swarm/policy.ts');
const workspace=path.resolve(import.meta.dirname,'../..');
const jobs=new Map();const admissions=[];const cancellations=[];
const key=(user,kind,id)=>`${user}:${kind}:${id}`;
class RuntimeJobControlError extends Error {constructor(code){super(code);this.code=code;}}
class RouteError extends Error {}
class SupervisorResourceExhaustedError extends Error {}
const modules=new Map();
const overrides=new Map([
  ['next/server',{NextResponse:Response}],
  [path.join(workspace,'dashboard/src/lib/server-auth'),{RouteError,requireUserId:async()=>invocation.currentSwarmInvocation()?.userId??1}],
  [path.join(workspace,'dashboard/src/lib/server-auth.ts'),{RouteError,requireUserId:async()=>invocation.currentSwarmInvocation()?.userId??1}],
  [path.join(workspace,'dashboard/src/lib/hermes/route-helpers.ts'),await import('../src/lib/hermes/route-core.ts')],
  [path.join(workspace,'dashboard/src/lib/chatmock-server.ts'),{resolveChatmockBaseUrl:()=>({baseURL:'http://provider.invalid/v1'})}],
  [path.join(workspace,'dashboard/src/lib/hermes/session-service.ts'),{resolveConversationRuntime:async()=>{throw Error('The fixture already owns an initialized runtime session');}}],
  [path.join(workspace,'dashboard/src/lib/runtime-v2/outer-agent-run.ts'),{
    OUTER_AGENT_RUNTIME_ADAPTERS:{'music-producer':{scopePrefix:'music',jobType:'music-producer-run',workerKind:'outer-music-producer-node',resourceClass:'core'}},
    startOuterAgentRun:async input=>{
      const trusted=invocation.currentSwarmInvocation();
      const requestId=trusted?.requestId??input.requestId;
      const identity=key(input.userId,input.kind,requestId);
      if(jobs.has(identity))return {runId:jobs.get(identity).job_id,status:'queued'};
      const row={job_id:`job_${crypto.randomUUID()}`,status:'running',terminal:false,events:[]};
      jobs.set(identity,row);admissions.push({input,requestId,jobId:row.job_id});return {runId:row.job_id,status:'queued'};
    },
    readOuterAgentRunView:async(_kind,_user,id)=>{
      const job=[...jobs.values()].find(row=>row.job_id===id);assert.ok(job,'Must observe the Runtime job, not a music facade ID');return job;
    },
    abortOuterAgentRun:async(_kind,_user,id)=>{
      const job=[...jobs.values()].find(row=>row.job_id===id);assert.ok(job);cancellations.push(id);
      Object.assign(job,{status:'aborted',terminal:true,events:[{sequenceNumber:1,type:'run.aborted',at:new Date().toISOString(),payload:{summary:'Stopped'}}]});return true;
    },
  }],
  [path.join(workspace,'dashboard/src/lib/runtime-v2/outer-agent-run-store.ts'),{
    getOuterAgentRuntimeRunByRequest:(user,kind,id)=>jobs.get(key(user,kind,id))??null,
    recordOuterAgentRuntimeRun:()=>{throw Error('Unexpected Runtime lookup fallback');},
  }],
  [path.join(workspace,'dashboard/src/lib/supervisor-control.ts'),{
    RuntimeJobControlError,SupervisorResourceExhaustedError,
    lookupRuntimeJobByIdempotencyKey:async()=>{throw new RuntimeJobControlError('JOB_NOT_FOUND');},
    cancelRuntimeJobByIdempotencyKey:async()=>({accepted:true}),
  }],
]);
async function load(file) {
  const absolute=path.resolve(file);
  if(overrides.has(absolute))return overrides.get(absolute);
  if(modules.has(absolute))return modules.get(absolute);
  const relative=path.relative(workspace,absolute).replaceAll('\\','/');
  const source=fs.readFileSync(absolute,'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const dependencies={};
  for(const [,id] of compiled.matchAll(/require\("([^"]+)"\)/g)) {
    const resolved=id.startsWith('@/')?path.join(workspace,'dashboard/src',id.slice(2))
      : id.startsWith('.')?path.resolve(path.dirname(absolute),id):id;
    if(overrides.has(resolved)){dependencies[id]=overrides.get(resolved);continue;}
    const rel=path.relative(workspace,resolved).replaceAll('\\','/');
    if(/(?:music-producer\/(?:run-manager|store|artifacts|worker|route-error)|swarm\/(?:runtime-adapter|runtime-routes|artifact-owner))\.ts$/.test(rel)) {
      dependencies[id]=await load(resolved);
    } else dependencies[id]=await import(path.isAbsolute(resolved)?pathToFileURL(resolved).href:resolved);
  }
  const exports={};
  new Function('require','exports',compiled)(id=>{assert.ok(id in dependencies,`Unexpected import ${id}`);return dependencies[id];},exports);
  modules.set(absolute,exports);return exports;
}
// The registry is a process boundary here: only the actual Music route is loaded.
const routePath=path.join(workspace,'dashboard/src/app/api/music-producer/runs/route.ts');
overrides.set(path.join(workspace,'dashboard/src/lib/swarm/runtime-routes.ts'),{
  SWARM_RUNTIME_ROUTES:{'music-producer':{field:'task',load:()=>load(routePath)}}
});
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'swarm-music','swarm@example.test','unused'),(2,'other','other@example.test','unused')").run();
const ledger=new SwarmStore(db);
const music=await load(path.join(workspace,'dashboard/src/lib/music-producer/run-manager.ts'));
const musicStore=await load(path.join(workspace,'dashboard/src/lib/music-producer/store.ts'));
const musicArtifacts=await load(path.join(workspace,'dashboard/src/lib/music-producer/artifacts.ts'));
const musicWorker=await load(path.join(workspace,'dashboard/src/lib/music-producer/worker.ts'));
const {runtimeSwarmAdapter}=await load(path.join(workspace,'dashboard/src/lib/swarm/runtime-adapter.ts'));
const {POST}=await load(routePath);
test.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});

function makeConversation(){
  const conversation=conversations.createConversation({userId:1,title:'Owned team test',surface:'dashboard_terminal'});
  const session=sessions.createRuntimeSession({conversationId:conversation.id,userId:1,surface:conversation.surface,
    chatSessionId:null,agentName:'Hermes',clusterId:null,gardenId:null,pageSlug:null,workspaceKey:crypto.randomUUID(),
    activeDirectory:root,filesystemMode:'restricted',hermesSessionId:crypto.randomUUID()});
  return {conversation,session};
}
function fixture(){
  const {conversation,session}=makeConversation(),clientMessageId=crypto.randomUUID();
  conversations.reserveConversationTurn({conversation,clientMessageId,surface:conversation.surface,content:'Create and independently review a small audio draft.'});
  const messages=()=>db.prepare('SELECT id,role,status,content,client_message_id FROM conversation_messages WHERE conversation_id=? ORDER BY id').all(conversation.id);
  const original=messages();
  const run=ledger.create({requestId:crypto.randomUUID(),authority:{userId:1,conversationId:conversation.id,conversationPublicId:conversation.public_id,
    runtimeSessionId:session.id,sourceRunId:'parent-run',originClientMessageId:clientMessageId,surface:conversation.surface,gardenId:null,gardenSlug:null,
    model:'fixture',reasoningEffort:'medium',standingApproval:true,allowedTools:['agent_launch'],allowedAgentIds:['music-producer'],inputReferences:[]},
    limits:DEFAULT_SWARM_LIMITS,admission:()=>({available:true,requiresApproval:false}),plan:{objective:'Create and inspect music',reason:'Independent inspection follows production',benefit:'independent_verification',mode:'durable',tasks:[
      {key:'produce',title:'Produce music',brief:'Create a short instrumental audio draft.',executor:{kind:'runtime',id:'music-producer'},dependsOn:[],acceptance:['A saved audio artifact exists'],inputs:[],tokenBudget:1000},
      {key:'inspect',title:'Inspect the draft',brief:'Inspect the produced artifact and report its measured duration.',executor:{kind:'persona',id:'researcher'},dependsOn:['produce'],acceptance:['Measured duration is recorded'],inputs:[],tokenBudget:1000},
    ]}});
  const lease=ledger.acquireLease(1,run.id,crypto.randomUUID());const claimed=ledger.claimNext(lease);assert.equal(claimed.task.key,'produce');
  const context={run,task:claimed.task,attempt:claimed.attempt,dependencies:[]};
  return {conversation,session,run,lease,context,messages,original,adapter:runtimeSwarmAdapter('music-producer')};
}
async function configure(t){const fake=await fakeAceStep();t.after(()=>fake.close());saveAceStepSettings(1,{mode:'external',externalUrl:fake.connection.baseUrl,apiKey:'fixture-key',model:fake.connection.model});return fake;}

test('Music team uses its durable facade, owns its artifact and leaves the parent turn intact',{timeout:15000},async t=>{
  const fake=await configure(t),f=fixture(),before=admissions.length;
  const handle=await f.adapter.start(f.context);ledger.attach(f.lease,f.context.attempt.id,handle);
  assert.match(handle.runId,/^music_[a-f0-9]{32}$/);assert.equal(admissions.length,before+1);
  const row=musicStore.musicLaunch(1,handle.runId);
  assert.match(row.client_message_id,/^[A-Za-z0-9_-]{1,128}$/);
  assert.equal(musicStore.musicSwarmRequestId(row),f.context.attempt.requestId);
  assert.deepEqual(f.messages(),f.original,'No second parent turn or premature completion');
  assert.deepEqual(await f.adapter.start(f.context),handle);assert.equal(admissions.length,before+1);
  musicStore.updateMusicLaunch(1,handle.runId,{runtime_job_id:null});
  const recovery=await f.adapter.recover(f.context);assert.equal(recovery.status,'found');assert.deepEqual(recovery.handle,handle);
  await f.adapter.observe(f.context,handle);assert.equal(musicStore.musicLaunch(1,handle.runId).runtime_job_id,admissions.at(-1).jobId);
  const context=musicArtifacts.musicArtifactContext(1,handle.runId);assert.equal(context.assistantMessageId,f.original.find(row=>row.role==='assistant').id);
  musicStore.updateMusicLaunch(1,handle.runId,{request_json:JSON.stringify({brief:f.context.task.brief})});
  const directory=path.join(root,handle.runId);fs.mkdirSync(directory);const events=[];
  const result=await musicWorker.executeMusicWorker({...admissions.at(-1).input.requestPayload,userId:1,workspace:directory,
    signal:new AbortController().signal,update:rows=>events.push(...rows)},
    {acquireServiceLease:async()=>{throw Error('No native service is permitted');},releaseSupervisorLease:async()=>{},runAudioAnalysis:async()=>{throw Error('Optional analyzer unavailable');}});
  assert.equal(result.status,'completed',JSON.stringify(events.at(-1)));assert.equal(fake.submissions,1);
  const audio=artifactStore.listArtifactsForUser({userId:1,conversationPublicId:f.conversation.public_id}).find(row=>row.kind==='audio');
  assert.ok(audio);assert.equal(audio.status,'ready');assert.equal(audio.originating_message_id,context.assistantMessageId);
  assert.deepEqual(JSON.parse(audio.metadata_json).swarm,{runId:f.run.id,attemptId:f.context.attempt.id});
  assert.deepEqual(f.messages(),f.original,'Worker completion must not finish the coordinator turn');
});

test('Music Stop reconciles a lost Runtime link and fences parent artifact publication',{timeout:15000},async t=>{
  await configure(t);const f=fixture(),handle=await f.adapter.start(f.context);ledger.attach(f.lease,f.context.attempt.id,handle);
  const job=admissions.at(-1).jobId;musicStore.updateMusicLaunch(1,handle.runId,{runtime_job_id:null});
  ledger.control(1,f.run.id,'cancel');await f.adapter.cancel(f.context,handle);
  assert.ok(cancellations.includes(job));assert.equal(musicStore.musicLaunch(1,handle.runId).collection_state,'cancelling');
  await f.adapter.observe(f.context,handle);assert.equal(musicStore.musicLaunch(1,handle.runId).collection_state,'aborted');
  assert.throws(()=>musicArtifacts.assertMusicCollectible(1,handle.runId),/cancelled/);
  assert.throws(()=>musicArtifacts.musicArtifactContext(2,handle.runId),/run_not_found/);
  assert.deepEqual(f.messages(),f.original);
});

test('Music team publication stops immediately when the team stops, before facade cancellation',{timeout:15000},async t=>{
  await configure(t);const f=fixture(),handle=await f.adapter.start(f.context);ledger.attach(f.lease,f.context.attempt.id,handle);
  ledger.control(1,f.run.id,'cancel');
  assert.throws(()=>musicArtifacts.assertMusicCollectible(1,handle.runId),{code:'swarm_artifact_scope'});
  assert.equal(artifactStore.listArtifactsForUser({userId:1,conversationPublicId:f.conversation.public_id}).length,0);
});

test('ordinary Music launches keep their normal conversation turn',{timeout:15000},async t=>{
  await configure(t);const {conversation}=makeConversation();
  const response=await POST(new Request('http://localhost/api/music-producer/runs',{method:'POST',body:JSON.stringify({task:'Create an instrumental draft',model:'fixture',conversationPublicId:conversation.public_id,clientMessageId:crypto.randomUUID()})}));
  assert.equal(response.status,201);const {run}=await response.json();
  assert.equal(musicStore.musicSwarmRequestId(musicStore.musicLaunch(1,run.runId)),null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM conversation_messages WHERE conversation_id=?').get(conversation.id).n,2);
  assert.ok(musicArtifacts.musicArtifactContext(1,run.runId).assistantMessageId);
});

test('Music worker cannot publish generated bytes after team Stop',{timeout:15000},async t=>{
  await configure(t);const f=fixture(),handle=await f.adapter.start(f.context);ledger.attach(f.lease,f.context.attempt.id,handle);
  musicStore.updateMusicLaunch(1,handle.runId,{request_json:JSON.stringify({brief:f.context.task.brief})});
  const directory=path.join(root,handle.runId);fs.mkdirSync(directory);const events=[];let stopped=false;
  const result=await musicWorker.executeMusicWorker({...admissions.at(-1).input.requestPayload,userId:1,workspace:directory,
    signal:new AbortController().signal,update:rows=>{events.push(...rows);if(rows.some(row=>row.payload.message==='Saving audio to this conversation')){ledger.control(1,f.run.id,'cancel');stopped=true;}}},
    {acquireServiceLease:async()=>{throw Error('No native service is permitted');},releaseSupervisorLease:async()=>{},runAudioAnalysis:async()=>{throw Error('Optional analyzer unavailable');}});
  assert.equal(stopped,true);assert.notEqual(result.status,'completed');
  assert.equal(artifactStore.listArtifactsForUser({userId:1,conversationPublicId:f.conversation.public_id}).length,0);
  assert.deepEqual(f.messages(),f.original);assert.equal(events.some(row=>row.type==='run.completed'),false);
});

test('Music still rejects missing and invalid client identities before admission',async()=>{
  const {conversation}=makeConversation();const before=admissions.length;
  for(const clientMessageId of [undefined,'swarm:invalid:1']) {
    const response=await POST(new Request('http://localhost/api/music-producer/runs',{method:'POST',body:JSON.stringify({task:'Create an instrumental draft',model:'fixture',conversationPublicId:conversation.public_id,clientMessageId})}));
    assert.equal(response.status,400);
  }
  assert.equal(admissions.length,before);
});

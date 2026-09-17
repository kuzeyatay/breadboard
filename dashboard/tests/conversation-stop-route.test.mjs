import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'breadboard-conversation-stop-'));
process.env.BREADBOARD_DATA_DIR=dataRoot;
const {default:db}=await import('../src/lib/db.ts');
const store=await import('../src/lib/conversations/store.ts');
const runtimeStore=await import('../src/lib/hermes/runtime-store.ts');
const runStore=await import('../src/lib/hermes/run-store.ts');
const turns=await import('../src/lib/conversations/external-agent-turns.ts');
const {listRunningExternalAgentRuns}=await import('../src/lib/conversations/external-agent-cancel.ts');

test('Stop authorizes the conversation and seals pending, direct, runtime and external work without an initialized runtime requirement',async()=>{
  const calls=[];
  let direct=null, runtimeOffline=false;
  const authorize=(userId,id)=>{
    const row=runtimeStore.getRuntimeSessionById(Number(id));
    if(!row||row.user_id!==userId)throw Object.assign(new Error('Not found'),{status:404});
    if(!row.external_session_id)throw Object.assign(new Error('Uninitialized'),{status:409});
    return {row,runtimeKind:row.runtime_kind,externalSessionId:row.external_session_id,activeDirectory:row.active_directory};
  };
  globalThis.stopFixture={db,store,runtimeStore,runStore,turns,authorize,calls,
    async cancelExternal(userId,id){
      const runs=listRunningExternalAgentRuns(id);
      for(const run of runs)calls.push(['external',userId,run.runId]);
      return runs.map(run=>({...run,stopped:true}));
    },abortDirect(id){calls.push(['direct',id]);if(direct?.conversationId!==id)return null;const result=direct;direct=null;return result;},
    runtime:{async stopRun(input){calls.push(['runtime',input.externalSessionId]);if(runtimeOffline)throw Error('offline');},async applyCapabilityDecision(){if(runtimeOffline)throw Error('offline');}},
  };
  const stubs={
    'next/server':'export const NextResponse=Response;',
    '@/lib/server-auth':'export const requireUserId=async()=>1;',
    '@/lib/hermes/route-helpers.ts':'export class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}export const apiErrorResponse=e=>Response.json({error:e.message},{status:e.status??500});',
    '@/lib/hermes/session-service.ts':'export const authorizeRuntimeReference=(...args)=>globalThis.stopFixture.authorize(...args);',
    './session-service.ts':'export const authorizeRuntimeSession=(...args)=>globalThis.stopFixture.authorize(...args);export const markStatus=(s,status)=>globalThis.stopFixture.runtimeStore.setRuntimeStatus(s.row.id,status);',
    '@/lib/hermes/runtime-store.ts':'export const {getRuntimeSessionById,listRuntimeSessionsForConversation,recordAuditEvent,setRuntimeStatus}=globalThis.stopFixture.runtimeStore;',
    './runtime-store.ts':'export const {revokeCapabilityDecision}=globalThis.stopFixture.runtimeStore;',
    '@/lib/hermes/run-store.ts':'export const {getActiveRuntimeRun,getLatestRuntimeRun,parseRuntimeRunDispatch}=globalThis.stopFixture.runStore;',
    './run-store.ts':'export const {getActiveRuntimeRun,finishRuntimeRun}=globalThis.stopFixture.runStore;',
    '@/lib/conversations/store.ts':'export const {getConversationForUser,cancelConversationTurn,cancelLatestConversationTurn,failAssistantMessage}=globalThis.stopFixture.store;',
    '@/lib/conversations/external-agent-turns.ts':'export const {finishExternalAgentTurn}=globalThis.stopFixture.turns;',
    '@/lib/conversations/external-agent-cancel.ts':'export const cancelRunningExternalAgentRuns=(...args)=>globalThis.stopFixture.cancelExternal(...args);',
    '@/lib/conversations/direct-turn-service.ts':'export const abortDirectProviderTurn=(...args)=>globalThis.stopFixture.abortDirect(...args);',
    '../agent-runtime/runtime.ts':'export const getAgentRuntimeByKind=()=>globalThis.stopFixture.runtime;',
    './dispatch-core.ts':'export const leastPrivilegeDecision=()=>({});',
    './terminal-execution.ts':'export const cancelAuthorizedTerminalCommand=async id=>{globalThis.stopFixture.calls.push(["terminal",id]);return true;};',
    './interactive-visualizer-browser.ts':'export const cancelInteractiveVisualizerWork=async id=>{globalThis.stopFixture.calls.push(["visualizer",id]);return true;};',
  };
  try{
    const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/app/api/hermes/sessions/[sessionId]/abort/route.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'runtime-boundaries',setup(b){b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'stub'}:null);b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path]}));}}]});
    const route=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    for(const id of [1,2])db.prepare('INSERT INTO users(id,username,email,password_hash) VALUES(?,?,?,?)').run(id,'user'+id,id+'@example.test','x');
    const makeTurn=(userId=1)=>{
      const created=store.createConversationWithInitialTurn({conversation:{userId,title:'Stop test',surface:'dashboard_terminal'},turn:{clientMessageId:'question',surface:'dashboard_terminal',content:'Explain electricity'}});
      return {...created.turn,conversation:created.conversation};
    };
    const stop=reference=>route.POST(new Request('http://localhost/abort',{method:'POST'}),{params:Promise.resolve({sessionId:String(reference)})});
    const status=turn=>store.getConversationMessageById(turn.assistantMessage.id).status;
    const foreign=makeTurn(2),pending=makeTurn();
    const foreignRow=runtimeStore.createRuntimeSession({conversationId:foreign.conversation.id,surface:'dashboard_terminal',userId:2,chatSessionId:null,agentName:'test',clusterId:null,gardenId:null,pageSlug:null,workspaceKey:'foreign',activeDirectory:dataRoot,filesystemMode:'restricted'});
    assert.equal((await stop(foreign.conversation.public_id)).status,404);
    assert.equal((await stop(foreignRow.id)).status,404);
    assert.equal((await stop('invalid')).status,400);
    assert.equal(status(foreign),'aborted'); // initial placeholder is reserved until dispatch
    assert.deepEqual(calls,[],'ownership must be checked before any stop side effect');
    let response=await stop(pending.conversation.public_id);
    assert.equal(response.status,200);
    assert.equal((await response.json()).aborted,true);
    assert.equal(status(pending),'aborted');
    assert.equal(JSON.parse(store.getConversationMessageById(pending.assistantMessage.id).metadata).preDispatchReserved,false);
    assert.equal((await (await stop(pending.conversation.public_id)).json()).alreadyFinished,true);

    const external=makeTurn();
    const worker=turns.recordExternalAgentTurn({conversation:external.conversation,clientMessageId:'worker-turn',surface:'dashboard_terminal',userContent:'Worker request',assistantContent:'',run:{kind:'max_research',runId:'worker-job',query:'Worker request'}});
    assert.equal((await stop(external.conversation.public_id)).status,200);
    assert.equal(JSON.parse(store.getConversationMessageById(worker.assistantMessage.id).metadata).externalAgentOutcome,'aborted');
    assert.ok(calls.some(call=>call[0]==='external'&&call[2]==='worker-job'));

    const directChat=makeTurn();direct={conversationId:directChat.conversation.id,clientMessageId:'question'};
    assert.equal((await (await stop(directChat.conversation.public_id)).json()).aborted,true);
    assert.equal(direct,null);

    const rows=[];
    runtimeOffline=true;
    for(const externalSessionId of ['runtime-one','runtime-two',null]){
      const running=makeTurn();
      const row=runtimeStore.createRuntimeSession({conversationId:running.conversation.id,surface:'dashboard_terminal',userId:1,chatSessionId:null,agentName:'test',clusterId:null,gardenId:null,pageSlug:null,workspaceKey:'test',activeDirectory:dataRoot,filesystemMode:'restricted',externalSessionId});
      runStore.beginRuntimeRun({runtimeSessionId:row.id,instruction:'test',dispatch:{clientMessageId:'question'}});rows.push(row);
      // Cleanup of local children and durable rows still succeeds when the
      // remote process is gone or runtime initialization never finished.
      response=await stop(running.conversation.public_id);
      assert.equal(response.status,200);
      assert.equal((await response.json()).aborted,true);
      assert.equal(runStore.getLatestRuntimeRun(row.id).status,'cancelled');
      assert.equal(runtimeStore.getRuntimeSessionById(row.id).last_runtime_status,'aborted');
      assert.ok(calls.some(call=>call[0]==='terminal'&&call[1]===row.id));
      assert.ok(calls.some(call=>call[0]==='visualizer'&&call[1]===row.id));
      assert.equal(status(running),'aborted');
    }
    assert.equal((await stop(rows[0].id)).status,200,'numeric runtime references remain supported');
    assert.equal((await stop(rows[2].id)).status,200,'an owned numeric reference can stop an uninitialized runtime');

    runtimeOffline=false;
    const concurrent=makeTurn();
    const runtimeInput={conversationId:concurrent.conversation.id,surface:'garden_chat',userId:1,chatSessionId:null,agentName:'test',clusterId:null,gardenId:null,pageSlug:null,workspaceKey:'parallel',activeDirectory:dataRoot,filesystemMode:'restricted'};
    const mainRuntime=runtimeStore.createRuntimeSession({...runtimeInput,externalSessionId:'main'});
    const side=store.reserveConversationTurn({conversation:concurrent.conversation,clientMessageId:'side-question',surface:'garden_chat',content:'What is this?',metadata:{textSelection:{id:'highlight',mode:'inline',sourceMessageId:'msg_source',start:0,end:5,quote:'force'}}});
    const sideRuntime=runtimeStore.createRuntimeSession({...runtimeInput,externalSessionId:'side',runtimeMetadata:{inlineTurnId:'side-question'}});
    const mainRun=runStore.beginRuntimeRun({runtimeSessionId:mainRuntime.id,instruction:'main',dispatch:{clientMessageId:'question'}});
    const sideRun=runStore.beginRuntimeRun({runtimeSessionId:sideRuntime.id,instruction:'side',dispatch:{clientMessageId:'side-question'}});
    await stop(concurrent.conversation.public_id);
    assert.equal(runStore.getRuntimeRun(mainRun.id).status,'cancelled');
    assert.equal(runStore.getRuntimeRun(sideRun.id).status,'active','main Stop leaves side runtime running');
    assert.equal(store.getConversationMessageById(side.assistantMessage.id).status,'pending');
    const callCount=calls.length;
    await stop(sideRuntime.id);
    assert.equal(runStore.getRuntimeRun(sideRun.id).status,'cancelled');
    assert.equal(store.getConversationMessageById(side.assistantMessage.id).status,'aborted');
    assert.ok(calls.slice(callCount).every(call=>call[0]!=='direct'&&call[0]!=='external'),'numeric side Stop is also isolated');
  }finally{delete globalThis.stopFixture;db.close();fs.rmSync(dataRoot,{recursive:true,force:true});}
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import test, {after} from 'node:test';

const root=process.env.BREADBOARD_TEST_REPO??path.resolve(import.meta.dirname,'../..');
const dashboard=path.join(root,'dashboard');
const candidate=process.env.BREADBOARD_TEST_CANDIDATE??root;
const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'breadboard-vibe-completion-'));
process.env.BREADBOARD_DATA_DIR=dataRoot;
const {default:globalDb}=await import(pathToFileURL(path.join(dashboard,'src/lib/db.ts')));
const {default:Database}=await import(pathToFileURL(path.join(dashboard,'node_modules/better-sqlite3/lib/index.js')));
const {build}=await import(pathToFileURL(path.join(dashboard,'node_modules/esbuild/lib/main.js')));
const store=await import(pathToFileURL(path.join(dashboard,'src/lib/conversations/store.ts')));
const turns=await import(pathToFileURL(path.join(dashboard,'src/lib/conversations/external-agent-turns.ts')));
// The second connection uses the real transactions without starting profile jobs.
const db=new Database(globalDb.name),views=new Map(),callbacks=new Map(),reads=[],observations=[];
globalThis.vibeCompletionFixture={db,finish:input=>turns.finishExternalAgentTurn(input,db),
  async read(...args){reads.push(args);const view=views.get(args[2]);if(view instanceof Error)throw view;if(!view)throw Error('run_not_found');return view;},
  observe(kind,userId,runId,callback){observations.push({kind,userId,runId});callbacks.set(runId,callback);}};
const stubs={
  '../db.ts':'export default globalThis.vibeCompletionFixture.db;',
  '../conversations/external-agent-turns.ts':'export const finishExternalAgentTurn=input=>globalThis.vibeCompletionFixture.finish(input);',
  '../runtime-v2/outer-agent-run.ts':'export const readOuterAgentRunView=(...args)=>globalThis.vibeCompletionFixture.read(...args);export const observeOuterAgentRun=(...args)=>globalThis.vibeCompletionFixture.observe(...args);',
};
const bundled=await build({entryPoints:[path.join(candidate,'dashboard/src/lib/vibe-trading/conversation-persistence.ts')],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'native-boundary',setup(b){b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path]}));}}]});
const completion=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
for(const id of [1,2])db.prepare('INSERT INTO users(id,username,email,password_hash) VALUES(?,?,?,?)').run(id,'vibe'+id,'vibe'+id+'@example.test','x');
let counter=0;
const make=(userId=1,delegated=false)=>{
  const index=++counter,runId='job_'+String(index).padStart(64,'0'),clientMessageId='vibe-fixture-'+index;
  const conversation=store.createConversation({userId,title:'Owned completion fixture',surface:'dashboard_terminal'},db);
  const turn=turns.recordExternalAgentTurn({conversation,clientMessageId,surface:'dashboard_terminal',userContent:'Calculate supplied returns.',
    assistantContent:delegated?'Calculating.':'',delegatedAgentRun:delegated,run:{kind:'vibe_trading',runId,task:'Calculate supplied returns.'}},db);
  db.prepare("UPDATE conversation_messages SET metadata=json_set(metadata,'$.externalAgentStartedAt',?) WHERE id=?").run('2026-06-01T00:00:00.000Z',turn.assistantMessage.id);
  return {userId,conversationId:conversation.id,clientMessageId,runId,id:turn.assistantMessage.id};
};
const saved=fixture=>store.presentConversationMessage(store.getConversationMessageById(fixture.id,db));
const ending=(status='completed',summary='The compounded return is -1%.')=>({terminal:true,status,events:[{sequenceNumber:7,type:'run.'+status,payload:{summary},at:'2026-06-01T00:00:02.000Z'}]});

after(()=>{db.close();globalDb.close();delete globalThis.vibeCompletionFixture;assert.equal(path.dirname(dataRoot),path.resolve(os.tmpdir()));fs.rmSync(dataRoot,{recursive:true,force:true});});

test('an owned observer persists completion and duration without a mounted card',async()=>{
  const f=make(),before=observations.length;
  completion.observeVibeTradingConversationTurn(f);completion.observeVibeTradingConversationTurn(f);
  assert.equal(observations.length,before+1,'one observer per owner, conversation and run');
  await callbacks.get(f.runId)(ending());
  const row=saved(f);assert.equal(row.metadata.externalAgentOutcome,'completed');assert.equal(row.content,'The compounded return is -1%.');
  assert.equal(row.metadata.responseCompletedAt,'2026-06-01T00:00:02.000Z');assert.equal(row.metadata.responseDurationMs,2000);
  await callbacks.get(f.runId)(ending('failed','A delayed failure'));
  assert.equal(saved(f).content,row.content);assert.equal(saved(f).metadata.externalAgentOutcome,'completed');
});

test('selected chat recovery reads its durable terminal job once after a restart',async()=>{
  const f=make();views.set(f.runId,ending());const before=reads.length;
  assert.equal(await completion.reconcileVibeTradingConversation(f.userId,f.conversationId),1);
  assert.deepEqual(reads.at(-1),['vibe-trading',f.userId,f.runId,0]);
  assert.equal(saved(f).metadata.externalAgentOutcome,'completed');
  assert.equal(await completion.reconcileVibeTradingConversation(f.userId,f.conversationId),0);
  assert.equal(reads.length,before+1,'settled turns do not keep polling Runtime');
});

test('another owner cannot inspect or finish the selected conversation',async()=>{
  const f=make(2);views.set(f.runId,ending());const before=reads.length;
  assert.equal(await completion.reconcileVibeTradingConversation(1,f.conversationId),0);
  completion.observeVibeTradingConversationTurn({...f,userId:1});
  assert.equal(reads.length,before);assert.equal(callbacks.has(f.runId),false);assert.equal(saved(f).metadata.externalAgentOutcome,'running');
});

test('temporary Runtime loss and incomplete projections preserve the running turn',async()=>{
  const f=make();views.set(f.runId,Error('Runtime unavailable'));
  assert.equal(await completion.reconcileVibeTradingConversation(1,f.conversationId),0);
  views.set(f.runId,{terminal:true,status:'completed',events:[]});
  assert.equal(await completion.reconcileVibeTradingConversation(1,f.conversationId),0);
  assert.equal(saved(f).metadata.externalAgentOutcome,'running');
  views.set(f.runId,{terminal:false,status:'running',events:[]});
  await completion.reconcileVibeTradingConversation(1,f.conversationId);assert.ok(callbacks.has(f.runId));
  await callbacks.get(f.runId)(ending());assert.equal(saved(f).metadata.externalAgentOutcome,'completed');
});

test('a user stop or a replacement run wins over a late completion',async()=>{
  const stopped=make();completion.observeVibeTradingConversationTurn(stopped);
  turns.finishExternalAgentTurn({...stopped,outcome:'aborted',content:'Stopped by the user.'},db);
  await callbacks.get(stopped.runId)(ending());assert.equal(saved(stopped).metadata.externalAgentOutcome,'aborted');
  assert.equal(saved(stopped).content,'Stopped by the user.');
  const replaced=make();completion.observeVibeTradingConversationTurn(replaced);
  db.prepare("UPDATE conversation_messages SET metadata=json_set(metadata,'$.externalAgentRun.runId',?) WHERE id=?").run('job_'+'f'.repeat(64),replaced.id);
  await callbacks.get(replaced.runId)(ending());assert.equal(saved(replaced).metadata.externalAgentOutcome,'running');
});

test('failure and delegated completion retain their actual outcome and result',async()=>{
  const failed=make();views.set(failed.runId,ending('failed','The provider could not complete the run.'));
  await completion.reconcileVibeTradingConversation(1,failed.conversationId);
  assert.equal(saved(failed).status,'failed');assert.match(saved(failed).content,/provider/);
  const delegated=make(1,true);views.set(delegated.runId,ending());
  await completion.reconcileVibeTradingConversation(1,delegated.conversationId);
  const row=saved(delegated);assert.equal(row.content,'Calculating.');assert.equal(row.metadata.externalAgentResult,'The compounded return is -1%.');
  assert.equal(row.metadata.externalAgentOutcome,'completed');
});

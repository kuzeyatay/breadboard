import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test, { after } from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-inline-concurrency-'));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const {default:db} = await import('../src/lib/db.ts');
const store = await import('../src/lib/conversations/store.ts');
const runtimeStore = await import('../src/lib/hermes/runtime-store.ts');
const runs = await import('../src/lib/hermes/run-store.ts');
const {ensureConversationSchema} = await import('../src/lib/conversations/schema.ts');
const {preserveInlineQuestionMessages,reconcileInlineQuestionMessages} = await import('../src/lib/conversations/garden-inline-question.ts');
after(()=>{db.close();fs.rmSync(dataRoot,{recursive:true,force:true});});
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'fixture','fixture@example.test','x')").run();
db.prepare("INSERT INTO clusters(id,user_id,name,slug) VALUES(1,1,'EM 1 fixture','em1-fixture')").run();
db.prepare("INSERT INTO chat_sessions(id,cluster_id,user_id,title) VALUES(1,1,1,'Fields')").run();
const conversation = store.ensureConversationForLegacyChatSession(1,1);
const selection = {id:'inline:lorentz',mode:'inline',sourceMessageId:'msg_1',start:0,end:13,quote:'Lorentz force'};
function reserve(id, inline=false){return store.reserveConversationTurn({conversation,clientMessageId:id,surface:'garden_chat',content:inline?'what is that':'Explain fields in detail',metadata:{gardenPreDispatch:true,...(inline?{textSelection:selection}:{})}});}

// Execute production session resolution and creation with a deterministic
// gateway. The database, unique indexes, run ownership and completion are real.
const source=fs.readFileSync(new URL('../src/lib/hermes/session-service.ts',import.meta.url),'utf8');
const tree=ts.createSourceFile('sessions.ts',source,ts.ScriptTarget.Latest,true);
const selected=tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&['resolveConversationRuntime','createConversationRuntime','recreateConversationRuntime'].includes(n.name?.text));
const calls=[];
let nextSession=0;
const gateway={kind:'hermes',restoreSession:async input=>{calls.push(['restore',input]);return created(input)}};
function created(input){return {externalSessionId:'external-'+(++nextSession),liveSessionId:'live-'+nextSession,workspaceKey:input.sessionKey,directory:dataRoot,agentName:'fixture'};}
const context=vm.createContext({
  ...runtimeStore,db,JSON,Date,
  normalizedAuthorizedGardens:()=>[{id:1,slug:'em1-fixture'}],
  authorizeGardenAccess:()=>({clusterId:1,slug:'em1-fixture'}),
  isPdfAssistantPageContext:()=>false,
  createWithConfiguredRuntimeFallback:async input=>{calls.push(['create',input]);return {runtime:gateway,created:created(input)}} ,
  getAgentRuntimeByKind:()=>gateway,
  loadUnifiedToolRegistryForRuntime:async()=>{},
  canonicalizeRuntimePolicy:row=>row,
  authorizedRuntime:row=>({row,externalSessionId:row.external_session_id}),
  canonicalRuntimeMessages:()=>[],ApiError:Error,
});
vm.runInContext(ts.transpileModule(selected.map(n=>n.getText(tree).replace(/^export /,'')).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
const resolve=inlineTurnId=>context.resolveConversationRuntime({conversation,surface:'garden_chat',activeGardenSlug:'em1-fixture',inlineTurnId});

test('main snapshots and stale polls preserve independent side streams until their durable completion',()=>{
  const main={role:'assistant',clientMessageId:'main-turn',content:'Growing main answer'};
  const side={role:'assistant',clientMessageId:'side-turn',content:'Growing side answer',textSelection:selection,pending:true};
  const oldSide={...side,content:'',pending:true};
  const current=[main,side];
  assert.deepEqual(preserveInlineQuestionMessages([main],current),current);
  const stalePoll=preserveInlineQuestionMessages([main,oldSide],current);
  assert.deepEqual(reconcileInlineQuestionMessages(stalePoll,[main,oldSide]),current);
  const completed={...side,content:'The saved full side answer',pending:false,responseCompletedAt:'2026-09-09T13:20:00Z'};
  assert.deepEqual(reconcileInlineQuestionMessages(current,[main,completed]),[main,completed]);
});

test('main and multiple highlight turns run concurrently, complete in either order, and restore with their anchors',async()=>{
  const main=reserve('main-turn');
  const mainRuntime=await resolve();
  const mainRun=runs.beginRuntimeRun({runtimeSessionId:mainRuntime.row.id,instruction:'main-turn',dispatch:{clientMessageId:'main-turn'}});
  const inline=reserve('inline-one',true);
  const nested=reserve('inline-two',true);
  const [inlineRuntime,nestedRuntime]=await Promise.all([resolve('inline-one'),resolve('inline-two')]);
  const inlineRun=runs.beginRuntimeRun({runtimeSessionId:inlineRuntime.row.id,instruction:'side',dispatch:{clientMessageId:'inline-one'}});
  const nestedRun=runs.beginRuntimeRun({runtimeSessionId:nestedRuntime.row.id,instruction:'nested',dispatch:{clientMessageId:'inline-two'}});
  assert.equal(new Set([mainRuntime.externalSessionId,inlineRuntime.externalSessionId,nestedRuntime.externalSessionId]).size,3);
  assert.equal(new Set(calls.filter(c=>c[0]==='create').map(c=>c[1].sessionKey)).size,3);
  assert.equal(db.prepare("SELECT count(*) n FROM hermes_runs WHERE status='active'").get().n,3);
  assert.equal(runtimeStore.getRuntimeSessionByConversation(conversation.id).id,mainRuntime.row.id);
  assert.equal(runtimeStore.getRuntimeSessionByChatSession(1).id,mainRuntime.row.id);
  ensureConversationSchema(db);
  assert.equal(runtimeStore.getRuntimeSessionByConversation(conversation.id).id,mainRuntime.row.id,'startup backfill keeps main ownership');
  assert.equal(runtimeStore.getRuntimeSessionByConversation(conversation.id,'inline-one').id,inlineRuntime.row.id,'startup preserves side ownership');
  assert.equal(runtimeStore.getRuntimeSessionByConversation(conversation.id,'inline-two').id,nestedRuntime.row.id);
  assert.equal((await resolve('inline-one')).row.id,inlineRuntime.row.id,'same turn keeps its runtime');
  assert.throws(()=>reserve('second-main'),/Another turn is already active/);
  assert.equal(reserve('inline-one',true).isNew,false,'network replay is idempotent');
  store.completeAssistantMessage({conversationId:conversation.id,clientMessageId:'inline-one',content:'The Lorentz force combines electric and magnetic forces.'});
  runs.finishRuntimeRun(inlineRun.id,'completed');
  assert.equal(runs.getRuntimeRun(mainRun.id).status,'active');
  store.completeAssistantMessage({conversationId:conversation.id,clientMessageId:'main-turn',content:'The longer explanation finished.'});
  runs.finishRuntimeRun(mainRun.id,'completed');
  assert.equal(runs.getRuntimeRun(nestedRun.id).status,'active');
  const anotherMain=reserve('next-main');
  store.completeAssistantMessage({conversationId:conversation.id,clientMessageId:'next-main',content:'Next main answer.'});
  store.completeAssistantMessage({conversationId:conversation.id,clientMessageId:'inline-two',content:'The nested answer finished.'});
  runs.finishRuntimeRun(nestedRun.id,'completed');
  for(const turn of [main,inline,nested,anotherMain]) assert.equal(store.getConversationMessageById(turn.assistantMessage.id).status,'complete');
  const restored=db.prepare("SELECT tool_calls,content FROM chat_messages WHERE session_id=1 AND role='assistant' ORDER BY order_index").all();
  assert.equal(restored.filter(row=>JSON.parse(row.tool_calls||'{}').textSelection?.id===selection.id).length,2);
  assert.ok(restored.some(row=>row.content==='The longer explanation finished.'));
});

test('stopping the exact highlight turn never touches the main runtime, including before side dispatch',async()=>{
  const main=reserve('stop-main');
  const mainRuntime=await resolve();
  const mainRun=runs.beginRuntimeRun({runtimeSessionId:mainRuntime.row.id,instruction:'main-turn',dispatch:{clientMessageId:'stop-main'}});
  const inline=reserve('stop-side',true);
  const inlineRuntime=await resolve('stop-side');
  const inlineRun=runs.beginRuntimeRun({runtimeSessionId:inlineRuntime.row.id,instruction:'side',dispatch:{clientMessageId:'stop-side'}});
  const stopped=[];
  globalThis.inlineRouteFixture={...store,...runtimeStore,cancelRuntimeSessionWork:async(_user,row)=>{
    stopped.push(row.id);const run=runs.getActiveRuntimeRun(row.id);if(run)runs.finishRuntimeRun(run.id,'cancelled');
  }};
  const stubs={
    'next-auth/next':`export const getServerSession=async()=>({user:{id:'1'}});`,
    'next/server':`export const NextResponse=Response;`,
    '@/lib/auth-options':`export const authOptions={};`,
    '@/lib/conversations/store':`export const {cancelConversationTurn,ensureConversationForLegacyChatSession,presentConversationMessage,reserveConversationTurn}=globalThis.inlineRouteFixture;`,
    '@/lib/hermes/runtime-store.ts':`export const {getRuntimeSessionByConversation}=globalThis.inlineRouteFixture;`,
    '@/lib/hermes/session-cancel.ts':`export const {cancelRuntimeSessionWork}=globalThis.inlineRouteFixture;`,
    '@/lib/hermes/route-helpers':`export const apiErrorResponse=error=>Response.json({error:error.message},{status:error.status||500});`,
  };
  const bundle=await build({entryPoints:[new URL('../src/app/api/chat-sessions/[sessionId]/turns/route.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:null);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}))}}]});
  const route=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const stop=id=>route.DELETE(new Request('http://fixture/turns',{method:'DELETE',body:JSON.stringify({clientMessageId:id})}),{params:Promise.resolve({sessionId:'1'})});
  assert.equal((await stop('stop-side')).status,200);
  assert.deepEqual(stopped,[inlineRuntime.row.id]);
  assert.equal(runs.getRuntimeRun(inlineRun.id).status,'cancelled');
  assert.equal(runs.getRuntimeRun(mainRun.id).status,'active');
  assert.equal(store.getConversationMessageById(main.assistantMessage.id).status,'pending');
  assert.equal(store.getConversationMessageById(inline.assistantMessage.id).status,'aborted');
  const preflight=reserve('stop-before-runtime',true);
  await stop('stop-before-runtime');
  assert.equal(store.conversationTurnWasCancelled(conversation.id,'stop-before-runtime'),true);
  assert.equal(store.getConversationMessageById(preflight.assistantMessage.id).status,'aborted');
  assert.deepEqual(stopped,[inlineRuntime.row.id]);
  delete globalThis.inlineRouteFixture;
});

test('a main-chat snapshot predating a highlight cannot erase the saved answer',async()=>{
  // Stop the previous fixture's main run so PATCH exercises its idle save path.
  const mainRuntime=runtimeStore.getRuntimeSessionByConversation(conversation.id);
  const active=runs.getActiveRuntimeRun(mainRuntime.id);
  if(active) runs.finishRuntimeRun(active.id,'cancelled');
  const snapshot=store.listConversationMessages(conversation.id).filter(message=>{
    return JSON.parse(message.metadata||'{}').textSelection?.mode!=='inline';
  }).map(message=>({id:'msg_'+message.id,clientMessageId:message.client_message_id,role:message.role,content:message.content}));
  const before=db.prepare("SELECT canonical_message_id,content,tool_calls FROM chat_messages WHERE session_id=1 AND json_extract(tool_calls,'$.textSelection.mode')='inline' ORDER BY canonical_message_id").all();
  assert.ok(before.some(row=>row.content.includes('Lorentz force')));
  globalThis.inlineSaveFixture={db,...store,...runtimeStore,...runs};
  const stubs={
    'next-auth/next':`export const getServerSession=async()=>({user:{id:'1'}});`,
    'next/server':`export const NextResponse=Response;`,
    '@/lib/auth-options':`export const authOptions={};`,
    '@/lib/db':`export default globalThis.inlineSaveFixture.db;`,
    '@/lib/conversations/store':`export const {completeAssistantMessage,deleteConversation,ensureConversationForLegacyChatSession,getConversationById,renameConversation,setConversationHighlight,setConversationPinned}=globalThis.inlineSaveFixture;`,
    '@/lib/hermes/runtime-store':`export const {listRuntimeSessionsForChatSession}=globalThis.inlineSaveFixture;`,
    '@/lib/hermes/run-store':`export const {getActiveRuntimeRun}=globalThis.inlineSaveFixture;`,
    '@/lib/hermes/session-cancel':`export const cancelRuntimeSessionWork=async()=>{};`,
    '@/lib/conversations/external-agent-cancel':`export const cancelRunningExternalAgentRuns=async()=>[];`,
  };
  const bundle=await build({entryPoints:[new URL('../src/app/api/chat-sessions/[sessionId]/route.ts',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'save-boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.path in stubs?{path:a.path,namespace:'stub'}:null);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}))}}]});
  const route=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const response=await route.PATCH(new Request('http://fixture/chat-sessions/1',{method:'PATCH',body:JSON.stringify({messages:snapshot})}),{params:Promise.resolve({sessionId:'1'})});
  assert.equal(response.status,200);
  assert.notEqual((await response.json()).deferredToRuntime,true,'the snapshot actually exercised persistence');
  const after=db.prepare("SELECT canonical_message_id,content,tool_calls FROM chat_messages WHERE session_id=1 AND json_extract(tool_calls,'$.textSelection.mode')='inline' ORDER BY canonical_message_id").all();
  assert.deepEqual(after,before);
  delete globalThis.inlineSaveFixture;
});

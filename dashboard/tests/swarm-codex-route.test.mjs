import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { currentSwarmInvocation, withSwarmInvocation, swarmRuntimeIdentity } from '../src/lib/swarm/invocation.ts';
import { SwarmStartRejected } from '../src/lib/swarm/scheduler.ts';
import { ApiError } from '../src/lib/hermes/route-core.ts';

// Real adapter and POST validation; process, storage and provider I/O are
// isolated. This test does not start Codex or use the installed application.
function load(relative, scope, transform = value => value) {
  const source = transform(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
  const code = ts.transpileModule(tree.statements.filter(node => !ts.isImportDeclaration(node))
    .map(node => node.getText(tree)).join('\n'), { compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS} }).outputText;
  return new Function('exports',...Object.keys(scope),`${code}\nreturn exports;`)({},...Object.values(scope));
}
class RouteError extends Error {}
class ConversationStoreError extends Error {}
class RuntimeJobControlError extends Error { constructor(code) {super(code);this.code=code;} }
const conversation={id:1,public_id:'conv_codex_qa',user_id:1,surface:'dashboard_terminal',archived_at:null};
const starts=[];
const {POST}=load('../src/app/api/codex/runs/route.ts',{
  NextResponse:Response,RouteError,ApiError,ConversationStoreError,
  requireUserId:async()=>currentSwarmInvocation()?.userId??1,currentSwarmInvocation,
  normalizeChatMessageAttachments:()=>[],
  resolveConnectedRepository:(userId,gardenSlug)=>{assert.equal(userId,1);assert.equal(gardenSlug,'qa-repository');return {path:'C:/disposable-swarm-test',name:'QA',gardenSlug};},
  getConversationForUser:(id,userId)=>{assert.equal(id,conversation.public_id);assert.equal(userId,1);return conversation;},
  resolveCommandMessage:async(_user,text)=>({text,invocations:[]}),
  resolveChatmockBaseUrl:()=>({baseURL:'http://provider.invalid/v1'}),
  graftEnabledForGarden:()=>false,
  withConversationContext:text=>text,
  startRun:async input=>{starts.push({input,invocation:currentSwarmInvocation()});return {runId:'job_codex_qa'};},
  recordExternalAgentTurn:()=>{throw Error('A team must not reserve another parent chat turn');},
});
const adapterModule=load('../src/lib/swarm/runtime-adapter.ts',{
  db:{prepare:()=>({get:()=>({status:'running'})})},
  getConversationById:()=>conversation,getConversationMessageByClientId:()=>null,
  SWARM_RUNTIME_ROUTES:{codex:{field:'task',load:async()=>({POST})}},
  OUTER_AGENT_RUNTIME_ADAPTERS:{codex:{scopePrefix:'codex',jobType:'codex-run',workerKind:'outer-codex-node',resourceClass:'core'}},
  withSwarmInvocation,swarmRuntimeIdentity,SwarmStartRejected,RuntimeJobControlError,
  getOuterAgentRuntimeRunByRequest:()=>null,
  lookupRuntimeJobByIdempotencyKey:async()=>{throw new RuntimeJobControlError('JOB_NOT_FOUND');},
});

test('Codex team requests pass the real route validator with a stable client identity',async()=>{
  for(const key of ['implementation','a'.repeat(64)]){
    const requestId=`swarm_01234567-89ab-cdef-0123-456789abcdef:${key}:1`;
    const context={run:{id:'swarm_qa',authority:{userId:1,conversationId:1,conversationPublicId:conversation.public_id,
      model:'test-model',reasoningEffort:'high',gardenSlug:'qa-repository'}},
      task:{key,brief:'Create a tiny deterministic function in the disposable repository.',executor:{kind:'runtime',id:'codex'},inputs:[]},
      attempt:{requestId,status:'starting'},dependencies:[]};
    const handle=await adapterModule.runtimeSwarmAdapter('codex').start(context);
    assert.deepEqual(handle,{kind:'runtime',id:'codex',runId:'job_codex_qa'});
    const last=starts.at(-1);assert.equal(last.input.requestId,requestId);
    assert.equal(last.invocation.requestId,requestId);assert.equal(last.invocation.conversationPublicId,conversation.public_id);
  }
  assert.equal(starts.length,2);
});

test('the normal Codex route still rejects a conversation launch without its client message ID',async()=>{
  const response=await POST(new Request('http://localhost/api/codex/runs',{method:'POST',body:JSON.stringify({task:'Create the function',model:'test-model',conversationId:conversation.public_id})}));
  assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid_client_message_id');
});

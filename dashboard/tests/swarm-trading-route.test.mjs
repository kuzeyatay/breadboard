import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { currentSwarmInvocation, withSwarmInvocation, swarmRuntimeIdentity } from '../src/lib/swarm/invocation.ts';
import { SwarmStartRejected } from '../src/lib/swarm/scheduler.ts';
import { tradingAgentsRequestFromBrief, validateTradingAgentsRequest, TRADINGAGENTS_AGENT_ID } from '../src/lib/tradingagents/identity.ts';
import { DEFAULT_TRADINGAGENTS_SETTINGS, tradingAgentsSettingsFrom } from '../src/lib/tradingagents/settings.ts';

// Execute the real request parser, adapter and route. Runtime/provider work is isolated.
function load(relative, scope, transform = value => value) {
  const source = transform(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
  const code = ts.transpileModule(tree.statements.filter(node => !ts.isImportDeclaration(node))
    .map(node => node.getText(tree)).join('\n'), { compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS} }).outputText;
  return new Function('exports',...Object.keys(scope),`${code}\nreturn exports;`)({},...Object.values(scope));
}
class RouteError extends Error {}
class RuntimeJobControlError extends Error { constructor(code) {super(code);this.code=code;} }
const starts=[];
const {POST}=load('../src/app/api/tradingagents/runs/route.ts',{
  NextResponse:Response,RouteError,requireUserId:async()=>currentSwarmInvocation()?.userId??1,
  validateTradingAgentsRequest,TRADINGAGENTS_AGENT_ID,DEFAULT_TRADINGAGENTS_SETTINGS,tradingAgentsSettingsFrom,
  findConfigurableAgent:()=>true,agentSettingsFor:()=>({}),resolveChatmockBaseUrl:()=>({baseURL:'http://provider.invalid/v1'}),
  startRun:async input=>{starts.push(input);return {runId:'job_trading_qa'};},
});
const {runtimeSwarmAdapter}=load('../src/lib/swarm/runtime-adapter.ts',{
  db:{prepare:()=>({get:()=>({status:'running'})})},
  getConversationById:()=>({id:1,user_id:1,public_id:'conv_qa',archived_at:null}),
  SWARM_RUNTIME_ROUTES:{'trading-agent':{field:'request',load:async()=>({POST})}},
  OUTER_AGENT_RUNTIME_ADAPTERS:{'trading-agent':{scopePrefix:'trading',jobType:'trading-run',workerKind:'trading-worker',resourceClass:'core'}},
  tradingAgentsRequestFromBrief,withSwarmInvocation,swarmRuntimeIdentity,SwarmStartRejected,RuntimeJobControlError,
  getOuterAgentRuntimeRunByRequest:()=>null,
  lookupRuntimeJobByIdempotencyKey:async()=>{throw new RuntimeJobControlError('JOB_NOT_FOUND');},
});

test('Trading Agent team requests preserve the real typed request contract',async()=>{
  const brief='NVDA 2026-01-02';
  const expected=tradingAgentsRequestFromBrief(brief);assert.equal(expected.ok,true);
  const handle=await runtimeSwarmAdapter('trading-agent').start({
    run:{id:'swarm_qa',authority:{userId:1,conversationId:1,conversationPublicId:'conv_qa',model:'test-model',reasoningEffort:'high'}},
    task:{key:'market_review',brief,executor:{kind:'runtime',id:'trading-agent'},inputs:[]},
    attempt:{requestId:'swarm_qa:market_review:1',status:'starting'},dependencies:[],
  });
  assert.deepEqual(handle,{kind:'runtime',id:'trading-agent',runId:'job_trading_qa'});
  assert.equal(starts.length,1);assert.deepEqual(starts[0].request,expected.request);
  assert.equal(starts[0].reasoningEffort,'high');
});

test('the real Trading Agent route still rejects flattened or free-text inputs',async()=>{
  const expected=tradingAgentsRequestFromBrief('NVDA 2026-01-02');
  for(const body of [{...expected.request,model:'test-model'},{request:'NVDA 2026-01-02',model:'test-model'}]) {
    const before=starts.length;
    const response=await POST(new Request('http://localhost/api/tradingagents/runs',{method:'POST',body:JSON.stringify(body)}));
    assert.equal(response.status,400);assert.equal(starts.length,before);
  }
});

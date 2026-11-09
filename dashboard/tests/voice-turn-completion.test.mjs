import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {taskRecoveryCheckpoint} from '../src/lib/hermes/task-recovery-policy.ts';
import {voiceReasoningEffort} from '../src/lib/speech/assistant-preferences.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
function declaration(relative,name,scope) {
  const source=fs.readFileSync(path.join(root,relative),'utf8');
  const ast=ts.createSourceFile(relative,source,ts.ScriptTarget.Latest,true);
  let found; const visit=n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n;else ts.forEachChild(n,visit);};visit(ast);
  assert.ok(found, name+' must exist');
  const js=ts.transpileModule(found.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function('exports',...Object.keys(scope),`${js}\nreturn ${name}`)({},...Object.values(scope));
}
const failedTool={toolName:'weather_forecast',success:false,failure:{code:'not_found',message:'No match'}};
const alternative={toolName:'web_search',success:true};

test('a completed spoken answer is not rerun after an intermediate tool failure',()=>{
  assert.deepEqual(taskRecoveryCheckpoint({status:'idle',tools:[failedTool,alternative],turn:0,completedVoiceAnswer:true}),{});
  assert.ok(taskRecoveryCheckpoint({status:'idle',tools:[failedTool,alternative],turn:0}).checkpoint,
    'normal task recovery retains its existing policy');
});

test('spoken turns with a missing artifact, failed model or user stop retain their failure handling',()=>{
  for(const code of ['required_artifact_missing','hermes_turn_failed']) {
    assert.ok(taskRecoveryCheckpoint({status:'failed',failure:{code,message:'Not delivered'},tools:[failedTool],turn:0,completedVoiceAnswer:true}).checkpoint);
  }
  assert.equal(taskRecoveryCheckpoint({status:'aborted',tools:[failedTool],turn:0,completedVoiceAnswer:true}).stopped,'cancelled');
  assert.equal(taskRecoveryCheckpoint({status:'failed',failure:{code:'quota_exhausted'},tools:[],turn:0,completedVoiceAnswer:true}).stopped,'requires_user_or_external_change');
});

test('a failed artifact, delegate or unknown tool is never dismissed as a completed voice answer',()=>{
  for(const toolName of ['artifact_finalize','artifact_import','agent_launch','mcp_call','custom_action']) {
    assert.ok(taskRecoveryCheckpoint({status:'idle',completedVoiceAnswer:true,tools:[{...failedTool,toolName},alternative],turn:0}).checkpoint,toolName);
    for(const success of [undefined,true]) {
      assert.ok(taskRecoveryCheckpoint({status:'idle',completedVoiceAnswer:true,
        tools:[failedTool,{toolName,success},alternative],turn:0}).checkpoint,
        'a mixed workflow or successful launch is not proof of completed work: '+toolName);
    }
  }
  assert.ok(taskRecoveryCheckpoint({status:'idle',completedVoiceAnswer:true,tools:[alternative,failedTool],turn:0}).checkpoint,
    'a prior successful lookup does not resolve a later failure');
  assert.ok(taskRecoveryCheckpoint({status:'idle',completedVoiceAnswer:true,tools:[failedTool,{toolName:'artifact_create',success:true}],turn:0}).checkpoint,
    'an unrelated successful write is not replacement evidence');
});

test('only persisted completed answers suppress an intermediate lookup-error rerun',()=>{
  let delivered=true, voice=true, failure;
  let decision;
  const record=declaration('src/lib/hermes/task-recovery.ts','recordTaskRecoveryOutcome',{
    getRuntimeRun:()=>({id:'run',runtime_session_id:17}),
    parseRuntimeRunDispatch:()=>({voice,clientMessageId:'turn',taskRecovery:{turn:0}}),
    db:{prepare:()=>({get:(session,id)=>{assert.equal(session,17);assert.equal(id,'turn');return delivered?{1:1}:undefined;}})},
    taskRecoveryCheckpoint:input=>{decision=input;return taskRecoveryCheckpoint(input);},
    sourceRepairOutcome:(_id,state)=>state,saveState:()=>{},recordAuditEvent:()=>{},
  });
  const run=()=>record({runId:'run',status:failure?'failed':'idle',failure,tools:[failedTool,alternative]});
  assert.equal(run().pending,false);assert.equal(decision.completedVoiceAnswer,true);
  delivered=false;assert.equal(run().pending,true);assert.equal(decision.completedVoiceAnswer,false);
  delivered=true;voice=false;assert.equal(run().pending,false);assert.equal(decision.completedTextAnswer,true);
  voice=true;failure={code:'required_artifact_missing',message:'Missing PDF'};assert.equal(run().pending,true);
});

test('new and restored voice sessions prepare the selected model and effort without changing typed preferences',async()=>{
  let preferences={voiceModel:'voice-model',voiceThinking:'fast'};
  const settings={fallbackModel:'typed-fallback',reasoningEffort:'max'};
  const choose=declaration('src/lib/hermes/session-service.ts','conversationRuntimePreferences',{
    getHermesUserSettings:()=>settings,readVoiceAssistantPreferences:()=>preferences,db:{},GLOBAL_MODEL_SENTINEL:'default',voiceReasoningEffort,
  });
  assert.deepEqual(choose({user_id:1,origin_label:'Voice'}),{model:'voice-model',reasoningEffort:'low'});
  assert.deepEqual(choose({user_id:1,origin_label:null}),{model:'typed-fallback',reasoningEffort:'max'});
  preferences={voiceModel:'default',voiceThinking:'high'};
  assert.deepEqual(choose({user_id:1,origin_label:'Voice'}),{model:'typed-fallback',reasoningEffort:'high'});
  const created=[];
  const runtime={kind:'hermes',restoreSession:async input=>{created.push(input);return {externalSessionId:'session',agentName:'assistant'};}};
  const scope={
    conversationRuntimePreferences:choose,
    createWithConfiguredRuntimeFallback:async input=>{created.push(input);return {runtime,created:{externalSessionId:'session',agentName:'assistant'}};},
    conversationWorkspaceIdentity:()=>({}),registerConversationRuntime:()=>({created:true,row:{id:17}}),recordAuditEvent:()=>{},
    loadUnifiedToolRegistryForRuntime:async()=>{},getAgentRuntimeByKind:()=>runtime,runtimeExternalSessionId:()=> 'old',
    canonicalRuntimeMessages:()=>[],replaceAgentRuntimeIdentity:()=>({id:17}),
  };
  const create=declaration('src/lib/hermes/session-service.ts','createConversationRuntime',scope);
  const restore=declaration('src/lib/hermes/session-service.ts','recreateConversationRuntime',scope);
  const conversation={user_id:1,id:5,public_id:'conv_test',origin_label:'Voice',title:'Voice'};
  await create(conversation,'dashboard_terminal',null,null,[]);
  await restore({runtime_kind:'hermes'},conversation,'dashboard_terminal');
  assert.equal(created.length,2);
  for(const input of created){assert.equal(input.model,'typed-fallback');assert.equal(input.reasoningEffort,'high');}
  assert.deepEqual(settings,{fallbackModel:'typed-fallback',reasoningEffort:'max'});
});

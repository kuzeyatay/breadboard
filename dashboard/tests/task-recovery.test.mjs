import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { taskRecoveryCheckpoint, taskFailureCanRecover, unresolvedTaskTools, recoveryToolFailure, MAX_TASK_RECOVERY_TURNS } from '../src/lib/hermes/task-recovery-policy.ts';
import { agentLaunchContinuationMessage } from '../src/lib/hermes/agent-launch.ts';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-task-recovery-'));
process.env.BREADBOARD_DATA_DIR = directory;
process.env.BREADBOARD_GOAL_HOME = path.join(directory, 'goals');
const {default: db} = await import('../src/lib/db.ts');
const {createConversation, reserveConversationTurn, completeAssistantMessage, failAssistantMessage} = await import('../src/lib/conversations/store.ts');
const {createRuntimeSession} = await import('../src/lib/hermes/runtime-store.ts');
const {beginRuntimeRun, finishRuntimeRun, getRuntimeRun, parseRuntimeRunDispatch} = await import('../src/lib/hermes/run-store.ts');
const {recordTaskRecoveryOutcome, taskRecoveryCurrent, prepareTaskRecovery, taskRecoveryForContinuation, continueTaskRecovery, cancelTaskRecovery} = await import('../src/lib/hermes/task-recovery.ts');
const {missingRunArtifact} = await import('../src/lib/hermes/artifact-completion.ts');
const {createArtifact, recordArtifactPipelineEvent} = await import('../src/lib/hermes/artifact-store.ts');
test.after(() => { db.close(); fs.rmSync(directory, {recursive:true, force:true}); });
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'test','recovery@example.test','x')").run();

function setup(failure = {code:'required_artifact_missing', message:'The PDF has not been published.'}) {
  const conversation = createConversation({userId:1, surface:'dashboard_terminal'});
  const session = createRuntimeSession({conversationId:conversation.id, surface:conversation.surface, userId:1,
    chatSessionId:null, agentName:'breadboard-assistant', clusterId:null, gardenId:null, pageSlug:null,
    workspaceKey:conversation.public_id, activeDirectory:directory, filesystemMode:'restricted'});
  const clientMessageId = `request-${conversation.id}`;
  const request = 'Create the PDF with the supplied data and verify it';
  reserveConversationTurn({conversation, clientMessageId, surface:conversation.surface, content:request,
    metadata:{attachments:[{type:'image', name:'reference.png', dataUrl:'data:image/png;base64,aGVsbG8='}]}});
  const run = beginRuntimeRun({runtimeSessionId:session.id, instruction:request, dispatch:{clientMessageId,
    modelIdentity:{modelID:'chosen-model'}, variant:'high',
    taskRecovery:{request, rootClientMessageId:clientMessageId, turn:0, superAgent:true, yoloMode:false, personalize:false}}});
  failAssistantMessage({conversationId:conversation.id, clientMessageId, status:'failed', error:failure.code});
  recordTaskRecoveryOutcome({runId:run.id, status:'failed', tools:[], failure});
  finishRuntimeRun(run.id,'error');
  return {conversation, session, run, clientMessageId};
}

test('ordinary failed tasks persist recovery and retain their original request, model, attachments and permissions', () => {
  const s = setup();
  assert.equal(taskRecoveryCurrent(s.conversation.id,s.run.id), true);
  const input = prepareTaskRecovery(s.conversation.id,s.run.id);
  assert.equal(input.text, s.run.instruction);
  assert.equal(input.model, 'chosen-model');
  assert.equal(input.reasoningEffort, 'high');
  assert.equal(input.yoloMode,false);
  assert.equal(input.personalize,false);
  assert.equal(input.attachments[0].name,'reference.png');
  assert.match(input.surfaceContext.authorizedContext,/saved files, artifacts and existing command\/job handles/);
  assert.equal(input.internalAgentContinuation,true);
  assert.equal(parseRuntimeRunDispatch(getRuntimeRun(s.run.id)).taskRecovery.pending,true);
  assert.equal(recordTaskRecoveryOutcome({runId:s.run.id,status:'failed',tools:[],failure:{code:'duplicate'}}),null);
});

test('recovery dispatch is claimed once, finishes the saved task and stops after verified success', async () => {
  const s = setup();
  let calls=0, release;
  const gate = new Promise(resolve => {release=resolve;});
  const file = path.join(directory,'delivered.txt');
  const dispatch = async input => {
    calls++;
    await gate;
    assert.equal(taskRecoveryCurrent(s.conversation.id,s.run.id,input.clientMessageId),true);
    reserveConversationTurn({conversation:s.conversation,clientMessageId:input.clientMessageId,surface:s.conversation.surface,
      content:input.text,metadata:{internalAgentContinuation:true}});
    const run = beginRuntimeRun({runtimeSessionId:s.session.id,instruction:input.text,dispatch:{clientMessageId:input.clientMessageId,
      taskRecovery:taskRecoveryForContinuation(s.run.id)}});
    fs.writeFileSync(file,'verified result');
    assert.equal(fs.readFileSync(file,'utf8'),'verified result');
    completeAssistantMessage({conversationId:s.conversation.id,clientMessageId:input.clientMessageId,content:'Delivered verified result.'});
    recordTaskRecoveryOutcome({runId:run.id,status:'idle',tools:[{toolName:'publish',success:true}]});
    finishRuntimeRun(run.id,'completed');
    return {accepted:true,run};
  };
  const first = continueTaskRecovery(s.conversation.id,s.run.id,dispatch);
  assert.equal(await continueTaskRecovery(s.conversation.id,s.run.id,dispatch),false);
  release();
  assert.equal(await first,true);
  assert.equal(calls,1);
  assert.equal(taskRecoveryCurrent(s.conversation.id,s.run.id),false);
  assert.equal(parseRuntimeRunDispatch(getRuntimeRun(s.run.id)).taskRecovery.pending,false);
});

test('Stop, new input, an archive and active delegated work prevent a queued recovery', () => {
  for (const action of ['stop','input','archive','worker']) {
    const s=setup();
    if(action==='stop') cancelTaskRecovery(s.conversation.id);
    if(action==='archive') db.prepare("UPDATE conversations SET archived_at=datetime('now') WHERE id=?").run(s.conversation.id);
    if(action==='input'||action==='worker') {
      reserveConversationTurn({conversation:s.conversation,clientMessageId:'new-message',surface:s.conversation.surface,content:'New work',
        metadata:action==='worker'?{internalAgentContinuation:true}:undefined});
      completeAssistantMessage({conversationId:s.conversation.id,clientMessageId:'new-message',content:'Working',
        metadata:action==='worker'?{externalAgentOutcome:'running'}:{}});
    }
    assert.equal(taskRecoveryCurrent(s.conversation.id,s.run.id),false,action);
    assert.equal(prepareTaskRecovery(s.conversation.id,s.run.id),null,action);
  }
});

test('permission and usage errors are never retried; an HTTP 500 or a missing deliverable is repairable', () => {
  for(const message of ['permission_denied','HTTP 401','HTTP 429','quota exhausted','BREADBOARD_RESOURCE_EXHAUSTED','cancelled by user','ENOSPC']) {
    assert.equal(taskFailureCanRecover({message}),false,message);
    const s=setup({message});
    assert.equal(taskRecoveryCurrent(s.conversation.id,s.run.id),false,message);
  }
  for(const code of ['required_artifact_missing','hermes_turn_failed','runtime_dispatch_failed','interactive_visualizer_failed'])
    assert.equal(taskFailureCanRecover({code,message:'HTTP 500'}),true);
});

test('a nested tool denial takes priority over a missing-artifact recovery', () => {
  const tool={toolName:'render',success:false,summary:'Render finished',details:{result:JSON.stringify({error:{code:'permission_denied',message:'Approval denied'}})}};
  const failure=recoveryToolFailure(tool);
  assert.equal(failure.code,'permission_denied');
  assert.equal(taskRecoveryCheckpoint({status:'failed',failure:{code:'required_artifact_missing'},tools:[{...tool,failure}],turn:0}).stopped,'requires_user_or_external_change');
});

test('an expired dispatch claim can resume a stranded automatic reservation', async () => {
  const s=setup();
  const clientMessageId=`recovery:${s.run.id}`;
  reserveConversationTurn({conversation:s.conversation,clientMessageId,surface:s.conversation.surface,content:s.run.instruction,
    metadata:{internalAgentContinuation:true}});
  db.prepare("UPDATE hermes_runs SET dispatch_json=json_set(dispatch_json,'$.taskRecovery.claim',json(?)) WHERE id=?")
    .run(JSON.stringify({id:'dead-worker',expiresAt:0}),s.run.id);
  let called=false;
  assert.equal(await continueTaskRecovery(s.conversation.id,s.run.id,async input=>{
    called=true;
    assert.equal(db.prepare("SELECT status FROM conversation_messages WHERE conversation_id=? AND client_message_id=? AND role='assistant'").get(s.conversation.id,clientMessageId).status,'failed');
    assert.equal(input.retry,true);
    return {accepted:false,clarified:true};
  }),true);
  assert.equal(called,true);
});

test('completion requires a published deliverable from this task, and can reuse verified progress across recovery or Goal turns', () => {
  const s=setup();
  const requirement={kind:'html',rendererId:'interactive-visualizer',sourceSkill:'interactive-visualizer-in-chat',
    readyEventType:'artifact.completed',previewRequired:true};
  const assistant=db.prepare("SELECT id FROM conversation_messages WHERE conversation_id=? AND client_message_id=? AND role='assistant'")
    .get(s.conversation.id,s.clientMessageId);
  const artifact=createArtifact({userId:1,runtimeSessionId:s.session.id,hermesSessionId:'test-session',
    conversationId:s.conversation.id,clusterId:null,runId:s.run.id,assistantMessageId:assistant.id,
    surface:s.conversation.surface,kind:requirement.kind,rendererId:requirement.rendererId,sourceSkill:requirement.sourceSkill,
    title:'Verified visualization',filename:'result.html',content:'{"plan":{"mode":"3d"}}',storageRoot:directory});
  const child=beginRuntimeRun({runtimeSessionId:s.session.id,instruction:s.run.instruction,
    dispatch:{clientMessageId:'recovery-artifact',requiredArtifacts:[requirement],taskRecovery:taskRecoveryForContinuation(s.run.id)}});
  assert.deepEqual(missingRunArtifact(child,s.conversation.id),requirement,'a draft is not a deliverable');
  db.prepare("UPDATE hermes_artifacts SET status='ready',preview_location='preview/index.html' WHERE id=?").run(artifact.id);
  assert.deepEqual(missingRunArtifact(child,s.conversation.id),requirement,'a ready row needs its publication event');
  recordArtifactPipelineEvent({artifact:{...artifact,status:'ready',preview_location:'preview/index.html'},
    runId:s.run.id,assistantMessageId:assistant.id,type:'artifact.completed',status:'ready',version:1,payload:{}});
  assert.equal(missingRunArtifact(child,s.conversation.id),null,'verified parent progress is retained');
  const goalChild={...child,dispatch_json:JSON.stringify({clientMessageId:'goal-child',requiredArtifacts:[requirement],
    goalMode:{enabled:true,previousRunIds:[s.run.id]}})};
  assert.equal(missingRunArtifact(goalChild,s.conversation.id),null);
  const unrelated={...child,dispatch_json:JSON.stringify({clientMessageId:'unrelated',requiredArtifacts:[requirement]})};
  assert.deepEqual(missingRunArtifact(unrelated,s.conversation.id),requirement,'another request cannot borrow the artifact');
  assert.deepEqual(missingRunArtifact(child,setup().conversation.id),requirement,'another conversation cannot borrow the artifact');
  db.prepare("UPDATE hermes_artifacts SET preview_location=NULL WHERE id=?").run(artifact.id);
  assert.deepEqual(missingRunArtifact(child,s.conversation.id),requirement,'lost preview invalidates completion');
  finishRuntimeRun(child.id,'completed');
});

test('failed dispatches get bounded recovery instead of silently dropping the task', async () => {
  const s=setup();
  const dispatch=async()=>{throw new Error('Gateway connection reset');};
  for(let i=0;i<3;i++) {
    await assert.rejects(continueTaskRecovery(s.conversation.id,s.run.id,dispatch),/connection reset/);
    assert.equal(taskRecoveryCurrent(s.conversation.id,s.run.id),i<2);
  }
  assert.equal(parseRuntimeRunDispatch(getRuntimeRun(s.run.id)).taskRecovery.stopped,'repeated_failure_without_progress');
});

test('three identical failures stop, while changed failures or published progress allow another attempt', () => {
  const input={status:'failed',failure:{code:'render_failed',message:'Missing font'},tools:[],turn:0,now:0};
  const first=taskRecoveryCheckpoint(input).checkpoint;
  const second=taskRecoveryCheckpoint({...input,turn:1,previous:first}).checkpoint;
  assert.equal(taskRecoveryCheckpoint({...input,turn:2,previous:second}).stopped,'repeated_failure_without_progress');
  assert.ok(taskRecoveryCheckpoint({...input,turn:2,previous:second,artifacts:['pdf:2']}).checkpoint);
  assert.ok(taskRecoveryCheckpoint({...input,turn:2,previous:second,failure:{code:'render_failed',message:'Layout overflow'}}).checkpoint);
  assert.equal(taskRecoveryCheckpoint({...input,turn:MAX_TASK_RECOVERY_TURNS}).stopped,'recovery_budget_exhausted');
});

test('an unresolved tool failure triggers verification, but a later success does not replay the task', () => {
  const tools=[{toolName:'render_pdf',success:false,summary:'Missing font'}];
  assert.ok(taskRecoveryCheckpoint({status:'idle',tools,turn:0}).checkpoint);
  tools.push({toolName:'render_pdf',success:true});
  assert.deepEqual(unresolvedTaskTools(tools),[]);
  assert.deepEqual(taskRecoveryCheckpoint({status:'idle',tools,turn:1}),{});
});

test('failed CAD and video delegates hand back for repair, while Stop and denial remain final', () => {
  for(const agentName of ['Parametric CAD','Video Use']) {
    const message=agentLaunchContinuationMessage({agentName,outcome:'failed',content:'Model request timed out'});
    assert.match(message,/continue the authorized work/);
    assert.doesNotMatch(message,/Do not relaunch it without being asked/);
  }
  for(const [outcome,content] of [['cancelled','stopped'],['failed','permission denied']]) {
    assert.match(agentLaunchContinuationMessage({agentName:'Parametric CAD',outcome,content}),/Do not relaunch it without being asked/);
  }
});

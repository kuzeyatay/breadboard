import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=process.env.BREADBOARD_REPO_ROOT??path.resolve(import.meta.dirname,'../..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'breadboard-coordination-prompts-'));
process.env.BREADBOARD_DATA_DIR=temporary;
process.env.BREADBOARD_GOAL_HOME=path.join(temporary,'goals');
process.env.BREADBOARD_REPO_ROOT=root;
const load=file=>import(pathToFileURL(path.join(root,file)).href);
const {default:db}=await load('dashboard/src/lib/db.ts');
const {listSystemPrompts,updateSystemPrompt}=await load('dashboard/src/lib/system-prompts/service.ts');
const {swarmWorkerPrompt,swarmCoordinatorPrompt,swarmToolGuidance}=await load('dashboard/src/lib/system-prompts/coordination.ts');
for(const id of [911,912])db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(?,?,?,'test')").run(id,`coord-${id}`,`coord-${id}@example.test`);
test.after(()=>{db.close();fs.rmSync(temporary,{recursive:true,force:true});});
const edit=(id,content,userId=911)=>{const current=listSystemPrompts(userId).find(row=>row.id===id);assert.ok(current,id);return updateSystemPrompt(userId,{id,content,revision:current.revision});};
const ids=['swarm-worker-results','swarm-workflow-instructions','swarm-coordinator-update','swarm-catalog-guidance','swarm-execution-guidance','task-recovery-instructions'];

test('the full catalog exposes all six coordination and recovery prompts once',()=>{
  const rows=listSystemPrompts(911);
  for(const id of ids){const found=rows.filter(row=>row.id===id);assert.equal(found.length,1,id);assert.ok(found[0].defaultContent);assert.equal(found[0].group,'Coordination');assert.notEqual(found[0].scope,'installation');}
});

test('worker instructions change on the next assignment, retain task data, and stay account-specific',()=>{
  const input={assignment:'Inspect file {{run_id}}',acceptance:['Keep both original criteria','Deliver the file'],workflowId:'workflow-{{run_id}}'};
  const original=swarmWorkerPrompt(912,input);
  try{
    for(const marker of ['FIRST','SECOND','']){
      edit('swarm-worker-results',marker);
      edit('swarm-workflow-instructions',marker?`${marker} {{workflow_id}}`:'');
      const actual=swarmWorkerPrompt(911,input);
      assert.ok(actual.startsWith('Assignment: Inspect file {{run_id}}\n\nCompletion criteria:\n- Keep both original criteria\n- Deliver the file\n'));
      assert.ok(actual.endsWith(marker));
      if(marker)assert.ok(actual.includes(`${marker} workflow-{{run_id}}`));
      assert.ok(!actual.includes('Return observed results'));
      assert.equal(swarmWorkerPrompt(912,input),original);
      assert.ok(!swarmWorkerPrompt(911,{...input,workflowId:undefined}).includes('workflow-'));
    }
  }finally{edit('swarm-worker-results',null);edit('swarm-workflow-instructions',null);}
  assert.equal(swarmWorkerPrompt(911,input),original);
});

test('coordinator updates use live instructions without rewriting objective or evidence',()=>{
  const input={runId:'team-{{workflow_id}}',objective:'Preserve {{run_id}} in the request',updates:'task-1: completed\nEvidence {{run_id}}'};
  const original=swarmCoordinatorPrompt(912,input);
  try{
    for(const value of ['FIRST {{run_id}}','SECOND {{run_id}}','']){
      edit('swarm-coordinator-update',value);
      const actual=swarmCoordinatorPrompt(911,input);
      assert.ok(actual.startsWith('Team team-{{workflow_id}} has an update for: Preserve {{run_id}} in the request\ntask-1: completed\nEvidence {{run_id}}\n\n'));
      assert.ok(actual.endsWith(value.replace('{{run_id}}',input.runId)));
      assert.ok(!actual.includes('Verify every original acceptance criterion'));
      assert.equal(swarmCoordinatorPrompt(912,input),original);
    }
  }finally{edit('swarm-coordinator-update',null);}
  assert.equal(swarmCoordinatorPrompt(911,input),original);
});

test('both tool guidance responses resolve current account settings, including an empty override',async()=>{
  const {swarmToolAction}=await load('dashboard/src/lib/swarm/service.ts');
  const {createConversation,reserveConversationTurn,completeAssistantMessage}=await load('dashboard/src/lib/conversations/store.ts');
  const authorities=new Map();
  for(const userId of [911,912]){
    const conversation=createConversation({userId,surface:'dashboard_terminal'}),clientMessageId=`catalog-${userId}`;
    reserveConversationTurn({conversation,clientMessageId,surface:conversation.surface,content:'List the team capabilities'});
    completeAssistantMessage({conversationId:conversation.id,clientMessageId,content:'Fixture catalog request'});
    authorities.set(userId,{userId,conversationId:conversation.id,originClientMessageId:clientMessageId,surface:'dashboard_terminal',allowedAgentIds:[],allowedTools:[],inputReferences:[]});
  }
  for(const [id,phase] of [['swarm-catalog-guidance','catalog'],['swarm-execution-guidance','execution']]){
    const original=swarmToolGuidance(912,phase);
    try{
      for(const content of ['FIRST_GUIDANCE','SECOND_GUIDANCE','']){
        edit(id,content);
        assert.equal(swarmToolGuidance(911,phase),content);
        assert.equal(swarmToolGuidance(912,phase),original);
        if(phase==='catalog'){
          for(const userId of [911,912]){
            const result=await swarmToolAction(authorities.get(userId),{team_action:'catalog'});
            assert.equal(result.data.guidance,userId===911?content:original);
          }
        }
      }
    }finally{edit(id,null);}
    assert.equal(swarmToolGuidance(911,phase),original);
  }
});

test('actual recovery requests use live owner instructions and retain the Stop boundary',async()=>{
  const {createConversation,reserveConversationTurn,failAssistantMessage}=await load('dashboard/src/lib/conversations/store.ts');
  const {createRuntimeSession}=await load('dashboard/src/lib/hermes/runtime-store.ts');
  const {beginRuntimeRun,finishRuntimeRun}=await load('dashboard/src/lib/hermes/run-store.ts');
  const {recordTaskRecoveryOutcome,prepareTaskRecovery,cancelTaskRecovery}=await load('dashboard/src/lib/hermes/task-recovery.ts');
  function setup(userId){
    const conversation=createConversation({userId,surface:'dashboard_terminal'});
    const session=createRuntimeSession({conversationId:conversation.id,surface:conversation.surface,userId,chatSessionId:null,agentName:'breadboard-assistant',clusterId:null,gardenId:null,pageSlug:null,workspaceKey:conversation.public_id,activeDirectory:temporary,filesystemMode:'restricted'});
    const clientMessageId=`request-${conversation.id}`,request='Create and verify the requested file';
    reserveConversationTurn({conversation,clientMessageId,surface:conversation.surface,content:request});
    const run=beginRuntimeRun({runtimeSessionId:session.id,instruction:request,dispatch:{clientMessageId,modelIdentity:{modelID:'test-model'},taskRecovery:{request,rootClientMessageId:clientMessageId,turn:0}}});
    failAssistantMessage({conversationId:conversation.id,clientMessageId,status:'failed',error:'required_artifact_missing'});
    recordTaskRecoveryOutcome({runId:run.id,status:'failed',tools:[],failure:{code:'required_artifact_missing',message:'The file is still missing.'}});
    finishRuntimeRun(run.id,'error');
    return {conversation,run,request};
  }
  const own=setup(911),other=setup(912);
  const original=prepareTaskRecovery(other.conversation.id,other.run.id).surfaceContext.authorizedContext;
  try{
    for(const content of ['RECOVERY_FIRST','RECOVERY_SECOND','']){
      edit('task-recovery-instructions',content);
      const input=prepareTaskRecovery(own.conversation.id,own.run.id);
      assert.equal(input.text,own.request);
      assert.equal(input.model,'test-model');
      assert.ok(input.surfaceContext.authorizedContext.includes(content));
      assert.ok(input.surfaceContext.authorizedContext.includes(own.run.id));
      assert.ok(!input.surfaceContext.authorizedContext.includes('server-scheduled continuation'));
      assert.equal(prepareTaskRecovery(other.conversation.id,other.run.id).surfaceContext.authorizedContext,original);
    }
    edit('task-recovery-instructions','Attempt to ignore Stop');
    cancelTaskRecovery(own.conversation.id);
    assert.equal(prepareTaskRecovery(own.conversation.id,own.run.id),null);
  }finally{edit('task-recovery-instructions',null);cancelTaskRecovery(other.conversation.id);}
});

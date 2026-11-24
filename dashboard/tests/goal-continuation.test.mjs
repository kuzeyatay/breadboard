import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'breadboard-goal-idle-'));
process.env.BREADBOARD_DATA_DIR=directory;
const {default:db}=await import('../src/lib/db.ts');
const {createConversation,reserveConversationTurn,completeAssistantMessage}=await import('../src/lib/conversations/store.ts');
const {createRuntimeSession}=await import('../src/lib/hermes/runtime-store.ts');
const {beginRuntimeRun,finishRuntimeRun}=await import('../src/lib/hermes/run-store.ts');
const {activateGoalMode,setGoalModeStatus,clearGoalModeState}=await import('../src/lib/goal-mode.ts');
const {goalContinuationCurrent,latestGoalTurn}=await import('../src/lib/goal-continuation.ts');
const {presentHermesSessionDetail}=await import('../src/lib/hermes/session-presentation.ts');
test.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
db.prepare("INSERT INTO users(id,username,email,password_hash) VALUES(1,'test','goal@example.test','x')").run();
function setup(){
  const conversation=createConversation({userId:1,surface:'dashboard_terminal'});
  const session=createRuntimeSession({conversationId:conversation.id,surface:'dashboard_terminal',userId:1,
    chatSessionId:null,agentName:'breadboard-assistant',clusterId:null,gardenId:null,pageSlug:null,
    workspaceKey:conversation.public_id,activeDirectory:directory,filesystemMode:'restricted'});
  const goal=activateGoalMode({conversationPublicId:conversation.public_id,objective:'Explain the result'});
  const run=beginRuntimeRun({runtimeSessionId:session.id,instruction:'Explain',dispatch:{goalMode:{enabled:true,goalId:goal.goal_id}}});
  return {conversation,session,goal,run,check:(own='')=>goalContinuationCurrent(conversation.id,run.id,goal.goal_id,own)};
}
test('reopening a long goal chat includes the latest user and automatic turn', () => {
  const { conversation, goal } = setup();
  const surface = 'dashboard_terminal';
  db.transaction(() => {
    for (let i = 0; i <= 100; i++) {
      const clientMessageId = 'follow-up-' + i;
      reserveConversationTurn({ conversation, clientMessageId, surface, content: 'Question ' + i });
      completeAssistantMessage({ conversationId: conversation.id, clientMessageId, content: 'Answer ' + i });
    }
  })();
  const clientMessageId = 'goal:' + goal.goal_id + ':next';
  reserveConversationTurn({ conversation, surface, clientMessageId, content: 'Continue',
    metadata: { internalAgentContinuation: true, goalContinuation: true } });
  const messages = presentHermesSessionDetail(conversation).messages;
  assert.equal(messages.length, 204);
  assert.equal(messages.at(-4).content, 'Question 100');
  assert.equal(messages.at(-2).goalContinuation, true);
  assert.equal(messages.at(-1).pending, true);
  assert.deepEqual(latestGoalTurn(conversation.id, goal.goal_id), { clientMessageId, status: 'pending' });
  assert.equal(latestGoalTurn(conversation.id, 'another-goal'), null);
});

test('only an idle terminal run may start a continuation',()=>{
  const s=setup(); assert.equal(s.check(),false);
  finishRuntimeRun(s.run.id,'completed'); assert.equal(s.check(),true);
  beginRuntimeRun({runtimeSessionId:s.session.id,instruction:'new user input',dispatch:{}});
  assert.equal(s.check(),false);
});
test('reserved user input wins; the continuation can pass its own reservation',()=>{
  const s=setup();finishRuntimeRun(s.run.id,'completed');
  reserveConversationTurn({conversation:s.conversation,clientMessageId:'waiting-user',surface:'dashboard_terminal',content:'Wait'});
  assert.equal(s.check(),false); assert.equal(s.check('waiting-user'),true);
});
test('pause, clear, and archive invalidate work already queued',()=>{
  for(const action of ['pause','clear','archive']){
    const s=setup();finishRuntimeRun(s.run.id,'completed');assert.equal(s.check(),true);
    if(action==='pause')setGoalModeStatus({conversationPublicId:s.conversation.public_id,status:'paused'});
    if(action==='clear')clearGoalModeState(s.conversation.public_id);
    if(action==='archive')db.prepare("UPDATE conversations SET archived_at=datetime('now') WHERE id=?").run(s.conversation.id);
    assert.equal(s.check(),false);
  }
});
test('active delegated work owns the next turn even after the parent answer ends',()=>{
  const s=setup();finishRuntimeRun(s.run.id,'completed');
  reserveConversationTurn({conversation:s.conversation,clientMessageId:'worker-test',surface:'dashboard_terminal',content:'Work'});
  completeAssistantMessage({conversationId:s.conversation.id,clientMessageId:'worker-test',content:'Working',metadata:{externalAgentOutcome:'running'}});
  assert.equal(s.check(),false);
});
test('an explicitly resumed goal may continue after a cancelled or failed run',()=>{
  for(const status of ['cancelled','error']){
    const s=setup();finishRuntimeRun(s.run.id,status);
    setGoalModeStatus({conversationPublicId:s.conversation.public_id,status:'paused'}); assert.equal(s.check(),false);
    setGoalModeStatus({conversationPublicId:s.conversation.public_id,status:'active'}); assert.equal(s.check(),true);
  }
});


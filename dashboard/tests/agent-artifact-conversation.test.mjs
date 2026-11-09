import assert from 'node:assert/strict';
import test from 'node:test';
import {ensureAgentArtifactConversation} from '../src/lib/conversations/agent-artifact-runtime.ts';

function fixture({session=null,surface='dashboard_terminal',ownerError=null,resolveError=null}={}) {
  const calls=[];
  const conversation={id:17,public_id:'conv_owned',surface};
  const dependencies={
    getConversationForUser(id,userId){calls.push(['authorize',id,userId]);if(ownerError)throw ownerError;return conversation;},
    getRuntimeSessionByConversation(id){calls.push(['session',id]);return session;},
    runtimeExternalSessionId(value){return value.external_id??null;},
    conversationOrigin(){return {gardenSlug:'origin-garden'};},
    async resolveConversationRuntime(input){calls.push(['resolve',input]);if(resolveError)throw resolveError;return {};},
  };
  return {calls,conversation,load:async()=>dependencies};
}
const input={userId:4,conversationPublicId:'conv_owned'};
test('a first specialist turn authorizes its chat before creating artifact runtime state',async()=>{
  const f=fixture();await ensureAgentArtifactConversation(input,f.load);
  assert.deepEqual(f.calls.map(call=>call[0]),['authorize','session','resolve']);
  assert.deepEqual(f.calls[2][1],{conversation:f.conversation,surface:'dashboard_terminal',activeGardenSlug:'origin-garden',activePageSlug:null});
});
test('an established runtime does not get recreated',async()=>{
  const f=fixture({session:{external_id:'runtime_existing'}});await ensureAgentArtifactConversation(input,f.load);
  assert.deepEqual(f.calls.map(call=>call[0]),['authorize','session']);
});
test('an unbound garden runtime retains its garden and page',async()=>{
  const f=fixture({surface:'garden_chat',session:{garden_id:'saved-garden',page_slug:'saved-page'}});
  await ensureAgentArtifactConversation(input,f.load);
  assert.equal(f.calls[2][1].activeGardenSlug,'saved-garden');assert.equal(f.calls[2][1].activePageSlug,'saved-page');
});
test('another user and unsupported surfaces cannot create artifact runtime state',async()=>{
  for(const options of [{ownerError:new Error('conversation_not_found')},{surface:'private_unsupported'}]){
    const f=fixture(options);await assert.rejects(()=>ensureAgentArtifactConversation(input,f.load));
    assert.equal(f.calls.some(call=>call[0]==='resolve'),false);
  }
});
test('runtime initialization failure rejects before a specialist can be admitted',async()=>{
  const f=fixture({resolveError:new Error('runtime unavailable')});
  await assert.rejects(()=>ensureAgentArtifactConversation(input,f.load),/runtime unavailable/);
});
test('a task with no conversation does not load conversation storage or a provider',async()=>{
  await ensureAgentArtifactConversation({userId:4,conversationPublicId:null},async()=>{throw Error('must not load');});
});

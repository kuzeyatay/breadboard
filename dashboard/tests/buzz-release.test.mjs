import assert from 'node:assert/strict';
import test from 'node:test';
import { createBuzzFixture } from './helpers/buzz-release-fixture.mjs';
import { runtimeOutput } from '../src/lib/buzz/runtime-output.ts';
import { mergeMessages, transcriptKey } from '../src/app/buzz/lib/message-state.ts';

test('organization flow: invitations, permissions, delivery, agents, threads and history', async () => {
  const fixture = await createBuzzFixture();
  const {api,call,qa} = fixture;
  try {
    assert.equal((await call(0,'rooms')).status,401);
    const created = await call(1,'organizations','POST',{name:'Release team',createGeneralRoom:true});
    assert.equal(created.status,201);
    const organizationId = created.body.id;
    const rails = (await call(1,'rooms')).body;
    assert.equal(rails.organizations[0].people[0].username,'anna');
    assert.equal(rails.rooms.length,1);
    const publicRoom = rails.rooms[0].publicId;
    const {body:{room:privateRoom}} = await call(1,'rooms','POST',{organizationId,name:'Private launch',visibility:'private'});
    const params = {roomId:privateRoom.publicId};
    assert.equal((await call(2,'messages','GET',undefined,params)).status,404);
    const invite = await call(1,'members','POST',{userId:2},params);
    assert.equal(invite.status,202);
    assert.equal((await call(2,'rooms')).body.organizations.length,0);
    const pending = (await call(2,'inbox')).body.invites[0];
    assert.equal((await call(3,'invites','PATCH',{inviteId:pending.id,accept:true})).status,404);
    assert.equal((await call(2,'invites','PATCH',{inviteId:pending.id,accept:true})).status,200);
    const detail = (await call(2,'messages','GET',undefined,params)).body;
    assert.equal(detail.permissions.canManage,false);
    assert.equal(detail.permissions.canPost,true);
    assert.ok(detail.members.some(member=>member.userId===2),'accepted invitation seats the private room');
    for(const [key,method,body,extra] of [
      ['room','PATCH',{name:'Hijacked'},{}],['room','DELETE',undefined,{}],['members','POST',{personaSlug:'bread'},{}],
      ['member','PATCH',{respondTo:'never'},{memberId:String(detail.members.find(m=>m.kind==='agent').id)}],
    ]) assert.equal((await call(2,key,method,body,{...params,...extra})).status,403);

    assert.equal((await call(2,'messages','POST',{body:'forged agent identity',clientMessageId:'buzz_reply_1_2'},params)).status,400);
    const send = {body:'Hello team',clientMessageId:'stable-human-id'};
    const first = await call(2,'messages','POST',send,params);
    assert.equal(first.status,201);
    const callsBefore = qa.calls.length;
    assert.equal(qa.calls.at(-1).conversation.user_id,2,'triggering account owns the run');
    assert.equal(qa.calls.at(-1).yoloMode,false);
    assert.equal(qa.calls.at(-1).personalize,false);
    await call(2,'messages','POST',send,params);
    assert.equal(qa.calls.length,callsBefore,'duplicate send must not start another turn');
    assert.equal((await call(1,'messages','POST',send,params)).status,409,'another author cannot claim the delivery id');
    assert.equal((await call(2,'messages','POST',{...send,body:'different'},params)).status,409);
    assert.equal((await call(2,'messages','POST',{...send,clientMessageId:'invalid-parent',parentId:1},params)).status,400);
    let transcript = (await call(1,'messages','GET',undefined,params)).body.messages;
    assert.equal(transcript.length,2);
    assert.match(transcript[1].body,/account 2/);
    const human = transcript[0]; const agent = transcript[1];
    assert.equal((await call(1,'message','PATCH',{body:'edit somebody else'},{...params,messageId:String(human.id)})).status,403);
    assert.equal((await call(2,'message','PATCH',{body:'Edited hello'},{...params,messageId:String(human.id)})).status,200);
    assert.equal((await call(3,'message','DELETE',undefined,{...params,messageId:String(human.id)})).status,404);
    await call(1,'messages','POST',{body:'Owner asks',clientMessageId:'owner-send'},params);
    assert.equal(qa.calls.at(-1).conversation.user_id,1);
    assert.notEqual(qa.calls.at(-1).conversation.id,qa.calls[0].conversation.id,'different accounts never share a tool session');

    const rootParams = {...params,messageId:String(human.id)};
    const reply = await call(2,'thread','POST',{body:'Thread reply',clientMessageId:'thread-stable'},rootParams);
    assert.equal(reply.status,201);
    await call(2,'thread','POST',{body:'Thread reply',clientMessageId:'thread-stable'},rootParams);
    const thread = (await call(2,'thread','GET',undefined,rootParams)).body;
    assert.equal(thread.messages.length,2);
    assert.ok(thread.messages.every(row=>row.parentId===human.id));
    assert.equal((await call(2,'thread','POST',{body:'nested',clientMessageId:'nested'}, {...params,messageId:String(thread.messages[0].id)})).status,404);
    await call(2,'message','PATCH',{emoji:'👍'},{...params,messageId:String(thread.messages[0].id)});
    assert.equal((await call(2,'thread','GET',undefined,rootParams)).body.messages[0].reactions[0].count,1);

    qa.failNext=true;
    await call(2,'messages','POST',{body:'failure-test',clientMessageId:'failed-runtime'},params);
    let failed = (await call(2,'messages','GET',undefined,params)).body.messages.at(-1);
    assert.equal(failed.status,'failed');
    await call(2,'message','POST',{action:'regenerate'},{...params,messageId:String(failed.id)});
    failed=(await call(2,'messages','GET',undefined,params)).body.messages.find(row=>row.id===failed.id);
    assert.equal(failed.status,'complete');

    await call(2,'messages','POST',{body:'permission-test',clientMessageId:'permission-request'},params);
    const blocked=(await call(2,'messages','GET',undefined,params)).body.messages.at(-1);
    assert.equal(blocked.metadata.needsPermission,true);
    const sharedBlocked=(await call(1,'messages','GET',undefined,params)).body.messages.find(row=>row.id===blocked.id);
    assert.equal(sharedBlocked.metadata.pendingPermissions,undefined);
    assert.equal(sharedBlocked.metadata.conversationPublicId,undefined);
    assert.equal((await call(1,'message','POST',{action:'approve'},{...params,messageId:String(blocked.id)})).status,403,'room owner cannot grant another account permission');
    assert.equal((await call(2,'message','POST',{action:'approve'},{...params,messageId:String(blocked.id)})).status,200);
    assert.deepEqual(qa.calls.at(-1).confirmedPermissionIds,['read-test']);

    const native = await call(1,'members','POST',{personaSlug:'runtime:deep-research'},params);
    assert.equal(native.status,201);
    await call(2,'messages','POST',{body:'@deep-research Compare these papers',clientMessageId:'native-request'},params);
    assert.equal(qa.nativeCalls.at(-1).agentId,'deep-research');
    assert.equal(qa.nativeCalls.at(-1).userId,2);
    assert.equal(qa.nativeCalls.at(-1).task,'Compare these papers');
    await new Promise(resolve=>setTimeout(resolve,1500));
    assert.equal(api.db.prepare("SELECT status FROM buzz_room_messages WHERE room_id=? ORDER BY id DESC LIMIT 1").get(privateRoom.id).status,'complete','agent completion is saved even without an open transcript');
    const nativeReply=(await call(1,'messages','GET',undefined,params)).body.messages.at(-1);
    assert.equal(nativeReply.status,'complete');
    assert.match(nativeReply.body,/Native agent answer for account 2/);
    assert.equal(nativeReply.metadata.externalAgentRun.kind,'deep_research');

    const bread=detail.members.find(member=>member.personaSlug==='bread');
    await call(1,'member','DELETE',undefined,{...params,memberId:String(bread.id)});
    assert.ok(!(await call(1,'messages','GET',undefined,params)).body.members.some(member=>member.personaSlug==='bread'),'removed Bread must stay removed after reads');
    for(let i=0;i<235;i++) api.store.postMessage(api.db,privateRoom.id,{clientMessageId:`history-${i}`,authorKind:'human',authorName:'anna',body:`History ${i}`});
    let page=(await call(2,'messages','GET',undefined,params)).body;
    assert.equal(page.messages.length,50);
    const ids=new Set(page.messages.map(message=>message.id));
    while(page.hasOlder) {
      page=(await call(2,'messages','GET',undefined,params,`?before=${page.nextCursor}`)).body;
      for(const message of page.messages) {assert.ok(!ids.has(message.id));ids.add(message.id);}
    }
    assert.ok(ids.size>235,'history beyond the original 200-message limit remains reachable');
    await call(1,'room','PATCH',{archived:true},params);
    assert.equal((await call(2,'messages','POST',{body:'archived',clientMessageId:'archived'},params)).status,409);
    assert.equal((await call(2,'thread','POST',{body:'archived',clientMessageId:'archived-thread'},rootParams)).status,409);
    await call(1,'room','PATCH',{archived:false},params);
    assert.equal((await call(1,'message','DELETE',undefined,{...params,messageId:String(human.id)})).status,200,'manager can moderate a human message');
    assert.equal((await call(1,'member','DELETE',undefined,{...params,memberId:String(detail.selfMemberId)})).status,200);
    assert.equal((await call(2,'messages','GET',undefined,params)).status,404,'removed private-room member loses access');
    await call(1,'room','DELETE',undefined,params);
    assert.equal((await call(2,'messages','GET',undefined,params)).status,404);
    assert.ok(qa.stopped.length>0,'work is cancelled before room deletion');
    assert.equal(api.db.prepare('SELECT COUNT(*) n FROM conversations WHERE buzz_room_id=?').get(privateRoom.id).n,0);
    assert.equal((await call(2,'messages','GET',undefined,{roomId:publicRoom})).status,200);
  } finally {fixture.close();}
});

test('delivery merging is idempotent and storage is scoped by account, room and thread',()=>{
  assert.deepEqual(mergeMessages([{id:1,clientMessageId:'a',body:'old'}],[{id:1,clientMessageId:'a',body:'new'},{id:2,clientMessageId:'b'}]).map(row=>row.body),['new',undefined]);
  assert.equal(new Set([transcriptKey(1,'a'),transcriptKey(2,'a'),transcriptKey(1,'b'),transcriptKey(1,'a',2)]).size,4);
});

test('native output preserves results and excludes tool logs',()=>{
  const output=runtimeOutput([{type:'tool.result',payload:{text:'private tool log'}},{type:'run.result',payload:{result:'Final report'}},{type:'run.completed',payload:{}}]);
  assert.deepEqual(output,{body:'Final report',status:'complete'});
  assert.equal(runtimeOutput([{type:'run.failed',payload:{message:'Connection lost'}}]).status,'failed');
});

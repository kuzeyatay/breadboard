import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ensureBuzzSchema } from '../src/lib/buzz/schema.ts';
import { createRoom, addMember, postMessage, getMessage } from '../src/lib/buzz/store.ts';
import { readBrowserAnnotations as read, writeBrowserAnnotation as write } from '../src/lib/browser-annotations-store.ts';

const target = {kind:'text',url:'https://example.com/article',title:'A shared page',quote:'The selected passage',prefix:'',suffix:''};
function fixture(t) {
  const db=new Database(':memory:'); t.after(()=>db.close()); db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT); CREATE TABLE organizations(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE organization_members(id INTEGER PRIMARY KEY,organization_id INTEGER,user_id INTEGER,role TEXT DEFAULT 'member',UNIQUE(organization_id,user_id));
    CREATE TABLE conversations(id INTEGER PRIMARY KEY,public_id TEXT,user_id INTEGER,title TEXT);
    INSERT INTO users VALUES(1,'ada'),(2,'grace'),(3,'lin'); INSERT INTO organizations VALUES(10,'Studio'),(20,'Outside');
    INSERT INTO organization_members(organization_id,user_id) VALUES(10,1),(10,2),(20,3);`);
  ensureBuzzSchema(db);
  const room=createRoom(db,10,1,{name:'Research',visibility:'public'});
  let sequence=0;
  return {db,room,scope:`room:${room.publicId}`,post:(scope='public',userId=1,extra={})=>write(db,userId,['','Ada','Grace','Lin'][userId],{scope,target,action:'comment',body:'A useful observation',operationId:`operation-${++sequence}`, ...extra})};
}
test('General public crosses organizations while room discussions keep organization permissions',t=>{
  const {db,scope,post}=fixture(t);
  const org=post(scope); const shared=post();
  assert.notEqual(org.thread.id,shared.thread.id);
  assert.equal(read(db,3,'public',target.url,shared.thread.id).messages[0].author,'Ada');
  assert.equal(read(db,2,scope,target.url,org.thread.id).messages.length,1);
  assert.throws(()=>read(db,3,scope,target.url),{status:404});
  assert.throws(()=>read(db,1,'public',target.url,org.thread.id),{status:404});
  assert.throws(()=>post(scope,3),{status:404});
  db.prepare('DELETE FROM organization_members WHERE user_id=2').run();
  assert.throws(()=>read(db,2,scope,target.url),{status:404});
  assert.throws(()=>post(scope,2),{status:404});
});
test('room comments and replies use the Organization transcript and preserve sources',t=>{
  const {db,room,scope,post}=fixture(t);
  const result=post(scope,1,{source:'https://example.org/evidence'});
  assert.ok(result.thread.organizationHref.includes('thread=buzz-thread'));
  const reply=getMessage(db,Number(result.messages[0].id.slice(5)));
  assert.equal(reply.parentId,result.thread.rootMessageId);
  assert.match(reply.body,/Source: https:\/\/example.org\/evidence/);
  assert.equal(result.messages[0].body,'A useful observation');
  const member=addMember(db,room.id,{kind:'human',userId:2,displayName:'Grace',handle:'grace'});
  postMessage(db,room.id,{clientMessageId:'from-organization',memberId:member.id,authorKind:'human',authorName:'Grace',body:'Reply from Organization',parentId:result.thread.rootMessageId});
  assert.equal(read(db,1,scope,target.url,result.thread.id).messages.at(-1).body,'Reply from Organization');
});
test('private rooms enforce membership, and archived rooms reject writes',t=>{
  const {db,post}=fixture(t); const privateRoom=createRoom(db,10,1,{name:'Private',visibility:'private'}); const scope=`room:${privateRoom.publicId}`;
  assert.throws(()=>post(scope,2),{status:404});
  addMember(db,privateRoom.id,{kind:'human',userId:2,displayName:'Grace',handle:'grace'}); post(scope,2);
  db.prepare("UPDATE buzz_rooms SET archived_at=datetime('now') WHERE id=?").run(privateRoom.id);
  assert.throws(()=>post(scope,2),{status:409});
});
test('retries are idempotent and operation identifiers cannot cross audiences',t=>{
  const {post,scope}=fixture(t); const one=post('public',1,{operationId:'retry-key-123'}); const two=post('public',1,{operationId:'retry-key-123'});
  assert.equal(two.thread.id,one.thread.id); assert.equal(two.messages.length,1);
  assert.throws(()=>post(scope,1,{operationId:'retry-key-123'}),{status:409});
});
test('flags are reversible and comments can only be deleted by their author',t=>{
  const {post,scope}=fixture(t);
  for(const audience of ['public',scope]) {
    const flagged=post(audience,1,{action:'flag',body:'The source does not support the claim'});
    assert.equal(flagged.flags.length,1); if(audience===scope) assert.ok(flagged.thread.rootMessageId);
    assert.equal(post(audience,2,{action:'withdraw-flag'}).flags.length,1);
    assert.equal(post(audience,1,{action:'withdraw-flag'}).flags.length,0);
    const comment=post(audience); const messageId=comment.messages[0].id;
    assert.throws(()=>post(audience,2,{action:'delete-comment',messageId}),{status:404});
    assert.equal(post(audience,1,{action:'delete-comment',messageId}).messages.length,0);
  }
});
test('invalid targets and source URLs are rejected before writing',t=>{
  const {post}=fixture(t);
  for(const source of ['javascript:alert(1)','file:///private','https://user:secret@example.com']) assert.throws(()=>post('public',1,{source}),{status:400});
  assert.throws(()=>post('public',1,{target:{...target,url:'file:///secret'}}),{status:400});
  assert.throws(()=>post('public',1,{target:{...target,kind:'video',selector:'video',time:-1}}),{status:400});
});

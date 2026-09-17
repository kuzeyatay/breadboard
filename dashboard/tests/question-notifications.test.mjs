import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { isChatNotificationRecord } from '../src/lib/chat-notification-inbox.ts';
import { dismissQuestionNotifications, listPendingQuestionNotifications, questionNotificationId,
  recordQuestionNotification, resolveQuestionNotification } from '../src/lib/chat-notifications/questions.ts';
import { ensureChatNotificationSchema, listPendingChatNotifications } from '../src/lib/chat-notifications/store.ts';

function database(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES(1),(2);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY, slug TEXT);
    INSERT INTO clusters VALUES(1,'signals');
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, public_id TEXT, user_id INTEGER, title TEXT, surface TEXT,
      default_garden_id INTEGER, legacy_chat_session_id INTEGER, temporary INTEGER DEFAULT 0, buzz_room_id INTEGER, origin_label TEXT);
    INSERT INTO conversations(id,public_id,user_id,title,surface,default_garden_id,legacy_chat_session_id) VALUES
      (1,'conv_main',1,'Research','dashboard_terminal',NULL,NULL),
      (2,'conv_other',2,'Other account','dashboard_terminal',NULL,NULL),
      (3,'conv_garden',1,'Garden chat','garden_chat',1,42);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY, conversation_id INTEGER, client_message_id TEXT,
      role TEXT DEFAULT 'assistant', content TEXT, status TEXT DEFAULT 'complete', metadata TEXT, updated_at TEXT);
    CREATE TABLE hermes_runtime_sessions(id INTEGER PRIMARY KEY, user_id INTEGER, conversation_id INTEGER);
    INSERT INTO hermes_runtime_sessions VALUES(1,1,1),(2,2,2),(3,1,3);
    CREATE TABLE hermes_runs(id TEXT PRIMARY KEY, runtime_session_id INTEGER, status TEXT, dispatch_json TEXT, started_at TEXT, heartbeat_at TEXT);
  `);
  for (const id of [1,2,3]) db.prepare('INSERT INTO hermes_runs VALUES(?,?,?, ?,?,?)')
    .run(`run${id}`,id,'active','{}',new Date().toISOString(),new Date().toISOString());
  ensureChatNotificationSchema(db);
  listPendingChatNotifications(db,1);
  return db;
}

function ask(db, session = 1, requestId = 'request1') {
  recordQuestionNotification(db, { runtimeSessionId: session, runId: `run${session}`, requestId,
    question: 'Which period should I research?', choices: ['This year', 'Last year'] });
}

test('pending questions notify before a response completes, with the exact chat and choices', t => {
  const db = database(t);
  ask(db); ask(db,2); ask(db,3);
  const notices = listPendingQuestionNotifications(db,1);
  assert.equal(notices.length,2);
  assert.equal(notices[0].title,'Answer needed');
  assert.equal(notices[0].kind,'chat_question');
  assert.match(notices[0].response,/Which period.*\n\n• This year\n\n• Last year/);
  assert.deepEqual(notices[0].target,{ surface:'dashboard_terminal',chatId:'conv_main' });
  assert.deepEqual(notices[1].target,{ surface:'garden_chat',chatId:'42',gardenSlug:'signals',conversationId:'conv_garden' });
  assert.ok(notices.every(isChatNotificationRecord));
  assert.equal(listPendingQuestionNotifications(db,2).length,1);
  assert.deepEqual(listPendingChatNotifications(db,1),[]);
});

test('dismissals survive event replay, stay account scoped, and leave the final answer unread', t => {
  const db = database(t);
  ask(db);
  const [notice] = listPendingQuestionNotifications(db,1);
  const id = questionNotificationId(notice.id);
  assert.equal(dismissQuestionNotifications(db,2,[id]),0);
  assert.equal(dismissQuestionNotifications(db,1,[id]),1);
  ask(db);
  assert.deepEqual(listPendingQuestionNotifications(db,1),[]);
  ask(db,1,'request2');
  assert.equal(listPendingQuestionNotifications(db,1).length,1);
  db.exec("UPDATE hermes_runs SET status='completed' WHERE id='run1'");
  db.prepare('INSERT INTO conversation_messages(id,conversation_id,content,updated_at) VALUES(1,1,?,?)')
    .run('Research is ready.',new Date().toISOString());
  assert.deepEqual(listPendingQuestionNotifications(db,1),[]);
  assert.equal(listPendingChatNotifications(db,1)[0].title,'Response ready');
});

test('answering, expiry, cancellation, and an abandoned runtime clear pending questions', t => {
  const db = database(t);
  ask(db);
  resolveQuestionNotification(db,2,'request1');
  assert.equal(listPendingQuestionNotifications(db,1).length,1);
  resolveQuestionNotification(db,1,'request1');
  ask(db);
  assert.deepEqual(listPendingQuestionNotifications(db,1),[]);
  ask(db,1,'expires');
  resolveQuestionNotification(db,1,'expires');
  assert.deepEqual(listPendingQuestionNotifications(db,1),[]);
  for (const status of ['completed','error','cancelled']) {
    ask(db,1,status);
    db.prepare('UPDATE hermes_runs SET status=? WHERE id=?').run(status,'run1');
    assert.deepEqual(listPendingQuestionNotifications(db,1),[]);
  }
  db.exec("UPDATE hermes_runs SET status='active', started_at='2000-01-01T00:00:00Z', heartbeat_at=NULL WHERE id='run1'");
  assert.deepEqual(listPendingQuestionNotifications(db,1),[]);
});

test('viewing a chat dismisses its questions across windows without silencing other chats', t => {
  const db = database(t);
  ask(db); ask(db,3);
  assert.equal(dismissQuestionNotifications(db,1,[],{ surface:'garden_chat',chatId:'42',gardenSlug:'wrong' }),0);
  assert.equal(dismissQuestionNotifications(db,1,[],{ surface:'dashboard_terminal',chatId:'conv_garden' }),1);
  assert.equal(listPendingQuestionNotifications(db,1).length,1);
  assert.equal(dismissQuestionNotifications(db,1,[],{ surface:'dashboard_terminal',chatId:'conv_main' }),1);
  assert.deepEqual(listPendingQuestionNotifications(db,1),[]);
});

test('temporary chats, Voice, Buzz, and messaging turns keep their existing notification exclusions', t => {
  const db = database(t);
  ask(db);
  for (const state of ["temporary=1", "origin_label='Voice'", "buzz_room_id=9", "surface='quartz_ai'"]) {
    db.exec(`UPDATE conversations SET ${state} WHERE id=1`);
    ask(db,1,`excluded-${state}`);
    assert.deepEqual(listPendingQuestionNotifications(db,1),[]);
    assert.equal(db.prepare('SELECT count(*) AS n FROM chat_question_notifications').get().n,1);
    db.exec("UPDATE conversations SET temporary=0,origin_label=NULL,buzz_room_id=NULL,surface='dashboard_terminal' WHERE id=1");
  }
  for (const [clientId,metadata] of [['telegram-turn','{}'],['message','{"deliveryChannel":"whatsapp"}'],['delegate','{"delegatedAgentRun":true}']]) {
    db.prepare('UPDATE hermes_runs SET dispatch_json=? WHERE id=?').run(JSON.stringify({clientMessageId:clientId}),'run1');
    db.prepare('INSERT OR REPLACE INTO conversation_messages(id,conversation_id,client_message_id,metadata) VALUES(1,1,?,?)').run(clientId,metadata);
    ask(db,1,`excluded-${clientId}`);
    assert.deepEqual(listPendingQuestionNotifications(db,1),[]);
    assert.equal(db.prepare('SELECT count(*) AS n FROM chat_question_notifications').get().n,1);
  }
  for (const id of ['msg_1','question_0','question_-1','question_1junk']) assert.equal(questionNotificationId(id),null);
});

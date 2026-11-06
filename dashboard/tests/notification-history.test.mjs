import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureChatNotificationSchema, listPendingChatNotifications, dismissChatNotifications, listRecentChatNotifications } from '../src/lib/chat-notifications/store.ts';
import { initializeNotificationHistory, listNotificationHistory, saveNotificationHistory, markNotificationHistoryRead, clearNotificationHistory } from '../src/lib/chat-notifications/history.ts';
import { notificationHistoryItem, parseDeliveredNotification } from '../src/lib/notification-history.ts';

function database() {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);
    CREATE TABLE clusters(id INTEGER PRIMARY KEY,slug TEXT);INSERT INTO clusters VALUES(1,'signals');
    CREATE TABLE conversations(id INTEGER PRIMARY KEY,public_id TEXT,user_id INTEGER,title TEXT,surface TEXT,
      default_garden_id INTEGER,legacy_chat_session_id INTEGER,temporary INTEGER DEFAULT 0,buzz_room_id INTEGER,origin_label TEXT);
    INSERT INTO conversations(id,public_id,user_id,title,surface,default_garden_id) VALUES
      (1,'conv_one',1,'First chat','dashboard_terminal',NULL),(2,'conv_two',2,'Other account','dashboard_terminal',NULL),
      (3,'conv_garden',1,'Canonical garden','garden_chat',1);
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,conversation_id INTEGER,client_message_id TEXT,
      role TEXT,content TEXT,status TEXT,metadata TEXT,updated_at TEXT);
    INSERT INTO conversation_messages VALUES
      (1,1,NULL,'assistant','A completed answer','complete',NULL,'2026-10-10 10:00:00'),
      (2,2,NULL,'assistant','Private to account two','complete',NULL,'2026-10-10 10:01:00'),
      (3,3,NULL,'assistant','Garden answer','complete',NULL,'2026-10-10 10:02:00');`);
  ensureChatNotificationSchema(db);return db;
}

test('an entirely seen inbox restores real history without replaying banners',()=>{
  const db=database();try {
    assert.deepEqual(listPendingChatNotifications(db,1),[]);
    dismissChatNotifications(db,1,[1,3]);
    initializeNotificationHistory(db,1,[]);
    const history=listNotificationHistory(db,1);
    assert.deepEqual(history.map(item=>item.id),['chat-notification:msg_3','chat-notification:msg_1']);
    assert.ok(history.every(item=>item.read));
    assert.deepEqual(listPendingChatNotifications(db,1),[]);
    assert.deepEqual(listNotificationHistory(db,2),[]);
    assert.deepEqual(history[0].target,{surface:'dashboard_terminal',chatId:'conv_garden'});
    assert.equal(listRecentChatNotifications(db,1).some(item=>item.id==='msg_2'),false);
  } finally {db.close();}
});

test('reading a notification retains it; clearing cannot be undone by stale delivery or bootstrap',()=>{
  const db=database();try {
    const record=listRecentChatNotifications(db,1).find(item=>item.id==='msg_1');
    saveNotificationHistory(db,1,[notificationHistoryItem(record)]);
    markNotificationHistoryRead(db,1,[],{surface:'dashboard_terminal',chatId:'conv_one'});
    saveNotificationHistory(db,1,[notificationHistoryItem(record)]);
    assert.equal(listNotificationHistory(db,1)[0].read,true);
    clearNotificationHistory(db,2,['chat-notification:msg_1']);
    assert.equal(listNotificationHistory(db,1).length,1,'account isolation');
    clearNotificationHistory(db,1,['chat-notification:msg_1']);
    saveNotificationHistory(db,1,[notificationHistoryItem(record)]);
    initializeNotificationHistory(db,1,[]);
    assert.equal(listNotificationHistory(db,1).some(item=>item.id==='chat-notification:msg_1'),false);
    clearNotificationHistory(db,1,['toast:in-flight']);
    saveNotificationHistory(db,1,[parseDeliveredNotification({id:'toast:in-flight',message:'Late POST',type:'success'})]);
    assert.equal(listNotificationHistory(db,1).some(item=>item.id==='toast:in-flight'),false);
  }finally{db.close();}
});

test('plain internal deliveries persist and replaying them neither duplicates nor reorders them',()=>{
  const db=database();try{
    const first=parseDeliveredNotification({id:'toast:import',title:'Import complete',message:'3 notes added',type:'success'});
    first.updatedAt='2026-10-10T10:00:00Z';saveNotificationHistory(db,1,[first]);
    markNotificationHistoryRead(db,1,[first.id]);
    saveNotificationHistory(db,1,[{...first,updatedAt:'2026-10-10T11:00:00Z',read:false}]);
    const history=listNotificationHistory(db,1);
    assert.equal(history.length,1);assert.equal(history[0].read,true);assert.equal(history[0].updatedAt,'2026-10-10T10:00:00.000Z');
    assert.equal(parseDeliveredNotification({id:'chat-notification:msg_2',message:'Forged',type:'success'}),null);
    assert.equal(parseDeliveredNotification({id:'website:test',message:'Forged',type:'success'}),null);
  }finally{db.close();}
});

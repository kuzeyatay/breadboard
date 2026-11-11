import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { activityRecommendationEvidence, connectionRecommendationEvidence } from '../src/lib/recommendations/activity-context.ts';
import { automationCandidate, connectionPrompt } from '../src/lib/recommendations/quality.ts';
import { evidenceRecommendations, parseRecommendations, selectRecommendations } from '../src/lib/recommendations/types.ts';
import { parseExplicitScheduleRequest } from '../src/lib/schedules/natural-language.ts';
import { parseExplicitHookRequest } from '../src/lib/hooks/natural-language.ts';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE durable_memories(id INTEGER PRIMARY KEY, user_id INTEGER, content TEXT, kind TEXT, scope TEXT, state TEXT,
      confidence REAL, created_at TEXT DEFAULT (datetime('now')), last_confirmed_at TEXT);
    CREATE TABLE scheduled_chat_jobs(id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, prompt TEXT, enabled INTEGER DEFAULT 1,
      delivery_mode TEXT, last_status TEXT, last_error TEXT, last_run_at TEXT);
    CREATE TABLE hooks(id TEXT PRIMARY KEY, user_id INTEGER, name TEXT, enabled INTEGER DEFAULT 1, last_result TEXT, last_fired_at TEXT);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY, user_id INTEGER, temporary INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY, conversation_id INTEGER, role TEXT, content TEXT, order_index INTEGER,
      created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO durable_memories(user_id,content,kind,scope,state,confidence) VALUES
      (1,'Building a breadboard power-supply module','project_fact','global','confirmed',0.8),
      (2,'Other user secret project','project_fact','global','confirmed',0.9),
      (1,'Weak guess','project_fact','global','candidate',0.2);
    INSERT INTO scheduled_chat_jobs(user_id,title,prompt,last_status,last_error,last_run_at) VALUES
      (1,'Summarize arXiv','Summarize arXiv','failed','Model quota exhausted',datetime('now','-1 hour')),
      (1,'Daily weather','check the weather','ok',NULL,datetime('now','-2 hours'));
    INSERT INTO hooks VALUES('h1',1,'Lint on save',1,'Exit 1: eslint not found',datetime('now')),('h2',1,'Fine',1,'Exit 0',datetime('now'));
  `);
  // The same opener in three chats, the same follow-up in three chats, and a
  // scheduled prompt whose own runs must not count as a habit.
  for (let id = 1; id <= 3; id++) {
    db.prepare('INSERT INTO conversations(id,user_id) VALUES(?,1)').run(id);
    db.prepare("INSERT INTO conversation_messages(conversation_id,role,content,order_index) VALUES(?,'user','Summarize the latest AI news',0),(?,'assistant','...',1),(?,'user','Save the key decisions to my notes',2)").run(id, id, id);
  }
  for (let id = 4; id <= 6; id++) {
    db.prepare('INSERT INTO conversations(id,user_id) VALUES(?,1)').run(id);
    db.prepare("INSERT INTO conversation_messages(conversation_id,role,content,order_index) VALUES(?,'user','check the weather',0)").run(id);
  }
  return db;
}

test('activity evidence covers memory, broken or fresh automations and repeated questions, for this user only', () => {
  const evidence = activityRecommendationEvidence(database(), 1);
  const ids = evidence.map(item => item.id);
  assert.ok(ids.includes('memory:1') && !ids.includes('memory:2') && !ids.includes('memory:3'));
  assert.ok(evidence.find(item => item.id === 'schedule:1').summary.includes('Model quota exhausted'));
  assert.ok(ids.includes('hook:h1') && !ids.includes('hook:h2'));
  const opener = evidence.find(item => item.id.startsWith('repeat-open:'));
  const follow = evidence.find(item => item.id.startsWith('repeat-follow:'));
  assert.equal(opener.title, 'Summarize the latest AI news');
  assert.equal(follow.title, 'Save the key decisions to my notes');
  assert.ok(!evidence.some(item => /weather/i.test(item.title) && item.id.startsWith('repeat')), 'already scheduled');
  assert.doesNotMatch(JSON.stringify(evidence), /Other user secret/);
});

test('app markers, small talk and one-off questions never become automation cards', () => {
  const db = database();
  for (let id = 10; id <= 12; id++) {
    db.prepare('INSERT INTO conversations(id,user_id) VALUES(?,1)').run(id);
    db.prepare("INSERT INTO conversation_messages(conversation_id,role,content,order_index) VALUES(?,'user','(Started a voice conversation)',0),(?,'user','Stop just tell me the answer',3)").run(id, id);
  }
  const evidence = activityRecommendationEvidence(db, 1);
  assert.doesNotMatch(JSON.stringify(evidence), /Started a voice|Stop just tell/);
  assert.equal(automationCandidate({ id: 'repeat-open:hi', source: 'schedule', title: 'Hi there how is your day going', summary: '' }), null);
});

test('automation cards are phrased so sending them creates the schedule or hook', () => {
  const schedule = automationCandidate({ id: 'repeat-open:x', source: 'schedule', title: 'Summarize the latest AI news', summary: '' });
  assert.equal(parseExplicitScheduleRequest(schedule).prompt, 'summarize the latest AI news');
  const question = automationCandidate({ id: 'repeat-open:y', source: 'schedule', title: "What's the weather in Eindhoven?", summary: '' });
  assert.ok(parseExplicitScheduleRequest(question));
  const hook = automationCandidate({ id: 'repeat-follow:z', source: 'hook', title: 'Save the key decisions to my notes', summary: '' });
  assert.equal(parseExplicitHookRequest(hook).provider, 'chat_completed');
});

test('any connected app becomes a card naming it, except apps read in depth', () => {
  const evidence = connectionRecommendationEvidence([{ slug: 'linear', name: 'Linear' }, { slug: 'gmail', name: 'Gmail' },
    { slug: 'some-new-app', name: 'Some New App' }, { slug: 'linear', name: 'Linear' }], new Set(['gmail']));
  assert.deepEqual(evidence.map(item => item.id), ['connection:linear', 'connection:some-new-app']);
  assert.match(connectionPrompt('linear', 'Linear'), /assigned to me/);
  assert.match(connectionPrompt('some-new-app', 'Some New App'), /Some New App/);
  const cards = evidenceRecommendations(evidence);
  assert.ok(cards.length > 0 && cards.every(card => /Linear|Some New App/.test(card.sourceLabel)));
});

test('cards stay until they stop applying or something clearly more useful arrives', () => {
  const chat = { id: 'chat:1', source: 'chat', title: 'Op-amp design', summary: 'Last asked: why does it oscillate? Last reply: a long answer about phase margin.' };
  const linear = { id: 'connection:linear', source: 'connection', title: 'Linear', summary: 'Linear is connected.' };
  const first = evidenceRecommendations([chat, linear]);
  assert.equal(first.length, 2);
  // A weaker newcomer does not displace anything: the four slots are not full, so it is added.
  const brokenHook = { id: 'hook:h1', source: 'hook', title: 'Lint on save', summary: 'Hook failed on its last run: Exit 1.' };
  const next = evidenceRecommendations([chat, linear, brokenHook], first);
  assert.deepEqual(next.slice(0, 2).map(card => card.prompt), first.map(card => card.prompt), 'kept cards keep their slot and wording');
  assert.equal(next.find(card => card.sourceIds.includes('hook:h1')).usefulness, 'urgent');
  // A full board: a clearly more useful card replaces the weakest one, in place.
  const full = [1, 2, 3, 4].map(index => ({ id: `connection:app${index}`, source: 'connection', title: `App ${index}`, summary: '' }));
  const board = evidenceRecommendations(full);
  assert.equal(board.length, 4);
  const upgraded = evidenceRecommendations([...full, brokenHook], board);
  assert.equal(upgraded.length, 4);
  assert.ok(upgraded.some(card => card.sourceIds.includes('hook:h1')));
  assert.equal(upgraded.filter(card => board.some(old => old.prompt === card.prompt)).length, 3);
  // Model rewording of a subject already on screen never replaces the shown wording.
  const reworded = parseRecommendations([{ prompt: 'Totally new words about the op-amp chat.', sourceIds: ['chat:1'] }], [chat]);
  const kept = selectRecommendations(reworded, [chat], first.filter(card => card.sourceIds.includes('chat:1')));
  assert.deepEqual(kept.map(card => card.prompt), first.filter(card => card.sourceIds.includes('chat:1')).map(card => card.prompt));
});

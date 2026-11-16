import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { activityRecommendationEvidence, connectionRecommendationEvidence } from '../src/lib/recommendations/activity-context.ts';
import { evidenceRecommendations, parseRecommendations, selectRecommendations } from '../src/lib/recommendations/types.ts';

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

test('only observed automation failures warrant cards, regardless of repeated chat openers and follow-ups', t => {
  const db = database();
  t.after(() => db.close());
  const evidence = activityRecommendationEvidence(db, 1);
  assert.deepEqual(new Set(evidence.map(item => item.id)), new Set(['memory:1','schedule:1','hook:h1']));
  assert.match(evidence.find(item => item.id === 'schedule:1').summary, /Model quota exhausted/);
  assert.doesNotMatch(JSON.stringify(evidence), /Other user secret|Daily weather|Asked by hand/);
  const cards = evidenceRecommendations(evidence);
  assert.deepEqual(new Set(cards.flatMap(card => card.sourceIds)), new Set(['schedule:1','hook:h1']));
  assert.ok(cards.every(card => card.usefulness === 'urgent'));
});

test('available app tools supply context and cannot fill the board alone', () => {
  const evidence = connectionRecommendationEvidence([{ slug: 'linear', name: 'Linear' }, { slug: 'gmail', name: 'Gmail' },
    { slug: 'some-new-app', name: 'Some New App' }, { slug: 'linear', name: 'Linear' }], new Set(['gmail']));
  assert.deepEqual(evidence.map(item => item.id), ['connection:linear', 'connection:some-new-app']);
  assert.deepEqual(evidenceRecommendations(evidence), []);
  const chat = {id:'chat:5',source:'chat',title:'Meridian rollout',summary:'Last asked: Which rollout blockers did Jo assign to me in Linear?'};
  const [proposal] = parseRecommendations([{prompt:'Find the Meridian rollout blockers Jo assigned me in Linear.',sourceIds:[chat.id,evidence[0].id]}],[chat,...evidence]);
  assert.deepEqual(selectRecommendations([proposal],[chat,...evidence]).map(card=>card.sourceIds),[proposal.sourceIds]);
});

test('cards stay until they stop applying or something clearly more useful arrives', () => {
  const chat = { id: 'chat:1', source: 'chat', title: 'Op-amp design', summary: 'Last asked: why does it oscillate? Last reply: a long answer about phase margin.' };
  const task = { id: 'task:1', source: 'task', title: 'Draft the workshop proposal', summary: 'Address the cost estimate.' };
  const original = parseRecommendations([{prompt:'Walk me through checking the phase margin of my op-amp design.',sourceIds:[chat.id]}], [chat]);
  const first = selectRecommendations([...original, ...evidenceRecommendations([task])], [chat, task]);
  assert.equal(first.length, 2);
  // A weaker newcomer does not displace anything: the four slots are not full, so it is added.
  const brokenHook = { id: 'hook:h1', source: 'hook', title: 'Lint on save', summary: 'Hook failed on its last run: Exit 1.' };
  const next = evidenceRecommendations([chat, task, brokenHook], first);
  assert.deepEqual(next.slice(0, 2).map(card => card.prompt), first.map(card => card.prompt), 'kept cards keep their slot and wording');
  assert.equal(next.find(card => card.sourceIds.includes('hook:h1')).usefulness, 'urgent');
  // A full board: a clearly more useful card replaces the weakest one, in place.
  const full = [1, 2, 3, 4].map(index => ({ ...chat, id: `chat:${index}`, title: `Design ${index}` }));
  const board = selectRecommendations(parseRecommendations(full.map(row => ({ prompt: `Check the phase margin of ${row.title}.`, sourceIds:[row.id] })),full),full);
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

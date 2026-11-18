import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createCrumbs } from '../src/lib/crumbs/core.ts';
import { feedHistory } from '../src/lib/crumbs/feed-history.ts';
import { rankFeed, recordFeedAction, setFeedEnabled } from '../src/lib/crumbs/feed-ranking.ts';

const now = Date.now();
const day = 86_400_000;
function database(t) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2)");
  return db;
}
function post(author, title, days = 0, key = '1') {
  const did = 'did:plc:' + author;
  const url = 'https://' + author + '.example/' + key;
  return { id: 'at://' + did + '/com.breadboard.highlight/' + key, author: { did }, target: { kind: 'page', title, url },
    title, url, comment: '', createdAt: new Date(now - days * day).toISOString(), threadCount: 1 };
}
const baking = post('baker', 'Sourdough fermentation');
const robot = post('engineer', 'Robotics actuator torque', 1);
const catalog = [baking, robot];
const interested = [{ title: 'Robotics actuator torque', at: now, weight: 2 }];

test('local activity generalizes to a different post and author, fades, and stays with its owner', t => {
  const db = database(t);
  const rank = (user, history = [], followed = []) => rankFeed(db, user, catalog, history, new Set(followed), now);
  assert.equal(rank(1)[0], baking);
  assert.equal(rank(1, interested)[0], robot);
  assert.equal(rank(2, [], [robot.author.did])[0], robot);
  const source = post('researcher', 'Robotics actuator torque');
  const event = { id: source.id, kind: 'source', title: source.title, url: source.url, author: source.author.did, text: '' };
  recordFeedAction(db, 1, event, now - 89 * day);
  assert.equal(rank(1)[0], baking);
  recordFeedAction(db, 1, event, now);
  recordFeedAction(db, 1, event, now);
  assert.equal(db.prepare('SELECT count(*) FROM crumbs_feed_feedback').pluck().get(), 1);
  assert.equal(rank(1)[0], robot);
  assert.equal(rank(2)[0], baking);
  recordFeedAction(db, 1, { ...event, kind: 'less' }, now);
  assert.equal(rank(1)[0], baking);
  recordFeedAction(db, 1, { ...event, kind: 'more' }, now);
  assert.equal(rank(1)[0], robot);
  assert.equal(db.prepare("SELECT count(*) FROM crumbs_feed_feedback WHERE kind='less'").pluck().get(), 0);
});

test('mixes authors and gives a new source a discovery slot while preserving thread context', t => {
  const db = database(t);
  const familiar = Array.from({ length: 8 }, (_, i) => post('familiar' + i, 'Robotics actuator torque', 0, String(i)));
  const root = post('newcomer', 'Sourdough fermentation');
  const reply = { ...post('reader', 'Sourdough reply'), parent: root };
  const follows = new Set(familiar.map(item => item.author.did));
  const items = rankFeed(db, 1, [...familiar, reply, root], interested, follows, now);
  assert.deepEqual(items.slice(5, 7), [reply, root]);
  assert.equal(new Set(items.map(item => item.id)).size, 10);
  const similar = post('baker', baking.title, 0, '2');
  assert.equal(rankFeed(db, 1, [baking, similar, robot], [], new Set(), now)[1], robot);
  recordFeedAction(db, 1, { id: root.id, kind: 'less', title: root.title, url: root.url, author: root.author.did, text: '' }, now);
  assert.deepEqual(rankFeed(db, 1, [reply, root], [], follows, now), []);
});

test('Everyone uses the local profile, preserves the index cursor and makes no personalized network query', async t => {
  const db = database(t);
  const requests = [];
  let reads = 0;
  const crumbs = createCrumbs({ db, readFeedHistory: async () => { reads++; return interested; },
    fetcher: async (url, init) => {
      requests.push([new URL(url).pathname, JSON.parse(init.body)]);
      return Response.json({ items: catalog.map(item => ({ uri: item.id, did: item.author.did, target: item.target, comment: '', createdAt: item.createdAt })), before: 'upstream-cursor' });
    } });
  assert.equal(crumbs.status(1).personalizeFeed, true);
  const page = await crumbs.feed(1, 'everyone');
  assert.deepEqual(page.items.map(x => x.id), [robot.id, baking.id]);
  assert.equal(page.before, 'upstream-cursor');
  await crumbs.feed(1, 'everyone', page.before);
  assert.deepEqual(requests, [['/feed', { actors: [], limit: 50 }], ['/feed', { actors: [], before: page.before, limit: 50 }]]);
  const event = { ...robot, text: '', kind: 'source' };
  crumbs.feedFeedback(1, event);
  crumbs.feedFeedback(2, event);
  crumbs.setFeedPreference(1, false);
  crumbs.feedFeedback(1, event);
  assert.deepEqual(db.prepare('SELECT user_id FROM crumbs_feed_feedback').pluck().all(), [2]);
  assert.equal(createCrumbs({ db }).status(1).personalizeFeed, false);
  assert.equal(crumbs.status(2).personalizeFeed, true);
  assert.deepEqual((await crumbs.feed(1, 'everyone')).items.map(x => x.id), catalog.map(x => x.id));
  assert.equal(reads, 2);
  assert.equal(requests.at(-1)[1].limit, 30);
  crumbs.setFeedPreference(1, true);
  assert.equal(db.prepare('SELECT count(*) FROM crumbs_feed_feedback WHERE user_id=1').pluck().get(), 0);
  assert.throws(() => crumbs.setFeedPreference(1, 'false'), { status: 400 });
});

test('turning personalization off while history is loading returns chronological order', async t => {
  const db = database(t);
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const crumbs = createCrumbs({ db, readFeedHistory: () => new Promise(resolve => { release = resolve; started(); }),
    fetcher: async () => Response.json({ items: catalog.map(item => ({ uri: item.id, did: item.author.did, target: item.target, comment: '', createdAt: item.createdAt })), before: null }) });
  const pending = crumbs.feed(1, 'everyone');
  await waiting;
  setFeedEnabled(db, 1, false);
  release(interested);
  assert.deepEqual((await pending).items.map(item => item.id), catalog.map(item => item.id));
});

test('history uses eligible owned chat titles and public visits, reflecting deletion on the next read', async t => {
  const db = database(t);
  const root = await mkdtemp(path.join(os.tmpdir(), 'crumbs-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'config'));
  const history = path.join(root, 'config/browser-history.json');
  const visit = (url, owner, title) => ({ url, visitsByUser: { [owner]: { title, visitedAt: now, days: ['mon','tue'] } } });
  await writeFile(history, JSON.stringify({ version: 1, entries: [visit(robot.url, 1, robot.title), visit(baking.url, 2, baking.title),
    visit('https://example.com/confirm?token=private', 1, 'Secret'), { url: baking.url, title: 'Unowned' }] }));
  db.exec(`CREATE TABLE conversations(user_id,title,updated_at,default_garden_id,temporary,archived_at,buzz_room_id);
    CREATE TABLE clusters(id,user_id,memory_scope); INSERT INTO clusters VALUES(2,1,'garden_only');
    INSERT INTO conversations VALUES(1,'Actuator design',datetime('now'),null,0,null,null),(1,'Temporary',datetime('now'),null,1,null,null),
    (2,'Other account',datetime('now'),null,0,null,null),(1,'Shared room',datetime('now'),null,0,null,5),(1,'Sealed',datetime('now'),2,0,null,null)`);
  assert.deepEqual((await feedHistory(db, root, 1)).map(row => row.title), [robot.title, 'Actuator design']);
  await writeFile(history, JSON.stringify({ version: 1, entries: [] }));
  db.exec('DELETE FROM conversations');
  assert.deepEqual(await feedHistory(db, root, 1), []);
});

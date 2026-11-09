import test from 'node:test';
import assert from 'node:assert/strict';
import { usefulVoiceOpeners, parseVoiceOpener } from '../src/lib/recommendations/voice-opener.ts';
import { parseRecommendations } from '../src/lib/recommendations/types.ts';
import { generateRecommendations } from './helpers/recommendation-model-fixture.mjs';
import { chooseVoiceGreeting, prepareVoiceGreeting } from '../src/lib/speech/voice-greeting-choice.ts';

const now = Date.parse('2026-11-07T10:00:00Z');
const context = { timeZone: 'UTC' };
const assessment = (changes = {}) => ({ text: 'Want to turn your lab feedback into a revision checklist?',
  reason: 'The recent email requests specific revisions to the active report.',
  relevance: 2, timeliness: 2, actionability: 2, confidence: 2, ...changes });
const evidence = [
  { id: 'mail:1', source: 'gmail', title: 'Lab feedback', summary: 'Please revise the measurements.', timestamp: '2026-11-07T09:00:00Z' },
  { id: 'task:2', source: 'task', title: 'Prepare draft', summary: 'Incomplete task' },
  { id: 'chat:3', source: 'chat', title: 'Circuit design', summary: 'Recent design discussion', timestamp: '2026-11-07T08:00:00Z' },
  { id: 'calendar:4', source: 'calendar', title: 'Lab meeting', summary: 'Scheduled tomorrow',
    calendar: { kind: 'event', start: '2026-11-08T09:00', end: '2026-11-08T10:00', status: 'upcoming' } },
];
const card = (id = 'mail:1', voice = assessment()) => ({ id, prompt: 'Help with this task.', sourceIds: [id], sourceLabel: 'Test', voice });
const ranked = (cards, sources = evidence, options = {}) => usefulVoiceOpeners(cards, sources, { ...context, ...options }, now + 180_000, now);
const storage = () => { const items = new Map(); return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) }; };

test('usefulness ranking chooses the strongest of the actual four cards, not the first or an undisplayed fifth', () => {
  const cards = [card('mail:1', assessment({ timeliness: 1 })), card('task:2'),
    card('chat:3', assessment({ relevance: 0 })), card('calendar:4', null), card('mail:1')];
  assert.deepEqual(ranked(cards).map(item => [item.id, item.score]), [['task:2', 8], ['mail:1', 7]]);
  assert.equal(ranked(cards)[0].reason, assessment().reason);
});

test('none useful is explicit: generic, weak, uncertain or unassessed cards never force a suggestion', () => {
  for (const voice of [undefined, null, assessment({ confidence: 1 }), assessment({ actionability: 1 }),
    assessment({ relevance: 1, timeliness: 1 }), assessment({ timeliness: 0 })]) {
    assert.deepEqual(ranked([card('mail:1', voice === undefined ? null : voice)]), []);
  }
  assert.deepEqual(ranked([card('invented')]), []);
});

test('malformed assessments cannot remove valid terminal cards or become spoken openers', () => {
  for (const voice of [assessment({ confidence: '2' }), assessment({ confidence: 3 }), assessment({ timeliness: NaN }),
    assessment({ text: 'I have sent the email.' }), assessment({ text: 'Open <script> now?' }),
    assessment({ text: 'Want to visit https://bad.example?' }), assessment({ reason: '' }),
    assessment({ text: `${'word '.repeat(33)}?` }), assessment({ text: 'Line one\nLine two?' })]) {
    assert.equal(parseVoiceOpener(voice), undefined);
    const parsed = parseRecommendations([card('mail:1', voice)], evidence);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].voice, undefined);
  }
});

test('stale activity and unrelated gardens cannot acquire usefulness through high model scores', () => {
  assert.deepEqual(ranked([card()], [{ ...evidence[0], timestamp: '2026-10-01T09:00:00Z' }]), []);
  assert.deepEqual(ranked([card('chat:3')], [{ ...evidence[2], timestamp: '2026-11-03T09:00:00Z' }]), []);
  assert.deepEqual(ranked([card()], [{ ...evidence[0], timestamp: undefined }]), []);
  assert.deepEqual(ranked([card()], evidence, { gardenSlug: 'math' }), []);
  assert.equal(ranked([card()], [{ ...evidence[0], gardenSlug: 'math' }], { gardenSlug: 'math' }).length, 1);
});

test('calendar invitations expire at the event transition, and far-future or ended preparation is rejected', () => {
  const event = { ...evidence[3], calendar: { ...evidence[3].calendar, start: '2026-11-07T10:01', end: '2026-11-07T11:00' } };
  const prepared = ranked([card('calendar:4')], [event]);
  assert.equal(prepared[0].expiresAt, now + 60_000);
  assert.deepEqual(ranked([card('calendar:4')], [{ ...event, calendar: { ...event.calendar, start: '2026-11-07T09:59' } }]), []);
  assert.deepEqual(ranked([card('calendar:4')], [{ ...event, calendar: { ...event.calendar, start: '2026-11-10T10:00', end: '2026-11-10T11:00' } }]), []);
  const ended = { ...event, calendar: { kind: 'event', start: '2026-11-07T06:00', end: '2026-11-07T07:00', status: 'recently-ended' } };
  assert.deepEqual(ranked([card('calendar:4')], [ended]), []);
});

test('recommendation generation assesses usefulness in the same single background call, without tools', async () => {
  let calls = 0;
  const result = await generateRecommendations({ evidence, context, model: 'selected', fetcher: async (_url, init) => {
    ++calls;
    const body = JSON.parse(init.body);
    assert.equal(body.tools, undefined);
    assert.match(body.messages[0].content, /Set voice:null/);
    assert.match(body.messages[0].content, /Being recent or appearing on screen alone/);
    return Response.json({ choices: [{ message: { content: JSON.stringify([card()]) } }] });
  } });
  assert.equal(calls, 1);
  assert.equal(result[0].voice.text, assessment().text);
  const fallback = await generateRecommendations({ evidence, context, model: 'selected', fetcher: async () => { throw Error('offline'); } });
  assert.equal(fallback.some(item => item.voice), false);
});

test('offered topics have a six-hour cooldown across openings and are isolated by account', () => {
  const store = storage();
  const make = (accountId, at = now) => ({ accountId, openers: ranked([card(), card('task:2', assessment({ text: 'Want a concrete next step for your draft?', timeliness: 1 }))]) });
  const first = chooseVoiceGreeting(make('101'), { storage: store, now });
  const second = chooseVoiceGreeting(make('101'), { storage: store, now });
  assert.equal(first, assessment().text);
  assert.equal(second, 'Want a concrete next step for your draft?');
  assert.notEqual(chooseVoiceGreeting(make('101'), { storage: store, now }), first);
  assert.equal(chooseVoiceGreeting(make('102'), { storage: store, now }), first);
  const later = now + 6 * 60 * 60_000;
  const refreshed = { accountId: '101', openers: make('101').openers.map(item => ({ ...item, expiresAt: later + 1000 })) };
  assert.equal(chooseVoiceGreeting(refreshed, { storage: store, now: later }), first);
});

test('fallback greetings exclude the previous six, survive blocked storage, and never use expired cards', () => {
  const store = storage(), recent = [];
  for (let i = 0; i < 30; i++) {
    const text = chooseVoiceGreeting(null, { storage: store, random: () => 0 });
    assert.equal(recent.slice(-6).includes(text), false);
    recent.push(text);
  }
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  const one = chooseVoiceGreeting(null, { storage: blocked, random: () => 0 });
  assert.notEqual(chooseVoiceGreeting(null, { storage: blocked, random: () => 0 }), one);
  assert.notEqual(chooseVoiceGreeting({ accountId: '103', openers: ranked([card()]) }, { storage: store, now: now + 180_001 }), assessment().text);
});

test('a slow cached read cannot hold the greeting or replace it with a late suggestion', async () => {
  const signal = new AbortController(), events = new EventTarget();
  let release, called = 0;
  const prepared = prepareVoiceGreeting({ personalized: () => true, signal: signal.signal, events, storage: storage(),
    fetcher: (_url, init) => { ++called; assert.equal(init.method, 'GET'); return new Promise(resolve => { release = resolve; }); } });
  const text = prepared.choose();
  assert.equal(typeof text, 'string');
  assert.notEqual(text, assessment().text);
  release(Response.json({ accountId: '104', openers: ranked([card()]).map(item => ({ ...item, expiresAt: Date.now() + 1000 })) }));
  await prepared.ready;
  assert.equal(called, 1);
  assert.notEqual(prepared.choose(), assessment().text);
});

test('a ready invitation is used without another request, while privacy, auth changes and cancellation suppress it', async () => {
  for (const scenario of ['ready', 'private-off', 'account-change', 'abort']) {
    let allowed = true, calls = 0;
    const controller = new AbortController(), events = new EventTarget();
    const prepared = prepareVoiceGreeting({ personalized: () => allowed, signal: controller.signal, events, storage: storage(), fetcher: async () => {
      ++calls;
      return Response.json({ accountId: String(200 + calls), openers: ranked([card()]).map(item => ({ ...item, expiresAt: Date.now() + 1000 })) });
    } });
    await prepared.ready;
    if (scenario === 'private-off') allowed = false;
    if (scenario === 'account-change') events.dispatchEvent(new Event('breadboard:auth-changed'));
    if (scenario === 'abort') controller.abort();
    assert.equal(prepared.choose() === assessment().text, scenario === 'ready');
    assert.equal(calls, 1);
  }
});

test('temporary/public/personalization-disabled surfaces and aborted openings make no recommendation request', async () => {
  for (const allowed of [false, true]) {
    const controller = new AbortController();
    if (allowed) controller.abort();
    const prepared = prepareVoiceGreeting({ personalized: () => allowed, signal: controller.signal, events: new EventTarget(),
      fetcher: async () => { assert.fail('A prohibited opening must not read personal cards'); } });
    await prepared.ready;
    assert.notEqual(prepared.choose(), assessment().text);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { CLAP_PAGES, DEFAULT_CLAP_ACTION, actionForGesturePrompt, clapInterpretationMessages, describeClapAction, parseClapAction, parseClapInterpretation, parseClapSettings } from '../src/lib/profile/clap-action.ts';
import { readClapAction, writeClapAction } from '../src/lib/profile/clap-action-store.ts';
import { executeClapMusic } from '../src/lib/profile/clap-music.ts';

test('dictation is the default; saved actions survive reads and remain account-scoped', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2);');
    assert.deepEqual(readClapAction(db, 1), DEFAULT_CLAP_ACTION);
    const saved = { prompt: 'Show me my week', action: { kind: 'page', page: 'calendar' } };
    writeClapAction(db, 1, saved);
    assert.deepEqual(readClapAction(db, 1), saved);
    assert.deepEqual(readClapAction(db, 2), DEFAULT_CLAP_ACTION);
    assert.throws(() => writeClapAction(db, 1, { prompt: 'oops', action: { kind: 'page', page: '//evil.test' } }));
    assert.deepEqual(readClapAction(db, 1), saved);
    writeClapAction(db, 1, DEFAULT_CLAP_ACTION);
    assert.deepEqual(readClapAction(db, 1), DEFAULT_CLAP_ACTION);
  } finally { db.close(); }
});

test('model output can only become a supported, bounded action', () => {
  for (const value of [
    { kind: 'shell', command: 'rm -rf /' }, { kind: 'page', page: 'https://evil.test' },
    { kind: 'page', page: 'constructor' }, { kind: 'page', page: '__proto__' },
    { kind: 'voice', command: 'extra' }, { kind: 'music', operation: 'delete-playlist' },
    { kind: 'music', operation: 'play' }, { kind: 'music', operation: 'pause', query: 'ignored task' },
    { kind: 'assistant', prompt: 'x'.repeat(1001) },
  ]) assert.equal(parseClapAction(value), null);
  assert.equal(parseClapSettings({ prompt: '', action: { kind: 'voice' } }), null);
  assert.deepEqual(parseClapInterpretation('```json\n{"action":{"kind":"assistant","prompt":"Open my calendar"}}\n```'), { action: { kind: 'assistant', prompt: 'Open my calendar' } });
  assert.equal(parseClapInterpretation('{"action":{"kind":"page","page":"calendar"}}'),null,'the model cannot replace a dynamic instruction with a fixed action');
  assert.deepEqual(parseClapInterpretation('{"clarification":"Which page should I open?"}'), { clarification: 'Which page should I open?' });
  assert.equal(parseClapInterpretation('{"action":{"kind":"voice"},"clarification":"oops"}'), null);
  assert.equal(parseClapInterpretation('not JSON'), null);
  assert.deepEqual(parseClapAction({ kind: 'assistant', prompt: 'Summarize my upcoming week' }), { kind: 'assistant', prompt: 'Summarize my upcoming week' });
});

test('the interpretation prompt keeps the user request separate and maps calendar to its real view', () => {
  const messages = clapInterpretationMessages('Please put on a random jazz song when I clap');
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content, 'Please put on a random jazz song when I clap');
  assert.match(messages[0].content, /clarification/);
  assert.equal(CLAP_PAGES.calendar.href, '/plan?view=calendar');
  assert.match(describeClapAction({ kind: 'music', operation: 'random' }), /Liked Songs/);
  assert.match(describeClapAction(DEFAULT_CLAP_ACTION.action), /dictation/);
  assert.match(describeClapAction({ kind: 'voice' }), /say hello/);
});

function musicFixture(overrides = {}) {
  const calls = [];
  const services = {
    connected: () => true,
    current: async () => ({ deviceId: 'current-device' }),
    engine: async () => ({ ready: true, deviceId: 'breadboard-device' }),
    random: () => .8,
    search: async () => [{ uri: 'spotify:track:1234567890a', name: 'First match' }, { uri: 'spotify:track:1234567890b', name: 'Second match' }],
    api: async input => {
      calls.push(input);
      if (input.method !== 'GET') return null;
      return { total: 200, items: [{ track: { uri: 'spotify:track:1234567890z', name: 'Surprise' } }] };
    },
    ...overrides,
  };
  return { calls, services };
}

test('random music samples the whole library and sends the selected track to Breadboard even when another device is active', async () => {
  const { calls, services } = musicFixture();
  assert.match(await executeClapMusic({ kind: 'music', operation: 'random' }, services), /Surprise/);
  assert.equal(calls[1].query.offset, 160, 'not restricted to the latest 50 liked songs');
  assert.deepEqual(calls.at(-1), { method: 'PUT', endpoint: '/v1/me/player/play', query: { device_id: 'breadboard-device' }, body: { uris: ['spotify:track:1234567890z'] } });
});

test('named music, random search and transport controls use their own operations', async () => {
  for (const [operation, uri] of [['play', 'spotify:track:1234567890a'], ['random', 'spotify:track:1234567890b']]) {
    const { calls, services } = musicFixture();
    await executeClapMusic({ kind: 'music', operation, query: 'jazz' }, services);
    assert.deepEqual(calls.at(-1).body, { uris: [uri] });
  }
  for (const operation of ['pause', 'resume', 'next', 'previous']) {
    const { calls, services } = musicFixture();
    await executeClapMusic({ kind: 'music', operation }, services);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, `/v1/me/player/${operation === 'resume' ? 'play' : operation}`);
  }
});

test('missing music connections, unavailable devices and empty libraries never pretend to play', async () => {
  for (const [override, error] of [
    [{ connected: () => false }, /Connect Spotify/],
    [{ engine: async () => ({ ready: false, deviceId: null }) }, /Breadboard/],
    [{ api: async () => ({ total: 0 }) }, /empty/],
    [{ search: async () => [] }, /No Spotify song/],
  ]) {
    const { services } = musicFixture(override);
    await assert.rejects(executeClapMusic({ kind: 'music', operation: 'random', ...('search' in override ? { query: 'unknown' } : {}) }, services), error);
  }
});


test('saved prompts launch standard shortcuts directly and preserve compound tasks', () => {
  for (const prompt of ['Open the voice assistant', 'Start voice mode', 'Please open my voice assistant.'])
    assert.deepEqual(actionForGesturePrompt(prompt), {kind:'voice'});
  assert.deepEqual(actionForGesturePrompt('Open my calendar'), {kind:'page',page:'calendar'});
  assert.equal(actionForGesturePrompt('Play Snap by manifest').trackUri, 'spotify:track:4EsRpVBBKiqOZ67DJj0QHF');
  for (const prompt of ['Open my calendar and summarize tomorrow', 'Open Notepad and write the date', 'Play a random song and open my calendar'])
    assert.deepEqual(actionForGesturePrompt(prompt), {kind:'assistant',prompt});
});

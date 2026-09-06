import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ClapDetector } from '../src/lib/speech/clap/detector.ts';
import { ClapPatternDetector } from '../src/lib/speech/clap/pattern.ts';
import { DEFAULT_CLAP_PREFERENCES, parseClapPreferences, trustedClapPath } from '../src/lib/speech/clap/preferences.ts';
import { readClapPreferences, writeClapPreferences } from '../src/lib/speech/clap/store.ts';
import { suggestedClapSensitivity } from '../src/lib/speech/clap/calibration.ts';

function pcm(rate, { claps = [], seconds = 4, noise = 0.0002, tone = 0, duration = 0.055, amplitude = 0.65 } = {}) {
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 * 2 - 1; };
  const samples = new Float32Array(rate * seconds);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate; let x = random() * noise + Math.sin(2 * Math.PI * 100 * t) * tone;
    for (const clap of claps) { const age = t - clap; if (age >= 0 && age < duration) x += random() * amplitude * Math.exp(-age / 0.01); }
    samples[i] = x;
  }
  return samples;
}
function run(rate, samples, block = 128, sensitivity = .55) {
  const detector = new ClapDetector(rate, sensitivity); const times = [];
  for (let from = 0; from < samples.length; from += block) for (let i = from; i < Math.min(from + block, samples.length); i++)
    if (detector.pushSample(samples[i]) === 2) times.push(detector.milliseconds);
  return { times, detector };
}

test('clap PCM works across sample rates and arbitrary worklet block boundaries', () => {
  for (const rate of [16000, 44100, 48000]) {
    const sound = pcm(rate, { claps: [1, 1.32] });
    const expected = run(rate, sound, 128).times;
    assert.equal(expected.length, 1, `rate ${rate}`);
    for (const block of [1, 37, 256, 1001]) assert.deepEqual(run(rate, sound, block).times, expected);
    assert.ok(expected[0] >= 1320 && expected[0] < 1390, 'fires after brief decay of second clap');
  }
});
test('silence, steady noise, DC, low-frequency tones and sustained bursts do not match', () => {
  for (const rate of [16000, 44100, 48000]) {
    for (const sound of [new Float32Array(rate * 3), new Float32Array(rate * 3).fill(.4), pcm(rate, { noise: .05 }), pcm(rate, { tone: .4 }), pcm(rate, { claps: [1, 1.35], tone: .3, amplitude: 0 })]) {
      assert.equal(run(rate, sound).times.length, 0);
    }
    const bursts = pcm(rate, { noise: .4 });
    for (let i = 0; i < bursts.length; i++) {
      const time = i / rate;
      if (!(time >= 1 && time < 1.25) && !(time >= 1.4 && time < 1.65)) bursts[i] = 0;
    }
    assert.equal(run(rate, bursts).times.length, 0, 'long broadband bursts fail the impulse-duration check');
  }
});
test('single clap, echoes, invalid spacing and three claps have defined behavior', () => {
  const rate = 48000;
  assert.equal(run(rate, pcm(rate, { claps: [1] })).times.length, 0);
  assert.equal(run(rate, pcm(rate, { claps: [1, 1.065] })).times.length, 0);
  assert.equal(run(rate, pcm(rate, { claps: [1, 1.8] })).times.length, 0);
  assert.equal(run(rate, pcm(rate, { claps: [1, 1.32, 1.64] })).times.length, 1);
});
test('pattern machine uses monotonic audio time, ignores echoes and enforces cooldown', () => {
  const d = new ClapPatternDetector();
  assert.equal(d.onset(1000), false); assert.equal(d.state, 'first-onset');
  assert.equal(d.onset(1080), false); assert.equal(d.state, 'waiting-for-second');
  assert.equal(d.onset(1300), true); assert.equal(d.state, 'matched');
  assert.equal(d.onset(1600), false); assert.equal(d.onset(2799), false);
  assert.equal(d.onset(2800), false); assert.equal(d.onset(3000), true);
  d.reset(); assert.equal(d.onset(4000), false); d.tick(4651); assert.equal(d.state, 'idle');
  assert.equal(d.onset(100), false, 'rewound/discontinuous clock resets');
  const single = new ClapPatternDetector('single'); assert.equal(single.onset(1000), true); assert.equal(single.onset(1100), false);
});
test('reset discards pending claps and requires a new ambient warmup', () => {
  const d = new ClapDetector(48000);
  for (const sample of pcm(48000, { claps: [1], seconds: 1.2 })) d.pushSample(sample);
  d.reset();
  assert.equal(d.accepted, 0); assert.equal(d.lastImpulseRms, 0);
  let fired = 0; for (const sample of pcm(48000, { claps: [.1, .3, 1], seconds: 1.5 })) fired += d.pushSample(sample) === 2 ? 1 : 0;
  assert.equal(fired, 0);
});
test('calibration suggests sensitivity from ambient noise and deliberate impulses', () => {
  assert.equal(suggestedClapSensitivity(.001, .08, .55), .2);
  assert.ok(suggestedClapSensitivity(.002, .025, .55) > .2);
  assert.equal(suggestedClapSensitivity(.05, .025, .55), .9);
  assert.equal(suggestedClapSensitivity(.001, NaN, .55), .55);
  assert.equal(suggestedClapSensitivity(.001, 0, .55), .55);
});
test('authenticated SQLite preferences default off, validate, migrate and isolate accounts', () => {
  const db = new Database(':memory:'); db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1),(2)');
  try {
    assert.deepEqual(readClapPreferences(db, 1), DEFAULT_CLAP_PREFERENCES);
    const p = { ...DEFAULT_CLAP_PREFERENCES, enabled: true, deviceId: 'headset', sensitivity: .8 };
    writeClapPreferences(db, 1, p); assert.deepEqual(readClapPreferences(db, 1), p);
    assert.equal(readClapPreferences(db, 2).enabled, false);
    for (const change of [{ sensitivity: NaN }, { sensitivity: 2 }, { pattern: 'triple' }, { version: 2 }, { enabled: 'yes' }, { allowConcurrentListening: 'yes' }, { allowConcurrentListening: null }, { deviceId: 'x'.repeat(257) }, { secret: true }]) assert.equal(parseClapPreferences({ ...p, ...change }), null);
    const legacy = { ...p }; delete legacy.allowConcurrentListening;
    db.prepare('UPDATE clap_controls_preferences SET preferences_json=? WHERE user_id=1').run(JSON.stringify(legacy));
    assert.deepEqual(readClapPreferences(db, 1), p, 'existing saved settings survive without opting into parallel listening');
    writeClapPreferences(db, 1, { ...p, allowConcurrentListening: true });
    assert.equal(readClapPreferences(db, 1).allowConcurrentListening, true);
    assert.equal(readClapPreferences(db, 1, 'snap').allowConcurrentListening, false);
    assert.equal(readClapPreferences(db, 2).allowConcurrentListening, false);
    db.prepare('UPDATE clap_controls_preferences SET preferences_json=? WHERE user_id=1').run('{"enabled":true}');
    assert.deepEqual(readClapPreferences(db, 1), DEFAULT_CLAP_PREFERENCES);
    for (const path of ['/notification-overlay', '/auth/login', '/embed/hello', '/workflows/teach-controller']) assert.equal(trustedClapPath(path), false);
    for (const path of ['/new-tab', '/browser', '/dashboard', '/profile']) assert.equal(trustedClapPath(path), true);
  } finally { db.close(); }
});

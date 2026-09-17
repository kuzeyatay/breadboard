import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { responseTextForSpeech } from '../src/lib/speech/response-text.ts';
import { splitSpeechPassages } from '../src/lib/speech/passages.ts';
import { applyPronunciations, parsePronunciations } from '../src/lib/speech/pronunciation.ts';

const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/speech-prosody.json', import.meta.url), 'utf8'));
for (const sample of corpus) {
  test(`spoken structure: ${sample.id}`, async () => {
    assert.equal(await responseTextForSpeech(sample.text), sample.spoken);
  });
}

test('list continuations stay with their item and existing question marks are preserved', async () => {
  assert.equal(await responseTextForSpeech('- First line\n  continues here\n- **Ready?**'), 'First line continues here.\n\nReady?');
  assert.equal(await responseTextForSpeech('> ## Quoted heading\n> Some quoted prose.\n>\n> Another paragraph.'), 'Quoted heading.\n\nSome quoted prose.\n\nAnother paragraph.');
});

test('visible code words are preserved instead of omitted or merged by Markdown cleanup', async () => {
  assert.equal(await responseTextForSpeech('Use `user_id` and `first_name`.\n\n```js\nreturn user_id + first_name;\n```\n\nKeep this final sentence.'),
    'Use user_id and first_name.\n\nreturn user_id + first_name;\n\nKeep this final sentence.');
});

test('titles, initials, dotted abbreviations, and decimals never masquerade as sentence endings', () => {
  for (const token of ['Dr.', 'Prof.', 'J.', 'U.S.', 'e.g.', 'p.m.']) {
    const text = `We spoke with ${token} ${'someone else '.repeat(10)}today.`;
    const chunks = splitSpeechPassages(text, { maxCharacters: 42 });
    assert.notEqual(chunks[0], `We spoke with ${token}`, token);
    assert.equal(chunks.join(' '), text);
  }
  const decimal = 'The number is 3.14159 and the time is 12:30 today.';
  assert.equal(splitSpeechPassages(decimal, { maxCharacters: 16 })[0], 'The number is');
  assert.equal(splitSpeechPassages('There are 3. Next comes another sentence.', { maxCharacters: 23 })[0], 'There are 3.');
});

test('long sentences split at clauses and CJK sentences need no following whitespace', () => {
  assert.equal(splitSpeechPassages('When the rain stops, we can walk to the station together.', { maxCharacters: 37 })[0], 'When the rain stops,');
  assert.equal(splitSpeechPassages('準備ができました。次の手順に進みましょう！', { maxCharacters: 16 })[0], '準備ができました。');
  assert.equal(splitSpeechPassages('She said, “Take your time.” Then she left the room.', { maxCharacters: 34 })[0], 'She said, “Take your time.”');
});

test('both provider budgets preserve text across long readings, quotes, and Unicode', () => {
  for (const limits of [{ maxCharacters: 360, maxWords: 50 }, { maxCharacters: 4000 }]) {
    for (const sample of corpus) {
      const text = Array(40).fill(sample.spoken).join('\n\n');
      const parts = splitSpeechPassages(text, limits);
      assert.ok(parts.every(part => part && part.length <= limits.maxCharacters));
      assert.ok(parts.every(part => part.split(/\s+/u).length <= (limits.maxWords ?? Infinity)));
      const normalize = value => value.replace(/\s/gu, '');
      assert.equal(normalize(parts.join('')), normalize(text));
      assert.ok(parts.every(part => !/[\uD800-\uDBFF]$/u.test(part)));
    }
  }
});

test('pronunciation corrections are literal, case sensitive, longest first, and never recursive', () => {
  const rules = 'SQL = sequel\nSQL Server = sequel server\nsequel = follow-up\nAPI = A P I\nC++ = C plus plus\nZoë = Zo-ee';
  const text = 'SQL Server uses SQL, APIs and API. C++17 and C++. Zoë knows sequel.';
  assert.equal(applyPronunciations(text, rules), 'sequel server uses sequel, APIs and A P I. C++17 and C plus plus. Zo-ee knows follow-up.');
  assert.equal(applyPronunciations('Contact us about US policy.', 'US = U S'), 'Contact us about U S policy.');
  assert.equal(applyPronunciations('breadboard', ''), 'breadboard');
  assert.equal(applyPronunciations('A', 'A = $&'), '$&');
});

test('invalid pronunciation lists cannot silently drop or duplicate words', () => {
  for (const value of ['word', 'word =', '= reading', 'a = one\na = two', 'a = <break>', 'x'.repeat(20_001), Array.from({ length: 101 }, (_, i) => `${i} = number`).join('\n')]) {
    assert.throws(() => parsePronunciations(value));
  }
  assert.deepEqual(parsePronunciations('\r\nSQL = sequel\r\n'), [{ term: 'SQL', reading: 'sequel' }]);
});

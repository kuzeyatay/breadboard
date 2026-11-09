import assert from 'node:assert/strict';
import test from 'node:test';
import { createScriptGuard } from '../src/lib/speech/script-guard.ts';

const script = 'Response ready. Chest pain after exercise. If the pain is sharp, worsens when you press on the area, and eases over a day or two, a strained muscle is the likely explanation.';

test('a faithful reading advances the position word by word and never diverges', () => {
  const guard = createScriptGuard(script);
  let transcript = '';
  for (const piece of script.match(/.{1,9}/gu)) {
    transcript += piece;
    guard.feed(transcript);
    assert.equal(guard.diverged, false);
    assert.ok(guard.position <= transcript.length + 1, 'a growing last word is not counted yet');
  }
  guard.feed(transcript + ' ');
  assert.equal(guard.complete, true);
  assert.equal(guard.position, script.length - 1);
});

test('an unrelated reply is caught within a few words and resumes at the abandoned sentence', () => {
  const guard = createScriptGuard(script);
  guard.feed('Response ready. Chest pain after exercise. Sure, I can help ');
  assert.equal(guard.diverged, true);
  assert.equal(script.slice(guard.resumeAt), 'If the pain is sharp, worsens when you press on the area, and eases over a day or two, a strained muscle is the likely explanation.');
  const opening = createScriptGuard(script);
  opening.feed('Here is the text you asked ');
  assert.equal(opening.diverged, true);
  assert.equal(opening.resumeAt, 0);
});

test('paraphrased abbreviations, spelled-out numbers, small skips and insertions are tolerated', () => {
  const numbers = createScriptGuard('The bill was $1,234.50 on 3/14/2024, e.g. about 12% more than Dr. Lee expected.');
  numbers.feed('The bill was one thousand two hundred thirty four dollars and fifty cents on March fourteenth twenty twenty four, for example about twelve percent more than Doctor Lee expected. ');
  assert.equal(numbers.diverged, false);
  assert.equal(numbers.complete, true);
  const skipped = createScriptGuard('Take the first left, then the second right, and stop.');
  skipped.feed('Take the first left, then second right, and please stop. ');
  assert.equal(skipped.diverged, false);
  assert.equal(skipped.complete, true);
});

test('extra words after the script ends count as divergence, and punctuation closes the confirmed sentence', () => {
  const guard = createScriptGuard('Your answer is ready. Open the chat to see it.');
  guard.feed('Your answer is ready. Open the chat to see it. Let me know if you need anything ');
  assert.equal(guard.diverged, true);
  assert.equal(guard.complete, true);
  assert.equal(guard.resumeAt, 'Your answer is ready. Open the chat to see it.'.length);
  const mid = createScriptGuard('First sentence here. Second sentence follows. Third one.');
  mid.feed('First sentence here. Unrelated words entirely now ');
  assert.equal(mid.diverged, true);
  assert.equal(mid.resumeAt, 'First sentence here. '.length);
});


for (const missing of ['Wait.', 'Stay warm.', 'Do not enter.', 'Keep the door closed.']) {
  test('readout cannot skip a whole middle sentence: ' + missing, () => {
    const first = 'The first sentence is complete. ';
    const last = 'Here is the next complete sentence.';
    const guard = createScriptGuard(first + missing + ' ' + last);
    guard.feed(first + last + ' ');
    assert.equal(guard.complete, false);
    assert.ok(guard.remainingWords > 0);
    assert.equal(guard.resumeAt, first.length, 'recovery begins at the omitted sentence');
  });
}

test('normal spoken abbreviations and contractions keep every sentence in order', () => {
  const guard = createScriptGuard("Dr. Lee is ready. It's going well. Meet at 3.5 p.m. tomorrow. Wait here.");
  guard.feed('Doctor Lee is ready. It is going well. Meet at three point five P M tomorrow. Wait here. ');
  assert.equal(guard.diverged, false);
  assert.equal(guard.complete, true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { pageAuthorship, pageAuthorshipStatus } from '../src/lib/page-authorship.ts';
import { markPageEdit, readQuartzMetadata } from '../src/lib/quartz-document-metadata.ts';

const body = 'word '.repeat(100); // 500 characters
const page = (fm) => `---\n${fm}\n---\n\n${body}`;
const status = (content) => pageAuthorshipStatus(readQuartzMetadata(content));

test('legacy pages infer origin from frontmatter', () => {
  assert.equal(pageAuthorship(readQuartzMetadata(page('source: "user-note"'))), 'human-written');
  assert.equal(pageAuthorship(readQuartzMetadata(page('generated_by: "chatmock"'))), 'ai-written');
  assert.equal(status(page('authorship: "human-edited"')).label, 'AI edited');
});

test('small edits keep the origin; scores follow typed, pasted and model characters', () => {
  const human = page('source: "user-note"');
  const typo = markPageEdit(human, human.replace('word', 'ward'), 'ai');
  assert.equal(status(typo).state, 'human-written');
  assert.ok(status(typo).score >= 99);

  const lesson = page('generated_by: "learn"');
  const tweaked = markPageEdit(lesson, lesson + 'mine', 'human', { typed: 4, pasted: 0, removed: 0 });
  assert.equal(status(tweaked).state, 'ai-written');

  const mixed = markPageEdit(human, human + 'x'.repeat(250), 'ai');
  assert.equal(status(mixed).state, 'ai-edited');
  assert.equal(status(mixed).score, 33);
  assert.match(status(mixed).breakdown, /Human written 67%/);
});

test('mostly pasted text with an unknown source is Unsure', () => {
  const empty = `---\nauthorship: "human-written"\n---\n\n`;
  const next = markPageEdit(empty, empty + 'p'.repeat(700) + 't'.repeat(300), 'human', { typed: 300, pasted: 700, removed: 0 });
  assert.deepEqual([status(next).state, status(next).score], ['unsure', 70]);
});

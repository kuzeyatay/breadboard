import assert from 'node:assert/strict';
import test from 'node:test';
import { pageAuthorship } from '../src/lib/page-authorship.ts';
import { markPageEdit, readQuartzMetadata } from '../src/lib/quartz-document-metadata.ts';

const page = (fm) => `---\n${fm}\n---\n\nBody\n`;
const after = (prev, editor) => readQuartzMetadata(markPageEdit(prev, prev.replace('Body', 'New'), editor)).authorship;

test('legacy pages infer origin; edits move authorship by the last editor', () => {
  assert.equal(pageAuthorship(readQuartzMetadata(page('source: "user-note"'))), 'human-written');
  assert.equal(pageAuthorship(readQuartzMetadata(page('generated_by: "chatmock"'))), 'ai-written');
  assert.equal(after(page('source: "user-note"'), 'human'), 'human-written');
  assert.equal(after(page('source: "user-note"'), 'ai'), 'ai-edited');
  assert.equal(after(page('generated_by: "learn"'), 'ai'), 'ai-written');
  assert.equal(after(page('generated_by: "learn"'), 'human'), 'human-edited');
  assert.equal(after(page('authorship: "ai-edited"'), 'human'), 'human-edited');
  assert.equal(after(page('authorship: "human-edited"'), 'ai'), 'ai-edited');
});

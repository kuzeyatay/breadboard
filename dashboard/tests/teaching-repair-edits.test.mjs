import test from 'node:test';
import assert from 'node:assert/strict';
import { teachingDraftPassages } from '../src/lib/teaching-draft-evidence.ts';
import { applyTeachingRepairResponse } from '../src/lib/teaching-repair-edits.ts';
import { reviewAndHealLesson } from '../src/lib/learn-teaching-healing.ts';

test('local passage repairs retain all untouched examples, equations, citations and frontmatter exactly', () => {
  const prefix = '---\r\ntitle: Geometry\r\n---\r\n\r\n';
  const body = 'An unnecessary advanced aside.\r\n\r\n$$V=28\\pi/3$$\r\n\r\n[[source]] 🧭 A correct worked example.';
  const markdown = prefix + body + '\r\n';
  const passages = teachingDraftPassages(markdown);
  const repaired = applyTeachingRepairResponse(JSON.stringify({ edits: [{ draftPassage: passages[1].id, replacement: 'A locally explained step.' }] }), markdown, passages,
    { immutablePrefix: prefix, immutableSuffix: '\r\n' });
  assert.equal(repaired, markdown.replace('An unnecessary advanced aside.', 'A locally explained step.'));
  const removed = applyTeachingRepairResponse(JSON.stringify({ edits: [{ draftPassage: passages[1].id, replacement: '' }] }), markdown, passages);
  assert.equal(removed, markdown.replace('An unnecessary advanced aside.', ''));
});

test('edits resolve against one candidate and cannot overlap, use stale IDs or cross edit boundaries', () => {
  const markdown = 'Protected introduction.\n\nOriginal middle.\n\nProtected ending.';
  const p = teachingDraftPassages(markdown);
  const scope = { immutablePrefix: 'Protected introduction.\n\n', immutableSuffix: '\n\nProtected ending.' };
  const valid = { draftPassage: p[1].id, replacement: 'New middle.' };
  const apply = edits => applyTeachingRepairResponse(JSON.stringify({ edits }), markdown, p, scope);
  assert.equal(apply([valid]), markdown.replace('Original middle.', 'New middle.'));
  assert.equal(apply([{ originalText: 'Original', replacement: 'Corrected' }]), markdown.replace('Original', 'Corrected'));
  for (const edits of [
    [{ ...valid, draftPassage: p[0].id }],
    [{ ...valid, through: p[2].id }],
    [{ ...valid, draftPassage: teachingDraftPassages('old')[0].id }],
    [{ ...valid, through: p[0].id }],
    [valid, valid],
    [{ originalText: 'missing', replacement: '' }],
    [{ originalText: 'Protected', replacement: '' }],
    [{ ...valid, originalText: 'Original middle.' }],
  ]) assert.throws(() => apply(edits));
  assert.throws(() => applyTeachingRepairResponse('{bad JSON', markdown, p), /invalid edit JSON/);
  assert.throws(() => applyTeachingRepairResponse('{"markdown":"unreviewed"}', markdown, p), /exact edits/);
});

test('multiple edits use original offsets and preserve everything between them', () => {
  const markdown = 'Short.\n\n$$a+b$$\n\nMuch longer original ending.';
  const p = teachingDraftPassages(markdown);
  assert.equal(applyTeachingRepairResponse(JSON.stringify({ edits: [
    { draftPassage: p[2].id, replacement: 'End.' },
    { draftPassage: p[0].id, replacement: 'A much longer new introduction.' },
  ] }), markdown, p), 'A much longer new introduction.\n\n$$a+b$$\n\nEnd.');
});

test('surplus edit closers recover without changing quoted equations or untouched text', () => {
  const markdown = 'First explanation.\n\n$$a+b$$\n\nLast explanation.';
  const passages = teachingDraftPassages(markdown);
  for (const locator of ['originalText', 'draftPassage']) {
    const edits = [
      { [locator]: locator === 'originalText' ? 'First explanation.' : passages[0].id, replacement: 'Use \\(e^{st}\\), with "quoted } ]" text.' },
      { [locator]: locator === 'originalText' ? 'Last explanation.' : passages[2].id, replacement: 'Then finish.' },
    ];
    const raw = '{"edits":[' + edits.map(edit => JSON.stringify(edit) + '}').join(',') + ']}';
    assert.equal(applyTeachingRepairResponse('```json\n' + raw + '\n```', markdown, passages),
      edits[0].replacement + '\n\n$$a+b$$\n\nThen finish.');
  }
});

test('JSON recovery still rejects incomplete, ambiguous, stale and out-of-scope repairs', () => {
  const markdown = 'Protected.\n\nMiddle.\n\nEnding.';
  const passages = teachingDraftPassages(markdown);
  const scope = { immutablePrefix: 'Protected.\n\n', immutableSuffix: '\n\nEnding.' };
  const edit = { originalText: 'Middle.', replacement: 'Updated.' };
  const valid = JSON.stringify({ edits: [edit] });
  for (const raw of [valid.slice(0, -1), valid + valid, '{"edits":[' + JSON.stringify(edit), valid + ' extra prose']) {
    assert.throws(() => applyTeachingRepairResponse(raw, markdown, passages, scope), /invalid edit JSON/);
  }
  for (const invalid of [
    { originalText: 'Protected.', replacement: '' },
    { draftPassage: 'stale-id', replacement: '' },
    { ...edit, unauthorized: true },
  ]) {
    const raw = '{"edits":[' + JSON.stringify(invalid) + '}]}';
    assert.throws(() => applyTeachingRepairResponse(raw, markdown, passages, scope));
  }
});

test('the shared loop reviews the complete page after an exact local repair and retains the accepted examples', async () => {
  const markdown = 'Use an unexplained operator.\n\n$$V=28\\pi/3$$\n\n[[source]] A complete numerical example.';
  const lesson = { title: 'Geometry', learningQuestion: 'Use geometry', newConcepts: [], assumedBackground: [], taughtLater: [], earlierLessons: [], sources: [] };
  const calls = [];
  const clean = { terms: [], concepts: [], results: [], restatements: [], callouts: [], reteaching: [], flow: [] };
  const result = await reviewAndHealLesson({ markdown, lesson, request: async request => {
    const payload = JSON.parse(request.user); calls.push(payload);
    if (request.kind === 'heal') {
      assert.equal(payload.repairMode, 'passage_edits');
      return '{"edits":[' + JSON.stringify({ draftPassage: payload.draftPassages[0].id, replacement: 'A step with its meaning explained.' }) + '}]}';
    }
    return JSON.stringify({ ...clean, flow: request.round === 0 ? [{ sentence: 'Use an unexplained operator.', missingStep: 'The operator has not been introduced.' }] : [] });
  } });
  assert.equal(result.accepted, true);
  assert.equal(result.repairCount, 1);
  assert.equal(result.markdown, markdown.replace('Use an unexplained operator.', 'A step with its meaning explained.'));
  assert.equal(calls[2].pageMarkdown, result.markdown);
  assert.notEqual(calls[2].draftPassages[0].id, calls[0].draftPassages[0].id);
});

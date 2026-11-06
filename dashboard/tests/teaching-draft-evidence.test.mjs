import test from 'node:test';
import assert from 'node:assert/strict';
import { teachingDraftPassages, resolveTeachingDraftEvidence } from '../src/lib/teaching-draft-evidence.ts';
import { reviewAndHealLesson } from '../src/lib/learn-teaching-healing.ts';
import { validateTeachingFindings } from '../src/lib/teaching-review-contract.ts';

test('passage references preserve exact math, Unicode and CRLF without copying or normalization', () => {
  const markdown = 'An ordered pair has two entries.\r\n\r\n$$\r\nA\\times B=\\{(a,b)\\mid a\\in A,b\\in B\\}.\r\n$$\r\n\r\nThe bar means “such that.”';
  const passages = teachingDraftPassages(markdown);
  const review = { planCoverage: [{ quote: { draftPassage: passages[1].id } }] };
  const resolved = resolveTeachingDraftEvidence(review, markdown, passages);
  assert.equal(resolved.planCoverage[0].quote, passages[1].text);
  assert.ok(resolved.planCoverage[0].quote.includes('\\times'));
  assert.ok(resolved.planCoverage[0].quote.includes('\r\n'));
  assert.deepEqual(review.planCoverage[0].quote, { draftPassage: passages[1].id }, 'do not mutate the retained raw review');
});

test('a range includes every intervening passage, including text the reviewer previously omitted', () => {
  const markdown = 'Define A and B.\n\nThe vertical bar means such that.\n\nNow use R squared.';
  const passages = teachingDraftPassages(markdown);
  const resolved = resolveTeachingDraftEvidence({ flow: [{ sentence: { draftPassage: passages[0].id, through: passages[2].id } }] }, markdown, passages);
  assert.equal(resolved.flow[0].sentence, markdown);
  assert.throws(() => validateTeachingFindings([{ code: 'gap', evidence: ['Define A and B.\n\nNow use R squared.'] }], markdown));
});

test('unknown, stale, reversed and conflicting references fail closed', () => {
  const markdown = 'First passage.\n\nSecond passage.';
  const passages = teachingDraftPassages(markdown);
  for (const ref of [
    { draftPassage: 'invented' },
    { draftPassage: teachingDraftPassages('Changed.')[0].id },
    { draftPassage: passages[1].id, through: passages[0].id },
    { draftPassage: passages[0].id, text: 'Invented evidence' },
  ]) assert.throws(() => resolveTeachingDraftEvidence({ results: [{ sentence: ref }] }, markdown, passages));
});

test('string locators resolve exact current passages without weakening evidence validation', () => {
  const markdown = 'First definition.\r\n\r\n$$a+b$$\r\n\r\nA worked use.';
  const p = teachingDraftPassages(markdown);
  const raw = { planCoverage: [{ quote: `${p[0].id} through ${p[2].id}` }],
    flow: [{ sentence: p[1].id, missingStep: p[1].id }],
    terms: [{ priorExplanation: { pageId: 'prior', quote: p[1].id } }] };
  const resolved = resolveTeachingDraftEvidence(raw, markdown, p);
  assert.equal(resolved.planCoverage[0].quote, markdown);
  assert.equal(resolved.flow[0].sentence, p[1].text);
  assert.equal(resolved.flow[0].missingStep, p[1].id);
  assert.equal(resolved.terms[0].priorExplanation.quote, p[1].id);
  assert.equal(raw.planCoverage[0].quote, `${p[0].id} through ${p[2].id}`);
  for (const locator of [teachingDraftPassages('Old revision')[0].id, `${p[2].id} through ${p[0].id}`, 'p999-0000000000']) {
    assert.throws(() => resolveTeachingDraftEvidence({ flow: [{ sentence: locator }] }, markdown, p), /unknown, stale or reversed/);
  }
  const invented = `${p[0].id}, ${p[2].id}`;
  const unchanged = resolveTeachingDraftEvidence({ flow: [{ sentence: invented }] }, markdown, p);
  assert.equal(unchanged.flow[0].sentence, invented);
  assert.throws(() => validateTeachingFindings([{ code: 'gap', evidence: [unchanged.flow[0].sentence] }], markdown));
});

test('only draft evidence is resolved; earlier-lesson proof and explanatory prose cannot borrow draft evidence', () => {
  const markdown = 'A function gives an output.';
  const passages = teachingDraftPassages(markdown);
  const ref = { draftPassage: passages[0].id };
  const resolved = resolveTeachingDraftEvidence({ terms: [{ sentence: ref, missing: ref, priorExplanation: { pageId: 'earlier', quote: ref } }],
    restatements: [{ sentences: [ref, 'literal evidence'] }] }, markdown, passages);
  assert.equal(resolved.terms[0].sentence, markdown);
  assert.deepEqual(resolved.terms[0].priorExplanation.quote, ref);
  assert.deepEqual(resolved.terms[0].missing, ref);
  assert.deepEqual(resolved.restatements[0].sentences, [markdown, 'literal evidence']);
});

test('the shared loop turns referenced findings into exact quotes, repairs content and reviews fresh passages', async () => {
  const original = 'Use the basis.\n\n$$\\mathbf v=2\\mathbf e_1$$';
  const healed = 'A basis gives directions.\n\nTwice (1,0) is (2,0).';
  const lesson = { title: 'Basis', learningQuestion: 'Use a basis', newConcepts: ['basis'], assumedBackground: [], taughtLater: [], earlierLessons: [], sources: [],
    teachingPlan: { requiredCoverage: ['basis'], constraints: [], steps: [] } };
  const requests = [];
  let firstId;
  const result = await reviewAndHealLesson({ markdown: original, lesson,
    request: async request => {
      const data = JSON.parse(request.user); requests.push(data);
      if (request.kind === 'heal') {
        assert.equal(data.failedProblems[0].evidence[0], 'Use the basis.');
        return healed;
      }
      const id = data.draftPassages[0].id;
      const broken = data.pageMarkdown === original;
      if (broken) firstId = id;
      else assert.notEqual(id, firstId, 'repaired text invalidates previous passage IDs');
      return JSON.stringify({ terms: [], concepts: [], results: [], restatements: [], callouts: [], reteaching: [],
        flow: broken ? [{ sentence: { draftPassage: id }, missingStep: 'Introduce the directions before using the basis.' }] : [],
        planCoverage: [{ item: 'basis', status: broken ? 'missing' : 'taught', quote: { draftPassage: id }, missingStep: broken ? 'Define the directions.' : '' }], contractIssues: [] });
    } });
  assert.equal(result.accepted, true);
  assert.equal(result.repairCount, 1);
  assert.equal(result.markdown, healed);
  assert.deepEqual(requests.map(r => r.task), ['review_lesson_terms', 'heal_lesson_foundations', 'review_lesson_terms']);
});

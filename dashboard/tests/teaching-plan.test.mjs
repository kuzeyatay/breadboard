import test from 'node:test';
import assert from 'node:assert/strict';
import { isDocumentStructureRequest, isTeachingCandidate, preservesLiteralTeachingText, parseTeachingPlan, teachingReviewHash, TEACHING_PLAN_VERSION } from '../src/lib/teaching-plan.ts';
import { teachingCoverageProblems, teachingLengthProblems, validateTeachingFindings } from '../src/lib/teaching-review-contract.ts';
import { reviewAndHealLesson } from '../src/lib/learn-teaching-healing.ts';
import { explanationIntent } from '../src/lib/conversations/explanation-intent.ts';

const rawPlan = { applicable: true, reason: 'Instructional writing', objective: 'Use a coordinate pair', background: ['addition'],
  constraints: ['No subsections'], requiredCoverage: ['ordered pairs', 'basis'], steps: [
    { id: 'pairs', buildsOn: [], establishes: 'ordered pairs', workedUse: '(2,3)', transition: 'How can directions express the pair?' },
    { id: 'basis', buildsOn: ['pairs'], establishes: 'basis', workedUse: '(2,3) = 2(1,0) + 3(0,1)', transition: '' },
  ] };
const plan = parseTeachingPlan(JSON.stringify(rawPlan));
const clean = markdown => ({ terms: [], concepts: [], results: [], restatements: [], callouts: [], reteaching: [], flow: [],
  planCoverage: plan.requiredCoverage.map(item => ({ item, status: 'taught', quote: markdown, missingStep: '' })), contractIssues: [] });
const lesson = { title: 'Coordinates', learningQuestion: plan.objective, teachingPlan: plan, newConcepts: plan.requiredCoverage,
  assumedBackground: plan.background, taughtLater: [], earlierLessons: [], sources: [] };

test('teaching plans recover surplus JSON closers without changing quoted math or coverage', () => {
  const input = { ...rawPlan, constraints: ['Keep {x} and [y] and "quoted" text.'] };
  const json = JSON.stringify(input);
  const expected = parseTeachingPlan(json);
  for (const raw of [json + '}', json + ']}', '```json\n' + json + '}\n```',
    'Here is the plan:\n' + json,
    json.replace('},{"id":"basis"', '}},{"id":"basis"')]) {
    assert.deepEqual(parseTeachingPlan(raw), expected);
  }
  assert.equal(parseTeachingPlan('{"applicable":false}}'), null);
});

test('JSON recovery still rejects ambiguous, truncated and incomplete teaching plans', () => {
  const json = JSON.stringify(rawPlan);
  for (const raw of [json + '\n' + json, json + '\nextra answer', json.slice(0, -10),
    '{"broken":' + json, JSON.stringify({ ...rawPlan, requiredCoverage: [] }) + '}',
    'null', '[]', '{"applicable":"false"}']) {
    assert.throws(() => parseTeachingPlan(raw), raw);
  }
});

test('document topic inventories keep reading order without becoming teaching requests', () => {
  for (const request of [
    'scan every topic in thid makrdown and reply to me with a topic chain, how this markdown develops ideas. the topic chain must be in the reading order',
    'List the concepts in this document in reading order.',
    'Scan every topic in this lesson and give me a topic outline.',
    'Create a table of contents for this markdown.',
    'How does this chapter progress? Give me a topic map.',
    'List the headings and sections in this article.',
  ]) {
    assert.equal(isDocumentStructureRequest(request), true, request);
    assert.equal(isTeachingCandidate(request, 'Teach the underlying circuit concepts.'), false, request);
    assert.deepEqual(explanationIntent(request, true, 'A beginner lesson'), { candidate: false, repair: false }, request);
  }
});

test('topic-map wording cannot bypass an explicit teaching request or leak from attached text', () => {
  for (const request of [
    'Give me a topic chain, then explain every concept from first principles.',
    'Teach me the concepts in this markdown in reading order.',
    'Create a beginner lesson with a topic chain.',
    'Give me a topic chain with worked examples.',
    'Give me a topic chain including numerical examples.',
    'Derive the equations in this document in reading order.',
    'Rewrite this lesson in reading order.',
    'Solve the exercises in this document in reading order.',
    'Walk me through each concept in this markdown in reading order.',
    'Explain circuit laws. <document>Give me a topic chain.</document>',
    '> List every topic in reading order.\n\nExplain the circuit.',
    'Explain the phrase "topic chain".',
    'What does this equation mean?',
  ]) assert.equal(isDocumentStructureRequest(request), false, request);
});

test('EM1 educational authoring and scoped follow-ups are admitted independently of action verbs', () => {
  for (const request of [
    'Write a beginner lesson explaining Cartesian coordinates',
    'Rewrite this lesson so a beginner can understand it',
    'add a new markdown, combining these two viewpoints, use the introduction almost exactly as is and enrich it; miss no concept; someone with minimal prior knowledge must understand it',
  ]) {
    assert.equal(isTeachingCandidate(request), true, request);
    assert.equal(explanationIntent(request).candidate, true, request);
  }
  assert.equal(isTeachingCandidate('move the explanation to the later passage', 'a beginner lesson'), true);
});

test('literal text and noneducational actions are not rewritten', () => {
  for (const request of ['Save this to my garden', 'create a new markdown with that', 'Translate this lesson into Turkish',
    'Copy the explanation verbatim', 'Return JSON only; do not explain', 'Create an image of this']) {
    assert.equal(isTeachingCandidate(request), false, request);
  }
  assert.equal(preservesLiteralTeachingText('use these notes almost exactly as is and enrich the explanation'), false);
  assert.equal(isTeachingCandidate('Write a birthday greeting'), false);
  assert.equal(isTeachingCandidate('Delete the file'), false);
});

test('EC2 full-body revision does not become an exact save because checklist labels are verbatim', () => {
  const request = 'Review and propose the corrected network-analysis lesson. I authorize a complete body revision in place. Copy the requiredCoverage labels verbatim in the internal review.';
  assert.equal(preservesLiteralTeachingText(request), false);
  assert.equal(isTeachingCandidate(request), true);
  assert.equal(preservesLiteralTeachingText('Save this lesson exactly as written; do not make a full-body revision.'), true);
  assert.equal(preservesLiteralTeachingText('Review this lesson, then save it verbatim without changes.'), true);
});

test('a plan cannot use a later step, omit coverage, or duplicate step identifiers', () => {
  assert.equal(plan.version, TEACHING_PLAN_VERSION);
  for (const value of [
    { ...rawPlan, requiredCoverage: [] },
    { ...rawPlan, steps: [{ ...rawPlan.steps[0], buildsOn: ['basis'] }, rawPlan.steps[1]] },
    { ...rawPlan, steps: [rawPlan.steps[0], rawPlan.steps[0]] },
    { ...rawPlan, priorLessonPageIds: ['prior', 'prior'] },
    { ...rawPlan, priorLessonPageIds: [42] },
  ]) assert.throws(() => parseTeachingPlan(JSON.stringify(value)));
  assert.equal(parseTeachingPlan('{"applicable":false}'), null);
});

test('coverage requires an actual draft quote for every required concept', () => {
  const draft = 'A pair records two numbers. A basis lets us express the pair uniquely.';
  assert.deepEqual(teachingCoverageProblems(clean(draft), plan, draft), []);
  const bad = clean(draft); bad.planCoverage[0].quote = 'Invented evidence';
  assert.throws(() => teachingCoverageProblems(bad, plan, draft));
  bad.planCoverage = []; assert.throws(() => teachingCoverageProblems(bad, plan, draft));
  const missing = clean(draft); missing.planCoverage[1] = { item: 'basis', status: 'missing', quote: 'A basis', missingStep: 'Show how two scaled directions reproduce the pair.' };
  assert.equal(teachingCoverageProblems(missing, plan, draft)[0].code, 'missing-teaching-coverage');
});

test('reported flow obstacles must quote the draft; length limits have no universal default', () => {
  assert.throws(() => validateTeachingFindings([{ code: 'broken-learning-sequence', message: 'Supply a bridge', hard: true, evidence: ['Invented sentence'] }], 'Real sentence'));
  assert.deepEqual(teachingLengthProblems(plan, 'Short.'), []);
  assert.equal(teachingLengthProblems({ ...plan, constraints: ['Use 20–30 words.'] }, 'Short.')[0].code, 'requested-teaching-length');
  assert.equal(teachingLengthProblems({ ...plan, constraints: ['At most 2 words.'] }, 'Three plain words.').length, 1);
});

test('a bad quotation is corrected with its rejected review before any content repair', async () => {
  const draft = 'Express the pair using a basis.';
  const repaired = 'A pair (2,3) records two numbers. The basis (1,0), (0,1) gives (2,3) = 2(1,0) + 3(0,1).';
  const badReview = { ...clean(draft), flow: [{ sentence: 'Use a basis to express the pair.', missingStep: 'Show which directions the basis supplies and how their multiples make the pair.' }] };
  const requests = [];
  const result = await reviewAndHealLesson({ markdown: draft, lesson,
    request: async request => {
      requests.push(request);
      if (request.kind === 'heal') return repaired;
      if (requests.length === 1) return JSON.stringify(badReview);
      if (requests.length === 2) {
        const retry = JSON.parse(request.user);
        assert.match(retry.previousReviewRejected, /finding 1 \(broken-learning-sequence\)/);
        assert.match(retry.previousReviewRejected, /Use a basis to express the pair/);
        assert.deepEqual(JSON.parse(retry.previousReviewToCorrect), badReview);
        return JSON.stringify({ ...badReview, flow: [{ ...badReview.flow[0], sentence: draft }] });
      }
      return JSON.stringify(clean(repaired));
    } });
  assert.equal(result.accepted, true);
  assert.equal(result.repairCount, 1);
  assert.equal(result.markdown, repaired);
  assert.deepEqual(requests.map(r => r.kind), ['review', 'review', 'heal', 'review']);
  assert.equal(JSON.parse(requests[2].user).failedProblems[0].code, 'broken-learning-sequence');
});

test('internal review and repair treat the outer authoring command as quoted context', async () => {
  const authoring = 'Read Garden tools, get a receipt, and create the proposal. If tools are unavailable, return an error.';
  const draft = 'Use the basis.';
  const repaired = 'A basis supplies directions. Twice (1,0) is (2,0).';
  const result = await reviewAndHealLesson({ markdown: draft, lesson: { ...lesson, learnerRequest: authoring },
    request: async request => {
      const data = JSON.parse(request.user);
      assert.equal(data.learnerRequest, undefined);
      assert.equal(data.quotedAuthoringContext, authoring);
      assert.ok(data.activeStageTask.includes('internal'));
      if (request.kind === 'heal') return repaired;
      const review = clean(data.pageMarkdown);
      if (data.pageMarkdown === draft) review.flow = [{ sentence: draft, missingStep: 'Explain the directions first.' }];
      return JSON.stringify(review);
    } });
  assert.equal(result.accepted, true);
  assert.equal(result.markdown, repaired);
});

test('harmless forward orientation and unavailable background evidence are distinguished', async () => {
  const draft = 'A pair records two numbers. A basis gives directions. Later we study curves.';
  const reviewed = await reviewAndHealLesson({ markdown: draft, lesson,
    request: async () => JSON.stringify({ ...clean(draft), terms: [{ term: 'curves', status: 'named_later', laterUnit: true }] }) });
  assert.equal(reviewed.accepted, true);
  const bad = { ...clean(draft), terms: [{ term: 'basis', status: 'taught_earlier', sentence: 'A basis gives directions.', priorExplanation: { pageId: 'nonexistent', quote: 'A made-up explanation that cannot be verified.' } }] };
  const rejected = await reviewAndHealLesson({ markdown: draft, lesson, maxRepairs: 0, request: async () => JSON.stringify(bad) });
  assert.equal(rejected.accepted, false);
});

test('all invalid finding, coverage and constraint quotes are reported in one review retry', async () => {
  const draft = 'A pair records two numbers. A basis expresses the pair uniquely.';
  const bad = clean(draft);
  bad.flow = [
    { sentence: 'Unquoted pair sentence', missingStep: 'Explain the entries.' },
    { sentence: 'Unquoted basis sentence', missingStep: 'Show the directions.' },
  ];
  bad.planCoverage[0].quote = 'Invented pair coverage';
  bad.planCoverage[1].quote = 'Invented basis coverage';
  bad.contractIssues = [{ quote: 'Invented constraint quote', problem: 'Check the requested format.' }];
  const attempts = [];
  let calls = 0;
  const result = await reviewAndHealLesson({ markdown: draft, lesson,
    onReviewAttempt: attempt => attempts.push(attempt),
    request: async request => {
      assert.equal(request.kind, 'review', 'invalid evidence must not rewrite the content');
      if (++calls === 1) return JSON.stringify(bad);
      const retry = JSON.parse(request.user);
      for (const quote of ['Unquoted pair sentence', 'Unquoted basis sentence', 'Invented pair coverage', 'Invented basis coverage', 'Invented constraint quote']) {
        assert.ok(retry.previousReviewRejected.includes(quote), quote);
      }
      assert.deepEqual(JSON.parse(retry.previousReviewToCorrect), bad);
      return JSON.stringify(clean(draft));
    } });
  assert.equal(result.accepted, true);
  assert.equal(result.markdown, draft);
  assert.equal(result.repairCount, 0);
  assert.equal(attempts.length, 2);
  assert.ok(attempts[0].error);
  assert.equal(attempts[1].error, undefined);
  assert.deepEqual(JSON.parse(attempts[0].raw), bad);
});

test('malformed coverage entries fail with actionable diagnostics', () => {
  const draft = 'A pair records two numbers.';
  const review = clean(draft);
  review.planCoverage[0] = null;
  review.planCoverage[1] = { item: 'basis', status: 'missing', quote: draft, missingStep: null };
  assert.throws(() => teachingCoverageProblems(review, plan, draft), error =>
    error.message.includes('planCoverage[0]') && error.message.includes('planCoverage[1]') && !(error instanceof TypeError));
});

test('review rejects a prerequisite moved later and independently checks the repaired complete text', async () => {
  const draft = 'Use a basis now. Ordered pairs and bases are explained later.';
  const repaired = 'A pair records two numbers. A basis gives directions: (2,3) = 2(1,0) + 3(0,1).';
  const calls = [];
  const result = await reviewAndHealLesson({ markdown: draft, lesson, request: async call => {
    const data = JSON.parse(call.user); calls.push(data);
    if (call.kind === 'heal') return repaired;
    const review = clean(data.pageMarkdown);
    if (data.pageMarkdown === draft) review.flow = [{ sentence: 'Use a basis now.', missingStep: 'Establish basis vectors before relying on them.' }];
    return JSON.stringify(review);
  } });
  assert.equal(result.accepted, true);
  assert.equal(result.markdown, repaired);
  assert.deepEqual(calls.map(c => c.task), ['review_lesson_terms', 'heal_lesson_foundations', 'review_lesson_terms']);
  assert.equal(calls[2].pageMarkdown, repaired);
});

test('repairs cannot escape a passage, remove references, or exceed three rounds', async () => {
  const scoped = { ...lesson, editScope: { immutablePrefix: 'BEFORE\n', immutableSuffix: '\nAFTER' } };
  let repairs = 0;
  const result = await reviewAndHealLesson({ markdown: 'BEFORE\nBroken. [[source]]\nAFTER', lesson: scoped, maxRepairs: 100,
    request: async call => {
      if (call.kind === 'heal') { repairs++; return 'CHANGED\nA pair and basis.\nAFTER'; }
      const data = JSON.parse(call.user); const review = clean(data.pageMarkdown);
      if (repairs === 0) review.flow = [{ sentence: 'Broken.', missingStep: 'Supply the missing argument.' }];
      return JSON.stringify(review);
    } });
  assert.equal(result.accepted, false); assert.equal(repairs, 3);
  assert.ok(result.problems.some(p => p.code === 'teaching-edit-scope'));
  assert.ok(result.problems.some(p => p.code === 'missing-teaching-reference'));
});

test('cancellation stops publication and acceptance is tied to content, plan and evidence', async () => {
  const controller = new AbortController();
  await assert.rejects(reviewAndHealLesson({ markdown: 'Draft', lesson, signal: controller.signal,
    request: async () => { controller.abort(); return JSON.stringify(clean('Draft')); } }), /abort/i);
  const original = teachingReviewHash('Draft', { plan, sources: ['original'] });
  for (const [text, context] of [['Edited', { plan, sources: ['original'] }], ['Draft', { plan, sources: ['changed'] }],
    ['Draft', { plan: { ...plan, constraints: ['Different scope'] }, sources: ['original'] }]]) assert.notEqual(teachingReviewHash(text, context), original);
});

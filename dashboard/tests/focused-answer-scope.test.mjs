import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeFocusedAnswerFindings } from '../src/lib/focused-answer-scope.ts';
import { reviewAndHealLesson } from '../src/lib/learn-teaching-healing.ts';

const problems = [
  { code: 'missing-teaching-coverage', hard: true, message: 'Include a high-pass example.', evidence: ['Filters change gain with frequency.'] },
  { code: 'teaching-contract', hard: true, message: 'The draft reverses the meaning of gain.', evidence: ['Gain is input divided by output.'] },
];
const input = { userRequest: 'Where are Bode plots used and how do they relate to the s-domain?',
  markdown: 'Filters change gain with frequency. Gain is input divided by output.', problems };
const decision = (index, required) => ({ index, required, reason: required ? 'A factual error affects the answer.' : 'The user asked for representative uses, not this particular example.' });

test('only explicitly adjudicated optional findings are removed and the scope packet excludes the plan', async () => {
  const attempts = [];
  const result = await scopeFocusedAnswerFindings({ ...input,
    onAttempt: attempt => attempts.push(attempt), complete: async call => {
      const packet = JSON.parse(call.user);
      assert.equal(packet.userRequest, input.userRequest);
      assert.equal(packet.draft, input.markdown);
      assert.equal(packet.teachingPlan, undefined);
      assert.deepEqual(packet.findings.map(item => item.index), [0, 1]);
      return JSON.stringify({ decisions: [decision(1, true), decision(0, false)] });
    } });
  assert.deepEqual(result, [problems[1]]);
  assert.equal(result[0], problems[1]);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].error, undefined);
});

test('missing, duplicate, malformed and out-of-range decisions never waive a finding', async () => {
  for (const response of ['invalid json', {}, { decisions: [] },
    { decisions: [decision(0, false), decision(0, false)] },
    { decisions: [decision(0, false), decision(2, false)] },
    { decisions: [decision(0, false), { ...decision(1, false), required: 'false' }] },
    { decisions: [decision(0, false), { ...decision(1, false), reason: '' }] },
    { decisions: [decision(0, false), null] },
  ]) {
    const attempts = [];
    const result = await scopeFocusedAnswerFindings({ ...input, onAttempt: attempt => attempts.push(attempt),
      complete: async () => typeof response === 'string' ? response : JSON.stringify(response) });
    assert.equal(result, problems);
    assert.ok(attempts[0].error);
  }
  assert.equal(await scopeFocusedAnswerFindings({ ...input, complete: async () => { throw new Error('Provider unavailable'); } }), problems);
});

test('scope checking is unnecessary without findings or a known user request and remains cancellable', async () => {
  const complete = async () => { throw new Error('Must not call'); };
  assert.deepEqual(await scopeFocusedAnswerFindings({ ...input, problems: [], complete }), []);
  assert.equal(await scopeFocusedAnswerFindings({ ...input, userRequest: '', complete }), problems);
  const controller = new AbortController();
  await assert.rejects(scopeFocusedAnswerFindings({ ...input, signal: controller.signal, complete: async () => {
    controller.abort(); return JSON.stringify({ decisions: problems.map((_, index) => decision(index, false)) });
  } }), /abort/i);
});

test('scope decisions cannot remove missing references or deterministic validation failures', async () => {
  const markdown = 'Filters change gain with frequency.';
  const result = await reviewAndHealLesson({ markdown, maxRepairs: 0,
    lesson: { title: 'Bode plots', learningQuestion: input.userRequest, currentUserRequest: input.userRequest,
      assumedBackground: [], earlierLessons: [], taughtLater: [], newConcepts: [], sources: [],
      requiredReferenceTargets: ['retained-source'], teachingPlan: { scope: 'focused-answer', requiredCoverage: ['Uses'], constraints: [] } },
    validate: () => [{ code: 'protected-constraint', hard: true, message: 'A protected requirement failed.' }],
    request: async call => {
      const data = JSON.parse(call.user);
      if (data.task === 'review_focused_answer_scope') return JSON.stringify({ decisions: data.findings.map(({ index }) => decision(index, false)) });
      return JSON.stringify({ terms: [], restatements: [], concepts: [], results: [], flow: [], callouts: [], reteaching: [],
        planCoverage: [{ item: 'Uses', status: 'taught', quote: markdown, missingStep: '' }],
        contractIssues: [{ quote: markdown, problem: 'Add a high-pass example.' }] });
    } });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.problems.map(problem => problem.code), ['missing-teaching-reference', 'protected-constraint']);
});

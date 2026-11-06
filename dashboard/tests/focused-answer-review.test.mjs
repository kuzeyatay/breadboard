import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTeachingPlan, teachingPlanPrompt } from '../src/lib/teaching-plan.ts';
import { reviewAndHealLesson } from '../src/lib/learn-teaching-healing.ts';

const request = 'this rule is only valid sometimes, what was that?';
const condition = 'The simple voltage-divider formula assumes no current is drawn from the midpoint, so the same current flows through both resistors.';
const rawPlan = { applicable: true, reason: 'A reminder of the validity condition.', scope: 'focused-answer',
  objective: 'Recall the voltage-divider condition.', background: [], priorLessonPageIds: [],
  constraints: ['Answer the condition directly.'], requiredCoverage: ['State the no-load condition and why it matters.'],
  steps: [{ id: 'condition', buildsOn: [], establishes: 'No branch draws current at the midpoint.', workedUse: '', transition: '' }] };
const plan = parseTeachingPlan(JSON.stringify(rawPlan));
const lesson = { title: plan.objective, learningQuestion: plan.objective, teachingPlan: plan,
  newConcepts: plan.requiredCoverage, assumedBackground: [], earlierLessons: [], taughtLater: [], sources: [], learnerRequest: request };
const verdict = (markdown, issues = []) => ({ terms: [], restatements: [], concepts: [], results: [], flow: [], callouts: [], reteaching: [],
  planCoverage: plan.requiredCoverage.map(item => ({ item, status: 'taught', quote: markdown, missingStep: '' })), contractIssues: issues });

test('focused plans allow an answer without a worked use; full lessons still require one', () => {
  assert.equal(plan.scope, 'focused-answer');
  assert.match(teachingPlanPrompt(plan), /opening sentence/);
  assert.throws(() => parseTeachingPlan(JSON.stringify({ ...rawPlan, scope: 'lesson' })), /dependencies/);
  assert.throws(() => parseTeachingPlan(JSON.stringify({ ...rawPlan, scope: 'skip-review' })), /scope/);
  const oldPlan = { ...rawPlan, steps: [{ ...rawPlan.steps[0], workedUse: 'A requested calculation.' }] };
  delete oldPlan.scope;
  assert.equal(parseTeachingPlan(JSON.stringify(oldPlan)).scope, 'lesson');
});


test('focused review still repairs a false condition and verifies the correction', async () => {
  const wrong = 'The formula is exact even when a load draws current from the midpoint.';
  const stages = [];
  const result = await reviewAndHealLesson({ markdown: wrong, lesson, request: async call => {
    stages.push(call.kind);
    const data = JSON.parse(call.user);
    if (data.task === 'review_focused_answer_scope') return JSON.stringify({ decisions: data.findings.map(({ index }) => ({
      index, required: true, reason: 'The claimed loaded-divider condition is factually wrong.' })) });
    if (call.kind === 'heal') {
      assert.match(call.system, /keep the direct answer first/);
      assert.doesNotMatch(call.system, /Move from a concrete case to its reasoning/);
      return JSON.stringify({ edits: [{ originalText: wrong, replacement: condition }] });
    }
    return JSON.stringify(verdict(data.pageMarkdown, data.pageMarkdown === wrong ? [{ quote: wrong,
      problem: 'A load splits the current; the original two-resistor formula assumes no midpoint load current.' }] : []));
  } });
  assert.equal(result.accepted, true);
  assert.equal(result.markdown, condition);
  assert.equal(result.repairCount, 1);
  assert.deepEqual(stages, ['review', 'review', 'heal', 'review']);
});

test('explicit lessons retain concrete-example review', async () => {
  const lessonPlan = { ...plan, scope: 'lesson', steps: [{ ...plan.steps[0], workedUse: 'Calculate the loaded output.' }] };
  const result = await reviewAndHealLesson({ markdown: condition, lesson: { ...lesson, teachingPlan: lessonPlan }, maxRepairs: 0,
    request: async call => {
      assert.match(call.system, /fully specified instance close to its definition/);
      assert.doesNotMatch(call.system, /absence of an optional example is not a defect/);
      return JSON.stringify({ ...verdict(condition), concepts: [{ concept: 'Voltage division', grounding: 'abstract_only',
        definition: condition, example: 'Work the numerical example the learner requested.' }] });
    } });
  assert.equal(result.accepted, false);
  assert.ok(result.problems.length > 0);
});

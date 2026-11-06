import test from "node:test";
import assert from "node:assert/strict";
import { lessonTermReviewProblems } from "../src/lib/learn-lesson-terms.ts";
import { reviewAndHealLesson } from "../src/lib/learn-teaching-healing.ts";
import { lessonReviewResidualIsAcceptable, selectEarlierLessonEvidence, teachingEvidenceHash } from "../src/lib/learn-teaching-context.ts";
import { acceptedPageInputHash } from "../src/lib/learn-accepted-pages.ts";

const clean = () => ({ terms: [], concepts: [], results: [], restatements: [], callouts: [], reteaching: [], flow: [] });
const lesson = { title: "From algebra to functions", learningQuestion: "How does a rule turn an input into an output?", newConcepts: ["function"],
  assumedBackground: ["arithmetic"], taughtLater: ["cylindrical coordinates"], earlierLessons: [], sources: [{ pageId: "textbook", text: "A function assigns one output to each allowed input." }] };
const dependency = () => ({ ...clean(), terms: [{ term: "cylindrical coordinates", status: "unexplained", laterUnit: true,
  sentence: "Substitute rho cos phi for x.", missing: "Use a numerical input in an ordinary function instead." }] });

test("repair exhaustion never waives a knowledge failure, including a future new code", () => {
  for (const code of ["leans-on-later-unit", "unexplained-term", "shallow-explanation", "floating-concept", "unshown-result", "incorrect-result", "broken-learning-sequence", "unverified-prerequisite", "future-knowledge-check"]) {
    assert.equal(lessonReviewResidualIsAcceptable([{ code, hard: true, message: "gap" }], [], 8), false, code);
  }
  assert.equal(lessonReviewResidualIsAcceptable([{ code: "restated-idea", hard: true, message: "repeat" }]), true);
  assert.equal(lessonReviewResidualIsAcceptable(Array.from({ length: 4 }, () => ({ code: "restated-idea", hard: true, message: "repeat" }))), false);
});

test("an earlier concept needs an actual matching explanation, not a label or invented quote", () => {
  const quote = "A function assigns exactly one output to each allowed input.";
  const context = { assumedBackground: [], earlierLessons: [{ pageId: "algebra", title: "Algebra", concepts: ["function"], markdown: quote }] };
  const verdict = { ...clean(), terms: [{ term: "function", status: "taught_earlier" }] };
  assert.equal(lessonTermReviewProblems(verdict, context).problems[0].code, "unverified-prerequisite");
  verdict.terms[0].priorExplanation = { pageId: "algebra", quote };
  assert.equal(lessonTermReviewProblems(verdict, context).problems.length, 0);
  verdict.terms[0].priorExplanation.quote = "Every function always has an inverse, which reverses the rule.";
  assert.equal(lessonTermReviewProblems(verdict, context).problems[0].code, "unverified-prerequisite");
  assert.match(lessonTermReviewProblems({ terms: [] }, context).reviewError, /omitted/);
});

test("changed earlier prose invalidates acceptance even when plan labels stay the same", () => {
  const pages = [{ pageId: "one", title: "Algebra", concepts: ["function"], markdown: "Function explanation" },
    { pageId: "two", title: "Geometry", concepts: ["angle"], markdown: "Angle explanation" }];
  const earlier = selectEarlierLessonEvidence(pages, ["function"]);
  assert.deepEqual(earlier.map(p => p.pageId), ["one", "two"]);
  const context = { assumedBackground: [], earlierLessons: earlier };
  const input = { pageRelPath: "three.md", dossier: {}, assignedVisualIds: [], taughtEarlier: ["function", "angle"], taughtLater: [], sourceSetHash: "sources", confirmedLearningMapId: "plan" };
  const before = acceptedPageInputHash({ ...input, teachingContextHash: teachingEvidenceHash(context) });
  pages[0].markdown = "A different explanation, with a missing foundation.";
  assert.notEqual(acceptedPageInputHash({ ...input, teachingContextHash: teachingEvidenceHash(context) }), before);
});

test("a premature coordinate example is healed and the exact replacement is reviewed before acceptance", async () => {
  const requests = [];
  const corrected = "For the rule f(x) = 2x + 1, an input of 3 gives 2 times 3 plus 1, or 7.";
  const result = await reviewAndHealLesson({ markdown: "Substitute rho cos phi for x.", lesson,
    request: async request => { requests.push(request); return request.kind === "heal" ? corrected : JSON.stringify(request.round === 0 ? dependency() : clean()); } });
  assert.equal(result.accepted, true);
  assert.equal(result.markdown, corrected);
  assert.equal(result.repairCount, 1);
  assert.deepEqual(requests.map(r => r.kind), ["review", "heal", "review"]);
  assert.equal(JSON.parse(requests[2].user).pageMarkdown, corrected);
  assert.equal(JSON.parse(requests[1].user).failedProblems[0].code, "leans-on-later-unit");
  assert.deepEqual(JSON.parse(requests[1].user).sources, lesson.sources);
});

test("unresolved dependency retains its repaired draft and remains rejected at the bound", async () => {
  let calls = 0;
  const result = await reviewAndHealLesson({ markdown: "original", lesson, maxRepairs: 2,
    request: async request => { calls++; return request.kind === "heal" ? "still needs coordinates" : JSON.stringify(dependency()); } });
  assert.equal(calls, 5);
  assert.equal(result.accepted, false);
  assert.equal(result.repairCount, 2);
  assert.equal(result.markdown, "still needs coordinates");
});

test("invalid reviews fail closed; deterministic depth and figure checks enter the same repair loop", async () => {
  await assert.rejects(reviewAndHealLesson({ markdown: "draft", lesson, request: async () => "not JSON" }), /invalid JSON/);
  await assert.rejects(reviewAndHealLesson({ markdown: "draft", lesson, request: async () => '{"terms":[]}' }), /omitted/);
  const result = await reviewAndHealLesson({ markdown: "too short", lesson,
    validate: markdown => markdown.includes("![figure]") ? [] : [{ code: "missing-source-figure", hard: true, message: "Restore the source figure" }],
    request: async request => request.kind === "review" ? JSON.stringify(clean()) : "A complete explanation with ![figure](real-source.png)." });
  assert.equal(result.accepted, true);
  assert.equal(result.repairCount, 1);
});

test("incorrect arithmetic and a broken reasoning transition become blocking repairs", () => {
  const result = lessonTermReviewProblems({ ...clean(), results: [{ result: "angle", status: "incorrect", sentence: "acos(1/sqrt(26)) = 69 degrees", needed: "It is approximately 78.69 degrees." }],
    flow: [{ sentence: "Now change coordinates", missingStep: "Explain what a coordinate represents first" }] }, lesson);
  assert.deepEqual(result.problems.map(p => p.code), ["incorrect-result", "broken-learning-sequence"]);
  assert.equal(lessonReviewResidualIsAcceptable(result.problems, [], 8), false);
});

test("a malformed reviewer response gets one repair attempt without rewriting the lesson", async () => {
  const requests = [];
  const result = await reviewAndHealLesson({ markdown: "The same complete lesson.", lesson,
    request: async request => {
      requests.push(request);
      return requests.length === 1 ? JSON.stringify({ ...clean(), terms: [{ term: "function", status: "abstract_only" }] }) : JSON.stringify(clean());
    } });
  assert.equal(result.accepted, true);
  assert.equal(result.repairCount, 0);
  assert.deepEqual(requests.map(r => r.kind), ["review", "review"]);
  assert.match(JSON.parse(requests[1].user).previousReviewRejected, /invalid term entry/);
  assert.deepEqual(JSON.parse(JSON.parse(requests[1].user).previousReviewToCorrect),
    { ...clean(), terms: [{ term: "function", status: "abstract_only" }] });
  assert.equal(JSON.parse(requests[1].user).pageMarkdown, "The same complete lesson.");
});

test("repairs distinguish the page's protected figure from an alternative in its source", async () => {
  const original = 'Use the result. ![Projection](<original-figure.png>) [[source]]';
  const wrong = 'The reasoning is now explained. ![Projection](source-alternative.png) [[source]]';
  const corrected = 'The reasoning is now explained. ![Projection](<original-figure.png>) [[source]]';
  const requests = [];
  const result = await reviewAndHealLesson({ markdown: original,
    lesson: { ...lesson, sources: [{ pageId: 'source', text: '![Projection](source-alternative.png)' }] },
    request: async request => {
      const payload = JSON.parse(request.user); requests.push(payload);
      assert.deepEqual(payload.referenceContract.requiredTargets, ['<original-figure.png>', 'source']);
      if (request.kind === 'heal') return request.round === 0 ? wrong : corrected;
      return JSON.stringify(request.round === 0 ? { ...clean(), flow: [{ sentence: 'Use the result.', missingStep: 'Explain the reasoning first.' }] } : clean());
    } });
  assert.equal(result.accepted, true);
  assert.equal(result.markdown, corrected);
  assert.equal(result.repairCount, 2);
  assert.deepEqual(requests[2].referenceContract.missingTargets, ['<original-figure.png>']);
  assert.ok(requests[3].failedProblems.some(problem => problem.code === 'missing-teaching-reference'));
  assert.deepEqual(requests.at(-1).referenceContract.missingTargets, []);
});

test("a missing original-page reference cannot be accepted just because the first generated draft omitted it", async () => {
  const result = await reviewAndHealLesson({ markdown: 'Complete reasoning.',
    lesson: { ...lesson, requiredReferenceTargets: ['original-page-figure.png'] }, maxRepairs: 0,
    request: async request => {
      assert.deepEqual(JSON.parse(request.user).referenceContract.missingTargets, ['original-page-figure.png']);
      return JSON.stringify(clean());
    } });
  assert.equal(result.accepted, false);
  assert.equal(result.problems[0].code, 'missing-teaching-reference');
});

test("malformed repair JSON and stale locators get one format retry against the unchanged draft", async () => {
  for (const malformed of ['{"edits":[', JSON.stringify({ edits: [{ originalText: 'A sentence absent from the draft.', replacement: 'replacement' }] })]) {
    const requests = [], attempts = [];
    const original = 'Substitute rho cos phi for x.';
    const corrected = 'For f(x) = 2x + 1, input 3 gives 7.';
    let heals = 0;
    const result = await reviewAndHealLesson({ markdown: original, lesson, maxRepairs: 1,
      onRepairAttempt: attempt => attempts.push(attempt),
      request: async request => {
        requests.push(request);
        const payload = JSON.parse(request.user);
        if (request.kind === 'review') return JSON.stringify(request.round === 0 ? dependency() : clean());
        assert.equal(payload.pageMarkdown, original);
        if (++heals === 1) return malformed;
        assert.equal(payload.previousRepairToCorrect, malformed);
        assert.match(payload.previousRepairRejected, /invalid edit JSON|occur exactly once/);
        return JSON.stringify({ edits: [{ draftPassage: payload.draftPassages[0].id, replacement: corrected }] });
      } });
    assert.equal(result.accepted, true);
    assert.equal(result.markdown, corrected);
    assert.equal(result.repairCount, 1);
    assert.deepEqual(requests.map(r => r.kind), ['review', 'heal', 'heal', 'review']);
    assert.equal(JSON.parse(requests.at(-1).user).pageMarkdown, corrected);
    assert.deepEqual(attempts.map(a => [a.round, a.attempt, Boolean(a.error)]), [[0, 0, true], [0, 1, false]]);
  }
});

test("two invalid repair representations fail closed and retain the original draft", async () => {
  const drafts = [], attempts = [], calls = [];
  await assert.rejects(reviewAndHealLesson({ markdown: 'unchanged draft', lesson,
    onDraft: (markdown, round) => drafts.push({ markdown, round }),
    onRepairAttempt: attempt => attempts.push(attempt),
    request: async request => {
      calls.push(request.kind);
      return request.kind === 'review' ? JSON.stringify(dependency()) : '{"edits":[';
    } }), /invalid edit JSON/);
  assert.deepEqual(calls, ['review', 'heal', 'heal']);
  assert.deepEqual(drafts, [{ markdown: 'unchanged draft', round: 0 }]);
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every(a => a.error && a.raw === '{"edits":['));
});

test("cancellation after an invalid repair prevents its format retry", async () => {
  const controller = new AbortController();
  const calls = [];
  await assert.rejects(reviewAndHealLesson({ markdown: 'unchanged draft', lesson, signal: controller.signal,
    onRepairAttempt: () => controller.abort(),
    request: async request => {
      calls.push(request.kind);
      return request.kind === 'review' ? JSON.stringify(dependency()) : '{"edits":[';
    } }), { name: 'AbortError' });
  assert.deepEqual(calls, ['review', 'heal']);
});

test("a review quote with doubly escaped LaTeX backslashes resolves to the exact draft text", async () => {
  // Live 2026-10-03 (gpt-6-sol, telecom-1 lesson 1.4): the reviewer quoted
  // `f_\\Delta` for the draft's `f_\Delta` and the whole term review failed.
  const { presentDraftQuote } = await import("../src/lib/teaching-review-contract.ts");
  const draft = String.raw`Let $f_\Delta$ be the distance from $f_0$ to $B$.`;
  assert.equal(presentDraftQuote(String.raw`Let $f_\\Delta$ be the distance`, draft), String.raw`Let $f_\Delta$ be the distance`);
  assert.equal(presentDraftQuote(String.raw`Let $f_\Delta$ be`, draft), String.raw`Let $f_\Delta$ be`);
  assert.equal(presentDraftQuote(String.raw`Let $g_\\Delta$ be`, draft), null);
  // The same live quote also dropped a closing math delimiter.
  assert.equal(
    presentDraftQuote(String.raw`distance from $f_0$ to $B.`, draft),
    String.raw`distance from $f_0$ to $B$.`,
  );
});

test("a slightly reworded plan-coverage item still names its required item", async () => {
  // Live 2026-10-05 (telecom-1 lesson 1.4): one changed word failed the review.
  const { matchingCoverageItem } = await import("../src/lib/teaching-review-contract.ts");
  const required = "Define the raised-cosine equivalent frequency response and its flat region, cosine transition, 6-dB point f0, transition increment, flat-band edge f1, absolute edge B, and roll-off factor r. Interpret S11.P32.G1 and S16.P214.G1 against those definitions.";
  const reworded = required.replace("flat-band edge f1", "flat-band edge B");
  const other = "Explain intersymbol interference with a worked two-pulse example.";
  const remaining = new Set([required, other]);
  assert.equal(matchingCoverageItem(reworded, remaining, required), required);
  assert.equal(matchingCoverageItem("Something unrelated entirely.", remaining, required), undefined);
  assert.equal(matchingCoverageItem(other, remaining, required), other);
});

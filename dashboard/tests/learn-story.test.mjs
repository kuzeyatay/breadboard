import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LESSON_REPAIRS,
  lessonAppendices,
  lessonStory,
  lessonStoryProblems,
  lessonStoryWordCeiling,
  lessonStoryWordCount,
  lessonStoryWordTarget,
  problemAsksForMore,
  repairGrowthProblem,
} from "../src/lib/learn-story.ts";
import { lessonTermReviewProblems } from "../src/lib/learn-lesson-terms.ts";
import { lessonReviewResidualIsAcceptable } from "../src/lib/learn-teaching-context.ts";
import { learningUnitOrderProblems } from "../src/lib/learning-unit-contract.ts";
import {
  PROMPT_LEARN_LESSON,
  PROMPT_LEARN_LESSON_REPAIR,
  PROMPT_LEARN_LESSON_TERMS,
  PROMPT_LEARN_TOPIC_MAP,
  PROMPT_LEARNING_CRITIC,
} from "../src/lib/system-prompts/feature-defaults.ts";

const words = (count, word = "field") => Array.from({ length: count }, () => word).join(" ");
const page = (storyWords) => [
  "> **Overview.** A charge sits inside a closed surface and we want the total that crosses it.",
  "",
  words(storyWords),
  "",
  "$$",
  "\\oint \\mathbf D \\cdot d\\mathbf S = Q",
  "$$",
  "",
  "## Practice",
  "",
  "**Question.** What crosses a sphere of twice the radius?",
  "",
  "<details>",
  "<summary>Answer</summary>",
  "",
  `**Answer.** ${words(400, "same")}`,
  "",
  "</details>",
  "",
  "## More from the sources",
  "",
  "![A sphere](/a.png)",
  "",
  `The figure shows ${words(60, "lines")}.`,
].join("\n");

test("the story is everything before the first appendix, and only its prose is counted", () => {
  const markdown = page(300);
  assert.ok(lessonStory(markdown).includes("Overview"));
  assert.ok(!lessonStory(markdown).includes("## Practice"));
  assert.ok(lessonAppendices(markdown).startsWith("## Practice"));
  assert.equal(lessonAppendices("no appendices here"), "");
  // Overview (16 words) + 300 story words; math, answers and appendix text are not counted.
  const overviewWords = lessonStoryWordCount("> **Overview.** A charge sits inside a closed surface and we want the total that crosses it.");
  assert.equal(lessonStoryWordCount(markdown), overviewWords + 300);
  // A fenced example mentioning the heading does not start the appendix.
  const fenced = "story\n\n```text\n## Practice\n```\n\nmore story";
  assert.equal(lessonStory(fenced), fenced);
});

test("the story ceiling follows the number of planned ideas, within fixed bounds", () => {
  assert.equal(lessonStoryWordCeiling(1), 350);
  assert.equal(lessonStoryWordCeiling(5), 730);
  assert.ok(lessonStoryWordCeiling(6) > lessonStoryWordCeiling(5));
  assert.equal(lessonStoryWordCeiling(48), 1500);
  assert.equal(lessonStoryWordCeiling(0), lessonStoryWordCeiling(1));
  assert.ok(lessonStoryWordTarget(840) < 840, "the writer is told less than the gate allows");
});

test("a draft over its ceiling or with an exercise in the story fails; a published page is not judged on either", () => {
  assert.deepEqual(lessonStoryProblems(page(700), { maxStoryWords: 730 }), []);
  assert.deepEqual(lessonStoryProblems(page(780), { maxStoryWords: 730 }), [], "10% slack");
  const over = lessonStoryProblems(page(900), { maxStoryWords: 730 });
  assert.deepEqual(over.map((problem) => problem.code), ["over-length"]);
  assert.match(over[0].message, /ceiling is 730/);
  const stray = `${words(200)}\n\n**Question.** Why?\n\n## Practice\n`;
  assert.deepEqual(lessonStoryProblems(stray, { maxStoryWords: 730 }).map((problem) => problem.code), ["exercise-in-story"]);
  assert.deepEqual(lessonStoryProblems(`${words(5000)}\n\n**Question.** Why?`), []);
});

test("a repair may grow the story only as far as its missing-step findings justify", () => {
  const before = page(600);
  assert.equal(repairGrowthProblem(before, page(560), [{ code: "dead-weight" }]), null, "shrinking is always fine");
  assert.equal(repairGrowthProblem(before, page(620), [{ code: "restated-idea" }]), null, "small slack");
  const grew = repairGrowthProblem(before, page(700), [{ code: "restated-idea" }, { code: "dead-weight" }]);
  assert.equal(grew?.code, "repair-growth");
  assert.equal(grew?.hard, true);
  assert.equal(repairGrowthProblem(before, page(700), [{ code: "unexplained-term" }]), null, "one missing step may add a few sentences");
  assert.equal(repairGrowthProblem(before, page(900), [{ code: "unexplained-term" }])?.code, "repair-growth");
  const fragment = repairGrowthProblem(before, "I could not produce the repaired page, so nothing was changed.", [{ code: "dead-weight" }]);
  assert.equal(fragment?.code, "repair-collapse", "a refusal sentence never replaces the lesson");
  assert.ok(problemAsksForMore({ code: "unshown-result" }));
  assert.ok(!problemAsksForMore({ code: "over-length" }));
  assert.ok(MAX_LESSON_REPAIRS <= 3, "the additive eight-round loop stays gone");
});

test("the reader review can ask for less: a cut is a hard, presentation-only finding with its passage as evidence", () => {
  const review = { terms: [], restatements: [], concepts: [], results: [], flow: [], callouts: [], reteaching: [],
    cuts: [{ passage: "In this page we will first look at flux.", reason: "a preview" }] };
  const { problems, reviewError } = lessonTermReviewProblems(review);
  assert.equal(reviewError, undefined);
  assert.deepEqual(problems.map((problem) => problem.code), ["dead-weight"]);
  assert.deepEqual(problems[0].evidence, ["In this page we will first look at flux."]);
  assert.match(problems[0].message, /Delete it/);
  assert.ok(lessonReviewResidualIsAcceptable(problems, [], 3), "wordiness alone never parks or rewrites a page");
  assert.ok(lessonTermReviewProblems({ ...review, cuts: [{ passage: "" }] }).reviewError);
  assert.equal(lessonTermReviewProblems({ ...review, cuts: undefined }).problems.length, 0, "older reviews without cuts still parse");
});

test("a concept may not be needed before the unit that first teaches it", () => {
  const unit = (id, prerequisiteConcepts, newConcepts) => ({ id, title: `Title ${id}`, prerequisiteConcepts, newConcepts });
  assert.deepEqual(learningUnitOrderProblems([
    unit("U1", ["calculus"], ["electric flux"]),
    unit("U2", ["Electric Flux"], ["Gauss's law"]),
  ]), [], "background no unit teaches is fine; labels match case-insensitively");
  const problems = learningUnitOrderProblems([
    unit("U1", ["divergence"], ["Gauss's law"]),
    unit("U2", [], ["Divergence"]),
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unit "U1".*needs "divergence".*first taught later by unit "U2"/);
  assert.deepEqual(learningUnitOrderProblems([unit("U1", ["flux"], ["flux"])]), [], "a unit may teach what it needs");
});

test("the Learn prompts carry the notebook contract and none of the old floor", () => {
  for (const prompt of [PROMPT_LEARN_LESSON, PROMPT_LEARN_LESSON_REPAIR]) {
    assert.match(prompt, /## Practice/);
    assert.match(prompt, /## More from the sources/);
    assert.match(prompt, /wordCeiling/);
    assert.match(prompt, /ASD-STE100/);
    assert.doesNotMatch(prompt, /1400|at least \d+ words/);
  }
  assert.match(PROMPT_LEARN_LESSON, /Say each thing once/);
  assert.match(PROMPT_LEARN_LESSON, /never mention sources/);
  assert.match(PROMPT_LEARN_LESSON_TERMS, /"cuts":/);
  assert.match(PROMPT_LEARN_LESSON_TERMS, /Never ask the page to add something only because/);
  assert.doesNotMatch(PROMPT_LEARN_TOPIC_MAP, /lowerEstimate >= 1400/);
  assert.match(PROMPT_LEARN_TOPIC_MAP, /Plan the units as one story/);
  assert.match(PROMPT_LEARNING_CRITIC, /Never report a page for being short/);
  // The writer prompt was 5,400 words of constraints the model narrated back.
  assert.ok(PROMPT_LEARN_LESSON.split(/\s+/).length < 1500);
});

test("a model the gateway can never serve for Learn is refused before a run starts", async () => {
  const { resolveLearnRequestModel, LEARN_INADMISSIBLE_MODEL_MESSAGE } = await import("../src/lib/learn-route-errors.ts");
  assert.throws(() => resolveLearnRequestModel({ model: "cliproxy/claude-sonnet-5-5" }, "gpt-6-sol"), { message: LEARN_INADMISSIBLE_MODEL_MESSAGE });
  assert.throws(() => resolveLearnRequestModel({}, "cliproxy/claude-fable-5-2"), { message: LEARN_INADMISSIBLE_MODEL_MESSAGE });
  assert.equal(resolveLearnRequestModel({ model: "openaiweb/gpt-6-pro" }, "gpt-6-sol"), "openaiweb/gpt-6-pro");
  assert.equal(resolveLearnRequestModel({ model: "cliproxy/kimi-k3" }, "gpt-6-sol"), "cliproxy/kimi-k3");
});

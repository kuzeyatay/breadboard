import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLearningUnits } from "../src/lib/learning-unit-contract.ts";
import {
  assessLessonQuality,
  assignedOpeningMove,
  bodyBeatHeadings,
  buildLearningPageFrontmatter,
  emojiMatches,
  OPENING_MOVE_BRIEFS,
  withLearningQuestionPrompt,
} from "../src/lib/learn-utils.ts";

// ---------------------------------------------------------------------------
// Learning question is surfaced to the learner
//
// The Topic Overview promises that each subsection is organized around a
// learning question and asks the reader to answer it before working through the
// equations. The question was model-authored in the contract but never rendered,
// so the promise could not be acted on.
// ---------------------------------------------------------------------------

test("learning question is rendered directly under the page heading", () => {
  const body = "## Electric Flux and Gauss's Law\n\nYou already know that charge creates a field.";
  const out = withLearningQuestionPrompt(body, "Why does enclosed charge fix the total outward flux?");
  const lines = out.split("\n");
  assert.equal(lines[0], "## Electric Flux and Gauss's Law");
  assert.equal(lines[1], "");
  assert.equal(
    lines[2],
    "> **Before you read.** Why does enclosed charge fix the total outward flux?",
  );
  assert.equal(lines[3], "");
  assert.equal(lines[4], "You already know that charge creates a field.");
});

test("learning question prompt is not stacked twice across repairs", () => {
  const body = "## Title\n\nProse.";
  const once = withLearningQuestionPrompt(body, "Why?");
  const twice = withLearningQuestionPrompt(once, "Why?");
  assert.equal(twice, once);
});

test("body without a heading or question is returned untouched", () => {
  assert.equal(withLearningQuestionPrompt("Prose only.", "Why?"), "Prose only.");
  assert.equal(withLearningQuestionPrompt("## Title\n\nProse.", "   "), "## Title\n\nProse.");
  assert.equal(withLearningQuestionPrompt("## Title\n\nProse.", undefined), "## Title\n\nProse.");
});

test("learning question reaches page frontmatter for review tooling", () => {
  const frontmatter = buildLearningPageFrontmatter({
    gardenId: "electromagnetism-1",
    sectionNumber: 2,
    subsectionNumber: 4,
    title: "2.4 Electric Flux and Gauss's Law",
    learningQuestion: "Why does enclosed charge fix the total outward flux?",
    sourceAnchors: ["text-lecture4-page-2"],
    visualIds: [],
    learningVersionId: "learning_test",
    generatedAt: "2026-09-11T00:00:00.000Z",
  });
  assert.match(
    frontmatter,
    /learningQuestion: "Why does enclosed charge fix the total outward flux\?"/,
  );
});

test("blank learning question emits no frontmatter key", () => {
  const frontmatter = buildLearningPageFrontmatter({
    gardenId: "g",
    sectionNumber: 1,
    subsectionNumber: 1,
    title: "1.1 Title",
    learningQuestion: "  ",
    sourceAnchors: [],
    visualIds: [],
    learningVersionId: "learning_test",
    generatedAt: "2026-09-11T00:00:00.000Z",
  });
  assert.ok(!frontmatter.includes("learningQuestion:"));
});

// ---------------------------------------------------------------------------
// Formula grounding
//
// A page owes a different move for a derived result than for a measured law.
// Nothing in the contract distinguished them, so every formula arrived with
// identical authority and none was ever established.
// ---------------------------------------------------------------------------

function unitWithFormula(formula) {
  return {
    id: "U1",
    title: "Gauss's Law",
    role: "core_concept",
    learningQuestion: "Why does enclosed charge fix the flux?",
    sourceAnchors: ["S1.P6.E1"],
    sourceFormulas: [formula],
  };
}

test("model-authored derivable formula keeps its grounding and route", () => {
  const [unit] = normalizeLearningUnits([
    unitWithFormula({
      id: "S1.P6.E1",
      teachingGoal: "Relate outward flux to enclosed charge",
      termsToDefine: ["D", "Q"],
      placement: "before_example",
      grounding: "derived",
      derivableFrom: ["S1.P3.E2", "divergence-theorem"],
    }),
  ]);
  const formula = unit.sourceFormulas[0];
  assert.equal(formula.grounding, "derived");
  assert.deepEqual(formula.derivableFrom, ["S1.P3.E2", "divergence-theorem"]);
});

test("empirical and axiom groundings survive normalization without a route", () => {
  for (const grounding of ["empirical", "axiom"]) {
    const [unit] = normalizeLearningUnits([
      unitWithFormula({
        id: "S1.P6.E1",
        teachingGoal: "goal",
        termsToDefine: [],
        placement: "before_example",
        grounding,
        // A route supplied alongside a non-derived grounding is dropped: only
        // "derived" owes the learner a route, so keeping one here would invite
        // a derivation the classification says does not exist.
        derivableFrom: ["S1.P1.E1"],
      }),
    ]);
    assert.equal(unit.sourceFormulas[0].grounding, grounding);
    assert.deepEqual(unit.sourceFormulas[0].derivableFrom, []);
  }
});

test("unclassified formula falls back to asserted_in_source, never to derived", () => {
  const [unit] = normalizeLearningUnits([
    unitWithFormula({
      id: "S1.P6.E1",
      teachingGoal: "goal",
      termsToDefine: [],
      placement: "before_example",
    }),
  ]);
  // A contract written before this field existed must stay honest: the page
  // says the result is taken as given rather than implying it was established.
  assert.equal(unit.sourceFormulas[0].grounding, "asserted_in_source");
  assert.deepEqual(unit.sourceFormulas[0].derivableFrom, []);
});

test("unrecognised grounding text does not promote a formula to derived", () => {
  const [unit] = normalizeLearningUnits([
    unitWithFormula({
      id: "S1.P6.E1",
      teachingGoal: "goal",
      termsToDefine: [],
      placement: "before_example",
      grounding: "obviously true",
      derivableFrom: ["S1.P1.E1"],
    }),
  ]);
  assert.equal(unit.sourceFormulas[0].grounding, "asserted_in_source");
  assert.deepEqual(unit.sourceFormulas[0].derivableFrom, []);
});

test("grounding spelling is tolerated the way placement is", () => {
  const [unit] = normalizeLearningUnits([
    unitWithFormula({
      id: "S1.P6.E1",
      teachingGoal: "goal",
      termsToDefine: [],
      placement: "before_example",
      grounding: "Asserted-In-Source",
    }),
  ]);
  assert.equal(unit.sourceFormulas[0].grounding, "asserted_in_source");
});

// ---------------------------------------------------------------------------
// Opening moves
//
// Two per-page rules jointly specified one template, and no per-page rule could
// see that every other page was using it. 36 of 40 EM1 pages opened the same
// way, 17 with the identical five words.
// ---------------------------------------------------------------------------

test("the very first page of a garden opens cold", () => {
  assert.equal(
    assignedOpeningMove({ role: "motivation", isFirstInSection: true, isFirstOverall: true }),
    "cold_open",
  );
});

test("a section's first page opens on the problem, not a callback", () => {
  assert.equal(
    assignedOpeningMove({
      role: "core_concept",
      isFirstInSection: true,
      isFirstOverall: false,
      prerequisiteConcepts: ["flux"],
    }),
    "problem_first",
  );
});

test("a page with no prerequisites never opens by claiming prior knowledge", () => {
  const move = assignedOpeningMove({
    role: "core_concept",
    isFirstInSection: false,
    isFirstOverall: false,
    prerequisiteConcepts: [],
  });
  assert.equal(move, "cold_open");
});

test("unit role steers the move rather than a blind rotation", () => {
  const base = { isFirstInSection: false, isFirstOverall: false, prerequisiteConcepts: ["x"] };
  assert.equal(assignedOpeningMove({ ...base, role: "worked_example" }), "concrete_instance");
  assert.equal(assignedOpeningMove({ ...base, role: "limitation" }), "contrast");
  assert.equal(assignedOpeningMove({ ...base, role: "application" }), "problem_first");
  assert.equal(assignedOpeningMove({ ...base, role: "mechanism" }), "continuation");
});

test("a run of same-shaped units does not reproduce one template", () => {
  const base = {
    role: "mechanism",
    isFirstInSection: false,
    isFirstOverall: false,
    prerequisiteConcepts: ["x"],
  };
  let previous;
  const moves = [];
  for (let i = 0; i < 6; i += 1) {
    previous = assignedOpeningMove({ ...base, previousMove: previous });
    moves.push(previous);
  }
  for (let i = 1; i < moves.length; i += 1) {
    assert.notEqual(moves[i], moves[i - 1], `pages ${i - 1} and ${i} share an opening move`);
  }
});

test("every opening move carries a brief the writer can act on", () => {
  const base = { isFirstInSection: false, isFirstOverall: false, prerequisiteConcepts: ["x"] };
  const seen = new Set();
  for (const role of ["worked_example", "limitation", "application", "mechanism"]) {
    seen.add(assignedOpeningMove({ ...base, role }));
  }
  seen.add(assignedOpeningMove({ ...base, isFirstOverall: true }));
  for (const move of seen) {
    assert.ok(OPENING_MOVE_BRIEFS[move]?.length > 20, `${move} has no usable brief`);
  }
});

test("assignment is deterministic across rebuilds", () => {
  const args = {
    role: "formula",
    isFirstInSection: false,
    isFirstOverall: false,
    prerequisiteConcepts: ["x"],
    previousMove: "concrete_instance",
  };
  assert.equal(assignedOpeningMove(args), assignedOpeningMove(args));
});

// ---------------------------------------------------------------------------
// Emphasis layer: beats are allowed, a beat per paragraph is not, and the
// emphasis vocabulary excludes emoji.
// ---------------------------------------------------------------------------

test("page title and fenced code are not counted as beats", () => {
  const body = [
    "## Page Title",
    "",
    "### First beat",
    "prose",
    "```python",
    "### not a heading",
    "```",
    "#### Second beat",
    "prose",
  ].join("\n");
  assert.deepEqual(bodyBeatHeadings(body), ["First beat", "Second beat"]);
});

test("a continuous lesson passes; any heading inside the body is a hard failure", () => {
  // 2026-09-16: a reader of telecom-1 M2 met "sub-subsection" titles inside
  // lessons; a subsection is one continuous explanation with no divisions.
  const prose = "Imagine a charged sphere. ".repeat(200);
  const beats = (n) =>
    `## Title\n\n${Array.from({ length: n }, (_, i) => `### Beat ${i + 1}\n\n${prose}`).join("\n\n")}` +
    "\n\n**Question.** Why?\n\n**Answer.** Because.";
  const continuous = `## Title\n\n${prose}\n\n${prose}\n\n**Question.** Why?\n\n**Answer.** Because.`;
  const ok = assessLessonQuality(continuous);
  assert.ok(!ok.problems.some((p) => p.code === "internal-heading"), "no headings should pass");
  const bad = assessLessonQuality(beats(2));
  const problem = bad.problems.find((p) => p.code === "internal-heading");
  assert.ok(problem, "even two internal headings are flagged");
  assert.equal(problem.hard, true);
  assert.deepEqual(problem.evidence, ["Beat 1", "Beat 2"]);
});

test("emoji in learner prose is a hard failure", () => {
  const clean = "## Title\n\n" + "Imagine a charged sphere. ".repeat(200) +
    "\n\n> [!warning]\n> The outward normal reverses if the surface is traversed the other way.\n" +
    "\n**Question.** Why?\n\n**Answer.** Because.";
  assert.deepEqual(emojiMatches(clean), []);
  assert.ok(!assessLessonQuality(clean).problems.some((p) => p.code === "emoji"));

  const warningSign = String.fromCodePoint(0x26a0, 0xfe0f);
  const pin = String.fromCodePoint(0x1f4cc);
  const dirty = clean.replace("> [!warning]", `> [!warning] ${warningSign}`) + `\n\n${pin} Remember this.`;
  const problem = assessLessonQuality(dirty).problems.find((p) => p.code === "emoji");
  assert.ok(problem, "emoji should be flagged");
  assert.equal(problem.hard, true);
});

test("callout syntax and bold terms are not mistaken for emoji", () => {
  const body = "**Electric flux density** is a local vector.\n\n> [!note]\n> Phasors arrive in section 10.";
  assert.deepEqual(emojiMatches(body), []);
});

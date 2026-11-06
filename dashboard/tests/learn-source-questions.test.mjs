import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildSourceQuestionEvidenceCatalog,
  projectSourceQuestions,
  sourceQuestionAssignmentProblems,
  sourceQuestionPlanProblems,
  sourceQuestionReferencesFromCaption,
} from "../src/lib/learn-source-questions.ts";

const learnSource = fs.readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");

const sourceId = "engineering-fields";
const anchorId = "text-engineering-fields-page-189";
const figureId = "S1.P190.F1";
const prompt = "6.21\n\nThe inner conductor shown in Figure 6.13 has a square cross section. Find the capacitance per meter.";
const body = `## Page 189\n\n${prompt}\n\n## Page 190\n\nFigure 6.13 See Problem 6.21.`;

function sourceMap() {
  return {
    sourceQuestions: [{
      id: "Q6.21",
      sourceId,
      label: "Problem 6.21",
      prompt,
      sourceAnchorIds: [anchorId],
      relatedFigureIds: [figureId],
      syllabusAssignments: [{ unitId: "SU1", reference: "Problem 6.21" }],
      teachingValue: "Practice translating a field sketch into a capacitance calculation.",
    }],
    unresolvedSyllabusQuestionReferences: [],
  };
}

const validationInput = {
  sourceIds: [sourceId],
  sourceBodies: [{ sourceId, body }],
  canonicalAnchors: [{ id: anchorId, sourceId }],
  registeredFigures: [{
    figureId,
    sourceId,
    page: 190,
    kind: "figure",
    caption: "Figure 6.13 See Problem 6.21.",
  }],
  syllabusUnits: [{ id: "SU1", questionReferences: ["Problem 6.21"] }],
};

describe("Learn source-question evidence", () => {
  test("hyphenated textbook question numbers retain their exact identity", () => {
    assert.deepEqual(sourceQuestionReferencesFromCaption("For Problems 5-74 and 5-75."), ["Problem 5-74", "Problem 5-75"]);
    const evidence = buildSourceQuestionEvidenceCatalog({
      anchors: ["5-74", "5-75", "5"].map((label, page) => ({ id: label, sourceId, page, title: label, exactText: `${label} Design the receiver.` })),
      figures: [], syllabusUnits: [{ id: "SU1", questionReferences: ["Problem 5-75"] }],
    });
    assert.deepEqual(evidence.map(entry => entry.anchorId), ["5-75"]);
    const ranged = buildSourceQuestionEvidenceCatalog({
      anchors: ["6.21", "6.22", "6.23"].map((label, page) => ({ id: label, sourceId, page, title: label, exactText: `${label} Calculate the field.` })),
      figures: [], syllabusUnits: [{ id: "SU1", questionReferences: ["Problems 6.21-6.23"] }],
    });
    assert.deepEqual(ranged.map(entry => entry.anchorId), ["6.21", "6.22", "6.23"]);
  });

  test("recognizes every problem identifier named by one figure", () => {
    assert.deepEqual(
      sourceQuestionReferencesFromCaption("Figure 13.25 See Problems 13.17 and 13.18."),
      ["Problem 13.17", "Problem 13.18"],
    );
    assert.deepEqual(
      sourceQuestionReferencesFromCaption("Figure 4 See Questions 7, 8, and 9."),
      ["Question 7", "Question 8", "Question 9"],
    );
  });

  test("exposes the exact question page for figure and syllabus mapping", () => {
    const evidence = buildSourceQuestionEvidenceCatalog({
      anchors: [{ id: anchorId, sourceId, page: 189, title: "Page 189", exactText: body }],
      figures: validationInput.registeredFigures,
      syllabusUnits: validationInput.syllabusUnits,
    });
    assert.equal(evidence.length, 1);
    assert.deepEqual(evidence[0].relatedFigureIds, [figureId]);
    assert.deepEqual(evidence[0].syllabusAssignments, [
      { unitId: "SU1", reference: "Problem 6.21" },
    ]);
    assert.equal(evidence[0].exactText, body);
  });

  test("expands compact syllabus question ranges into their exact source pages", () => {
    const evidence = buildSourceQuestionEvidenceCatalog({
      anchors: [21, 22, 23].map((number) => ({
        id: `page-${number}`,
        sourceId,
        page: number,
        title: `Page ${number}`,
        exactText: `6.${number}\n\nSolve engineering problem 6.${number}.`,
      })),
      figures: [],
      syllabusUnits: [{ id: "SU1", questionReferences: ["Problems 6.21–6.23"] }],
    });
    assert.deepEqual(evidence.map((entry) => entry.anchorId), ["page-21", "page-22", "page-23"]);
  });
});

describe("Learn source-question planning contract", () => {
  test("accepts and projects a verbatim, figure-linked, syllabus-assigned question", () => {
    const value = sourceMap();
    assert.deepEqual(sourceQuestionPlanProblems({ value, ...validationInput }), []);
    assert.deepEqual(projectSourceQuestions(value), value.sourceQuestions);
  });

  test("rejects a question that loses its required figure or changes the source wording", () => {
    const value = sourceMap();
    value.sourceQuestions[0].relatedFigureIds = [];
    value.sourceQuestions[0].prompt = "A plausible but invented engineering question.";
    const problems = sourceQuestionPlanProblems({ value, ...validationInput });
    assert.match(problems.join("; "), /copied verbatim/);
    assert.match(problems.join("; "), /question-linked source figure/);
  });

  test("rejects linking a captioned figure to a different source question", () => {
    const value = sourceMap();
    value.sourceQuestions[0].label = "Problem 9.9";
    value.sourceQuestions[0].prompt = "9.9\n\nFind the field for a different geometry.";
    const problems = sourceQuestionPlanProblems({
      value,
      ...validationInput,
      sourceBodies: [{ sourceId, body: `${body}\n\n${value.sourceQuestions[0].prompt}` }],
    });
    assert.match(problems.join("; "), /names Problem 6\.21, but no linked source question matches/);
  });

  test("requires syllabus question references to be mapped or explicitly unresolved", () => {
    const value = { sourceQuestions: [], unresolvedSyllabusQuestionReferences: [] };
    assert.match(
      sourceQuestionPlanProblems({ value, ...validationInput }).join("; "),
      /must map to one or more source questions or one unresolved record/,
    );
    value.unresolvedSyllabusQuestionReferences.push({
      unitId: "SU1",
      reference: "Problem 6.21",
      reason: "The selected source does not contain the assigned problem.",
    });
    // The figure still independently requires a mapped question.
    assert.deepEqual(
      sourceQuestionPlanProblems({
        value,
        ...validationInput,
        registeredFigures: [],
      }),
      [],
    );
  });
});

describe("Learn source-question learning-unit mapping", () => {
  const questions = projectSourceQuestions(sourceMap());
  const unit = {
    id: "U7",
    sourceAnchors: [anchorId],
    sourceFigures: [{ id: figureId }],
    syllabusUnitIds: ["SU1"],
    sourceQuestions: [{
      id: "Q6.21",
      placement: "guided_practice",
      teachingGoal: "Apply the field-map procedure.",
    }],
  };

  test("keeps a source question with its evidence, figure, and syllabus section", () => {
    assert.deepEqual(sourceQuestionAssignmentProblems([unit], questions), []);
  });

  test("rejects moving the question away from its related figure", () => {
    const problems = sourceQuestionAssignmentProblems(
      [{ ...unit, sourceFigures: [] }],
      questions,
    );
    assert.match(problems.join("; "), /must own its related figure/);
  });
});

test("the Learn pipeline carries required questions into generation and hard validation", () => {
  assert.match(learnSource, /sourceQuestionEvidence = buildSourceQuestionEvidenceCatalog\(/);
  assert.match(learnSource, /sourceQuestionAssignmentProblems\(learningUnits, sourceQuestions\)/);
  assert.match(learnSource, /requiredSourceQuestions: pageDossier\.requiredSourceQuestions/);
  assert.match(learnSource, /code: "missing-source-question"/);
  assert.match(learnSource, /const storedSourceQuestionProblems/);
  assert.ok(
    learnSource.indexOf("const storedSourceQuestionProblems") <
      learnSource.indexOf('"learn_generation_started"'),
    "a stale question mapping must fail before page generation starts",
  );
});

test("a sub-question stated as its verbatim stem plus its own part is accepted; a retyped part is not", () => {
  const body = "## Page 2\n\nFor recovery after an earthquake, a high-speed wireless link is needed.\n\na) What is the null-to-null bandwidth?\n\nc) Briefly explain coherent and non-coherent detection.\n";
  const input = (prompt) => ({
    value: { sourceQuestions: [{
      id: "Q1", sourceId: "exam", label: "Question 1(c)", prompt,
      sourceAnchorIds: ["exam-p2"], relatedFigureIds: [], syllabusAssignments: [], teachingValue: "practice detection",
    }], unresolvedSyllabusQuestionReferences: [] },
    sourceIds: ["exam"],
    sourceBodies: [{ sourceId: "exam", body }],
    canonicalAnchors: [{ id: "exam-p2", sourceId: "exam", exactText: body }],
    registeredFigures: [],
    syllabusUnits: [],
  });
  assert.deepEqual(sourceQuestionPlanProblems(input(
    "For recovery after an earthquake, a high-speed wireless link is needed.\n\nc) Briefly explain coherent and non-coherent detection.",
  )), []);
  assert.match(sourceQuestionPlanProblems(input(
    "For recovery after an earthquake, a high-speed wireless link is needed.\n\nc) Explain coherent detection.",
  )).join(";"), /must be copied verbatim/);
});

test("a question's related figure owned elsewhere names its owner so both units are repaired", () => {
  // Live 2026-10-02 (gpt-6-sol): U10 could not take S16.P433.G1 from a unit
  // the targeted repair never saw, and five repairs ended exhausted.
  const question = { id: "Q56", sourceAnchorIds: [], relatedFigureIds: ["S16.P433.G1"], syllabusAssignments: [] };
  const problems = sourceQuestionAssignmentProblems([
    { id: "U10", sourceAnchors: [], sourceFigures: [], sourceQuestions: [{ id: "Q56" }] },
    { id: "U11", sourceAnchors: [], sourceFigures: [{ id: "S16.P433.G1" }] },
  ], [question]);
  assert.match(problems.join("\n"), /Q56 must own its related figure S16\.P433\.G1; it is currently owned by unit "U11"/);
});

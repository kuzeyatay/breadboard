import test from "node:test";
import assert from "node:assert/strict";
import {
  practiceSalvagePlan,
  dropUnitEvidencePages,
  unverifiableQuoteAnchorIds,
  dropUnverifiableQuestions,
  dropUnknownFigureRefs,
  unverifiablePromptIndices,
  mapWithConcurrency,
  mergeSourceMapParts,
  sourceMapPartAnchorProblems,
  sourceMapPartPayload,
  sourceMapPartSelection,
  sourceMapParts,
} from "../src/lib/learn-source-map-partition.ts";

const selection = {
  units: [
    { unitId: "SU1", pageAliases: ["p0"], reason: "r" },
    { unitId: "SU2", pageAliases: ["p1", "p2"], reason: "r" },
  ],
  practiceSources: [
    { sourceId: "sheet", disposition: "selected", pageAliases: ["p3"], reason: "r" },
    { sourceId: "book", disposition: "not_practice", pageAliases: [], reason: "r" },
  ],
};
const pages = [
  { alias: "p0", anchorId: "a-book-1", sourceId: "book", page: 1, exactText: "one" },
  { alias: "p1", anchorId: "a-book-2", sourceId: "book", page: 2, exactText: "two" },
  { alias: "p2", anchorId: "a-book-3", sourceId: "book", page: 3, exactText: "three" },
  { alias: "p3", anchorId: "a-sheet-1", sourceId: "sheet", page: 1, exactText: "Q: compute" },
];

test("parts follow the map's own boundaries", () => {
  const parts = sourceMapParts({ sourceIds: ["book", "sheet", "slides"], selection, questionSourceIds: ["slides"] });
  assert.deepEqual(parts.map((part) => part.key), [
    "catalog:book", "catalog:sheet", "catalog:slides", "unit:SU1", "unit:SU2", "practice:sheet", "practice:slides",
  ]);
});

test("a part's payload carries only its own evidence", () => {
  const shared = {
    base: { userInstruction: "M1", syllabus: {} },
    sourceContext: {
      sources: [{ id: "book" }, { id: "sheet" }],
      sourceVisuals: [{ sourceVisualId: "f1", sourceId: "book" }, { sourceVisualId: "f2", sourceId: "sheet" }],
    },
    canonicalSourceAnchors: pages.map((page) => ({ id: page.anchorId, sourceId: page.sourceId })),
    sourceQuestionEvidence: [{ anchorId: "a-sheet-1", sourceId: "sheet" }],
    selection,
    pages,
  };
  const unit = sourceMapPartPayload({ kind: "unit", key: "unit:SU2", unitId: "SU2" }, shared);
  assert.deepEqual(unit.teachingEvidencePages.map((page) => page.alias), ["p1", "p2"]);
  assert.deepEqual(unit.canonicalSourceAnchors.map((anchor) => anchor.id), ["a-book-2", "a-book-3"]);
  assert.equal(unit.userInstruction, "M1");

  const catalog = sourceMapPartPayload({ kind: "catalog", key: "catalog:book", sourceId: "book" }, shared);
  assert.deepEqual(catalog.sourceContext.sources, [{ id: "book" }]);
  assert.deepEqual(catalog.sourceContext.sourceVisuals.map((visual) => visual.sourceVisualId), ["f1"]);

  const practice = sourceMapPartPayload({ kind: "practice", key: "practice:sheet", sourceId: "sheet" }, shared);
  assert.deepEqual(practice.teachingEvidencePages.map((page) => page.alias), ["p3"]);
  assert.equal(practice.sourceQuestionEvidence.length, 1);
  assert.deepEqual(
    sourceMapPartSelection({ kind: "practice", key: "practice:sheet", sourceId: "sheet" }, selection).practiceSources.map((s) => s.sourceId),
    ["sheet"],
  );
});

test("merge concatenates, de-duplicates anchors, renumbers questions, and reconciles references", () => {
  const merged = mergeSourceMapParts({
    syllabusQuestionReferences: [
      { unitId: "SU1", reference: "Problem 1" },
      { unitId: "SU2", reference: "Problem 9" },
      { unitId: "SU2", reference: "Problem 7" },
    ],
    parts: [
      { part: { kind: "catalog", key: "c", sourceId: "book" }, value: {
        sources: [{ id: "book" }], figures: [{ id: "f1" }], sourceAnchors: [{ id: "a-book-1", sourceId: "book" }], missingOrUnclear: ["x"],
      } },
      { part: { kind: "unit", key: "u", unitId: "SU1" }, value: {
        unitEvidence: [{ unitId: "SU1" }], sourceAnchors: [{ id: "a-book-1", sourceId: "book", title: "dup" }],
      } },
      { part: { kind: "practice", key: "p1", sourceId: "sheet" }, value: {
        sourceQuestions: [{ id: "Q1", syllabusAssignments: [{ unitId: "SU1", reference: "Problem 1" }] }],
        practiceReview: [{ anchorId: "a-sheet-1", questionIds: ["Q1"] }],
        unresolvedSyllabusQuestionReferences: [{ unitId: "SU2", reference: "Problem 9", reason: "not here" }],
      } },
      { part: { kind: "practice", key: "p2", sourceId: "exam" }, value: {
        sourceQuestions: [{ id: "Q1", syllabusAssignments: [] }],
        practiceReview: [{ anchorId: "a-exam-1", questionIds: ["Q1"] }],
        unresolvedSyllabusQuestionReferences: [
          { unitId: "SU1", reference: "Problem 1", reason: "in the other sheet" },
          { unitId: "SU2", reference: "Problem 9", reason: "absent" },
        ],
      } },
    ],
  });
  assert.deepEqual(merged.sources, [{ id: "book" }]);
  assert.equal(merged.sourceAnchors.length, 1);
  assert.equal(merged.sourceAnchors[0].title, undefined, "first anchor wins");
  assert.deepEqual(merged.sourceQuestions.map((question) => question.id), ["Q1", "Q2"]);
  assert.deepEqual(merged.practiceReview.map((review) => review.questionIds), [["Q1"], ["Q2"]]);
  assert.deepEqual(
    merged.unresolvedSyllabusQuestionReferences.map((entry) => `${entry.unitId}/${entry.reference}`),
    ["SU2/Problem 9", "SU2/Problem 7"],
    "resolved references drop out; each open one appears once; unreported ones are added",
  );
  assert.deepEqual(merged.unitEvidence, [{ unitId: "SU1" }]);
});

test("a part's anchors are checked against the canonical catalog", () => {
  const problems = sourceMapPartAnchorProblems({
    value: { sourceAnchors: [
      { id: "a-book-1", sourceId: "book", title: "t", summary: "s" },
      { id: "made-up", sourceId: "book", title: "t", summary: "s" },
      { id: "a-book-1", sourceId: "book", title: "", summary: "s" },
    ] },
    canonicalAnchors: [{ id: "a-book-1", sourceId: "book" }],
    sourceIds: ["book"],
  }).join(";");
  assert.match(problems, /made-up must be copied from canonicalSourceAnchors/);
  assert.match(problems, /a-book-1 appears more than once/);
  assert.match(problems, /\[2\]\.title is required/);
});

test("bounded concurrency keeps order and starts nothing new after a failure", async () => {
  let active = 0;
  let peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);

  const started = [];
  await assert.rejects(mapWithConcurrency([1, 2, 3, 4, 5], 1, async (n) => {
    started.push(n);
    if (n === 2) throw new Error("boom");
    return n;
  }), /boom/);
  assert.deepEqual(started, [1, 2]);
});

test("an anchor's sourceId is identity: parts are not failed on it and the merge copies the catalog's", () => {
  const problems = sourceMapPartAnchorProblems({
    value: { sourceAnchors: [{ id: "a-book-1", sourceId: "a-book-1-page-9", title: "t", summary: "s" }] },
    canonicalAnchors: [{ id: "a-book-1", sourceId: "book" }],
    sourceIds: ["book"],
  });
  assert.deepEqual(problems, []);
  const merged = mergeSourceMapParts({
    syllabusQuestionReferences: [],
    canonicalSourceIdOf: (id) => (id === "a-book-1" ? "book" : undefined),
    parts: [{ part: { kind: "unit", key: "u", unitId: "SU1" }, value: {
      unitEvidence: [], sourceAnchors: [{ id: "a-book-1", sourceId: "a-book-1-page-9", title: "t", summary: "s" }],
    } }],
  });
  assert.equal(merged.sourceAnchors[0].sourceId, "book");
});

test("only unverifiable prompts are salvageable, and dropping them keeps the part consistent", () => {
  assert.deepEqual(unverifiablePromptIndices([
    "sourceQuestions[0].prompt must be copied verbatim from source keiser",
    "sourceQuestions[0].prompt is not contained in its selected sourceAnchorIds; include its complete question and continuation pages",
    "sourceQuestions[2].prompt must be copied verbatim from source keiser",
  ]), [0, 2]);
  assert.equal(unverifiablePromptIndices(["sourceQuestions[0].prompt must be copied verbatim from source k", "practiceReview p1 needs omittedQuestions"]), null);
  assert.equal(unverifiablePromptIndices([]), null);

  const salvaged = dropUnverifiableQuestions({
    sourceQuestions: [
      { id: "Q1", label: "Problem 9-3", syllabusAssignments: [{ unitId: "SU9", reference: "9-3" }] },
      { id: "Q2", label: "Problem 9-4", syllabusAssignments: [{ unitId: "SU9", reference: "9-4" }] },
    ],
    practiceReview: [{ anchorId: "p394", questionIds: ["Q1", "Q2"], omittedQuestions: [] }],
    unresolvedSyllabusQuestionReferences: [],
  }, [0]);
  assert.deepEqual(salvaged.sourceQuestions.map((question) => question.id), ["Q2"]);
  assert.deepEqual(salvaged.practiceReview[0].questionIds, ["Q2"]);
  assert.equal(salvaged.practiceReview[0].omittedQuestions[0].label, "Problem 9-3");
  assert.deepEqual(salvaged.unresolvedSyllabusQuestionReferences.map((entry) => entry.reference), ["9-3"]);
});

test("only unverifiable quotes are salvageable, and dropping them removes just those pages", () => {
  assert.deepEqual(unverifiableQuoteAnchorIds([
    "unitEvidence SU5 page p379 quote is not an exact substring of that page's text; copy its words",
    "unitEvidence SU5 page p380 quotes a heading line; quote a sentence of explanatory prose from that page instead",
  ], "SU5"), ["p379", "p380"]);
  assert.equal(unverifiableQuoteAnchorIds(["unitEvidence SU5 dropped selected teaching page p381"], "SU5"), null);
  assert.equal(unverifiableQuoteAnchorIds(["unitEvidence SU6 page p1 quote is not an exact substring"], "SU5"), null);
  const salvaged = dropUnitEvidencePages({ unitEvidence: [{ unitId: "SU5", pages: [{ anchorId: "p379" }, { anchorId: "p381" }] }] }, ["p379"]);
  assert.deepEqual(salvaged.unitEvidence[0].pages, [{ anchorId: "p381" }]);
});

test("a practice part's last attempt may release unreviewed pages and drop unverifiable prompts, nothing else", () => {
  assert.deepEqual(practiceSalvagePlan([
    "practiceReview omits selected exercise page p250",
    "sourceQuestions[3].prompt must be copied verbatim from source couch",
    "practiceReview omits selected exercise page p251",
  ]), { promptIndices: [3], unreviewedPages: ["p250", "p251"], unknownFigureRefs: [] });
  assert.equal(practiceSalvagePlan(["practiceReview omits selected exercise page p250", "sourceQuestions[0].label must be a non-empty string"]), null);
  assert.equal(practiceSalvagePlan([]), null);
});

test("a practice part's last attempt drops a related-figure id that names no figure, keeping the question", () => {
  // Live 2026-09-30 (gpt-6-sol): equation ids listed as related figures failed the Couch practice part.
  const plan = practiceSalvagePlan([
    "sourceQuestions[1].relatedFigureIds references unknown figure S16.P258.E2",
    "sourceQuestions[2].prompt must be copied verbatim from source couch",
  ]);
  assert.deepEqual(plan.unknownFigureRefs, [{ index: 1, id: "S16.P258.E2" }]);
  const stripped = dropUnknownFigureRefs({
    sourceQuestions: [
      { id: "q0", relatedFigureIds: ["S16.P258.E2"] },
      { id: "q1", relatedFigureIds: ["S16.P258.E2", "S16.P258.F1"] },
    ],
  }, plan.unknownFigureRefs);
  assert.deepEqual(stripped.sourceQuestions[0].relatedFigureIds, ["S16.P258.E2"]);
  assert.deepEqual(stripped.sourceQuestions[1].relatedFigureIds, ["S16.P258.F1"]);
});

test("a source with many figures is catalogued in figure chunks", () => {
  const ids = Array.from({ length: 250 }, (_, index) => `f${index}`);
  const parts = sourceMapParts({
    sourceIds: ["book", "sheet"],
    selection,
    questionSourceIds: [],
    figureIdsBySource: new Map([["book", ids], ["sheet", ["s1"]]]),
  });
  const catalogs = parts.filter((part) => part.kind === "catalog");
  assert.deepEqual(catalogs.map((part) => part.key), [
    "catalog:book.figures1of3", "catalog:book.figures2of3", "catalog:book.figures3of3", "catalog:sheet",
  ]);
  assert.deepEqual(catalogs.map((part) => part.figureIds?.length), [120, 120, 10, undefined]);

  const payload = sourceMapPartPayload(catalogs[2], {
    base: {},
    sourceContext: { sources: [{ id: "book" }], sourceVisuals: ids.map((id) => ({ sourceVisualId: id, sourceId: "book" })) },
    canonicalSourceAnchors: [],
    sourceQuestionEvidence: [],
    selection,
    pages,
  });
  assert.deepEqual(payload.sourceContext.sourceVisuals.map((visual) => visual.sourceVisualId), ids.slice(240));

  const merged = mergeSourceMapParts({
    parts: catalogs.slice(0, 3).map((part, index) => ({
      part,
      value: { sources: [{ id: "book", note: index }], figures: [{ id: `f${index}` }], sourceAnchors: [] },
    })),
    syllabusQuestionReferences: [],
  });
  assert.deepEqual(merged.sources, [{ id: "book", note: 0 }]);
  assert.equal(merged.figures.length, 3);
});

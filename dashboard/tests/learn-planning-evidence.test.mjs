import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PLANNING_EVIDENCE_VERSION, PlanningEvidenceGapError,
  planningEvidenceCatalog, planningEvidenceNavigation, planningEvidenceSelectionProblems,
  selectedPlanningEvidence, sourceMapEvidenceProblems, learningUnitEvidenceProblems,
  persistedPlanningEvidenceProblems, withPlanningEvidenceHealing,
} from "../src/lib/learn-planning-evidence.ts";
import { sourceQuestionPlanProblems, sourceQuestionAssignmentProblems } from "../src/lib/learn-source-questions.ts";
import { projectCanonicalLearningSpinePacket } from "../src/lib/learning-spine-prompt-projection.ts";

const explanation = "Water molecules absorb energy from a radio wave. The loss depends on frequency and moisture and increases with the distance travelled through the atmosphere.";
const question = "5-67 A QPSK signal carries 32 Mbit/s. Find the required bandwidth and repeat for 60 Mbit/s.";
function fixture() {
  const sources = [
    { sourceId: "propagation", body: `Generated summary says only a heading is available.\n\n## Source material\n## Page 104\n### Diffraction\nA different mechanism.\n## Page 107\n### Atmospheric absorption\n${explanation}\n` },
    { sourceId: "practice", body: `## Page 2\n${question}\n` },
  ];
  const anchors = [
    { id: "text-propagation-page-104", sourceId: "propagation", page: 104 },
    { id: "text-propagation-page-107", sourceId: "propagation", page: 107 },
    { id: "text-practice-page-2", sourceId: "practice", page: 2 },
  ];
  const pages = planningEvidenceCatalog({ sources, anchors });
  const selection = {
    units: [{ unitId: "SU9", pageAliases: ["p1"], reason: "Actual atmospheric mechanism" }],
    practiceSources: [
      { sourceId: "propagation", disposition: "not_practice", pageAliases: [], reason: "Selected explanatory chapter" },
      { sourceId: "practice", disposition: "selected", pageAliases: ["p2"], reason: "Assigned M1 practice" },
    ],
  };
  const sourceMap = {
    figures: [], sources: [],
    sourceAnchors: anchors.slice(1),
    unitEvidence: [{ unitId: "SU9", pages: [{ anchorId: anchors[1].id, quote: explanation, teachingUse: "Explain the frequency, moisture and distance dependencies" }] }],
    sourceQuestions: [{ id: "Q5-67", sourceId: "practice", label: "5-67", prompt: question, sourceAnchorIds: [anchors[2].id], relatedFigureIds: [], syllabusAssignments: [], teachingValue: "Calculate bandwidth after learning the signal model" }],
    unresolvedSyllabusQuestionReferences: [],
    practiceReview: [{ anchorId: anchors[2].id, questionIds: ["Q5-67"], omittedQuestions: [] }],
    teachingEvidencePolicy: PLANNING_EVIDENCE_VERSION,
    teachingEvidenceSelection: selection,
  };
  return { sources, anchors, pages, selection, sourceMap };
}

test("positive heading-only coverage is checked against complete raw pages", () => {
  const { pages, selection, sourceMap } = fixture();
  assert.match(pages[1].exactText, /Water molecules/);
  assert.doesNotMatch(pages[1].exactText, /Generated summary/);
  assert.deepEqual(sourceMapEvidenceProblems({ value: sourceMap, selection, pages }), []);
  sourceMap.unitEvidence[0].pages[0].quote = "Atmospheric absorption";
  assert.match(sourceMapEvidenceProblems({ value: sourceMap, selection, pages }).join(";"), /quotes a heading line/);
});

test("selection accounts for every source even with no syllabus question references", () => {
  const { pages, selection } = fixture();
  const input = { pages, unitIds: ["SU9"], sourceIds: ["propagation", "practice"] };
  assert.deepEqual(planningEvidenceSelectionProblems({ ...input, value: selection }), []);
  selection.practiceSources.pop();
  assert.match(planningEvidenceSelectionProblems({ ...input, value: selection }).join(";"), /practiceSources omits practice/);
});

test("an empty exercise registry cannot pass by merely summarizing a selected sheet", () => {
  const { pages, selection, sourceMap } = fixture();
  sourceMap.sourceQuestions = [];
  assert.match(sourceMapEvidenceProblems({ value: sourceMap, selection, pages }).join(";"), /which sourceQuestions does not define/);
  sourceMap.practiceReview = [];
  assert.match(sourceMapEvidenceProblems({ value: sourceMap, selection, pages }).join(";"), /omits selected exercise page/);
  sourceMap.practiceReview = [{ anchorId: "text-practice-page-2", questionIds: [], omittedQuestions: [] }];
  assert.match(sourceMapEvidenceProblems({ value: sourceMap, selection, pages }).join(";"), /silently drops/);
});

test("exercise prompts are bound to their actual pages and one lesson owner", () => {
  const { sources, pages, sourceMap } = fixture();
  const input = { value: sourceMap, sourceIds: sources.map(s => s.sourceId), sourceBodies: sources,
    canonicalAnchors: pages.map(p => ({ id: p.anchorId, sourceId: p.sourceId, exactText: p.exactText })), registeredFigures: [], syllabusUnits: [] };
  assert.deepEqual(sourceQuestionPlanProblems(input), []);
  sourceMap.sourceQuestions[0].sourceAnchorIds = ["text-propagation-page-104"];
  assert.match(sourceQuestionPlanProblems(input).join(";"), /not contained in its selected sourceAnchorIds/);
  sourceMap.sourceQuestions[0].sourceAnchorIds = ["text-practice-page-2"];
  assert.match(sourceQuestionAssignmentProblems([], sourceMap.sourceQuestions).join(";"), /exactly one learning unit/);
});

test("recovered support survives spine projection and may be distributed over multiple lessons", () => {
  const { sourceMap } = fixture();
  const packet = projectCanonicalLearningSpinePacket({ sourceOnly: true, syllabus: {}, syllabusCoverage: {}, sourceMap, scopeContract: {}, sources: {}, extractedSourceArtifacts: [], responseShape: "{}" });
  assert.deepEqual(packet.sourceMap.unitEvidence, sourceMap.unitEvidence);
  const lessons = [
    { id: "U1", syllabusUnitIds: ["SU9"], sourceAnchors: ["text-propagation-page-104"] },
    { id: "U2", syllabusUnitIds: ["SU9"], sourceAnchors: ["text-propagation-page-107"] },
  ];
  assert.deepEqual(learningUnitEvidenceProblems(lessons, packet.sourceMap), []);
  assert.match(learningUnitEvidenceProblems(lessons.slice(0, 1), packet.sourceMap).join(";"), /lost page text-propagation-page-107/);
  lessons[1].syllabusUnitIds = ["SU8"];
  assert.match(learningUnitEvidenceProblems(lessons, packet.sourceMap).join(";"), /lost page/);
});

test("persisted checks reject an old map or changed source evidence", () => {
  const { pages, sourceMap } = fixture();
  const input = { pages, unitIds: ["SU9"], sourceIds: ["propagation", "practice"] };
  assert.deepEqual(persistedPlanningEvidenceProblems({ ...input, sourceMap }), []);
  assert.match(persistedPlanningEvidenceProblems({ ...input, sourceMap: {} }).join(";"), /predates/);
  pages[1].exactText = "## Page 107\nAn unrelated replacement.";
  assert.match(persistedPlanningEvidenceProblems({ ...input, sourceMap }).join(";"), /not an exact substring/);
});

test("navigation and hydration preserve later pages, with explicit size limits", () => {
  const { pages, selection } = fixture();
  assert.equal(planningEvidenceNavigation(pages).pages[1][2], 107);
  assert.deepEqual(selectedPlanningEvidence(selection, pages).map(p => p.page), [107, 2]);
  pages[1].exactText = "x".repeat(240001);
  assert.match(planningEvidenceSelectionProblems({ value: selection, pages, unitIds: ["SU9"], sourceIds: ["propagation", "practice"] }).join(";"), /240000/);
});

test("missing explanation triggers one bounded selection healing and preserves failure otherwise", async () => {
  const calls = [];
  const result = await withPlanningEvidenceHealing(async (attempt, previousGap) => {
    calls.push({ attempt, previousGap });
    if (!attempt) throw new PlanningEvidenceGapError("SU13 needs the mechanism before figure 9-12");
    return "complete source pages";
  });
  assert.equal(result, "complete source pages");
  assert.match(calls[1].previousGap, /mechanism/);
  let failedCalls = 0;
  await assert.rejects(withPlanningEvidenceHealing(async () => { failedCalls++; throw new PlanningEvidenceGapError("missing continuation"); }), /2 healing passes/);
  assert.equal(failedCalls, 3);
  let transportCalls = 0;
  await assert.rejects(withPlanningEvidenceHealing(async () => { transportCalls++; throw new Error("cancelled"); }), /cancelled/);
  assert.equal(transportCalls, 1);
});

test("live planning and both persisted entry points enforce evidence bindings", () => {
  const source = fs.readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");
  assert.match(source, /learningUnitEvidenceProblems\(learningUnits, sourceMap\)/);
  assert.match(source, /learningUnitEvidenceProblems\(retryUnits, sourceMap\)/);
  assert.match(source, /learningUnitEvidenceProblems\(candidateUnits, sourceMap\)/);
  assert.match(source, /planningEvidenceBindingProblems\(confirmationContext/);
  assert.match(source, /planningEvidenceBindingProblems\(context, map.sourceMap/);
});

test("Learn failure cleanup is awaited before the enclosing finally releases the garden lease", async () => {
  // Live 2026-09-24: `return rethrowAfterBestEffortLearnFailureCleanup(...)` in a
  // try/finally ran the finally (lease.release) at the rollback's first await.
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /return rethrowAfterBestEffortLearnFailureCleanup\(/);
  assert.match(source, /return await rethrowAfterBestEffortLearnFailureCleanup\(/);
});

test("page count is guidance only; the character budget names the overshoot and where it went", () => {
  const { pages, selection } = fixture();
  const input = { unitIds: ["SU9"], sourceIds: ["propagation", "practice"] };
  const many = Array.from({ length: 120 }, (_, index) => ({ ...pages[1], alias: `X${index}`, exactText: "short" }));
  selection.units[0].pageAliases = many.map((page) => page.alias);
  assert.deepEqual(planningEvidenceSelectionProblems({ ...input, value: selection, pages: [...pages, ...many] }), []);

  const big = Array.from({ length: 3 }, (_, index) => ({ ...pages[1], alias: `B${index}`, exactText: "x".repeat(100_000) }));
  selection.units[0].pageAliases = big.map((page) => page.alias);
  const problems = planningEvidenceSelectionProblems({ ...input, value: selection, pages: [...pages, ...big] }).join(";");
  assert.match(problems, /has 300\d+ characters of page text; the limit is 240000\. Remove at least 6\d+ characters/);
  assert.match(problems, /per record: SU9 3 pages\/300000 chars/);
});

test("records for units ruled unteachable are dropped, not failed", async () => {
  const { withoutExcludedUnitRecords } = await import("../src/lib/learn-planning-evidence.ts");
  const { pages, selection } = fixture();
  selection.units.push({ unitId: "SU6", reason: "extra", pageAliases: [selection.units[0].pageAliases[0]] });
  const input = { pages, unitIds: ["SU9"], sourceIds: ["propagation", "practice"] };
  assert.match(planningEvidenceSelectionProblems({ ...input, value: selection }).join(";"), /unitId SU6/);
  const cleaned = withoutExcludedUnitRecords(selection, ["SU6"]);
  assert.deepEqual(planningEvidenceSelectionProblems({ ...input, value: cleaned }), []);
  assert.deepEqual(cleaned.units.map((unit) => unit.unitId), ["SU9"]);
});

test("a partitioned map scales the character budget and bounds any one record", async () => {
  const { planningEvidenceCharBudget } = await import("../src/lib/learn-planning-evidence.ts");
  assert.deepEqual(planningEvidenceCharBudget(30, false), { total: 240_000, perRecord: null });
  assert.deepEqual(planningEvidenceCharBudget(4, true), { total: 240_000, perRecord: 90_000 });
  assert.deepEqual(planningEvidenceCharBudget(17, true), { total: 425_000, perRecord: 90_000 });
  assert.deepEqual(planningEvidenceCharBudget(40, true), { total: 600_000, perRecord: 90_000 });

  const { pages, selection } = fixture();
  const big = Array.from({ length: 4 }, (_, index) => ({ ...pages[1], alias: `B${index}`, exactText: "x".repeat(30_000) }));
  selection.units[0].pageAliases = big.map((page) => page.alias);
  const input = { value: selection, pages: [...pages, ...big], unitIds: ["SU9"], sourceIds: ["propagation", "practice"] };
  assert.deepEqual(planningEvidenceSelectionProblems({ ...input, budget: { total: 240_000, perRecord: null } }), []);
  assert.match(
    planningEvidenceSelectionProblems({ ...input, budget: planningEvidenceCharBudget(17, true) }).join(";"),
    /SU9 selects 4 pages with 120000 characters; one record may hold at most 90000\. Remove at least 30000/,
  );
});

test("a quote joined from verbatim slide bullets passes; a doctored one does not", async () => {
  const { verbatimQuoteOf } = await import("../src/lib/learn-planning-evidence.ts");
  const page = "- Power spectral density (PSD): Describes the power content of signals and noise in a communication system.\n\n- Average normalized power\n$$P=x$$\ni.e.,\n\n- the area under the PSD is the normalized average power.\n";
  assert.equal(verbatimQuoteOf(
    "Power spectral density (PSD): Describes the power content of signals and noise in a communication system.\n\n- the area under the PSD is the normalized average power.",
    page,
  ), true);
  assert.equal(verbatimQuoteOf("Describes the power content ... the normalized average power", page), true);
  assert.equal(verbatimQuoteOf("Describes the power content of signals in a communication system.", page), false, "a skipped word inside a piece still fails");
  assert.equal(verbatimQuoteOf("PSD\n- power", page), false, "pieces must be at least three words");
});

test("a heading may prove a formula slide with no prose, never a prose page", async () => {
  const { sparseProsePage, sourceMapEvidenceProblems: problemsOf } = await import("../src/lib/learn-planning-evidence.ts");
  assert.equal(sparseProsePage("\n$$P_s(f)=\frac{1}{4}[P_g(f-f_c)]$$\nwhere $P_g$ is real\n"), true);
  assert.equal(sparseProsePage("Water molecules absorb energy from a radio wave. The loss depends on frequency and moisture and increases with the distance travelled through the atmosphere."), false);

  const { pages, selection, sourceMap } = fixture();
  pages[1].exactText = "## Page 107\n### BPSK Power spectral density\n$$P_g(f)=A^2 T_b\,\mathrm{sinc}^2(fT_b)$$\n";
  sourceMap.unitEvidence[0].pages[0].quote = "BPSK Power spectral density";
  assert.doesNotMatch(sourceMapEvidenceProblems({ value: sourceMap, selection, pages }).join(";"), /heading line/);
});

test("a partitioned selection may run modestly over its total; a single-call map may not", async () => {
  const { planningEvidenceCharBudget } = await import("../src/lib/learn-planning-evidence.ts");
  const { pages, selection } = fixture();
  const big = Array.from({ length: 4 }, (_, index) => ({ ...pages[1], alias: `C${index}`, exactText: "x".repeat(65_000) }));
  selection.units[0].pageAliases = big.slice(0, 2).map((page) => page.alias);
  selection.practiceSources[1].pageAliases = [...selection.practiceSources[1].pageAliases, ...big.slice(2).map((page) => page.alias)];
  const input = { value: selection, pages: [...pages, ...big], unitIds: ["SU9"], sourceIds: ["propagation", "practice"] };
  // ~260k total: 8% over a 240k partitioned budget passes, over a single-call 240k fails.
  assert.doesNotMatch(planningEvidenceSelectionProblems({ ...input, budget: planningEvidenceCharBudget(2, true) }).join(";"), /characters of page text/);
  assert.match(planningEvidenceSelectionProblems({ ...input, budget: planningEvidenceCharBudget(2, false) }).join(";"), /characters of page text; the limit is 240000/);
});

test("only records for supplied teachable units survive selection", async () => {
  const { keepTeachableUnitRecords } = await import("../src/lib/learn-planning-evidence.ts");
  const kept = keepTeachableUnitRecords({ units: [{ unitId: "SU1" }, { unitId: "SU13" }, { unitId: "SU8a" }], practiceSources: [] }, ["SU1", "SU2"]);
  assert.deepEqual(kept.units.map((unit) => unit.unitId), ["SU1"]);
});

test("a stored selection is rechecked with the partitioned budget it was accepted under", () => {
  // Live 2026-10-01 (gpt-6-sol, telecom-1 M1): an accepted 642k selection was
  // rejected at generation start against the single-call 240k limit.
  const pages = Array.from({ length: 12 }, (_, index) => ({
    alias: `p${index}`, anchorId: `a${index}`, sourceId: "s1", page: index + 1, exactText: "x".repeat(25_000),
  }));
  const value = {
    units: [{ unitId: "SU1", pageAliases: pages.slice(0, 6).map((page) => page.alias), reason: "teaches it" }],
    practiceSources: [{ sourceId: "s1", disposition: "selected", pageAliases: pages.slice(6).map((page) => page.alias), reason: "exercises" }],
  };
  const sourceMap = { teachingEvidencePolicy: PLANNING_EVIDENCE_VERSION, teachingEvidenceSelection: value };
  const problems = persistedPlanningEvidenceProblems({ sourceMap, pages, unitIds: ["SU1"], sourceIds: ["s1"] });
  assert.equal(problems.some((problem) => /characters of page text; the limit is 240000/.test(problem)), false);
});

import assert from "node:assert/strict";
import test from "node:test";

await import("../scripts/learn-worker-import-hook.mjs");
const {
  createSourceCompletenessCritic,
  parseSourceCompletenessGaps,
  unassignedSourceAnchors,
} = await import("../src/lib/learn-source-completeness.ts");

// telecom-1 (2026-10-18): finished modules missed slide formulas, values, whole
// slides and figures because nothing compared the finished lessons with the full
// source pages. Two lessons share one slide page here; a third page is unbound.
const anchor = (id, page, text) => ({ id, kind: "guidance", title: id, page, sourceId: "deck", origin: "structural_ledger", exactText: text });
const page = (n, anchors, body) => ({
  rel: `learning/1. S/1.${n} L${n}.md`, abs: "", title: `1.${n} L${n}`, sectionNumber: 1, subsectionNumber: `1.${n}`,
  learningUnitId: `u${n}`, learningUnitRole: "core", tags: [], sourceAnchors: anchors, sourceFormulaAnchors: [], sourceVisualIds: [],
  visualIds: [], formulas: [], rawFrontmatter: "", body, lastSemanticRepairAt: "",
});
const state = () => ({
  rootPath: "", slug: "g",
  pages: [page(1, ["text-deck-page-1"], "Lesson one about channel capacity."), page(2, ["text-deck-page-1"], "Shannon: C/B = log2(1+S/N).")],
  sections: [],
  learningUnitContract: { units: [], assignments: [] },
  sourceAnchors: {
    "text-deck-page-1": anchor("text-deck-page-1", 1, "Capacity C = B log2(1+S/N). Multilevel signalling approaches it."),
    "text-deck-page-2": anchor("text-deck-page-2", 2, "Cell splitting divides a cell into smaller cells."),
    "text-other-page-1": { ...anchor("text-other-page-1", 1, "unrelated deck"), sourceId: "other" },
  },
  sourceUsages: [], visuals: [], formulas: [], zettelHandles: [], planningDocs: {},
});

test("gaps keep only anchors bound to the page", () => {
  const gaps = parseSourceCompletenessGaps('```json\n{"gaps":[{"type":"slide","severity":"must","what":"x","anchorId":"foreign"}]}\n```', new Set(["a"]));
  assert.equal(gaps[0].anchorId, null);
});

test("unbound pages are limited to the run's sources", () => {
  assert.deepEqual(unassignedSourceAnchors(state()).map((a) => a.id), ["text-deck-page-2"]);
});

test("only gaps no lesson teaches become blocking issues, and repeats become warnings", async () => {
  const calls = [];
  const review = async (request) => {
    calls.push(request.kind);
    if (request.kind === "page_review") {
      return request.pageId.includes("1.1")
        ? '{"gaps":[{"type":"slide","severity":"must","what":"Shannon limit C/B","anchorId":"text-deck-page-1"},{"type":"slide","severity":"must","what":"multilevel signalling approaches the limit","anchorId":"text-deck-page-1"}]}'
        : '{"gaps":[]}';
    }
    if (request.kind === "unassigned") return '{"pages":[{"anchorId":"text-deck-page-2","verdict":"missing","lesson":"learning/1. S/1.2 L2.md","what":"cell splitting"}]}';
    // verification: lesson 1.2 teaches the Shannon limit; the rest is missing
    return request.user.includes("Shannon limit C/B")
      ? '{"verdicts":[{"n":1,"verdict":"taught","lesson":"learning/1. S/1.2 L2.md"},{"n":2,"verdict":"missing"}]}'
      : '{"verdicts":[{"n":1,"verdict":"missing"}]}';
  };
  const critic = createSourceCompletenessCritic({ gardenDir: "", gardenSlug: "g", review, loadState: state });
  const first = await critic({});
  assert.deepEqual(first.map((i) => [i.type, i.severity, i.pagePath, i.problem.includes("multilevel") || i.problem.includes("cell splitting")]), [
    ["source_teaching_gap", "blocking", "learning/1. S/1.1 L1.md", true],
    ["source_teaching_gap", "blocking", "learning/1. S/1.2 L2.md", true],
  ]);
  assert.ok(first.every((i) => i.repairTarget === "unit_page" && i.sourceAnchorIds.length === 1));
  const reviewsBefore = calls.length;
  await critic({});
  assert.equal(calls.length, reviewsBefore, "unchanged pages are not reviewed again");
  const third = await critic({});
  assert.ok(third.every((i) => i.severity === "warning"), "a gap still reported after two repairs stops blocking");
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildFinalGardenState } from "../src/lib/final-garden-state.ts";
import {
  auditFormulaProjections,
  buildCanonicalFormulaUsageIndex,
  buildFormulaUsageRepairPacket,
  deriveFormulaConceptUsage,
  parseFormulaMetadataEntries,
  reconcileFinalFormulaProjections,
  reconcileFinalFormulaProjectionsDeterministic,
  renderSourceCoverageFromFinalState,
  resolveWorkedExampleLineage,
  stableWorkedExampleIdentity,
  verifyFormulaUsageRepairDecision,
} from "../src/lib/formula-usage-reconciliation.ts";

const E6 = "S1.P6.E6";
const E5 = "S1.P6.E5";
const CONVERGENCE = "E_{\\mathrm{conv}} = \\min \\{e \\mid A(e) \\geq A_{\\mathrm{target}}\\}";
const EFFICIENCY = "\\eta = \\frac{\\mathrm{Accuracy}}{E_{\\mathrm{energy}}}";

const roots = [];
test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function unit(id, title, family, formulaIds = []) {
  return {
    id,
    title,
    role: formulaIds.length ? "formula" : "core_concept",
    learningQuestion: family === "convergence"
      ? "How does the target accuracy threshold identify the first convergence epoch?"
      : family === "efficiency"
        ? "How does accuracy per energy define normalized efficiency?"
        : "How are spike events represented over time?",
    prerequisiteConcepts: [],
    newConcepts: family === "convergence"
      ? ["Convergence epoch", "Target accuracy threshold", "Training progress"]
      : family === "efficiency"
        ? ["Normalized energy efficiency", "Accuracy", "Energy"]
        : ["Spike event", "Event timing"],
    sourceAnchors: [...formulaIds],
    sourceFigures: [],
    sourceFormulas: formulaIds.map((idValue) => ({
      id: idValue,
      teachingGoal: family === "convergence" ? "Define the first epoch reaching target accuracy." : "Define accuracy per energy.",
      termsToDefine: [],
      placement: "before_example",
    })),
    sourceTables: [],
    zettelNotes: [],
    semanticConcepts: [],
    knowledgeClaims: [],
    mustNotRepeat: [],
    expectedWordRange: [100, 500],
  };
}

function formulaYaml(entry) {
  const lines = [
    `  - kind: ${JSON.stringify(entry.kind)}`,
    `    text: ${JSON.stringify(entry.text)}`,
    `    groundingStatus: ${JSON.stringify(entry.groundingStatus ?? "conceptual-helper")}`,
  ];
  for (const key of ["sourceAnchor", "basedOnFormula", "formulaFamily", "exampleGroupId", "justification", "matchReason"]) {
    if (entry[key]) lines.push(`    ${key}: ${JSON.stringify(entry[key])}`);
  }
  return lines.join("\n");
}

function writePage(root, spec) {
  const dir = path.join(root, "learning", spec.section ?? "1. Metrics");
  fs.mkdirSync(dir, { recursive: true });
  const rel = `learning/${spec.section ?? "1. Metrics"}/${spec.file ?? `1.1 ${spec.title}.md`}`;
  const abs = path.join(root, ...rel.split("/"));
  const formulas = spec.entries?.length ? `formulas:\n${spec.entries.map(formulaYaml).join("\n")}` : "formulas: []";
  fs.writeFileSync(abs, `---
title: ${JSON.stringify(spec.title)}
knowledge_type: "learning-page"
breadboardType: "learning_page"
generated_by: "learn_button"
learningUnitId: ${JSON.stringify(spec.unitId)}
learningUnitRole: "formula"
sectionNumber: 1
subsectionNumber: "1.1"
tags: []
sourceAnchors: ${JSON.stringify(spec.sourceAnchors ?? [])}
sourceFormulaAnchors: ${JSON.stringify(spec.sourceFormulaAnchors ?? [])}
sourceVisualIds: []
visualIds: []
${formulas}
---

${spec.body}
`, "utf-8");
  return rel;
}

function makeGarden(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-formula-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(root, "sources"), { recursive: true });
  const units = options.units ?? [unit("U1", "Convergence Epoch and Training Progress", "convergence", [E6])];
  const pages = options.pages ?? [{
    unitId: "U1",
    title: "Convergence Epoch and Training Progress",
    sourceAnchors: [E6],
    sourceFormulaAnchors: options.sourceFormulaAnchors ?? [],
    entries: options.entries ?? [],
    body: options.body ?? `The convergence epoch is the first training epoch at which accuracy reaches a chosen target threshold.\n\n$$${CONVERGENCE}$$`,
  }];
  const rels = pages.map((page) => writePage(root, page));
  const assignments = options.assignments ?? units.flatMap((u) => u.sourceFormulas.map((formula) => ({
    sourceArtifactId: formula.id,
    assignedLearningUnitId: u.id,
    placement: "before_example",
    reason: "canonical test assignment",
    requiredInterpretation: formula.teachingGoal,
  })));
  fs.writeFileSync(path.join(root, ".breadboard", "learning-unit-contract.json"), `${JSON.stringify({ learningUnits: units, sourceArtifactAssignments: assignments }, null, 2)}\n`);
  const visuals = options.visuals ?? [
    { sourceVisualId: E6, sourceId: "source", pageNumber: 6, type: "equation", caption: "Convergence epoch satisfying the target accuracy threshold", exactText: CONVERGENCE, conceptUsage: options.conceptUsage ?? "explained_as_text_formula", cropStatus: "omitted_unreliable", usageStatus: "assigned" },
    { sourceVisualId: E5, sourceId: "source", pageNumber: 6, type: "equation", caption: "Normalized energy efficiency as accuracy per energy", exactText: EFFICIENCY, conceptUsage: "missing", cropStatus: "omitted_unreliable", usageStatus: "unassigned" },
  ];
  fs.writeFileSync(path.join(root, ".breadboard", "source-visuals.json"), `${JSON.stringify(visuals, null, 2)}\n`);
  fs.writeFileSync(path.join(root, ".breadboard", "planning", "Source Coverage.md"), options.coverage ?? "# Source Coverage\n\n## Explained as Text Formulas\n\n- None.\n\n## Missing or Misplaced\n\n- stale-content\n");
  fs.writeFileSync(path.join(root, "sources", "source.md"), "# Page 6\n\n```text\nConvergence Time = Epochmin where Accuracyepoch >= Target Accuracy   (6)\n```\n");
  return { root, rels };
}

function stateFor(root) {
  return buildFinalGardenState(root, "fixture");
}

test("1. compatible required formula missing from page is added from canonical evidence", () => {
  const { root } = makeGarden();
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  const page = stateFor(root).pages[0];
  assert.equal(result.definitionsAdded, 1);
  assert.equal(page.formulas[0].sourceAnchor, E6);
  assert.equal(page.formulas[0].text, CONVERGENCE);
});

test("2. existing symbolic formula receives its missing source anchor", () => {
  const { root } = makeGarden({ entries: [{ kind: "conceptual_helper", text: CONVERGENCE }] });
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  const page = stateFor(root).pages[0];
  assert.equal(result.definitionsLinked, 1);
  assert.deepEqual(page.sourceFormulaAnchors, [E6]);
  assert.equal(page.formulas[0].sourceAnchor, E6);
});

test("3. numeric example is not promoted to source definition", () => {
  const { root } = makeGarden({
    visuals: [{ sourceVisualId: E6, sourceId: "", pageNumber: 6, type: "equation", caption: "Convergence epoch satisfying target accuracy", conceptUsage: "missing" }],
    entries: [{ kind: "worked_example", text: "e_{conv}=8", formulaFamily: "convergence" }],
  });
  reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.equal(stateFor(root).pages[0].formulas.some((entry) => entry.declaredKind === "source_definition"), false);
});

test("4. incompatible contract assignment is replaced by a verified page-family formula", () => {
  const units = [unit("U1", "Normalized Energy Efficiency", "efficiency", [E6])];
  const { root } = makeGarden({ units, pages: [{ unitId: "U1", title: "Normalized Energy Efficiency", entries: [], sourceAnchors: [], sourceFormulaAnchors: [], body: `Efficiency is accuracy per energy. $$${EFFICIENCY}$$` }] });
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.equal(result.incompatibleAssignmentsFound, 1);
  assert.equal(result.assignmentsReplaced, 1);
  assert.deepEqual(stateFor(root).pages[0].sourceFormulaAnchors, [E5]);
  assert.equal(stateFor(root).pages[0].sourceFormulaAnchors.includes(E6), false);
});

test("5. unambiguous incompatible assignment moves to the correct unit", () => {
  const units = [unit("U1", "Normalized Energy Efficiency", "efficiency", [E6]), unit("U2", "Convergence Epoch", "convergence", [])];
  const pages = [
    { unitId: "U1", title: "Normalized Energy Efficiency", file: "1.1 Normalized Energy Efficiency.md", entries: [], body: `Efficiency is accuracy per energy. $$${EFFICIENCY}$$` },
    { unitId: "U2", title: "Convergence Epoch", file: "1.2 Convergence Epoch.md", entries: [{ kind: "conceptual_helper", text: CONVERGENCE }], body: `The first epoch reaching target accuracy is convergence. $$${CONVERGENCE}$$` },
  ];
  const { root } = makeGarden({ units, pages, visuals: [{ sourceVisualId: E6, sourceId: "source", pageNumber: 6, type: "equation", caption: "Convergence epoch satisfying the target accuracy threshold", exactText: CONVERGENCE, conceptUsage: "missing" }] });
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  const state = stateFor(root);
  assert.equal(result.contractAssignmentsRepaired, 1);
  assert.equal(state.learningUnitContract.assignments.find((assignment) => assignment.sourceArtifactId === E6).assignedLearningUnitId, "U2");
  assert.deepEqual(state.pages.find((page) => page.learningUnitId === "U2").sourceFormulaAnchors, [E6]);
});

test("6. ambiguous assignment routes to ChatMock with a narrow packet", async () => {
  const units = [unit("U1", "Energy Efficiency", "efficiency", [E6]), unit("U2", "Convergence One", "convergence", []), unit("U3", "Convergence Two", "convergence", [])];
  const pages = units.map((u, index) => ({ unitId: u.id, title: u.title, file: `1.${index + 1} ${u.title}.md`, entries: [], body: u.id === "U1" ? `Efficiency. $$${EFFICIENCY}$$` : `The convergence epoch is the first epoch reaching target accuracy. $$${CONVERGENCE}$$` }));
  const { root } = makeGarden({ units, pages, visuals: [{ sourceVisualId: E6, sourceId: "source", pageNumber: 6, type: "equation", caption: "Convergence epoch satisfying the target accuracy threshold", exactText: CONVERGENCE, conceptUsage: "missing" }] });
  let packet;
  const result = await reconcileFinalFormulaProjections(root, "fixture", { maxChatMockCalls: 1, strictMode: false, formulaRepairModel: async (value) => { packet = value; return { action: "reject_formula_usage", reason: "ambiguous target units" }; } });
  assert.equal(result.chatMockCallsUsed, 1);
  assert.equal(packet.issue, "contract_formula_compatibility");
  assert.equal(Object.hasOwn(packet, "sourceCoverage"), false);
});

test("7. worked example with one compatible definition receives basedOnFormula", () => {
  const { root } = makeGarden({ sourceFormulaAnchors: [E6], entries: [{ kind: "source_definition", text: CONVERGENCE, groundingStatus: "source-anchored", sourceAnchor: E6 }, { kind: "worked_example", text: "e_{conv}=8", formulaFamily: "convergence" }] });
  const state = stateFor(root); const page = state.pages[0]; const index = buildCanonicalFormulaUsageIndex(root, state);
  const decision = resolveWorkedExampleLineage(parseFormulaMetadataEntries(page.rawFrontmatter)[1], page, index, state);
  assert.equal(decision.action, "assign_lineage");
  assert.equal(decision.basedOnFormula, E6);
});

test("8. worked example with identifiable family receives implicit lineage", () => {
  const { root } = makeGarden({ entries: [{ kind: "worked_example", text: "A(8)=91\\%", formulaFamily: "convergence" }] });
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.equal(result.definitionsAdded, 1);
  assert.equal(stateFor(root).pages[0].formulas.some((entry) => entry.declaredKind === "worked_example" && entry.formulaFamily === "convergence"), true);
});

test("9. informal timing notation is reclassified as conceptual helper", () => {
  const { root } = makeGarden({ units: [unit("U1", "Spikes and Timing", "timing", [])], assignments: [], pages: [{ unitId: "U1", title: "Spikes and Timing", entries: [{ kind: "worked_example", text: "A = 0,\\;1,\\;0,\\;0,\\;1,\\;0" }], body: "A spike-time sequence illustrates sparse event timing." }] });
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.equal(result.workedExamplesReclassified, 1);
  assert.equal(stateFor(root).pages[0].formulas[0].declaredKind, "conceptual_helper");
});

test("10. trivial expression is removed from metadata while remaining in body", () => {
  const body = "The learner-facing illustration $x$ remains here.";
  const { root } = makeGarden({ units: [unit("U1", "Timing", "timing", [])], assignments: [], pages: [{ unitId: "U1", title: "Timing", entries: [{ kind: "worked_example", text: "x" }], body }] });
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.equal(result.metadataEntriesRemoved, 1);
  assert.equal(stateFor(root).pages[0].formulas.length, 0);
  assert.match(stateFor(root).pages[0].body, /\$x\$/);
});

test("11. two plausible definitions route worked-example lineage to ChatMock", () => {
  const units = [unit("U1", "Convergence Thresholds", "convergence", [E6, "S1.P7.E1"])];
  const visuals = [{ sourceVisualId: E6, sourceId: "source", pageNumber: 6, type: "equation", caption: "Convergence threshold", exactText: CONVERGENCE }, { sourceVisualId: "S1.P7.E1", sourceId: "source", pageNumber: 7, type: "equation", caption: "Convergence threshold crossing", exactText: "e_* = \\min \\{e: A(e) \\geq \\tau\\}" }];
  const entries = [{ kind: "source_definition", text: CONVERGENCE, groundingStatus: "source-anchored", sourceAnchor: E6 }, { kind: "source_definition", text: "e_* = \\min \\{e: A(e) \\geq \\tau\\}", groundingStatus: "source-anchored", sourceAnchor: "S1.P7.E1" }, { kind: "worked_example", text: "e_*=8", formulaFamily: "convergence" }];
  const { root } = makeGarden({ units, visuals, sourceFormulaAnchors: [E6, "S1.P7.E1"], entries });
  const state = stateFor(root); const page = state.pages[0]; const index = buildCanonicalFormulaUsageIndex(root, state);
  assert.equal(resolveWorkedExampleLineage(parseFormulaMetadataEntries(page.rawFrontmatter)[2], page, index, state).action, "needs_chatmock");
});

test("12. ChatMock cannot invent a definition anchor", () => {
  const { root } = makeGarden(); const state = stateFor(root); const index = buildCanonicalFormulaUsageIndex(root, state);
  const issue = auditFormulaProjections(state, index)[0];
  const packet = buildFormulaUsageRepairPacket({ id: issue.id, type: "formula_usage_projection", severity: "blocking", pagePath: issue.pagePath, unitId: issue.unitId, anchorId: issue.anchorId, message: issue.subproblems.join(","), evidence: {}, repairMode: "deterministic_then_chatmock" }, state, index);
  assert.equal(verifyFormulaUsageRepairDecision(packet, { action: "attach_existing_formula", formulaAnchorId: "S9.P9.E9", entryIndex: 0, reason: "invent" }, state).accepted, false);
});

test("13. explained_as_text_formula anchor appears in the correct coverage section", () => {
  const { root } = makeGarden({ sourceFormulaAnchors: [E6], entries: [{ kind: "source_definition", text: CONVERGENCE, groundingStatus: "source-anchored", sourceAnchor: E6 }] });
  const state = stateFor(root);
  state.sourceUsages.push({ anchorId: E6, pageRel: state.pages[0].rel, kind: "visual_grounding" });
  const rendered = renderSourceCoverageFromFinalState(state, buildCanonicalFormulaUsageIndex(root, state));
  assert.match(rendered.match(/## Explained as Text Formulas([\s\S]*?)## Explained in Prose/)[1], /S1\.P6\.E6/);
  assert.match(rendered.match(/## Used as Interactive Grounding([\s\S]*?)## Referenced Again in Synthesis/)[1], /S1\.P6\.E6/);
  assert.match(rendered, /S1\.P6\.E6: assigned to U1\b/);
});

test("13b. coverage audit does not truncate at a z before later formula anchors", () => {
  const visuals = [
    { sourceVisualId: E5, sourceId: "source", pageNumber: 6, type: "equation", caption: "Normalized energy efficiency as accuracy per energy", exactText: EFFICIENCY, conceptUsage: "explained_as_text_formula", usageStatus: "assigned" },
    { sourceVisualId: E6, sourceId: "source", pageNumber: 6, type: "equation", caption: "Convergence epoch satisfying the target accuracy threshold", exactText: CONVERGENCE, conceptUsage: "explained_as_text_formula", usageStatus: "assigned" },
  ];
  const entries = [
    { kind: "source_definition", text: EFFICIENCY, groundingStatus: "source-anchored", sourceAnchor: E5 },
    { kind: "source_definition", text: CONVERGENCE, groundingStatus: "source-anchored", sourceAnchor: E6 },
  ];
  const { root } = makeGarden({ visuals, sourceFormulaAnchors: [E5, E6], entries });
  const state = stateFor(root);
  fs.writeFileSync(
    path.join(root, ".breadboard", "planning", "Source Coverage.md"),
    renderSourceCoverageFromFinalState(state, buildCanonicalFormulaUsageIndex(root, state)),
  );
  assert.deepEqual(
    auditFormulaProjections(stateFor(root)).filter((issue) => issue.subproblems.includes("ledger_coverage_mismatch")),
    [],
  );
});

test("14. changing page usage regenerates the ledger mode", () => {
  const { root } = makeGarden({ conceptUsage: "missing", sourceFormulaAnchors: [E6], entries: [{ kind: "source_definition", text: CONVERGENCE, groundingStatus: "source-anchored", sourceAnchor: E6 }] });
  reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  const ledger = JSON.parse(fs.readFileSync(path.join(root, ".breadboard", "source-visuals.json"), "utf-8"));
  assert.equal(ledger.find((entry) => entry.sourceVisualId === E6).conceptUsage, "explained_as_text_formula");
});

test("15. changing stale ledger mode regenerates Source Coverage", () => {
  const { root } = makeGarden({ conceptUsage: "intentionally_omitted", sourceFormulaAnchors: [E6], entries: [{ kind: "source_definition", text: CONVERGENCE, groundingStatus: "source-anchored", sourceAnchor: E6 }] });
  reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.match(fs.readFileSync(path.join(root, ".breadboard", "planning", "Source Coverage.md"), "utf-8"), /Explained as Text Formulas[\s\S]*S1\.P6\.E6/);
});

test("16. stale Source Coverage content is replaced, not incrementally merged", () => {
  const { root } = makeGarden({ coverage: "# Source Coverage\n\nSTALE SENTINEL\n" });
  reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.doesNotMatch(fs.readFileSync(path.join(root, ".breadboard", "planning", "Source Coverage.md"), "utf-8"), /STALE SENTINEL/);
});

test("17. Source Coverage generation is idempotent", () => {
  const { root } = makeGarden();
  reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  const first = fs.readFileSync(path.join(root, ".breadboard", "planning", "Source Coverage.md"), "utf-8");
  reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.equal(fs.readFileSync(path.join(root, ".breadboard", "planning", "Source Coverage.md"), "utf-8"), first);
});

test("18. page metadata, sourceFormulaAnchors, ledger, and coverage update together", () => {
  const { root, rels } = makeGarden({ entries: [{ kind: "conceptual_helper", text: CONVERGENCE }], conceptUsage: "missing" });
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.ok(result.changedFiles.includes(rels[0]));
  assert.ok(result.changedFiles.includes(".breadboard/source-visuals.json"));
  assert.ok(result.changedFiles.includes(".breadboard/planning/Source Coverage.md"));
});

test("19. failed compatibility validation leaves page and contract unchanged", () => {
  const units = [unit("U1", "Energy Efficiency", "efficiency", [E6])];
  const { root } = makeGarden({ units, pages: [{ unitId: "U1", title: "Energy Efficiency", entries: [], body: `Efficiency is accuracy per energy. $$${EFFICIENCY}$$` }], visuals: [{ sourceVisualId: E6, sourceId: "source", pageNumber: 6, type: "equation", caption: "Convergence epoch satisfying the target accuracy threshold", exactText: CONVERGENCE, conceptUsage: "missing" }] });
  const contractPath = path.join(root, ".breadboard", "learning-unit-contract.json");
  const before = fs.readFileSync(contractPath, "utf-8");
  reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.equal(fs.readFileSync(contractPath, "utf-8"), before);
  assert.deepEqual(stateFor(root).pages[0].sourceFormulaAnchors, []);
});

test("20. invalid ChatMock decision cannot introduce a new blocker or mutation", async () => {
  const { root } = makeGarden();
  await reconcileFinalFormulaProjections(root, "fixture", { maxChatMockCalls: 1, strictMode: false, formulaRepairModel: async () => ({ action: "attach_existing_formula", formulaAnchorId: "S9.P9.E9", entryIndex: 0, reason: "invented" }) });
  assert.equal(JSON.stringify(stateFor(root).pages[0].sourceFormulaAnchors), JSON.stringify([E6]));
  assert.equal(auditFormulaProjections(stateFor(root)).some((issue) => issue.anchorId === "S9.P9.E9"), false);
});

test("21. successful repair decreases the stable blocker count", () => {
  const { root } = makeGarden({ entries: [{ kind: "conceptual_helper", text: CONVERGENCE }] });
  const before = auditFormulaProjections(stateFor(root)).length;
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  const after = auditFormulaProjections(stateFor(root)).length;
  assert.ok(after < before);
  assert.equal(result.rolledBack, false);
});

test("22. reconciliation is idempotent", () => {
  const { root } = makeGarden({ entries: [{ kind: "conceptual_helper", text: CONVERGENCE }] });
  reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  const second = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  assert.deepEqual(second.changedFiles, []);
});

test("current regression: E6 and two orphan spike sequences reconcile as one formula projection plus stable examples", () => {
  const pages = [
    { unitId: "U0", title: "Spikes, Timing, and Event-Driven Computation", file: "1.2 Spikes, Timing, and Event-Driven Computation.md", entries: [{ kind: "worked_example", text: "A = 0,\\;1,\\;0,\\;0,\\;1,\\;0" }, { kind: "worked_example", text: "B = 0,\\;0,\\;0,\\;1,\\;0,\\;1" }], body: "These binary spike-time sequences illustrate event timing." },
    { unitId: "U1", title: "Convergence Epoch and Training Progress", file: "2.4 Convergence Epoch and Training Progress.md", section: "2. Metrics", sourceAnchors: [E6], entries: [{ kind: "conceptual_helper", text: CONVERGENCE }], body: `The convergence epoch is the first epoch reaching target accuracy. $$${CONVERGENCE}$$` },
  ];
  const units = [unit("U0", "Spikes, Timing, and Event-Driven Computation", "timing", []), unit("U1", "Convergence Epoch and Training Progress", "convergence", [E6])];
  const { root } = makeGarden({ units, pages, conceptUsage: "explained_as_text_formula" });
  const before = auditFormulaProjections(stateFor(root));
  const orphanEntries = parseFormulaMetadataEntries(stateFor(root).pages.find((page) => page.learningUnitId === "U0").rawFrontmatter);
  assert.notEqual(stableWorkedExampleIdentity(pages[0].file, orphanEntries[0]), stableWorkedExampleIdentity(pages[0].file, orphanEntries[1]));
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  const state = stateFor(root);
  assert.ok(before.length >= 3);
  assert.equal(result.definitionsLinked, 1);
  assert.equal(result.workedExamplesReclassified, 2);
  assert.deepEqual(state.pages.find((page) => page.learningUnitId === "U1").sourceFormulaAnchors, [E6]);
  assert.equal(state.pages.find((page) => page.learningUnitId === "U0").formulas.every((entry) => entry.declaredKind === "conceptual_helper"), true);
  assert.match(state.planningDocs.sourceCoverage, /Explained as Text Formulas[\s\S]*S1\.P6\.E6/);
  assert.deepEqual(auditFormulaProjections(state), []);
});

test("usage-mode derivation does not preserve a stale ledger claim", () => {
  assert.equal(deriveFormulaConceptUsage({ formulaAnchorId: E6, unitId: "U1", pagePath: "p", requiredByContract: true, modes: ["source_definition"], workedExamples: [], problems: [] }), "explained_as_text_formula");
});

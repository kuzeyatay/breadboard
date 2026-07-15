import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildFinalGardenState } from "../src/lib/final-garden-state.ts";
import {
  assertFormulaAssignmentCompatible,
  buildFormulaIdentityRepairPacket,
  findCompatibleFormulaAssignments,
  verifyCanonicalFormulaIdentity,
  verifyFormulaIdentityRepairDecision,
} from "../src/lib/formula-identity.ts";
import { reconcileFinalFormulaProjectionsDeterministic } from "../src/lib/formula-usage-reconciliation.ts";

const roots = [];
test.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function anchor(id, exactText, title, formulaFamily) {
  return { id, kind: "formula", title, caption: title, exactText, formulaFamily, origin: "visual_ledger" };
}

function unit(id, title, question, concepts, formulas = []) {
  return {
    id, title, role: "metric", learningQuestion: question,
    prerequisiteConcepts: [], newConcepts: concepts, sourceAnchors: [...formulas],
    sourceFigures: [], sourceFormulas: formulas.map((formulaId) => ({
      id: formulaId, teachingGoal: question, termsToDefine: concepts, placement: "before_example",
    })),
    sourceTables: [], zettelNotes: [], semanticConcepts: [], knowledgeClaims: [],
    mustNotRepeat: [], expectedWordRange: [100, 500],
  };
}

function page(unitId, title, family, text, sourceFormulaAnchors = []) {
  return {
    rel: `learning/1. Metrics/1.1 ${title}.md`, abs: "", title, sectionNumber: 1,
    subsectionNumber: "1.1", learningUnitId: unitId, learningUnitRole: "metric", tags: [],
    sourceAnchors: [...sourceFormulaAnchors], sourceFormulaAnchors: [...sourceFormulaAnchors],
    sourceVisualIds: [], visualIds: [],
    formulas: [{ pageRel: "", entryIndex: 0, text, declaredKind: "source_definition", structuralKind: "definition", groundingStatus: "source-anchored", formulaFamily: family }],
    rawFrontmatter: "", body: `${title}. ${text}`, lastSemanticRepairAt: "",
  };
}

test("1. spike-count structure is classified as spike_count", () => {
  const identity = verifyCanonicalFormulaIdentity(anchor("A", "N_{spikes}=\\sum_{t=1}^{T}\\sum_i s_i(t)", "Activity"), ".");
  assert.equal(identity.family, "spike_count");
  assert.equal(identity.verified, true);
});

test("2. decision-time subtraction is classified as latency", () => {
  assert.equal(verifyCanonicalFormulaIdentity(anchor("A", "L=t_{decision}-t_{onset}", "Response time"), ".").family, "latency");
});

test("3. latency mentioning the first output spike remains latency", () => {
  assert.equal(verifyCanonicalFormulaIdentity(anchor("A", "L=t_{first_output_spike}-t_{onset}", "Response latency"), ".").family, "latency");
});

test("4. spike count summed over time does not become latency", () => {
  assert.equal(verifyCanonicalFormulaIdentity(anchor("A", "N_{spikes}=\\sum_{t=1}^{T}s(t)", "Events over time"), ".").family, "spike_count");
});

test("5. exact structure outweighs an ambiguous/wrong caption", () => {
  const identity = verifyCanonicalFormulaIdentity(anchor("A", "L=t_{decision}-t_{onset}", "Total spikes over time", "spike-count"), ".");
  assert.equal(identity.family, "latency");
  assert.match(identity.problems.join(" "), /conflicts/);
});

test("6. energy, efficiency, accuracy, and convergence structures remain distinct", () => {
  const cases = [
    ["E_{total}=N_{spikes}E_{spike}+N_{synops}E_{synop}", "Energy", "energy"],
    ["eta=Accuracy/Energy", "Normalized efficiency", "energy_efficiency"],
    ["Accuracy=N_{correct}/N_{total}", "Classification", "accuracy"],
    ["e_*=\\min\\{e:A(e)>=A_{target}\\}", "Training convergence", "convergence"],
  ];
  for (const [text, title, expected] of cases) assert.equal(verifyCanonicalFormulaIdentity(anchor("A", text, title), ".").family, expected);
});

test("7. ambiguous structure remains unresolved", () => {
  const identity = verifyCanonicalFormulaIdentity(anchor("A", "x=y+z", "A relation"), ".");
  assert.equal(identity.family, "other");
  assert.equal(identity.verified, false);
});

test("8. a spike-count identity is rejected for a latency unit/page", () => {
  const identity = verifyCanonicalFormulaIdentity(anchor("E2", "N_{spikes}=\\sum_t s(t)", "Total spike count"), ".");
  const u = unit("U1", "Decision Latency", "How long from onset to decision?", ["decision latency"]);
  const p = page("U1", "Decision Latency", "latency", "L=t_{decision}-t_{onset}");
  assert.throws(() => assertFormulaAssignmentCompatible(identity, u, p), /rejected/);
});

test("9. the verified latency anchor is selected deterministically", () => {
  const ids = [
    verifyCanonicalFormulaIdentity(anchor("E1", "L=t_{decision}-t_{onset}", "Decision latency"), "."),
    verifyCanonicalFormulaIdentity(anchor("E2", "N_{spikes}=\\sum_t s(t)", "Total spike count"), "."),
  ];
  const u = unit("U1", "Decision Latency", "How is decision latency measured from stimulus onset?", ["decision time", "stimulus onset"]);
  const p = page("U1", "Decision Latency", "latency", "L=t_{decision}-t_{onset}", ["E1"]);
  const candidates = findCompatibleFormulaAssignments(u, p, ids);
  assert.equal(candidates[0].anchorId, "E1");
  assert.equal(candidates[0].formulaFamilyCompatibility, 1);
  assert.ok(candidates[0].totalScore >= 0.8);
  assert.equal(candidates.find((candidate) => candidate.anchorId === "E2").compatible, false);
});

test("10. no compatible identity leaves no automatic candidate", () => {
  const ids = [verifyCanonicalFormulaIdentity(anchor("E2", "N_{spikes}=\\sum_t s(t)", "Total spike count"), ".")];
  const u = unit("U1", "Decision Latency", "How long is a response?", ["latency"]);
  const p = page("U1", "Decision Latency", "latency", "L=t_{decision}-t_{onset}");
  assert.equal(findCompatibleFormulaAssignments(u, p, ids).some((candidate) => candidate.compatible), false);
});

test("11. ChatMock cannot select an anchor outside its identity packet", () => {
  const current = verifyCanonicalFormulaIdentity(anchor("E2", "N_{spikes}=\\sum_t s(t)", "Total spike count"), ".");
  const latency = verifyCanonicalFormulaIdentity(anchor("E1", "L=t_{decision}-t_{onset}", "Decision latency"), ".");
  const u = unit("U1", "Decision Latency", "How is latency measured?", ["latency"]);
  const p = page("U1", "Decision Latency", "latency", "L=t_{decision}-t_{onset}", ["E1"]);
  const packet = buildFormulaIdentityRepairPacket({ issueId: "issue", currentIdentity: current, unit: u, page: p, candidates: findCompatibleFormulaAssignments(u, p, [latency, current]) });
  const verified = verifyFormulaIdentityRepairDecision(packet, { issueId: "issue", action: "replace_contract_assignment", replacementAnchorId: "INVENTED", confidence: "high", justification: "invent" }, [latency, current]);
  assert.equal(verified.accepted, false);
});

test("12. ChatMock cannot relabel spike count as latency without source support", () => {
  const current = verifyCanonicalFormulaIdentity(anchor("E2", "N_{spikes}=\\sum_t s(t)", "Total spike count"), ".");
  const u = unit("U1", "Decision Latency", "How is latency measured?", ["latency"]);
  const p = page("U1", "Decision Latency", "latency", "L=t_{decision}-t_{onset}");
  const packet = buildFormulaIdentityRepairPacket({ issueId: "issue", currentIdentity: current, unit: u, page: p, candidates: [] });
  const verified = verifyFormulaIdentityRepairDecision(packet, { issueId: "issue", action: "correct_anchor_family", verifiedFamily: "latency", confidence: "high", justification: "page title says latency" }, [current]);
  assert.equal(verified.accepted, false);
});

test("13. a packet-bounded verified replacement is accepted", () => {
  const current = verifyCanonicalFormulaIdentity(anchor("E2", "N_{spikes}=\\sum_t s(t)", "Total spike count"), ".");
  const latency = verifyCanonicalFormulaIdentity(anchor("E1", "L=t_{decision}-t_{onset}", "Decision latency"), ".");
  const u = unit("U1", "Decision Latency", "How is decision latency measured?", ["decision latency"]);
  const p = page("U1", "Decision Latency", "latency", "L=t_{decision}-t_{onset}", ["E1"]);
  const packet = buildFormulaIdentityRepairPacket({ issueId: "issue", currentIdentity: current, unit: u, page: p, candidates: findCompatibleFormulaAssignments(u, p, [latency, current]) });
  const verified = verifyFormulaIdentityRepairDecision(packet, { issueId: "issue", action: "replace_contract_assignment", replacementAnchorId: "E1", confidence: "high", justification: "verified source equation matches latency" }, [latency, current]);
  assert.equal(verified.accepted, true);
});

function yamlFormula(entry) {
  return [
    `  - kind: ${JSON.stringify(entry.kind)}`,
    `    text: ${JSON.stringify(entry.text)}`,
    `    groundingStatus: ${JSON.stringify(entry.groundingStatus ?? "source-anchored")}`,
    ...(entry.sourceAnchor ? [`    sourceAnchor: ${JSON.stringify(entry.sourceAnchor)}`] : []),
    ...(entry.formulaFamily ? [`    formulaFamily: ${JSON.stringify(entry.formulaFamily)}`] : []),
  ].join("\n");
}

function writeFixturePage(root, spec) {
  const dir = path.join(root, "learning", "1. Metrics"); fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `${spec.number} ${spec.title}.md`);
  fs.writeFileSync(abs, `---
title: ${JSON.stringify(`${spec.number} ${spec.title}`)}
knowledge_type: "learning-page"
breadboardType: "learning_page"
generated_by: "learn_button"
gardenId: "fixture"
learningUnitId: ${JSON.stringify(spec.unitId)}
learningUnitRole: "metric"
sectionNumber: 1
subsectionNumber: ${JSON.stringify(spec.number)}
tags: []
sourceAnchors: ${JSON.stringify(spec.sourceAnchors ?? [])}
sourceFormulaAnchors: ${JSON.stringify(spec.sourceFormulaAnchors ?? [])}
sourceVisualIds: []
visualIds: []
formulas:${spec.entries?.length ? `\n${spec.entries.map(yamlFormula).join("\n")}` : " []"}
---

${spec.body}
`);
}

function makeRegressionGarden({ registryWrong = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-formula-identity-")); roots.push(root);
  fs.mkdirSync(path.join(root, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(root, "sources"), { recursive: true });
  const latency = unit("U1", "Decision Latency", "How is latency measured from onset to decision?", ["decision latency", "stimulus onset"], ["S1.P1.E2"]);
  const spike = unit("U2", "Total Spike Count", "How are spikes summed across neurons and time?", ["total spike count"], []);
  fs.writeFileSync(path.join(root, ".breadboard", "learning-unit-contract.json"), `${JSON.stringify({
    learningUnits: [latency, spike],
    sourceArtifactAssignments: [{ sourceArtifactId: "S1.P1.E2", assignedLearningUnitId: "U1", placement: "after_formula_introduction", reason: "fixture", requiredInterpretation: "fixture" }],
  }, null, 2)}\n`);
  const visuals = registryWrong
    ? [{ sourceVisualId: "S1.P1.E2", sourceId: "source", pageNumber: 1, type: "equation", caption: "Total spike count", exactText: "L=t_{decision}-t_{onset}", formulaFamily: "spike-count", conceptUsage: "explained_as_text_formula", usageStatus: "assigned" }]
    : [
        { sourceVisualId: "S1.P1.E1", sourceId: "source", pageNumber: 1, type: "equation", caption: "Decision latency", exactText: "L=t_{decision}-t_{onset}", conceptUsage: "missing", usageStatus: "unassigned" },
        { sourceVisualId: "S1.P1.E2", sourceId: "source", pageNumber: 1, type: "equation", caption: "Total spike count", exactText: "N_{spikes}=\\sum_t\\sum_i s_i(t)", conceptUsage: "explained_as_text_formula", usageStatus: "assigned" },
      ];
  fs.writeFileSync(path.join(root, ".breadboard", "source-visuals.json"), `${JSON.stringify(visuals, null, 2)}\n`);
  fs.writeFileSync(path.join(root, ".breadboard", "planning", "Source Coverage.md"), "# Source Coverage\n");
  fs.writeFileSync(path.join(root, "sources", "source.md"), "# Page 1\n\nEvaluation formulas.\n");
  writeFixturePage(root, { unitId: "U1", number: "1.1", title: "Decision Latency", sourceAnchors: ["S1.P1.E2"], sourceFormulaAnchors: ["S1.P1.E2"], entries: [{ kind: "source_definition", text: "L=t_{decision}-t_{onset}", sourceAnchor: "S1.P1.E2", formulaFamily: "latency" }], body: "Latency is elapsed decision time. $$L=t_{decision}-t_{onset}$$" });
  writeFixturePage(root, { unitId: "U2", number: "1.2", title: "Total Spike Count", body: "Spike count sums spike indicators. $$N_{spikes}=\\sum_t\\sum_i s_i(t)$$" });
  return root;
}

test("14. Fixture A atomically replaces E2 on latency and preserves/moves E2 to spike count", () => {
  const root = makeRegressionGarden();
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  const state = buildFinalGardenState(root, "fixture");
  assert.equal(result.rolledBack, false);
  assert.equal(result.assignmentsReplaced, 1);
  assert.equal(result.assignmentsMoved, 1);
  assert.deepEqual(state.pages.find((value) => value.learningUnitId === "U1").sourceFormulaAnchors, ["S1.P1.E1"]);
  assert.equal(state.learningUnitContract.assignments.find((value) => value.sourceArtifactId === "S1.P1.E1").assignedLearningUnitId, "U1");
  assert.equal(state.learningUnitContract.assignments.find((value) => value.sourceArtifactId === "S1.P1.E2").assignedLearningUnitId, "U2");
  assert.equal(result.remainingFormulaFamilyMismatches, 0);
});

test("15. Fixture B corrects the registry family and retains the anchor assignment", () => {
  const root = makeRegressionGarden({ registryWrong: true });
  const result = reconcileFinalFormulaProjectionsDeterministic(root, "fixture", { strictMode: false });
  const state = buildFinalGardenState(root, "fixture");
  assert.equal(result.registryFamilyCorrections, 1);
  assert.equal(state.sourceAnchors["S1.P1.E2"].formulaFamily, "latency");
  assert.equal(state.learningUnitContract.assignments.find((value) => value.sourceArtifactId === "S1.P1.E2").assignedLearningUnitId, "U1");
  assert.equal(result.remainingFormulaFamilyMismatches, 0);
  assert.equal(result.rolledBack, false);
});

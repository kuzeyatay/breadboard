import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareUnitReanchor } from "../src/lib/learn-unit-reanchor.ts";
import { makeCriticArtifactRepair, repairDeclinedLearningObjectives, reanchorCandidates, buildModelRepairPrompt } from "../src/lib/critic-loop.ts";

const oldId = "S1.P1.Intro";
const newId = "S1.P2.Profiles";
const unit = {
  id: "U1", title: "Index profiles", role: "core_concept", learningQuestion: "How do step-index and graded-index profiles differ?",
  prerequisiteConcepts: [], newConcepts: ["index profiles"], sourceAnchors: [oldId], sourceFigures: [], sourceFormulas: [], sourceTables: [],
  semanticConcepts: [], knowledgeClaims: [], mustNotRepeat: [], zettelNotes: [], expectedWordRange: [1400, 1800],
};
const proposal = () => ({ learningUnits: [{ ...unit, sourceAnchors: [newId] }] });
const contract = () => JSON.stringify({ learningUnits: [unit, { ...unit, id: "U2", title: "Untouched" }], sourceArtifactAssignments: [], unknownMetadata: "preserved" });

test("re-anchor repairs only the intended evidence bindings and rejects scope changes", () => {
  const repaired = JSON.parse(prepareUnitReanchor(contract(), "U1", proposal(), [newId]).contractAfter);
  assert.deepEqual(repaired.learningUnits[0].sourceAnchors, [newId]);
  assert.deepEqual(repaired.learningUnits[1], JSON.parse(contract()).learningUnits[1]);
  assert.equal(repaired.unknownMetadata, "preserved");
  for (const mutate of [
    (p) => { p.learningUnits[0].learningQuestion = "An easier question"; },
    (p) => { p.learningUnits[0].sourceAnchors = ["S9.P1.Invented"]; },
    (p) => { p.learningUnits.push({ ...unit, id: "U2" }); },
    (p) => { p.learningUnits[0].sourceFormulas = []; p.learningUnits[0].title = "Narrower lesson"; },
  ]) {
    const p = structuredClone(proposal()); mutate(p);
    assert.throws(() => prepareUnitReanchor(contract(), "U1", p, [newId]));
  }
  const claimingUnit = { ...unit, knowledgeClaims: [{ id: "K1", text: "Central claim", evidenceAnchors: [oldId] }] };
  const claimingContract = JSON.stringify({ learningUnits: [claimingUnit] });
  const claimingProposal = { learningUnits: [{ ...claimingUnit, sourceAnchors: [newId], knowledgeClaims: [{ ...claimingUnit.knowledgeClaims[0], evidenceAnchors: [newId] }] }] };
  assert.doesNotThrow(() => prepareUnitReanchor(claimingContract, "U1", claimingProposal, [newId]));
  claimingProposal.learningUnits[0].knowledgeClaims[0].text = "A different claim";
  assert.throws(() => prepareUnitReanchor(claimingContract, "U1", claimingProposal, [newId]));
});

function fixture(t) {
  const garden = fs.mkdtempSync(path.join(os.tmpdir(), "bb-reanchor-"));
  t.after(() => fs.rmSync(garden, { recursive: true, force: true }));
  for (const rel of [".breadboard", "learning", "sources"]) fs.mkdirSync(path.join(garden, rel));
  const text = "Step-index profiles keep a constant core index up to a sharp boundary. Graded-index profiles decrease the index gradually from the centre.";
  const anchors = [
    { id: oldId, kind: "intro", title: "Introduction", page: 1, exactText: "Light travels through a transparent core.", sourceId: "S1", confidence: "high", criticConfirmed: true },
    { id: newId, kind: "guidance", title: "Step-index and graded-index profiles", page: 2, exactText: text, sourceId: "S1", confidence: "high", criticConfirmed: true },
  ];
  fs.writeFileSync(path.join(garden, ".breadboard/source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: [], sourceStructuralAnchors: anchors }));
  fs.writeFileSync(path.join(garden, ".breadboard/source-visuals.json"), "[]");
  fs.writeFileSync(path.join(garden, ".breadboard/learning-unit-contract.json"), contract());
  fs.writeFileSync(path.join(garden, "sources/S1.md"), `---\ntitle: "Book"\nsourceId: "S1"\n---\n# Page 1\n${anchors[0].exactText}\n# Page 2\n${text}\n`);
  const pagePath = "learning/1.1 Index Profiles.md";
  const before = `---\ntitle: "Index profiles"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\nlearningUnitId: "U1"\ngenerated_by: "learn_button"\nsourceAnchors: ["${oldId}"]\nsourceFormulaAnchors: []\ntags: []\n---\nThis lesson cannot explain how step-index and graded-index profiles differ.\n`;
  fs.writeFileSync(path.join(garden, pagePath), before);
  const after = before.replace(oldId, newId).replace("This lesson cannot explain how step-index and graded-index profiles differ.", text);
  return { garden, pagePath, before, after, anchors };
}

test("bounded candidates retain complete exact text and cannot cross source boundaries", () => {
  const anchor = (id, sourceId) => ({ id, sourceId, kind: "guidance", page: 2, title: "Index profiles", exactText: "Step-index and graded-index profiles differ." });
  const state = { sourceAnchors: Object.fromEntries([anchor(oldId, "S1"), anchor(newId, "S1"), anchor("S2.P2.Profiles", "S2")].map((a) => [a.id, a])) };
  const issue = { type: "explanation_gap", problem: "Missing index profiles", expected: "Compare step-index and graded-index", evidence: "Cannot teach index profiles" };
  const candidates = reanchorCandidates(state, issue, new Set([oldId]));
  assert.deepEqual(candidates.map((a) => a.id), [newId]);
  const prompt = buildModelRepairPrompt({ issue, repairRequest: {}, repairStage: "reanchor", learningUnitContract: unit, reanchorCandidates: candidates });
  assert.equal(JSON.parse(prompt.user).candidates[0].exactText, state.sourceAnchors[newId].exactText);
});

test("a declined objective can gain evidence and be rewritten before the export gate", async (t) => {
  const f = fixture(t);
  const stages = [];
  const result = await repairDeclinedLearningObjectives({ gardenDir: f.garden, gardenSlug: "test", modelRepair: (input) => {
    stages.push(input.repairStage);
    if (input.repairStage === "reanchor") return { targetPath: input.repairRequest.targetPath, revisedJson: proposal() };
    assert.deepEqual(input.learningUnitContract.sourceAnchors, [newId]);
    assert.equal(input.sourceAnchors[0].exactText, f.anchors[1].exactText);
    return { targetPath: f.pagePath, revisedMarkdown: f.after };
  } });
  assert.deepEqual(stages, ["reanchor", "page"]);
  assert.equal(result.provenance[0].changed, true, JSON.stringify(result));
  assert.equal(result.provenance[0].reanchor.applied, true);
  assert.equal(fs.readFileSync(path.join(f.garden, f.pagePath), "utf8"), f.after);
  const updated = JSON.parse(fs.readFileSync(path.join(f.garden, ".breadboard/learning-unit-contract.json"), "utf8"));
  assert.deepEqual(updated.learningUnits[0].sourceAnchors, [newId]);
  assert.deepEqual(updated.learningUnits[1], JSON.parse(contract()).learningUnits[1]);
});

test("failed combined validation restores both files and bounds re-anchor selection to one call", async (t) => {
  const f = fixture(t);
  const issue = { id: "gap", type: "source_anchor_mismatch", severity: "blocking", pagePath: f.pagePath, repairTarget: "unit_page", problem: "Missing index profiles", evidence: "Step-index and graded-index", expected: unit.learningQuestion, suggestedRepair: "Re-anchor." };
  const stages = [];
  const repair = makeCriticArtifactRepair({ allowDeterministicRepairs: false, maxModelCandidateAttempts: 2,
    validateModelCandidate: () => ({ passed: false, problems: ["injected formula provenance failure"] }),
    modelRepair: (input) => { stages.push(input.repairStage); return input.repairStage === "reanchor" ? { targetPath: input.repairRequest.targetPath, revisedJson: proposal() } : { targetPath: f.pagePath, revisedMarkdown: f.after }; },
  });
  const result = await repair(f.garden, "test", [{ id: "repair", targetKind: "unit_page", targetPath: f.pagePath, issueIds: [issue.id], instructions: [], affectedAnchorIds: [oldId] }], { round: 1, issuesById: new Map([[issue.id, issue]]) });
  assert.deepEqual(stages, ["reanchor", "page", "page"]);
  assert.equal(result.provenance[0].changed, false);
  assert.equal(result.provenance[0].reanchor.applied, false);
  assert.equal(fs.readFileSync(path.join(f.garden, f.pagePath), "utf8"), f.before);
  assert.equal(fs.readFileSync(path.join(f.garden, ".breadboard/learning-unit-contract.json"), "utf8"), contract());
});

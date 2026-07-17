import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { describe } from "node:test";

import {
  normalizeLearnOperationMode,
  parseStartLearnOperationRequest,
} from "../src/lib/learn-operation-mode.ts";
import { createGardenBuildState, refreshGardenBuildFingerprint } from "../src/lib/garden-build/state.ts";
import {
  buildLearnRepairScope,
  scopedRepairHandlerForIssue,
  verifyScopedRepairDecision,
} from "../src/lib/garden-build/repair-scope.ts";
import {
  buildScopedFileMutationPolicy,
  fingerprintGardenFiles,
  verifyPageByteIdentity,
  verifyScopedFileMutationPolicy,
} from "../src/lib/garden-build/scoped-files.ts";
import { applyGardenBuildTransaction } from "../src/lib/garden-build/transactions.ts";
import { IMPLEMENTED_VISUAL_TYPES } from "../src/lib/visual-spec.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function canonicalState(unitCount = 3) {
  const state = createGardenBuildState({
    buildId: "build:repair-fixture", gardenId: "garden", gardenSlug: "garden", topicTitle: "Repair Fixture",
    sourceSetHash: "source-hash", stage: "repair",
  });
  state.sources.S1 = { id: "S1", title: "Source", status: "active", provenance: {} };
  state.sourceAnchors.a1 = { id: "a1", sourceId: "S1", kind: "text_concept", title: "Anchor", semanticSummary: "Grounding", conceptKeywords: ["grounding"], status: "verified", provenance: {} };
  state.sections.s1 = { id: "s1", order: 0, title: "Foundations", unitIds: [] };
  state.sections.s2 = { id: "s2", order: 1, title: "Applications", unitIds: [] };
  for (let index = 1; index <= unitCount; index += 1) {
    const unitId = `U${index}`;
    const pageId = `page:${unitId}`;
    const sectionId = index <= Math.ceil(unitCount / 2) ? "s1" : "s2";
    state.sections[sectionId].unitIds.push(unitId);
    state.units[unitId] = {
      id: unitId, sectionId, pageId, order: index - 1, title: `Unit ${index}`, role: "core_concept",
      learningQuestion: `What is unit ${index}?`, prerequisiteConceptIds: [], primaryConceptIds: [], supportingConceptIds: [],
      sourceAnchorIds: ["a1"], sourceVisualAnchorIds: [], formulaAssignmentIds: [], claimIds: [], visualIds: [], zettelNotes: [], status: "generated",
    };
    state.pages[pageId] = {
      id: pageId, unitId, sectionId, order: index - 1, title: `Unit ${index}`,
      body: `# Unit ${index}\n\nBody ${index}.`, formulaEntries: [], embeddedVisualIds: [],
      contentFingerprint: `body-${index}`, legacyPath: `learning/${sectionId}/${unitId}.md`,
    };
  }
  state.visuals.v1 = { id: "v1", pageId: "page:U1", unitId: "U1", type: IMPLEMENTED_VISUAL_TYPES[0], sourceAnchorIds: ["a1"], textAnchorIds: [], body: "{}", status: "grounded", provenance: {} };
  state.units.U1.visualIds.push("v1"); state.pages["page:U1"].embeddedVisualIds.push("v1");
  state.visuals.v2 = { id: "v2", pageId: "page:U2", unitId: "U2", type: IMPLEMENTED_VISUAL_TYPES[0], sourceAnchorIds: ["a1"], textAnchorIds: [], body: "{}", status: "grounded", provenance: {} };
  state.units.U2.visualIds.push("v2"); state.pages["page:U2"].embeddedVisualIds.push("v2");
  return refreshGardenBuildFingerprint(state);
}

function issue(type, target, evidence = {}, repairClass = "deterministic_then_model") {
  return {
    issueId: `${type}:${JSON.stringify(target)}`,
    type, severity: "blocking", repairClass, stage: "repair", target,
    evidence: { semanticCategory: type, ...evidence }, detectedBy: ["fixture"],
  };
}

describe("mode semantics", () => {
  test("1. legacy regenerate maps to repair", () => assert.equal(normalizeLearnOperationMode("regenerate"), "repair"));
  test("2. repair never maps to full rebuild", () => assert.equal(normalizeLearnOperationMode("repair"), "repair"));
  test("3/4. full rebuild requires explicit mode and confirmation", () => {
    assert.throws(() => parseStartLearnOperationRequest("garden", { mode: "full_rebuild" }), /explicit confirmation/);
    assert.deepEqual(parseStartLearnOperationRequest("garden", { mode: "full_rebuild", forceFullRebuild: true }), { gardenId: "garden", mode: "full_rebuild", forceFullRebuild: true, issueIds: undefined, unitIds: undefined, pageIds: undefined });
    assert.throws(() => parseStartLearnOperationRequest("garden", { mode: "repair", forceFullRebuild: true }), /only when mode is full_rebuild/);
  });
  test("5. legacy regenerate route is repair-only and never invokes planning", () => {
    const route = fs.readFileSync(path.join(repoRoot, "src/app/api/gardens/[gardenId]/learn/regenerate/route.ts"), "utf8");
    assert.match(route, /legacyDefault: "repair"/);
    assert.match(route, /runLearnRepairOperation/);
    assert.doesNotMatch(route, /runLearnPlanning|runTextbookGeneration/);
  });
});

describe("typed dependency closure", () => {
  test("6. visual issue includes only its owning page, unit, and visual", () => {
    const state = canonicalState(2);
    const problem = issue("missing_planned_visual", { visualId: "v1", pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    assert.deepEqual(scope.pageIds, ["page:U1"]);
    assert.deepEqual(scope.unitIds, ["U1"]);
    assert.deepEqual(scope.visualIds, ["v1"]);
    assert.ok(scope.explicitlyExcludedPageIds.includes("page:U2"));
  });
  test("7. formula issue does not include unrelated visuals", () => {
    const state = canonicalState(2);
    const problem = issue("formula_lineage_missing", { pageId: "page:U1", unitId: "U1", formulaAssignmentId: "fa1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    assert.deepEqual(scope.visualIds, []);
    assert.equal(scope.allowPageBodyRewrite, false);
  });
  test("8. section issue includes section units and navigation but not page bodies", () => {
    const state = canonicalState();
    const problem = issue("section_semantic_mismatch", { sectionId: "s1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    assert.deepEqual(scope.unitIds, ["U1", "U2"]);
    assert.deepEqual(scope.pageIds, []);
    assert.equal(scope.allowPageBodyRewrite, false);
    assert.ok(scope.requiredProjectionRebuilds.includes("navigation"));
  });
  test("9. dependency closure is deterministic", () => {
    const state = canonicalState();
    const problems = [issue("visual_type_mismatch", { visualId: "v1" }, { expectedTypes: [IMPLEMENTED_VISUAL_TYPES[0]] })];
    assert.deepEqual(buildLearnRepairScope(state, problems, { gardenId: "garden", mode: "repair" }), buildLearnRepairScope(state, problems, { gardenId: "garden", mode: "repair" }));
  });
  test("10. stable IDs survive path changes", () => {
    const state = canonicalState();
    const problem = issue("missing_planned_visual", { visualId: "v1" });
    const before = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    state.pages["page:U1"].legacyPath = "learning/renamed/elsewhere.md";
    const after = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    assert.deepEqual(after.pageIds, before.pageIds);
    assert.deepEqual(after.unitIds, before.unitIds);
  });
});

describe("mutation and byte boundaries", () => {
  function roots(t) {
    const before = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-repair-before-"));
    const after = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-repair-after-"));
    t.after(() => { fs.rmSync(before, { recursive: true, force: true }); fs.rmSync(after, { recursive: true, force: true }); });
    for (const root of [before, after]) {
      fs.mkdirSync(path.join(root, "learning/s1"), { recursive: true });
      fs.mkdirSync(path.join(root, "learning/s2"), { recursive: true });
      fs.mkdirSync(path.join(root, "sources"), { recursive: true });
    }
    return { before, after };
  }
  const page = (id, body, visuals = []) => `---\ntitle: "${id}"\nvisualIds: ${JSON.stringify(visuals)}\n---\n${body}`;
  test("11/13. visual-only repair changes owned visual bytes and preserves excluded pages", (t) => {
    const state = canonicalState(2);
    const problem = issue("visual_type_mismatch", { visualId: "v1", pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    const { before, after } = roots(t);
    const oldBlock = '```breadboard-visual\n{"id":"v1","type":"old"}\n```';
    const newBlock = '```breadboard-visual\n{"id":"v1","type":"new"}\n```';
    fs.writeFileSync(path.join(before, "learning/s1/U1.md"), page("U1", `Intro.\n\n${oldBlock}\nTail.`, ["v1"]));
    fs.writeFileSync(path.join(after, "learning/s1/U1.md"), page("U1", `Intro.\n\n${newBlock}\nTail.`, ["v1"]));
    for (const root of [before, after]) fs.writeFileSync(path.join(root, "learning/s1/U2.md"), page("U2", "Unchanged."));
    const checked = verifyPageByteIdentity({ state, scope, issues: [problem], beforeRoot: before, afterRoot: after });
    assert.equal(checked.passed, true, JSON.stringify(checked));
  });
  test("12. metadata-only repair preserves body bytes", (t) => {
    const state = canonicalState(2);
    const problem = issue("tag_projection_mismatch", { pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    const { before, after } = roots(t);
    fs.writeFileSync(path.join(before, "learning/s1/U1.md"), `---\ntags: [old]\n---\nExact body.\n`);
    fs.writeFileSync(path.join(after, "learning/s1/U1.md"), `---\ntags: [new]\n---\nExact body.\n`);
    for (const root of [before, after]) fs.writeFileSync(path.join(root, "learning/s1/U2.md"), page("U2", "Unchanged."));
    const checked = verifyPageByteIdentity({ state, scope, issues: [problem], beforeRoot: before, afterRoot: after });
    assert.equal(checked.passed, true, JSON.stringify(checked));
  });
  test("14/15. unauthorized and source-file changes fail the policy", (t) => {
    const state = canonicalState();
    const problem = issue("tag_projection_mismatch", { pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    const { before, after } = roots(t);
    for (const root of [before, after]) {
      fs.writeFileSync(path.join(root, "learning/s1/U1.md"), page("U1", "Body."));
      fs.writeFileSync(path.join(root, "sources/source.md"), "source bytes");
      fs.writeFileSync(path.join(root, "unrelated.md"), "same");
    }
    fs.writeFileSync(path.join(after, "sources/source.md"), "changed source");
    fs.writeFileSync(path.join(after, "unrelated.md"), "changed");
    const beforeHashes = fingerprintGardenFiles(before);
    const policy = buildScopedFileMutationPolicy(state, scope, beforeHashes);
    const checked = verifyScopedFileMutationPolicy(beforeHashes, fingerprintGardenFiles(after), policy);
    assert.equal(checked.passed, false);
    assert.deepEqual(checked.sourceFileChanges, ["sources/source.md"]);
    assert.ok(checked.unauthorizedChanges.includes("unrelated.md"));
  });
  test("16. Topic Map/Learning Map cannot change during page repair", (t) => {
    const state = canonicalState();
    const problem = issue("tag_projection_mismatch", { pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    const { before, after } = roots(t);
    for (const root of [before, after]) {
      fs.mkdirSync(path.join(root, "learning"), { recursive: true });
      fs.writeFileSync(path.join(root, "learning/Learning Map.md"), "map");
      fs.writeFileSync(path.join(root, "learning/s1/U1.md"), page("U1", "Body."));
    }
    fs.writeFileSync(path.join(after, "learning/Learning Map.md"), "changed map");
    const beforeHashes = fingerprintGardenFiles(before);
    const checked = verifyScopedFileMutationPolicy(beforeHashes, fingerprintGardenFiles(after), buildScopedFileMutationPolicy(state, scope, beforeHashes));
    assert.ok(checked.unauthorizedChanges.includes("learning/Learning Map.md"));
  });
});

describe("scoped ChatMock packets and decisions", () => {
  test("17. packet contains only the affected unit/page evidence", () => {
    const state = canonicalState();
    state.pages["page:U2"].body = "SECRET UNRELATED PAGE";
    const problem = issue("missing_planned_visual", { visualId: "v1", pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    const packet = scopedRepairHandlerForIssue(problem).buildModelPacket(problem, state, scope);
    assert.doesNotMatch(JSON.stringify(packet), /SECRET UNRELATED PAGE/);
    assert.match(JSON.stringify(packet), /"id":"U1"/);
  });
  test("18. model cannot modify an excluded unit", () => {
    const state = canonicalState();
    const problem = issue("scaffold_prose", { pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    const checked = verifyScopedRepairDecision(problem, { operations: [{ type: "set_page_body", pageId: "page:U2", body: "hijack", justification: "bad" }] }, state, scope);
    assert.equal(checked.valid, false);
  });
  test("19. invented source anchor is rejected", () => {
    const state = canonicalState();
    const problem = issue("visual_grounding_mismatch", { visualId: "v1", pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    const checked = verifyScopedRepairDecision(problem, { operations: [{ type: "set_visual_grounding", visualId: "v1", pageId: "page:U1", unitId: "U1", sourceAnchorIds: ["invented"], textAnchorIds: [], status: "grounded", justification: "bad" }] }, state, scope);
    assert.equal(checked.valid, false);
    assert.match(checked.reason, /does not exist/);
  });
  test("20. invalid visual type is rejected", () => {
    const state = canonicalState();
    const problem = issue("visual_type_mismatch", { visualId: "v1", pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    assert.equal(verifyScopedRepairDecision(problem, { operations: [{ type: "set_visual_type", visualId: "v1", visualType: "arbitrary_javascript", justification: "bad" }] }, state, scope).valid, false);
  });
  test("21. verified operation commits", () => {
    const state = canonicalState();
    const problem = issue("visual_type_mismatch", { visualId: "v1", pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    const decision = verifyScopedRepairDecision(problem, { operations: [{ type: "set_visual_type", visualId: "v1", visualType: IMPLEMENTED_VISUAL_TYPES.at(-1), justification: "supported" }] }, state, scope);
    assert.equal(decision.valid, true);
    const applied = applyGardenBuildTransaction(state, decision.operations, { expectedStage: "repair", validateAfter: false });
    assert.equal(applied.transaction.committed, true);
  });
  test("22. rejected decision causes no state mutation", () => {
    const state = canonicalState();
    const before = structuredClone(state);
    const problem = issue("visual_type_mismatch", { visualId: "v1", pageId: "page:U1", unitId: "U1" });
    const scope = buildLearnRepairScope(state, [problem], { gardenId: "garden", mode: "repair" });
    assert.equal(verifyScopedRepairDecision(problem, { directory: "replacement" }, state, scope).valid, false);
    assert.deepEqual(state, before);
  });
});

describe("loop policy, UI, and regression scope", () => {
  test("23-29. repair is deterministic-first, globally audited, and has no full-generation fallback", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/learn-scoped-repair.ts"), "utf8");
    const deterministic = source.indexOf("Deterministic operations always run before any model packet");
    const model = source.indexOf("await input.modelRepair", deterministic);
    assert.ok(deterministic >= 0 && model > deterministic);
    assert.match(source, /maxIssuesPerRound/);
    assert.match(source, /maxModelCalls/);
    assert.match(source, /targetBlockersAfter\.length < targetBlockersBefore\.length/);
    assert.match(source, /newBlockers\.length === 0/);
    assert.match(source, /auditGardenForFinalization\(staging/);
    assert.match(source, /auditFinalGardenState\(buildFinalGardenState\(staging/);
    assert.doesNotMatch(source, /runTextbookGeneration|runLearnPlanning|rebuildEntireGarden/);
  });
  test("30-34. UI explains repair, separates rebuild, previews scope, and reports preservation", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/app/gardens/[clusterSlug]/workspace-client.tsx"), "utf8");
    assert.match(source, /Repair issues/);
    assert.match(source, /unaffected content is preserved/);
    assert.match(source, /Rebuild entire garden/);
    assert.match(source, /This will regenerate the Learning Map, Learning Unit Contract, all learner pages, and interactive visuals/);
    assert.match(source, /Last repair:[\s\S]*?visual block[\s\S]*?affected page[\s\S]*?unaffected pages preserved/);
    assert.match(source, /Blockers \{learnState\.scopedRepair\.blockersBefore\} → \{learnState\.scopedRepair\.blockersAfter\}/);
  });
  test("current test2 visual regression selects only the named stable units", () => {
    const state = canonicalState(25);
    state.sections.s4 = { id: "s4", order: 3, title: "Mixed roles", unitIds: ["U13", "U14", "U17", "U18"] };
    for (const id of state.sections.s4.unitIds) {
      state.sections[state.units[id].sectionId].unitIds = state.sections[state.units[id].sectionId].unitIds.filter((unitId) => unitId !== id);
      state.units[id].sectionId = "s4"; state.pages[`page:${id}`].sectionId = "s4";
    }
    const visualUnits = ["U3", "U5", "U6", "U7", "U9", "U10", "U23"];
    const problems = [];
    for (const unitId of visualUnits) {
      const visualId = `vis-${unitId}`;
      state.visuals[visualId] = { id: visualId, pageId: `page:${unitId}`, unitId, type: IMPLEMENTED_VISUAL_TYPES[0], sourceAnchorIds: ["a1"], textAnchorIds: [], status: "unresolved", provenance: {} };
      problems.push(issue("missing_planned_visual", { visualId, pageId: `page:${unitId}`, unitId }));
    }
    problems.push(issue("duplicate_visual_signature", { visualId: "vis-U5", pageId: "page:U5", unitId: "U5" }, { visualIds: ["vis-U5", "vis-U23"], pageIds: ["page:U5", "page:U23"] }));
    problems.push(issue("duplicate_visual_signature", { visualId: "vis-U7", pageId: "page:U7", unitId: "U7" }, { visualIds: ["vis-U7", "vis-U10"], pageIds: ["page:U7", "page:U10"] }));
    problems.push(issue("section_semantic_mismatch", { sectionId: "s4" }));
    const scope = buildLearnRepairScope(state, problems, { gardenId: "garden", mode: "repair" });
    assert.deepEqual(scope.unitIds, ["U10", "U13", "U14", "U17", "U18", "U23", "U3", "U5", "U6", "U7", "U9"]);
    assert.equal(scope.pageIds.length, 7, "section repair does not schedule its page bodies");
    assert.equal(scope.explicitlyExcludedPageIds.length, 18);
    assert.equal(scope.requiredProjectionRebuilds.includes("navigation"), true);
    assert.equal(scope.requiredProjectionRebuilds.includes("visual_index"), true);
  });
});

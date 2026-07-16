import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLearnBuildWorkspace,
  seedDurableInputs,
} from "../src/lib/learn-build-workspace.ts";
import {
  createActiveBuildManifest,
  contractFingerprint,
  ownershipMetadata,
  pageIdForUnit,
  readActiveBuildManifest,
  readOwnershipFromFrontmatter,
  writeActiveBuildManifest,
} from "../src/lib/learn-build-manifest.ts";
import {
  detectStructuralIssues,
  isActiveLearnerProjectionPath,
  reconcileActiveLearnStructure,
} from "../src/lib/learn-structure-reconciliation.ts";
import {
  isRecoverableLearnIssue,
  resetDisposableLearnProjections,
} from "../src/lib/learn-projection-reset.ts";
import {
  acquireGardenLearnLock,
  promoteStagingGarden,
  releaseGardenLearnLock,
} from "../src/lib/learn-atomic-promotion.ts";
import {
  learnFinalizationMode,
  runLearnConvergenceLoop,
} from "../src/lib/learn-convergence-loop.ts";

const roots = [];
test.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function tmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  roots.push(dir);
  return dir;
}

function unit(id, title, role = "core_concept") {
  return {
    id, title, role,
    learningQuestion: `What is ${title}?`,
    prerequisiteConcepts: [], newConcepts: [title],
    sourceAnchors: [], sourceFigures: [], sourceFormulas: [], sourceTables: [],
    zettelNotes: [], mustNotRepeat: [], expectedWordRange: [700, 1100],
  };
}

function writePage(gardenDir, rel, ownership, extra = "") {
  const abs = path.join(gardenDir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const fm = [
    "---",
    `title: ${JSON.stringify(rel.split("/").pop().replace(/\.md$/, ""))}`,
    'knowledge_type: "learning-page"',
    'breadboardType: "learning_page"',
    'generated_by: "learn_button"',
    `learningUnitId: ${ownership.learningUnitId}`,
    `pageId: ${ownership.pageId ?? pageIdForUnit(ownership.learningUnitId)}`,
    `generatedByBuildId: ${ownership.generatedByBuildId}`,
    `generatedByJobId: ${ownership.generatedByJobId ?? "job1"}`,
    `contractFingerprint: ${ownership.contractFingerprint ?? "cf1"}`,
    `generationAttempt: ${ownership.generationAttempt ?? 1}`,
    extra,
    "---",
    "",
    "Body.",
  ].filter(Boolean).join("\n");
  fs.writeFileSync(abs, fm);
  return abs;
}

// ---------------------------------------------------------------------------
// Workspace isolation (Parts 1-2, tests 1-5 subset)
// ---------------------------------------------------------------------------

test("1/2. workspace seeds durable inputs and never copies the old learning tree", () => {
  const repo = tmp("repo");
  fs.mkdirSync(path.join(repo, "sources"), { recursive: true });
  fs.writeFileSync(path.join(repo, "sources", "s1.md"), "# Page 1\n");
  fs.mkdirSync(path.join(repo, "learning", "1. Old Section"), { recursive: true });
  fs.writeFileSync(path.join(repo, "learning", "1. Old Section", "1.1 Old.md"), "old page");
  fs.mkdirSync(path.join(repo, ".breadboard"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".breadboard", "source-visuals.json"), "[]");
  fs.writeFileSync(path.join(repo, ".breadboard", "claims.json"), "{}");

  const ws = createLearnBuildWorkspace({
    gardenSlug: "g1", jobId: "job1", mode: "generate",
    repositoryGardenDir: repo, contractFingerprint: "cf1", sourceSetFingerprint: "sf1",
    workspaceRoot: path.join(tmp("wsroot"), "ws"),
  });
  roots.push(ws.workspaceRoot);
  // durable inputs present
  assert.ok(fs.existsSync(path.join(ws.stagingGardenDir, "sources", "s1.md")));
  assert.ok(fs.existsSync(path.join(ws.stagingGardenDir, ".breadboard", "source-visuals.json")));
  // old learning tree and disposable projections NOT copied
  assert.equal(fs.existsSync(path.join(ws.stagingGardenDir, "learning")), false);
  assert.equal(fs.existsSync(path.join(ws.stagingGardenDir, ".breadboard", "claims.json")), false);
});

test("4. seeding leaves the repository garden unchanged", () => {
  const repo = tmp("repo2");
  fs.mkdirSync(path.join(repo, "sources"), { recursive: true });
  fs.writeFileSync(path.join(repo, "sources", "s.md"), "x");
  fs.mkdirSync(path.join(repo, "learning"), { recursive: true });
  fs.writeFileSync(path.join(repo, "learning", "keep.md"), "keep");
  const staging = tmp("staging2");
  seedDurableInputs(repo, staging);
  assert.ok(fs.existsSync(path.join(repo, "learning", "keep.md"))); // repo untouched
  assert.equal(fs.existsSync(path.join(staging, "learning")), false); // learning not seeded
});

// ---------------------------------------------------------------------------
// Manifest ownership (Part 3, tests 6-12 subset)
// ---------------------------------------------------------------------------

test("6/12. ownership metadata identifies a page by unit+build, not path", () => {
  const contract = [unit("U1", "Alpha"), unit("U2", "Beta")];
  const manifest = createActiveBuildManifest({
    buildId: "buildA", jobId: "job1", gardenSlug: "g", sourceSetFingerprint: "sf",
    contractFingerprint: contractFingerprint(contract),
    units: contract.map((u, i) => ({ unitId: u.id, sectionId: "sec1", expectedPagePath: `learning/1. Sec/1.${i + 1} ${u.title}.md` })),
    sectionIds: ["sec1"],
  });
  const meta = ownershipMetadata(manifest, "U1");
  assert.equal(meta.pageId, "page:U1");
  assert.equal(meta.generatedByBuildId, "buildA");
  assert.equal(meta.generationAttempt, 1);
});

test("manifest round-trips through disk", () => {
  const garden = tmp("gm");
  const manifest = createActiveBuildManifest({
    buildId: "b", jobId: "j", gardenSlug: "g", sourceSetFingerprint: "sf", contractFingerprint: "cf",
    units: [{ unitId: "U1", sectionId: "s", expectedPagePath: "learning/1. S/1.1 A.md" }],
    sectionIds: ["s"],
  });
  writeActiveBuildManifest(garden, manifest);
  const read = readActiveBuildManifest(garden);
  assert.equal(read.buildId, "b");
  assert.equal(read.units[0].pageId, "page:U1");
});

// ---------------------------------------------------------------------------
// Scan exclusions (Part 7, tests 16-17)
// ---------------------------------------------------------------------------

test("16/17. quarantine and canonical-shadow are excluded from active scans", () => {
  assert.equal(isActiveLearnerProjectionPath("learning/1. S/1.1 A.md", "b"), true);
  assert.equal(isActiveLearnerProjectionPath(".breadboard/quarantine/b/obsolete-pages/x.md", "b"), false);
  assert.equal(isActiveLearnerProjectionPath(".breadboard/canonical-shadow/y.md", "b"), false);
  assert.equal(isActiveLearnerProjectionPath(".breadboard/backups/z.md", "b"), false);
  assert.equal(isActiveLearnerProjectionPath("node_modules/pkg/readme.md", "b"), false);
});

// ---------------------------------------------------------------------------
// Structural reconciliation (Parts 4-6, tests 7-11)
// ---------------------------------------------------------------------------

function gardenWithManifest(contract, buildId = "cur") {
  const garden = tmp("garden");
  const manifest = createActiveBuildManifest({
    buildId, jobId: "job1", gardenSlug: "g", sourceSetFingerprint: "sf",
    contractFingerprint: contractFingerprint(contract),
    units: contract.map((u, i) => ({ unitId: u.id, sectionId: "sec1", expectedPagePath: `learning/1. Current/1.${i + 1} ${u.title}.md` })),
    sectionIds: ["sec1"],
  });
  writeActiveBuildManifest(garden, manifest);
  return { garden, manifest };
}

test("7. a foreign-build page for a current unit is removed and flagged for regen", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  writePage(garden, "learning/1. Old/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "OLD_BUILD" });
  const result = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.ok(result.issuesBefore.some((i) => i.type === "foreign_build_page"));
  assert.equal(fs.existsSync(path.join(garden, "learning", "1. Old", "1.1 Alpha.md")), false);
  assert.ok(result.pagesRegenerated.includes("U1"));
});

test("8. an unknown-unit page (U24) is quarantined out of the active tree", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "cur" });
  writePage(garden, "learning/9. Obsolete/9.1 Ghost.md", { learningUnitId: "U24", generatedByBuildId: "cur" });
  const result = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.ok(result.issuesBefore.some((i) => i.type === "unknown_learning_unit" && i.unitId === "U24"));
  assert.equal(fs.existsSync(path.join(garden, "learning", "9. Obsolete", "9.1 Ghost.md")), false);
  assert.equal(result.pagesQuarantined.length, 1);
  // quarantined copy is under .breadboard/quarantine and NOT active
  assert.ok(result.pagesQuarantined[0].startsWith(".breadboard/quarantine/"));
  assert.equal(isActiveLearnerProjectionPath(result.pagesQuarantined[0], "cur"), false);
});

test("9. a duplicate unit page keeps the manifest candidate and removes the other", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  // Manifest expects learning/1. Current/1.1 Alpha.md
  writePage(garden, "learning/1. Current/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "cur" });
  writePage(garden, "learning/1. Why Alpha Matters/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "cur" });
  const result = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.ok(result.issuesBefore.some((i) => i.type === "duplicate_unit_page"));
  assert.ok(fs.existsSync(path.join(garden, "learning", "1. Current", "1.1 Alpha.md")));
  assert.equal(fs.existsSync(path.join(garden, "learning", "1. Why Alpha Matters", "1.1 Alpha.md")), false);
  assert.ok(result.pagesKept.includes("learning/1. Current/1.1 Alpha.md"));
});

test("10. two older-build duplicates are both removed and the unit is regenerated", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  writePage(garden, "learning/1. A/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "OLD1" });
  writePage(garden, "learning/1. B/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "OLD2" });
  const result = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.equal(fs.existsSync(path.join(garden, "learning", "1. A", "1.1 Alpha.md")), false);
  assert.equal(fs.existsSync(path.join(garden, "learning", "1. B", "1.1 Alpha.md")), false);
  assert.ok(result.pagesRegenerated.includes("U1"));
});

test("11. a missing unit page is flagged for regeneration", () => {
  const contract = [unit("U1", "Alpha"), unit("U2", "Beta")];
  const { garden, manifest } = gardenWithManifest(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "cur" });
  const result = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.ok(result.issuesBefore.some((i) => i.type === "missing_unit_page" && i.unitId === "U2"));
  assert.ok(result.pagesRegenerated.includes("U2"));
});

test("18. structural reconciliation is idempotent on a clean tree", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "cur" });
  const first = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.equal(first.changed, false);
  assert.deepEqual(detectStructuralIssues(garden, contract, manifest), []);
  const second = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.equal(second.changed, false);
  assert.equal(second.passed, true);
});

// ---------------------------------------------------------------------------
// Projection reset (Part 8) and recoverable classification (Part 14)
// ---------------------------------------------------------------------------

test("19-24. projection reset removes disposable projections, preserves durable inputs", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  fs.writeFileSync(path.join(garden, ".breadboard", "claims.json"), "{}");
  fs.writeFileSync(path.join(garden, ".breadboard", "source-visuals.json"), "[]");
  fs.mkdirSync(path.join(garden, "sources"), { recursive: true });
  fs.writeFileSync(path.join(garden, "sources", "s.md"), "x");
  const result = resetDisposableLearnProjections(garden, manifest);
  assert.ok(result.removed.includes(".breadboard/claims.json"));
  assert.equal(fs.existsSync(path.join(garden, ".breadboard", "claims.json")), false);
  assert.ok(fs.existsSync(path.join(garden, ".breadboard", "source-visuals.json"))); // durable preserved
  assert.ok(result.preservedDurableInputs.includes("sources"));
});

test("35. recoverable vs terminal issue classification", () => {
  assert.equal(isRecoverableLearnIssue({ type: "duplicate_unit_page" }), true);
  assert.equal(isRecoverableLearnIssue({ type: "stale_claim_mapping" }), true);
  assert.equal(isRecoverableLearnIssue({ type: "source_evidence_unavailable" }), false);
  assert.equal(isRecoverableLearnIssue({ type: "repair_budget_exhausted" }), false);
});

// ---------------------------------------------------------------------------
// Atomic promotion + garden lock (Parts 16-17, tests 44-50)
// ---------------------------------------------------------------------------

test("45/47. atomic promotion swaps in the staging tree without a mixed result", async () => {
  const parent = tmp("promote");
  const staging = path.join(parent, "staging");
  fs.mkdirSync(path.join(staging, "learning"), { recursive: true });
  fs.writeFileSync(path.join(staging, "learning", "new.md"), "new");
  const dest = path.join(parent, "published");
  fs.mkdirSync(path.join(dest, "learning"), { recursive: true });
  fs.writeFileSync(path.join(dest, "learning", "old.md"), "old");
  const result = await promoteStagingGarden({ stagingGardenDir: staging, destinationGardenDir: dest });
  assert.equal(result.promoted, true);
  assert.ok(fs.existsSync(path.join(dest, "learning", "new.md")));
  assert.equal(fs.existsSync(path.join(dest, "learning", "old.md")), false); // fully swapped, not merged
});

test("46. failed manifest verification preserves the previous published garden", async () => {
  const parent = tmp("promote2");
  const staging = path.join(parent, "staging");
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "x.md"), "new");
  const dest = path.join(parent, "published");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "keep.md"), "old");
  const result = await promoteStagingGarden({
    stagingGardenDir: staging, destinationGardenDir: dest,
    verifyManifest: () => false,
  });
  assert.equal(result.promoted, false);
  assert.ok(fs.existsSync(path.join(dest, "keep.md"))); // previous preserved intact
});

test("48/50. only one job can own a garden; stale lock is recoverable", () => {
  const garden = tmp("lock");
  const first = acquireGardenLearnLock(garden, { gardenSlug: "g", jobId: "job1", buildId: "b1" });
  assert.equal(first.acquired, true);
  const second = acquireGardenLearnLock(garden, { gardenSlug: "g", jobId: "job2", buildId: "b2" });
  assert.equal(second.acquired, false);
  // A stale lock (heartbeat far in the past) can be taken over.
  const later = Date.now() + 10 * 60 * 1000;
  const takeover = acquireGardenLearnLock(garden, { gardenSlug: "g", jobId: "job2", buildId: "b2" }, later);
  assert.equal(takeover.acquired, true);
  releaseGardenLearnLock(garden, "job2");
});

// ---------------------------------------------------------------------------
// Convergence loop (Parts 9-11, 19, tests 25-35 subset)
// ---------------------------------------------------------------------------

test("11 (flag). LEARN_FINALIZATION_MODE defaults to legacy", () => {
  const prev = process.env.LEARN_FINALIZATION_MODE;
  delete process.env.LEARN_FINALIZATION_MODE;
  assert.equal(learnFinalizationMode(), "legacy");
  process.env.LEARN_FINALIZATION_MODE = "convergent";
  assert.equal(learnFinalizationMode(), "convergent");
  if (prev === undefined) delete process.env.LEARN_FINALIZATION_MODE; else process.env.LEARN_FINALIZATION_MODE = prev;
});

function convergenceWorkspace(contract, buildId = "cur") {
  const { garden, manifest } = gardenWithManifest(contract, buildId);
  const ws = {
    buildId, jobId: "job1", gardenSlug: "g", mode: "generate",
    repositoryGardenDir: garden, workspaceRoot: garden,
    stagingGardenDir: garden, stagingLearningDir: path.join(garden, "learning"),
    contractFingerprint: "cf", sourceSetFingerprint: "sf", createdAt: new Date().toISOString(),
  };
  return { ws, garden, manifest };
}

test("25/32. structural cleanup precedes semantics; loop stops accepted at zero blockers", async () => {
  const contract = [unit("U1", "Alpha")];
  const { ws, garden } = convergenceWorkspace(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "cur" });
  let fp = 0;
  const result = await runLearnConvergenceLoop(ws, contract, {
    runSemanticPass: async () => ({
      issues: [], deterministicOperations: [], modelPackets: [],
      modelDecisionsReceived: 0, modelDecisionsVerified: 0, modelDecisionsRejected: 0, changedFiles: [],
    }),
    stateFingerprint: () => String(fp),
  });
  assert.equal(result.passed, true);
  assert.equal(result.stoppedReason, "accepted");
  assert.equal(result.finalBlockerCount, 0);
});

test("26/28. deterministic structural repair happens before ChatMock; a verified model repair commits", async () => {
  const contract = [unit("U1", "Alpha")];
  const { ws, garden } = convergenceWorkspace(contract);
  // A foreign page will be removed structurally in round 1; regen restores it.
  writePage(garden, "learning/1. Old/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "OLD" });
  let semanticCalls = 0;
  let fp = 0;
  const result = await runLearnConvergenceLoop(ws, contract, {
    regenerateUnitPages: async (unitIds) => {
      for (const id of unitIds) writePage(garden, `learning/1. Current/1.1 Alpha.md`, { learningUnitId: id, generatedByBuildId: "cur" });
      fp += 1;
      return unitIds.map((id) => `learning/1. Current/1.1 Alpha.md#${id}`);
    },
    runSemanticPass: async ({ round }) => {
      semanticCalls += 1;
      // Round 1 leaves one recoverable semantic blocker that a verified model
      // repair clears in round 2.
      if (round === 1) {
        fp += 1;
        return {
          issues: [{ issueId: "sem:1", type: "contract_page_anchor", severity: "blocking", reason: "anchor drift" }],
          deterministicOperations: [], modelPackets: [{}],
          modelDecisionsReceived: 1, modelDecisionsVerified: 1, modelDecisionsRejected: 0,
          changedFiles: ["learning/1. Current/1.1 Alpha.md"],
        };
      }
      fp += 1;
      return { issues: [], deterministicOperations: [], modelPackets: [], modelDecisionsReceived: 0, modelDecisionsVerified: 0, modelDecisionsRejected: 0, changedFiles: [] };
    },
    stateFingerprint: () => String(fp),
  });
  assert.equal(result.passed, true);
  assert.ok(semanticCalls >= 2);
  assert.equal(result.verifiedChatMockRepairs, 1);
});

test("33. loop stops on proven no-progress instead of churning", async () => {
  const contract = [unit("U1", "Alpha")];
  const { ws, garden } = convergenceWorkspace(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "cur" });
  const result = await runLearnConvergenceLoop(ws, contract, {
    runSemanticPass: async () => ({
      issues: [{ issueId: "sem:stuck", type: "contract_page_anchor", severity: "blocking", reason: "cannot fix" }],
      deterministicOperations: [], modelPackets: [],
      modelDecisionsReceived: 0, modelDecisionsVerified: 0, modelDecisionsRejected: 0, changedFiles: [],
    }),
    stateFingerprint: () => "constant", // never changes → no progress
  }, { enableChatMockRepairs: false });
  assert.equal(result.passed, false);
  assert.equal(result.stoppedReason, "no_progress");
});

test("chatmock-unavailable with a non-deterministic blocker stops as chatmock_unavailable", async () => {
  const contract = [unit("U1", "Alpha")];
  const { ws, garden } = convergenceWorkspace(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", { learningUnitId: "U1", generatedByBuildId: "cur" });
  const result = await runLearnConvergenceLoop(ws, contract, {
    runSemanticPass: async () => ({
      issues: [{ issueId: "sem:amb", type: "section_semantic_mismatch", severity: "blocking", reason: "ambiguous" }],
      deterministicOperations: [], modelPackets: [],
      modelDecisionsReceived: 0, modelDecisionsVerified: 0, modelDecisionsRejected: 0, changedFiles: [],
      chatMockUnavailable: true,
    }),
    stateFingerprint: () => "s",
  });
  assert.equal(result.stoppedReason, "chatmock_unavailable");
});

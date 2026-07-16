import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createActiveBuildManifest,
  contractFingerprint,
  writeActiveBuildManifest,
} from "../src/lib/learn-build-manifest.ts";
import {
  detectStructuralIssues,
  freezeActiveGenerationByVersion,
  isActiveLearnerProjectionPath,
  reconcileActiveLearnStructure,
} from "../src/lib/learn-structure-reconciliation.ts";
import { runLearnConvergenceLoop } from "../src/lib/learn-convergence-loop.ts";

const roots = [];
test.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function tmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  roots.push(dir);
  return dir;
}

function unit(id, title, role = "core_concept") {
  return {
    id, title, role, learningQuestion: `What is ${title}?`,
    prerequisiteConcepts: [], newConcepts: [title],
    sourceAnchors: [], sourceFigures: [], sourceFormulas: [], sourceTables: [],
    zettelNotes: [], mustNotRepeat: [], expectedWordRange: [700, 1100],
  };
}

function writePage(gardenDir, rel, unitId, buildId) {
  const abs = path.join(gardenDir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, [
    "---",
    `title: ${JSON.stringify(rel.split("/").pop().replace(/\.md$/, ""))}`,
    'knowledge_type: "learning-page"',
    'breadboardType: "learning_page"',
    'generated_by: "learn_button"',
    `learningUnitId: ${unitId}`,
    `pageId: page:${unitId}`,
    `generatedByBuildId: ${buildId}`,
    "generatedByJobId: job1",
    "contractFingerprint: cf-current",
    "generationAttempt: 1",
    "---",
    "",
    "Body.",
  ].join("\n"));
}

// A legacy page carries no build ownership, only a learningVersionId + date —
// exactly like the real test-2 garden generated before ownership metadata.
function writeLegacyPage(gardenDir, rel, unitId, versionId, date) {
  const abs = path.join(gardenDir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, [
    "---",
    `title: ${JSON.stringify(rel.split("/").pop().replace(/\.md$/, ""))}`,
    `date: ${JSON.stringify(date)}`,
    'knowledge_type: "learning-page"',
    'breadboardType: "learning_page"',
    'generated_by: "learn_button"',
    `learningUnitId: ${unitId}`,
    `learningVersion: ${versionId}`,
    `learningVersionId: ${versionId}`,
    "---",
    "",
    "Body.",
  ].join("\n"));
}

test("Legacy real-world case: two versioned generations freeze to the current one (no build ids)", () => {
  const garden = tmp("legacy-mixed");
  // Current contract: U1..U3 (a later run dropped U4).
  const contract = [unit("U1", "Alpha"), unit("U2", "Beta"), unit("U3", "Gamma")];
  const OLD = "learning_old_aaaa";
  const NEW = "learning_new_bbbb";
  // Old generation (4 units incl. dropped U4), older date, mismatched sections.
  writeLegacyPage(garden, "learning/1. Old A/1.1 Alpha.md", "U1", OLD, "2026-07-15T07:00:00.000Z");
  writeLegacyPage(garden, "learning/1. Old A/1.2 Beta.md", "U2", OLD, "2026-07-15T07:00:00.000Z");
  writeLegacyPage(garden, "learning/2. Old B/2.1 Gamma.md", "U3", OLD, "2026-07-15T07:00:00.000Z");
  writeLegacyPage(garden, "learning/2. Old B/2.2 Delta.md", "U4", OLD, "2026-07-15T07:00:00.000Z");
  // New generation (3 units), newer date, current sections.
  writeLegacyPage(garden, "learning/1. New A/1.1 Alpha.md", "U1", NEW, "2026-07-15T19:00:00.000Z");
  writeLegacyPage(garden, "learning/1. New A/1.2 Beta.md", "U2", NEW, "2026-07-15T19:00:00.000Z");
  writeLegacyPage(garden, "learning/2. New B/2.1 Gamma.md", "U3", NEW, "2026-07-15T19:00:00.000Z");

  // Inference path (no explicit version): current contract matches NEW exactly.
  const result = freezeActiveGenerationByVersion(garden, contract);
  assert.equal(result.currentVersion, NEW);
  assert.equal(result.pagesKept.length, 3);
  assert.equal(result.pagesQuarantined.length, 4);
  assert.equal(fs.existsSync(path.join(garden, "learning", "1. Old A")), false);
  assert.equal(fs.existsSync(path.join(garden, "learning", "2. Old B")), false);
  assert.ok(fs.existsSync(path.join(garden, "learning", "1. New A", "1.1 Alpha.md")));
  // The dropped U4 page is gone from the active tree.
  const active = collectActivePages(garden);
  assert.equal(active.some((p) => p.unitId === "U4"), false);
  for (const u of contract) assert.equal(active.filter((p) => p.unitId === u.id).length, 1);
});

test("Explicit current version keeps exactly that generation", () => {
  const garden = tmp("explicit-version");
  const contract = [unit("U1", "Alpha")];
  writeLegacyPage(garden, "learning/1. Old/1.1 Alpha.md", "U1", "v_old", "2026-07-15T19:00:00.000Z"); // newer date but NOT current
  writeLegacyPage(garden, "learning/1. New/1.1 Alpha.md", "U1", "v_current", "2026-07-15T07:00:00.000Z"); // older date but IS current
  const result = freezeActiveGenerationByVersion(garden, contract, { currentVersion: "v_current" });
  assert.equal(result.currentVersion, "v_current");
  assert.equal(result.pagesQuarantined.length, 1);
  assert.ok(fs.existsSync(path.join(garden, "learning", "1. New", "1.1 Alpha.md")));
  assert.equal(fs.existsSync(path.join(garden, "learning", "1. Old", "1.1 Alpha.md")), false);
});

test("Single generation is a no-op freeze", () => {
  const garden = tmp("single-gen");
  const contract = [unit("U1", "Alpha")];
  writeLegacyPage(garden, "learning/1. S/1.1 Alpha.md", "U1", "v1", "2026-07-15T07:00:00.000Z");
  const result = freezeActiveGenerationByVersion(garden, contract);
  assert.equal(result.changed, false);
  assert.equal(result.pagesQuarantined.length, 0);
});

// The exact Part 21 failure pattern: contract U1..U23, an obsolete U24 page,
// old + new page projections for several units, and stale section trees.
function buildMixedGenerationGarden() {
  const garden = tmp("mixed");
  const contract = [];
  for (let i = 1; i <= 23; i += 1) contract.push(unit(`U${i}`, `Concept ${i}`, i <= 5 ? "core_concept" : i <= 15 ? "metric" : "application"));

  const CURRENT = "build_current";
  const manifest = createActiveBuildManifest({
    buildId: CURRENT, jobId: "job1", gardenSlug: "test-2", sourceSetFingerprint: "sf",
    contractFingerprint: contractFingerprint(contract),
    units: contract.map((u, i) => {
      const section = Math.floor(i / 4) + 1;
      return { unitId: u.id, sectionId: `sec${section}`, expectedPagePath: `learning/${section}. Current Section/${section}.${(i % 4) + 1} ${u.title}.md` };
    }),
    sectionIds: ["sec1", "sec2", "sec3", "sec4", "sec5", "sec6"],
  });
  writeActiveBuildManifest(garden, manifest);

  // Current-build pages for every unit at the manifest path.
  contract.forEach((u, i) => {
    const section = Math.floor(i / 4) + 1;
    writePage(garden, `learning/${section}. Current Section/${section}.${(i % 4) + 1} ${u.title}.md`, u.id, CURRENT);
  });

  // OLD-build duplicate projections for U1, U10, U21 under differently-named
  // section folders (the exact "two generations coexist" symptom).
  writePage(garden, "learning/1. Why Spiking Neural Networks Matters/1.1 Concept 1.md", "U1", "build_old");
  writePage(garden, "learning/3. Measuring Spike-timing-dependent Plasticity/3.2 Concept 10.md", "U10", "build_old");
  writePage(garden, "learning/6. Using Neuromorphic Computing in Practice/6.1 Concept 21.md", "U21", "build_old");

  // An obsolete page whose unit U24 is not in the current contract.
  writePage(garden, "learning/9. Measuring Unified Evaluation Protocol/9.1 Ghost Metric.md", "U24", "build_old");

  return { garden, contract, manifest, CURRENT };
}

test("Part 21: mixed-generation garden converges to one page per unit with U24 quarantined", async () => {
  const { garden, contract, manifest, CURRENT } = buildMixedGenerationGarden();

  // BEFORE: duplicate mappings + unknown unit are present.
  const before = detectStructuralIssues(garden, contract, manifest);
  const duplicatesBefore = before.filter((i) => i.type === "duplicate_unit_page");
  const unknownBefore = before.filter((i) => i.type === "unknown_learning_unit");
  assert.equal(duplicatesBefore.length, 3, "U1, U10, U21 each map to two pages");
  assert.equal(unknownBefore.length, 1, "U24 is an unknown-unit page");

  // Run the convergence loop with a no-op semantic pass (structural repair only).
  let fp = 0;
  const result = await runLearnConvergenceLoop(
    { buildId: CURRENT, jobId: "job1", gardenSlug: "test-2", mode: "regenerate",
      repositoryGardenDir: garden, workspaceRoot: garden, stagingGardenDir: garden,
      stagingLearningDir: path.join(garden, "learning"), contractFingerprint: "cf", sourceSetFingerprint: "sf",
      createdAt: new Date().toISOString() },
    contract,
    {
      runSemanticPass: async () => { fp += 1; return { issues: [], deterministicOperations: [], modelPackets: [], modelDecisionsReceived: 0, modelDecisionsVerified: 0, modelDecisionsRejected: 0, changedFiles: [] }; },
      stateFingerprint: () => String(fp),
    },
  );

  // AFTER: exactly one active page per U1..U23, no duplicates, U24 gone from active.
  const after = detectStructuralIssues(garden, contract, manifest);
  assert.equal(after.filter((i) => i.type === "duplicate_unit_page").length, 0);
  assert.equal(after.filter((i) => i.type === "unknown_learning_unit").length, 0);
  assert.equal(after.filter((i) => i.type === "missing_unit_page").length, 0);

  // The old duplicate section trees are gone.
  assert.equal(fs.existsSync(path.join(garden, "learning", "1. Why Spiking Neural Networks Matters")), false);
  assert.equal(fs.existsSync(path.join(garden, "learning", "3. Measuring Spike-timing-dependent Plasticity")), false);
  assert.equal(fs.existsSync(path.join(garden, "learning", "6. Using Neuromorphic Computing in Practice")), false);

  // U24 is quarantined (not deleted) and NOT part of the active projection.
  assert.equal(fs.existsSync(path.join(garden, "learning", "9. Measuring Unified Evaluation Protocol", "9.1 Ghost Metric.md")), false);
  const quarantineDir = path.join(garden, ".breadboard", "quarantine", CURRENT, "obsolete-pages");
  assert.ok(fs.existsSync(quarantineDir));
  assert.ok(fs.readdirSync(quarantineDir).length >= 1);

  // Every current unit maps to exactly one active page.
  for (const u of contract) {
    const activePages = collectActivePages(garden).filter((p) => p.unitId === u.id);
    assert.equal(activePages.length, 1, `unit ${u.id} must have exactly one active page`);
  }

  // No active page references the stale unified-evaluation section.
  const activeRels = collectActivePages(garden).map((p) => p.rel);
  assert.equal(activeRels.some((rel) => rel.includes("Measuring Unified Evaluation Protocol")), false);

  assert.equal(result.passed, true);
  assert.equal(result.stoppedReason, "accepted");
});

function collectActivePages(gardenDir) {
  const out = [];
  const walk = (relDir) => {
    let entries;
    try { entries = fs.readdirSync(path.join(gardenDir, relDir), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!isActiveLearnerProjectionPath(rel, "cur")) continue;
      const content = fs.readFileSync(path.join(gardenDir, rel), "utf-8");
      const m = /^learningUnitId:\s*(.+)$/m.exec(content);
      out.push({ rel, unitId: m ? m[1].trim() : undefined });
    }
  };
  walk("");
  return out;
}

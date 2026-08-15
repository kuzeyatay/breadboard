import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildFinalLearnerPageIndex,
  buildPageSemanticProjection,
  dedupeSemanticBlockerLines,
  finalGardenStateFingerprint,
  mergeSemanticIssues,
  normalizeSemanticConceptHandle,
  rebuildActiveClaimsFromFinalState,
  rebuildActiveConceptRegistry,
  reconcileFinalGardenSemantics,
  verifyValidationReportSerialization,
  CLAIM_HISTORY_REL_PATH,
} from "../src/lib/semantic-reconciliation.ts";
import { readGardenSemanticArtifacts } from "../src/lib/garden-semantics.ts";
import { normalizeLearningUnits } from "../src/lib/learning-unit-contract.ts";
import { createEmptyConceptRegistry, mergeConcept, stableClaimId } from "../src/lib/semantic-core.ts";

// ---------------------------------------------------------------------------
// Fixture: a garden whose FINAL structure differs from the structure its old
// semantic records were written against — the exact shape of the reported bug.
//
//   final pages:  learning/2. From Spike Events to Spike Trains/2.1 ...
//                 learning/3. How Direct Snn Training Is Applied/3.3 ...
//   old claims:   learning/3. Measuring Classification Accuracy/3.2 ...
//                 learning/5. What the Results Show/5.2 ...
//                 learning/6. Using Multi-objective Evaluation in Practice/6.4 ...
// ---------------------------------------------------------------------------

const UNITS = [
  {
    id: "U1",
    title: "Spikes as Units of Neural Communication",
    section: "2. From Spike Events to Spike Trains",
    page: "2.1 Spikes as Units of Neural Communication.md",
    newConcepts: ["spike-train"],
    prerequisiteConcepts: ["membrane-potential"],
    claims: ["A spike train encodes information in the timing of discrete events."],
  },
  {
    id: "U2",
    title: "ANN-to-SNN Conversion",
    section: "3. How Direct Snn Training Is Applied",
    page: "3.3 ANN-to-SNN Conversion.md",
    newConcepts: ["ann-to-snn-conversion"],
    prerequisiteConcepts: ["spike-train"],
    claims: ["Conversion maps analog activations onto spike rates."],
  },
];

function unitJson(unit) {
  return {
    id: unit.id,
    title: unit.title,
    role: "core_concept",
    learningQuestion: `What should a learner understand from ${unit.title}?`,
    prerequisiteConcepts: unit.prerequisiteConcepts,
    newConcepts: unit.newConcepts,
    sourceAnchors: ["S1.P2"],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    zettelNotes: unit.claims.map((claim, index) => ({
      handle: `${unit.id.toLowerCase()}-claim-${index + 1}`,
      claim,
      connectedTo: [],
    })),
    mustNotRepeat: [],
    expectedWordRange: [700, 1100],
  };
}

/** A learner page whose tags DRIFTED away from primary+supporting concepts. */
function pageMarkdown(unit, { tags, primary, supporting, claimIds }) {
  const fm = [
    "---",
    `title: ${JSON.stringify(unit.title)}`,
    'knowledge_type: "learning-page"',
    'breadboardType: "learning_page"',
    'generated_by: "learn_button"',
    `learningUnitId: ${JSON.stringify(unit.id)}`,
    `primaryConcepts: ${JSON.stringify(primary)}`,
    `supportingConcepts: ${JSON.stringify(supporting)}`,
    `tags: ${JSON.stringify(tags)}`,
    `claimIds: ${JSON.stringify(claimIds)}`,
    "---",
  ].join("\n");
  return `${fm}\n\n## ${unit.title}\n\nTeaching prose for ${unit.title}.\n`;
}

function writeFile(dir, rel, content) {
  const abs = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

/** Stale claims pointing at pages from a PREVIOUS generation's structure. */
const STALE_PAGES = [
  "learning/3. Measuring Classification Accuracy/3.2 Total Spike Count.md",
  "learning/5. What the Results Show/5.2 Training-Loss Dynamics.md",
  "learning/6. Using Multi-objective Evaluation in Practice/6.4 Choosing an SNN Training Strategy.md",
];

function buildDriftedGarden({ driftTags = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-semrec-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(dir, { recursive: true });

  for (const unit of UNITS) {
    const rel = `learning/${unit.section}/${unit.page}`;
    // Tags drift from the concept arrays; claimIds point at claims that will not
    // survive the rebuild.
    writeFile(
      dir,
      rel,
      pageMarkdown(unit, {
        primary: unit.newConcepts,
        supporting: unit.prerequisiteConcepts,
        tags: driftTags ? ["stale-tag-from-old-run", ...unit.newConcepts] : [...unit.newConcepts, ...unit.prerequisiteConcepts],
        claimIds: ["claim:obsolete:deadbeef1234"],
      }),
    );
    writeFile(dir, `learning/${unit.section}/_index.md`, `---\ntitle: ${JSON.stringify(unit.section)}\n---\n\n# ${unit.section}\n`);
  }

  writeFile(
    dir,
    ".breadboard/learning-unit-contract.json",
    `${JSON.stringify({ schemaVersion: 2, learningUnits: UNITS.map(unitJson) }, null, 2)}\n`,
  );

  // A concept registry carrying an orphan concept from the old structure.
  let registry = createEmptyConceptRegistry("test-2", "srchash");
  for (const slug of ["spike-train", "membrane-potential", "ann-to-snn-conversion", "obsolete-old-concept"]) {
    registry = mergeConcept(registry, { slug, preferredLabel: slug, aliases: [], evidenceAnchors: [], status: "unverified" });
  }
  writeFile(dir, ".breadboard/concept-registry.json", `${JSON.stringify(registry, null, 2)}\n`);

  // Active claims from the PREVIOUS page structure (paths no longer on disk).
  const staleClaims = STALE_PAGES.flatMap((pagePath, index) =>
    [0, 1].map((n) => ({
      id: `claim:old${index}${n}:aaaaaaaaaaaa`,
      text: `Obsolete claim ${index}-${n} from the previous structure.`,
      subject: "concept:obsolete-old-concept",
      predicate: "related-to",
      conceptIds: ["concept:obsolete-old-concept"],
      learningUnitId: `UOLD${index}`,
      pageRelPath: pagePath,
      evidenceAnchors: [],
      derivationAnchors: [],
      status: "unverified",
      connectedClaimIds: [],
    })),
  );
  writeFile(
    dir,
    ".breadboard/claims.json",
    `${JSON.stringify({ schemaVersion: 1, gardenId: "test-2", sourceSetHash: "srchash", claims: staleClaims }, null, 2)}\n`,
  );

  // An OLD validation report missing the four Zettelkasten sections.
  writeFile(
    dir,
    ".breadboard/validation-report.md",
    "# Breadboard Validation Report\n\nGenerated: 2020-01-01T00:00:00.000Z\nAccepted: yes\n\n## Export Tree\n\nold report from an earlier generation\n",
  );
  return { root, dir };
}

const OPTIONS = { archiveHistoricalClaims: true, archiveUnusedConcepts: true, strictMode: false };

const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8"));
const readPage = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8");
const fmArray = (text, key) => JSON.parse((text.match(new RegExp(`^${key}: (\\[[^\\]]*\\])`, "m")) ?? [])[1] ?? "[]");

// ---------------------------------------------------------------------------

describe("final learner page index", () => {
  test("discovers current learner pages from the filesystem and excludes section indexes", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const units = normalizeLearningUnits(readJson(dir, ".breadboard/learning-unit-contract.json"));
    const index = buildFinalLearnerPageIndex(dir, units);

    assert.deepEqual(Object.keys(index.byUnitId).sort(), ["U1", "U2"]);
    assert.equal(Object.keys(index.byPagePath).length, 2, "section _index.md files are not learner pages");
    assert.ok(Object.keys(index.byPagePath).every((p) => !p.endsWith("_index.md")));
    assert.equal(index.valid, true);
    assert.deepEqual(index.contractUnitsWithoutPages, []);
  });

  test("an old registry path is never accepted as a final path", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const units = normalizeLearningUnits(readJson(dir, ".breadboard/learning-unit-contract.json"));
    const index = buildFinalLearnerPageIndex(dir, units);
    for (const stale of STALE_PAGES) {
      assert.equal(index.byPagePath[stale], undefined, `${stale} must not be in the final index`);
    }
  });

  test("duplicate unit IDs fail the index", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dup = UNITS[0];
    writeFile(
      dir,
      `learning/${dup.section}/2.9 Duplicate Claiming U1.md`,
      pageMarkdown(dup, { primary: ["spike-train"], supporting: [], tags: ["spike-train"], claimIds: [] }),
    );
    const units = normalizeLearningUnits(readJson(dir, ".breadboard/learning-unit-contract.json"));
    const index = buildFinalLearnerPageIndex(dir, units);
    assert.equal(index.valid, false);
    assert.deepEqual(index.duplicateUnitIds, ["U1"]);
  });

  test("a contract unit without a page is reported", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.rmSync(path.join(dir, "learning", UNITS[1].section, UNITS[1].page));
    const units = normalizeLearningUnits(readJson(dir, ".breadboard/learning-unit-contract.json"));
    const index = buildFinalLearnerPageIndex(dir, units);
    assert.deepEqual(index.contractUnitsWithoutPages, ["U2"]);
  });
});

describe("active claim rebuild", () => {
  test("stale claims are archived, never left active on obsolete pages", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const result = reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);

    const claims = readJson(dir, ".breadboard/claims.json").claims;
    assert.ok(claims.length > 0, "active claims were rebuilt");
    assert.equal(result.staleClaimsRemoved, 6, "all six stale claims archived");

    const finalPaths = new Set(Object.keys(result.pageIndex.byPagePath));
    for (const claim of claims) {
      assert.ok(finalPaths.has(claim.pageRelPath), `active claim points at a final page: ${claim.pageRelPath}`);
    }
    for (const stale of STALE_PAGES) {
      assert.equal(claims.some((c) => c.pageRelPath === stale), false, `no active claim references ${stale}`);
    }
  });

  test("archived claims keep provenance in claims-history", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);
    const history = readJson(dir, CLAIM_HISTORY_REL_PATH);
    assert.equal(history.records.length, 6);
    assert.ok(history.records.every((r) => r.status === "unit_removed"));
    assert.ok(history.records.every((r) => typeof r.archivedAt === "string" && r.reason));
    // Historical records may keep the old path as provenance...
    assert.ok(history.records.some((r) => STALE_PAGES.includes(r.claim.pageRelPath)));
  });

  test("a claim whose stable identity survives is remapped to the new page path", () => {
    // The unit keeps its id and claim text, but its page MOVED.
    const units = normalizeLearningUnits({ learningUnits: [unitJson(UNITS[0])] });
    const unit = units[0];
    const claimText = UNITS[0].claims[0];
    const id = stableClaimId(unit.id, claimText);

    let registry = createEmptyConceptRegistry("g", "");
    for (const slug of ["spike-train", "membrane-potential"]) {
      registry = mergeConcept(registry, { slug, preferredLabel: slug, aliases: [], evidenceAnchors: [], status: "unverified" });
    }
    const newPath = "learning/2. From Spike Events to Spike Trains/2.1 Spikes as Units of Neural Communication.md";
    const pageIndex = {
      byUnitId: { U1: { unitId: "U1", pagePath: newPath, sectionPath: "", title: "", sectionTitle: "", frontmatter: {}, body: "" } },
      byPagePath: { [newPath]: {} },
      duplicateUnitIds: [], orphanPages: [], contractUnitsWithoutPages: [], valid: true, problems: [],
    };
    const previous = [{
      id, text: claimText, subject: "concept:spike-train", predicate: "related-to",
      conceptIds: ["concept:spike-train"], learningUnitId: "U1",
      pageRelPath: "learning/3. Measuring Classification Accuracy/3.2 Total Spike Count.md",
      evidenceAnchors: [], derivationAnchors: [], status: "unverified", connectedClaimIds: [],
    }];

    const result = rebuildActiveClaimsFromFinalState(units, pageIndex, previous, registry);
    assert.deepEqual(result.reusedStableClaimIds, [id], "stable identity reused, not regenerated");
    assert.equal(result.activeClaims[0].pageRelPath, newPath, "page path reassigned from the final index");
    assert.deepEqual(result.removedStaleClaimIds, [], "nothing archived: the claim survived");
  });

  test("page claimIds and the active claim registry are bidirectionally consistent", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);

    const claims = readJson(dir, ".breadboard/claims.json").claims;
    const byPage = new Map();
    for (const claim of claims) {
      byPage.set(claim.pageRelPath, [...(byPage.get(claim.pageRelPath) ?? []), claim.id].sort());
    }
    for (const unit of UNITS) {
      const rel = `learning/${unit.section}/${unit.page}`;
      const pageClaimIds = fmArray(readPage(dir, rel), "claimIds");
      assert.deepEqual(pageClaimIds, byPage.get(rel) ?? [], `${rel}: page.claimIds ↔ active claims`);
      assert.equal(pageClaimIds.includes("claim:obsolete:deadbeef1234"), false, "stale page claimId dropped");
    }
  });
});

describe("tag projection", () => {
  test("tags are rebuilt as unique(primary + supporting) and unrelated tags are removed", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const before = readPage(dir, `learning/${UNITS[0].section}/${UNITS[0].page}`);
    assert.deepEqual(fmArray(before, "tags"), ["stale-tag-from-old-run", "spike-train"], "fixture starts drifted");

    reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);

    for (const unit of UNITS) {
      const text = readPage(dir, `learning/${unit.section}/${unit.page}`);
      const tags = fmArray(text, "tags");
      const primary = fmArray(text, "primaryConcepts");
      const supporting = fmArray(text, "supportingConcepts");
      assert.deepEqual(tags, [...new Set([...primary, ...supporting])], `${unit.id}: tags = primary + supporting`);
      assert.equal(tags.includes("stale-tag-from-old-run"), false, "unrelated tag removed");
    }
  });

  test("duplicate concepts are removed and ordering is deterministic", () => {
    const unit = normalizeLearningUnits({
      learningUnits: [{ ...unitJson(UNITS[0]), newConcepts: ["spike-train", "spike-train"], prerequisiteConcepts: ["membrane-potential", "spike-train"] }],
    })[0];
    let registry = createEmptyConceptRegistry("g", "");
    for (const slug of ["spike-train", "membrane-potential"]) {
      registry = mergeConcept(registry, { slug, preferredLabel: slug, aliases: [], evidenceAnchors: [], status: "unverified" });
    }
    const page = { unitId: "U1", pagePath: "learning/a/b.md", sectionPath: "learning/a", title: "", sectionTitle: "", frontmatter: {}, body: "" };
    const first = buildPageSemanticProjection(unit, page, [], registry);
    const second = buildPageSemanticProjection(unit, page, [], registry);
    assert.deepEqual(first.tags, [...new Set(first.tags)], "no duplicates");
    assert.deepEqual(first.tags, second.tags, "deterministic order");
    assert.deepEqual(first.tags, [...first.primaryConcepts, ...first.supportingConcepts]);
  });

  test("contract semanticConcepts stay synchronized with page concepts", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);

    const contract = readJson(dir, ".breadboard/learning-unit-contract.json");
    for (const unit of UNITS) {
      const contractUnit = contract.learningUnits.find((u) => u.id === unit.id);
      const contractTags = contractUnit.semanticConcepts.map((c) => c.slug);
      const pageTags = fmArray(readPage(dir, `learning/${unit.section}/${unit.page}`), "tags");
      assert.deepEqual(pageTags, contractTags, `${unit.id}: contract concepts == page tags`);
    }
  });
});

describe("concept registry rebuild", () => {
  test("unregistered model concept references are reported, never synthesized", () => {
    const registry = createEmptyConceptRegistry("g", "");
    const projections = [{
      unitId: "U1",
      pagePath: "learning/a/b.md",
      primaryConcepts: ["model-authored-but-unregistered"],
      supportingConcepts: [],
      tags: ["model-authored-but-unregistered"],
      claimIds: [],
      source: "contract",
      problems: [],
    }];

    const result = rebuildActiveConceptRegistry(
      [],
      projections,
      [],
      registry,
      new Set(),
    );

    assert.deepEqual(result.concepts, []);
    assert.deepEqual(result.newConceptIds, []);
    assert.deepEqual(result.unresolvedReferences, [
      'concept "model-authored-but-unregistered" is not registered',
    ]);
  });

  test("a concept referenced only by an obsolete page is archived, not active", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const result = reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);

    const registry = readJson(dir, ".breadboard/concept-registry.json");
    const slugs = registry.concepts.map((c) => c.slug);
    assert.equal(slugs.includes("obsolete-old-concept"), false, "orphan concept removed from active registry");
    assert.ok(slugs.includes("spike-train") && slugs.includes("ann-to-snn-conversion"));
    assert.ok(result.archivedConcepts >= 1);
  });

  test("rebuildActiveConceptRegistry keeps only currently referenced concepts", () => {
    let registry = createEmptyConceptRegistry("g", "");
    for (const slug of ["spike-train", "dead-concept"]) {
      registry = mergeConcept(registry, { slug, preferredLabel: slug, aliases: [], evidenceAnchors: [], status: "unverified" });
    }
    const projections = [{ unitId: "U1", pagePath: "p", primaryConcepts: ["spike-train"], supportingConcepts: [], tags: ["spike-train"], claimIds: [], source: "contract", problems: [] }];
    const result = rebuildActiveConceptRegistry([], projections, [], registry, new Set(registry.concepts.map((c) => c.id)));
    assert.deepEqual(result.concepts.map((c) => c.slug), ["spike-train"]);
    assert.deepEqual(result.archivedConceptIds, ["concept:dead-concept"]);
  });
});

describe("atomic reconciliation", () => {
  test("ambiguous unit→page mapping causes NO partial writes", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dup = UNITS[0];
    writeFile(
      dir,
      `learning/${dup.section}/2.9 Duplicate Claiming U1.md`,
      pageMarkdown(dup, { primary: ["spike-train"], supporting: [], tags: ["spike-train"], claimIds: [] }),
    );
    const claimsBefore = readPage(dir, ".breadboard/claims.json");
    const pageBefore = readPage(dir, `learning/${dup.section}/${dup.page}`);

    const result = reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);

    assert.equal(result.stoppedReason, "ambiguous_unit_page_mapping");
    assert.equal(result.changed, false);
    assert.equal(readPage(dir, ".breadboard/claims.json"), claimsBefore, "claims untouched");
    assert.equal(readPage(dir, `learning/${dup.section}/${dup.page}`), pageBefore, "pages untouched");
  });

  test("reconciliation is idempotent and the fingerprint only moves when state moves", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const first = reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);
    assert.equal(first.changed, true);
    assert.notEqual(first.stateFingerprintBefore, first.stateFingerprintAfter, "state changed → fingerprint changed");

    const second = reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);
    assert.equal(second.changed, false, "second pass is a no-op");
    assert.equal(second.stoppedReason, "no_changes_needed");
    assert.equal(second.stateFingerprintBefore, second.stateFingerprintAfter, "no state change → same fingerprint");
    assert.equal(first.stateFingerprintAfter, second.stateFingerprintAfter);
    assert.deepEqual(second.issuesAfter, [], "no semantic issues remain");
  });

  test("pages, contract, claims and concepts are updated together", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const result = reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);
    assert.equal(result.stoppedReason, "reconciled");
    assert.equal(result.pagesUpdated.length, 2);
    assert.deepEqual(result.contractUnitsUpdated, ["U1", "U2"]);
    assert.ok(result.activeClaims > 0);
    assert.ok(result.activeConcepts > 0);
    const { registry, claims } = readGardenSemanticArtifacts(dir, "test-2");
    assert.ok(registry.concepts.length > 0 && claims.claims.length > 0);
  });
});

describe("report lifecycle", () => {
  test("an old incomplete report does not block reconciliation and is not read as input", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const old = readPage(dir, ".breadboard/validation-report.md");
    assert.equal(/## Zettelkasten Tags/.test(old), false, "fixture report lacks the section");

    const result = reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);
    assert.equal(result.stoppedReason, "reconciled", "stale report is irrelevant to artifact reconciliation");
    assert.deepEqual(result.issuesAfter, []);
  });

  test("verifyValidationReportSerialization reports missing sections without throwing", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const reportPath = path.join(dir, ".breadboard", "validation-report.md");
    const result = verifyValidationReportSerialization(reportPath, ["Export Tree", "Zettelkasten Tags"]);
    assert.equal(result.valid, false);
    assert.deepEqual(result.missingSections, ["Zettelkasten Tags"]);
  });
});

describe("issue identity and deduplication", () => {
  test("one defect reported by three validators counts once and keeps every detector", () => {
    const lines = dedupeSemanticBlockerLines([
      { check: "Learning Unit Contract fulfillment", problem: "learning/2. X/2.1 Y.md: tags must equal primaryConcepts + supportingConcepts" },
      { check: "Canonical semantic registry and claims", problem: "learning/2. X/2.1 Y.md: tags must equal primaryConcepts + supportingConcepts" },
      { check: "Final Garden State Audit", problem: "learning/2. X/2.1 Y.md: tags must equal contract concepts for U1; missing [a], extra [b]" },
    ]);
    assert.equal(lines.length, 1, "one issue, not three blockers");
    assert.match(lines[0], /detected by: Canonical semantic registry and claims, Final Garden State Audit, Learning Unit Contract fulfillment/);
  });

  test("several stale claims on one missing page group into a single issue", () => {
    const lines = dedupeSemanticBlockerLines([
      { check: "Canonical semantic registry and claims", problem: "claim:a:1 : referenced page does not exist: learning/3. Old/3.2 Gone.md" },
      { check: "Canonical semantic registry and claims", problem: "claim:b:2 : referenced page does not exist: learning/3. Old/3.2 Gone.md" },
      { check: "Final Garden State Audit", problem: "claim:c:3 : referenced page does not exist: learning/3. Old/3.2 Gone.md" },
    ]);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /learning\/3\. Old\/3\.2 Gone\.md/);
  });

  test("mergeSemanticIssues unions detectedBy and affected claim IDs", () => {
    const base = { type: "stale_claim_page_mapping", message: "m", pagePath: "p" };
    const merged = mergeSemanticIssues([
      [{ ...base, issueId: "x", evidence: { affectedClaimIds: ["c1"] }, detectedBy: ["A"] }],
      [{ ...base, issueId: "x", evidence: { affectedClaimIds: ["c2"] }, detectedBy: ["B"] }],
    ]);
    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0].detectedBy, ["A", "B"]);
    assert.deepEqual(merged[0].evidence.affectedClaimIds, ["c1", "c2"]);
  });

  test("non-semantic problems pass through untouched", () => {
    const lines = dedupeSemanticBlockerLines([{ check: "Export Tree", problem: "dirty top-level entry: junk/" }]);
    assert.deepEqual(lines, ["Export Tree: dirty top-level entry: junk/"]);
  });
});

describe("canonical normalization", () => {
  test("one normalizer for every concept handle surface", () => {
    for (const [input, expected] of [
      ["concept:Spike Train", "spike-train"],
      ["  Spike   Train  ", "spike-train"],
      ["spike-train", "spike-train"],
    ]) {
      assert.equal(normalizeSemanticConceptHandle(input), expected);
    }
  });
});

describe("regression fixture based on the reported failure", () => {
  test("drifted garden fully reconciles: claims remapped/archived, tags synced, registry rebuilt", (t) => {
    const { root, dir } = buildDriftedGarden();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const fingerprintBefore = finalGardenStateFingerprint(dir);
    const result = reconcileFinalGardenSemantics(dir, "test-2", OPTIONS);

    // Final page index built from the current filesystem.
    assert.deepEqual(Object.keys(result.pageIndex.byUnitId).sort(), ["U1", "U2"]);
    // Old claims archived; active claims rebuilt onto real pages.
    assert.equal(result.staleClaimsRemoved, 6);
    assert.equal(result.archivedClaims, 6);
    assert.ok(result.activeClaims > 0);
    // Tags synchronized deterministically; contract synchronized.
    assert.deepEqual(result.contractUnitsUpdated, ["U1", "U2"]);
    // Concept registry rebuilt.
    assert.ok(result.archivedConcepts >= 1);
    // No semantic issues remain; every "before" issue is resolved.
    assert.ok(result.issuesBefore.length > 0, "fixture starts unhealthy");
    assert.deepEqual(result.issuesAfter, [], "final semantic audit passes");
    assert.notEqual(fingerprintBefore, result.stateFingerprintAfter);

    // No active claim references any obsolete page family.
    const claims = readJson(dir, ".breadboard/claims.json").claims;
    for (const family of [
      "learning/3. Measuring Classification Accuracy/",
      "learning/5. What the Results Show/",
      "learning/6. Using Multi-objective Evaluation in Practice/",
    ]) {
      assert.equal(claims.some((c) => c.pageRelPath.startsWith(family)), false, `no active claim under ${family}`);
    }
  });
});

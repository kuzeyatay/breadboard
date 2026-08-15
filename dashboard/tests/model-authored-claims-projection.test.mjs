import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  projectModelAuthoredClaimsToStore,
  strictModelAuthoredClaimProjectionProblems,
  validateGardenSemantics,
} from "../src/lib/garden-semantics.ts";
import {
  createEmptyConceptRegistry,
  mergeConcept,
  stableClaimId,
} from "../src/lib/semantic-core.ts";

function writeFile(root, rel, content) {
  const absolute = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
}

function learnerPage(unitId, claimIds) {
  return [
    "---",
    'title: "Lesson"',
    'knowledge_type: "learning-page"',
    'breadboardType: "learning_page"',
    `learningUnitId: ${JSON.stringify(unitId)}`,
    'primaryConcepts: ["field-strength"]',
    'supportingConcepts: ["charge-density"]',
    'tags: ["field-strength", "charge-density"]',
    `claimIds: ${JSON.stringify(claimIds)}`,
    "---",
    "",
    "Model-authored lesson prose.",
    "",
  ].join("\n");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-model-claims-"));
  const gardenDir = path.join(root, "electromagnetism-1");
  fs.mkdirSync(gardenDir, { recursive: true });
  let registry = createEmptyConceptRegistry("electromagnetism-1", "source-hash");
  registry = mergeConcept(registry, {
    slug: "field-strength",
    preferredLabel: "Field strength",
    aliases: [],
    evidenceAnchors: ["S1.P2.Intro"],
    status: "source-verified",
  });
  registry = mergeConcept(registry, {
    slug: "charge-density",
    preferredLabel: "Charge density",
    aliases: [],
    evidenceAnchors: ["S1.P3.Intro"],
    status: "source-verified",
  });
  writeFile(gardenDir, ".breadboard/concept-registry.json", `${JSON.stringify(registry, null, 2)}\n`);
  return { root, gardenDir };
}

describe("strict model-authored claim projection", () => {
  test("active Learn projects only after every generated page path is known", () => {
    const learnSource = fs.readFileSync(path.join(process.cwd(), "src", "lib", "learn.ts"), "utf8");
    const pageRecordedAt = learnSource.indexOf("generatedPages.push({");
    const projectedAt = learnSource.indexOf("const claimProjection = projectModelAuthoredClaimsToStore({");
    const finalRepairAt = learnSource.indexOf("repairRun = await repairLearningUnitsFromContract({");
    assert.ok(pageRecordedAt >= 0 && projectedAt > pageRecordedAt);
    assert.ok(finalRepairAt > projectedAt, "strict claim persistence precedes final validation and repair");
  });

  test("preserves model claim semantics exactly and replaces stale store records", (t) => {
    const { root, gardenDir } = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const secondText = "Charge density determines how the field varies spatially.";
    const secondId = stableClaimId("U1", secondText);
    const claims = [
      {
        text: "Field strength increases with the specified source charge.",
        subject: "field-strength",
        predicate: "causes",
        object: "charge-density",
        conceptIds: ["field-strength", "charge-density"],
        evidenceAnchors: ["S1.P2.Intro", "S1.P2.E1"],
        derivationAnchors: ["S1.P2.E2"],
        connectedClaimIds: [secondId],
      },
      {
        text: secondText,
        subject: "charge-density",
        predicate: "measured-by",
        object: "field-strength",
        conceptIds: ["charge-density"],
        evidenceAnchors: [],
        derivationAnchors: ["S1.P3.E1", "S1.P3.E2"],
        connectedClaimIds: [],
      },
    ];
    const claimIds = claims.map((claim) => stableClaimId("U1", claim.text));
    const pageRel = "learning/1. Fields/1.1 Field Strength.md";
    writeFile(gardenDir, pageRel, learnerPage("U1", claimIds));
    writeFile(gardenDir, ".breadboard/learning-unit-contract.json", `${JSON.stringify({
      sourceSetHash: "source-hash",
      learningUnits: [{ id: "U1", knowledgeClaims: claims }],
    }, null, 2)}\n`);
    writeFile(gardenDir, ".breadboard/claims.json", `${JSON.stringify({
      schemaVersion: 1,
      gardenId: "electromagnetism-1",
      sourceSetHash: "old-hash",
      claims: [{ id: "claim:stale:deadbeef0000", text: "stale" }],
    }, null, 2)}\n`);

    const result = projectModelAuthoredClaimsToStore({
      gardenDir,
      gardenId: "electromagnetism-1",
      sourceSetHash: "source-hash",
      units: [{ id: "U1", knowledgeClaims: claims }],
      pages: [{ learningUnitId: "U1", relPath: pageRel }],
    });

    assert.equal(result.claimCount, 2);
    const store = JSON.parse(fs.readFileSync(path.join(gardenDir, ".breadboard", "claims.json"), "utf8"));
    assert.equal(store.projection.authority, "model-authored-learning-unit-contract");
    assert.deepEqual(store.claims.map((claim) => claim.id), claimIds);
    assert.equal(store.claims.some((claim) => claim.id === "claim:stale:deadbeef0000"), false);
    assert.equal(store.claims[0].text, claims[0].text);
    assert.equal(store.claims[0].predicate, claims[0].predicate);
    assert.deepEqual(store.claims[0].evidenceAnchors, claims[0].evidenceAnchors);
    assert.deepEqual(store.claims[0].derivationAnchors, claims[0].derivationAnchors);
    assert.deepEqual(store.claims[0].connectedClaimIds, claims[0].connectedClaimIds);
    assert.equal(store.claims[0].pageRelPath, pageRel);
    assert.equal(store.claims[1].status, "synthesized");
    assert.deepEqual(strictModelAuthoredClaimProjectionProblems(gardenDir), []);

    const secondRun = projectModelAuthoredClaimsToStore({
      gardenDir,
      gardenId: "electromagnetism-1",
      sourceSetHash: "source-hash",
      units: [{ id: "U1", knowledgeClaims: claims }],
      pages: [{ learningUnitId: "U1", relPath: pageRel }],
    });
    assert.deepEqual(secondRun.changedFiles, []);
  });

  test("an empty model claim list clears stale claims without deriving replacements", (t) => {
    const { root, gardenDir } = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const pageRel = "learning/1. Fields/1.1 Field Strength.md";
    writeFile(gardenDir, pageRel, learnerPage("U1", []));
    writeFile(gardenDir, ".breadboard/claims.json", `${JSON.stringify({
      schemaVersion: 1,
      gardenId: "electromagnetism-1",
      sourceSetHash: "source-hash",
      claims: [{ id: "claim:old:aaaaaaaaaaaa", text: "Old inferred claim" }],
    }, null, 2)}\n`);

    projectModelAuthoredClaimsToStore({
      gardenDir,
      gardenId: "electromagnetism-1",
      sourceSetHash: "source-hash",
      units: [{ id: "U1", knowledgeClaims: [] }],
      pages: [{ learningUnitId: "U1", relPath: pageRel }],
    });

    const store = JSON.parse(fs.readFileSync(path.join(gardenDir, ".breadboard", "claims.json"), "utf8"));
    assert.deepEqual(store.claims, []);
  });

  test("a missing page claim id blocks projection and remains a final-gate error", (t) => {
    const { root, gardenDir } = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const pageRel = "learning/1. Fields/1.1 Field Strength.md";
    const claim = {
      text: "Field strength has a direction and magnitude.",
      subject: "field-strength",
      predicate: "related-to",
      conceptIds: ["field-strength"],
      evidenceAnchors: ["S1.P2.Intro"],
      derivationAnchors: [],
      connectedClaimIds: [],
    };
    const claimId = stableClaimId("U1", claim.text);
    writeFile(gardenDir, pageRel, learnerPage("U1", [claimId]));
    writeFile(gardenDir, ".breadboard/learning-unit-contract.json", `${JSON.stringify({
      sourceSetHash: "source-hash",
      learningUnits: [{ id: "U1", knowledgeClaims: [claim] }],
    }, null, 2)}\n`);
    projectModelAuthoredClaimsToStore({
      gardenDir,
      gardenId: "electromagnetism-1",
      sourceSetHash: "source-hash",
      units: [{ id: "U1", knowledgeClaims: [claim] }],
      pages: [{ learningUnitId: "U1", relPath: pageRel }],
    });

    writeFile(gardenDir, pageRel, learnerPage("U1", []));
    const problems = strictModelAuthoredClaimProjectionProblems(gardenDir);
    assert.ok(problems.some((problem) => problem.includes("missing model-authored claimIds") && problem.includes(claimId)));
    assert.ok(validateGardenSemantics(gardenDir).hardFailures.some(
      (problem) => problem.includes("missing model-authored claimIds") && problem.includes(claimId),
    ));
    assert.throws(
      () => projectModelAuthoredClaimsToStore({
        gardenDir,
        gardenId: "electromagnetism-1",
        sourceSetHash: "source-hash",
        units: [{ id: "U1", knowledgeClaims: [claim] }],
        pages: [{ learningUnitId: "U1", relPath: pageRel }],
      }),
      /missing model-authored claimIds/,
    );
    const store = JSON.parse(fs.readFileSync(path.join(gardenDir, ".breadboard", "claims.json"), "utf8"));
    assert.deepEqual(store.claims.map((stored) => stored.id), [claimId], "failed projection does not replace the last valid store");
  });
});

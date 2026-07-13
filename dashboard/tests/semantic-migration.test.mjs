import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  migrateGardenSemantics,
  parseSemanticMarkdown,
  readGardenSemanticArtifacts,
  semanticFrontmatterArray,
  updateLearnerPageConcepts,
  validateGardenSemantics,
} from "../src/lib/garden-semantics.ts";

function write(root, relPath, content) {
  const absolute = path.join(root, ...relPath.split("/"));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
}

function makeLegacyGarden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-semantics-"));
  write(root, ".breadboard/learning-unit-contract.json", `${JSON.stringify({
    schemaVersion: 1,
    sourceSetHash: "fixture-sources",
    learningUnits: [{
      id: "unit-lif",
      title: "The LIF neuron",
      sourceAnchors: ["S1.P4"],
      newConcepts: ["lif-neuron", "spike-threshold"],
      zettelNotes: [{
        handle: "lif-neuron-emits-a-spike-at-threshold",
        claim: "A LIF neuron emits a spike when membrane potential crosses its threshold.",
      }],
    }],
  }, null, 2)}\n`);
  write(root, "learning/neurons/lif.md", `---
title: "The LIF neuron"
knowledge_type: "learning-page"
learningUnitId: "unit-lif"
sourceAnchors: ["S1.P4"]
tags: ["lif-neuron-emits-a-spike-at-threshold", "spike-threshold"]
---

# Leaky integrate-and-fire dynamics

The membrane potential integrates input and a spike is emitted at the firing threshold.
`);
  write(root, "sources/reader.md", `---
title: "Course reader"
knowledge_type: "source-document"
tags: ["lif-neuron", "reader"]
---

Source text.
`);
  return root;
}

test("legacy claim-as-tag gardens migrate without losing claim text", (t) => {
  const root = makeLegacyGarden();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const first = migrateGardenSemantics(root, {
    gardenId: "fixture",
    migratedAt: "2026-07-13T00:00:00.000Z",
  });
  const artifacts = readGardenSemanticArtifacts(root, "fixture");
  const learner = parseSemanticMarkdown(fs.readFileSync(path.join(root, "learning/neurons/lif.md"), "utf8"));
  const source = parseSemanticMarkdown(fs.readFileSync(path.join(root, "sources/reader.md"), "utf8"));

  assert.equal(first.preservedLegacyClaims, 1);
  assert.equal(artifacts.claims.claims.length, 1);
  assert.equal(
    artifacts.claims.claims[0].text,
    "A LIF neuron emits a spike when membrane potential crosses its threshold.",
  );
  assert.deepEqual(semanticFrontmatterArray(learner.data, "primaryConcepts"), ["lif-neuron", "spike-threshold"]);
  assert.deepEqual(semanticFrontmatterArray(learner.data, "tags"), [
    "lif-neuron",
    "spike-threshold",
    "membrane-potential",
  ]);
  assert.equal(semanticFrontmatterArray(learner.data, "claimIds").length, 1);
  assert.deepEqual(semanticFrontmatterArray(source.data, "tags"), []);
  assert.deepEqual(semanticFrontmatterArray(source.data, "semanticHints"), ["lif-neuron", "reader"]);
  assert.ok(first.backupDir);
  assert.ok(fs.existsSync(path.join(root, ...first.backupDir.split("/"))));

  const validation = validateGardenSemantics(root);
  assert.deepEqual(validation.hardFailures, []);

  const second = migrateGardenSemantics(root, { gardenId: "fixture" });
  assert.equal(second.migrated, false);
  assert.deepEqual(second.changedFiles, []);
});

test("manual retagging resolves aliases and synchronizes page, registry, and contract", (t) => {
  const root = makeLegacyGarden();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  migrateGardenSemantics(root, { gardenId: "fixture", migratedAt: "2026-07-13T00:00:00.000Z" });

  const assignment = updateLearnerPageConcepts({
    gardenDir: root,
    pageRelPath: "learning/neurons/lif.md",
    requestedTerms: ["LIF", "event-driven processing"],
    primaryTerms: ["LIF"],
    mode: "replace",
    provenance: "semantic-test",
  });
  const page = parseSemanticMarkdown(fs.readFileSync(path.join(root, "learning/neurons/lif.md"), "utf8"));
  const contract = JSON.parse(fs.readFileSync(path.join(root, ".breadboard/learning-unit-contract.json"), "utf8"));
  const registry = readGardenSemanticArtifacts(root).registry;

  assert.deepEqual(assignment.primaryConcepts, ["lif-neuron"]);
  assert.deepEqual(assignment.supportingConcepts, ["event-driven-processing"]);
  assert.deepEqual(semanticFrontmatterArray(page.data, "tags"), assignment.tags);
  assert.ok(registry.concepts.some((concept) => concept.slug === "event-driven-processing"));
  assert.deepEqual(
    contract.learningUnits[0].semanticConcepts.map((concept) => [concept.slug, concept.role]),
    [["lif-neuron", "primary"], ["event-driven-processing", "supporting"]],
  );
  assert.equal(contract.semanticEditProvenance.source, "semantic-test");
  assert.throws(() => updateLearnerPageConcepts({
    gardenDir: root,
    pageRelPath: "sources/reader.md",
    requestedTerms: ["lif-neuron"],
  }), /only be edited on learner pages/);
  assert.throws(() => updateLearnerPageConcepts({
    gardenDir: root,
    pageRelPath: "learning/neurons/lif.md",
    requestedTerms: ["accuracy-alone-hides-energy-and-latency-cost"],
    mode: "replace",
  }), /not a reusable public concept/);
});

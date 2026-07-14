import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureGardenConceptRegistry,
  migrateGardenSemantics,
  parseSemanticMarkdown,
  readGardenSemanticArtifacts,
  semanticFrontmatterArray,
  updateLearnerPageConcepts,
  validateGardenSemantics,
  writeGardenConceptRegistryAndContract,
} from "../src/lib/garden-semantics.ts";
import { aliasConflicts, resolveConcept } from "../src/lib/semantic-core.ts";

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
  assert.equal(
    artifacts.claims.claims[0].status,
    "unverified",
    "legacy anchor strings are preserved but never treated as verified evidence",
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

test("migration repairs persisted registry and contract alias collisions idempotently", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-alias-repair-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const concepts = [
    {
      slug: "spike-timing",
      preferredLabel: "Spike timing",
      aliases: [],
      role: "primary",
      evidenceAnchors: [],
    },
    {
      slug: "temporal-information",
      preferredLabel: "Temporal information",
      aliases: ["spike timing", "temporal coding"],
      role: "primary",
      evidenceAnchors: [],
    },
  ];
  write(root, ".breadboard/concept-registry.json", `${JSON.stringify({
    schemaVersion: 1,
    gardenId: "fixture",
    sourceSetHash: "fixture-sources",
    concepts,
  }, null, 2)}\n`);
  write(root, ".breadboard/learning-unit-contract.json", `${JSON.stringify({
    schemaVersion: 1,
    sourceSetHash: "fixture-sources",
    // Reproduce a partial Learn write: the old registry already owns the
    // canonical spike-timing term, while the new contract only carries the
    // temporal-information alias that conflicts with it.
    learningUnits: [{
      id: "U1",
      title: concepts[1].preferredLabel,
      semanticConcepts: [concepts[1]],
    }],
  }, null, 2)}\n`);

  const first = migrateGardenSemantics(root, {
    gardenId: "fixture",
    migratedAt: "2026-07-13T00:00:00.000Z",
  });
  const registry = readGardenSemanticArtifacts(root, "fixture").registry;
  const contract = JSON.parse(
    fs.readFileSync(path.join(root, ".breadboard/learning-unit-contract.json"), "utf8"),
  );

  assert.deepEqual(aliasConflicts(registry), []);
  assert.equal(resolveConcept("spike timing", registry)?.slug, "spike-timing");
  assert.deepEqual(
    contract.learningUnits[0].semanticConcepts[0].aliases,
    ["temporal coding"],
  );
  assert.ok(first.diagnostics.some((diagnostic) => /repaired alias "spike timing"/.test(diagnostic)));
  assert.ok(first.changedFiles.includes(".breadboard/concept-registry.json"));
  assert.ok(first.changedFiles.includes(".breadboard/learning-unit-contract.json"));

  const second = migrateGardenSemantics(root, { gardenId: "fixture" });
  assert.equal(second.migrated, false);
  assert.deepEqual(second.changedFiles, []);
});

test("migration never treats an existing alias as the new concept's canonical identity", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-alias-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, ".breadboard/concept-registry.json", `${JSON.stringify({
    schemaVersion: 1,
    gardenId: "fixture",
    concepts: [{
      slug: "temporal-information",
      preferredLabel: "Temporal information",
      aliases: ["spike timing"],
    }],
  }, null, 2)}\n`);
  write(root, ".breadboard/learning-unit-contract.json", `${JSON.stringify({
    schemaVersion: 1,
    learningUnits: [{
      id: "U1",
      title: "Spike timing",
      semanticConcepts: [{
        slug: "spike-timing",
        preferredLabel: "Spike timing",
        role: "primary",
        aliases: [],
      }],
    }],
  }, null, 2)}\n`);

  migrateGardenSemantics(root, {
    gardenId: "fixture",
    migratedAt: "2026-07-13T00:00:00.000Z",
  });
  const registry = readGardenSemanticArtifacts(root, "fixture").registry;

  assert.deepEqual(
    registry.concepts.map((concept) => concept.slug),
    ["spike-timing", "temporal-information"],
  );
  assert.deepEqual(aliasConflicts(registry), []);
  assert.equal(resolveConcept("spike timing", registry)?.slug, "spike-timing");
});

test("migration repairs a slug-owned canonical label collision by relabeling the mislabeled concept", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-canonical-collision-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, ".breadboard", "concept-registry.json");
  // `spike-timing` owns "spike timing" through its SLUG; the second concept is
  // merely mislabeled "Spike timing". This is repairable (relabel the mislabeled
  // one to its slug-derived label) rather than a genuine duplicate identity.
  const originalRegistry = `${JSON.stringify({
    schemaVersion: 1,
    gardenId: "fixture",
    sourceSetHash: "fixture-sources",
    concepts: [{
      id: "concept:spike-timing",
      slug: "spike-timing",
      preferredLabel: "Spike timing",
      aliases: [],
      status: "unverified",
      evidenceAnchors: [],
    }, {
      id: "concept:temporal-information",
      slug: "temporal-information",
      preferredLabel: "Spike timing",
      aliases: [],
      status: "unverified",
      evidenceAnchors: [],
    }],
  }, null, 2)}\n`;
  const originalContract = `${JSON.stringify({
    schemaVersion: 1,
    sourceSetHash: "fixture-sources",
    learningUnits: [],
  }, null, 2)}\n`;
  write(root, ".breadboard/concept-registry.json", originalRegistry);
  write(root, ".breadboard/learning-unit-contract.json", originalContract);

  assert.doesNotThrow(() => migrateGardenSemantics(root, { gardenId: "fixture" }));

  const written = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const bySlug = Object.fromEntries(written.concepts.map((concept) => [concept.slug, concept]));
  // The slug owner keeps the term; the mislabeled concept is relabeled and both survive.
  assert.equal(bySlug["spike-timing"].preferredLabel, "Spike timing");
  assert.equal(bySlug["temporal-information"].preferredLabel, "Temporal information");
  assert.deepEqual(aliasConflicts(written), []);
  assert.equal(resolveConcept("spike timing", written)?.slug, "spike-timing");
});

test("migration still rejects a genuinely ambiguous canonical label collision without writing", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-ambiguous-collision-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, ".breadboard", "concept-registry.json");
  const contractPath = path.join(root, ".breadboard", "learning-unit-contract.json");
  // NEITHER slug owns "timing shift" — two distinct concepts both mislabeled it,
  // so there is no principled winner; this must still be rejected, not guessed.
  const originalRegistry = `${JSON.stringify({
    schemaVersion: 1,
    gardenId: "fixture",
    sourceSetHash: "fixture-sources",
    concepts: [{
      id: "concept:phase-delay",
      slug: "phase-delay",
      preferredLabel: "Timing shift",
      aliases: [],
      status: "unverified",
      evidenceAnchors: [],
    }, {
      id: "concept:sample-offset",
      slug: "sample-offset",
      preferredLabel: "Timing shift",
      aliases: [],
      status: "unverified",
      evidenceAnchors: [],
    }],
  }, null, 2)}\n`;
  const originalContract = `${JSON.stringify({
    schemaVersion: 1,
    sourceSetHash: "fixture-sources",
    learningUnits: [],
  }, null, 2)}\n`;
  write(root, ".breadboard/concept-registry.json", originalRegistry);
  write(root, ".breadboard/learning-unit-contract.json", originalContract);

  assert.throws(
    () => migrateGardenSemantics(root, { gardenId: "fixture" }),
    /Alias collision for "timing shift": concept:phase-delay, concept:sample-offset/,
  );

  assert.equal(fs.readFileSync(registryPath, "utf8"), originalRegistry);
  assert.equal(fs.readFileSync(contractPath, "utf8"), originalContract);
  assert.equal(fs.existsSync(path.join(root, ".breadboard", "backups")), false);
  assert.equal(fs.existsSync(path.join(root, ".breadboard", "claims.json")), false);
  assert.equal(fs.existsSync(path.join(root, ".breadboard", "semantic-migration.json")), false);
});

test("registry reconciliation can be computed without persisting changes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-registry-dry-run-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, ".breadboard", "concept-registry.json");
  const originalContent = `${JSON.stringify({
    schemaVersion: 1,
    gardenId: "fixture",
    sourceSetHash: "old-sources",
    concepts: [{
      id: "concept:temporal-information",
      slug: "temporal-information",
      preferredLabel: "Temporal information",
      aliases: ["temporal coding"],
      status: "unverified",
      evidenceAnchors: [],
    }],
  }, null, 2)}\n`;
  write(root, ".breadboard/concept-registry.json", originalContent);

  const computed = ensureGardenConceptRegistry({
    gardenDir: root,
    gardenId: "fixture",
    sourceSetHash: "new-sources",
    concepts: [{
      slug: "spike-timing",
      preferredLabel: "Spike timing",
      aliases: [],
      role: "primary",
      evidenceAnchors: [],
    }],
    persist: false,
  });

  assert.ok(computed.concepts.some((concept) => concept.slug === "spike-timing"));
  assert.equal(computed.sourceSetHash, "new-sources");
  assert.equal(fs.readFileSync(registryPath, "utf8"), originalContent);
  assert.equal(fs.existsSync(path.join(root, ".breadboard", "backups")), false);
});

test("registry and contract writes roll back when the contract replacement fails", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-semantic-rollback-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, ".breadboard", "concept-registry.json");
  const contractPath = path.join(root, ".breadboard", "learning-unit-contract.json");
  const originalRegistry = `${JSON.stringify({
    schemaVersion: 1,
    gardenId: "fixture",
    sourceSetHash: "old-sources",
    concepts: [],
  }, null, 2)}\n`;
  const originalContract = `${JSON.stringify({
    schemaVersion: 1,
    sourceSetHash: "old-sources",
    learningUnits: [],
  }, null, 2)}\n`;
  write(root, ".breadboard/concept-registry.json", originalRegistry);
  write(root, ".breadboard/learning-unit-contract.json", originalContract);

  const originalRenameSync = fs.renameSync;
  const originalWriteFileSync = fs.writeFileSync;
  const normalizedContractPath = path.resolve(contractPath).toLowerCase();
  const isContract = (target) => path.resolve(String(target)).toLowerCase() === normalizedContractPath;
  let rejectedContractRename = false;

  // The contract file is unwritable by every route: rename is refused (as a
  // sync client holding the destination would) AND the in-place fallback is
  // refused too. Only then may the transaction fail.
  fs.renameSync = (source, destination) => {
    if (isContract(destination)) {
      rejectedContractRename = true;
      const error = new Error("simulated contract rename failure");
      error.code = "EPERM";
      throw error;
    }
    return originalRenameSync(source, destination);
  };
  fs.writeFileSync = (target, ...rest) => {
    if (isContract(target)) {
      const error = new Error("simulated contract write failure");
      error.code = "EPERM";
      throw error;
    }
    return originalWriteFileSync(target, ...rest);
  };

  try {
    assert.throws(() => writeGardenConceptRegistryAndContract({
      gardenDir: root,
      registry: {
        schemaVersion: 1,
        gardenId: "fixture",
        sourceSetHash: "new-sources",
        concepts: [{
          id: "concept:spike-timing",
          slug: "spike-timing",
          preferredLabel: "Spike timing",
          aliases: [],
          status: "unverified",
          evidenceAnchors: [],
        }],
      },
      contract: {
        schemaVersion: 1,
        sourceSetHash: "new-sources",
        learningUnits: [],
      },
    }), /simulated contract (rename|write) failure/);
  } finally {
    // Restore the shared node:fs methods before assertions or test cleanup. This
    // is important on Windows, where a lingering patch can also block rmSync.
    fs.renameSync = originalRenameSync;
    fs.writeFileSync = originalWriteFileSync;
  }

  assert.equal(rejectedContractRename, true);
  assert.equal(fs.readFileSync(registryPath, "utf8"), originalRegistry);
  assert.equal(fs.readFileSync(contractPath, "utf8"), originalContract);
  assert.deepEqual(
    fs.readdirSync(path.dirname(contractPath)).filter((name) => name.includes(".tmp-")),
    [],
  );
});

// A OneDrive/antivirus/search-indexer lock makes rename-over-destination fail
// with EPERM on Windows. That must not abort a generation run: the write falls
// back to overwriting in place, so registry and contract still land together.
test("a destination locked against rename is still written, not rolled back", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-semantic-eperm-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, ".breadboard", "concept-registry.json");
  const contractPath = path.join(root, ".breadboard", "learning-unit-contract.json");
  write(root, ".breadboard/concept-registry.json", "{}\n");
  write(root, ".breadboard/learning-unit-contract.json", "{}\n");

  const originalRenameSync = fs.renameSync;
  let refusedRenames = 0;
  fs.renameSync = () => {
    refusedRenames += 1;
    const error = new Error("EPERM: operation not permitted, rename");
    error.code = "EPERM";
    throw error;
  };

  let result;
  try {
    result = writeGardenConceptRegistryAndContract({
      gardenDir: root,
      registry: {
        schemaVersion: 1,
        gardenId: "fixture",
        sourceSetHash: "new-sources",
        concepts: [],
      },
      contract: { schemaVersion: 1, sourceSetHash: "new-sources", learningUnits: [] },
    });
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.ok(refusedRenames > 0, "the rename path should have been attempted");
  assert.equal(result.changedFiles.length, 2);
  // Both files carry the new content: the transaction completed, nothing rolled back.
  assert.match(fs.readFileSync(registryPath, "utf8"), /new-sources/);
  assert.match(fs.readFileSync(contractPath, "utf8"), /new-sources/);
  assert.deepEqual(
    fs.readdirSync(path.dirname(contractPath)).filter((name) => name.includes(".tmp-")),
    [],
  );
});

test("a non-transient write error still fails loudly instead of being retried away", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-semantic-enospc-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, ".breadboard/concept-registry.json", "{}\n");

  const originalRenameSync = fs.renameSync;
  fs.renameSync = () => {
    const error = new Error("ENOSPC: no space left on device");
    error.code = "ENOSPC";
    throw error;
  };

  try {
    assert.throws(() => writeGardenConceptRegistryAndContract({
      gardenDir: root,
      registry: { schemaVersion: 1, gardenId: "fixture", sourceSetHash: "new", concepts: [] },
      contract: { schemaVersion: 1, sourceSetHash: "new", learningUnits: [] },
    }), /ENOSPC/);
  } finally {
    fs.renameSync = originalRenameSync;
  }
});

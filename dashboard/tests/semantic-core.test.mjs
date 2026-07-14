import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  alignSemanticConceptAliasesWithRegistry,
  aliasConflicts,
  createEmptyConceptRegistry,
  isValidPublicConceptSlug,
  mergeConcept,
  normalizeClaimRecord,
  normalizePageConceptAssignment,
  reconcileConceptRegistryAliases,
  reconcileSemanticConceptAliases,
  resolveConcept,
  sortConceptRegistry,
  stableClaimId,
} from "../src/lib/semantic-core.ts";

describe("semantic core", () => {
  test("separates reusable concepts from sentence-like claims", () => {
    assert.equal(isValidPublicConceptSlug("lif-neuron"), true);
    assert.equal(isValidPublicConceptSlug("spike-threshold"), true);
    assert.equal(isValidPublicConceptSlug("spike-event-makes-timing-part-of-the-representation"), false);
    assert.equal(isValidPublicConceptSlug("learning"), false);
  });

  test("resolves seeded aliases to one canonical concept", () => {
    const registry = mergeConcept(createEmptyConceptRegistry("snn"), {
      slug: "lif-neuron",
      preferredLabel: "Leaky integrate-and-fire neuron",
      aliases: [],
    });

    assert.equal(resolveConcept("LIF", registry)?.id, "concept:lif-neuron");
    assert.equal(resolveConcept("leaky integrate fire model", registry)?.slug, "lif-neuron");
    assert.deepEqual(aliasConflicts(registry), []);
  });

  test("rejects alias collisions instead of silently fragmenting concepts", () => {
    let registry = mergeConcept(createEmptyConceptRegistry("snn"), {
      slug: "spike-threshold",
      preferredLabel: "Spike threshold",
      aliases: ["firing threshold"],
    });

    assert.throws(() => {
      registry = mergeConcept(registry, {
        slug: "decision-boundary",
        preferredLabel: "Decision boundary",
        aliases: ["firing threshold"],
      });
    }, /Alias collision/);
  });

  test("repairs canonical spike-timing ownership without merging temporal-information", () => {
    const candidates = {
      spike: {
        slug: "spike-timing",
        preferredLabel: "Spike timing",
        aliases: [],
      },
      temporal: {
        slug: "temporal-information",
        preferredLabel: "Temporal information",
        aliases: ["spike timing", "temporal coding"],
      },
    };
    const build = (order) => {
      const suppressedAmbiguousAliases = new Set();
      return order.reduce(
        (registry, key) => mergeConcept(
          registry,
          candidates[key],
          { aliasCollisionPolicy: "repair", suppressedAmbiguousAliases },
        ),
        createEmptyConceptRegistry("snn"),
      );
    };

    const forward = build(["spike", "temporal"]);
    const reverse = build(["temporal", "spike"]);
    assert.deepEqual(reverse, forward, "repair must not depend on planner order");
    assert.equal(forward.concepts.length, 2);
    assert.deepEqual(aliasConflicts(forward), []);
    assert.equal(resolveConcept("Spike-Timing", forward)?.id, "concept:spike-timing");
    assert.deepEqual(
      forward.concepts.find((concept) => concept.slug === "temporal-information")?.aliases,
      ["temporal coding"],
    );
  });

  test("removes an ambiguous alias-only term from every concept", () => {
    const suppressedAmbiguousAliases = new Set();
    let registry = mergeConcept(
      createEmptyConceptRegistry("signals"),
      {
        slug: "phase-delay",
        preferredLabel: "Phase delay",
        aliases: ["timing shift"],
      },
      { aliasCollisionPolicy: "repair", suppressedAmbiguousAliases },
    );
    registry = mergeConcept(
      registry,
      {
        slug: "sample-offset",
        preferredLabel: "Sample offset",
        aliases: ["timing shift"],
      },
      { aliasCollisionPolicy: "repair", suppressedAmbiguousAliases },
    );

    assert.deepEqual(aliasConflicts(registry), []);
    assert.equal(resolveConcept("timing shift", registry), null);
    assert.ok(registry.concepts.every((concept) => concept.aliases.length === 0));
  });

  test("consolidates duplicate concept labels before canonical ownership repair", () => {
    const reconciled = reconcileSemanticConceptAliases([
      {
        slug: "temporal-information",
        preferredLabel: "Spike timing",
        aliases: ["spike timing", "temporal coding"],
      },
      {
        slug: "temporal-information",
        preferredLabel: "Temporal information",
        aliases: ["spike timing", "temporal coding"],
      },
      {
        slug: "spike-timing",
        preferredLabel: "Spike timing",
        aliases: [],
      },
    ]);

    assert.deepEqual(reconciled.conflicts, []);
    const temporalPlans = reconciled.concepts.filter(
      (concept) => concept.slug === "temporal-information",
    );
    assert.equal(temporalPlans.length, 2);
    assert.ok(
      temporalPlans.every((concept) => concept.preferredLabel === "Temporal information"),
    );
    assert.ok(
      temporalPlans.every((concept) => !concept.aliases.includes("spike timing")),
    );
    assert.ok(
      temporalPlans.every((concept) => concept.aliases.includes("temporal coding")),
    );
    assert.equal(
      reconciled.concepts.find((concept) => concept.slug === "spike-timing")?.preferredLabel,
      "Spike timing",
    );
  });

  test("aligns a plan to the registry's authoritative preferred label", () => {
    let registry = mergeConcept(createEmptyConceptRegistry("snn"), {
      slug: "temporal-information",
      preferredLabel: "Temporal information",
      aliases: ["temporal coding"],
    });
    registry = mergeConcept(registry, {
      slug: "spike-timing",
      preferredLabel: "Spike timing",
      aliases: [],
    });

    const [aligned] = alignSemanticConceptAliasesWithRegistry([
      {
        slug: "temporal-information",
        preferredLabel: "Spike timing",
        aliases: ["spike timing", "temporal coding"],
      },
    ], registry);

    assert.equal(aligned.preferredLabel, "Temporal information");
    assert.deepEqual(aligned.aliases, ["temporal coding"]);
  });

  test("prefers the mapped STDP label and normalizes equivalent label order deterministically", () => {
    const reconcileStdp = (labels) => reconcileSemanticConceptAliases([
      ...labels.map((preferredLabel) => ({
        slug: "stdp",
        preferredLabel,
        aliases: [],
      })),
      {
        slug: "spike-timing",
        preferredLabel: "Spike timing",
        aliases: [],
      },
    ]);
    const forward = reconcileStdp([
      "Spike timing",
      "Spike-timing-dependent plasticity",
    ]);
    const reverse = reconcileStdp([
      "Spike-timing-dependent plasticity",
      "Spike timing",
    ]);

    assert.deepEqual(reverse, forward);
    assert.deepEqual(forward.conflicts, []);
    assert.ok(
      forward.concepts
        .filter((concept) => concept.slug === "stdp")
        .every((concept) =>
          concept.preferredLabel === "Spike-timing-dependent plasticity" &&
          !concept.aliases.includes("Spike timing")
        ),
    );

    const equivalentLabels = (labels) => reconcileSemanticConceptAliases(
      labels.map((preferredLabel) => ({
        slug: "temporal-information",
        preferredLabel,
        aliases: [],
      })),
    );
    assert.deepEqual(
      equivalentLabels(["Temporal Information", "temporal-information"]),
      equivalentLabels(["temporal-information", "Temporal Information"]),
    );
  });

  test("keeps a repeatedly proposed ambiguous alias suppressed for the whole merge run", () => {
    const candidates = {
      phase: {
        slug: "phase-delay",
        preferredLabel: "Phase delay",
        aliases: ["timing shift"],
      },
      sample: {
        slug: "sample-offset",
        preferredLabel: "Sample offset",
        aliases: ["timing shift"],
      },
    };
    const build = (order) => {
      const suppressedAmbiguousAliases = new Set();
      const registry = order.reduce(
        (current, key) => mergeConcept(
          current,
          candidates[key],
          { aliasCollisionPolicy: "repair", suppressedAmbiguousAliases },
        ),
        createEmptyConceptRegistry("signals"),
      );
      assert.ok(suppressedAmbiguousAliases.has("timing shift"));
      return registry;
    };

    const phaseRepeated = build(["phase", "sample", "phase"]);
    const sampleRepeated = build(["sample", "phase", "sample"]);
    assert.deepEqual(sampleRepeated, phaseRepeated, "the repeated last owner must not affect repair");
    assert.deepEqual(aliasConflicts(phaseRepeated), []);
    assert.equal(resolveConcept("timing shift", phaseRepeated), null);
    assert.ok(phaseRepeated.concepts.every((concept) => concept.aliases.length === 0));
  });

  test("a removed seeded alias is not resurrected by registry normalization", () => {
    const suppressedAmbiguousAliases = new Set();
    let registry = mergeConcept(
      createEmptyConceptRegistry("snn"),
      {
        slug: "spike-threshold",
        preferredLabel: "Spike threshold",
      },
      { aliasCollisionPolicy: "repair", suppressedAmbiguousAliases },
    );
    registry = mergeConcept(
      registry,
      { slug: "firing-threshold", preferredLabel: "Firing threshold" },
      { aliasCollisionPolicy: "repair", suppressedAmbiguousAliases },
    );
    registry = sortConceptRegistry(registry);

    assert.deepEqual(aliasConflicts(registry), []);
    assert.equal(resolveConcept("firing threshold", registry)?.slug, "firing-threshold");
    assert.ok(
      !registry.concepts
        .find((concept) => concept.slug === "spike-threshold")
        ?.aliases.includes("firing threshold"),
    );
  });

  test("restores seeded aliases when sorting a legacy registry record", () => {
    const registry = sortConceptRegistry({
      ...createEmptyConceptRegistry("snn"),
      concepts: [{ slug: "lif-neuron", aliases: [] }],
    });

    const lif = registry.concepts.find((concept) => concept.slug === "lif-neuron");
    assert.ok(lif?.aliases.includes("LIF"));
    assert.equal(resolveConcept("LIF", registry)?.id, "concept:lif-neuron");
    assert.deepEqual(aliasConflicts(registry), []);
  });

  test("restores seeded ownership over a conflicting ordinary legacy alias", () => {
    const legacy = sortConceptRegistry({
      ...createEmptyConceptRegistry("snn"),
      concepts: [
        { slug: "lif-neuron", aliases: [] },
        {
          slug: "latency-code",
          preferredLabel: "Latency code",
          aliases: ["LIF"],
        },
      ],
    });
    const reconciled = reconcileConceptRegistryAliases(legacy);

    assert.deepEqual(reconciled.conflicts, []);
    assert.equal(resolveConcept("LIF", reconciled.registry)?.id, "concept:lif-neuron");
    assert.ok(
      !reconciled.registry.concepts
        .find((concept) => concept.slug === "latency-code")
        ?.aliases.includes("LIF"),
    );
  });

  test("repair mode still rejects canonical label collisions", () => {
    const suppressedAmbiguousAliases = new Set();
    const registry = mergeConcept(
      createEmptyConceptRegistry("signals"),
      {
        slug: "phase-delay",
        preferredLabel: "Timing shift",
      },
      { aliasCollisionPolicy: "repair", suppressedAmbiguousAliases },
    );
    assert.throws(
      () => mergeConcept(
        registry,
        { slug: "sample-offset", preferredLabel: "Timing shift" },
        { aliasCollisionPolicy: "repair", suppressedAmbiguousAliases },
      ),
      /Alias collision for "timing shift"/,
    );
  });

  test("repairs a slug-owned canonical label collision by relabeling the mislabeled concept", () => {
    // A single mislabeled concept (no duplicate-slug entry to override its label):
    // `temporal-information` is labeled "Spike timing", which collides with the
    // `spike-timing` slug. The slug owner wins; the mislabeled concept is relabeled.
    const reconciled = reconcileSemanticConceptAliases([
      { slug: "temporal-information", preferredLabel: "Spike timing", aliases: ["temporal coding"] },
      { slug: "spike-timing", preferredLabel: "Spike timing", aliases: [] },
    ]);
    assert.deepEqual(reconciled.conflicts, []);
    assert.equal(
      reconciled.concepts.find((concept) => concept.slug === "spike-timing")?.preferredLabel,
      "Spike timing",
    );
    assert.equal(
      reconciled.concepts.find((concept) => concept.slug === "temporal-information")?.preferredLabel,
      "Temporal information",
    );
    assert.ok(reconciled.repairs.some((repair) => repair.reason === "canonical-label-relabeled"));
  });

  test("merges a slug-owned canonical label collision in repair mode without throwing", () => {
    const suppressedAmbiguousAliases = new Set();
    let registry = mergeConcept(
      createEmptyConceptRegistry("snn"),
      { slug: "spike-timing", preferredLabel: "Spike timing" },
      { aliasCollisionPolicy: "repair", suppressedAmbiguousAliases },
    );
    registry = mergeConcept(
      registry,
      { slug: "temporal-information", preferredLabel: "Spike timing" },
      { aliasCollisionPolicy: "repair", suppressedAmbiguousAliases },
    );
    assert.deepEqual(aliasConflicts(registry), []);
    assert.equal(resolveConcept("spike timing", registry)?.slug, "spike-timing");
    assert.equal(
      registry.concepts.find((concept) => concept.slug === "temporal-information")?.preferredLabel,
      "Temporal information",
    );
  });

  test("enforces one primary concept and a maximum five-tag public union", () => {
    let registry = createEmptyConceptRegistry("snn");
    for (const slug of [
      "lif-neuron",
      "spike-threshold",
      "membrane-potential",
      "event-driven-processing",
      "surrogate-gradient",
      "neuromorphic-hardware",
    ]) {
      registry = mergeConcept(registry, { slug });
    }

    const result = normalizePageConceptAssignment({
      primaryConcepts: ["LIF"],
      supportingConcepts: [
        "spike-threshold",
        "membrane-potential",
        "event-driven-processing",
        "surrogate-gradient",
        "neuromorphic-hardware",
      ],
      registry,
    });

    assert.deepEqual(result.assignment.primaryConcepts, ["lif-neuron"]);
    assert.equal(result.assignment.tags.length, 5);
    assert.match(result.problems.join("\n"), /maximum is 5/);
  });

  test("creates stable typed claim IDs and requires evidence for verified claims", () => {
    let registry = createEmptyConceptRegistry("snn");
    registry = mergeConcept(registry, { slug: "lif-neuron" });
    registry = mergeConcept(registry, { slug: "spike-threshold" });
    const text = "A LIF neuron emits a spike when membrane potential crosses its threshold.";
    const claim = normalizeClaimRecord({
      text,
      subject: "LIF",
      predicate: "emits-when",
      object: "spike-threshold",
      learningUnitId: "unit-lif",
      pageRelPath: "learning/neurons/lif.md",
      evidenceAnchors: ["S1.P4"],
      status: "source-verified",
      registry,
    });

    assert.equal(claim.id, stableClaimId("unit-lif", text));
    assert.equal(claim.subject, "concept:lif-neuron");
    assert.equal(claim.object, "concept:spike-threshold");
    assert.throws(() => normalizeClaimRecord({
      ...claim,
      subject: "lif-neuron",
      object: "spike-threshold",
      evidenceAnchors: [],
      registry,
    }), /requires at least one evidence anchor/);
  });
});

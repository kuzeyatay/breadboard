import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  aliasConflicts,
  createEmptyConceptRegistry,
  isValidPublicConceptSlug,
  mergeConcept,
  normalizeClaimRecord,
  normalizePageConceptAssignment,
  resolveConcept,
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

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildLearningLinkTargets,
  canonicalizeLearnerWikilinks,
} from "../src/lib/learn-utils.ts";

// A minimal but realistic learning map: only section/subsection titles matter
// for link canonicalization.
function subsection(title) {
  return {
    title,
    purpose: "",
    sourceAnchors: [],
    visualOpportunities: [],
    conceptTags: [],
    sourceVisualIds: [],
    interactiveVisuals: [],
  };
}
function section(title, subsectionTitles) {
  return {
    title,
    purpose: "",
    sourceAnchors: [],
    subsections: subsectionTitles.map(subsection),
  };
}

const MAP = {
  gardenId: "tests",
  title: "Spiking Neural Networks",
  summary: "",
  warnings: [],
  sourceOnly: true,
  createdAt: "2026-07-04T00:00:00.000Z",
  sections: [
    section("Why Spiking Neural Networks Exist", [
      "Continuous Activations, Dense Computation, and the Energy Problem",
      "Spikes, Timing, and Event-Driven Computation",
    ]),
    section("How Spiking Neural Networks Are Structured", [
      "The Leaky Integrate-and-Fire Neuron",
    ]),
    section("How Spiking Neural Networks Learn", [
      "Surrogate Gradient Descent",
      "ANN-to-SNN Conversion",
    ]),
  ],
};

describe("learner wikilink canonicalization", () => {
  test("rewrites a bare section link to the numbered section _index", () => {
    const { markdown, unresolved, rewritten } = canonicalizeLearnerWikilinks(
      "See [[Why Spiking Neural Networks Exist]] first.",
      MAP,
    );
    assert.equal(unresolved.length, 0);
    assert.equal(rewritten, 1);
    assert.match(
      markdown,
      /\[\[Learning\/1\. Why Spiking Neural Networks Exist\/_index\|Why Spiking Neural Networks Exist\]\]/,
    );
  });

  test("rewrites a Section#Subsection heading link to the real subsection file", () => {
    const { markdown, unresolved } = canonicalizeLearnerWikilinks(
      "Study [[How Spiking Neural Networks Learn#Surrogate Gradient Descent]] next.",
      MAP,
    );
    assert.equal(unresolved.length, 0);
    assert.match(
      markdown,
      /\[\[Learning\/3\. How Spiking Neural Networks Learn\/3\.1 Surrogate Gradient Descent\|Surrogate Gradient Descent\]\]/,
    );
    // No loose heading-style link survives.
    assert.doesNotMatch(markdown, /\[\[[^\]/]*#[^\]]*\]\]/);
  });

  test("rewrites a bare subsection link to its own file", () => {
    const { markdown } = canonicalizeLearnerWikilinks(
      "Jump to [[The Leaky Integrate-and-Fire Neuron]].",
      MAP,
    );
    assert.match(
      markdown,
      /\[\[Learning\/2\. How Spiking Neural Networks Are Structured\/2\.1 The Leaky Integrate-and-Fire Neuron\|The Leaky Integrate-and-Fire Neuron\]\]/,
    );
  });

  test("preserves an explicit label", () => {
    const { markdown } = canonicalizeLearnerWikilinks(
      "[[Surrogate Gradient Descent|surrogate training]]",
      MAP,
    );
    assert.match(markdown, /\|surrogate training\]\]/);
  });

  test("leaves already-canonical path links untouched", () => {
    const input = "[[Learning/3. How Spiking Neural Networks Learn/3.1 Surrogate Gradient Descent|x]]";
    const { markdown, rewritten } = canonicalizeLearnerWikilinks(input, MAP);
    assert.equal(markdown, input);
    assert.equal(rewritten, 0);
  });

  test("downgrades an unresolvable link to plain text and reports it", () => {
    const { markdown, unresolved } = canonicalizeLearnerWikilinks(
      "This [[Quantum Teleportation of Spikes]] is not in the map.",
      MAP,
    );
    assert.deepEqual(unresolved, ["Quantum Teleportation of Spikes"]);
    assert.doesNotMatch(markdown, /\[\[/);
    assert.match(markdown, /This Quantum Teleportation of Spikes is not in the map\./);
  });

  test("resolves the built-in Topic Overview / Learning Map pages", () => {
    const targets = buildLearningLinkTargets(MAP).map((t) => t.target);
    assert.ok(targets.includes("Learning/Topic Overview"));
    assert.ok(targets.includes("Learning/Learning Map"));
    const { markdown } = canonicalizeLearnerWikilinks("Back to [[Topic Overview]].", MAP);
    assert.match(markdown, /\[\[Learning\/Topic Overview\|Topic Overview\]\]/);
  });
});

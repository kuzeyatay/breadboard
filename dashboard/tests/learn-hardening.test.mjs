import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  assessLessonQuality,
  hasFallbackFingerprint,
  countSourceCommentary,
  scrubSourceCommentaryProse,
  tagIsRelevantToPage,
  normalizeZettelTags,
  validateLearningMapDepth,
  publicLearningVersionId,
  sourceAppearsVisualRich,
} from "../src/lib/learn-utils.ts";
import {
  buildLifThresholdResetVisual,
  buildRateVsTemporalCodingVisual,
  buildStdpTimingWindowVisual,
  buildMetricTradeoffExplorerVisual,
  buildDeterministicVisual,
  validateVisualSpec,
  IMPLEMENTED_VISUAL_TYPES,
} from "../src/lib/visual-spec.ts";
import { isPublicGardenPath } from "../src/lib/learning-garden.ts";

// A long, clean lesson body used where the quality gate should PASS.
const GOOD_BODY = [
  "Imagine a sensor watching a mostly still scene. " +
    "A spiking neuron stays quiet until its membrane potential crosses a threshold, then fires a discrete spike and resets. ".repeat(
      40,
    ),
  "",
  "For example, raising the input current makes the potential climb faster and the neuron fire sooner.",
  "",
  "**Question.** Why does timing matter here?",
  "",
  "**Answer.** Because the moment of the spike carries information, not just how many spikes occur.",
].join("\n");

describe("fallback + commentary detectors", () => {
  test("hasFallbackFingerprint catches the emergency-draft phrases", () => {
    assert.equal(hasFallbackFingerprint("The durable concept is X."), true);
    assert.equal(hasFallbackFingerprint("Relevant details:\n- a\n- b"), true);
    assert.equal(hasFallbackFingerprint("A spiking neuron fires a discrete event."), false);
  });

  test("countSourceCommentary ignores compact provenance captions", () => {
    const withCaption = "![Fig](x.png)\n\n*Latency comparison from the paper* *(p. 7)*";
    assert.equal(countSourceCommentary(withCaption), 0);
    assert.ok(countSourceCommentary("As the paper explains, the source frames this poorly.") >= 2);
    assert.equal(
      countSourceCommentary("The source of current is the input electrode in this example."),
      0,
    );
  });

  test("scrubSourceCommentaryProse repairs document framing without weakening quality", () => {
    const leaky = GOOD_BODY.replace(
      "Imagine a sensor watching a mostly still scene.",
      "According to the source, imagine a sensor watching a mostly still scene.",
    );
    assert.ok(assessLessonQuality(leaky).problems.some((p) => p.code === "source-commentary" && p.hard));

    const repaired = scrubSourceCommentaryProse(leaky);
    assert.equal(countSourceCommentary(repaired), 0);
    assert.equal(assessLessonQuality(repaired).hardFail, false);
  });

  test("assessLessonQuality hard-fails short, commentary, fallback, and reference-dump pages", () => {
    assert.equal(assessLessonQuality(GOOD_BODY).hardFail, false);

    const short = "**Question.** a\n\n**Answer.** b\n\nImagine a thing. " + "word ".repeat(200);
    assert.equal(assessLessonQuality(short).hardFail, true, "short page is a hard fail");

    const commentary = GOOD_BODY + "\n\nAccording to the source, this is true.";
    const c = assessLessonQuality(commentary);
    assert.ok(c.problems.some((p) => p.code === "source-commentary" && p.hard));

    const fallback = GOOD_BODY + "\n\nRelevant details:\n- one";
    assert.ok(assessLessonQuality(fallback).problems.some((p) => p.code === "fallback-fingerprint" && p.hard));

    const refs = GOOD_BODY + '\n\n[12] A. Author, "Some Paper Title", Journal, 2020.';
    assert.ok(assessLessonQuality(refs).problems.some((p) => p.code === "raw-reference-dump" && p.hard));
  });

  test("assessLessonQuality hard-fails a missing example or Q&A", () => {
    const noExample = "**Question.** a\n\n**Answer.** b\n\n" + "A spiking neuron fires. ".repeat(120);
    assert.ok(assessLessonQuality(noExample).problems.some((p) => p.code === "no-example" && p.hard));
  });
});

describe("page-relevant tag gating", () => {
  const lifContext = {
    title: "The Leaky Integrate-and-Fire Neuron",
    sectionTitle: "Spiking Neurons",
    body: "The membrane potential accumulates until it crosses threshold and the neuron fires. " + "detail ".repeat(50),
    assignedVisualCaptions: [],
  };
  const convContext = {
    title: "From Conventional Networks to Spikes",
    sectionTitle: "Why SNNs Exist",
    body: "Dense networks pass continuous activation values between layers. " + "detail ".repeat(50),
    assignedVisualCaptions: [],
  };

  test("LIF/STDP tags require their own evidence", () => {
    assert.equal(tagIsRelevantToPage("snn/lif-neuron", lifContext), true);
    assert.equal(tagIsRelevantToPage("snn/lif-neuron", convContext), false);
    assert.equal(tagIsRelevantToPage("snn/stdp", lifContext), false);
  });

  test("normalizeZettelTags drops tags the page does not support", () => {
    const tags = normalizeZettelTags(
      ["snn/lif-neuron", "snn/stdp", "computational-neuroscience/membrane-potential"],
      "The Leaky Integrate-and-Fire Neuron",
      "Spiking Neural Networks",
      lifContext,
    );
    assert.ok(tags.includes("snn/lif-neuron"));
    assert.ok(!tags.includes("snn/stdp"), "STDP is unrelated to a LIF page");
  });
});

describe("deterministic interactive visual builders", () => {
  const builders = [
    ["lif_neuron", buildLifThresholdResetVisual],
    ["neural_coding", buildRateVsTemporalCodingVisual],
    ["stdp_window", buildStdpTimingWindowVisual],
    ["tradeoff_explorer", buildMetricTradeoffExplorerVisual],
  ];

  for (const [type, build] of builders) {
    test(`${type} builder produces a valid, implemented, non-empty spec`, () => {
      const spec = build("Learning/2. X/2.1 Page");
      const { spec: validated, errors } = validateVisualSpec(spec);
      assert.ok(validated, `spec should validate: ${errors.join(", ")}`);
      assert.equal(validated.type, type);
      assert.ok(IMPLEMENTED_VISUAL_TYPES.includes(validated.type));
      assert.ok(Object.keys(validated.props).length > 0, "props must be non-empty");
      assert.ok(validated.regenerationPrompt.trim().length > 0);
      assert.match(validated.id, /^[A-Za-z0-9_-]{1,80}$/);
    });
  }

  test("buildDeterministicVisual returns null for an unknown type", () => {
    assert.equal(buildDeterministicVisual("nonexistent", {}), null);
    assert.ok(buildDeterministicVisual("lif_neuron", { gardenId: "g", pageSlug: "p" }));
  });
});

describe("learning-map depth validation", () => {
  const richMap = {
    gardenId: "g",
    title: "Spiking Neural Networks",
    summary: "",
    warnings: [],
    sourceOnly: true,
    createdAt: "",
    sections: [
      { title: "Why SNNs Exist", purpose: "", sourceAnchors: [], subsections: [{ title: "a" }, { title: "b" }, { title: "c" }] },
      { title: "Spiking Neurons", purpose: "", sourceAnchors: [], subsections: [{ title: "d" }, { title: "e" }, { title: "f" }] },
      { title: "How SNNs Learn", purpose: "", sourceAnchors: [], subsections: [{ title: "g" }, { title: "h" }, { title: "i" }] },
    ],
  };
  const shallowMap = {
    ...richMap,
    sections: [
      { title: "Neuron Model LIF as Source-Central Evidence", purpose: "", sourceAnchors: [], subsections: [{ title: "only" }] },
      { title: "What The Paper Covers", purpose: "", sourceAnchors: [], subsections: [{ title: "only" }] },
    ],
  };

  test("a real learning spine passes", () => {
    assert.deepEqual(validateLearningMapDepth(richMap), []);
  });

  test("a shallow, source-shaped map fails", () => {
    const problems = validateLearningMapDepth(shallowMap);
    assert.ok(problems.length > 0);
    assert.ok(problems.some((p) => /source commentary|table of contents/i.test(p)));
  });
});

describe("routing + terminology helpers", () => {
  test("publicLearningVersionId strips a textbook_ prefix", () => {
    assert.equal(publicLearningVersionId("textbook_abc123"), "learning_abc123");
    assert.equal(publicLearningVersionId("learning_abc123"), "learning_abc123");
  });

  test("isPublicGardenPath allows only _index, Learning/, assets/", () => {
    assert.equal(isPublicGardenPath("_index.md"), true);
    assert.equal(isPublicGardenPath("Learning/1. X/1.1 Page.md"), true);
    assert.equal(isPublicGardenPath("assets/source-visuals/fig.png"), true);
    assert.equal(isPublicGardenPath("sources/reader.md"), false);
    assert.equal(isPublicGardenPath("Internal/Concept Graph/x.md"), false);
    assert.equal(isPublicGardenPath(".breadboard/planning/Source Map.md"), false);
    assert.equal(isPublicGardenPath("Learning/Source Map.md"), false);
    assert.equal(isPublicGardenPath("1. source-snapshots/page-003.png"), false);
    assert.equal(isPublicGardenPath("6. spiking-neural-networks/1.1 x.md"), false);
  });

  test("sourceAppearsVisualRich needs both snapshots and figure references", () => {
    assert.equal(
      sourceAppearsVisualRich({
        id: "s", slug: "s", title: "S", relPath: "sources/s.md",
        body: "See Figure 1 and Table 2 for the architecture.",
        sourceImages: ["/g/assets/s-page-004.png"],
      }),
      true,
    );
    assert.equal(
      sourceAppearsVisualRich({
        id: "s", slug: "s", title: "S", relPath: "sources/s.md",
        body: "Plain text with no visuals.",
        sourceImages: ["/g/assets/s-page-004.png"],
      }),
      false,
    );
    assert.equal(
      sourceAppearsVisualRich({
        id: "s", slug: "s", title: "S", relPath: "sources/s.md",
        body: "See Figure 1.", sourceImages: [],
      }),
      false,
    );
  });
});

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assessLessonQuality,
  formatQualityProblemForRepair,
  hasFallbackFingerprint,
  countSourceCommentary,
  sourceCommentaryMatches,
  scrubSourceCommentaryProse,
  tagIsRelevantToPage,
  normalizeZettelTags,
  validateLearningMapDepth,
  publicLearningVersionId,
  selectLearnSources,
  sourceAppearsVisualRich,
} from "../src/lib/learn-utils.ts";
import {
  buildLifThresholdResetVisual,
  buildRateVsTemporalCodingVisual,
  buildStdpTimingWindowVisual,
  buildMetricCalculatorVisual,
  buildTrainingCurveVisual,
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
  test("learn-utils stays text-only while spelling runtime hash separators as escapes", () => {
    const utilityPath = path.join(process.cwd(), "src/lib/learn-utils.ts");
    const bytes = fs.readFileSync(utilityPath);
    const source = bytes.toString("utf8");
    assert.equal(bytes.includes(0), false);
    assert.ok(source.includes('.update("\\0syllabus\\0")'));
    assert.ok(source.includes('.update("\\0")'));
  });

  test("hasFallbackFingerprint catches the emergency-draft phrases", () => {
    assert.equal(hasFallbackFingerprint("The durable concept is X."), true);
    assert.equal(hasFallbackFingerprint("Relevant details:\n- a\n- b"), true);
    assert.equal(hasFallbackFingerprint("A spiking neuron fires a discrete event."), false);
  });

  test("source-commentary matching distinguishes document framing from domain sources", () => {
    const withCaption = "![Fig](x.png)\n\n*Latency comparison from the paper* *(p. 7)*";
    assert.equal(countSourceCommentary(withCaption), 0);
    assert.ok(countSourceCommentary("As the paper explains, the source frames this poorly.") >= 2);
    assert.equal(
      countSourceCommentary("The source of current is the input electrode in this example."),
      0,
    );
    assert.equal(
      countSourceCommentary(
        "For each problem, identify the source, the desired field quantity, the observation region, the material regions, and any interfaces.",
      ),
      0,
    );
    for (const domainUsage of [
      "The electric field from the source falls with distance.",
      "A ray travels from the source, through the aperture, and onto the screen.",
      "The source's electric field points radially outward.",
      "The source provides current to the load.",
      "In the source, the charge density is nonzero.",
      "From the source, the electric field points radially outward.",
      "From the source, the wave propagates through the aperture.",
    ]) {
      assert.equal(countSourceCommentary(domainUsage), 0, domainUsage);
    }

    const documentFraming = [
      ["As shown in the source, the curves cross once.", "As shown in the source"],
      ["As described by the source, the boundary is fixed.", "As described by the source"],
      ["In the source, the derivation begins with symmetry.", "In the source"],
      ["The setup is symmetric. From the source, we learn that the next step is integration.", "From the source"],
      ["Based on the source, the boundary is fixed.", "Based on the source"],
      ["The source's explanation starts from the boundary.", "The source's explanation"],
      ["The source provides an example of the limiting case.", "The source provides an example"],
      ["The source provides evidence for the limiting case.", "The source provides evidence"],
      ["The source contains a worked derivation of the field.", "The source contains a worked derivation"],
      ["The source highlights the limiting case.", "The source highlights"],
    ];
    for (const [line, matchedText] of documentFraming) {
      assert.deepEqual(sourceCommentaryMatches(line), [{ matchedText, snippet: line }], line);
    }

    const commentary = "The source explains the result instead of teaching the result directly.";
    assert.deepEqual(sourceCommentaryMatches(commentary), [
      {
        matchedText: "The source explains",
        snippet: commentary,
      },
    ]);
  });

  test("quality feedback gives an AI repair call the exact offending text", () => {
    const offending = "According to the source, this is true.";
    const result = assessLessonQuality(`${GOOD_BODY}\n\n${offending}`);
    const problem = result.problems.find((candidate) => candidate.code === "source-commentary");
    assert.ok(problem);
    assert.deepEqual(problem.evidence, [offending]);
    assert.equal(
      formatQualityProblemForRepair(problem),
      `source-commentary: 1 source-commentary phrase in teaching prose; offending text: ${JSON.stringify(offending)}`,
    );

    const learnSource = fs.readFileSync(path.join(process.cwd(), "src/lib/learn.ts"), "utf8");
    const overviewValidator = learnSource.slice(
      learnSource.indexOf("function validateTopicOverview"),
      learnSource.indexOf("function sourceMapMarkdown"),
    );
    assert.match(overviewValidator, /problems\.push\(formatQualityProblemForRepair\(problem\)\)/);
    assert.match(learnSource, /failedProblems:\s*lastOverviewProblems/);
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

    const analogy =
      "**Question.** a\n\n**Answer.** b\n\n" +
      "A simple analogy is a room full of motion detectors where only the changed detector reports activity. ".repeat(120);
    assert.equal(
      assessLessonQuality(analogy).problems.some((p) => p.code === "no-example"),
      false,
    );
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
    assert.equal(tagIsRelevantToPage("lif-neuron", lifContext), true);
    assert.equal(tagIsRelevantToPage("lif-neuron", convContext), false);
    assert.equal(tagIsRelevantToPage("stdp", lifContext), false);
  });

  test("normalizeZettelTags drops tags the page does not support", () => {
    const tags = normalizeZettelTags(
      ["lif-neuron", "stdp", "membrane-potential", "spike-threshold"],
      "The Leaky Integrate-and-Fire Neuron",
      "Spiking Neural Networks",
      lifContext,
    );
    assert.ok(tags.includes("lif-neuron"));
    assert.ok(tags.every((tag) => !tag.includes("/")));
    assert.ok(!tags.some((tag) => tag.includes("stdp")), "STDP is unrelated to a LIF page");
  });
});

describe("deterministic interactive visual builders", () => {
  const builders = [
    ["lif_neuron", buildLifThresholdResetVisual],
    ["neural_coding", buildRateVsTemporalCodingVisual],
    ["stdp_window", buildStdpTimingWindowVisual],
    ["metric_calculator", buildMetricCalculatorVisual],
    ["training_curve", buildTrainingCurveVisual],
    ["tradeoff_explorer", buildMetricTradeoffExplorerVisual],
  ];

  for (const [type, build] of builders) {
    test(`${type} builder produces a valid, implemented, non-empty spec`, () => {
      const spec = build("learning/2. X/2.1 Page");
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
  test("selectLearnSources keeps only explicitly included documents", () => {
    const sources = [
      { id: "paper-a", slug: "paper-a", title: "Paper A", relPath: "sources/paper-a.md" },
      { id: "paper-b", slug: "paper-b", title: "Paper B", relPath: "sources/paper-b.md" },
    ];

    assert.deepEqual(
      selectLearnSources(sources, ["paper-b", "paper-b"]).map((source) => source.slug),
      ["paper-b"],
    );
    assert.equal(selectLearnSources(sources).length, 2, "an omitted selection means all documents");
    assert.throws(() => selectLearnSources(sources, []), /Select at least one document/);
    assert.throws(() => selectLearnSources(sources, ["deleted-paper"]), /no longer available/);
  });

  test("publicLearningVersionId strips a textbook_ prefix", () => {
    assert.equal(publicLearningVersionId("textbook_abc123"), "learning_abc123");
    assert.equal(publicLearningVersionId("learning_abc123"), "learning_abc123");
  });

  test("isPublicGardenPath allows _index, learning/, sources/, assets/", () => {
    assert.equal(isPublicGardenPath("_index.md"), true);
    assert.equal(isPublicGardenPath("learning/1. X/1.1 Page.md"), true);
    assert.equal(isPublicGardenPath("assets/source-visuals/fig.png"), true);
    // Sources publish under a visible Sources folder.
    assert.equal(isPublicGardenPath("sources/reader.md"), true);
    assert.equal(isPublicGardenPath("Internal/Concept Graph/x.md"), false);
    assert.equal(isPublicGardenPath(".breadboard/planning/Source Map.md"), false);
    assert.equal(isPublicGardenPath("learning/Source Map.md"), false);
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

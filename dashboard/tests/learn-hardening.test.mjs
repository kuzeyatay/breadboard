import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assessLessonQuality,
  formatQualityProblemForRepair,
  hasPlaceholderText,
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
  sourceVisualInventoryCoverageProblems,
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
    const overviewRepair = learnSource.slice(
      learnSource.indexOf("const overviewOutcome = await runValidatedTextRepairLoop"),
      learnSource.indexOf("const overviewBody = overviewOutcome.markdown"),
    );
    assert.match(
      overviewRepair,
      /request:\s*async \(\{ attempt, previousMarkdown, failedProblems \}\)/,
    );
    assert.match(overviewRepair, /previousMarkdown,\s*failedProblems,/);
  });

  test("placeholder feedback preserves a real unfinished line without rejecting ordinary passive prose", () => {
    const ordinaryProse =
      "A scalar magnetic potential allows the magnetic field intensity to be written as a gradient.";
    assert.equal(hasPlaceholderText(ordinaryProse), false);

    const offending = "This section is to be written later.";
    const result = assessLessonQuality(`${GOOD_BODY}\n\n${offending}`);
    const problem = result.problems.find((candidate) => candidate.code === "placeholder");
    assert.ok(problem);
    assert.deepEqual(problem.evidence, [offending]);
    assert.equal(
      formatQualityProblemForRepair(problem),
      `placeholder: contains placeholder / meta-instruction text; offending text: ${JSON.stringify(offending)}`,
    );
  });

  test("source-formula gate inspects model-authored display math before Quartz rewrites it", () => {
    const learnSource = fs.readFileSync(path.join(process.cwd(), "src/lib/learn.ts"), "utf8");
    assert.match(learnSource, /extractVerbatimDisplayMath\(body\)/);
    assert.doesNotMatch(
      learnSource,
      /extractQuartzMath\(normalizeQuartzMarkdown\(body\)\)/,
    );
  });

  test("source-formula topology recovery promotes only the reviewed active inventory", () => {
    const learnSource = fs.readFileSync(path.join(process.cwd(), "src/lib/learn.ts"), "utf8");
    const reviewBinding = learnSource.slice(
      learnSource.indexOf("const review = await reviewRequiredSourceFormulaExactText"),
      learnSource.indexOf("return review;", learnSource.indexOf("const review = await reviewRequiredSourceFormulaExactText")),
    );
    const postReviewBinding = reviewBinding.slice(reviewBinding.indexOf("const reviewedFormulaIds"));
    assert.match(reviewBinding, /const reviewedFormulaIds = \[\.\.\.review\.formulaIds\]/);
    assert.match(reviewBinding, /requiredFormulaIds:\s*reviewedFormulaIds/);
    assert.match(reviewBinding, /formulaIds:\s*reviewedFormulaIds/);
    assert.match(
      reviewBinding,
      /Accepted source-formula review inventory does not match its projected active equation ledger/,
    );
    assert.doesNotMatch(postReviewBinding, /requiredFormulaIds:\s*formulaIds/);
  });

  test("source-formula topology receipts stay immutable through generation and finalization", () => {
    const learnSource = fs.readFileSync(path.join(process.cwd(), "src/lib/learn.ts"), "utf8");
    assert.match(
      learnSource,
      /sourceFormulaReviewFinalizationContext\s*=\s*\{[\s\S]*?topologyReviewPageReceipts:\s*confirmedReviewManifest\.topologyReviewPageReceipts\.map/,
    );
    assert.match(
      learnSource,
      /sourceFormulaReviewFinalizationContext\s*=\s*\{[\s\S]*?sourceArtifactInventoryHash:\s*confirmedArtifactInventoryHash[\s\S]*?sourceIdentityMap:\s*context\.sourceVisualSourceIdentityMap\.map/,
    );
    const finalizerSource = fs.readFileSync(
      path.join(process.cwd(), "src/lib/garden-finalize.ts"),
      "utf8",
    );
    assert.match(
      finalizerSource,
      /expectedTopologyReviewPageReceipts:\s*expectedSourceFormulaReviewContext\?\.topologyReviewPageReceipts/,
    );
    assert.match(
      finalizerSource,
      /sourceFormulaReviewFinalizationContextFromGarden[\s\S]*?topologyReviewPageReceipts:\s*Array\.isArray\(manifest\?\.topologyReviewPageReceipts\)/,
    );
    assert.match(
      finalizerSource,
      /Selected source-artifact inventory binding[\s\S]*?sourceArtifactInventoryBindingProblems/,
    );
  });

  test("syllabus teachability remains the sole lesson-generation gate when partial sources exist", () => {
    const learnSource = fs.readFileSync(path.join(process.cwd(), "src/lib/learn.ts"), "utf8");
    const assignmentGate = learnSource.slice(
      learnSource.indexOf("function syllabusUnitAssignmentProblems"),
      learnSource.indexOf("function writeLearningUnitContractArtifacts"),
    );
    assert.match(assignmentGate, /else if \(!syllabusUnit\.teachable\)/);
    assert.doesNotMatch(assignmentGate, /availableSourceIds/);
    assert.match(assignmentGate, /assignedTeachableIds/);
    assert.match(assignmentGate, /is not covered by any learning unit/);
    assert.match(
      learnSource,
      /unit\.teachable\\` is the sole authorization to create learning units/,
    );
    assert.match(
      learnSource,
      /could not be fully supported by the available source material and was left uncovered/,
    );
    assert.doesNotMatch(
      learnSource,
      /has no available material in this garden and was left uncovered/,
    );

    const generationGate = learnSource.slice(
      learnSource.indexOf("confirmedLearningUnits = learningUnitsFromCoveragePlan"),
      learnSource.indexOf('appendLearnEvent(contentPath, gardenId, "learn_generation_started"'),
    );
    assert.match(
      generationGate,
      /syllabusUnitAssignmentProblems\(\s*confirmedLearningUnits,\s*map\.syllabusCoverage \?\? null/,
    );
  });

  test("Learn auto-retries proven HTTP 502 receipts until a Council call succeeds", () => {
    const learnSource = fs.readFileSync(path.join(process.cwd(), "src/lib/learn.ts"), "utf8");
    assert.match(
      learnSource,
      /lookup\.code === "request_failed"[\s\S]*?lookup\.receipt\?\.dispatchGeneration === 1[\s\S]*?lookup\.receipt\.redispatchAllowed === true/,
    );
    assert.match(learnSource, /redispatchReason: "request_failed"/);
    assert.match(
      learnSource,
      /sameReceiptRedispatch\?\.redispatchReason === "request_failed"[\s\S]*?clientRequestRedispatch: true/,
    );

    const autoRetry = learnSource.slice(
      learnSource.indexOf("const LEARN_HTTP_502_RETRY_BASE_DELAY_MS"),
      learnSource.indexOf("async function callCouncilJson"),
    );
    assert.match(autoRetry, /for \(;;\)/);
    assert.match(autoRetry, /error instanceof LearnCouncilHttp502ReceiptError/);
    assert.match(autoRetry, /http-502-retry:\$\{retryNumber\}/);
    assert.match(autoRetry, /learnHttp502RetryDelayMs\(retryNumber\)/);
    assert.match(autoRetry, /await waitForLearnHttp502Retry/);

    const planningDispatch = learnSource.slice(
      learnSource.indexOf("const dispatchCouncilRequest = async"),
      learnSource.indexOf("if (ordinaryCheckpoint)"),
    );
    assert.match(planningDispatch, /modelHttpStatus\(error\) === 502/);
    assert.match(planningDispatch, /lookup\.receipt\?\.redispatchAllowed === true/);
    assert.match(planningDispatch, /clientRequestRedispatch: true/);
    assert.match(planningDispatch, /lookup\.receipt\?\.redispatchAllowed === false/);
    assert.match(planningDispatch, /new LearnCouncilHttp502ReceiptError/);

    // A plain SDK/HTTP 502 is not enough: only the exact failed receipt error
    // crosses the infinite loop, so timeouts and in-flight ambiguity still fail closed.
    assert.doesNotMatch(autoRetry, /modelHttpStatus\(error\) === 502/);
  });

  test("a terminal old planning receipt cannot permanently block a changed retry request", () => {
    const learnSource = fs.readFileSync(path.join(process.cwd(), "src/lib/learn.ts"), "utf8");
    const terminalMismatch = learnSource.slice(
      learnSource.indexOf("async function omitTerminallySettledMismatchedPlanningReceipts"),
      learnSource.indexOf("async function resolveCompletedPlanningReceipt"),
    );
    assert.match(terminalMismatch, /row\.request_hash === input\.requestHash/);
    assert.match(terminalMismatch, /requestId: row\.receipt_request_id/);
    assert.match(terminalMismatch, /requestHash: row\.request_hash/);
    assert.match(terminalMismatch, /lookup\.status === 200 && lookup\.result/);
    assert.match(terminalMismatch, /completePlanningCheckpoint/);
    assert.match(terminalMismatch, /lookup\.code === "request_failed"/);
    assert.match(terminalMismatch, /lookup\.receipt\?\.redispatchAllowed === false/);
    assert.match(terminalMismatch, /unresolved\.push\(candidate\)/);
    assert.doesNotMatch(terminalMismatch, /receipt_not_found/);
    assert.match(
      learnSource,
      /omitTerminallySettledMismatchedPlanningReceipts\([\s\S]*?resolveUniquePlanningCandidate/,
    );
  });

  test("Council dispatch authority retries transient lease uncertainty without authorizing it", () => {
    const learnSource = fs.readFileSync(path.join(process.cwd(), "src/lib/learn.ts"), "utf8");
    const ownershipProof = learnSource.slice(
      learnSource.indexOf("function confirmLearnLeaseForFailureCleanup"),
      learnSource.indexOf("const LEARN_JOB_HEARTBEAT_INTERVAL_MS"),
    );
    assert.match(ownershipProof, /ownership === "owned"\) return true/);
    assert.match(ownershipProof, /ownership === "lost"\) return false/);
    assert.match(ownershipProof, /Atomics\.wait/);
    assert.match(
      ownershipProof,
      /function confirmLearnLeaseForCouncilDispatch[\s\S]*?confirmLearnLeaseForFailureCleanup/,
    );
    assert.equal(
      [...learnSource.matchAll(/confirmLearnLeaseForCouncilDispatch\(lease, job\.id\)/g)].length,
      3,
    );
    assert.doesNotMatch(
      learnSource,
      /activeLearnCouncilDispatchAuthorities\.set\([\s\S]{0,180}\(\) => !lease\.lost && lease\.heartbeat\(\)/,
    );
  });

  test("strict native predecessors do not extend the legacy Council quiescence window", () => {
    const learnSource = fs.readFileSync(path.join(process.cwd(), "src/lib/learn.ts"), "utf8");
    const ordinaryLegacyBoundary = learnSource.slice(
      learnSource.indexOf("const exactLineage = exactFailedLearnCouncilLineage"),
      learnSource.indexOf("async function promptlessLegacyPlanningInventoryGet"),
    );
    assert.match(
      ordinaryLegacyBoundary,
      /exactLineage\.filter\([\s\S]*?!hasCompletedNativePlanningCheckpoint\(db, origin\.id\)/,
    );
    assert.match(
      ordinaryLegacyBoundary,
      /legacyLearnCouncilLineageQuiescenceDelayMs\(lineage, Date\.now\(\)\)/,
    );
    assert.match(
      ordinaryLegacyBoundary,
      /learn_council_strict_predecessors_excluded_from_legacy_fallback/,
    );
    assert.match(ordinaryLegacyBoundary, /Pre-migration jobs/);
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
    assert.throws(() => selectLearnSources(sources, []), /Select at least one source/);
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

  test("source visual inventory coverage is per-source and reconciles declared captions", () => {
    const sources = [
      {
        slug: "source-a",
        body: "Figure 1: Architecture overview.\nFigure 2: Latency curve.",
        sourceImages: ["/garden/assets/source-a-page-001.png"],
      },
      {
        slug: "source-b",
        body: "Figure 1: Training dynamics.",
        sourceImages: ["/garden/assets/source-b-page-001.png"],
      },
    ];
    const problems = sourceVisualInventoryCoverageProblems(sources, [
      { sourceId: "source-a", type: "figure" },
    ]);

    assert.ok(problems.some((problem) => /source-a.*declares 2 figure captions.*registered 1/i.test(problem)));
    assert.ok(problems.some((problem) => /source-b.*produced no registered figures/i.test(problem)));
  });
});

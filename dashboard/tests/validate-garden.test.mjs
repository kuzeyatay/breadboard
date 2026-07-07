import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runChecks, validationAccepted, writeValidationReport } from "../../scripts/validate-breadboard-garden.ts";
import {
  buildLifThresholdResetVisual,
  buildRateVsTemporalCodingVisual,
  buildStdpTimingWindowVisual,
  buildMetricTradeoffExplorerVisual,
} from "../src/lib/visual-spec.ts";
import { encodePng } from "../src/lib/png-crop.ts";
import {
  assignSourceArtifacts,
  normalizeLearningUnits,
} from "../src/lib/learning-unit-contract.ts";

// ---------------------------------------------------------------------------
// Fixture builder: a small but structurally-complete SNN garden on disk.
// ---------------------------------------------------------------------------

function fm(obj) {
  const lines = Object.entries(obj).map(([k, v]) =>
    Array.isArray(v)
      ? `${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`
      : `${k}: ${JSON.stringify(v)}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n`;
}

const LONG_PARAGRAPH = (topic) =>
  `Imagine a sensor watching a mostly still scene. ${topic} becomes necessary because a dense system keeps recomputing values even when nothing changes. `.repeat(
    45,
  );

function fixturePng(width = 220, height = 120) {
  return encodePng({
    width,
    height,
    channels: 4,
    colorType: 6,
    pixels: Buffer.alloc(width * height * 4, 255),
  });
}

function goodLesson({ title, tags, body, visualBlock, visualIds, imageUrl, sourceVisualIds, learningUnitId, learningUnitRole }) {
  return (
    fm({
      title,
      knowledge_type: "learning-page",
      breadboardType: "learning_page",
      generated_by: "learn_button",
      generatedBy: "learn_button",
      tags,
      visualIds: visualIds ?? [],
      sourceVisualIds: sourceVisualIds ?? [],
      learningUnitId,
      learningUnitRole,
      learningVersion: "learning_abc",
      learningVersionId: "learning_abc",
    }) +
    `# ${title}\n\n${body}\n\n` +
    (imageUrl ? `![LIF neuron model](${imageUrl})\n\n*LIF neuron model* *(p. 4)*\n\n` : "") +
    (visualBlock ? `${visualBlock}\n\n` : "") +
    `For example, raising the input current makes the potential climb faster.\n\n` +
    `**Question.** Why does timing matter?\n\n**Answer.** Because the moment of a spike carries information.\n`
  );
}

function block(spec) {
  return "```breadboard-visual\n" + JSON.stringify(spec, null, 2) + "\n```";
}

function runChecksWithReport(dir, slug) {
  let results = runChecks(dir, slug);
  writeValidationReport(dir, slug, results);
  results = runChecks(dir, slug);
  writeValidationReport(dir, slug, results);
  return results;
}

function enrichFixtureSpec(spec, { pageRel, sourceAnchors = [] }) {
  spec.pagePath = pageRel;
  spec.learningGoal = `Teach ${spec.title} on this page.`;
  spec.inputs = (spec.controls ?? []).map((control) => `${control.label} control`);
  spec.outputs = [spec.caption ?? spec.pedagogicalPurpose];
  spec.sourceAnchors = sourceAnchors;
  if (sourceAnchors.length > 0) {
    spec.sourceGroundingStatus = "source-grounded";
    spec.justification = "Fixture visual is anchored to the source figure assigned to this page.";
  } else {
    spec.sourceGroundingStatus = "conceptual-no-direct-source-figure";
    spec.justification = "Fixture visual teaches a dynamic concept without a directly assigned source figure.";
  }
  return spec;
}

function buildGoodGarden(root) {
  const gardenDir = path.join(root, "snn-fixture");
  const bb = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(path.join(bb, "visuals"), { recursive: true });
  fs.mkdirSync(path.join(bb, "planning"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "assets", "source-visuals"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "sources"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "learning", "2. Spiking Neurons"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "learning", "3. How SNNs Learn"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "learning", "4. Evaluating SNNs"), { recursive: true });

  fs.writeFileSync(
    path.join(gardenDir, "_index.md"),
    fm({ title: "Spiking Neural Networks", knowledge_type: "cluster-index" }) +
      "# SNN\n\n## Learning\n\n- [[learning/Topic Overview|Topic Overview]]\n\n" +
      "## Sources\n\n- [[sources/_index|Sources]]\n\n" +
      "## Reading Path\n\n" +
      "1. [[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|2.1 The Leaky Integrate-and-Fire Neuron]]\n" +
      "2. [[learning/2. Spiking Neurons/2.2 Encoding Information as Spike Trains|2.2 Encoding Information as Spike Trains]]\n" +
      "3. [[learning/3. How SNNs Learn/3.4 Spike-Timing Dependent Plasticity|3.4 Spike-Timing Dependent Plasticity]]\n" +
      "4. [[learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy|4.1 Accuracy, Latency, and Energy]]\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "learning", "_index.md"),
    fm({ title: "Learning", knowledge_type: "learning-index", breadboardType: "learning_index" }) +
      "# Learning\n\n## Sections\n\n" +
      "- [[learning/2. Spiking Neurons/_index|2. Spiking Neurons]]\n" +
      "  - [[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|2.1 The Leaky Integrate-and-Fire Neuron]]\n" +
      "  - [[learning/2. Spiking Neurons/2.2 Encoding Information as Spike Trains|2.2 Encoding Information as Spike Trains]]\n" +
      "- [[learning/3. How SNNs Learn/_index|3. How SNNs Learn]]\n" +
      "  - [[learning/3. How SNNs Learn/3.4 Spike-Timing Dependent Plasticity|3.4 Spike-Timing Dependent Plasticity]]\n" +
      "- [[learning/4. Evaluating SNNs/_index|4. Evaluating SNNs]]\n" +
      "  - [[learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy|4.1 Accuracy, Latency, and Energy]]\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "learning", "2. Spiking Neurons", "_index.md"),
    fm({ title: "2. Spiking Neurons", knowledge_type: "learning-section", breadboardType: "learning_section" }) +
      "# 2. Spiking Neurons\n\n- [[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|2.1 The Leaky Integrate-and-Fire Neuron]]\n- [[learning/2. Spiking Neurons/2.2 Encoding Information as Spike Trains|2.2 Encoding Information as Spike Trains]]\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "learning", "3. How SNNs Learn", "_index.md"),
    fm({ title: "3. How SNNs Learn", knowledge_type: "learning-section", breadboardType: "learning_section" }) +
      "# 3. How SNNs Learn\n\n- [[learning/3. How SNNs Learn/3.4 Spike-Timing Dependent Plasticity|3.4 Spike-Timing Dependent Plasticity]]\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "learning", "4. Evaluating SNNs", "_index.md"),
    fm({ title: "4. Evaluating SNNs", knowledge_type: "learning-section", breadboardType: "learning_section" }) +
      "# 4. Evaluating SNNs\n\n- [[learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy|4.1 Accuracy, Latency, and Energy]]\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "learning", "Topic Overview.md"),
    fm({ title: "Topic Overview", knowledge_type: "topic-overview", breadboardType: "topic_overview" }) +
      "# Topic Overview\n\n## Reading Order\n\n" +
      "- [[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|LIF neuron]]\n" +
      "- [[learning/2. Spiking Neurons/2.2 Encoding Information as Spike Trains|Spike trains]]\n" +
      "- [[learning/3. How SNNs Learn/3.4 Spike-Timing Dependent Plasticity|STDP]]\n" +
      "- [[learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy|Metrics]]\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "learning", "Learning Map.md"),
    fm({ title: "Learning Map", knowledge_type: "learning-map", breadboardType: "learning_map" }) +
      "# Learning Map\n\n- [[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|LIF neuron]]\n",
  );

  // Source note: publishes under a visible Sources folder. Older sources still
  // carry internal:true, which the source-document allow overrides.
  fs.writeFileSync(
    path.join(gardenDir, "sources", "snn.md"),
    fm({
      title: "Spiking Neural Networks Review",
      knowledge_type: "source-document",
      breadboardType: "source_document",
      internal: "true",
      source_images: ["/snn-fixture/assets/snn-page-004.png"],
    }) + "See Figure 1 for the LIF model and Table 2 for latency.\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "sources", "_index.md"),
    fm({ title: "Sources", knowledge_type: "source-index", breadboardType: "source_index", internal: "true" }) +
      "# Sources\n\n- [[sources/snn|Spiking Neural Networks Review]]\n",
  );

  // Cropped source figure asset + ledger.
  const imageUrl = "/snn-fixture/assets/source-visuals/snn-lif.png";
  fs.writeFileSync(path.join(gardenDir, "assets", "source-visuals", "snn-lif.png"), fixturePng());
  const ledger = [
    {
      sourceVisualId: "S1.P4.F1",
      sourceId: "snn",
      pageNumber: 4,
      type: "figure",
      caption: "LIF neuron model",
      croppedImagePath: imageUrl,
      usageStatus: "assigned",
      assignedPageId: "learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron",
    },
  ];
  fs.writeFileSync(path.join(bb, "source-visuals.json"), JSON.stringify(ledger, null, 2));

  const learningUnits = normalizeLearningUnits([
    {
      id: "U1",
      role: "motivation",
      title: "Why event-driven computation matters",
      learningQuestion: "Why do sparse spike events save work?",
      zettelNotes: [{ handle: "event-driven-computation-saves-work-by-staying-silent", claim: "Event-driven computation saves work by staying silent." }],
    },
    {
      id: "U2",
      role: "core_concept",
      title: "What a spike represents",
      learningQuestion: "What information does a spike carry?",
      newConcepts: ["spike event"],
      zettelNotes: [{ handle: "spike-events-carry-information-through-timing", claim: "Spike events carry information through timing." }],
    },
    {
      id: "U3",
      role: "mechanism",
      title: "The leaky integrate-and-fire neuron",
      learningQuestion: "How does a LIF membrane potential reach threshold and reset?",
      newConcepts: ["membrane potential", "threshold", "reset"],
      sourceFigures: [{ id: "S1.P4.F1", placement: "inside_concept_explanation", mustBeDiscussedWith: "LIF neuron model", interpretationGoal: "Use the cropped source figure to identify the membrane, threshold, spike, and reset pieces." }],
      interactiveVisual: { id: "v_lif", visualType: "lif_neuron", uniqueConcept: "membrane potential threshold reset", whyStaticSourceFigureIsNotEnough: "The learner must watch the potential climb, spike, and reset over time.", learnerManipulates: ["input current", "threshold"], expectedInsight: "threshold and input current control firing", sourceAnchors: ["S1.P4.F1"] },
      zettelNotes: [
        { handle: "lif-threshold-turns-accumulated-input-into-spikes", claim: "A LIF threshold turns accumulated input into spikes." },
        { handle: "membrane-reset-makes-spikes-discrete-events", claim: "Reset makes spikes discrete events." },
        { handle: "input-current-controls-threshold-crossing-rate", claim: "Input current controls threshold crossing rate." },
      ],
    },
    {
      id: "U4",
      role: "mechanism",
      title: "Encoding information as spike trains",
      learningQuestion: "How do rate and temporal coding differ?",
      newConcepts: ["rate coding", "temporal coding"],
      interactiveVisual: { id: "v_coding", visualType: "neural_coding", uniqueConcept: "rate coding versus temporal coding", whyStaticSourceFigureIsNotEnough: "The learner changes spike timing and sees the code change.", learnerManipulates: ["spike rate", "timing jitter"], expectedInsight: "rate and timing carry different information", sourceAnchors: [] },
      zettelNotes: [
        { handle: "spike-train-timing-changes-the-message", claim: "Spike train timing changes the message." },
        { handle: "rate-coding-uses-spike-count-as-signal", claim: "Rate coding uses spike count as a signal." },
        { handle: "temporal-coding-moves-information-into-timing", claim: "Temporal coding moves information into timing." },
      ],
    },
    {
      id: "U5",
      role: "formula",
      title: "The membrane update rule",
      learningQuestion: "What formal rule describes membrane integration?",
      zettelNotes: [{ handle: "membrane-update-rules-connect-input-leak-and-state", claim: "Membrane update rules connect input, leak, and state." }],
    },
    {
      id: "U6",
      role: "training_method",
      title: "Spike-timing dependent plasticity",
      learningQuestion: "How does STDP use pre/post timing?",
      newConcepts: ["STDP", "plasticity"],
      interactiveVisual: { id: "v_stdp", visualType: "stdp_window", uniqueConcept: "STDP pre and post timing window", whyStaticSourceFigureIsNotEnough: "The learner drags spike timing and sees the weight update sign change.", learnerManipulates: ["pre/post delay"], expectedInsight: "timing order changes synaptic weight direction", sourceAnchors: [] },
      zettelNotes: [
        { handle: "stdp-updates-weights-from-local-spike-timing", claim: "STDP updates weights from local spike timing." },
        { handle: "pre-before-post-spikes-strengthen-connections", claim: "Pre-before-post spikes strengthen connections." },
        { handle: "post-before-pre-spikes-weaken-connections", claim: "Post-before-pre spikes weaken connections." },
      ],
    },
    {
      id: "U7",
      role: "metric",
      title: "Accuracy latency and energy tradeoffs",
      learningQuestion: "Why is accuracy alone not enough?",
      newConcepts: ["latency", "energy", "spike count"],
      interactiveVisual: { id: "v_tradeoff", visualType: "tradeoff_explorer", uniqueConcept: "accuracy energy latency tradeoff", whyStaticSourceFigureIsNotEnough: "The learner changes priorities and sees which metric dominates.", learnerManipulates: ["priority"], expectedInsight: "the best model depends on metric priorities", sourceAnchors: [] },
      zettelNotes: [
        { handle: "accuracy-alone-hides-energy-and-latency-cost", claim: "Accuracy alone hides energy and latency cost." },
        { handle: "spike-count-connects-activity-to-hardware-cost", claim: "Spike count connects activity to hardware cost." },
        { handle: "metric-priorities-change-which-model-wins", claim: "Metric priorities change which model wins." },
      ],
    },
    {
      id: "U8",
      role: "synthesis",
      title: "Putting spikes mechanisms and metrics together",
      learningQuestion: "How do spike timing, mechanisms, and metrics connect?",
      zettelNotes: [{ handle: "event-driven-design-connects-timing-energy-and-accuracy", claim: "Event-driven design connects timing, energy, and accuracy." }],
    },
  ]);
  const sourceArtifactAssignments = assignSourceArtifacts(learningUnits);
  fs.writeFileSync(
    path.join(bb, "learning-unit-contract.json"),
    JSON.stringify(
      {
        sourceSetHash: "fixture",
        generatedAt: "2026-01-01T00:00:00.000Z",
        learningUnits,
        sourceArtifactAssignments,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(bb, "planning", "Source Map.md"),
    [
      "# Source Map",
      "",
      "## Relevant Sources Found",
      "",
      "- [[sources/snn|Spiking Neural Networks Review]]",
      "",
      "## Source Figures, Graphs, Tables, And Formula Displays",
      "",
      "- S1.P4.F1: LIF neuron model (figure), page 4",
      "",
      "## Council Source Map",
      "",
      "Figures are present in the extracted source anchors.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(bb, "planning", "Source Coverage.md"),
    [
      "# Source Coverage",
      "",
      "Coverage is derived from the Learning Unit Contract artifact assignments and final page fulfillment only. It does not use title or keyword heuristics.",
      "",
      "## Sources Used",
      "",
      "- Spiking Neural Networks Review (snn)",
      "",
      "## Contract Artifact Fulfillment",
      "",
      "- S1.P4.F1: assigned to U3 ([[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|2.1 The Leaky Integrate-and-Fire Neuron]]); fulfilled; placement=inside_concept_explanation; Use the cropped source figure to identify the membrane, threshold, spike, and reset pieces.",
      "",
      "## Embedded Source Crops",
      "",
      "- S1.P4.F1: [[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|2.1 The Leaky Integrate-and-Fire Neuron]]; placement=inside_concept_explanation; Use the cropped source figure to identify the membrane, threshold, spike, and reset pieces.",
      "",
      "## Explained as Text Formulas",
      "",
      "- None.",
      "",
      "## Explained in Prose",
      "",
      "- None.",
      "",
      "## Used as Interactive Grounding",
      "",
      "- S1.P4.F1: [[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|2.1 The Leaky Integrate-and-Fire Neuron]]; interactive visualIds=v_lif",
      "",
      "## Referenced Again in Synthesis",
      "",
      "- None.",
      "",
      "## Crop Omitted With Text Fallback",
      "",
      "- None.",
      "",
      "## Intentionally Omitted",
      "",
      "- None.",
      "",
      "## Missing or Misplaced",
      "",
      "- None.",
      "",
    ].join("\n"),
  );

  // Interactive visuals are optional, but these four pages deliberately carry
  // distinct contract-backed visuals.
  const specs = {
    lif: enrichFixtureSpec(
      buildLifThresholdResetVisual("learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron"),
      {
        pageRel: "learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron.md",
        sourceAnchors: [{ sourceId: "snn", page: 4, figureId: "S1.P4.F1", description: "LIF neuron model" }],
      },
    ),
    coding: enrichFixtureSpec(
      buildRateVsTemporalCodingVisual("learning/2. Spiking Neurons/2.2 Encoding Information as Spike Trains"),
      { pageRel: "learning/2. Spiking Neurons/2.2 Encoding Information as Spike Trains.md" },
    ),
    stdp: enrichFixtureSpec(
      buildStdpTimingWindowVisual("learning/3. How SNNs Learn/3.4 Spike-Timing Dependent Plasticity"),
      { pageRel: "learning/3. How SNNs Learn/3.4 Spike-Timing Dependent Plasticity.md" },
    ),
    tradeoff: enrichFixtureSpec(
      buildMetricTradeoffExplorerVisual("learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy"),
      { pageRel: "learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy.md" },
    ),
  };
  const index = {};
  for (const spec of Object.values(specs)) {
    fs.writeFileSync(path.join(bb, "visuals", `${spec.id}.json`), JSON.stringify(spec, null, 2));
    index[spec.id] = { id: spec.id, type: spec.type, title: spec.title, version: spec.version, updatedAt: spec.createdAt };
  }
  fs.writeFileSync(path.join(bb, "visual-index.json"), JSON.stringify(index, null, 2));

  const pages = [
    {
      rel: "learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron.md",
      title: "2.1 The Leaky Integrate-and-Fire Neuron",
      tags: [
        "lif-threshold-turns-accumulated-input-into-spikes",
        "membrane-reset-makes-spikes-discrete-events",
        "input-current-controls-threshold-crossing-rate",
      ],
      body: LONG_PARAGRAPH("The leaky integrate-and-fire neuron, membrane potential threshold, firing event, spike, and reset"),
      spec: specs.lif,
      imageUrl,
      sourceVisualIds: ["S1.P4.F1"],
      learningUnitId: "U3",
      learningUnitRole: "mechanism",
    },
    {
      rel: "learning/2. Spiking Neurons/2.2 Encoding Information as Spike Trains.md",
      title: "2.2 Encoding Information as Spike Trains",
      tags: [
        "spike-train-timing-changes-the-message",
        "rate-coding-uses-spike-count-as-signal",
        "temporal-coding-moves-information-into-timing",
      ],
      body: LONG_PARAGRAPH("Rate coding and temporal coding of spike trains and spike timing"),
      spec: specs.coding,
      learningUnitId: "U4",
      learningUnitRole: "mechanism",
    },
    {
      rel: "learning/3. How SNNs Learn/3.4 Spike-Timing Dependent Plasticity.md",
      title: "3.4 Spike-Timing Dependent Plasticity",
      tags: [
        "stdp-updates-weights-from-local-spike-timing",
        "pre-before-post-spikes-strengthen-connections",
        "post-before-pre-spikes-weaken-connections",
      ],
      body: LONG_PARAGRAPH("Spike-timing dependent plasticity (STDP), temporal credit assignment, and synaptic plasticity across the timing window"),
      spec: specs.stdp,
      learningUnitId: "U6",
      learningUnitRole: "training_method",
    },
    {
      rel: "learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy.md",
      title: "4.1 Accuracy, Latency, and Energy",
      tags: [
        "accuracy-alone-hides-energy-and-latency-cost",
        "spike-count-connects-activity-to-hardware-cost",
        "metric-priorities-change-which-model-wins",
      ],
      body:
        LONG_PARAGRAPH("Accuracy, latency, energy and spike count as a tradeoff") +
        " latency latency spike count spike count energy energy trade-off across model families and model family comparison.",
      spec: specs.tradeoff,
      learningUnitId: "U7",
      learningUnitRole: "metric",
    },
  ];
  for (const page of pages) {
    fs.writeFileSync(
      path.join(gardenDir, ...page.rel.split("/")),
      goodLesson({
        title: page.title,
        tags: page.tags,
        body: page.body,
        visualBlock: block(page.spec),
        visualIds: [page.spec.id],
        imageUrl: page.imageUrl,
        sourceVisualIds: page.sourceVisualIds,
        learningUnitId: page.learningUnitId,
        learningUnitRole: page.learningUnitRole,
      }),
    );
  }

  return gardenDir;
}

function buildBadZipShapedGarden(root) {
  const gardenDir = path.join(root, "test-2");
  fs.mkdirSync(path.join(gardenDir, ".breadboard"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "Learning", "1. Bad Export"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "Internal", "Concept Graph"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "1. spiking-neural-networks-the-future-of-brain-inspired-computing"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "sources"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(gardenDir, "_index.md"),
    fm({ title: "Spiking Neural Networks", knowledge_type: "cluster-index" }) +
      "# Spiking Neural Networks\n\n## Reading Path\n\n- No lessons yet.\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "Learning", "1. Bad Export", "1.1 Bad Export.md"),
    fm({
      title: "1.1 Bad Export",
      knowledge_type: "learning-page",
      breadboardType: "learning_page",
      generated_by: "learn_button",
      generatedBy: "learn_button",
      tags: ["snn/bad-export", "snn/lif-neuron-threshold-reset", "metric/convergence-time-target-epoch"],
      visualIds: [],
      learningVersion: "learning_bad",
      learningVersionId: "learning_bad",
    }) +
      "# 1.1 Bad Export\n\nImagine a battery-powered robot in a quiet hallway. This page is intentionally short.\n\n**Question.** x\n\n**Answer.** y\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "Internal", "Concept Graph", "concept.md"),
    fm({ title: "Internal Concept", knowledge_type: "internal-concept", breadboardType: "internal_concept" }) + "# Internal\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "1. spiking-neural-networks-the-future-of-brain-inspired-computing", "source.md"),
    fm({ title: "Source Conversion", knowledge_type: "learning-page", breadboardType: "learning_page", internal: "true" }) + "# Source\n",
  );
  fs.writeFileSync(
    path.join(gardenDir, "sources", "2510-27379v1.md"),
    fm({ title: "Source", knowledge_type: "source-document", breadboardType: "source_document", internal: "true" }) +
      "# Source\n\nSee [[2510-27379v1]] and [[Page 1]].\n",
  );
  fs.writeFileSync(path.join(gardenDir, ".breadboard", "source-visuals.json"), "[]");
  fs.writeFileSync(path.join(gardenDir, ".breadboard", "visual-index.json"), "{}");
  return gardenDir;
}

// ---------------------------------------------------------------------------

describe("garden validator regression fixture", () => {
  function checkById(results, id) {
    return results.find((result) => result.id === id);
  }

  test("skip checks with problems block acceptance", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-skip-problems-"));
    try {
      const dir = path.join(root, "garden");
      fs.mkdirSync(dir, { recursive: true });
      const results = [
        {
          id: 99,
          name: "bad skip",
          status: "SKIP",
          severity: "skip",
          problems: ["actionable problem hidden in a skipped check"],
          acceptanceBlocking: false,
        },
      ];
      assert.equal(validationAccepted(results), false);
      writeValidationReport(dir, "garden", results);
      const report = fs.readFileSync(path.join(dir, ".breadboard", "validation-report.md"), "utf-8");
      assert.match(report, /^Accepted:\s+no$/m);
      assert.match(report, /internal validator error: check "bad skip" was marked SKIP/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a correctly generated SNN garden passes every hard check", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-good-"));
    try {
      const dir = buildGoodGarden(root);
      const results = runChecksWithReport(dir, "snn-fixture");
      const fails = results.filter((r) => r.status === "FAIL");
      assert.deepEqual(
        fails.map((f) => `${f.id}. ${f.name}: ${f.problems.join(" | ")}`),
        [],
        "no check should fail on the good garden",
      );
      // Sanity: the optional-visual dedupe check actually ran (not skipped).
      const visualDedupe = results.find((r) => r.id === 16);
      assert.equal(visualDedupe.status, "PASS", "interactive visual signature check must run and pass");
      const report = fs.readFileSync(path.join(dir, ".breadboard", "validation-report.md"), "utf-8");
      assert.match(report, /^Accepted:\s+yes$/m);
      assert.match(report, /## Learning Unit Contract Fulfillment/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("repeated opening motifs are not skipped when a contract exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-repeated-openings-"));
    try {
      const dir = buildGoodGarden(root);
      const motif = "A battery-powered robot moves through a quiet hallway while a dense ANN keeps recomputing every frame. ";
      const targets = [
        path.join(dir, "learning", "2. Spiking Neurons", "2.1 The Leaky Integrate-and-Fire Neuron.md"),
        path.join(dir, "learning", "2. Spiking Neurons", "2.2 Encoding Information as Spike Trains.md"),
        path.join(dir, "learning", "3. How SNNs Learn", "3.4 Spike-Timing Dependent Plasticity.md"),
      ];
      for (const target of targets) {
        fs.writeFileSync(target, fs.readFileSync(target, "utf-8").replace("Imagine a sensor watching a mostly still scene. ", motif));
      }
      const result = checkById(runChecksWithReport(dir, "snn-fixture"), 29);
      assert.equal(result.status, "FAIL");
      assert.match(result.problems.join("\n"), /repeated battery\/quiet-hallway\/dense-ANN intro motif/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("result interpretation sections fail metrics-only titles", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-result-title-"));
    try {
      const dir = buildGoodGarden(root);
      fs.writeFileSync(
        path.join(dir, "learning", "4. Evaluating SNNs", "_index.md"),
        fm({ title: "4. The Metrics That Make SNNs Measurable", knowledge_type: "learning-section", breadboardType: "learning_section" }) +
          "# 4. The Metrics That Make SNNs Measurable\n",
      );
      const contractPath = path.join(dir, ".breadboard", "learning-unit-contract.json");
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
      contract.learningUnits.find((unit) => unit.id === "U7").role = "result_interpretation";
      fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));

      const result = checkById(runChecksWithReport(dir, "snn-fixture"), 37);
      assert.equal(result.status, "FAIL");
      assert.match(result.problems.join("\n"), /title vocabulary points to metric but units are comparison|SECTION_SEMANTIC_MISMATCH/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("worked examples cannot satisfy source formula definitions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-worked-example-formula-"));
    try {
      const dir = buildGoodGarden(root);
      const ledgerPath = path.join(dir, ".breadboard", "source-visuals.json");
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
      ledger.push({
        sourceVisualId: "S1.P6.E2",
        sourceId: "snn",
        pageNumber: 6,
        type: "equation",
        caption: "Latency as decision time minus stimulus time",
        exactText: "L=t_{decision}-t_0",
        usageStatus: "assigned",
      });
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
      const pagePath = path.join(dir, "learning", "4. Evaluating SNNs", "4.1 Accuracy, Latency, and Energy.md");
      fs.writeFileSync(
        pagePath,
        fs.readFileSync(pagePath, "utf-8").replace(
          /^generatedBy:/m,
          'sourceFormulaAnchors: ["S1.P6.E2"]\nformulas:\n  - kind: "source_definition"\n    text: "108 - 100 = 8"\n    groundingStatus: "source-anchored"\n    sourceAnchor: "S1.P6.E2"\n    justification: "badly treating an arithmetic example as the source formula"\ngeneratedBy:',
        ),
      );
      const results = runChecksWithReport(dir, "snn-fixture");
      assert.equal(checkById(results, 25).status, "FAIL");
      assert.match(checkById(results, 25).problems.join("\n"), /worked-example arithmetic|worked example/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("contract tag validation rejects broad fallback tags", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-tags-contract-"));
    try {
      const dir = buildGoodGarden(root);
      const pagePath = path.join(dir, "learning", "4. Evaluating SNNs", "4.1 Accuracy, Latency, and Energy.md");
      const badTags = [
        "spiking-neural-network",
        "spiking-neural-networks",
        "energy-efficiency",
        "spike-count",
        "continuous-activation",
        "dense-computation",
        "spike-timing",
      ];
      fs.writeFileSync(
        pagePath,
        fs.readFileSync(pagePath, "utf-8").replace(/^tags:\s*\[[^\]]*\]$/m, `tags: [${badTags.map((tag) => JSON.stringify(tag)).join(", ")}]`),
      );
      const result = checkById(runChecksWithReport(dir, "snn-fixture"), 8);
      assert.equal(result.status, "FAIL");
      assert.match(result.problems.join("\n"), /not present in the Learning Unit Contract|must equal Learning Unit Contract handles/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("contract visual fulfillment rejects a missing planned visual", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-missing-visual-"));
    try {
      const dir = buildGoodGarden(root);
      const pagePath = path.join(dir, "learning", "4. Evaluating SNNs", "4.1 Accuracy, Latency, and Energy.md");
      fs.writeFileSync(
        pagePath,
        fs.readFileSync(pagePath, "utf-8").replace(/```breadboard-visual[\s\S]*?```\n\n?/g, ""),
      );
      const result = checkById(runChecksWithReport(dir, "snn-fixture"), 23);
      assert.equal(result.status, "FAIL");
      assert.match(result.problems.join("\n"), /planned tradeoff_explorer, but no interactive visual was embedded/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("section title, formula-noise, and crop-quality checks fail targeted defects", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-targeted-validation-"));
    try {
      const dir = buildGoodGarden(root);
      fs.writeFileSync(
        path.join(dir, "learning", "2. Spiking Neurons", "_index.md"),
        fm({
          title: "Why This Topic Exists and the Mechanism Works",
          knowledge_type: "learning-section",
          breadboardType: "learning_section",
          generated_by: "learn_button",
          generatedBy: "learn_button",
        }) + "# Bad\n",
      );
      const pagePath = path.join(dir, "learning", "4. Evaluating SNNs", "4.1 Accuracy, Latency, and Energy.md");
      fs.writeFileSync(
        pagePath,
        fs
          .readFileSync(pagePath, "utf-8")
          .replace(/^tags:\s*\[[^\]]*\]$/m, 'tags: ["accuracy-alone-hides-energy-and-latency-cost"]')
          .replace(/^generatedBy:/m, 'formulas:\n  - text: "Define accuracy as the fraction of predictions that are correct.: correct predictions + total predictions + classification accuracy"\n    groundingStatus: "source-anchored"\n    sourceAnchor: "S1.P6.E1"\n    justification: "bad prose entry"\ngeneratedBy:'),
      );
      fs.writeFileSync(path.join(dir, "assets", "source-visuals", "snn-lif.png"), "PNG");
      const results = runChecksWithReport(dir, "snn-fixture");
      assert.equal(checkById(results, 25).status, "FAIL");
      assert.equal(checkById(results, 34).status, "FAIL");
      assert.equal(checkById(results, 35).status, "FAIL");
      assert.equal(checkById(results, 38).status, "FAIL");
      assert.equal(checkById(results, 40).status, "FAIL");
      assert.equal(checkById(results, 45).status, "FAIL");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("semantic contradictions in titles, formulas, visuals, and source anchors fail explicitly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-semantic-tightening-"));
    try {
      const dir = buildGoodGarden(root);
      const ledgerPath = path.join(dir, ".breadboard", "source-visuals.json");
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
      ledger.push(
        {
          sourceVisualId: "S1.P6.E1",
          sourceId: "snn",
          pageNumber: 6,
          type: "equation",
          caption: "Accuracy as correct predictions over total predictions",
          exactText: "\\text{Accuracy}=N_{correct}/N_{total}",
          usageStatus: "assigned",
        },
        {
          sourceVisualId: "S1.P6.E2",
          sourceId: "snn",
          pageNumber: 6,
          type: "equation",
          caption: "Latency as decision time",
          exactText: "L=t_{decision}-t_{start}",
          usageStatus: "assigned",
        },
        {
          sourceVisualId: "S1.P6.E3",
          sourceId: "snn",
          pageNumber: 6,
          type: "equation",
          caption: "Spike count summed across neurons and time",
          exactText: "N_{spikes}=\\sum_{i,t}s_i(t)",
          usageStatus: "assigned",
        },
        {
          sourceVisualId: "S1.P6.E4",
          sourceId: "snn",
          pageNumber: 6,
          type: "equation",
          caption: "Total energy combines spike and synaptic operation costs",
          exactText: "E=N_{spikes}E_{spike}+N_{ops}E_{op}",
          usageStatus: "assigned",
        },
        {
          sourceVisualId: "S1.P6.E5",
          sourceId: "snn",
          pageNumber: 6,
          type: "equation",
          caption: "Normalized energy efficiency divides accuracy by energy",
          exactText: "\\eta=A/E",
          usageStatus: "assigned",
        },
        {
          sourceVisualId: "S1.P10.E6",
          sourceId: "snn",
          pageNumber: 10,
          type: "equation",
          caption: "Convergence time as the first epoch reaching target accuracy",
          exactText: "T_{conv}=\\min\\{e:A(e)\\ge A_{target}\\}",
          usageStatus: "assigned",
        },
      );
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

      fs.writeFileSync(
        path.join(dir, "sources", "snn.md"),
        fm({
          title: "Spiking Neural Networks Review",
          knowledge_type: "source-document",
          breadboardType: "source_document",
          internal: "true",
          source_images: ["/snn-fixture/assets/snn-page-004.png"],
        }) +
          "# Page 1\n\nIntroductory abstract text.\n\n" +
          "# Page 6\n\nAccuracy, latency, spike count, total energy, and normalized energy efficiency are defined with exact formulas in the source text.\n\n" +
          "# Page 8\n\nSpike-timing dependent plasticity changes synaptic weight based on pre-before-post and post-before-pre spike timing.\n",
      );
      fs.writeFileSync(
        path.join(dir, ".breadboard", "planning", "Source Map.md"),
        [
          "# Source Map",
          "",
          "Only pages 1-2 are available in full-text form.",
          "Later-page teaching must remain anchored to extracted figure, table, graph, and formula captions.",
          "Only formula captions are provided; exact mathematical notation and variable definitions are not visible.",
          "",
        ].join("\n"),
      );
      fs.writeFileSync(
        path.join(dir, "learning", "2. Spiking Neurons", "_index.md"),
        fm({
          title: "2. Accuracy Formula, Correct Prediction Count, Total Prediction Count Formula Mechanics",
          knowledge_type: "learning-section",
          breadboardType: "learning_section",
        }) + "# 2. Accuracy Formula, Correct Prediction Count, Total Prediction Count Formula Mechanics\n",
      );

      const pagePath = path.join(dir, "learning", "4. Evaluating SNNs", "4.1 Accuracy, Latency, and Energy.md");
      let page = fs.readFileSync(pagePath, "utf-8").replace(
        /^generatedBy:/m,
        [
          'sourceFormulaAnchors: ["S1.P6.E1", "S1.P6.E5", "S1.P10.E6"]',
          "formulas:",
          '  - text: "\\\\text{spike occurs when } V(t) \\\\geq \\\\theta"',
          '    groundingStatus: "source-anchored"',
          '    sourceAnchor: "S1.P6.E5"',
          '    justification: "wrong threshold-to-efficiency anchor"',
          '  - text: "\\\\text{Accuracy}=\\\\frac{N_{correct}}{N_{total}}"',
          '    groundingStatus: "source-anchored"',
          '    sourceAnchor: "S1.P10.E6"',
          '    justification: "wrong accuracy-to-convergence anchor"',
          '  - text: "\\\\theta"',
          '    groundingStatus: "source-anchored"',
          '    sourceAnchor: "S1.P6.E5"',
          '    justification: "bad single-symbol anchor"',
          '  - text: "s_i(t)=1"',
          '    groundingStatus: "conceptual-helper"',
          '  - text: "s_i(t)=0"',
          '    groundingStatus: "conceptual-helper"',
          '  - text: "t=1"',
          '    groundingStatus: "conceptual-helper"',
          '  - text: "t=2"',
          '    groundingStatus: "conceptual-helper"',
          '  - text: "\\\\sum_{i=1}^{N}"',
          '    groundingStatus: "conceptual-helper"',
          '  - text: "\\\\min"',
          '    groundingStatus: "conceptual-helper"',
          "generatedBy:",
        ].join("\n"),
      );
      page = page.replace(/```breadboard-visual\n([\s\S]*?)\n```/, (_, json) => {
        const spec = JSON.parse(json);
        spec.type = "metric_calculator";
        spec.title = "Accuracy calculator";
        spec.learningGoal = "Let learners change correct and total predictions to see accuracy.";
        spec.pedagogicalPurpose = "Let the learner compute accuracy from correct and total prediction counts.";
        spec.caption = "Accuracy from correct and total predictions.";
        spec.conceptTargets = ["accuracy"];
        spec.controls = [];
        spec.inputs = ["correct predictions", "total predictions"];
        spec.outputs = ["accuracy"];
        spec.sourceAnchors = [
          { equationId: "S1.P6.E1", sourceTitle: "Accuracy as correct predictions over total predictions" },
          { equationId: "S1.P6.E2", sourceTitle: "Latency as decision time" },
          { equationId: "S1.P6.E3", sourceTitle: "Spike count summed across neurons and time" },
          { equationId: "S1.P6.E4", sourceTitle: "Total energy combines spike and synaptic operation costs" },
          { equationId: "S1.P6.E5", sourceTitle: "Normalized energy efficiency divides accuracy by energy" },
          { equationId: "S1.P10.E6", sourceTitle: "Convergence time as the first epoch reaching target accuracy" },
        ];
        return "```breadboard-visual\n" + JSON.stringify(spec, null, 2) + "\n```";
      });
      fs.writeFileSync(pagePath, page);

      const stdpPath = path.join(dir, "learning", "3. How SNNs Learn", "3.4 Spike-Timing Dependent Plasticity.md");
      fs.writeFileSync(
        stdpPath,
        fs.readFileSync(stdpPath, "utf-8").replace(/^generatedBy:/m, 'sourceAnchors: ["abstract-guidance"]\ngeneratedBy:'),
      );
      const contractPath = path.join(dir, ".breadboard", "learning-unit-contract.json");
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
      contract.learningUnits.find((unit) => unit.id === "U3").zettelNotes[0].handle = "spike-train-names-the-durable-idea-learners-reuse";
      fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));

      const results = runChecksWithReport(dir, "snn-fixture");
      assert.equal(checkById(results, 42).status, "FAIL");
      assert.equal(checkById(results, 50).status, "FAIL");
      assert.equal(checkById(results, 51).status, "FAIL");
      assert.equal(checkById(results, 52).status, "FAIL");
      assert.equal(checkById(results, 53).status, "FAIL");
      assert.equal(checkById(results, 54).status, "FAIL");
      assert.equal(checkById(results, 55).status, "FAIL");
      assert.equal(checkById(results, 56).status, "FAIL");
      assert.equal(checkById(results, 57).status, "FAIL");
      assert.match(checkById(results, 53).problems.join("\n"), /threshold|Accuracy|sourceFamily/);
      assert.match(checkById(results, 55).problems.join("\n"), /unrelated formula anchor families/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("formula anchors with omitted crops pass when concept usage is split from crop status", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-split-"));
    try {
      const dir = buildGoodGarden(root);
      const ledgerPath = path.join(dir, ".breadboard", "source-visuals.json");
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
      ledger.push({
        sourceVisualId: "S1.P6.E3",
        sourceId: "snn",
        pageNumber: 6,
        type: "equation",
        caption: "Total spike count summed over neurons and time steps",
        usageStatus: "assigned",
        conceptUsage: "explained_as_text_formula",
        cropStatus: "omitted_unreliable",
        skipReason: "Central source formula is taught from source markdown and linked through sourceFormulaAnchors.",
      });
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
      fs.writeFileSync(
        path.join(dir, ".breadboard", "planning", "Source Coverage.md"),
        [
          "# Source Coverage",
          "",
          "## Embedded Source Crops",
          "",
          "- S1.P4.F1: [[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|2.1 The Leaky Integrate-and-Fire Neuron]]",
          "",
          "## Explained as Text Formulas",
          "",
          "- S1.P6.E3: [[learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy|4.1 Accuracy, Latency, and Energy]]",
          "",
          "## Explained in Prose",
          "",
          "- None.",
          "",
          "## Used as Interactive Grounding",
          "",
          "- S1.P4.F1: [[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|2.1 The Leaky Integrate-and-Fire Neuron]]",
          "",
          "## Referenced Again in Synthesis",
          "",
          "- None.",
          "",
          "## Crop Omitted With Text Fallback",
          "",
          "- S1.P6.E3: [[learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy|4.1 Accuracy, Latency, and Energy]]",
          "",
          "## Intentionally Omitted",
          "",
          "- None.",
          "",
          "## Missing or Misplaced",
          "",
          "- None.",
          "",
        ].join("\n"),
      );

      const pagePath = path.join(dir, "learning", "4. Evaluating SNNs", "4.1 Accuracy, Latency, and Energy.md");
      fs.writeFileSync(
        pagePath,
        fs.readFileSync(pagePath, "utf-8").replace(
          /^generatedBy:/m,
          'sourceFormulaAnchors: ["S1.P6.E3"]\nformulas:\n  - text: "N_{\\\\text{spike count}} = \\\\sum_{n,t} s_n(t)"\n    groundingStatus: "source-derived"\n    sourceAnchor: "S1.P6.E3"\n    justification: "source-derived metric expression"\ngeneratedBy:',
        ),
      );

      const result = checkById(runChecksWithReport(dir, "snn-fixture"), 43);
      assert.equal(result.status, "PASS", result.problems.join("\n"));
      const coverage = checkById(runChecksWithReport(dir, "snn-fixture"), 49);
      assert.equal(coverage.status, "PASS", coverage.problems.join("\n"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("duplicate section titles, wrong numbered links, and map self-edges fail semantic navigation checks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-section-semantics-"));
    try {
      const dir = buildGoodGarden(root);
      fs.writeFileSync(
        path.join(dir, "learning", "3. How SNNs Learn", "_index.md"),
        fm({ title: "3. Evaluating SNNs", knowledge_type: "learning-section", breadboardType: "learning_section" }) + "# 3. Evaluating SNNs\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "_index.md"),
        fs.readFileSync(path.join(dir, "learning", "_index.md"), "utf-8").replace(
          "[[learning/2. Spiking Neurons/_index|2. Spiking Neurons]]",
          "[[learning/3. How SNNs Learn/_index|2. Spiking Neurons]]",
        ),
      );
      fs.writeFileSync(
        path.join(dir, "learning", "Learning Map.md"),
        fm({ title: "Learning Map", knowledge_type: "learning-map", breadboardType: "learning_map" }) +
          "# Learning Map\n\n- Spiking Neurons -> 2. Spiking Neurons\n",
      );
      const results = runChecksWithReport(dir, "snn-fixture");
      assert.equal(checkById(results, 46).status, "FAIL");
      assert.equal(checkById(results, 47).status, "FAIL");
      assert.equal(checkById(results, 48).status, "FAIL");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("stale formula caveats and formula meaning mismatches fail", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-semantics-"));
    try {
      const dir = buildGoodGarden(root);
      const ledgerPath = path.join(dir, ".breadboard", "source-visuals.json");
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
      ledger.push(
        {
          sourceVisualId: "S1.P6.E1",
          sourceId: "snn",
          pageNumber: 6,
          type: "equation",
          caption: "Accuracy as correct predictions over total predictions",
          exactText: "\\text{Accuracy}=N_{correct}/N_{total}",
          usageStatus: "assigned",
        },
        {
          sourceVisualId: "S1.P10.E6",
          sourceId: "snn",
          pageNumber: 10,
          type: "equation",
          caption: "Convergence time as the first epoch reaching target accuracy",
          exactText: "T_{conv}=min{e:A(e)>=A_target}",
          usageStatus: "assigned",
        },
      );
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
      fs.writeFileSync(
        path.join(dir, ".breadboard", "planning", "Source Map.md"),
        "# Source Map\n\nFormula captions but not exact displayed notation are available.\n",
      );
      const pagePath = path.join(dir, "learning", "4. Evaluating SNNs", "4.1 Accuracy, Latency, and Energy.md");
      fs.writeFileSync(
        pagePath,
        fs.readFileSync(pagePath, "utf-8").replace(
          /^generatedBy:/m,
          'sourceFormulaAnchors: ["S1.P6.E1", "S1.P10.E6"]\nformulas:\n  - text: "\\\\text{Accuracy} = \\\\frac{N_{\\\\text{correct}}}{N_{\\\\text{total}}}"\n    groundingStatus: "source-anchored"\n    sourceAnchor: "S1.P10.E6"\n    justification: "wrong anchor on purpose"\ngeneratedBy:',
        ),
      );
      const results = runChecksWithReport(dir, "snn-fixture");
      assert.equal(checkById(results, 42).status, "FAIL");
      assert.equal(checkById(results, 41).status, "FAIL");
      assert.match(checkById(results, 41).problems.join("\n"), /accuracy|convergence|does not match/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("source-derived formulas marked conceptual-helper and contradictory usage ledgers fail", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-status-semantics-"));
    try {
      const dir = buildGoodGarden(root);
      const ledgerPath = path.join(dir, ".breadboard", "source-visuals.json");
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
      ledger.push({
        sourceVisualId: "S1.P6.E1",
        sourceId: "snn",
        pageNumber: 6,
        type: "equation",
        caption: "Accuracy as correct predictions over total predictions",
        usageStatus: "intentionally_skipped",
        conceptUsage: "explained_as_text_formula",
        cropStatus: "omitted_unreliable",
      });
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
      const pagePath = path.join(dir, "learning", "4. Evaluating SNNs", "4.1 Accuracy, Latency, and Energy.md");
      fs.writeFileSync(
        pagePath,
        fs.readFileSync(pagePath, "utf-8").replace(
          /^generatedBy:/m,
          'formulas:\n  - text: "\\\\text{Accuracy} = \\\\frac{N_{\\\\text{correct}}}{N_{\\\\text{total}}}"\n    groundingStatus: "conceptual-helper"\n    justification: "incorrectly marked helper"\ngeneratedBy:',
        ),
      );
      const results = runChecksWithReport(dir, "snn-fixture");
      assert.equal(checkById(results, 41).status, "FAIL");
      assert.equal(checkById(results, 43).status, "FAIL");
      assert.match(checkById(results, 43).problems.join("\n"), /contradicts conceptUsage/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("Source Coverage rejects embedded overclaims for omitted formula crops", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-coverage-semantics-"));
    try {
      const dir = buildGoodGarden(root);
      const ledgerPath = path.join(dir, ".breadboard", "source-visuals.json");
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
      ledger.push({
        sourceVisualId: "S1.P6.E3",
        sourceId: "snn",
        pageNumber: 6,
        type: "equation",
        caption: "Total spike count summed over neurons and time steps",
        usageStatus: "assigned",
        conceptUsage: "explained_as_text_formula",
        cropStatus: "omitted_unreliable",
      });
      fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
      fs.writeFileSync(
        path.join(dir, ".breadboard", "planning", "Source Coverage.md"),
        "# Source Coverage\n\n## Embedded Source Crops\n\n- S1.P6.E3: formula display used\n\n## Figures, Graphs, Tables, And Formula Displays Used\n\n- S1.P6.E3\n",
      );
      const result = checkById(runChecksWithReport(dir, "snn-fixture"), 49);
      assert.equal(result.status, "FAIL");
      assert.match(result.problems.join("\n"), /Embedded Source Crops|legacy heading|Explained as Text Formulas/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("concept visuals need source text anchors when matching source prose exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-text-anchor-"));
    try {
      const dir = buildGoodGarden(root);
      fs.writeFileSync(
        path.join(dir, "sources", "snn.md"),
        fm({
          title: "Spiking Neural Networks Review",
          knowledge_type: "source-document",
          breadboardType: "source_document",
          internal: "true",
          source_images: ["/snn-fixture/assets/snn-page-004.png"],
        }) +
          "Spike-timing dependent plasticity, or STDP, changes synaptic weight based on pre-before-post and post-before-pre spike timing.\n",
      );
      let results = runChecksWithReport(dir, "snn-fixture");
      assert.equal(checkById(results, 50).status, "FAIL");

      const pagePath = path.join(dir, "learning", "3. How SNNs Learn", "3.4 Spike-Timing Dependent Plasticity.md");
      const content = fs.readFileSync(pagePath, "utf-8");
      const next = content.replace(/```breadboard-visual\n([\s\S]*?)\n```/, (_, json) => {
        const spec = JSON.parse(json);
        spec.sourceGroundingStatus = "source-derived-conceptual";
        spec.sourceAnchors = [
          {
            sourceId: "snn",
            textAnchorId: "text-snn-spike-timing-dependent-plasticity",
            description: "Source prose explains STDP timing-dependent weight changes.",
          },
        ];
        spec.justification = "The source explains STDP in prose but does not provide a dedicated figure.";
        return "```breadboard-visual\n" + JSON.stringify(spec, null, 2) + "\n```";
      });
      fs.writeFileSync(pagePath, next);
      results = runChecksWithReport(dir, "snn-fixture");
      assert.equal(checkById(results, 50).status, "PASS", checkById(results, 50).problems.join("\n"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("scaffold-like Zettelkasten handles fail handle quality", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-zettel-quality-"));
    try {
      const dir = buildGoodGarden(root);
      const contractPath = path.join(dir, ".breadboard", "learning-unit-contract.json");
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
      contract.learningUnits.find((unit) => unit.id === "U3").zettelNotes[0].handle = "turns-a-broad-problem";
      fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2));
      const result = checkById(runChecksWithReport(dir, "snn-fixture"), 51);
      assert.equal(result.status, "FAIL");
      assert.match(result.problems.join("\n"), /planner scaffolding|scaffold-like/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("the current failing output (empty ledger, short fallback pages, leaks) fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-bad-"));
    try {
      const dir = buildGoodGarden(root);
      // Break it the way the failing zip was broken:
      // 1. empty source-visuals ledger
      fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]");
      // 2. a stray published page at the garden root (outside learning/)
      fs.writeFileSync(
        path.join(dir, "Stray Page.md"),
        fm({ title: "Stray Page", knowledge_type: "knowledge-topic" }) + "x\n",
      );
      // 3. a short fallback-template learner page that leaks "textbook"
      fs.writeFileSync(
        path.join(dir, "learning", "2. Spiking Neurons", "2.3 Broken.md"),
        fm({
          title: "2.3 What The Paper Covers",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
          generated_by: "learn_button",
          tags: ["snn/stdp", "paper/overview"],
          learningVersion: "textbook_leak",
        }) +
          "# 2.3 What The Paper Covers\n\nThe durable concept is X. Relevant details:\n- one\n\nAccording to the source, this is short.\n",
      );

      const results = runChecksWithReport(dir, "snn-fixture");
      const failed = new Set(results.filter((r) => r.status === "FAIL").map((r) => r.id));
      // textbook leak, source-commentary title, fallback prose, short page,
      // visible snapshot folder, bad tags, empty visual-rich ledger.
      for (const id of [1, 2, 3, 5, 7, 8, 10]) {
        assert.ok(failed.has(id), `check ${id} should fail on the broken garden`);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a ZIP-shaped artifact with uppercase/internal/root-source folders fails strict export checks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-zip-bad-"));
    try {
      const dir = buildBadZipShapedGarden(root);
      const results = runChecksWithReport(dir, "test-2");
      const byId = new Map(results.map((result) => [result.id, result]));
      assert.equal(byId.get(7).status, "FAIL", "strict top-level export tree must fail");
      assert.match(byId.get(7).problems.join("\n"), /uppercase Learning|Internal|numbered source-conversion|sources\/_index/);
      assert.equal(byId.get(20).status, "FAIL", "root index must fail when it says there are no lessons");
      assert.match(byId.get(20).problems.join("\n"), /No lessons yet|learning\/Topic Overview|sources\/_index/);
      assert.equal(byId.get(17).status, "FAIL", "visible source links must be validated too");
      assert.match(byId.get(17).problems.join("\n"), /2510-27379v1|Page 1/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a Topic Overview whose links resolve passes the link check", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-links-ok-"));
    try {
      const dir = buildGoodGarden(root);
      // Canonical links to real fixture files.
      fs.writeFileSync(
        path.join(dir, "learning", "Topic Overview.md"),
        fm({ title: "Topic Overview", knowledge_type: "topic-overview" }) +
          "# Overview\n\n" +
          "- [[learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron|LIF neuron]]\n" +
          "- [[learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy|Tradeoffs]]\n",
      );
      const results = runChecksWithReport(dir, "snn-fixture");
      const link = results.find((r) => r.id === 17);
      assert.equal(link.status, "PASS", `link check should pass: ${link.problems.join(" | ")}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a stale visual-index entry (a second run's leftover) fails the index check until pruned", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-stale-"));
    try {
      const dir = buildGoodGarden(root);
      const indexPath = path.join(dir, ".breadboard", "visual-index.json");
      const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

      // Simulate a previous run leaving an orphan index entry no page embeds.
      const stale = { ...index };
      stale["vis-9-9-removed-from-a-previous-run-lif"] = {
        id: "vis-9-9-removed-from-a-previous-run-lif",
        type: "lif_neuron",
        title: "Old",
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      fs.writeFileSync(indexPath, JSON.stringify(stale, null, 2));

      let results = runChecksWithReport(dir, "snn-fixture");
      let check18 = results.find((r) => r.id === 18);
      assert.equal(check18.status, "FAIL", "stale index entry must fail check 18");
      assert.match(check18.problems.join("\n"), /stale/);

      // Pruning back to only the embedded ids restores a clean index.
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
      results = runChecksWithReport(dir, "snn-fixture");
      check18 = results.find((r) => r.id === 18);
      assert.equal(check18.status, "PASS", "pruned index must pass check 18");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a Topic Overview with loose title/heading links fails the link check with suggestions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-links-bad-"));
    try {
      const dir = buildGoodGarden(root);
      // The exact failure pattern from the shipped garden: bare title links and
      // Section#Subsection heading links that never resolve.
      fs.writeFileSync(
        path.join(dir, "learning", "Topic Overview.md"),
        fm({ title: "Topic Overview", knowledge_type: "topic-overview" }) +
          "# Overview\n\n" +
          "- [[The Leaky Integrate-and-Fire Neuron]]\n" +
          "- [[Spiking Neurons#Encoding Information as Spike Trains]]\n" +
          "- [[Totally Made Up Concept]]\n",
      );
      const results = runChecksWithReport(dir, "snn-fixture");
      const link = results.find((r) => r.id === 17);
      assert.equal(link.status, "FAIL", "loose/broken links must fail check 17");
      const joined = link.problems.join("\n");
      assert.match(joined, /Totally Made Up Concept/);
      // The resolver should suggest the real file for a link it can localize.
      assert.match(joined, /did you mean \[\[/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runChecks, writeValidationReport } from "../../scripts/validate-breadboard-garden.ts";
import {
  buildLifThresholdResetVisual,
  buildRateVsTemporalCodingVisual,
  buildStdpTimingWindowVisual,
  buildMetricTradeoffExplorerVisual,
} from "../src/lib/visual-spec.ts";
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
    spec.sourceGroundingStatus = "source-anchored";
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
  fs.writeFileSync(path.join(gardenDir, "assets", "source-visuals", "snn-lif.png"), "PNG");
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
      zettelNotes: [{ handle: "lif-threshold-turns-accumulated-input-into-spikes", claim: "A LIF threshold turns accumulated input into spikes." }],
    },
    {
      id: "U4",
      role: "mechanism",
      title: "Encoding information as spike trains",
      learningQuestion: "How do rate and temporal coding differ?",
      newConcepts: ["rate coding", "temporal coding"],
      interactiveVisual: { id: "v_coding", visualType: "neural_coding", uniqueConcept: "rate coding versus temporal coding", whyStaticSourceFigureIsNotEnough: "The learner changes spike timing and sees the code change.", learnerManipulates: ["spike rate", "timing jitter"], expectedInsight: "rate and timing carry different information", sourceAnchors: [] },
      zettelNotes: [{ handle: "spike-train-timing-changes-the-message", claim: "Spike train timing changes the message." }],
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
      zettelNotes: [{ handle: "stdp-updates-weights-from-local-spike-timing", claim: "STDP updates weights from local spike timing." }],
    },
    {
      id: "U7",
      role: "metric",
      title: "Accuracy latency and energy tradeoffs",
      learningQuestion: "Why is accuracy alone not enough?",
      newConcepts: ["latency", "energy", "spike count"],
      interactiveVisual: { id: "v_tradeoff", visualType: "tradeoff_explorer", uniqueConcept: "accuracy energy latency tradeoff", whyStaticSourceFigureIsNotEnough: "The learner changes priorities and sees which metric dominates.", learnerManipulates: ["priority"], expectedInsight: "the best model depends on metric priorities", sourceAnchors: [] },
      zettelNotes: [{ handle: "accuracy-alone-hides-energy-and-latency-cost", claim: "Accuracy alone hides energy and latency cost." }],
    },
    {
      id: "U8",
      role: "synthesis",
      title: "Putting spikes mechanisms and metrics together",
      learningQuestion: "How do spike timing, mechanisms, and metrics connect?",
      zettelNotes: [{ handle: "event-driven-design-connects-timing-energy-and-accuracy", claim: "Event-driven design connects timing, energy, and accuracy." }],
    },
  ]);
  fs.writeFileSync(
    path.join(bb, "learning-unit-contract.json"),
    JSON.stringify(
      {
        sourceSetHash: "fixture",
        generatedAt: "2026-01-01T00:00:00.000Z",
        learningUnits,
        sourceArtifactAssignments: assignSourceArtifacts(learningUnits),
      },
      null,
      2,
    ),
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
        "lif-neuron-threshold-reset",
        "membrane-potential-threshold",
        "threshold-firing-event",
        "reset-follows-spike",
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
        "spike-rate-coding",
        "spike-timing-information",
        "spike-train-encoding",
        "temporal-code-timing",
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
        "stdp-local-timing-rule",
        "synaptic-plasticity-window",
        "spike-timing-window",
        "temporal-credit-assignment",
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
        "latency-to-decision",
        "accuracy-per-energy",
        "total-spike-count",
        "model-family-comparison",
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

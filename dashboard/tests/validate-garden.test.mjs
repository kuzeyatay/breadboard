import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runChecks } from "../../scripts/validate-breadboard-garden.ts";
import {
  buildLifThresholdResetVisual,
  buildRateVsTemporalCodingVisual,
  buildStdpTimingWindowVisual,
  buildMetricTradeoffExplorerVisual,
} from "../src/lib/visual-spec.ts";

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

function goodLesson({ title, tags, body, visualBlock, visualIds, imageUrl, sourceVisualIds }) {
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

function buildGoodGarden(root) {
  const gardenDir = path.join(root, "snn-fixture");
  const bb = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(path.join(bb, "visuals"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "assets", "source-visuals"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "sources"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "Learning", "2. Spiking Neurons"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "Learning", "3. How SNNs Learn"), { recursive: true });
  fs.mkdirSync(path.join(gardenDir, "Learning", "4. Evaluating SNNs"), { recursive: true });

  fs.writeFileSync(path.join(gardenDir, "_index.md"), fm({ title: "Spiking Neural Networks", knowledge_type: "cluster-index" }) + "# SNN\n");

  // Internal source note (must not be published).
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
      assignedPageId: "Learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron",
    },
  ];
  fs.writeFileSync(path.join(bb, "source-visuals.json"), JSON.stringify(ledger, null, 2));

  // Four interactive visuals across pages.
  const specs = {
    lif: buildLifThresholdResetVisual("Learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron"),
    coding: buildRateVsTemporalCodingVisual("Learning/2. Spiking Neurons/2.2 Encoding Information as Spike Trains"),
    stdp: buildStdpTimingWindowVisual("Learning/3. How SNNs Learn/3.4 Spike-Timing Dependent Plasticity"),
    tradeoff: buildMetricTradeoffExplorerVisual("Learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy"),
  };
  const index = {};
  for (const spec of Object.values(specs)) {
    fs.writeFileSync(path.join(bb, "visuals", `${spec.id}.json`), JSON.stringify(spec, null, 2));
    index[spec.id] = { id: spec.id, type: spec.type, title: spec.title, version: spec.version, updatedAt: spec.createdAt };
  }
  fs.writeFileSync(path.join(bb, "visual-index.json"), JSON.stringify(index, null, 2));

  const pages = [
    {
      rel: "Learning/2. Spiking Neurons/2.1 The Leaky Integrate-and-Fire Neuron.md",
      title: "2.1 The Leaky Integrate-and-Fire Neuron",
      tags: ["snn/lif-neuron", "computational-neuroscience/membrane-potential", "snn/threshold-firing"],
      body: LONG_PARAGRAPH("The leaky integrate-and-fire neuron and its membrane potential threshold"),
      spec: specs.lif,
      imageUrl,
      sourceVisualIds: ["S1.P4.F1"],
    },
    {
      rel: "Learning/2. Spiking Neurons/2.2 Encoding Information as Spike Trains.md",
      title: "2.2 Encoding Information as Spike Trains",
      tags: ["snn/rate-coding", "snn/temporal-coding", "computational-neuroscience/spike-timing"],
      body: LONG_PARAGRAPH("Rate coding and temporal coding of spike trains and spike timing"),
      spec: specs.coding,
    },
    {
      rel: "Learning/3. How SNNs Learn/3.4 Spike-Timing Dependent Plasticity.md",
      title: "3.4 Spike-Timing Dependent Plasticity",
      tags: ["snn/stdp", "learning-rules/synaptic-plasticity", "computational-neuroscience/spike-timing"],
      body: LONG_PARAGRAPH("Spike-timing dependent plasticity (STDP) and synaptic plasticity across the timing window"),
      spec: specs.stdp,
    },
    {
      rel: "Learning/4. Evaluating SNNs/4.1 Accuracy, Latency, and Energy.md",
      title: "4.1 Accuracy, Latency, and Energy",
      tags: ["model-evaluation/latency", "edge-ai/energy-efficiency", "model-evaluation/spike-count"],
      body:
        LONG_PARAGRAPH("Accuracy, latency, energy and spike count as a tradeoff") +
        " latency latency spike count spike count energy energy trade-off across model families.",
      spec: specs.tradeoff,
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
      }),
    );
  }

  return gardenDir;
}

// ---------------------------------------------------------------------------

describe("garden validator regression fixture", () => {
  test("a correctly generated SNN garden passes every hard check", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-good-"));
    try {
      const dir = buildGoodGarden(root);
      const results = runChecks(dir, "snn-fixture");
      const fails = results.filter((r) => r.status === "FAIL");
      assert.deepEqual(
        fails.map((f) => `${f.id}. ${f.name}: ${f.problems.join(" | ")}`),
        [],
        "no check should fail on the good garden",
      );
      // Sanity: the SNN-specific and visual checks actually ran (not all skipped).
      const snn = results.find((r) => r.id === 16);
      assert.equal(snn.status, "PASS", "SNN garden 4-visual check must run and pass");
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
      // 2. a stray published page at the garden root (outside Learning/)
      fs.writeFileSync(
        path.join(dir, "Stray Page.md"),
        fm({ title: "Stray Page", knowledge_type: "knowledge-topic" }) + "x\n",
      );
      // 3. a short fallback-template learner page that leaks "textbook"
      fs.writeFileSync(
        path.join(dir, "Learning", "2. Spiking Neurons", "2.3 Broken.md"),
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

      const results = runChecks(dir, "snn-fixture");
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
});

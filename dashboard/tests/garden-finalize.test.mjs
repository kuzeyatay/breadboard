import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  finalizeGardenExport,
  repairLearningUnitsFromContract,
  verifyFinalArtifactNoMutation,
  classifyFigure,
  pageRole,
  normalizeSourceWikilinks,
  sanitizeStaleCaveats,
  groundLearnerFormula,
} from "../src/lib/garden-finalize.ts";
import { runChecks, writeValidationReport } from "../../scripts/validate-breadboard-garden.ts";

// ---------------------------------------------------------------------------
// Exact source formula captions from the real garden (2510.27379v1).
// ---------------------------------------------------------------------------
const SOURCE_FORMULAS = [
  { id: "S1.P6.E1", caption: "Classification accuracy as correct predictions over total predictions" },
  { id: "S1.P6.E2", caption: "Latency as decision time minus input stimulus time" },
  { id: "S1.P6.E3", caption: "Total spike count summed over neurons and time steps" },
  { id: "S1.P6.E4", caption: "Total energy from spike and synaptic operation costs" },
  { id: "S1.P6.E5", caption: "Normalized energy efficiency as accuracy over energy consumption" },
  { id: "S1.P6.E6", caption: "Convergence time as epoch reaching target accuracy" },
];

// ---------------------------------------------------------------------------
// C. Source wikilink normalization — exact broken examples from the spec.
// ---------------------------------------------------------------------------
describe("source wikilink normalization (C)", () => {
  test("converts self-referential heading wikilinks to plain headings and flattens broken links", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-links-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), "---\ntitle: \"t\"\n---\n\n# t\n");
      fs.writeFileSync(
        path.join(dir, "sources", "_index.md"),
        "---\ntitle: \"Sources\"\nknowledge_type: \"source-index\"\n---\n\n# Sources\n\n- [[sources/2510-27379v1|SNN paper]]\n",
      );
      fs.writeFileSync(
        path.join(dir, "sources", "2510-27379v1.md"),
        [
          "---",
          'title: "Spiking Neural Networks: The Future of Brain-Inspired Computing"',
          'knowledge_type: "source-document"',
          'breadboardType: "source_document"',
          'internal: "true"',
          "---",
          "",
          "## Summary",
          "",
          "[[2510-27379v1|Spiking Neural Networks: The Future of Brain-Inspired Computing]]",
          "",
          "## Textbook coverage",
          "",
          "- [[2510-27379v1-1783174795571|2510.27379v1]] (Page 1)",
          "",
          "## Source material",
          "",
          "# Page 1",
          "",
          "Intro text. [[Page 1]]",
          "",
          "# [[#Page 2|Page 2]]",
          "",
          "Page two body.",
          "",
          "## [[#Page 16|Page 16]]",
          "",
          "Page sixteen body.",
          "",
        ].join("\n"),
      );

      const report = { changed: [], removed: [], notes: [], reconciliation: [], criticalProblems: [] };
      normalizeSourceWikilinks(dir, report);

      const out = fs.readFileSync(path.join(dir, "sources", "2510-27379v1.md"), "utf-8");
      // Headings must be plain, not self-referential wikilinks.
      assert.match(out, /^# Page 2$/m, "# [[#Page 2|Page 2]] must become # Page 2");
      assert.match(out, /^## Page 16$/m, "## [[#Page 16|Page 16]] must become ## Page 16");
      assert.doesNotMatch(out, /^#+\s*\[\[/m, "no heading may still be a wikilink");
      // [[Page 1]] resolves to the existing "# Page 1" heading (or plain text).
      assert.doesNotMatch(out, /\[\[Page 1\]\]/, "[[Page 1]] must be resolved or flattened");
      // Timestamped source-conversion link must be canonicalized or flattened.
      assert.doesNotMatch(out, /\[\[2510-27379v1-1783174795571/, "timestamped link must be removed");

      // The validator's wikilink check must now pass for this source file.
      const results = runChecks(dir, "test-2");
      const link = results.find((r) => r.id === 17);
      assert.doesNotMatch(
        link.problems.join("\n"),
        /2510-27379v1\.md/,
        `source wikilinks should resolve after normalization: ${link.problems.join(" | ")}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// D. Stale caveat sanitation — exact phrases from the spec.
// ---------------------------------------------------------------------------
describe("stale caveat sanitation (D)", () => {
  const facts = { laterPagesExist: true, formulaAnchorsExist: true };

  test('drops "truncated after Page 2" when later pages exist', () => {
    const input = [
      "## Warnings",
      "",
      "- The main prose source is truncated after Page 2, so later-paper details must not be inferred beyond the provided anchors and source-derived tables.",
      "- Keep this unrelated note.",
    ].join("\n");
    const out = sanitizeStaleCaveats(input, facts);
    assert.doesNotMatch(out, /truncated after Page 2/i);
    assert.match(out, /Keep this unrelated note/);
  });

  test('drops "formal mathematical definitions are not present" when formula anchors exist', () => {
    const input =
      "- The performance metrics are named and numerically compared, but formal mathematical definitions are not present in the supplied material and should not be fabricated.";
    const out = sanitizeStaleCaveats(input, facts);
    assert.doesNotMatch(out, /formal mathematical definitions are not present/i);
  });

  test("leaves caveats intact when the contradicting fact does not hold", () => {
    const input = "- The main prose source is truncated after Page 2.";
    const out = sanitizeStaleCaveats(input, { laterPagesExist: false, formulaAnchorsExist: false });
    assert.match(out, /truncated after Page 2/i);
  });
});

// ---------------------------------------------------------------------------
// H. Content-based formula grounding — the exact bad mappings from the spec.
// ---------------------------------------------------------------------------
describe("learner navigation semantic repair", () => {
  test("rewrites source-index links with section labels back to learning section indexes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-semantic-nav-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "1. Why SNNs Need Events"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "_index.md"),
        fm({ title: "test-2", knowledge_type: "cluster-index" }) +
          "# test-2\n\n## Learning\n\n- [[learning/_index|Learning]]\n\n## Sources\n\n- [[sources/_index|Sources]]\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "_index.md"),
        fm({ title: "Learning", knowledge_type: "learning-index", breadboardType: "learning_index" }) +
          "# Learning\n\n## Sections\n\n- [[sources/_index|1. Why SNNs Need Events]]\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "Topic Overview.md"),
        fm({ title: "Topic Overview", knowledge_type: "topic-overview", breadboardType: "topic_overview" }) +
          "# Topic Overview\n\nBegin with [[sources/_index|Why SNNs Need Events]]. Then ignore [[sources/_index|Sources]].\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "Learning Map.md"),
        fm({ title: "Learning Map", knowledge_type: "learning-map", breadboardType: "learning_map" }) +
          "# Learning Map\n\n- [[learning/1. Why SNNs Need Events/_index|Why SNNs Need Events]]\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "1. Why SNNs Need Events", "_index.md"),
        fm({ title: "1. Why SNNs Need Events", knowledge_type: "textbook-section", breadboardType: "textbook_section" }) +
          "# 1. Why SNNs Need Events\n",
      );
      fs.writeFileSync(
        path.join(dir, "sources", "_index.md"),
        fm({ title: "Sources", knowledge_type: "source-index", breadboardType: "source_index" }) + "# Sources\n",
      );
      fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");

      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.equal(
        report.criticalProblems.some((problem) => /semantic navigation/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      const index = fs.readFileSync(path.join(dir, "learning", "_index.md"), "utf-8");
      assert.match(index, /\[\[learning\/1\. Why SNNs Need Events\/_index\|1\. Why SNNs Need Events\]\]/);
      const rootIndex = fs.readFileSync(path.join(dir, "_index.md"), "utf-8");
      assert.match(rootIndex, /\[\[learning\/_index\|Learning\]\]/);
      const overview = fs.readFileSync(path.join(dir, "learning", "Topic Overview.md"), "utf-8");
      assert.match(overview, /\[\[learning\/1\. Why SNNs Need Events\/_index\|1\. Why SNNs Need Events\]\]/);
      assert.doesNotMatch(overview, /\[\[sources\/_index/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("contract-driven semantic repair loop", () => {
  test("adds source text anchors to conceptual visuals when source prose contains the concept", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-visual-text-anchor-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, ".breadboard", "visuals"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "1. Why SNNs Need Events"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(
        path.join(dir, "sources", "source.md"),
        fm({ title: "Source Paper", breadboardType: "source_document", sourceId: "source" }) +
          "Rate coding represents stimulus strength through spike count, while temporal coding represents information through first-spike timing and spike trains encode signals over time.\n",
      );
      fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");
      const spec = {
        id: "vis-coding",
        type: "neural_coding",
        title: "Rate coding vs temporal coding",
        sourceAnchors: [],
        sourceGroundingStatus: "conceptual-no-direct-source-figure",
        justification: "No direct figure was assigned.",
        conceptTargets: ["rate coding", "temporal coding"],
        pedagogicalPurpose: "Compare spike count and spike timing codes.",
        props: { strength: 0.6 },
        controls: [{ name: "strength", label: "Stimulus strength", type: "slider", min: 0, max: 1, step: 0.1, defaultValue: 0.6 }],
        inputs: ["stimulus strength"],
        outputs: ["rate and temporal spike trains"],
        caption: "Compare rate and temporal coding.",
        regenerationPrompt: "Improve this coding visual.",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "vis-coding.json"), JSON.stringify(spec, null, 2));
      fs.writeFileSync(
        path.join(dir, "learning", "1. Why SNNs Need Events", "1.2 Spikes, Timing, and Event-Driven Computation.md"),
        fm({
          title: "1.2 Spikes, Timing, and Event-Driven Computation",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
          visualIds: ["vis-coding"],
          generatedBy: "learn_button",
        }) + `${FILLER("rate and temporal spike coding", "basic_def")}\n\n${block(spec)}\n`,
      );

      await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
      finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      const out = fs.readFileSync(
        path.join(dir, "learning", "1. Why SNNs Need Events", "1.2 Spikes, Timing, and Event-Driven Computation.md"),
        "utf-8",
      );
      assert.match(out, /sourceGroundingStatus": "source-derived-conceptual"/);
      assert.match(out, /text-source-rate-and-temporal-spike-coding/);
      assert.match(out, /sourceAnchors: \["text-source-rate-and-temporal-spike-coding"\]/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("focuses duplicate metric calculators by page metric family before validation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-metric-focus-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, ".breadboard", "visuals"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "2. Metrics"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");
      const metricSpec = (id) => ({
        id,
        type: "metric_calculator",
        title: "SNN metric calculator",
        sourceAnchors: [],
        conceptTargets: ["accuracy", "latency", "spike count", "energy", "normalized efficiency"],
        pedagogicalPurpose: "Let the learner manipulate metric inputs directly and see how accuracy, latency, spike count, energy, and normalized efficiency change.",
        props: { correct: 920, total: 1000, decisionTime: 24, spikeCount: 180, energyPerSpike: 0.002 },
        controls: [
          { name: "correct", label: "Correct predictions", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 920 },
          { name: "total", label: "Total predictions", type: "slider", min: 100, max: 2000, step: 50, defaultValue: 1000 },
          { name: "decisionTime", label: "Decision time", type: "slider", min: 1, max: 100, step: 1, defaultValue: 24 },
          { name: "spikeCount", label: "Spike count", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 180 },
          { name: "energyPerSpike", label: "Energy per spike", type: "slider", min: 0.0005, max: 0.01, step: 0.0005, defaultValue: 0.002 },
        ],
        inputs: ["correct predictions", "total predictions", "decision time", "spike count", "energy per spike"],
        outputs: ["accuracy", "latency", "energy estimate", "normalized efficiency"],
        caption: "Generic all-metric calculator.",
        regenerationPrompt: "Improve this metric calculator.",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const a = metricSpec("vis-a");
      const b = metricSpec("vis-b");
      fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "vis-a.json"), JSON.stringify(a, null, 2));
      fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "vis-b.json"), JSON.stringify(b, null, 2));
      fs.writeFileSync(
        path.join(dir, "learning", "2. Metrics", "2.2 Accuracy and Latency.md"),
        fm({ title: "2.2 Accuracy and Latency", knowledge_type: "learning-page", breadboardType: "learning_page", visualIds: ["vis-a"], generatedBy: "learn_button" }) +
          `${FILLER("accuracy and latency", "metric")}\n\n${block(a)}\n`,
      );
      fs.writeFileSync(
        path.join(dir, "learning", "2. Metrics", "2.3 Spike Count and Energy.md"),
        fm({ title: "2.3 Spike Count and Energy", knowledge_type: "learning-page", breadboardType: "learning_page", visualIds: ["vis-b"], generatedBy: "learn_button" }) +
          `${FILLER("spike count and energy", "metric")}\n\n${block(b)}\n`,
      );

      await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.equal(
        report.criticalProblems.some((problem) => /Final interactive visual uniqueness/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      const pageA = fs.readFileSync(path.join(dir, "learning", "2. Metrics", "2.2 Accuracy and Latency.md"), "utf-8");
      const pageB = fs.readFileSync(path.join(dir, "learning", "2. Metrics", "2.3 Spike Count and Energy.md"), "utf-8");
      assert.match(pageA, /"outputs": \[\s+"accuracy",\s+"latency"\s+\]/);
      assert.match(pageB, /"outputs": \[\s+"spike count",\s+"energy"\s+\]/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("regrounds stale formula metadata to the matching source formula", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-reground-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "2. Metrics"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(
        path.join(dir, ".breadboard", "source-visuals.json"),
        JSON.stringify([
          { sourceVisualId: "S1.P6.E3", type: "equation", caption: "Total spike count summed over neurons and time steps" },
          { sourceVisualId: "S1.P6.E6", type: "equation", caption: "Convergence time as epoch reaching target accuracy" },
        ], null, 2),
      );
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");
      fs.writeFileSync(
        path.join(dir, "learning", "2. Metrics", "2.3 Spike Count and Energy.md"),
        [
          "---",
          'title: "2.3 Spike Count and Energy"',
          'knowledge_type: "learning-page"',
          'breadboardType: "learning_page"',
          'sourceFormulaAnchors: ["S1.P6.E6"]',
          "formulas:",
          '  - text: "N_{\\\\mathrm{spk}} = \\\\sum_{i,t} s_{i,t}"',
          '    groundingStatus: "source-anchored"',
          '    justification: "stale wrong anchor"',
          '    sourceAnchor: "S1.P6.E6"',
          'generatedBy: "learn_button"',
          "---",
          "",
          FILLER("spike count and energy", "metric"),
          "",
          "The symbol $x$ is only a local variable and should not become formula metadata.",
          "",
          "$$N_{\\mathrm{spk}} = \\sum_{i,t} s_{i,t}$$",
          "",
        ].join("\n"),
      );

      await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
      finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      const out = fs.readFileSync(path.join(dir, "learning", "2. Metrics", "2.3 Spike Count and Energy.md"), "utf-8");
      assert.match(out, /sourceFormulaAnchors: \["S1\.P6\.E3"\]/);
      assert.match(out, /sourceAnchor: "S1\.P6\.E3"/);
      assert.doesNotMatch(out, /sourceFormulaAnchors: \["S1\.P6\.E6"\]/);
      assert.doesNotMatch(out, /text: "x"/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("retitles mixed-role sections before semantic validation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-section-retitle-"));
    try {
      const dir = path.join(root, "test-2");
      const bb = path.join(dir, ".breadboard");
      fs.mkdirSync(bb, { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "2. The Metrics That Make SNNs Measurable"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(path.join(bb, "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(bb, "visual-index.json"), "{}");
      fs.writeFileSync(
        path.join(bb, "learning-unit-contract.json"),
        JSON.stringify({
          learningUnits: [
            { id: "T", role: "training_method", title: "Surrogate training", learningQuestion: "How are spikes trained?", zettelNotes: [{ handle: "surrogate-training-defines-a-learning-method", claim: "Surrogate training defines a learning method." }] },
            { id: "M", role: "metric", title: "Accuracy metric", learningQuestion: "How is accuracy measured?", zettelNotes: [{ handle: "accuracy-metric-measures-model-performance", claim: "Accuracy metric measures model performance." }] },
          ],
          sourceArtifactAssignments: [],
        }, null, 2),
      );
      fs.writeFileSync(
        path.join(dir, "learning", "2. The Metrics That Make SNNs Measurable", "_index.md"),
        fm({ title: "2. The Metrics That Make SNNs Measurable", breadboardType: "textbook_section" }) +
          "# 2. The Metrics That Make SNNs Measurable\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "2. The Metrics That Make SNNs Measurable", "2.1 Surrogate Training.md"),
        fm({ title: "2.1 Surrogate Training", knowledge_type: "learning-page", breadboardType: "learning_page", learningUnitId: "T", generatedBy: "learn_button", tags: ["surrogate-training-defines-a-learning-method"] }) +
          `${FILLER("surrogate training", "training")}\n`,
      );
      fs.writeFileSync(
        path.join(dir, "learning", "2. The Metrics That Make SNNs Measurable", "2.2 Accuracy Metric.md"),
        fm({ title: "2.2 Accuracy Metric", knowledge_type: "learning-page", breadboardType: "learning_page", learningUnitId: "M", generatedBy: "learn_button", tags: ["accuracy-metric-measures-model-performance"] }) +
          `${FILLER("accuracy metric", "metric")}\n`,
      );

      await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.equal(
        report.criticalProblems.some((problem) => /Section semantic coherence/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      const sectionIndex = fs.readFileSync(path.join(dir, "learning", "2. How SNNs Learn and Are Evaluated", "_index.md"), "utf-8");
      assert.match(sectionIndex, /title: "2\. How SNNs Learn and Are Evaluated"/);
      assert.match(sectionIndex, /^# 2\. How SNNs Learn and Are Evaluated$/m);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("retitles formula-only metric sections as formal descriptions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formal-retitle-"));
    try {
      const dir = path.join(root, "test-2");
      const bb = path.join(dir, ".breadboard");
      fs.mkdirSync(bb, { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "2. Decision Latency Formula Mechanics"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(path.join(bb, "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(bb, "visual-index.json"), "{}");
      fs.writeFileSync(
        path.join(bb, "learning-unit-contract.json"),
        JSON.stringify({
          learningUnits: [
            { id: "F", role: "formula", title: "Decision latency equation", learningQuestion: "How is latency defined?", zettelNotes: [{ handle: "decision-latency-records-the-source-relationship-mathematically", claim: "Decision latency records the timing relationship mathematically." }] },
          ],
          sourceArtifactAssignments: [],
        }, null, 2),
      );
      fs.writeFileSync(
        path.join(dir, "learning", "2. Decision Latency Formula Mechanics", "_index.md"),
        fm({ title: "2. Decision Latency Formula Mechanics", breadboardType: "textbook_section" }) +
          "# 2. Decision Latency Formula Mechanics\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "2. Decision Latency Formula Mechanics", "2.2 Decision Latency.md"),
        fm({ title: "2.2 Decision Latency", knowledge_type: "learning-page", breadboardType: "learning_page", learningUnitId: "F", generatedBy: "learn_button", tags: ["decision-latency-records-the-source-relationship-mathematically"] }) +
          `${FILLER("decision latency", "metric")}\n\n$$L = t_{\\text{decision}} - t_{\\text{stimulus}}$$\n`,
      );

      await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.equal(
        report.criticalProblems.some((problem) => /Section semantic coherence/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      const sectionIndex = fs.readFileSync(path.join(dir, "learning", "2. Measuring Decision Latency", "_index.md"), "utf-8");
      assert.match(sectionIndex, /title: "2\. Measuring Decision Latency"/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("retitles mixed metric/result sections with mixed-purpose titles", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-metric-retitle-"));
    try {
      const dir = path.join(root, "test-2");
      const bb = path.join(dir, ".breadboard");
      fs.mkdirSync(bb, { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "5. What the Results Show"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(path.join(bb, "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(bb, "visual-index.json"), "{}");
      fs.writeFileSync(
        path.join(bb, "learning-unit-contract.json"),
        JSON.stringify({
          learningUnits: [
            { id: "M1", role: "metric", title: "Accuracy and energy tradeoffs", learningQuestion: "How do the metrics relate?", zettelNotes: [{ handle: "accuracy-energy-tradeoff-makes-results-measurable", claim: "Accuracy and energy make the result measurable." }] },
            { id: "M2", role: "result_interpretation", title: "Latency comparisons across models", learningQuestion: "What does the latency result mean?", zettelNotes: [{ handle: "latency-result-measures-decision-speed", claim: "Latency results measure decision speed." }] },
          ],
          sourceArtifactAssignments: [],
        }, null, 2),
      );
      fs.writeFileSync(
        path.join(dir, "learning", "5. What the Results Show", "_index.md"),
        fm({ title: "5. What the Results Show", breadboardType: "textbook_section" }) +
          "# 5. What the Results Show\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "5. What the Results Show", "5.1 Accuracy and Energy Tradeoffs Across Models.md"),
        fm({ title: "5.1 Accuracy and Energy Tradeoffs Across Models", knowledge_type: "learning-page", breadboardType: "learning_page", learningUnitId: "M1", generatedBy: "learn_button", tags: ["accuracy-energy-tradeoff-makes-results-measurable"] }) +
          `${FILLER("accuracy and energy tradeoffs", "metric")}\n`,
      );
      fs.writeFileSync(
        path.join(dir, "learning", "5. What the Results Show", "5.2 Latency Comparisons Across Models.md"),
        fm({ title: "5.2 Latency Comparisons Across Models", knowledge_type: "learning-page", breadboardType: "learning_page", learningUnitId: "M2", generatedBy: "learn_button", tags: ["latency-result-measures-decision-speed"] }) +
          `${FILLER("latency comparison", "metric")}\n`,
      );

      await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      const verification = verifyFinalArtifactNoMutation({ gardenDir: dir, gardenSlug: "test-2" });
      assert.equal(
        report.criticalProblems.some((problem) => /Section semantic coherence/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      assert.deepEqual(verification.mutatedFiles, []);
      const sectionIndex = fs.readFileSync(path.join(dir, "learning", "5. Metrics and Results Compared", "_index.md"), "utf-8");
      assert.match(sectionIndex, /title: "5\. Metrics and Results Compared"/);
      assert.match(sectionIndex, /^# 5\. Metrics and Results Compared$/m);
      const repairReport = fs.readFileSync(path.join(dir, ".breadboard", "repair-report.md"), "utf-8");
      assert.match(repairReport, /## Final Verification/);
      assert.match(repairReport, /No-mutation check: pass/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("content-based formula grounding (H)", () => {
  test("accuracy fraction is anchored to the accuracy formula E1", () => {
    const grounded = groundLearnerFormula("\\text{Accuracy}=\\frac{920}{1000}=0.92=92\\%", SOURCE_FORMULAS);
    assert.equal(grounded.groundingStatus, "source-anchored");
    assert.equal(grounded.sourceAnchor, "S1.P6.E1");
  });

  test("the simplified energy helper is NOT mapped to the normalized-efficiency formula E5", () => {
    const grounded = groundLearnerFormula(
      "E_{\\text{total}} = N_{\\text{events}} \\times E_{\\text{event}}",
      SOURCE_FORMULAS,
    );
    assert.notEqual(grounded.sourceAnchor, "S1.P6.E5", "must not repeat the index-based E5 mis-mapping");
  });

  test("a single-symbol expression is not claimed as a source formula", () => {
    const grounded = groundLearnerFormula("E_{\\text{total}}", SOURCE_FORMULAS);
    assert.equal(grounded.groundingStatus, "conceptual-helper");
    assert.equal(grounded.sourceAnchor, undefined);
  });
});

// ---------------------------------------------------------------------------
// E/F. Figure classification + page roles.
// ---------------------------------------------------------------------------
describe("figure classification and page roles (E/F)", () => {
  test("classifies source visuals by kind", () => {
    assert.equal(classifyFigure({ sourceVisualId: "S1.P6.E1", type: "equation", caption: "accuracy" }), "equation");
    assert.equal(
      classifyFigure({ sourceVisualId: "S1.P7.T1", type: "table", caption: "SNN performance summary", pageNumber: 7 }),
      "result",
    );
    assert.equal(
      classifyFigure({ sourceVisualId: "S1.P4.G1", type: "graph", caption: "LIF neuron membrane potential and threshold over time", pageNumber: 4 }),
      "lif",
    );
    assert.equal(
      classifyFigure({ sourceVisualId: "S1.P4.F1", type: "diagram", caption: "Conceptual SNN architecture with input encoding", pageNumber: 4 }),
      "architecture",
    );
  });

  test("maps the 8 real section titles to the expected roles", () => {
    assert.equal(pageRole("1.1 From Conventional Neural Networks to SNNs"), "intro");
    assert.equal(pageRole("2.1 What Spiking Neural Networks Are"), "basic_def");
    assert.equal(pageRole("3.1 Neuron Model LIF"), "lif");
    assert.equal(pageRole("4.1 SNN Training Paradigms"), "training");
    assert.equal(pageRole("5.1 Unified Multi-Metric Evaluation"), "metric");
    assert.equal(pageRole("6.1 Comparative Results Across Models and Metrics"), "comparison");
    assert.equal(pageRole("7.1 What the Tradeoffs Suggest for Applications and Hardware Context"), "application");
    assert.equal(pageRole("8.1 Open Challenges and What Remains Unresolved"), "challenges");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a defective garden fails the validator; finalize cleans export
// hygiene and writes the report, but semantic defects remain validation
// failures owned by the Learning Unit Contract/page-generation path.
// ---------------------------------------------------------------------------
describe("finalize gates semantic defects", () => {
  test("uses the primary source-artifact assignment for contract fulfillment", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-luc-primary-"));
    try {
      const dir = path.join(root, "test-2");
      const bb = path.join(dir, ".breadboard");
      fs.mkdirSync(path.join(bb, "planning"), { recursive: true });
      fs.mkdirSync(path.join(dir, "assets", "source-visuals"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "1. Foundations"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "2. Results"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2", gardenId: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", knowledge_type: "source-index" }) + "# Sources\n");
      fs.writeFileSync(path.join(dir, "sources", "source.md"), fm({ title: "Source", knowledge_type: "source-document", breadboardType: "source_document", internal: "true" }) + "# Source\n");
      fs.writeFileSync(path.join(dir, "assets", "source-visuals", "table.png"), "PNG");
      fs.writeFileSync(
        path.join(bb, "source-visuals.json"),
        JSON.stringify([
          {
            sourceVisualId: "S1.P7.T1",
            sourceId: "source",
            pageNumber: 7,
            type: "table",
            caption: "SNN performance summary table",
            croppedImagePath: "/test-2/assets/source-visuals/table.png",
            usageStatus: "assigned",
            assignedPageId: "learning/2. Results/2.1 Reading the Result Table",
            assignedSectionId: "learning/2. Results",
          },
        ], null, 2),
      );
      const learningUnits = [
        {
          id: "A",
          role: "core_concept",
          title: "What the metric columns mean",
          learningQuestion: "What do the table columns mean?",
          sourceAnchors: ["S1.P7"],
          sourceFigures: [],
          sourceFormulas: [],
          sourceTables: [{ id: "S1.P7.T1", teachingGoal: "Define the table columns", rowsOrColumnsToExplain: ["accuracy"], placement: "inside_comparison" }],
          zettelNotes: [
            { handle: "metric-columns-name-what-is-being-measured", claim: "Metric columns name what is being measured." },
            { handle: "table-columns-define-shared-comparison-axes", claim: "Table columns define shared comparison axes." },
            { handle: "accuracy-column-needs-cost-columns-beside-it", claim: "Accuracy needs cost columns beside it." },
          ],
          mustNotRepeat: [],
          expectedWordRange: [200, 400],
        },
        {
          id: "B",
          role: "result_interpretation",
          title: "Reading the Result Table",
          learningQuestion: "What pattern does the table show?",
          sourceAnchors: ["S1.P7"],
          sourceFigures: [],
          sourceFormulas: [],
          sourceTables: [{ id: "S1.P7.T1", teachingGoal: "Interpret the table pattern", rowsOrColumnsToExplain: ["accuracy"], placement: "inside_result_interpretation" }],
          zettelNotes: [
            { handle: "result-tables-turn-measurements-into-comparisons", claim: "Result tables turn measurements into comparisons." },
            { handle: "rows-only-matter-through-cross-row-tradeoffs", claim: "Rows matter through cross-row tradeoffs." },
            { handle: "shared-metric-columns-make-results-comparable", claim: "Shared metric columns make results comparable." },
          ],
          mustNotRepeat: [],
          expectedWordRange: [200, 400],
        },
      ];
      fs.writeFileSync(
        path.join(bb, "learning-unit-contract.json"),
        JSON.stringify({
          sourceSetHash: "fixture",
          generatedAt: "2026-01-01T00:00:00.000Z",
          learningUnits,
          sourceArtifactAssignments: [
            { sourceArtifactId: "S1.P7.T1", assignedLearningUnitId: "A", placement: "inside_comparison", reason: "mentioned in concept unit", requiredInterpretation: "define columns" },
            { sourceArtifactId: "S1.P7.T1", assignedLearningUnitId: "B", placement: "inside_result_interpretation", reason: "primary result interpretation", requiredInterpretation: "interpret pattern" },
          ],
        }, null, 2),
      );
      fs.writeFileSync(path.join(dir, "learning", "1. Foundations", "_index.md"), fm({ title: "1. Foundations" }) + "# 1. Foundations\n");
      fs.writeFileSync(path.join(dir, "learning", "2. Results", "_index.md"), fm({ title: "2. Results" }) + "# 2. Results\n");
      fs.writeFileSync(
        path.join(dir, "learning", "1. Foundations", "1.1 What the Metric Columns Mean.md"),
        fm({
          title: "1.1 What the Metric Columns Mean",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
          gardenId: "test-2",
          tags: [
            "metric-columns-name-what-is-being-measured",
            "table-columns-define-shared-comparison-axes",
            "accuracy-column-needs-cost-columns-beside-it",
          ],
          sourceAnchors: ["S1.P7"],
          sourceVisualIds: [],
          learningUnitId: "A",
          generatedBy: "learn_button",
        }) + `${FILLER("metric columns", "metric")}\n`,
      );
      fs.writeFileSync(
        path.join(dir, "learning", "2. Results", "2.1 Reading the Result Table.md"),
        fm({
          title: "2.1 Reading the Result Table",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
          gardenId: "test-2",
          tags: [
            "result-tables-turn-measurements-into-comparisons",
            "rows-only-matter-through-cross-row-tradeoffs",
            "shared-metric-columns-make-results-comparable",
          ],
          sourceAnchors: ["S1.P7"],
          sourceVisualIds: ["S1.P7.T1"],
          learningUnitId: "B",
          generatedBy: "learn_button",
        }) +
          `${FILLER("result table", "comparison")}\n\nThe table should be read row by row: it compares the same models across the same metric columns, so the useful pattern is the tradeoff between accuracy and cost.\n\n![SNN performance summary table](/test-2/assets/source-visuals/table.png)\n\nThe important point is that a result table turns isolated measurements into a comparison; each row only matters because the other rows expose the tradeoff.\n`,
      );

      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.ok(
        !report.criticalProblems.some((problem) => /missing contract source table S1\.P7\.T1/.test(problem)),
        report.criticalProblems.join(" | "),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("validator fails before finalize; hygiene is repaired and contract defects hard-fail", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-e2e-"));
    try {
      const dir = buildDefectiveGarden(root);

      const before = runChecks(dir, "test-2");
      const failedBefore = new Set(before.filter((r) => r.status === "FAIL").map((r) => r.id));
      assert.ok(failedBefore.size > 0, "the defective garden must fail the validator");
      // Dirty export tree (7), source/visual placement (27), tag over-reuse (8/24),
      // and repeated motivation (29) are the headline defects.
      assert.ok(failedBefore.has(7), "check 7 (export tree) must fail before finalize");

      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.ok(
        report.criticalProblems.some((problem) => /Learning Unit Contract fulfillment/.test(problem)),
        `finalize must hard-fail contract defects: ${report.criticalProblems.join(" | ")}`,
      );

      const after = runChecks(dir, "test-2");
      writeValidationReport(dir, "test-2", after);
      const failedAfter = after.filter((r) => r.status === "FAIL");
      const afterById = new Map(after.map((result) => [result.id, result]));
      assert.equal(afterById.get(7).status, "PASS", "finalize should still clean the exported filesystem shape");
      assert.ok(
        failedAfter.some((result) => [8, 24, 31, 32].includes(result.id)),
        `semantic failures should remain after finalize: ${failedAfter.map((f) => `${f.id}. ${f.name}`).join(" | ")}`,
      );
      const finalizerReport = fs.readFileSync(path.join(dir, ".breadboard", "validation-report.md"), "utf-8");
      assert.match(finalizerReport, /^Accepted:\s+no$/m, "the finalizer report must not claim acceptance");

      // The exported artifact contains the validation report (K).
      assert.ok(
        fs.existsSync(path.join(dir, ".breadboard", "validation-report.md")),
        ".breadboard/validation-report.md must be written into the export",
      );
      // The dirty top-level folders are gone (A).
      const top = fs.readdirSync(dir).sort();
      assert.deepEqual(
        top.filter((name) => !name.startsWith(".") || name === ".breadboard").sort(),
        ["_index.md", ".breadboard", "assets", "learning", "sources"].sort(),
      );
      assert.ok(!top.includes("Internal"), "Internal/ must not remain at top level");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Defective SNN garden builder: complete enough to pass all checks *after*
// finalize, but seeded with every failure class this task fixes.
// ---------------------------------------------------------------------------

function fm(obj) {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    lines.push(Array.isArray(v) ? `${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]` : `${k}: ${JSON.stringify(v)}`);
  }
  return `---\n${lines.join("\n")}\n---\n\n`;
}

// Role-specific keyword-rich prose so the role tags finalize assigns are
// genuinely central to the page (mirrors what the real learner pages contain).
const ROLE_KEYWORDS = {
  intro:
    "A dense conventional network keeps continuous activation values flowing through every layer, while a spiking neural network uses sparse event-driven spike-based communication so silence saves energy.",
  basic_def:
    "A spiking neural network generates spike events when a neuron's membrane potential accumulates past a level, so spike event generation and membrane potential accumulation define event-driven sparsity.",
  lif:
    "The leaky integrate-and-fire LIF neuron integrates input into its membrane potential, leaks charge, fires a spike when it crosses the firing threshold, then applies a reset; threshold reset and membrane potential integration are the core dynamics.",
  training:
    "Training a spiking network uses surrogate gradient learning and scalable optimization, and spike timing plasticity adjusts weights from the relative timing of spikes.",
  metric:
    "A unified evaluation weighs accuracy, latency, spike count, and energy together; accuracy per energy and the evaluation metric coupling show why one number is not enough.",
  comparison:
    "Comparing model families side by side across accuracy, energy, and latency needs reproducible metric baselines so the model family comparison stays fair.",
  application:
    "Edge neuromorphic hardware imposes an energy and latency budget, so latency sensitive inference decides which spiking approach fits the deployment.",
  challenges:
    "Open challenges include the hardware standardization gap, scalable optimization of training, reproducible metric baselines, and robustness to noisy spike timing.",
};

const FILLER = (topic, role) =>
  `Consider a sensor watching a mostly still scene while learning about ${topic}. ${ROLE_KEYWORDS[role] ?? ""} This matters because a dense system keeps recomputing values even when nothing changes, so the learner needs a clear mental model before moving on. `.repeat(
    12,
  );

function lessonBody(topic, role, extra = "") {
  return (
    `### ${topic}\n\n` +
    FILLER(topic, role) +
    `\n\n${extra}\n\n` +
    `For example, raising the input current makes the effect stronger.\n\n` +
    `**Question.** Why does this matter?\n\n**Answer.** Because it changes the tradeoff the learner must reason about.\n`
  );
}

function block(spec) {
  return "```breadboard-visual\n" + JSON.stringify(spec, null, 2) + "\n```";
}

function interactiveSpec(id, type, pageId) {
  return {
    id,
    type,
    title: type === "lif_neuron" ? "Leaky integrate-and-fire membrane simulator" : "Metric tradeoff explorer",
    sourceAnchors: [],
    conceptTargets: type === "lif_neuron" ? ["membrane potential", "threshold", "reset"] : ["accuracy", "latency", "energy"],
    pedagogicalPurpose: "Interactive exploration for this lesson.",
    props: type === "lif_neuron" ? { threshold: 1, leak: 0.15, inputCurrent: 1.2 } : { priority: "balanced" },
    regenerationPrompt: "Improve this interactive visual.",
    caption: "Adjust the controls to explore the mechanism.",
    pageId,
    pagePath: `${pageId}.md`,
    learningGoal: "Teach the page's core dynamic.",
    inputs: ["Control A", "Control B"],
    outputs: ["Observed behavior"],
    controls: [{ name: "a", label: "Control A", type: "slider", min: 0, max: 1, step: 0.1, defaultValue: 0.5 }],
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    sourceGroundingStatus: "conceptual-no-direct-source-figure",
    justification: "Placeholder grounding to be repaired by finalize.",
  };
}

function buildDefectiveGarden(root) {
  const dir = path.join(root, "test-2");
  const bb = path.join(dir, ".breadboard");
  fs.mkdirSync(path.join(bb, "visuals"), { recursive: true });
  fs.mkdirSync(path.join(bb, "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets", "source-visuals"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  // Defect A: an Internal/ folder and a numbered source-conversion folder.
  fs.mkdirSync(path.join(dir, "Internal", "Concept Graph"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Internal", "Concept Graph", "c.md"), fm({ title: "c", knowledge_type: "internal-concept" }) + "x\n");
  fs.mkdirSync(path.join(dir, "1. spiking-neural-networks-the-future-of-brain-inspired-computing"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "1. spiking-neural-networks-the-future-of-brain-inspired-computing", "conv-1783174795571.md"),
    fm({ title: "conv", knowledge_type: "learning-page", breadboardType: "learning_page", internal: "true", source_file: "2510.27379v1.pdf" }) + "# conv\n",
  );

  const sections = [
    { n: 1, title: "From Conventional Neural Networks to SNNs", role: "intro", vis: "lif_neuron" },
    { n: 2, title: "What Spiking Neural Networks Are", role: "basic_def", vis: "lif_neuron" },
    { n: 3, title: "Neuron Model LIF as Evidence", role: "lif", vis: "lif_neuron" }, // Defect: "as Evidence" title
    { n: 4, title: "SNN Training Paradigms", role: "training", vis: "lif_neuron" },
    { n: 5, title: "Unified Multi-Metric Evaluation", role: "metric", vis: "tradeoff_explorer" },
    { n: 6, title: "Comparative Results Across Models and Metrics", role: "comparison", vis: "tradeoff_explorer" },
    { n: 7, title: "What the Tradeoffs Suggest for Applications and Hardware Context", role: "application", vis: "tradeoff_explorer" },
    { n: 8, title: "Open Challenges and What Remains Unresolved", role: "challenges", vis: null },
  ];

  // Ledger: architecture, LIF, six metric equations, and result tables/graphs.
  const cropped = (name) => `/test-2/assets/source-visuals/${name}.png`;
  for (const name of [
    "p4-f1", "p4-g1", "p6-e5", "p6-e6", "p7-t1", "p7-g1", "p8-t1", "p8-g1", "p9-t1", "p9-g1", "p10-t1", "p10-g1", "p11-g1",
  ]) {
    fs.writeFileSync(path.join(dir, "assets", "source-visuals", `${name}.png`), "PNG");
  }
  const ledger = [
    { sourceVisualId: "S1.P4.F1", sourceId: "src", pageNumber: 4, type: "diagram", caption: "Conceptual SNN architecture with input encoding", croppedImagePath: cropped("p4-f1"), usageStatus: "intentionally_skipped", skipReason: "n/a" },
    { sourceVisualId: "S1.P4.G1", sourceId: "src", pageNumber: 4, type: "graph", caption: "LIF neuron membrane potential and threshold over time", croppedImagePath: cropped("p4-g1"), usageStatus: "intentionally_skipped", skipReason: "n/a" },
    ...SOURCE_FORMULAS.map((f, i) => ({
      sourceVisualId: f.id,
      sourceId: "src",
      pageNumber: 6,
      type: "equation",
      caption: f.caption,
      croppedImagePath: i >= 4 ? cropped(`p6-e${i + 1}`) : undefined,
      usageStatus: "intentionally_skipped",
      skipReason: "n/a",
    })),
    // Defect F: all result visuals assigned to the basic-definition page 2.1.
    ...[
      ["S1.P7.T1", 7, "table", "SNN performance summary comparing model accuracy and normalized energy consumption", "p7-t1"],
      ["S1.P7.G1", 7, "graph", "Performance analysis and energy consumption of SNN models versus ANN", "p7-g1"],
      ["S1.P8.T1", 8, "table", "Latency comparison table across ANN and SNN models", "p8-t1"],
      ["S1.P8.G1", 8, "graph", "Latency comparison in milliseconds across ANN and SNN models", "p8-g1"],
      ["S1.P9.T1", 9, "table", "SNN energy efficiency summary across model types", "p9-t1"],
      ["S1.P9.G1", 9, "graph", "Comparison of energy consumption and spike count per inference", "p9-g1"],
      ["S1.P10.T1", 10, "table", "Training loss across epochs", "p10-t1"],
      ["S1.P10.G1", 10, "graph", "Convergence behavior showing training loss across epochs", "p10-g1"],
      ["S1.P11.G1", 11, "graph", "Learning curves showing training accuracy versus epochs", "p11-g1"],
    ].map(([id, page, type, caption, name]) => ({
      sourceVisualId: id,
      sourceId: "src",
      pageNumber: page,
      type,
      caption,
      croppedImagePath: cropped(name),
      usageStatus: "assigned",
      assignedPageId: "learning/2. What Spiking Neural Networks Are/2.1 What Spiking Neural Networks Are",
      assignedSectionId: "learning/2. What Spiking Neural Networks Are",
    })),
  ];
  fs.writeFileSync(path.join(bb, "source-visuals.json"), JSON.stringify(ledger, null, 2));

  // Interactive index + spec files.
  const index = {};
  for (const s of sections) {
    if (!s.vis) continue;
    const folder = `${s.n}. ${s.title}`;
    const pageId = `learning/${folder}/${s.n}.1 ${s.title}`;
    const id = `vis-${s.n}-1-${s.role}`;
    const spec = interactiveSpec(id, s.vis, pageId);
    // Defect G: lif visuals anchored to eval/result; tradeoff on 6/7 anchored to bogus P0.
    if (s.role === "intro") spec.sourceAnchors = [{ equationId: "S1.P6.E5", description: "efficiency", sourceId: "src", page: 6 }];
    if (s.role === "basic_def") spec.sourceAnchors = [{ tableId: "S1.P7.T1", description: "performance", sourceId: "src", page: 7 }];
    if (s.role === "training") spec.sourceAnchors = [{ figureId: "S1.P11.G1", description: "learning curves", sourceId: "src", page: 11 }];
    if (s.role === "comparison" || s.role === "application") spec.sourceAnchors = [{ tableId: "S1.P0.T1", description: "bogus", sourceId: "src", page: 0 }];
    fs.writeFileSync(path.join(bb, "visuals", `${id}.json`), JSON.stringify(spec, null, 2));
    index[id] = { id, pageSlug: pageId, type: s.vis, title: spec.title, version: 1, updatedAt: spec.createdAt };
  }
  fs.writeFileSync(path.join(bb, "visual-index.json"), JSON.stringify(index, null, 2));

  // Learner pages.
  for (const s of sections) {
    const folder = `${s.n}. ${s.title}`;
    fs.mkdirSync(path.join(dir, "learning", folder), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "learning", folder, "_index.md"),
      fm({ title: `${s.n}. ${s.title}`, knowledge_type: "learning-section", breadboardType: "learning_section", generatedBy: "learn_button", generated_by: "learn_button" }) +
        `# ${s.n}. ${s.title}\n\nWork through the lessons in order.\n`,
    );
    const id = s.vis ? `vis-${s.n}-1-${s.role}` : undefined;
    const pageId = `learning/${folder}/${s.n}.1 ${s.title}`;
    // Defect I: convergence tag over-reused across most pages.
    const tags = ["snn/event-driven-sparsity", "metric/convergence-time-target-epoch", "snn/lif-neuron-threshold-reset"];
    // Defect J: repeated motivation on pages 4 and 5.
    let extra = "";
    if (s.role === "training" || s.role === "metric") {
      extra = "Imagine a small camera on a battery-powered robot in a quiet hallway where a dense ANN keeps working while a silent SNN saves energy.";
    }
    if (s.role === "metric") {
      // Defect H: index-based formula mapping (E_total -> E5) + accuracy formula.
      extra +=
        "\n\nAccuracy is the fraction of correct predictions:\n$$\n\\text{Accuracy}=\\frac{920}{1000}=0.92=92\\%\n$$\nEnergy is roughly\n$$\nE_{\\text{total}} = N_{\\text{events}} \\times E_{\\text{event}}\n$$";
    }
    const frontmatter = {
      title: `${s.n}.1 ${s.title}`,
      knowledge_type: "learning-page",
      breadboardType: "learning_page",
      gardenId: "test-2",
      sectionNumber: s.n,
      subsectionNumber: `${s.n}.1`,
      sourceAnchors: ["S1.P1.Abstract"],
      tags,
      visualIds: id ? [id] : [],
      sourceVisualIds: s.role === "basic_def"
        ? ["S1.P7.T1", "S1.P7.G1", "S1.P8.T1", "S1.P8.G1", "S1.P9.T1", "S1.P9.G1", "S1.P10.T1", "S1.P10.G1", "S1.P11.G1"]
        : [],
      generatedBy: "learn_button",
      generated_by: "learn_button",
      learningVersion: "learning_x",
      learningVersionId: "learning_x",
    };
    let body = lessonBody(s.title, s.role, extra);
    if (s.role === "metric") {
      // Defect H frontmatter: index-mapped formula anchors.
      frontmatter.sourceFormulaAnchors = ["S1.P6.E1", "S1.P6.E2", "S1.P6.E3", "S1.P6.E4", "S1.P6.E5", "S1.P6.E6"];
    }
    let fmText = fm(frontmatter);
    if (s.role === "metric") {
      fmText = fmText.replace(
        /generatedBy:/,
        [
          "formulas:",
          '  - text: "\\\\text{Accuracy}=\\\\frac{920}{1000}=0.92=92\\\\%"',
          '    groundingStatus: "source-anchored"',
          '    sourceAnchor: "S1.P6.E1"',
          '    justification: "x"',
          '  - text: "E_{\\\\text{total}} = N_{\\\\text{events}} \\\\times E_{\\\\text{event}}"',
          '    groundingStatus: "source-anchored"',
          '    sourceAnchor: "S1.P6.E5"',
          '    justification: "x"',
          "generatedBy:",
        ].join("\n"),
      );
    }
    // Defect F: the basic-definition page embeds all result images.
    if (s.role === "basic_def") {
      for (const v of ledger.filter((x) => x.usageStatus === "assigned")) {
        body += `\n\n![${v.caption}](${v.croppedImagePath})`;
      }
    }
    if (id) body += `\n\n${block(interactiveSpec(id, s.vis, pageId))}`;
    fs.writeFileSync(path.join(dir, "learning", folder, `${s.n}.1 ${s.title}.md`), fmText + body + "\n");
  }

  // Overview / map / index files.
  const readingLinks = sections
    .map((s) => `${s.n}. [[learning/${s.n}. ${s.title}/${s.n}.1 ${s.title}|${s.n}.1 ${s.title}]]`)
    .join("\n");
  fs.writeFileSync(
    path.join(dir, "_index.md"),
    fm({ title: "test-2", knowledge_type: "cluster-index" }) +
      "# test-2\n\n## Learning\n\n- [[learning/Topic Overview|Topic Overview]]\n\n## Sources\n\n- [[sources/_index|Sources]]\n\n## Reading Path\n\n" +
      readingLinks + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "learning", "_index.md"),
    fm({ title: "test-2", knowledge_type: "learning-index", breadboardType: "learning_index", generatedBy: "learn_button", generated_by: "learn_button" }) + "# test-2\n\nStart with the Topic Overview.\n",
  );
  fs.writeFileSync(
    path.join(dir, "learning", "Topic Overview.md"),
    fm({ title: "Topic Overview", knowledge_type: "topic-overview", breadboardType: "topic_overview", generatedBy: "learn_button", generated_by: "learn_button" }) +
      "# Topic Overview\n\nRead in order.\n",
  );
  // Defect D: stale caveats in the Learning Map.
  fs.writeFileSync(
    path.join(dir, "learning", "Learning Map.md"),
    fm({ title: "Learning Map", knowledge_type: "learning-map", breadboardType: "learning_map", generatedBy: "learn_button", generated_by: "learn_button" }) +
      "# Learning Map\n\n## Warnings\n\n" +
      "- The main prose source is truncated after Page 2, so later-paper details must not be inferred beyond the provided anchors and source-derived tables.\n" +
      "- The performance metrics are named and numerically compared, but formal mathematical definitions are not present in the supplied material and should not be fabricated.\n",
  );

  // Source note with later pages + broken links (Defect C) + planning files.
  const pageHeadings = Array.from({ length: 16 }, (_, i) => `# Page ${i + 1}\n\nBody of page ${i + 1}.`).join("\n\n");
  fs.writeFileSync(
    path.join(dir, "sources", "2510-27379v1.md"),
    fm({ title: "Spiking Neural Networks: The Future of Brain-Inspired Computing", knowledge_type: "source-document", breadboardType: "source_document", internal: "true" }) +
      "## Summary\n\n[[2510-27379v1|Spiking Neural Networks: The Future of Brain-Inspired Computing]]\n\n" +
      "## Textbook coverage\n\n- [[2510-27379v1-1783174795571|2510.27379v1]] (Page 1)\n\n" +
      "## Source material\n\n" + pageHeadings + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "sources", "_index.md"),
    fm({ title: "Sources", knowledge_type: "source-index", breadboardType: "source_index", internal: "true" }) +
      "# Sources\n\n- [[sources/2510-27379v1|Spiking Neural Networks: The Future of Brain-Inspired Computing]]\n",
  );
  fs.writeFileSync(
    path.join(bb, "planning", "Source Map.md"),
    fm({ title: "Source Map", knowledge_type: "source-map" }) +
      "# Source Map\n\n## Formula Coverage\n\nThe source contains explicit metric formulas; formula anchors are present.\n\n" +
      "- S1.P6.E1: accuracy\n",
  );
  fs.writeFileSync(
    path.join(bb, "planning", "Source Coverage.md"),
    fm({ title: "Source Coverage", knowledge_type: "source-coverage" }) +
      "# Source Coverage\n\n## Formula Anchor Assignments\n\n- S1.P6.E1: central to the evaluation lesson\n",
  );

  return dir;
}

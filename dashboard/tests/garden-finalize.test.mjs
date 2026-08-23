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

  test("rewrites a JSON-structured 'later pages ... available only as extracted captions' caveat", () => {
    // Regression: the detector flagged this broad "later pages ... captions"
    // phrasing (common in JSON-structured Source Maps) but the sanitizer had no
    // matching rewrite, so finalize detected a caveat it could not clean.
    const input = '        "details": "The provided content is truncated, while figures from later pages are available only as extracted captions.",';
    const out = sanitizeStaleCaveats(input, facts);
    assert.doesNotMatch(out, /later pages are available only as extracted captions/i);
    assert.match(out, /later source pages are available through extracted anchors/);
    assert.match(out, /"details":/, "must stay valid JSON (key preserved)");
  });

  test("finalize does not self-flag the generated validation report as a stale caveat", () => {
    // Regression: the caveat detector used to scan .breadboard/validation-report.md
    // and .breadboard/repair-report.md, which ECHO problem text — so a reported
    // caveat became a new self-referential caveat. A stale caveat sitting only in
    // the generated report must not trip finalize.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-caveat-report-"));
    try {
      const dir = path.join(root, "test-2");
      const bb = path.join(dir, ".breadboard", "planning");
      fs.mkdirSync(bb, { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(
        path.join(dir, ".breadboard", "source-visuals.json"),
        JSON.stringify([{ sourceVisualId: "S1.P9.T1", type: "table", caption: "later-page table", pageNumber: 9 }], null, 2),
      );
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");
      // A prior validation report that ECHOES a later-page caveat problem.
      fs.writeFileSync(
        path.join(dir, ".breadboard", "validation-report.md"),
        "# Report\n\n## Source Map Caveat Reconciliation\n\n- stale caveat says later pages are unavailable despite later anchors/pages\n",
      );
      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.equal(
        report.criticalProblems.some((p) => /validation-report\.md.*stale caveat/i.test(p)),
        false,
        `finalize must not flag the generated report as a caveat source: ${report.criticalProblems.join(" | ")}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

  test("accepts full section labels that target canonical shortened section folders", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-semantic-nav-long-"));
    try {
      const dir = path.join(root, "test-2");
      const fullBody = "Continuous Activation Cost, Long-range Temporal Modeling Limitation, Model-specific Tradeoff Results";
      const folderBody = fullBody.slice(0, 96).trim();
      const fullTitle = `4. ${fullBody}`;
      const folder = `4. ${folderBody}`;
      fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", folder), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "_index.md"),
        fm({ title: "test-2", knowledge_type: "cluster-index" }) +
          "# test-2\n\n## Learning\n\n- [[learning/_index|Learning]]\n\n## Sources\n\n- [[sources/_index|Sources]]\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "_index.md"),
        fm({ title: "Learning", knowledge_type: "learning-index", breadboardType: "learning_index" }) +
          `# Learning\n\n## Sections\n\n- [[learning/${folder}/_index|${fullTitle}]]\n`,
      );
      fs.writeFileSync(
        path.join(dir, "learning", "Topic Overview.md"),
        fm({ title: "Topic Overview", knowledge_type: "topic-overview", breadboardType: "topic_overview" }) +
          `# Topic Overview\n\nRead [[learning/${folder}/_index|${fullTitle}]].\n`,
      );
      fs.writeFileSync(
        path.join(dir, "learning", "Learning Map.md"),
        fm({ title: "Learning Map", knowledge_type: "learning-map", breadboardType: "learning_map" }) +
          `# Learning Map\n\n- ${fullTitle}\n`,
      );
      fs.writeFileSync(
        path.join(dir, "learning", folder, "_index.md"),
        fm({ title: fullTitle, knowledge_type: "textbook-section", breadboardType: "textbook_section" }) +
          `# ${fullTitle}\n`,
      );
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");

      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.equal(
        report.criticalProblems.some((problem) => /Semantic Navigation Number Matching|Section Folder\/Title Consistency/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("contract-driven semantic repair loop", () => {
  test("finalize adopts existing orphan learner pages for missing contract units", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-orphan-unit-page-"));
    try {
      const dir = path.join(root, "test-2");
      const bb = path.join(dir, ".breadboard");
      fs.mkdirSync(bb, { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "1. Why SNNs Need Events"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(path.join(bb, "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(bb, "visual-index.json"), "{}");
      fs.writeFileSync(
        path.join(bb, "learning-unit-contract.json"),
        JSON.stringify({
          sourceSetHash: "fixture",
          generatedAt: "2026-01-01T00:00:00.000Z",
          learningUnits: [
            {
              id: "U1",
              role: "core_concept",
              title: "Why Spiking Neural Networks Exist",
              learningQuestion: "Why do event-driven spikes matter?",
              sourceAnchors: [],
              sourceFigures: [],
              sourceTables: [],
              sourceFormulas: [],
              semanticConcepts: [
                {
                  slug: "event-driven-processing",
                  preferredLabel: "Event-driven processing",
                  role: "primary",
                  aliases: ["event-driven computation"],
                  evidenceAnchors: [],
                },
                {
                  slug: "sparse-computation",
                  preferredLabel: "Sparse computation",
                  role: "supporting",
                  aliases: [],
                  evidenceAnchors: [],
                },
              ],
              knowledgeClaims: [
                {
                  text: "Spike events enable sparse computation.",
                  subject: "event-driven-processing",
                  predicate: "enables",
                  object: "sparse-computation",
                  evidenceAnchors: [],
                },
              ],
              zettelNotes: [
                {
                  handle: "spike-events-enable-sparse-computation",
                  claim: "Spike events enable sparse computation.",
                },
              ],
              mustNotRepeat: [],
              expectedWordRange: [200, 400],
            },
          ],
          sourceArtifactAssignments: [],
        }, null, 2),
      );
      fs.writeFileSync(
        path.join(dir, "learning", "1. Why SNNs Need Events", "_index.md"),
        fm({ title: "1. Why SNNs Need Events", breadboardType: "textbook_section" }) +
          "# 1. Why SNNs Need Events\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "1. Why SNNs Need Events", "1.1 Why Spiking Neural Networks Exist.md"),
        fm({
          title: "1.1 Why Spiking Neural Networks Exist",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
        }) + `${FILLER("spike events and sparse computation", "intro")}\n`,
      );

      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.equal(
        report.criticalProblems.some((problem) => /learning unit U1 has no generated learner page/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      const out = fs.readFileSync(
        path.join(dir, "learning", "1. Why SNNs Need Events", "1.1 Why Spiking Neural Networks Exist.md"),
        "utf-8",
      );
      assert.match(out, /^generatedBy: "learn_button"$/m);
      assert.match(out, /^learningUnitId: "U1"$/m);
      assert.match(out, /^primaryConcepts: \["event-driven-processing"\]$/m);
      assert.match(out, /^supportingConcepts: \["sparse-computation"\]$/m);
      assert.match(out, /^tags: \["event-driven-processing", "sparse-computation"\]$/m);
      assert.doesNotMatch(out, /^tags: \[[^\n]*"spike-events-enable-sparse-computation"[^\n]*\]$/m);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

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

  test("finalize adds text anchors to source-derived metric calculators with formula anchors", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-metric-text-anchor-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, ".breadboard", "visuals"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "3. The Metrics That Make SNNs Measurable"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      const structuralTextEvidence = {
        id: "text-source-metric-definition",
        kind: "guidance",
        sourceId: "source",
        page: 1,
        title: "Metric definition",
        exactText: "The metric definition for spike count treats spike count as the number of spike events accumulated across neurons and time steps, so the formula explains activity cost.",
        provenance: {
          origin: "selected_source_markdown_page",
          sourceRelPath: "sources/source.md",
          extraction: "exact_markdown_page_block",
        },
      };
      fs.writeFileSync(
        path.join(dir, ".breadboard", "source-anchors.json"),
        `${JSON.stringify({
          schemaVersion: 7,
          customMetadata: { retain: true },
          sourceTextConceptAnchors: [],
          sourceStructuralAnchors: [structuralTextEvidence],
        }, null, 2)}\n`,
      );
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(
        path.join(dir, "sources", "source.md"),
        fm({ title: "Source Paper", breadboardType: "source_document", sourceId: "source" }) +
          "The metric definition for spike count treats spike count as the number of spike events accumulated across neurons and time steps, so the formula explains activity cost.\n",
      );
      fs.writeFileSync(
        path.join(dir, ".breadboard", "source-visuals.json"),
        JSON.stringify([
          {
            sourceVisualId: "S1.P6.E3",
            type: "equation",
            caption: "Total spike count summed over neurons and time steps",
            usageStatus: "assigned",
            conceptUsage: "explained_as_text_formula",
            cropStatus: "omitted_unreliable",
          },
        ], null, 2),
      );
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");
      const spec = {
        id: "vis-spike-count",
        type: "metric_calculator",
        title: "Spike Count Calculator",
        sourceAnchors: [{ equationId: "S1.P6.E3", description: "Total spikes summed over neurons and time steps" }],
        sourceGroundingStatus: "source-derived-conceptual",
        justification: "The source explains this concept in prose but does not provide a dedicated figure, so the visual is derived from the source text anchor.",
        conceptTargets: ["spike count"],
        pedagogicalPurpose: "Let the learner manipulate spike-count inputs.",
        props: { spikeCount: 180 },
        controls: [{ name: "spikeCount", label: "Spike count", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 180 }],
        inputs: ["spike count"],
        outputs: ["spike count"],
        caption: "Adjust spike count.",
        regenerationPrompt: "Improve this spike-count calculator.",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "vis-spike-count.json"), JSON.stringify(spec, null, 2));
      fs.writeFileSync(
        path.join(dir, "learning", "3. The Metrics That Make SNNs Measurable", "3.3 Spike Count as Activity Cost.md"),
        fm({
          title: "3.3 Spike Count as Activity Cost",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
          visualIds: ["vis-spike-count"],
          sourceAnchors: ["S1.P6.E3"],
          sourceFormulaAnchors: ["S1.P6.E3"],
          generatedBy: "learn_button",
        }) + `${FILLER("spike count as activity cost", "metric")}\n\n${block(spec)}\n`,
      );

      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.equal(
        report.criticalProblems.some((problem) => /source-derived-conceptual but lacks a textAnchorId/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      const out = fs.readFileSync(
        path.join(dir, "learning", "3. The Metrics That Make SNNs Measurable", "3.3 Spike Count as Activity Cost.md"),
        "utf-8",
      );
      assert.match(out, /text-source-metric-definition/);
      assert.match(out, /"textAnchorId": "text-source-metric-definition"/);
      const ledger = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "source-anchors.json"), "utf-8"));
      assert.deepEqual(ledger.customMetadata, { retain: true });
      assert.deepEqual(ledger.sourceStructuralAnchors, [structuralTextEvidence]);
      assert.match(out, /sourceAnchors: \["S1.P6.E3", "text-source-metric-definition"\]/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("finalize rejects bare source-document slugs as imprecise anchor labels (not registered)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-slug-anchor-"));
    try {
      const dir = path.join(root, "test-2");
      const bb = path.join(dir, ".breadboard");
      const sourceSlug = "2510-27379v1";
      fs.mkdirSync(bb, { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "1. Why SNNs Need Events"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(
        path.join(dir, "sources", `${sourceSlug}.md`),
        fm({
          title: "Spiking Neural Networks: The Future of Brain-Inspired Computing",
          knowledge_type: "source-document",
          breadboardType: "source_document",
          sourceId: sourceSlug,
          internal: "true",
        }) + "# Source\n\nSpiking neural networks use discrete spike events so computation can become sparse and event driven.\n",
      );
      fs.writeFileSync(path.join(bb, "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: [], sourceStructuralAnchors: [] }, null, 2));
      fs.writeFileSync(path.join(bb, "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(bb, "visual-index.json"), "{}");
      fs.writeFileSync(
        path.join(bb, "learning-unit-contract.json"),
        JSON.stringify({
          sourceSetHash: "fixture",
          generatedAt: "2026-01-01T00:00:00.000Z",
          learningUnits: [
            {
              id: "U1",
              role: "core_concept",
              title: "Why Spiking Neural Networks Exist",
              learningQuestion: "Why do event-driven spikes matter?",
              sourceAnchors: [sourceSlug],
              sourceFigures: [],
              sourceTables: [],
              sourceFormulas: [],
              zettelNotes: [
                {
                  handle: "spike-events-enable-sparse-computation",
                  claim: "Spike events enable sparse computation.",
                },
              ],
              mustNotRepeat: [],
              expectedWordRange: [200, 400],
            },
          ],
          sourceArtifactAssignments: [],
        }, null, 2),
      );
      fs.writeFileSync(
        path.join(dir, "learning", "1. Why SNNs Need Events", "_index.md"),
        fm({ title: "1. Why SNNs Need Events", breadboardType: "textbook_section" }) +
          "# 1. Why SNNs Need Events\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", "1. Why SNNs Need Events", "1.1 Why Spiking Neural Networks Exist.md"),
        fm({
          title: "1.1 Why Spiking Neural Networks Exist",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
          learningUnitId: "U1",
          learningUnitRole: "core_concept",
          sourceAnchors: [sourceSlug],
          tags: ["spike-events-enable-sparse-computation"],
          generatedBy: "learn_button",
        }) + `${FILLER("spike events and sparse computation", "intro")}\n`,
      );

      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      // A bare document slug is imprecise grounding: finalize strips it from the
      // page rather than registering the whole document as an anchor (matches the
      // canonical-audit rule in final-garden-state 3b). It must leave neither a
      // dangling "missing from registry" problem nor a registered slug anchor.
      assert.equal(
        report.criticalProblems.some((problem) => /source anchor "2510-27379v1".*missing from the canonical source-anchor registry/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      const anchors = JSON.parse(fs.readFileSync(path.join(bb, "source-anchors.json"), "utf-8"));
      assert.ok(
        !(anchors.sourceStructuralAnchors ?? []).some((anchor) => anchor.id === sourceSlug),
        "bare source-document slug must NOT be registered as a structural source anchor",
      );
      const pageMd = fs.readFileSync(path.join(dir, "learning", "1. Why SNNs Need Events", "1.1 Why Spiking Neural Networks Exist.md"), "utf-8");
      const pageAnchors = (pageMd.match(/^sourceAnchors:\s*\[([^\]]*)\]/m)?.[1] ?? "");
      assert.ok(!pageAnchors.includes(sourceSlug), "reconcile removes the bare slug from the page's sourceAnchors");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("preflight removes a legacy SNN calculator from an electromagnetics unit without hiding the required-visual blocker", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-incompatible-metric-"));
    try {
      const dir = path.join(root, "electromagnetism");
      const bb = path.join(dir, ".breadboard");
      const lessonDir = path.join(dir, "learning", "1. Electric Potential");
      fs.mkdirSync(path.join(bb, "visuals"), { recursive: true });
      fs.mkdirSync(lessonDir, { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "electromagnetism" }) + "# Electromagnetism\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(
        path.join(dir, "sources", "book.md"),
        fm({ title: "Electromagnetics", breadboardType: "source_document", sourceId: "book" }) +
          "# Page 100\n\nElectric potential has a gradient, and an electric field stores energy throughout space.\n",
      );
      fs.writeFileSync(path.join(bb, "source-visuals.json"), "[]");
      const spec = {
        id: "vis-electric-energy",
        type: "metric_calculator",
        title: "Energy Calculator",
        sourceAnchors: [],
        sourceGroundingStatus: "conceptual-no-direct-source-figure",
        justification: "A conceptual calculator was selected.",
        conceptTargets: ["energy"],
        pedagogicalPurpose: "Let the learner manipulate inputs for energy and observe how the selected metric responds.",
        controls: [
          { name: "spikeCount", label: "Spike count", type: "slider", min: 0, max: 1000, step: 10, defaultValue: 100 },
          { name: "energyPerSpike", label: "Energy per spike", type: "slider", min: 0, max: 1, step: 0.01, defaultValue: 0.1 },
        ],
        inputs: ["spike count", "energy per spike"],
        outputs: ["energy"],
        caption: "Adjust spike count to estimate energy.",
        regenerationPrompt: "Improve this calculator.",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      fs.writeFileSync(path.join(bb, "visuals", `${spec.id}.json`), JSON.stringify(spec, null, 2));
      fs.writeFileSync(
        path.join(bb, "visual-index.json"),
        JSON.stringify({ [spec.id]: { id: spec.id, type: spec.type } }, null, 2),
      );
      fs.writeFileSync(
        path.join(bb, "learning-unit-contract.json"),
        JSON.stringify({
          sourceSetHash: "fixture",
          generatedAt: "2026-01-01T00:00:00.000Z",
          learningUnits: [{
            id: "U1",
            title: "Electric Potential, Gradient, and Energy Density",
            role: "formula",
            learningQuestion: "How does a scalar potential encode an electrostatic field, and how is stored energy distributed through that field?",
            prerequisiteConcepts: ["electric field"],
            newConcepts: ["electric potential", "gradient", "electric energy density"],
            sourceAnchors: [],
            sourceFigures: [],
            sourceFormulas: [],
            sourceTables: [],
            interactiveVisual: {
              id: spec.id,
              visualType: "metric_calculator",
              uniqueConcept: "electric potential and field energy",
              whyStaticSourceFigureIsNotEnough: "The learner changes field parameters and observes stored energy.",
              learnerManipulates: ["field strength"],
              expectedInsight: "field strength changes electric energy density",
              sourceAnchors: [],
              duplicateSignature: "legacy-snn-calculator",
            },
            interactiveVisualPlan: {
              decision: {
                unitId: "U1",
                pageId: "U1",
                necessity: "required",
                preferredMedium: "interactive_visual",
                learningGoal: "Relate electric potential, field gradient, and stored energy.",
                manipulationValue: 0.82,
                dynamicBehaviorValue: 0.78,
                comparisonValue: 0.76,
                spatialValue: 0.78,
                parameterSensitivityValue: 0.86,
                sourceFigureSufficiency: 0.05,
                proseSufficiency: 0.35,
                formulaSufficiency: 0.05,
                workedExampleSufficiency: 0.08,
                cognitiveLoadRisk: 0.2,
                duplicationRisk: 0,
                implementationRisk: 0.4,
                evidence: {
                  unitRole: "formula",
                  concepts: ["electric potential", "gradient", "electric energy density"],
                  learningQuestion: "How does potential encode the electric field?",
                  sourceAnchorIds: [],
                  nearbyVisualIntentIds: [],
                },
                reason: "The interaction is required to expose the parameter relationship.",
                recommendedVisualType: "metric_calculator",
              },
              requirement: "required",
              alternativeCoverage: "uncovered",
              visualIntent: {
                id: spec.id,
                visualType: "metric_calculator",
                uniqueConcept: "electric potential and field energy",
                whyStaticSourceFigureIsNotEnough: "The learner changes field parameters and observes stored energy.",
                learnerManipulates: ["field strength"],
                expectedInsight: "field strength changes electric energy density",
                sourceAnchors: [],
                duplicateSignature: "legacy-snn-calculator",
              },
            },
            teachingMediumPlan: {
              unitId: "U1",
              preferredMedium: "interactive_visual",
              reason: "A required parameter relationship needs interaction.",
            },
            zettelNotes: [],
            mustNotRepeat: [],
            expectedWordRange: [700, 900],
          }],
          sourceArtifactAssignments: [],
        }, null, 2),
      );
      fs.writeFileSync(
        path.join(lessonDir, "_index.md"),
        fm({ title: "1. Electric Potential", breadboardType: "textbook_section" }) + "# 1. Electric Potential\n",
      );
      fs.writeFileSync(
        path.join(lessonDir, "1.1 Electric Potential, Gradient, and Energy Density.md"),
        fm({
          title: "1.1 Electric Potential, Gradient, and Energy Density",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
          learningUnitId: "U1",
          learningUnitRole: "formula",
          visualIds: [spec.id],
          generatedBy: "learn_button",
        }) + `${FILLER("electric potential gradient and field energy", "metric")}\n\n${block(spec)}\n`,
      );

      const run = await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "electromagnetism" });
      const pagePath = fs.readdirSync(path.join(dir, "learning"), { recursive: true })
        .map(String)
        .find((rel) => rel.endsWith(".md") && fs.readFileSync(path.join(dir, "learning", rel), "utf-8").includes('learningUnitId: "U1"'));
      assert.ok(pagePath, "the learner page should remain present");
      const page = fs.readFileSync(path.join(dir, "learning", pagePath), "utf-8");
      assert.doesNotMatch(page, /breadboard-visual/);
      assert.doesNotMatch(page, /vis-electric-energy/);
      assert.equal(fs.existsSync(path.join(bb, "visuals", `${spec.id}.json`)), false);
      const contract = JSON.parse(fs.readFileSync(path.join(bb, "learning-unit-contract.json"), "utf-8"));
      assert.equal(contract.learningUnits[0].interactiveVisual, undefined);
      assert.match(run.finalizerNotes.join("\n"), /removed incompatible trusted visual/);
      assert.match(run.finalValidationFailures.join("\n"), /required interactive visual is missing/i);
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

  test("strict active-Learn finalization blocks missing recommended and optional visuals", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-strict-approved-visuals-"));
    try {
      const dir = path.join(root, "strict-visuals");
      const bb = path.join(dir, ".breadboard");
      const lessonDir = path.join(dir, "learning", "1. Approved Interactions");
      fs.mkdirSync(bb, { recursive: true });
      fs.mkdirSync(lessonDir, { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "Strict visuals" }) + "# Strict visuals\n");
      fs.writeFileSync(
        path.join(dir, "sources", "_index.md"),
        fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n",
      );
      fs.writeFileSync(path.join(bb, "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(bb, "visual-index.json"), "{}");

      const visualIntent = (id) => ({
        id,
        visualType: "generated_module",
        uniqueConcept: `${id} concept`,
        whyStaticSourceFigureIsNotEnough: "The learner must manipulate the relationship directly.",
        learnerManipulates: ["input"],
        expectedInsight: "Changing the input changes the observed relationship.",
        sourceAnchors: [],
        duplicateSignature: `${id}-signature`,
      });
      const unit = (id, requirement) => ({
        id,
        role: "core_concept",
        title: `${requirement} interaction`,
        learningQuestion: `How does the ${requirement} interaction behave?`,
        prerequisiteConcepts: [],
        newConcepts: [`${requirement} interaction`],
        sourceAnchors: [],
        sourceFigures: [],
        sourceFormulas: [],
        sourceTables: [],
        interactiveVisual: visualIntent(`visual-${id.toLowerCase()}`),
        interactiveVisualPlan: {
          decision: {
            unitId: id,
            pageId: id,
            necessity: requirement,
            preferredMedium: "interactive_visual",
            learningGoal: `Explore the ${requirement} relationship.`,
            evidence: {
              unitRole: "core_concept",
              concepts: [`${requirement} interaction`],
              learningQuestion: `How does the ${requirement} interaction behave?`,
              sourceAnchorIds: [],
              nearbyVisualIntentIds: [],
            },
            reason: "The model approved a source-grounded interaction.",
            recommendedVisualType: "generated_module",
          },
          requirement,
          alternativeCoverage: "covered",
          visualIntent: visualIntent(`visual-${id.toLowerCase()}`),
        },
        zettelNotes: [],
        mustNotRepeat: [],
        expectedWordRange: [700, 900],
      });
      fs.writeFileSync(
        path.join(bb, "learning-unit-contract.json"),
        JSON.stringify({
          learningUnits: [unit("U1", "recommended"), unit("U2", "optional")],
          sourceArtifactAssignments: [],
        }, null, 2),
      );
      fs.writeFileSync(
        path.join(lessonDir, "_index.md"),
        fm({ title: "1. Approved Interactions", breadboardType: "textbook_section" }) +
          "# 1. Approved Interactions\n",
      );
      for (const [index, requirement] of ["recommended", "optional"].entries()) {
        fs.writeFileSync(
          path.join(lessonDir, `1.${index + 1} ${requirement} interaction.md`),
          fm({
            title: `1.${index + 1} ${requirement} interaction`,
            knowledge_type: "learning-page",
            breadboardType: "learning_page",
            learningUnitId: `U${index + 1}`,
            generatedBy: "learn_button",
            interactiveVisualOmissionReason: "Alternative prose exists.",
          }) + lessonBody(`${requirement} interaction`, "basic_def"),
        );
      }

      const report = finalizeGardenExport({
        gardenDir: dir,
        gardenSlug: "strict-visuals",
        preserveModelAuthoredContent: true,
      });
      const failures = report.criticalProblems.join("\n");
      assert.match(failures, /model-approved recommended interactive visual is missing/i);
      assert.match(failures, /model-approved optional interactive visual is missing/i);
      const verification = verifyFinalArtifactNoMutation({
        gardenDir: dir,
        gardenSlug: "strict-visuals",
        updateRepairReport: false,
        strictModelApprovedVisuals: true,
      });
      assert.equal(verification.accepted, false);
      assert.match(
        verification.validationFailures.join("\n"),
        /model-approved (?:recommended|optional) interactive visual is missing/i,
      );
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
          { sourceVisualId: "S1.P6.E3", type: "equation", caption: "Total spike count summed over neurons and time steps", exactText: "N_{\\mathrm{spk}} = \\sum_{i,t} s_{i,t}" },
          { sourceVisualId: "S1.P6.E6", type: "equation", caption: "Convergence time as epoch reaching target accuracy", exactText: "e_* = \\min\\{e : A(e) >= A_{target}\\}" },
        ], null, 2),
      );
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");
      fs.writeFileSync(
        path.join(dir, ".breadboard", "learning-unit-contract.json"),
        JSON.stringify({
          learningUnits: [{
            id: "U1",
            title: "Spike Count and Energy",
            role: "metric",
            learningQuestion: "How is spike count measured?",
            prerequisiteConcepts: [],
            newConcepts: ["spike count"],
            sourceAnchors: ["S1.P6.E3"],
            sourceFigures: [],
            sourceFormulas: [{
              id: "S1.P6.E3",
              teachingGoal: "Define total spike count.",
              termsToDefine: ["spike count"],
              placement: "before_example",
            }],
            sourceTables: [],
            zettelNotes: [],
            mustNotRepeat: [],
            expectedWordRange: [100, 500],
          }],
          sourceArtifactAssignments: [{
            sourceArtifactId: "S1.P6.E3",
            assignedLearningUnitId: "U1",
            placement: "before_example",
            reason: "fixture",
            requiredInterpretation: "Define total spike count.",
          }],
        }, null, 2),
      );
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
          'learningUnitId: "U1"',
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

  test("adds role and reason metadata to multi-formula tradeoff anchors", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-tradeoff-anchor-roles-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, ".breadboard", "visuals"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "3. Metrics"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      const equations = [
        ["S1.P6.E1", "Classification accuracy as correct predictions over total predictions"],
        ["S1.P6.E2", "Latency as decision time minus stimulus input time"],
        ["S1.P6.E3", "Total spike count summed over neurons and time steps"],
        ["S1.P6.E4", "Total energy from spike energy and synaptic operation energy"],
        ["S1.P6.E5", "Normalized energy efficiency as accuracy over energy consumption"],
        ["S1.P6.E6", "Convergence time as minimum epoch reaching target accuracy"],
      ];
      fs.writeFileSync(
        path.join(dir, ".breadboard", "source-visuals.json"),
        JSON.stringify(equations.map(([sourceVisualId, caption]) => ({ sourceVisualId, type: "equation", caption })), null, 2),
      );
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), JSON.stringify({ "vis-tradeoff": { type: "tradeoff_explorer", title: "Metric tradeoff" } }, null, 2));
      const spec = {
        id: "vis-tradeoff",
        type: "tradeoff_explorer",
        title: "Accuracy, latency, energy, and spike-count tradeoff explorer",
        sourceAnchors: equations.map(([equationId, description]) => ({ equationId, description, sourceId: "source", page: 6 })),
        conceptTargets: ["accuracy", "latency", "energy", "spike count", "model comparison"],
        pedagogicalPurpose: "Let the learner compare accuracy, latency, spike count, energy, and normalized efficiency.",
        props: { priority: "balanced" },
        controls: [{ name: "priority", label: "Deployment priority", type: "select", options: ["accuracy", "latency", "energy", "balanced"], defaultValue: "balanced" }],
        inputs: ["deployment priority"],
        outputs: ["accuracy", "latency", "energy", "spike count"],
        caption: "Switch priorities to compare metric tradeoffs.",
        regenerationPrompt: "Improve this tradeoff explorer.",
        sourceGroundingStatus: "source-grounded",
        justification: "Anchored to source metric formulas.",
      };
      fs.writeFileSync(path.join(dir, ".breadboard", "visuals", "vis-tradeoff.json"), JSON.stringify(spec, null, 2));
      fs.writeFileSync(
        path.join(dir, "learning", "3. Metrics", "3.2 Spike Count and Energy.md"),
        fm({
          title: "3.2 Spike Count and Energy",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
          visualIds: ["vis-tradeoff"],
          sourceFormulaAnchors: equations.map(([id]) => id),
          generatedBy: "learn_button",
        }) + `${FILLER("accuracy latency spike count energy tradeoff", "metric")}\n\n${block(spec)}\n`,
      );

      await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
      finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      const out = fs.readFileSync(path.join(dir, "learning", "3. Metrics", "3.2 Spike Count and Energy.md"), "utf-8");
      assert.match(out, /"role": "comparison_basis"/);
      assert.match(out, /"reason": "This formula defines accuracy, one source metric used by the visual's tradeoff comparison\."/);
      const check55 = runChecks(dir, "test-2").find((result) => result.id === 55);
      assert.equal(check55.status, "PASS", check55.problems.join("\n"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("adds conceptual metadata for meaningful inline formulas when no formulas block exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-inline-formula-metadata-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "1. Events"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");
      fs.writeFileSync(
        path.join(dir, "learning", "1. Events", "1.3 Brain-Inspired Computation.md"),
        fm({ title: "1.3 Brain-Inspired Computation", knowledge_type: "learning-page", breadboardType: "learning_page", generatedBy: "learn_button" }) +
          `${FILLER("rate coding and spike timing", "basic_def")}\n\nA compact firing-rate helper is $r = \\frac{N}{T}$, where the count is divided by the window length.\n`,
      );

      finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      const out = fs.readFileSync(path.join(dir, "learning", "1. Events", "1.3 Brain-Inspired Computation.md"), "utf-8");
      assert.match(out, /formulas:/);
      assert.match(out, /text: "r = \\\\frac\{N\}\{T\}"/);
      assert.match(out, /groundingStatus: "conceptual-helper"/);
      const check25 = runChecks(dir, "test-2").find((result) => result.id === 25);
      assert.equal(check25.status, "PASS", check25.problems.join("\n"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("caps and de-duplicates harvested inline formulas so a math-heavy page passes Formula Metadata Noise", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-formula-noise-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "2. How SNNs Learn"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");
      // A surrogate-gradient page whose prose reuses the same helper repeatedly
      // and mentions many partial-derivative fragments — exactly the shape that
      // produced an 11-entry frontmatter block and blocked publishing.
      const mathProse = [
        "The weight update follows gradient descent: $$W_{\\text{new}} = w_{\\text{old}} - \\eta \\frac{\\partial L}{\\partial w}$$",
        "The chain rule expands as $$\\frac{\\partial L}{\\partial w} \\approx \\frac{\\partial L}{\\partial s}\\; g(u-\\theta)\\; \\frac{\\partial u}{\\partial w}$$",
        "The spike is a threshold decision $s = H(u - \\theta)$, and the surrogate slope is $g(u-\\theta)$.",
        "Each factor matters: $\\frac{\\partial L}{\\partial w}$ combines $\\frac{\\partial L}{\\partial s}$ with the surrogate $g(u-\\theta)$ and $\\frac{\\partial u}{\\partial w}$.",
        "Near threshold the argument $u-\\theta$ is small, so $g(u-\\theta)$ peaks and $\\frac{\\partial L}{\\partial s}$ carries the signal.",
      ].join("\n\n");
      fs.writeFileSync(
        path.join(dir, "learning", "2. How SNNs Learn", "2.2 Surrogate Gradient Training.md"),
        fm({ title: "2.2 Surrogate Gradient Training", knowledge_type: "learning-page", breadboardType: "learning_page", generatedBy: "learn_button" }) +
          `${FILLER("surrogate gradient training", "training")}\n\n${mathProse}\n`,
      );

      finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      const pagePath = path.join(dir, "learning", "2. How SNNs Learn", "2.2 Surrogate Gradient Training.md");
      const out = fs.readFileSync(pagePath, "utf-8");
      const entryCount = (out.match(/^ {2}- kind:/gm) ?? []).length;
      // Lineage compaction de-duplicates and stays under the noise ceiling (10).
      assert.ok(entryCount > 0 && entryCount <= 10, `expected a de-duplicated formula block, got ${entryCount} entries`);
      // The thrice-repeated surrogate slope collapses to a single entry.
      const surrogateEntries = (out.match(/text: "g\(u-\\\\theta\)"/g) ?? []).length;
      assert.equal(surrogateEntries, 1, "duplicate g(u-θ) must be de-duplicated to one entry");
      const check54 = runChecks(dir, "test-2").find((result) => result.id === 54);
      assert.equal(check54.status, "PASS", check54.problems.join("\n"));

      // Re-running finalize must not churn the compacted block (idempotent).
      const before = fs.readFileSync(pagePath, "utf-8");
      finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.equal(fs.readFileSync(pagePath, "utf-8"), before, "compacted formula block must be a fixed point");
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
        report.criticalProblems.some((problem) => /Section semantic coherence|Section Title Naturalness/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      // The metrics-only title that mismatched the training+metric units is
      // replaced by a purpose-coherent, topic-neutral one; folder/_index/H1 sync.
      assert.equal(fs.existsSync(path.join(dir, "learning", "2. The Metrics That Make SNNs Measurable")), false);
      const { folder, titleInFm, h1 } = sectionAfterRetitle(dir, "2.");
      assert.match(folder, /applied|method|training|evaluat|strateg/i);
      assert.equal(titleInFm, folder);
      assert.equal(h1, folder);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("retitles application/limitation sections away from a blacklisted metric title", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-app-section-retitle-"));
    try {
      const dir = path.join(root, "test-2");
      const bb = path.join(dir, ".breadboard");
      fs.mkdirSync(bb, { recursive: true });
      const sectionDir = "6. Measuring the Core Quantities";
      fs.mkdirSync(path.join(dir, "learning", sectionDir), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(path.join(bb, "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(bb, "visual-index.json"), "{}");
      fs.writeFileSync(
        path.join(bb, "learning-unit-contract.json"),
        JSON.stringify({
          learningUnits: [
            { id: "L", role: "limitation", title: "Limits of Conventional Neural Architectures", learningQuestion: "Where do dense networks fall short?", zettelNotes: [{ handle: "dense-networks-limit-energy-efficiency", claim: "Dense networks limit energy efficiency." }] },
            { id: "A", role: "application", title: "Neuromorphic Hardware and Deployment", learningQuestion: "Where do SNNs deploy?", zettelNotes: [{ handle: "neuromorphic-hardware-enables-low-power-deployment", claim: "Neuromorphic hardware enables low-power deployment." }] },
          ],
          sourceArtifactAssignments: [],
        }, null, 2),
      );
      fs.writeFileSync(
        path.join(dir, "learning", sectionDir, "_index.md"),
        fm({ title: "6. Measuring the Core Quantities", breadboardType: "textbook_section" }) +
          "# 6. Measuring the Core Quantities\n",
      );
      fs.writeFileSync(
        path.join(dir, "learning", sectionDir, "6.1 Limits of Conventional Neural Architectures.md"),
        fm({ title: "6.1 Limits of Conventional Neural Architectures", knowledge_type: "learning-page", breadboardType: "learning_page", learningUnitId: "L", generatedBy: "learn_button", tags: ["dense-networks-limit-energy-efficiency"] }) +
          `${FILLER("limits of conventional architectures", "challenges")}\n`,
      );
      fs.writeFileSync(
        path.join(dir, "learning", sectionDir, "6.3 Neuromorphic Hardware and Deployment.md"),
        fm({ title: "6.3 Neuromorphic Hardware and Deployment", knowledge_type: "learning-page", breadboardType: "learning_page", learningUnitId: "A", generatedBy: "learn_button", tags: ["neuromorphic-hardware-enables-low-power-deployment"] }) +
          `${FILLER("neuromorphic hardware deployment", "application")}\n`,
      );

      await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      // The blacklisted "Measuring the Core Quantities" metric title must be gone,
      // and no section coherence / naturalness problem may reach the gate.
      assert.equal(report.criticalProblems.some((p) => /Measuring the Core Quantities|Section semantic coherence|Section Title Naturalness/.test(p)), false, report.criticalProblems.join(" | "));
      assert.equal(fs.existsSync(path.join(dir, "learning", sectionDir)), false, "old blacklisted section folder should be renamed away");
      // Topic-neutral application/limitation title (no domain noun hardcoded).
      const { folder, titleInFm, h1 } = sectionAfterRetitle(dir, "6.");
      assert.match(folder, /application|applications|limits?|open questions|practical/i);
      assert.doesNotMatch(folder, /\bSNN|spiking|neuromorphic\b/i);
      assert.equal(titleInFm, folder);
      assert.equal(h1, folder);
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
        report.criticalProblems.some((problem) => /Section semantic coherence|Section Title Naturalness/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      // A formula/formalism section gets a formalism-purpose title.
      const { folder, titleInFm, h1 } = sectionAfterRetitle(dir, "2.");
      assert.match(folder, /formal|mathematical|describing|measur|equation/i);
      assert.equal(titleInFm, folder);
      assert.equal(h1, folder);
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
        report.criticalProblems.some((problem) => /Section semantic coherence|Section Title Naturalness/.test(problem)),
        false,
        report.criticalProblems.join(" | "),
      );
      assert.deepEqual(verification.mutatedFiles, []);
      // Metric+result section gets an evaluation/evidence-purpose title; sync.
      const { folder, titleInFm, h1 } = sectionAfterRetitle(dir, "5.");
      assert.match(folder, /measur|evaluat|results?|interpret|compar/i);
      assert.equal(titleInFm, folder);
      assert.equal(h1, folder);
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

  test("source-referenced worked examples stay conceptual without formula-meaning failures", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-worked-example-source-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "3. Metrics"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(
        path.join(dir, ".breadboard", "source-visuals.json"),
        JSON.stringify([{ sourceVisualId: "S1.P6.E1", type: "equation", caption: "Accuracy as correct predictions over total predictions", exactText: "\\text{Accuracy}=\\frac{N_{correct}}{N_{total}}" }], null, 2),
      );
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");
      fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({
        learningUnits: [{
          id: "U1", title: "Accuracy", role: "metric", learningQuestion: "How is accuracy computed?",
          prerequisiteConcepts: [], newConcepts: ["classification accuracy"], sourceAnchors: ["S1.P6.E1"],
          sourceFigures: [], sourceFormulas: [{ id: "S1.P6.E1", teachingGoal: "Define accuracy.", termsToDefine: ["accuracy"], placement: "before_example" }],
          sourceTables: [], zettelNotes: [], mustNotRepeat: [], expectedWordRange: [100, 500],
        }],
        sourceArtifactAssignments: [{ sourceArtifactId: "S1.P6.E1", assignedLearningUnitId: "U1", placement: "after_formula_introduction", reason: "fixture", requiredInterpretation: "Define accuracy." }],
      }, null, 2));
      fs.writeFileSync(
        path.join(dir, "learning", "3. Metrics", "3.1 Accuracy.md"),
        fm({
          title: "3.1 Accuracy",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
          generatedBy: "learn_button",
          learningUnitId: "U1",
        }) +
          `${FILLER("accuracy as a metric", "metric")}\n\n` +
          "$$\\text{Accuracy} = \\frac{\\text{number of correct predictions}}{\\text{total number of predictions}}$$\n\n" +
          "A worked check is $$\\frac{950}{1000} = 0.95 = 95\\%$$.\n",
      );

      const report = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      assert.doesNotMatch(report.criticalProblems.join("\n"), /matches source formula .*conceptual-helper/);
      const out = fs.readFileSync(path.join(dir, "learning", "3. Metrics", "3.1 Accuracy.md"), "utf-8");
      assert.match(out, /kind: "worked_example"/);
      assert.match(out, /groundingStatus: "conceptual-helper"/);
      assert.match(out, /basedOnFormula: "S1\.P6\.E1"/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("caps worked-example formula metadata when a result page has no source definitions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-worked-example-cap-"));
    try {
      const dir = path.join(root, "test-2");
      fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
      fs.mkdirSync(path.join(dir, "learning", "5. Results"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
      fs.writeFileSync(path.join(dir, "_index.md"), fm({ title: "test-2" }) + "# test-2\n");
      fs.writeFileSync(path.join(dir, "sources", "_index.md"), fm({ title: "Sources", breadboardType: "source_index" }) + "# Sources\n");
      fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]");
      fs.writeFileSync(path.join(dir, ".breadboard", "visual-index.json"), "{}");
      fs.writeFileSync(
        path.join(dir, "learning", "5. Results", "5.1 Energy per Inference.md"),
        fm({
          title: "5.1 Energy per Inference",
          knowledge_type: "learning-page",
          breadboardType: "learning_page",
          generatedBy: "learn_button",
          learningUnitId: "U1",
        }) +
          `${FILLER("energy per inference and spike count", "comparison")}\n\n` +
          "The worked reductions are $200 - 20 = 180$, $200 - 5 = 195$, and $195 \\div 200 = 0.975$.\n",
      );

      finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
      const out = fs.readFileSync(path.join(dir, "learning", "5. Results", "5.1 Energy per Inference.md"), "utf-8");
      const workedExamples = [...out.matchAll(/kind: "worked_example"/g)].length;
      assert.ok(workedExamples <= 2, `expected at most 2 worked examples, saw ${workedExamples}\n${out}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

/** Discover a retitled section folder by its number prefix and return the
 * folder name plus its _index frontmatter title and H1 for sync checks. */
function sectionAfterRetitle(dir, numberPrefix) {
  const folder = fs.readdirSync(path.join(dir, "learning")).find((entry) => entry.startsWith(numberPrefix));
  const index = fs.readFileSync(path.join(dir, "learning", folder, "_index.md"), "utf-8");
  return {
    folder,
    titleInFm: index.match(/^title:\s*"([^"]*)"/m)?.[1],
    h1: index.match(/^#\s+(.+?)\s*$/m)?.[1],
  };
}

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

// State-drift regression tests for the canonical FinalGardenState audit.
//
// Each test intentionally creates one class of state drift, proves the audit
// CATCHES it (these all slipped past the old per-artifact validators), then
// proves the drift can be reconciled away and the audit passes honestly.

import test, { describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFinalGardenState,
  auditFinalGardenState,
  reconcileFinalGardenState,
  projectSourceCoverage,
  formulaStructuralKind,
  zettelHandleNaturalnessReason,
  repeatedOpeningFindings,
  generateSectionSummary,
  isTemplateSectionSummary,
  isPlausibleSourceAnchorId,
  sanitizeSourceAnchorIds,
} from "../src/lib/final-garden-state.ts";

const REAL_GARDEN = fileURLToPath(new URL("../../quartz/content/test-2", import.meta.url));
const AVAILABLE = fs.existsSync(path.join(REAL_GARDEN, ".breadboard", "learning-unit-contract.json"));
const LIVE_GARDEN_ENABLED = /^(1|true|yes)$/i.test((process.env.BREADBOARD_TEST_LIVE_GARDEN ?? "").trim());
const skip = !LIVE_GARDEN_ENABLED
  ? "opt-in live-garden integration test; set BREADBOARD_TEST_LIVE_GARDEN=1 to run"
  : (AVAILABLE ? false : "real generated garden quartz/content/test-2 is not present");

const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf-8");
const write = (dir, rel, s) => fs.writeFileSync(path.join(dir, ...rel.split("/")), s, "utf-8");
const readJson = (dir, rel) => JSON.parse(read(dir, rel));
const writeJson = (dir, rel, obj) => write(dir, rel, `${JSON.stringify(obj, null, 2)}\n`);

// One clean, reconciled baseline whose audit passes; each test copies it and
// injects a single drift.
let BASELINE = null;
before(() => {
  if (!AVAILABLE) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-baseline-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(REAL_GARDEN, dir, { recursive: true });
  reconcileFinalGardenState(dir, "test-2");
  BASELINE = dir;
});

function freshCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-drift-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(BASELINE, dir, { recursive: true });
  return dir;
}

function audit(dir) {
  return auditFinalGardenState(buildFinalGardenState(dir, "test-2"));
}

function parseArrayFromFrontmatter(markdown, key) {
  const match = markdown.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, "m"));
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function tinyAnchorGarden({ invalid = "source caveats", valid = "S1.P1.energy-bottleneck" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-anchor-label-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".breadboard", "visuals"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Intro"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: [], sourceStructuralAnchors: [] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---
title: "Paper"
sourceId: "S1"
---

# Page 1

Energy bottleneck limits neuromorphic deployment because low-power systems must reduce energy consumption while preserving useful accuracy. This paragraph gives direct source text for the energy bottleneck concept in spiking neural networks.
`);
  fs.writeFileSync(path.join(dir, "learning", "_index.md"), `---
title: "Learning"
---

# Learning
`);
  fs.writeFileSync(path.join(dir, "learning", "1. Intro", "_index.md"), `---
title: "1. Intro"
---

# 1. Intro
`);
  fs.writeFileSync(path.join(dir, "learning", "1. Intro", "1.1 Limits.md"), `---
title: "Limits"
knowledge_type: "learning-page"
breadboardType: "learning_page"
generated_by: "learn_button"
learningUnitId: "U18"
learningUnitRole: "limitation"
tags: []
sourceAnchors: ["${invalid}", "${valid}"]
sourceFormulaAnchors: []
sourceVisualIds: []
visualIds: []
---

The supplied results have limits, but energy bottlenecks are the real source-grounded concept.
`);
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({
    learningUnits: [{
      id: "U18",
      title: "Limits",
      role: "limitation",
      sourceAnchors: [invalid, valid],
      sourceFigures: [],
      sourceFormulas: [],
      sourceTables: [],
      prerequisiteConcepts: [],
      newConcepts: ["limits"],
      zettelNotes: [
        { handle: "limits-bound-source-claims", claim: "Limits bound source claims.", connectedTo: [] },
        { handle: "energy-bottlenecks-shape-deployment", claim: "Energy bottlenecks shape deployment.", connectedTo: [] },
        { handle: "caveats-do-not-ground-evidence", claim: "Caveats do not ground evidence.", connectedTo: [] },
      ],
    }],
    sourceArtifactAssignments: [],
  }, null, 2) + "\n");
  return { dir, pageRel: "learning/1. Intro/1.1 Limits.md", invalid, valid };
}

/** All learner (subsection) page rels. */
function learnerPages(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.name.endsWith(".md") && e.name !== "_index.md") out.push(`learning/${r}`);
    }
  };
  walk(path.join(dir, "learning"), "");
  return out.sort();
}

describe("source anchor label sanitization", () => {
  test("invalid source anchor label fails shape validation", () => {
    assert.equal(isPlausibleSourceAnchorId("S1.P6.E5"), true);
    assert.equal(isPlausibleSourceAnchorId("S1.P1.energy-bottleneck"), true);
    assert.equal(isPlausibleSourceAnchorId("text-2510-27379v1-spike-timing-dependent-plasticity"), true);
    assert.equal(isPlausibleSourceAnchorId("source caveats"), false);
    const sanitized = sanitizeSourceAnchorIds(["source caveats", "S1.P1.energy-bottleneck"]);
    assert.deepEqual(sanitized.acceptedAnchorIds, ["S1.P1.energy-bottleneck"]);
    assert.equal(sanitized.rejectedLabels[0].reason, "planning_caveat");
  });

  test("invalid label is removed from page and contract and moved to sourceCaveats", () => {
    const { dir, pageRel } = tinyAnchorGarden();
    const before = audit(dir);
    assert.ok(before.byRule.invalid_anchor_label?.some((p) => p.includes("source caveats")), "invalid label is reported separately");
    assert.ok(before.byRule.anchor_resolution?.some((p) => p.includes("S1.P1.energy-bottleneck")), "valid missing anchor remains a registry problem");

    reconcileFinalGardenState(dir, "test-2");
    const page = read(dir, pageRel);
    assert.doesNotMatch(page, /sourceAnchors: \[[^\]]*source caveats/);
    assert.match(page, /sourceCaveats: \["source caveats"\]/);
    const contract = readJson(dir, ".breadboard/learning-unit-contract.json");
    const unit = contract.learningUnits.find((u) => u.id === "U18");
    assert.ok(!unit.sourceAnchors.includes("source caveats"));
    assert.ok(unit.sourceCaveats.includes("source caveats"));
  });

  test("invalid label is not registered as a canonical anchor", () => {
    const { dir } = tinyAnchorGarden();
    const anchors = readJson(dir, ".breadboard/source-anchors.json");
    anchors.sourceStructuralAnchors.push({ id: "source caveats", kind: "guidance", sourceId: "S1", title: "Source caveats", semanticSummary: "Bad label." });
    writeJson(dir, ".breadboard/source-anchors.json", anchors);
    const before = audit(dir);
    assert.ok(before.byRule.invalid_anchor_label?.some((p) => p.includes("registry") && p.includes("source caveats")));

    reconcileFinalGardenState(dir, "test-2");
    const afterLedger = readJson(dir, ".breadboard/source-anchors.json");
    assert.ok(!(afterLedger.sourceStructuralAnchors ?? []).some((a) => a.id === "source caveats"));
    assert.equal(buildFinalGardenState(dir, "test-2").sourceAnchors["source caveats"], undefined);
  });

  test("valid generated semantic anchor still registers from source evidence", () => {
    const { dir, valid } = tinyAnchorGarden();
    reconcileFinalGardenState(dir, "test-2");
    const state = buildFinalGardenState(dir, "test-2");
    assert.ok(state.sourceAnchors[valid], "valid generated semantic anchor registered");
    assert.equal(state.sourceAnchors[valid].confidence === "medium" || state.sourceAnchors[valid].confidence === "high", true);
    assert.equal(state.sourceAnchors["source caveats"], undefined);
    const after = audit(dir);
    assert.ok(!(after.byRule.invalid_anchor_label ?? []).length, "invalid labels cleared");
    assert.ok(!(after.byRule.anchor_resolution ?? []).some((p) => p.includes(valid)), "valid anchor resolves");
  });
});

describe("FinalGardenState canonical audit — state-drift regressions", { skip }, () => {
  test("baseline reconciled garden passes the audit", () => {
    const result = audit(BASELINE);
    assert.equal(result.ok, true, `baseline should be clean, got: ${result.problems.slice(0, 3).join(" | ")}`);
  });

  // 1. Page uses a formula anchor but Source Coverage says it is unused.
  test("1. formula anchor used by a page but marked unused in Source Coverage", () => {
    const dir = freshCopy();
    const state = buildFinalGardenState(dir, "test-2");
    const used = state.sourceUsages.find((u) => u.kind === "formula_definition" && /\.E\d+$/.test(u.anchorId));
    assert.ok(used, "expected a page-used formula anchor");
    // Rewrite that anchor's Reconciled line to claim it is unused / missing.
    let coverage = read(dir, ".breadboard/planning/Source Coverage.md");
    coverage = coverage.replace(new RegExp(`^- ${used.anchorId} \\(used\\):.*$`, "m"), `- ${used.anchorId} (unused): forced drift; used on: none`);
    write(dir, ".breadboard/planning/Source Coverage.md", coverage);

    const before = audit(dir);
    assert.ok(before.byRule.source_coverage?.some((p) => p.includes(used.anchorId)), `audit should flag ${used.anchorId} as wrongly unused`);

    // AFTER: regenerate coverage as a projection of the state.
    const fm = read(dir, ".breadboard/planning/Source Coverage.md").match(/^---\n[\s\S]*?\n---/)?.[0] ?? "";
    write(dir, ".breadboard/planning/Source Coverage.md", `${fm}\n\n${projectSourceCoverage(buildFinalGardenState(dir, "test-2"))}`);
    assert.ok(!(audit(dir).byRule.source_coverage ?? []).length, "projected coverage should clear the drift");
  });

  // 2. Visual JSON uses one anchor but Source Coverage claims three.
  test("2. Source Coverage over-claims a visual's anchors", () => {
    const dir = freshCopy();
    const state = buildFinalGardenState(dir, "test-2");
    const visual = state.visuals.find((v) => v.anchorIds.length >= 1);
    assert.ok(visual, "expected a visual with anchors");
    let coverage = read(dir, ".breadboard/planning/Source Coverage.md");
    // Append an over-claim into the interactive grounding section.
    coverage = coverage.replace(
      /## Used as Interactive Grounding\n\n/,
      `## Used as Interactive Grounding\n\n- S1.P8.G1: over-claim; used on ${visual.id}; visual source grounding\n`,
    );
    write(dir, ".breadboard/planning/Source Coverage.md", coverage);

    const before = audit(dir);
    assert.ok(before.byRule.source_coverage?.some((p) => p.includes("S1.P8.G1")), "audit should flag the over-claimed visual anchor");

    const fm = read(dir, ".breadboard/planning/Source Coverage.md").match(/^---\n[\s\S]*?\n---/)?.[0] ?? "";
    write(dir, ".breadboard/planning/Source Coverage.md", `${fm}\n\n${projectSourceCoverage(buildFinalGardenState(dir, "test-2"))}`);
    assert.ok(!(audit(dir).byRule.source_coverage ?? []).length, "projection clears the over-claim");
  });

  // 3. Page references a source anchor missing from the canonical registry.
  test("3. page references an anchor absent from the canonical registry", () => {
    const dir = freshCopy();
    const page = learnerPages(dir)[0];
    let md = read(dir, page);
    md = md.replace(/^sourceAnchors: \[([^\]]*)\]/m, `sourceAnchors: [$1, "S9.P9.Z9"]`);
    if (!/^sourceAnchors:/m.test(md)) md = md.replace(/^(title:.*)$/m, `$1\nsourceAnchors: ["S9.P9.Z9"]`);
    write(dir, page, md);

    const before = audit(dir);
    assert.ok(before.byRule.anchor_resolution?.some((p) => p.includes("S9.P9.Z9")), "audit should flag the unregistered anchor");

    // AFTER: register it in the canonical anchor ledger.
    const anchors = readJson(dir, ".breadboard/source-anchors.json");
    anchors.sourceTextConceptAnchors = anchors.sourceTextConceptAnchors ?? [];
    anchors.sourceTextConceptAnchors.push({ id: "S9.P9.Z9", sourceId: "x", kind: "concept", title: "Registered", semanticSummary: "now canonical", conceptKeywords: [], confidence: 0.5 });
    writeJson(dir, ".breadboard/source-anchors.json", anchors);
    // The audit resolves text- ids by ledger; register the non-text id form too.
    const st = buildFinalGardenState(dir, "test-2");
    assert.ok(st.sourceAnchors["S9.P9.Z9"], "anchor now in registry");
    assert.ok(!(audit(dir).byRule.anchor_resolution ?? []).some((p) => p.includes("S9.P9.Z9")), "registered anchor resolves");
  });

  test("3b. bare source-document slug references are rejected as invalid anchor labels", () => {
    const dir = freshCopy();
    const sourceName = fs.readdirSync(path.join(dir, "sources")).find((name) => name.endsWith(".md") && name !== "_index.md");
    assert.ok(sourceName, "expected a source document");
    const sourceSlug = path.basename(sourceName, ".md");
    const page = learnerPages(dir)[0];

    const anchors = readJson(dir, ".breadboard/source-anchors.json");
    anchors.sourceStructuralAnchors = (anchors.sourceStructuralAnchors ?? []).filter((anchor) => anchor.id !== sourceSlug);
    writeJson(dir, ".breadboard/source-anchors.json", anchors);

    let md = read(dir, page);
    md = /^sourceAnchors:/m.test(md)
      ? md.replace(/^sourceAnchors: \[([^\]]*)\]/m, `sourceAnchors: [$1, "${sourceSlug}"]`)
      : md.replace(/^(title:.*)$/m, `$1\nsourceAnchors: ["${sourceSlug}"]`);
    write(dir, page, md);

    const unitId = md.match(/^learningUnitId:\s*"?([^"\n]+)"?/m)?.[1];
    assert.ok(unitId, "expected learningUnitId");
    const contract = readJson(dir, ".breadboard/learning-unit-contract.json");
    const unit = contract.learningUnits.find((candidate) => candidate.id === unitId);
    assert.ok(unit, "expected matching contract unit");
    unit.sourceAnchors = [...new Set([...(unit.sourceAnchors ?? []), sourceSlug])];
    writeJson(dir, ".breadboard/learning-unit-contract.json", contract);

    const before = audit(dir);
    assert.ok(before.byRule.invalid_anchor_label?.some((p) => p.includes(sourceSlug)), "audit should flag the bare source document slug as an invalid anchor label");

    reconcileFinalGardenState(dir, "test-2");
    const state = buildFinalGardenState(dir, "test-2");
    assert.equal(state.sourceAnchors[sourceSlug], undefined, "source document slug should not be registered as a canonical anchor");
    const repairedPage = read(dir, page);
    const repairedPageAnchors = parseArrayFromFrontmatter(repairedPage, "sourceAnchors");
    const repairedContract = readJson(dir, ".breadboard/learning-unit-contract.json");
    const repairedUnit = repairedContract.learningUnits.find((candidate) => candidate.id === unitId);
    assert.ok(repairedUnit, "expected repaired matching contract unit");
    assert.ok(!repairedPageAnchors.includes(sourceSlug), "reconcile removes the bare slug from page sourceAnchors");
    assert.ok(!(repairedUnit.sourceAnchors ?? []).includes(sourceSlug), "reconcile removes the bare slug from contract sourceAnchors");
    const after = audit(dir);
    assert.ok(!(after.byRule.invalid_anchor_label ?? []).some((p) => p.includes(sourceSlug)), "reconciled bare source document slug is gone");
    assert.ok(!(after.byRule.anchor_resolution ?? []).some((p) => p.includes(sourceSlug)), "reconciled bare source document slug does not appear as an unresolved canonical anchor");
  });

  // 4. Page uses a real anchor its unit's contract does not sanction.
  test("4. page uses a text/formula anchor not allowed by its unit contract", () => {
    const dir = freshCopy();
    const state = buildFinalGardenState(dir, "test-2");
    // Find a page and an in-registry formula anchor NOT in its unit contract.
    const contract = readJson(dir, ".breadboard/learning-unit-contract.json");
    const unitById = new Map(contract.learningUnits.map((u) => [u.id, u]));
    let target = null;
    for (const page of state.pages) {
      const unit = unitById.get(page.learningUnitId);
      if (!unit) continue;
      const allowed = new Set([...(unit.sourceAnchors ?? []), ...(unit.sourceFormulas ?? []).map((f) => f.id)]);
      const foreign = Object.keys(state.sourceAnchors).find((id) => /\.E\d+$/.test(id) && !allowed.has(id));
      if (foreign) { target = { page, foreign }; break; }
    }
    assert.ok(target, "expected a page + foreign formula anchor");
    let md = read(dir, target.page.rel);
    md = md.replace(/^sourceAnchors: \[([^\]]*)\]/m, `sourceAnchors: [$1, "${target.foreign}"]`);
    write(dir, target.page.rel, md);

    const before = audit(dir);
    assert.ok(before.byRule.contract_page_anchor?.some((p) => p.includes(target.foreign)), "audit should flag the contract/page anchor drift");

    // AFTER: reconcile prunes anchors back to the contract.
    reconcileFinalGardenState(dir, "test-2");
    assert.ok(!(audit(dir).byRule.contract_page_anchor ?? []).length, "reconcile aligns page anchors with the contract");
  });

  // 5. A numeric worked example is mislabeled as a source definition.
  test("5. worked example mislabeled as source_definition", () => {
    assert.equal(formulaStructuralKind("\\text{Accuracy} = \\frac{190}{200} \\times 100\\% = 95\\%"), "worked_example");
    assert.equal(formulaStructuralKind("\\text{Accuracy} = \\frac{N_{correct}}{N_{total}}"), "definition");

    const dir = freshCopy();
    const page = learnerPages(dir).find((rel) => /formulas:/.test(read(dir, rel)) && /kind: "worked_example"/.test(read(dir, rel)));
    assert.ok(page, "expected a page with a worked-example formula");
    // Flip the worked example back to source_definition to recreate the drift.
    let md = read(dir, page);
    md = md.replace(/kind: "worked_example"/, `kind: "source_definition"`);
    write(dir, page, md);

    const before = audit(dir);
    assert.ok(before.byRule.formula_kind?.length, "audit should flag the mislabeled worked example");

    reconcileFinalGardenState(dir, "test-2");
    assert.ok(!(audit(dir).byRule.formula_kind ?? []).length, "reconcile relabels worked examples");
  });

  // 6. Section index contains generic "introduces the core idea" template.
  test("6. template section-index prose", () => {
    assert.equal(isTemplateSectionSummary("X introduces the core idea and connects it to the next learner-facing step."), true);
    const good = generateSectionSummary({ sectionTitle: "4. What the Results Show", childPageTitles: ["Accuracy and Energy Results", "Latency Results"], childUnitRoles: ["result_interpretation"], keySourceAnchors: [] });
    assert.equal(isTemplateSectionSummary(good), false);
    assert.ok(!/introduces the core idea|learner-facing step/i.test(good));

    const dir = freshCopy();
    const sectionName = fs.readdirSync(path.join(dir, "learning"), { withFileTypes: true })
      .find((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, "learning", entry.name, "_index.md")))?.name;
    assert.ok(sectionName, "expected a section index");
    const sectionIndex = `learning/${sectionName}/_index.md`;
    const md = read(dir, sectionIndex);
    const fm = md.match(/^---\n[\s\S]*?\n---/)?.[0] ?? "";
    write(dir, sectionIndex, `${fm}\n\n# ${sectionName}\n\n${sectionName} introduces the core idea and connects it to the next learner-facing step.\n`);

    const before = audit(dir);
    assert.ok(before.byRule.section_index_prose?.some((p) => p.includes(sectionIndex)), "audit should flag template section prose");

    reconcileFinalGardenState(dir, "test-2");
    assert.ok(!(audit(dir).byRule.section_index_prose ?? []).length, "reconcile regenerates section summaries");
  });

  // 7. Zettelkasten handle contains a blacklisted planner-scaffold phrase.
  test("7. template Zettelkasten handle", () => {
    assert.ok(zettelHandleNaturalnessReason("correct-prediction-rate-links-variables-to-a-measurable-claim"));
    assert.equal(zettelHandleNaturalnessReason("accuracy-measures-correctness-not-deployment-cost"), null);

    const dir = freshCopy();
    const contract = readJson(dir, ".breadboard/learning-unit-contract.json");
    const unit = contract.learningUnits[0];
    const bad = "spike-count-links-variables-to-a-measurable-claim";
    unit.zettelNotes[unit.zettelNotes.length - 1] = { handle: bad, claim: "drift", connectedTo: [] };
    writeJson(dir, ".breadboard/learning-unit-contract.json", contract);
    // Reflect the bad handle onto its page's tags.
    const page = learnerPages(dir).find((rel) => read(dir, rel).includes(`learningUnitId: "${unit.id}"`));
    if (page) {
      const md = read(dir, page).replace(/^tags: \[[^\]]*\]/m, `tags: ["${bad}", "a-real-durable-claim", "another-real-durable-claim"]`);
      write(dir, page, md);
    }

    const before = audit(dir);
    assert.ok(before.byRule.zettel_naturalness?.some((p) => p.includes(bad)), "audit should flag the template handle");

    reconcileFinalGardenState(dir, "test-2");
    assert.ok(!(audit(dir).byRule.zettel_naturalness ?? []).length, "reconcile naturalizes handles");
  });

  // 8. Two adjacent pages open with a paraphrased quiet-camera scenario.
  test("8. paraphrased repeated opening scenario", () => {
    const findings = repeatedOpeningFindings([
      { rel: "a", body: "Imagine a small camera watching a quiet hallway. Most of the time nothing moves." },
      { rel: "b", body: "Imagine a small camera sensor watching a quiet hallway at night. Most of the time nothing moves." },
    ]);
    assert.ok(findings.some((f) => f.severity === "fail"), "near-identical camera openings should fail");

    const dir = freshCopy();
    const pages = learnerPages(dir);
    const [p1, p2] = [pages[0], pages[1]];
    const setOpening = (rel, sentence) => {
      let md = read(dir, rel);
      const fm = md.match(/^---\n[\s\S]*?\n---\n?/)?.[0] ?? "";
      const body = md.slice(fm.length);
      const paras = body.replace(/^\n+/, "").split(/\n{2,}/);
      let idx = paras.findIndex((p) => p.trim() && !p.startsWith("#"));
      if (idx < 0) idx = 0;
      paras[idx] = sentence;
      write(dir, rel, fm + paras.join("\n\n"));
    };
    setOpening(p1, "Imagine a small camera watching a quiet hallway at night. Most of the time nothing moves inside the corridor. The camera waits quietly until some motion finally appears.");
    setOpening(p2, "Imagine a small camera sensor watching a quiet hallway at night. Most of the time nothing moves inside that corridor. The camera waits quietly until some motion finally appears.");

    const before = audit(dir);
    assert.ok(before.byRule.repeated_opening?.length, "audit should flag the paraphrased repeated opening");

    // AFTER: frame the second page as an explicit callback.
    setOpening(p2, "Recall the quiet hallway from the previous page. Building on that same earlier setting, we now turn to a completely different question about timing and precision.");
    assert.ok(!(audit(dir).byRule.repeated_opening ?? []).length, "a framed callback is allowed");
  });

  // 9. A unit_page repair log entry includes an unrelated visual file.
  test("9. repair log attributes an unrelated file to a unit repair", () => {
    const dir = freshCopy();
    const log = readJson(dir, ".breadboard/repair-log.json");
    const entry = (log.repairs ?? []).find((r) => r.pagePath && (r.targetKind === "unit_page" || !r.targetKind));
    assert.ok(entry, "expected a unit_page repair entry");
    entry.targetKind = "unit_page";
    entry.changedFiles = [entry.pagePath, ".breadboard/visuals/some-unrelated-visual.json"];
    writeJson(dir, ".breadboard/repair-log.json", log);

    const before = audit(dir);
    assert.ok(before.byRule.repair_provenance?.some((p) => p.includes("some-unrelated-visual.json")), "audit should flag the unrelated changed file");

    reconcileFinalGardenState(dir, "test-2");
    assert.ok(!(audit(dir).byRule.repair_provenance ?? []).length, "reconcile re-scopes repair provenance");
  });

  // 11 (Fix 3). Page and contract agree on the same wrong formula anchor, but
  // the formula's own math contradicts it (synchronized wrongness).
  test("11. formula grounded to a semantically incompatible anchor", () => {
    const dir = freshCopy();
    const state = buildFinalGardenState(dir, "test-2");
    // An accuracy source-definition formula grounded to its accuracy anchor.
    const target = state.formulas.find((f) => f.declaredKind === "source_definition"
      && f.sourceAnchor && state.sourceAnchors[f.sourceAnchor]?.formulaFamily === "accuracy");
    assert.ok(target, "expected an accuracy formula grounded to the accuracy anchor");
    const wrong = "S1.P6.E5"; // normalized energy efficiency — a different family
    let md = read(dir, target.pageRel);
    md = md.replace(new RegExp(`sourceAnchor: "${target.sourceAnchor.replace(/\./g, "\\.")}"`, "g"), `sourceAnchor: "${wrong}"`)
           .replace(new RegExp(`^sourceFormulaAnchors: \\["${target.sourceAnchor.replace(/\./g, "\\.")}"\\]`, "m"), `sourceFormulaAnchors: ["${wrong}"]`);
    write(dir, target.pageRel, md);

    const before = audit(dir);
    assert.ok(before.byRule.anchor_compatibility?.length, "audit must flag the semantically incompatible grounding");

    reconcileFinalGardenState(dir, "test-2");
    assert.ok(!(audit(dir).byRule.anchor_compatibility ?? []).length, "reconcile regrounds to the compatible source anchor");
  });

  // 12 (Fix 7). A used text anchor with no exactText while source text exists.
  test("12. generic text anchor while source paragraph exists", () => {
    const dir = freshCopy();
    const state = buildFinalGardenState(dir, "test-2");
    const usedTextId = state.sourceUsages.find((u) => u.kind === "text_concept")?.anchorId;
    assert.ok(usedTextId, "expected a used text anchor");
    const anchors = readJson(dir, ".breadboard/source-anchors.json");
    const rec = anchors.sourceTextConceptAnchors.find((a) => a.id === usedTextId);
    rec.exactText = null; // strip the specific source excerpt
    writeJson(dir, ".breadboard/source-anchors.json", anchors);

    const before = audit(dir);
    assert.ok(before.byRule.text_anchor_specificity?.some((p) => p.includes(usedTextId)), "audit must flag the generic text anchor");

    reconcileFinalGardenState(dir, "test-2");
    const after = buildFinalGardenState(dir, "test-2");
    assert.ok(after.sourceAnchors[usedTextId]?.exactText, "reconcile populates exactText from the source paragraph");
    assert.ok(!(audit(dir).byRule.text_anchor_specificity ?? []).length, "text-anchor specificity is restored");
  });

  // 13 (Fix 13). Debug failed-repairs shipped in the export.
  test("13. debug failed-repairs must not ship in the export", () => {
    const dir = freshCopy();
    const debugDir = path.join(dir, ".breadboard", "debug", "failed-repairs");
    fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(path.join(debugDir, "failed-1.md"), "a failed repair dump");
    fs.writeFileSync(path.join(debugDir, "failed-2.md"), "another failed repair dump");

    const before = audit(dir);
    assert.ok(before.byRule.debug_failed_repairs?.length, "audit must flag shipped debug failed-repairs");

    reconcileFinalGardenState(dir, "test-2");
    assert.ok(!fs.existsSync(debugDir), "reconcile removes the debug failed-repairs directory");
    assert.ok(!(audit(dir).byRule.debug_failed_repairs ?? []).length, "no debug failed-repairs remain");
  });

  // 10. Planning doc claims formulas are unavailable while anchors exist.
  test("10. planning caveat contradicts extracted formula anchors", () => {
    const dir = freshCopy();
    let map = read(dir, ".breadboard/planning/Source Map.md");
    map = map.replace(/^# Source Map/m, "# Source Map\n\nThe exact formulas including S1.P6.E1 are not visible in the provided content.\n");
    write(dir, ".breadboard/planning/Source Map.md", map);

    const before = audit(dir);
    assert.ok(before.byRule.planning_caveat?.some((p) => p.includes("S1.P6.E1")), "audit should flag the stale caveat");

    reconcileFinalGardenState(dir, "test-2");
    // Reconcile neutralizes the standard caveats; remove the injected extra line too.
    let fixed = read(dir, ".breadboard/planning/Source Map.md").replace(/^The exact formulas including S1\.P6\.E1 are not visible in the provided content\.$/m, "The page-6 formulas S1.P6.E1 to S1.P6.E6 were extracted and are taught on the metric pages.");
    write(dir, ".breadboard/planning/Source Map.md", fixed);
    assert.ok(!(audit(dir).byRule.planning_caveat ?? []).length, "reconciled caveats agree with extracted anchors");
  });
});

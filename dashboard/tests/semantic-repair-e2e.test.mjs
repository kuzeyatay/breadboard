// End-to-end proof that the contract-driven semantic repair loop actually runs
// on generated artifacts, not only on hand-built unit fixtures.
//
// The normal `test-2` run reports "0 failures / 0 repair requests" because the
// generated artifact is already clean. That proves nothing about the repair
// loop. This suite starts from that same real, accepted generated garden
// (quartz/content/test-2), injects ONE realistic semantic defect per fixture,
// and proves the full pipeline for each:
//
//   before repair : validation fails on the injected defect
//   repair        : UnitRepairRequest objects are generated (except the
//                   finalize-owned stale-caveat fixture, see fixture 5)
//   repair        : the repair loop rewrites only the affected pages/contracts
//   finalize      : the deterministic export gate runs after repair
//   verify        : no-mutation verification passes and Accepted: yes
//   provenance    : repair-log.json / repair-report.md record the repair
//
// The affected-file assertions use a byte-level snapshot diff against the clean
// baseline (the authoritative "what actually changed"), not the repair loop's
// self-reported list.

import test, { describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  finalizeGardenExport,
  repairLearningUnitsFromContract,
  verifyFinalArtifactNoMutation,
} from "../src/lib/garden-finalize.ts";

const REAL_GARDEN = fileURLToPath(new URL("../../quartz/content/test-2", import.meta.url));
const GARDEN_AVAILABLE = fs.existsSync(path.join(REAL_GARDEN, ".breadboard", "learning-unit-contract.json"));
const skip = GARDEN_AVAILABLE ? false : "real generated garden quartz/content/test-2 is not present";

// Files that legitimately change every run (the reports/logs themselves).
const VOLATILE = /^\.breadboard\/(validation-report\.md|repair-report\.md|repair-log\.json)$/;

// ---------------------------------------------------------------------------
// Baseline copy + snapshot helpers
// ---------------------------------------------------------------------------

/** Copy the real generated garden into a temp dir, dropping regenerable noise
 * (backups/debug/event log and any prior repair artifacts) so the baseline is
 * the pure accepted artifact. */
function freshGarden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-e2e-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(REAL_GARDEN, dir, { recursive: true });
  for (const noise of ["backups", "debug", "events.jsonl", "repair-log.json", "repair-report.md"]) {
    fs.rmSync(path.join(dir, ".breadboard", noise), { recursive: true, force: true });
  }
  return { root, dir };
}

function snapshot(dir) {
  const out = new Map();
  const walk = (d, rel) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(d, entry.name), r);
      else out.set(r, fs.readFileSync(path.join(d, entry.name)));
    }
  };
  walk(dir, "");
  return out;
}

/** Repo-relative posix paths whose bytes differ from the clean baseline,
 * excluding the volatile report/log files. */
function changedSince(baseline, dir) {
  const after = snapshot(dir);
  const changed = [];
  for (const [rel, buf] of after) {
    if (VOLATILE.test(rel)) continue;
    if (!baseline.has(rel) || !baseline.get(rel).equals(buf)) changed.push(rel);
  }
  for (const rel of baseline.keys()) {
    if (VOLATILE.test(rel) || after.has(rel)) continue;
    changed.push(`(deleted) ${rel}`);
  }
  return changed.sort();
}

const P = (dir, rel) => path.join(dir, ...rel.split("/"));
const read = (dir, rel) => fs.readFileSync(P(dir, rel), "utf-8");
const write = (dir, rel, s) => fs.writeFileSync(P(dir, rel), s, "utf-8");

/**
 * Drive a single degraded-artifact fixture end-to-end and return every
 * observable the assertions need.
 *
 * @param mutate (dir) => void   introduces exactly one semantic defect
 */
async function runFixture(mutate) {
  const { root, dir } = freshGarden();
  try {
    const baseline = snapshot(dir);
    mutate(dir);
    // The repair loop grades itself with firstValidationFailures (pre-repair)
    // and finalValidationFailures (post-repair) and emits UnitRepairRequests.
    const run = await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
    // Deterministic export gate runs AFTER repair.
    const finalize = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
    // No-mutation + honest-acceptance verification.
    const verify = verifyFinalArtifactNoMutation({ gardenDir: dir, gardenSlug: "test-2" });
    const affected = changedSince(baseline, dir);
    // Capture the post-pipeline tree so assertions can inspect files after the
    // temp dir is removed.
    const final = snapshot(dir);
    const readFinal = (rel) => {
      const buf = final.get(rel);
      if (!buf) throw new Error(`file not present after pipeline: ${rel}`);
      return buf.toString("utf-8");
    };
    const repairLog = JSON.parse(readFinal(".breadboard/repair-log.json"));
    const repairReport = readFinal(".breadboard/repair-report.md");
    const validationReport = readFinal(".breadboard/validation-report.md");
    return { affected, run, finalize, verify, repairLog, repairReport, validationReport, readFinal };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Assertions shared by every fixture whose defect is repaired to acceptance. */
function assertHealedAndAccepted(ctx, { defect }) {
  // before repair: validation fails on the injected defect
  assert.ok(
    ctx.run.firstValidationFailures.some((f) => defect.test(f)),
    `pre-repair validation must fail on the injected defect; saw:\n${ctx.run.firstValidationFailures.join("\n")}`,
  );
  // after repair: the defect is gone from the post-repair validation
  assert.ok(
    !ctx.run.finalValidationFailures.some((f) => defect.test(f)),
    `post-repair validation must no longer report the defect; saw:\n${ctx.run.finalValidationFailures.join("\n")}`,
  );
  // finalize did not have to hard-fail anything
  assert.deepEqual(ctx.finalize.criticalProblems, [], "finalize must report no critical problems after repair");
  // no-mutation verification passes and the artifact is accepted honestly
  assert.equal(ctx.verify.accepted, true, "final artifact must be accepted");
  assert.deepEqual(ctx.verify.mutatedFiles, [], "no-mutation verification must pass");
  assert.deepEqual(ctx.verify.validationFailures, [], "no validation failures may remain");
  assert.equal(ctx.verify.validationReportAccepted, true);
  assert.match(ctx.validationReport, /^Accepted:\s+yes$/m, "validation-report.md must record Accepted: yes");
  // repair-log.json contains structured repair provenance
  assert.equal(ctx.repairLog.gardenSlug, "test-2");
  assert.ok(ctx.repairLog.finalVerification, "repair-log.json must embed final verification");
  assert.equal(ctx.repairLog.finalVerification.accepted, true);
  // repair-report.md records honest acceptance
  assert.match(ctx.repairReport, /## Final Verification/);
  assert.match(ctx.repairReport, /Accepted: yes/);
  assert.match(ctx.repairReport, /No-mutation check: pass/);
}

// ---------------------------------------------------------------------------
// Fixture 1: repeated opening
// ---------------------------------------------------------------------------
// The same opening motivation scenario (the framing motif) is injected into
// three later learner pages. Page 1.1 already opens with this framing as the
// legitimate first occurrence, so the garden-wide repeated-opening check names
// all four; the repair keeps 1.1 and rewrites the three later duplicates.
const REPEAT_MOTIF =
  "Picture a battery-powered robot moving through a quiet hallway: a dense ANN keeps recomputing every frame while a silent SNN waits for events before doing any work.";
const FIRST_MOTIF_PAGE = "learning/1. Why SNNs Need Events/1.1 Why Spiking Neural Networks Exist.md";
const LATER_MOTIF_PAGES = [
  "learning/5. What the Results Show/5.3 Energy and Spike Count Comparisons.md",
  "learning/6. Where SNNs Fit and What Still Blocks Adoption/6.3 Applications That Fit Spiking Neural Networks.md",
  "learning/6. Where SNNs Fit and What Still Blocks Adoption/6.4 Limits of Current Spiking Neural Networks.md",
];

// ---------------------------------------------------------------------------
// Fixture 2: wrong formula grounding
// ---------------------------------------------------------------------------
// The latency formula (source anchor E2) is remapped onto the energy-efficiency
// anchor (E5) in both the declared anchors and the per-formula metadata.
const LATENCY_PAGE = "learning/2. Measuring Accuracy, Latency, and Spike Count/2.2 Latency as Time to Decision.md";

// ---------------------------------------------------------------------------
// Fixture 3: overbroad metric visual grounding
// ---------------------------------------------------------------------------
// The single-metric (accuracy) calculator on page 2.1 gets ALL six metric
// formula anchors attached, with no per-anchor roles/reasons.
const ACCURACY_PAGE = "learning/2. Measuring Accuracy, Latency, and Spike Count/2.1 Accuracy as Correct Decisions.md";
const ACCURACY_VISUAL = ".breadboard/visuals/vis-2-1-accuracy-as-correct-decisions-metric.json";
const METRIC_CAPTIONS = {
  1: "Accuracy as correct predictions over total predictions",
  2: "Latency as decision time minus stimulus time",
  3: "Total spike count summed across neurons and time steps",
  4: "Total energy from spike and synaptic operation costs",
  5: "Normalized energy efficiency as accuracy per joule",
  6: "Convergence time as minimum epoch reaching target accuracy",
};

// ---------------------------------------------------------------------------
// Fixture 4: bad Zettelkasten handles
// ---------------------------------------------------------------------------
// Unit U7's good handles (and its page's synced tags) are replaced with the
// template-like scaffold handles the validator rejects.
const BAD_HANDLES = [
  "records-the-source-relationship",
  "states-what-the-reported-result-supports",
  "identifies-the-source-problem",
];
const CONTRACT = ".breadboard/learning-unit-contract.json";

// ---------------------------------------------------------------------------
// Fixture 5: stale source-map caveat
// ---------------------------------------------------------------------------
const SOURCE_MAP = ".breadboard/planning/Source Map.md";

// ---------------------------------------------------------------------------
// Fixture 6: section title mismatch
// ---------------------------------------------------------------------------
// The results section (5. What the Results Show, all result_interpretation
// units) is retitled to a metric/formula-definition title, creating a
// folder/title mismatch and a section-role mismatch.
const RESULTS_INDEX = "learning/5. What the Results Show/_index.md";

describe("semantic repair loop end-to-end on degraded generated artifacts", () => {
  before(() => {
    if (!GARDEN_AVAILABLE) {
      // Surfaced once so a missing content tree is obvious, not silently green.
      console.warn(`[semantic-repair-e2e] SKIPPED: ${skip}`);
    }
  });

  test("fixture 1: repeated opening is caught, later duplicates rewritten, first kept", { skip }, async () => {
    const ctx = await runFixture((dir) => {
      for (const rel of LATER_MOTIF_PAGES) {
        write(dir, rel, read(dir, rel).replace(/(\n#{1,3} [^\n]+\n\n)/, `$1${REPEAT_MOTIF}\n\n`));
      }
    });

    assertHealedAndAccepted(ctx, { defect: /repeated .*intro motif/i });

    // repair requests were generated and target the repeated pages
    assert.ok(ctx.run.requests.length > 0, "UnitRepairRequests must be generated");
    const requestPaths = new Set(ctx.run.requests.map((r) => r.pagePath));
    for (const rel of LATER_MOTIF_PAGES) assert.ok(requestPaths.has(rel), `expected a repair request for ${rel}`);
    for (const r of ctx.run.requests) assert.ok(r.failureTypes.includes("repeated_opening"));

    // repair rewrote only the four motif pages (three duplicates + first)
    assert.deepEqual(ctx.affected, [FIRST_MOTIF_PAGE, ...LATER_MOTIF_PAGES].sort());

    // the three later duplicate openings lost the motif; the first occurrence kept it
    for (const rel of LATER_MOTIF_PAGES) {
      assert.doesNotMatch(ctx.readFinal(rel), /battery-powered robot moving through a quiet hallway/i, `${rel} opening must be rewritten`);
    }
    assert.match(ctx.readFinal(FIRST_MOTIF_PAGE), /quiet hallway/i, "the first page keeps its canonical framing");

    // repair report lists the affected units/pages
    for (const rel of LATER_MOTIF_PAGES) assert.ok(ctx.repairReport.includes(rel));
    assert.ok(ctx.repairLog.repairs.every((r) => r.result === "resolved"));
  });

  test("fixture 2: wrong formula grounding is caught and regrounded to the right anchor", { skip }, async () => {
    const ctx = await runFixture((dir) => {
      let s = read(dir, LATENCY_PAGE);
      s = s
        .replace(/sourceFormulaAnchors: \["S1\.P6\.E2"\]/, 'sourceFormulaAnchors: ["S1.P6.E5"]')
        .replace(/sourceAnchor: "S1\.P6\.E2"/g, 'sourceAnchor: "S1.P6.E5"')
        .replace(/sourceAnchorTitle: "S1\.P6\.E2[^"]*"/g, 'sourceAnchorTitle: "S1.P6.E5 equation Normalized energy efficiency as accuracy per joule"');
      write(dir, LATENCY_PAGE, s);
    });

    assertHealedAndAccepted(ctx, { defect: /2\.2 Latency.*S1\.P6\.E5|grounded to S1\.P6\.E5/ });

    // the repair request carries source anchor, page path, current formula
    // record, and the expected formula family (per the task spec)
    assert.ok(ctx.run.requests.length > 0);
    const req = ctx.run.requests.find((r) => r.pagePath === LATENCY_PAGE && r.failureTypes.includes("formula_grounding"));
    assert.ok(req, "a formula-grounding repair request must target the latency page");
    assert.equal(req.pagePath, LATENCY_PAGE);
    assert.ok(req.sourceAnchors.length > 0, "request must carry source anchors");
    assert.match(req.currentPageMarkdown, /\\text\{Latency\}/, "request must include the current formula record");
    assert.ok(
      req.validationErrors.some((e) => /formula family|S1\.P6\.E5|S1\.P6\.E2/.test(e)),
      "request must reference the mismatched formula family/anchor",
    );

    // repair touched only the latency page
    assert.deepEqual(ctx.affected, [LATENCY_PAGE]);

    // page metadata + body agree: latency formula regrounded to E2, E5 gone
    const out = ctx.readFinal(LATENCY_PAGE);
    assert.match(out, /sourceFormulaAnchors: \["S1\.P6\.E2"\]/, "latency must reground to E2");
    assert.match(out, /sourceAnchor: "S1\.P6\.E2"/);
    assert.doesNotMatch(out, /S1\.P6\.E5/, "the wrong energy-efficiency anchor must be gone");
    assert.match(out, /\\text\{Latency\}/, "the latency formula stays in the body");
  });

  test("fixture 3: overbroad metric visual anchors are narrowed to the minimal sufficient set", { skip }, async () => {
    const ctx = await runFixture((dir) => {
      const extra = [1, 2, 3, 4, 5, 6]
        .map((n) => `        {
          "description": "${METRIC_CAPTIONS[n]}",
          "sourceId": "2510-27379v1",
          "page": 6,
          "equationId": "S1.P6.E${n}"
        }`)
        .join(",\n");
      const s = read(dir, ACCURACY_PAGE).replace(
        /("sourceAnchors": \[)([\s\S]*?)(\n  \],\n  "conceptTargets")/,
        `$1\n${extra}\n      $3`,
      );
      write(dir, ACCURACY_PAGE, s);
    });

    assertHealedAndAccepted(ctx, { defect: /unrelated formula anchors|lacks a valid role|lacks a specific role reason/i });

    // the repair request targets the page's visual grounding
    assert.ok(ctx.run.requests.length > 0);
    const req = ctx.run.requests.find((r) => r.pagePath === ACCURACY_PAGE);
    assert.ok(req && req.failureTypes.includes("visual_grounding"));

    // repair confined to the page (and, if re-synced, its own visual spec)
    for (const rel of ctx.affected) {
      assert.ok(rel === ACCURACY_PAGE || rel === ACCURACY_VISUAL, `unexpected file touched: ${rel}`);
    }
    assert.ok(ctx.affected.includes(ACCURACY_PAGE));

    // the final visual keeps only the accuracy anchor, with an explicit role+reason
    const out = ctx.readFinal(ACCURACY_PAGE);
    assert.doesNotMatch(out, /S1\.P6\.E2|S1\.P6\.E3|S1\.P6\.E4|S1\.P6\.E5|S1\.P6\.E6/, "unrelated metric anchors must be dropped");
    assert.match(out, /"equationId": "S1\.P6\.E1"/, "the accuracy anchor is retained");
    assert.match(out, /"role":\s*"output_formula"/, "the retained anchor has a role");
  });

  test("fixture 4: bad Zettelkasten handles are repaired in the contract, then synced to page tags", { skip }, async () => {
    const ctx = await runFixture((dir) => {
      const contract = JSON.parse(read(dir, CONTRACT));
      const u7 = contract.learningUnits.find((u) => u.id === "U7");
      u7.zettelNotes = BAD_HANDLES.map((h) => ({ handle: h, claim: h.replace(/-/g, " "), connectedTo: [] }));
      write(dir, CONTRACT, JSON.stringify(contract, null, 2));
      // Degrade the page tags to match the bad contract handles.
      write(dir, ACCURACY_PAGE, read(dir, ACCURACY_PAGE).replace(/tags: \[[^\]]*\]/, `tags: [${BAD_HANDLES.map((h) => `"${h}"`).join(", ")}]`));
    });

    assertHealedAndAccepted(ctx, { defect: /zettel handle .* sounds like planner scaffolding/i });

    assert.ok(ctx.run.requests.length > 0);
    assert.ok(ctx.run.requests.some((r) => r.failureTypes.includes("zettelkasten_handle")));

    // repair updated the contract first, then the page — and nothing else
    assert.deepEqual(ctx.affected, [CONTRACT, ACCURACY_PAGE].sort());

    // repair updated the CONTRACT first: no scaffold handle survives there
    const contract = JSON.parse(ctx.readFinal(CONTRACT));
    const u7 = contract.learningUnits.find((u) => u.id === "U7");
    const repairedHandles = u7.zettelNotes.map((n) => n.handle);
    for (const bad of BAD_HANDLES) assert.ok(!repairedHandles.includes(bad), `bad contract handle ${bad} must be gone`);
    // and the page tags no longer carry any scaffold handle
    const page = ctx.readFinal(ACCURACY_PAGE);
    for (const bad of BAD_HANDLES) assert.ok(!page.includes(bad), `bad page tag ${bad} must be gone`);
    // Acceptance already guarantees "tags equal contract handles" (the
    // Learning Unit Contract fulfillment check enforces exact equality and no
    // generic fallback tags), so a green verify.accepted proves the sync.
    assert.equal(ctx.verify.accepted, true);
    // the repaired handles are source-specific atomic claims, not scaffolding
    assert.ok(repairedHandles.length >= 3);
    for (const h of repairedHandles) {
      assert.match(h, /^[a-z0-9]+(?:-[a-z0-9]+)+$/, `handle ${h} must be a slash-free atomic claim`);
    }
  });

  test("fixture 5: stale source-map caveat is caught and reconciled by the finalizer", { skip }, async () => {
    const ctx = await runFixture((dir) => {
      write(
        dir,
        SOURCE_MAP,
        read(dir, SOURCE_MAP) +
          "\n## Caveats\n\n- Only pages 1-2 are available in full text.\n- Formula captions are available but exact notation is unavailable.\n",
      );
    });

    // before repair: validation catches the contradicted caveat
    assert.ok(
      ctx.run.firstValidationFailures.some((f) => /stale caveat|later pages|formulas.*unavailable/i.test(f)),
      `pre-repair validation must catch the stale caveat; saw:\n${ctx.run.firstValidationFailures.join("\n")}`,
    );

    // This defect is not per-unit, so it is reconciled deterministically by the
    // finalizer (caveat sanitation), NOT via a UnitRepairRequest. That is the
    // documented exception to "requests > 0".
    assert.equal(ctx.run.requests.length, 0, "stale-caveat reconciliation is finalize hygiene, not a unit repair");
    assert.ok(ctx.finalize.changed.includes(SOURCE_MAP), "finalize must rewrite the Source Map");

    // after the pipeline: caveat gone, artifact accepted, no mutation
    const out = ctx.readFinal(SOURCE_MAP);
    assert.doesNotMatch(out, /Only pages 1-2 are available in full text/i);
    assert.doesNotMatch(out, /exact notation is unavailable/i);
    assert.deepEqual(ctx.affected, [SOURCE_MAP], "only the Source Map was reconciled");
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
    assert.match(ctx.validationReport, /^Accepted:\s+yes$/m);
  });

  test("fixture 6: section title/role mismatch is caught and retitled to match its units", { skip }, async () => {
    const ctx = await runFixture((dir) => {
      let s = read(dir, RESULTS_INDEX);
      s = s
        .replace(/title: "5\. What the Results Show"/, 'title: "5. Accuracy Formula Definition"')
        .replace(/^# 5\. What the Results Show$/m, "# 5. Accuracy Formula Definition");
      write(dir, RESULTS_INDEX, s);
    });

    assertHealedAndAccepted(ctx, { defect: /does not match _index title|SECTION_SEMANTIC_MISMATCH/i });

    assert.ok(ctx.run.requests.length > 0);
    assert.ok(ctx.run.requests.some((r) => r.failureTypes.includes("section_semantics")));

    // every repaired file lives under the results section; nothing outside it
    for (const rel of ctx.affected) {
      assert.ok(rel.startsWith("learning/5. What the Results Show/"), `unexpected file touched: ${rel}`);
    }
    for (const rel of ctx.run.changedFiles) {
      assert.ok(rel.startsWith("learning/5. What the Results Show/"), `repair log lists file outside the section: ${rel}`);
    }

    // section title/H1 realigned with its result_interpretation units; folder now matches
    const index = ctx.readFinal(RESULTS_INDEX);
    assert.match(index, /title: "5\. What the Results Show"/, "section retitled to match its units");
    assert.match(index, /^# 5\. What the Results Show$/m);
    assert.doesNotMatch(index, /Accuracy Formula Definition/);
  });

  test("baseline sanity: the un-degraded generated garden yields zero repair requests and stays accepted", { skip }, async () => {
    // Proves the fixtures are what exercise the loop: with no defect injected,
    // the same pipeline produces 0 requests and remains accepted (this is the
    // "0 failures / 0 repair requests" state the task warns is NOT proof).
    const ctx = await runFixture(() => {});
    assert.equal(ctx.run.requests.length, 0, "clean artifact must generate no repair requests");
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.affected, [], "clean artifact must not be modified by the repair loop");
  });
});

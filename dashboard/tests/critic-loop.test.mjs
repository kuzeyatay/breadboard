// End-stage ChatMock critic loop tests. A programmable FAKE critic stands in for
// ChatMock: it returns structured issues per round so we can exercise the loop's
// catch -> repair-request -> re-review -> acceptance behavior deterministically.

import test, { describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileFinalGardenState } from "../src/lib/final-garden-state.ts";
import {
  runCriticLoop,
  buildCriticReviewPacket,
  criticIssuesToRepairRequests,
  parseCriticIssues,
  createChatMockCritic,
  createChatMockModelRepair,
  makeCriticArtifactRepair,
  computeIssueResolutions,
  parseModelRepairOutput,
  DEFAULT_CRITIC_LOOP_OPTIONS,
  writeCriticReports,
} from "../src/lib/critic-loop.ts";
import { buildFinalGardenState } from "../src/lib/final-garden-state.ts";

const REAL_GARDEN = fileURLToPath(new URL("../../quartz/content/test-2", import.meta.url));
const AVAILABLE = fs.existsSync(path.join(REAL_GARDEN, ".breadboard", "learning-unit-contract.json"));
const LIVE_GARDEN_ENABLED = /^(1|true|yes)$/i.test((process.env.BREADBOARD_TEST_LIVE_GARDEN ?? "").trim());
const skip = !LIVE_GARDEN_ENABLED
  ? "opt-in live-garden integration test; set BREADBOARD_TEST_LIVE_GARDEN=1 to run"
  : (AVAILABLE ? false : "real generated garden quartz/content/test-2 is not present");

let BASELINE = null;
before(() => {
  if (!AVAILABLE) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-critic-base-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(REAL_GARDEN, dir, { recursive: true });
  reconcileFinalGardenState(dir, "test-2");
  BASELINE = dir;
});

function freshCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-critic-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(BASELINE, dir, { recursive: true });
  return dir;
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf-8");

const issue = (over) => ({
  id: "i1",
  severity: "blocking",
  type: "other",
  problem: "a semantic problem",
  evidence: "evidence text",
  expected: "expected state",
  repairTarget: "global",
  suggestedRepair: "fix it",
  ...over,
});

function mkTinyGarden(prefix = "bb-critic-tiny-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Metrics"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({
    sourceTextConceptAnchors: [],
    sourceStructuralAnchors: [],
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  return dir;
}

/** A critic that returns a fixed set of issues on every round. */
const constantCritic = (issues) => () => issues;
/** A critic that returns issues[round-1] (empty after list exhausts). */
function statefulCritic(perRound) {
  let round = 0;
  return () => perRound[round++] ?? [];
}
/** Repair that does nothing (isolates loop mechanics from real repair). */
const noopRepair = () => ({ attempted: 0, resolved: 0 });
/** Repair that reports it attempted the requests but resolved none. */
const countingRepair = (calls) => (dir, slug, requests) => { calls.push(requests); return { attempted: requests.length, resolved: 0 }; };

describe("targeted critic metadata repairs", () => {
  test("worked_example_misclassified repairs metadata and inserts symbolic source definition", async () => {
    const dir = mkTinyGarden();
    const pageRel = "learning/1. Metrics/1.1 Efficiency.md";
    fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), JSON.stringify([
      {
        sourceVisualId: "S1.P6.E5",
        type: "equation",
        caption: "Normalized energy efficiency equals accuracy divided by energy.",
        pageNumber: 6,
        sourceId: "S1",
      },
    ], null, 2) + "\n");
    fs.writeFileSync(path.join(dir, ...pageRel.split("/")), `---
title: "Efficiency"
knowledge_type: "learning-page"
breadboardType: "learning_page"
generated_by: "learn_button"
learningUnitId: "U1"
sourceAnchors: []
sourceFormulaAnchors: ["S1.P6.E5"]
tags: []
formulas:
  - kind: "source_definition"
    text: "\\eta = \\frac{97.8}{15} \\approx 6.52"
    groundingStatus: "source-anchored"
    sourceAnchor: "S1.P6.E5"
    sourceAnchorTitle: "Normalized efficiency"
---

Numeric efficiency example.
`);
    const bad = issue({
      id: "wk1",
      type: "worked_example_misclassified",
      repairTarget: "unit_page",
      pagePath: pageRel,
      sourceAnchorIds: ["S1.P6.E5"],
      evidence: 'formulas[0] stores "\\eta = \\frac{97.8}{15} \\approx 6.52" as source_definition',
      suggestedRepair: "Move numeric arithmetic to worked_example and keep a symbolic source definition for S1.P6.E5.",
    });
    const requests = criticIssuesToRepairRequests([bad]);
    assert.equal(requests[0].formulaKindRepairs.length, 1);

    const repair = makeCriticArtifactRepair({ deterministicFinalize: () => {} });
    const outcome = await repair(dir, "test-2", requests, { round: 1, issuesById: new Map([[bad.id, bad]]) });
    assert.ok(outcome.provenance.some((p) => p.executorUsed === "deterministic" && p.changed));

    const md = read(dir, pageRel);
    assert.match(md, /kind: "source_definition"[\s\S]*sourceAnchor: "S1\.P6\.E5"/);
    assert.match(md, /\\\\eta_\{\\\\text\{efficiency\}\} = \\\\frac\{\\\\text\{Accuracy\}\}\{E_\{\\\\text\{energy\}\}\}/);
    const worked = md.match(/- kind: "worked_example"[\s\S]*?(?=\n  - kind:|\n---)/)?.[0] ?? "";
    assert.match(worked, /basedOnFormula: "S1\.P6\.E5"/);
    assert.doesNotMatch(worked, /sourceAnchor:/);
  });

  test("source_anchor_mismatch repairs wrong exactText from source prose", async () => {
    const dir = mkTinyGarden();
    const pageRel = "learning/1. Metrics/1.1 Hardware.md";
    const wrong = "Leaky integrate-and-fire neurons accumulate membrane potential until a threshold creates a spike event.";
    const right = "Neuromorphic hardware uses event-driven chips and specialized hardware circuits to run spiking neural networks with low-power asynchronous computation near the sensor.";
    fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---
title: "SNN Paper"
sourceId: "S1"
---

# Page 2

${wrong}

${right}
`);
    fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({
      sourceTextConceptAnchors: [
        {
          id: "S1.P2.NeuromorphicHardware",
          title: "Neuromorphic hardware",
          page: 2,
          sourceId: "S1",
          semanticSummary: "The source explains neuromorphic hardware for SNN deployment.",
          exactText: wrong,
          conceptKeywords: ["neuromorphic", "hardware"],
        },
      ],
      sourceStructuralAnchors: [],
    }, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, ...pageRel.split("/")), `---
title: "Hardware"
knowledge_type: "learning-page"
breadboardType: "learning_page"
generated_by: "learn_button"
learningUnitId: "U1"
sourceAnchors: ["S1.P2.NeuromorphicHardware"]
sourceFormulaAnchors: []
tags: []
---

Hardware paragraph.
`);
    const bad = issue({
      id: "sa1",
      type: "source_anchor_mismatch",
      repairTarget: "source_anchor_ledger",
      sourceAnchorIds: ["S1.P2.NeuromorphicHardware"],
      problem: "text anchor exactText quotes a LIF passage instead of neuromorphic hardware.",
      evidence: wrong,
      suggestedRepair: "Replace exactText with the relevant source passage.",
    });
    const requests = criticIssuesToRepairRequests([bad]);
    assert.equal(requests[0].textAnchorExactTextRepairs.length, 1);

    const repair = makeCriticArtifactRepair({ deterministicFinalize: () => {} });
    await repair(dir, "test-2", requests, { round: 1, issuesById: new Map([[bad.id, bad]]) });
    const ledger = JSON.parse(read(dir, ".breadboard/source-anchors.json"));
    const rec = ledger.sourceTextConceptAnchors.find((a) => a.id === "S1.P2.NeuromorphicHardware");
    assert.match(rec.exactText, /Neuromorphic hardware uses event-driven chips/);
    assert.doesNotMatch(rec.exactText, /membrane potential/);
    assert.ok(rec.evidence.totalScore >= 0.5);
  });

  test("critic reports downgrade validation Accepted when critic blockers remain", () => {
    const dir = mkTinyGarden("bb-critic-report-");
    fs.writeFileSync(path.join(dir, ".breadboard", "validation-report.md"), [
      "# Breadboard Validation Report",
      "",
      "Accepted: yes",
      "",
      "## Acceptance Decision",
      "",
      "Accepted: yes",
      "",
      "## Final Acceptance",
      "",
      "Accepted: yes",
      "",
    ].join("\n"));
    const blocking = [issue({
      id: "b1",
      type: "source_anchor_mismatch",
      repairTarget: "source_anchor_ledger",
      sourceAnchorIds: ["S1.P2.NeuromorphicHardware"],
      problem: "wrong exactText",
      expected: "relevant exact source passage",
      suggestedRepair: "replace exactText or keep blocked",
    })];
    writeCriticReports(dir, {
      status: {
        draftGenerated: true,
        accepted: false,
        publishReady: false,
        lifecycleStatus: "needs_review",
        deterministicPass: true,
        criticRequired: true,
        criticAvailable: true,
        criticRan: true,
        criticPass: false,
        criticAvailabilityStatus: "available",
        unresolvedBlockingIssues: blocking,
        warnings: [],
        repairRoundsUsed: 1,
        reason: "unresolved_critic_issues",
      },
      rounds: [],
      finalBlockingIssues: blocking,
      finalWarnings: [],
    });
    const validation = read(dir, ".breadboard/validation-report.md");
    assert.doesNotMatch(validation, /^Accepted:\s+yes\s*$/m);
    assert.match(validation, /Deterministic validation: pass/);
    assert.match(validation, /Overall accepted: no/);
    const criticReport = read(dir, ".breadboard/critic-report.md");
    assert.match(criticReport, /## Unresolved blocking issues/);
    assert.match(criticReport, /\| Type \| Target \| Anchors \| Problem \| Expected \| Suggested repair \|/);
  });

  test("model repair candidate cannot add invalid source anchor labels", async () => {
    const dir = mkTinyGarden("bb-critic-invalid-anchor-");
    const pageRel = "learning/1. Metrics/1.1 Invalid.md";
    const original = `---
title: "Invalid"
knowledge_type: "learning-page"
breadboardType: "learning_page"
generated_by: "learn_button"
learningUnitId: "U1"
sourceAnchors: []
sourceFormulaAnchors: []
tags: []
---

Original body.
`;
    fs.writeFileSync(path.join(dir, ...pageRel.split("/")), original);
    const revised = original.replace("sourceAnchors: []", 'sourceAnchors: ["source caveats"]');
    const bad = issue({ id: "m1", type: "repeated_opening", repairTarget: "unit_page", pagePath: pageRel });
    const repair = makeCriticArtifactRepair({
      modelRepair: (input) => ({ targetPath: input.repairRequest.targetPath, revisedMarkdown: revised }),
      deterministicFinalize: () => {},
    });
    const outcome = await repair(dir, "test-2", criticIssuesToRepairRequests([bad]), { round: 1, issuesById: new Map([[bad.id, bad]]) });
    const provenance = outcome.provenance.find((p) => p.targetPath === pageRel);
    assert.equal(provenance.executorUsed, "deterministic");
    assert.equal(provenance.changed, false);
    assert.match(provenance.modelFailureReason ?? "", /no valid candidate/);
    assert.equal(read(dir, pageRel), original);
  });
});

describe("ChatMock critic loop", { skip }, () => {
  const opts = { maxRounds: 3, maxIssuesPerRound: 12, maxTotalRepairAttempts: 25, strictPublish: true };

  // 1. Critic catches synchronized wrongness (deterministic validators missed it).
  test("1. critic catches synchronized-but-wrong source anchor", async () => {
    const dir = freshCopy();
    const critic = statefulCritic([[issue({ type: "source_anchor_mismatch", severity: "blocking", pagePath: "learning/x.md", repairTarget: "unit_page" })], []]);
    const result = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic, options: opts, repair: noopRepair });
    assert.equal(result.rounds[0].blockingIssues, 1);
    assert.ok(result.rounds[0].issueTypes.includes("source_anchor_mismatch"));
    assert.equal(result.status.publishReady, true, "resolved in round 2");
    assert.equal(result.rounds.length, 2);
  });

  // 2. Critic catches surrogate-gradient formula grounded to energy-efficiency anchor.
  test("2. critic catches formula grounded to wrong-family anchor", async () => {
    const dir = freshCopy();
    const bad = issue({ type: "formula_anchor_mismatch", severity: "blocking", pagePath: "learning/surrogate.md", sourceAnchorIds: ["S1.P6.E5"], repairTarget: "unit_page", problem: "surrogate-gradient formula grounded to normalized energy efficiency (S1.P6.E5)" });
    const result = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([bad]), options: opts, repair: noopRepair });
    assert.ok(result.finalBlockingIssues.some((i) => i.type === "formula_anchor_mismatch" && i.sourceAnchorIds?.includes("S1.P6.E5")));
    assert.equal(result.status.publishReady, false);
  });

  // 3. Critic catches section index template prose.
  test("3. critic catches section index template prose", async () => {
    const dir = freshCopy();
    const bad = issue({ type: "section_index_template_prose", severity: "blocking", sectionPath: "learning/1. x/_index.md", repairTarget: "section_index" });
    const result = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([bad]), options: opts, repair: noopRepair });
    assert.ok(result.finalBlockingIssues.some((i) => i.type === "section_index_template_prose"));
  });

  // 4. Critic catches worked example labeled as source definition.
  test("4. critic catches worked example misclassified as source definition", async () => {
    const dir = freshCopy();
    const bad = issue({ type: "worked_example_misclassified", severity: "blocking", pagePath: "learning/accuracy.md", repairTarget: "unit_page" });
    const result = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([bad]), options: opts, repair: noopRepair });
    assert.ok(result.finalBlockingIssues.some((i) => i.type === "worked_example_misclassified"));
  });

  // 5. Critic catches Source Coverage contradiction.
  test("5. critic catches Source Coverage contradiction", async () => {
    const dir = freshCopy();
    const bad = issue({ type: "source_coverage_contradiction", severity: "blocking", repairTarget: "source_coverage", sourceAnchorIds: ["S1.P6.E2"] });
    const result = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([bad]), options: opts, repair: noopRepair });
    assert.ok(result.finalBlockingIssues.some((i) => i.type === "source_coverage_contradiction"));
  });

  // 6. Critic issues become targeted repair requests.
  test("6. critic issues map to repair requests by target", () => {
    const requests = criticIssuesToRepairRequests([
      issue({ id: "a", type: "section_index_template_prose", repairTarget: "section_index", sectionPath: "learning/1. x/_index.md", suggestedRepair: "rewrite" }),
      issue({ id: "b", type: "stale_caveat", repairTarget: "planning_doc", suggestedRepair: "remove caveat" }),
      issue({ id: "c", type: "formula_anchor_mismatch", repairTarget: "unit_page", pagePath: "learning/p.md", sourceAnchorIds: ["S1.P6.E5"] }),
      issue({ id: "d", type: "source_anchor_mismatch", repairTarget: "unit_page", pagePath: "learning/p.md", sourceAnchorIds: ["S1.P6.E1"] }),
    ]);
    const byKind = Object.fromEntries(requests.map((r) => [r.targetKind, r]));
    assert.ok(byKind.section_index && byKind.section_index.targetPath === "learning/1. x/_index.md");
    assert.ok(byKind.planning_doc);
    // c and d share the same unit_page path -> merged into one request.
    assert.ok(byKind.unit_page && byKind.unit_page.issueIds.length === 2);
    assert.deepEqual([...byKind.unit_page.affectedAnchorIds].sort(), ["S1.P6.E1", "S1.P6.E5"]);
  });

  // 7. Repaired artifact is re-reviewed in round 2.
  test("7. loop re-reviews after repair (round 2)", async () => {
    const dir = freshCopy();
    const calls = [];
    const critic = statefulCritic([[issue({ type: "stale_caveat", repairTarget: "planning_doc" })], []]);
    const result = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic, options: opts, repair: countingRepair(calls) });
    assert.equal(calls.length, 1, "repair ran once (round 1)");
    assert.equal(result.rounds.length, 2, "critic re-reviewed in round 2");
    assert.equal(result.rounds[0].repairsResolved, 1, "the round-1 issue was resolved");
    assert.equal(result.status.publishReady, true);
  });

  // 8. Loop stops when no blocking issues remain.
  test("8. loop stops immediately when clean", async () => {
    const dir = freshCopy();
    const result = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([]), options: opts, repair: noopRepair });
    assert.equal(result.rounds.length, 1);
    assert.equal(result.status.publishReady, true);
    assert.equal(result.status.criticPass, true);
    assert.equal(result.finalBlockingIssues.length, 0);
  });

  // 9. Loop stops with publishReady:false when max rounds are exhausted.
  test("9. loop exhausts rounds and is not publish-ready", async () => {
    const dir = freshCopy();
    const result = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([issue({ type: "repeated_opening" })]), options: opts, repair: noopRepair });
    assert.equal(result.rounds.length, 3);
    assert.equal(result.status.publishReady, false);
    assert.equal(result.status.accepted, false);
    assert.ok(result.status.unresolvedBlockingIssues.length >= 1);
    assert.match(result.status.reason ?? "", /unresolved/i);
  });

  // 10. Draft garden still exists when publish-ready fails.
  test("10. draft garden still exists after unresolved blockers", async () => {
    const dir = freshCopy();
    const result = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([issue({})]), options: opts, repair: noopRepair });
    assert.equal(result.status.draftGenerated, true);
    assert.equal(result.status.publishReady, false);
    assert.ok(fs.existsSync(path.join(dir, "learning")), "draft learning tree remains");
  });

  // 11. Warnings do not block publish; blocking issues do.
  test("11. warnings do not block, blocking issues do", async () => {
    const dir1 = freshCopy();
    const warnOnly = await runCriticLoop({ gardenDir: dir1, gardenSlug: "test-2", critic: constantCritic([issue({ severity: "warning" }), issue({ severity: "cosmetic" })]), options: opts, repair: noopRepair });
    assert.equal(warnOnly.status.publishReady, true);
    assert.ok(warnOnly.status.warnings.length >= 1);
    assert.equal(warnOnly.rounds.length, 1);

    const dir2 = freshCopy();
    const blocked = await runCriticLoop({ gardenDir: dir2, gardenSlug: "test-2", critic: constantCritic([issue({ severity: "blocking" })]), options: opts, repair: noopRepair });
    assert.equal(blocked.status.publishReady, false);
  });

  // 12. Critic reports are written to .breadboard.
  test("12. critic reports are written", async () => {
    const dir = freshCopy();
    await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([issue({ severity: "warning", type: "stale_caveat" })]), options: opts, repair: noopRepair });
    for (const rel of ["critic-report.md", "critic-issues.json", "critic-loop.json"]) {
      assert.ok(fs.existsSync(path.join(dir, ".breadboard", rel)), `${rel} must be written`);
    }
    const loop = JSON.parse(fs.readFileSync(path.join(dir, ".breadboard", "critic-loop.json"), "utf-8"));
    assert.equal(loop.publishReady, true);
    assert.equal(loop.enabled, true);
    assert.ok(Array.isArray(loop.rounds));
  });

  // Packet: the review packet is built from the final state and carries the
  // evidence a real critic needs (anchors with families, formulas, coverage).
  test("packet is compact and carries anchor families + formulas", () => {
    const dir = freshCopy();
    const state = buildFinalGardenState(dir, "test-2");
    const packet = buildCriticReviewPacket(state);
    assert.ok(packet.sections.length > 0);
    assert.ok(packet.sourceAnchors.some((a) => a.formulaFamily === "efficiency"), "formula anchors carry their metric family");
    assert.ok(packet.sections.some((s) => s.pages.some((p) => Array.isArray(p.frontmatterSummary.formulas))));
    assert.ok(typeof packet.deterministicValidationSummary === "string" && packet.deterministicValidationSummary.length > 0);
  });

  // ChatMock adapter: parses model JSON (fenced, {issues:[]}, bad items dropped).
  test("parseCriticIssues tolerates fences and drops invalid items", () => {
    const text = "```json\n{\"issues\":[{\"severity\":\"blocking\",\"type\":\"stale_caveat\",\"problem\":\"p\",\"repairTarget\":\"planning_doc\"},{\"severity\":\"nope\"},{\"problem\":\"\"}]}\n```";
    const parsed = parseCriticIssues(text);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].type, "stale_caveat");
    assert.equal(parsed[0].severity, "blocking");
  });

  test("createChatMockCritic sends the packet and parses the response", async () => {
    const dir = freshCopy();
    const state = buildFinalGardenState(dir, "test-2");
    let sent = null;
    const fakeClient = { chat: { completions: { create: async (body) => { sent = body; return { choices: [{ message: { content: '{"issues":[{"severity":"warning","type":"repeated_opening","problem":"x","repairTarget":"unit_page","pagePath":"learning/a.md"}]}' } }] }; } } } };
    const critic = createChatMockCritic({ client: fakeClient, model: "chatmock" });
    const issues = await critic(buildCriticReviewPacket(state));
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "warning");
    assert.ok(sent && sent.messages[0].content.includes("final semantic critic"));
    assert.ok(sent.messages[1].content.includes("gardenTitle"));
  });

  test("default options match the spec", () => {
    assert.equal(DEFAULT_CRITIC_LOOP_OPTIONS.maxRounds, 3);
    assert.equal(DEFAULT_CRITIC_LOOP_OPTIONS.maxIssuesPerRound, 12);
    assert.equal(DEFAULT_CRITIC_LOOP_OPTIONS.maxTotalRepairAttempts, 25);
    assert.equal(DEFAULT_CRITIC_LOOP_OPTIONS.strictPublish, true);
    assert.equal(DEFAULT_CRITIC_LOOP_OPTIONS.criticModel, "chatmock");
  });
});

// ---------------------------------------------------------------------------
// Fix 1: strict-mode critic availability
// ---------------------------------------------------------------------------
describe("Fix 1: critic availability in strict/non-strict mode", { skip }, () => {
  const throwingCritic = () => { throw new Error("ECONNREFUSED chatmock"); };

  test("1. strict + critic unavailable → publishReady false, criticPass false", async () => {
    const dir = freshCopy();
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: throwingCritic, options: { strictPublish: true, maxRounds: 3 }, repair: noopRepair });
    assert.equal(res.status.publishReady, false);
    assert.equal(res.status.accepted, false);
    assert.equal(res.status.criticPass, false);
    assert.equal(res.status.criticAvailabilityStatus, "unavailable");
    assert.equal(res.status.reason, "critic_unavailable");
    assert.equal(res.status.draftGenerated, true);
    assert.equal(res.status.deterministicPass, true); // deterministic still passes independently
  });

  test("2. non-strict + critic unavailable → draft exists, publishReady=deterministic, unavailability reported", async () => {
    const dir = freshCopy();
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: throwingCritic, options: { strictPublish: false }, repair: noopRepair });
    assert.equal(res.status.publishReady, res.status.deterministicPass);
    assert.equal(res.status.criticAvailable, false);
    assert.equal(res.status.criticAvailabilityStatus, "unavailable");
    assert.ok(res.status.criticUnavailableReason);
    assert.equal(res.status.draftGenerated, true);
  });

  test("3. strict + critic throws → not a deterministic fallback", async () => {
    const dir = freshCopy();
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: throwingCritic, options: { strictPublish: true }, repair: noopRepair });
    assert.equal(res.status.publishReady, false, "must not fall back to deterministic-only publish-ready");
  });

  test("4. strict + critic disabled → publishReady false; non-strict disabled → deterministic", async () => {
    const dir = freshCopy();
    const strict = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([]), options: { enabled: false, strictPublish: true }, repair: noopRepair });
    assert.equal(strict.status.criticAvailabilityStatus, "disabled");
    assert.equal(strict.status.publishReady, false);
    const dir2 = freshCopy();
    const lax = await runCriticLoop({ gardenDir: dir2, gardenSlug: "test-2", critic: constantCritic([]), options: { enabled: false, strictPublish: false }, repair: noopRepair });
    assert.equal(lax.status.publishReady, lax.status.deterministicPass);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: real ChatMock model repair for semantic page/section issues
// ---------------------------------------------------------------------------
describe("Fix 2: ChatMock model repair", { skip }, () => {
  const noFinalize = () => {}; // isolate the model as the only fixer

  function firstSectionIndex(dir) {
    const name = fs.readdirSync(path.join(dir, "learning"), { withFileTypes: true })
      .find((e) => e.isDirectory() && fs.existsSync(path.join(dir, "learning", e.name, "_index.md")))?.name;
    return `learning/${name}/_index.md`;
  }
  function firstPage(dir) {
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
  /** Rebuild a page's content as frontmatter + a new leading paragraph + body. */
  function withNewOpening(original, opening) {
    const fm = original.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)?.[0] ?? "";
    return `${fm}\n${opening}\n\n${original.slice(fm.length).replace(/^\s+/, "")}`;
  }

  test("1. model repair fixes section template prose", async () => {
    const dir = freshCopy();
    const indexRel = firstSectionIndex(dir);
    const fm = read(dir, indexRel).match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0] ?? "";
    const fixed = `${fm}\n\n# Section\n\nThis section compares accuracy, latency, and energy across SNN models so tradeoffs are visible.\n`;
    const modelRepair = (input) => ({ targetPath: input.repairRequest.targetPath, revisedMarkdown: fixed });
    const repair = makeCriticArtifactRepair({ modelRepair, deterministicFinalize: noFinalize });
    const issue = { id: "s1", severity: "blocking", type: "section_index_template_prose", repairTarget: "section_index", sectionPath: indexRel, problem: "template prose", evidence: "e", expected: "x", suggestedRepair: "rewrite from child pages" };
    const requests = criticIssuesToRepairRequests([issue]);
    const outcome = await repair(dir, "test-2", requests, { round: 1, issuesById: new Map([[issue.id, issue]]) });
    assert.ok(outcome.provenance.some((p) => p.executorUsed === "model" && p.changed));
    assert.match(read(dir, indexRel), /tradeoffs are visible/);
  });

  test("2. model repair fixes repeated opening (unit_page)", async () => {
    const dir = freshCopy();
    const pageRel = firstPage(dir)[0];
    const revised = withNewOpening(read(dir, pageRel), "A fresh, non-repeated opening that continues the argument from the prior page.");
    const modelRepair = (input) => ({ targetPath: input.repairRequest.targetPath, revisedMarkdown: revised });
    const repair = makeCriticArtifactRepair({ modelRepair, deterministicFinalize: noFinalize });
    const issue = { id: "r1", severity: "blocking", type: "repeated_opening", repairTarget: "unit_page", pagePath: pageRel, problem: "repeated opening", evidence: "e", expected: "x", suggestedRepair: "reframe opening" };
    const outcome = await repair(dir, "test-2", criticIssuesToRepairRequests([issue]), { round: 1, issuesById: new Map([[issue.id, issue]]) });
    assert.ok(outcome.provenance.some((p) => p.executorUsed === "model" && p.changed));
    assert.match(read(dir, pageRel), /fresh, non-repeated opening/);
  });

  test("3. model repair fixes formula explanation mismatch (unit_page)", async () => {
    const dir = freshCopy();
    const pageRel = firstPage(dir)[0];
    const revised = withNewOpening(read(dir, pageRel), "The accuracy formula counts correct predictions over total predictions.");
    const modelRepair = (input) => ({ targetPath: input.repairRequest.targetPath, revisedMarkdown: revised });
    const repair = makeCriticArtifactRepair({ modelRepair, deterministicFinalize: noFinalize });
    const issue = { id: "f1", severity: "blocking", type: "formula_anchor_mismatch", repairTarget: "unit_page", pagePath: pageRel, sourceAnchorIds: ["S1.P6.E1"], problem: "formula explanation mismatch", evidence: "e", expected: "x", suggestedRepair: "fix explanation" };
    const outcome = await repair(dir, "test-2", criticIssuesToRepairRequests([issue]), { round: 1, issuesById: new Map([[issue.id, issue]]) });
    assert.ok(outcome.provenance.some((p) => p.executorUsed === "model" && p.changed));
    assert.match(read(dir, pageRel), /counts correct predictions over total predictions/);
  });

  test("4. invalid model repair falls back to deterministic with provenance", async () => {
    const dir = freshCopy();
    const pageRel = firstPage(dir)[0];
    let finalizeRan = false;
    const modelRepair = () => null; // invalid candidate
    const repair = makeCriticArtifactRepair({ modelRepair, deterministicFinalize: () => { finalizeRan = true; } });
    const issue = { id: "r1", severity: "blocking", type: "repeated_opening", repairTarget: "unit_page", pagePath: pageRel, problem: "p", evidence: "e", expected: "x", suggestedRepair: "s" };
    const outcome = await repair(dir, "test-2", criticIssuesToRepairRequests([issue]), { round: 1, issuesById: new Map([[issue.id, issue]]) });
    assert.ok(finalizeRan, "deterministic finalize ran as fallback");
    const p = outcome.provenance.find((x) => x.targetPath === pageRel);
    assert.deepEqual(p.executorAttempted, ["model", "deterministic"]);
    assert.equal(p.executorUsed, "deterministic");
    assert.match(p.modelFailureReason ?? "", /no valid candidate/i);
  });

  test("5. model unavailable in strict mode leaves publishReady false when blockers remain", async () => {
    const dir = freshCopy();
    // model repair throws; critic keeps reporting the blocker.
    const modelRepair = () => { throw new Error("model timeout"); };
    const repair = makeCriticArtifactRepair({ modelRepair, deterministicFinalize: noFinalize });
    const bad = issue({ type: "repeated_opening", severity: "blocking", pagePath: "learning/a.md", repairTarget: "unit_page" });
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([bad]), options: { strictPublish: true, maxRounds: 2 }, repair });
    assert.equal(res.status.publishReady, false);
    assert.ok(res.rounds.some((r) => r.provenance.some((p) => (p.modelFailureReason ?? "").includes("model timeout"))));
  });

  test("active Learn mode never falls back to deterministic semantic repair", async () => {
    const dir = freshCopy();
    const pageRel = firstPage(dir)[0];
    let finalizeRan = false;
    const repair = makeCriticArtifactRepair({
      modelRepair: () => null,
      deterministicFinalize: () => { finalizeRan = true; },
      allowDeterministicRepairs: false,
    });
    const issue = { id: "model-only", severity: "blocking", type: "repeated_opening", repairTarget: "unit_page", pagePath: pageRel, problem: "p", evidence: "e", expected: "x", suggestedRepair: "s" };
    const outcome = await repair(dir, "test-2", criticIssuesToRepairRequests([issue]), { round: 1, issuesById: new Map([[issue.id, issue]]) });
    assert.equal(finalizeRan, false);
    const provenance = outcome.provenance.find((entry) => entry.targetPath === pageRel);
    assert.deepEqual(provenance.executorAttempted, ["model"]);
    assert.equal(provenance.executorUsed, "none");
    assert.equal(provenance.changed, false);
  });

  test("parseModelRepairOutput handles markdown and json targets", () => {
    assert.match(parseModelRepairOutput("```markdown\n---\ntitle: x\n---\n\nbody\n```", "learning/p.md").revisedMarkdown, /title: x/);
    assert.deepEqual(parseModelRepairOutput('{"a":1}', ".breadboard/visuals/v.json").revisedJson, { a: 1 });
    assert.equal(parseModelRepairOutput("not json", ".breadboard/visuals/v.json"), null);
  });

  test("createChatMockModelRepair sends the repair prompt and parses output", async () => {
    let sent = null;
    const fakeClient = { chat: { completions: { create: async (body) => { sent = body; return { choices: [{ message: { content: "---\ntitle: x\n---\n\nrevised body\n" } }] }; } } } };
    const modelRepair = createChatMockModelRepair({ client: fakeClient, model: "chatmock" });
    const out = await modelRepair({ issue: { type: "repeated_opening", problem: "p", evidence: "e", expected: "x" }, repairRequest: { id: "r", issueIds: ["i"], targetKind: "unit_page", targetPath: "learning/a.md", instructions: ["reframe"], evidence: [] }, finalGardenStateExcerpt: {}, currentMarkdown: "---\ntitle: x\n---\n\nold" });
    assert.match(out.revisedMarkdown, /revised body/);
    assert.ok(sent.messages[0].content.includes("repair one file"));
    assert.ok(sent.messages[1].content.includes("reframe"));
  });
});

// ---------------------------------------------------------------------------
// Fix 3: draft vs publish-ready lifecycle
// ---------------------------------------------------------------------------
describe("Fix 3: lifecycle status", { skip }, () => {
  test("1. unresolved critic blockers → needs_review, not publish_ready", async () => {
    const dir = freshCopy();
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([issue({})]), options: { maxRounds: 2 }, repair: noopRepair });
    assert.equal(res.status.lifecycleStatus, "needs_review");
    assert.notEqual(res.status.lifecycleStatus, "publish_ready");
  });

  test("2. critic unavailable in strict mode → needs_review", async () => {
    const dir = freshCopy();
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: () => { throw new Error("down"); }, options: { strictPublish: true }, repair: noopRepair });
    assert.equal(res.status.lifecycleStatus, "needs_review");
  });

  test("3. clean critic pass → publish_ready", async () => {
    const dir = freshCopy();
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([]), repair: noopRepair });
    assert.equal(res.status.lifecycleStatus, "publish_ready");
  });

  test("4. structural deterministic failure → publish_failed_structural", async () => {
    const dir = freshCopy();
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([]), structuralFailure: true, deterministicPass: false, repair: noopRepair });
    assert.equal(res.status.lifecycleStatus, "publish_failed_structural");
    assert.equal(res.status.publishReady, false);
  });

  test("lifecycle + acceptance are written to disk and validation-report", async () => {
    const dir = freshCopy();
    await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: constantCritic([issue({})]), options: { maxRounds: 2 }, repair: noopRepair });
    const acc = JSON.parse(read(dir, ".breadboard/acceptance-status.json"));
    assert.equal(acc.lifecycleStatus, "needs_review");
    assert.ok("criticAvailabilityStatus" in acc && "criticRequired" in acc);
    const report = read(dir, ".breadboard/validation-report.md");
    assert.match(report, /## Critic Publish Readiness/);
    assert.match(report, /Publish-ready: no/);
  });
});

// ---------------------------------------------------------------------------
// Fix 4: direct issue-resolution tracking
// ---------------------------------------------------------------------------
describe("Fix 4: direct issue-resolution tracking", { skip }, () => {
  const mk = (id, type, page) => ({ id, severity: "blocking", type, repairTarget: "unit_page", pagePath: page, problem: "p", evidence: "e", expected: "x", suggestedRepair: "s" });

  test("1. count drops but same issue remains under new ID → not resolved", () => {
    const prev = [mk("old-1", "repeated_opening", "learning/a.md"), mk("old-2", "template_zettelkasten_handle", "learning/b.md")];
    const next = [mk("new-99", "repeated_opening", "learning/a.md")]; // same type+target, new id
    const res = computeIssueResolutions(prev, next);
    const byTarget = Object.fromEntries(res.map((r) => [r.originalIssue.pagePath, r.status]));
    assert.equal(byTarget["learning/a.md"], "still_present", "same type+target under new id is not resolved");
    assert.equal(byTarget["learning/b.md"], "resolved");
  });

  test("2. issue fixed but new unrelated warning appears → original resolved", () => {
    const prev = [mk("o1", "repeated_opening", "learning/a.md")];
    const next = [{ id: "w1", severity: "warning", type: "stale_caveat", repairTarget: "planning_doc", problem: "p", evidence: "e", expected: "x", suggestedRepair: "s" }];
    const res = computeIssueResolutions(prev, next);
    assert.equal(res[0].status, "resolved");
  });

  test("3. issue replaced by new blocking issue on same target → replaced_by_new_issue", () => {
    const prev = [mk("o1", "repeated_opening", "learning/a.md")];
    const next = [mk("n1", "worked_example_misclassified", "learning/a.md")]; // same target, different type
    const res = computeIssueResolutions(prev, next);
    assert.equal(res[0].status, "replaced_by_new_issue");
  });

  test("loop records per-round resolutions in critic-loop.json", async () => {
    const dir = freshCopy();
    // round1: issue "a"; round2: same type+target new id "b"; round3: clean.
    const perRound = [[mk("a", "repeated_opening", "learning/x.md")], [mk("b", "repeated_opening", "learning/x.md")], []];
    let r = 0; const critic = () => perRound[r++] ?? [];
    await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic, options: { maxRounds: 3 }, repair: noopRepair });
    const loop = JSON.parse(read(dir, ".breadboard/critic-loop.json"));
    assert.equal(loop.rounds[0].resolutions[0].status, "still_present", "round1 issue persisted under a new id");
    assert.equal(loop.rounds[1].resolutions[0].status, "resolved", "round2 issue cleared in round3");
  });
});

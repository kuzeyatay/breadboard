// End-to-end proof of the model-backed repair executor interface, using a FAKE
// model executor (no real LLM call). Covers the required cases:
//   1. fake model returns a valid page      -> deterministic fallback NOT used
//   2. fake model returns an invalid page   -> deterministic fallback used
//   3. fake model unavailable (throws)      -> deterministic fallback used
//   4. fake model changes unsupported files -> rejected, fallback used
//   5. repaired page passes no-mutation verification after finalization
// Plus one integration fixture where deterministic repair is DISABLED
// (repairExecutor: "model") and a fake model repair is required.
//
// Prompt/parse unit tests exercise repair-executor.ts directly. The e2e cases
// DISCOVER their target page from the on-disk garden (see helpers/garden.mjs).

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  finalizeGardenExport,
  repairLearningUnitsFromContract,
  verifyFinalArtifactNoMutation,
} from "../src/lib/garden-finalize.ts";
import { buildModelRepairPrompt, parseModelRepairResponse } from "../src/lib/repair-executor.ts";
import {
  freshGarden,
  read,
  write,
  findFormulaPage,
  findLaterLearnerPages,
  rewriteFirstProse,
  injectOpeningMotif,
  OPENING_MOTIF,
  skipReason as skip,
} from "./helpers/garden.mjs";

// ---------------------------------------------------------------------------
// Prompt + response parsing unit tests
// ---------------------------------------------------------------------------

function fakeRequest(overrides = {}) {
  return {
    unitId: "U8",
    pagePath: "learning/2. Metrics/2.2 Latency.md",
    sectionPath: "learning/2. Metrics",
    failureTypes: ["formula_grounding"],
    validationErrors: ["Formula Meaning Match: 2.2 Latency: formulas[0] grounded to S1.P6.E5 but content matches S1.P6.E2"],
    learningUnitContract: {
      id: "U8",
      title: "Latency as Time to Decision",
      role: "formula",
      learningQuestion: "How is latency defined?",
      prerequisiteConcepts: ["accuracy"],
      newConcepts: ["latency"],
      sourceAnchors: ["S1.P6.E2"],
      sourceFigures: [],
      sourceFormulas: [{ id: "S1.P6.E2", teachingGoal: "define latency", termsToDefine: ["t_decision", "t_stimulus"], placement: "after_formula_introduction" }],
      sourceTables: [],
      interactiveVisual: undefined,
      zettelNotes: [
        { handle: "latency-measures-time-to-decision", claim: "Latency measures time to decision.", connectedTo: [] },
        { handle: "low-latency-can-conflict-with-low-energy", claim: "Low latency can conflict with low energy.", connectedTo: [] },
      ],
      mustNotRepeat: [],
      expectedWordRange: [700, 1100],
    },
    previousUnitSummary: "U7 — Accuracy as Correct Decisions",
    nextUnitSummary: "U9 — Spike Count as Computational Activity",
    sourceAnchors: [{ equationId: "S1.P6.E2", page: 6, role: "output_formula", description: "Latency as decision time minus stimulus time" }],
    currentPageMarkdown: '---\ntitle: "2.2 Latency"\nlearningUnitId: "U8"\n---\n\n### Latency\n\n$$L = t_d - t_s$$\n',
    requiredChanges: ["Reground the latency formula to its exact source anchor."],
    repairPrompt: "(unused here)",
    ...overrides,
  };
}

describe("model repair prompt + parsing", () => {
  test("prompt includes contract, failures, source anchors, handles, neighbours, and the current page", () => {
    const { system, user } = buildModelRepairPrompt(fakeRequest(), { sourceText: "Latency L = t_decision - t_stimulus." });
    assert.match(system, /frontmatter schema/i);
    assert.match(system, /KaTeX/);
    assert.match(system, /===PAGE===/);
    assert.match(system, /breadboard-visual/);
    assert.match(user, /Learning Unit Contract/);
    assert.match(user, /S1\.P6\.E2/);
    assert.match(user, /Validation errors to fix/);
    assert.match(user, /latency-measures-time-to-decision/);
    assert.match(user, /Previous unit/);
    assert.match(user, /Next unit/);
    assert.match(user, /Exact source text/);
    assert.match(user, /Current page markdown/);
    assert.match(user, /L = t_d - t_s/);
  });

  test("parses the ===PAGE=== envelope plus optional visual specs and contract patch", () => {
    const response = [
      "===PAGE===",
      '---\ntitle: "2.2 Latency"\nlearningUnitId: "U8"\n---\n\n### Latency\n\nFixed body.\n',
      "===END PAGE===",
      "===VISUAL_SPECS===",
      '[{ "id": "vis-latency", "spec": { "id": "vis-latency", "type": "metric_calculator" } }]',
      "===END VISUAL_SPECS===",
      "===CONTRACT_HANDLE_PATCH===",
      '{ "unitId": "U8", "handles": ["latency-measures-time-to-decision"] }',
      "===END CONTRACT_HANDLE_PATCH===",
    ].join("\n");
    const candidate = parseModelRepairResponse(response);
    assert.ok(candidate);
    assert.match(candidate.markdown, /^---/);
    assert.match(candidate.markdown, /Fixed body/);
    assert.equal(candidate.visualSpecs.length, 1);
    assert.equal(candidate.visualSpecs[0].id, "vis-latency");
    assert.equal(candidate.contractHandlePatch.unitId, "U8");
    assert.deepEqual(candidate.contractHandlePatch.handles, ["latency-measures-time-to-decision"]);
  });

  test("tolerates a bare ```markdown fence and rejects a page without frontmatter", () => {
    const fenced = "```markdown\n---\ntitle: t\n---\n\nbody\n```";
    assert.ok(parseModelRepairResponse(fenced));
    assert.equal(parseModelRepairResponse("just some prose, no page"), null);
    assert.equal(parseModelRepairResponse(""), null);
  });
});

// ---------------------------------------------------------------------------
// End-to-end fake-executor cases on the real generated garden
// ---------------------------------------------------------------------------

/** Inject the formula-grounding defect on a discovered single-formula page. */
function mutateFormulaGrounding(dir) {
  const target = findFormulaPage(dir); // { rel, anchor, wrongAnchor }
  const original = read(dir, target.rel);
  const escaped = target.anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  write(
    dir,
    target.rel,
    original
      .replace(/^sourceFormulaAnchors: \[([^\]]*)\]$/m, (line) => line.replace(`"${target.anchor}"`, `"${target.wrongAnchor}"`))
      .replace(new RegExp(`sourceAnchor: "${escaped}"`, "g"), `sourceAnchor: "${target.wrongAnchor}"`),
  );
  return { rel: target.rel, anchor: target.anchor, wrongAnchor: target.wrongAnchor, original };
}

function snapshotTree(dir) {
  const out = new Map();
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.set(r, fs.readFileSync(path.join(d, e.name), "utf-8"));
    }
  };
  walk(dir, "");
  return out;
}

/** Drive repair + finalize + verify with a fake executor built from the mutated
 * garden's discovered target, capturing everything before teardown. */
async function driveExecutor({ setup, repairExecutor, makeModelRepair }) {
  const { root, dir } = await freshGarden();
  try {
    const meta = setup(dir) ?? {};
    const modelRepair = makeModelRepair ? makeModelRepair(meta) : undefined;
    const run = await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2", repairExecutor, modelRepair });
    // The failed-repairs dump is a repair-loop debug artifact; the production
    // finalize strips it (Fix 13), so capture it before finalizing.
    const failedAbs = path.join(dir, ".breadboard", "debug", "failed-repairs");
    const failedRepairs = fs.existsSync(failedAbs) ? fs.readdirSync(failedAbs) : [];
    const finalize = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
    const verify = verifyFinalArtifactNoMutation({ gardenDir: dir, gardenSlug: "test-2" });
    const final = snapshotTree(dir);
    const readFinal = (rel) => {
      const v = final.get(rel);
      if (v === undefined) throw new Error(`file not present after pipeline: ${rel}`);
      return v;
    };
    const entryFor = (page) => run.repairs.find((r) => r.pagePath === page);
    return { meta, run, finalize, verify, failedRepairs, readFinal, entryFor };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("model-backed repair executor end-to-end (fake model)", () => {
  test("case 1: valid model candidate is used and deterministic fallback is NOT used", { skip }, async () => {
    const ctx = await driveExecutor({
      setup: mutateFormulaGrounding,
      repairExecutor: "model_with_deterministic_fallback",
      // Fake model returns the known-good page -> valid candidate.
      makeModelRepair: (meta) => (request) => (request.pagePath === meta.rel ? { markdown: meta.original, notes: ["returned corrected page"] } : null),
    });

    const entry = ctx.entryFor(ctx.meta.rel);
    assert.ok(entry, "target page must have a repair-log entry");
    assert.equal(entry.executorUsed, "model");
    assert.deepEqual(entry.executorAttempted, ["model"], "deterministic must NOT be attempted when the model succeeds");
    assert.equal(entry.result, "resolved");
    assert.equal(entry.modelFailureReason, undefined);
    assert.equal(ctx.failedRepairs.length, 0, "no failed-repair dump when the model succeeds");
    assert.ok(ctx.run.executions.some((e) => e.pagePath === ctx.meta.rel && e.executor === "model" && e.success));
    const page = ctx.readFinal(ctx.meta.rel);
    assert.match(page, /lastSemanticRepair:/);
    assert.match(page, /repairType: "model"/);
    assert.doesNotMatch(page, new RegExp(ctx.meta.wrongAnchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // case 5: no-mutation verification passes after finalization
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
    assert.deepEqual(ctx.finalize.criticalProblems, []);
  });

  test("case 2: invalid model candidate is rejected and deterministic fallback repairs the page", { skip }, async () => {
    const ctx = await driveExecutor({
      setup: mutateFormulaGrounding,
      repairExecutor: "model_with_deterministic_fallback",
      // Fake model returns the still-broken page (keeps the wrong anchor).
      makeModelRepair: (meta) => (request) => (request.pagePath === meta.rel ? { markdown: request.currentPageMarkdown } : null),
    });

    const entry = ctx.entryFor(ctx.meta.rel);
    assert.equal(entry.executorUsed, "deterministic", "must fall back to deterministic");
    assert.deepEqual(entry.executorAttempted, ["model", "deterministic"]);
    assert.match(entry.modelFailureReason ?? "", /failed validation/i);
    assert.equal(entry.result, "resolved");
    assert.ok(ctx.failedRepairs.length >= 1, "rejected candidate must be dumped to failed-repairs/");
    const page = ctx.readFinal(ctx.meta.rel);
    assert.match(page, /repairType: "deterministic"/);
    assert.doesNotMatch(page, new RegExp(ctx.meta.wrongAnchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
  });

  test("case 3: unavailable model (throws) falls back to deterministic", { skip }, async () => {
    const ctx = await driveExecutor({
      setup: mutateFormulaGrounding,
      repairExecutor: "model_with_deterministic_fallback",
      makeModelRepair: () => () => {
        throw new Error("model endpoint unavailable");
      },
    });

    const entry = ctx.entryFor(ctx.meta.rel);
    assert.equal(entry.executorUsed, "deterministic");
    assert.deepEqual(entry.executorAttempted, ["model", "deterministic"]);
    assert.match(entry.modelFailureReason ?? "", /model executor error: model endpoint unavailable/);
    assert.equal(entry.result, "resolved");
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
  });

  test("case 4: model candidate touching unsupported files is rejected, deterministic fallback used", { skip }, async () => {
    const ctx = await driveExecutor({
      setup: mutateFormulaGrounding,
      repairExecutor: "model_with_deterministic_fallback",
      // The page body is correct, but the candidate also patches a FOREIGN unit's
      // contract handles — out of scope for this page's repair.
      makeModelRepair: (meta) => (request) =>
        request.pagePath === meta.rel
          ? { markdown: meta.original, contractHandlePatch: { unitId: "U_FOREIGN", handles: ["some-foreign-handle"] } }
          : null,
    });

    const entry = ctx.entryFor(ctx.meta.rel);
    assert.equal(entry.executorUsed, "deterministic");
    assert.match(entry.modelFailureReason ?? "", /out of scope|unsupported/i);
    assert.ok(ctx.failedRepairs.length >= 1, "out-of-scope candidate must be dumped");
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
  });

  test("integration: deterministic disabled, model rewrites a repeated opening into a forward transition", { skip }, async () => {
    const MODEL_TRANSITION =
      "MODEL-REWRITE: Building directly on the previous unit, this page advances its specific argument without restating the earlier framing scenario.";
    const ctx = await driveExecutor({
      setup: (dir) => {
        const rel = findLaterLearnerPages(dir, 1)[0];
        write(dir, rel, injectOpeningMotif(read(dir, rel), OPENING_MOTIF));
        return { rel };
      },
      repairExecutor: "model", // deterministic repair intentionally disabled
      makeModelRepair: () => (request) => ({ markdown: rewriteFirstProse(request.currentPageMarkdown, MODEL_TRANSITION), notes: ["model rewrote the repeated opening"] }),
    });

    assert.equal(ctx.run.repairExecutorMode, "model");
    assert.ok(ctx.run.repairs.length >= 1);
    for (const entry of ctx.run.repairs) {
      assert.equal(entry.executorUsed, "model", `${entry.pagePath} must be model-repaired`);
      assert.deepEqual(entry.executorAttempted, ["model"]);
      assert.equal(entry.result, "resolved");
    }
    const injected = ctx.readFinal(ctx.meta.rel);
    assert.match(injected, /MODEL-REWRITE:/);
    assert.doesNotMatch(injected, /battery-powered robot moving through a quiet hallway/);
    assert.match(injected, /repairType: "model"/);
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
    assert.deepEqual(ctx.finalize.criticalProblems, []);
  });
});

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
// Prompt/parse unit tests exercise repair-executor.ts directly.

import test, { describe } from "node:test";
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
import { buildModelRepairPrompt, parseModelRepairResponse } from "../src/lib/repair-executor.ts";

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
    // system constraints
    assert.match(system, /frontmatter schema/i);
    assert.match(system, /KaTeX/);
    assert.match(system, /===PAGE===/);
    assert.match(system, /breadboard-visual/);
    // user content sections
    assert.match(user, /Learning Unit Contract/);
    assert.match(user, /S1\.P6\.E2/); // required source formula id
    assert.match(user, /Validation errors to fix/);
    assert.match(user, /latency-measures-time-to-decision/); // required handle
    assert.match(user, /Previous unit/);
    assert.match(user, /Next unit/);
    assert.match(user, /Exact source text/);
    assert.match(user, /Current page markdown/);
    assert.match(user, /L = t_d - t_s/); // the current page body
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

const REAL_GARDEN = fileURLToPath(new URL("../../quartz/content/test-2", import.meta.url));
const GARDEN_AVAILABLE = fs.existsSync(path.join(REAL_GARDEN, ".breadboard", "learning-unit-contract.json"));
const skip = GARDEN_AVAILABLE ? false : "real generated garden quartz/content/test-2 is not present";

const LATENCY_PAGE = "learning/2. Measuring Accuracy, Latency, and Spike Count/2.2 Latency as Time to Decision.md";
const READING_PAGE = "learning/1. Why SNNs Need Events/1.1 Why Spiking Neural Networks Exist.md";
const OPENING_MOTIF =
  "Picture a battery-powered robot moving through a quiet hallway: a dense ANN keeps recomputing every frame while a silent SNN waits for events before doing any work.";
const INJECT_OPENING_PAGE = "learning/6. Where SNNs Fit and What Still Blocks Adoption/6.4 Limits of Current Spiking Neural Networks.md";

function freshGarden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-rex-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(REAL_GARDEN, dir, { recursive: true });
  for (const noise of ["backups", "debug", "events.jsonl", "repair-log.json", "repair-report.md"]) {
    fs.rmSync(path.join(dir, ".breadboard", noise), { recursive: true, force: true });
  }
  return { root, dir };
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf-8");
const write = (dir, rel, s) => fs.writeFileSync(path.join(dir, ...rel.split("/")), s, "utf-8");

/** Inject the formula-grounding defect on the latency page (E2 -> E5). */
function mutateLatency(dir) {
  write(
    dir,
    LATENCY_PAGE,
    read(dir, LATENCY_PAGE)
      .replace(/sourceFormulaAnchors: \["S1\.P6\.E2"\]/, 'sourceFormulaAnchors: ["S1.P6.E5"]')
      .replace(/sourceAnchor: "S1\.P6\.E2"/g, 'sourceAnchor: "S1.P6.E5"'),
  );
}

/** Drive repair + finalize + verify with a fake executor, capturing everything
 * the assertions need before the temp dir is torn down. */
async function driveExecutor({ mutate, repairExecutor, modelRepair }) {
  const { root, dir } = freshGarden();
  try {
    mutate(dir);
    const run = await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2", repairExecutor, modelRepair });
    const finalize = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
    const verify = verifyFinalArtifactNoMutation({ gardenDir: dir, gardenSlug: "test-2" });
    const failedDir = path.join(dir, ".breadboard", "debug", "failed-repairs");
    const failedRepairs = fs.existsSync(failedDir) ? fs.readdirSync(failedDir) : [];
    // Capture the post-pipeline tree so assertions can read files after the temp
    // dir is torn down in `finally`.
    const finalTree = new Map();
    const walk = (d, rel) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(d, entry.name), r);
        else finalTree.set(r, fs.readFileSync(path.join(d, entry.name), "utf-8"));
      }
    };
    walk(dir, "");
    const readFinal = (rel) => {
      const value = finalTree.get(rel);
      if (value === undefined) throw new Error(`file not present after pipeline: ${rel}`);
      return value;
    };
    const entryFor = (page) => run.repairs.find((r) => r.pagePath === page);
    return { run, finalize, verify, failedRepairs, readFinal, entryFor };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("model-backed repair executor end-to-end (fake model)", () => {
  test("case 1: valid model candidate is used and deterministic fallback is NOT used", { skip }, async () => {
    let original;
    const ctx = await driveExecutor({
      mutate: (dir) => {
        original = read(dir, LATENCY_PAGE); // the correct (E2) page
        mutateLatency(dir);
      },
      repairExecutor: "model_with_deterministic_fallback",
      // Fake model returns the known-good page -> valid candidate.
      modelRepair: (request) => (request.pagePath === LATENCY_PAGE ? { markdown: original, notes: ["returned corrected page"] } : null),
    });

    const entry = ctx.entryFor(LATENCY_PAGE);
    assert.ok(entry, "latency page must have a repair-log entry");
    assert.equal(entry.executorUsed, "model");
    assert.deepEqual(entry.executorAttempted, ["model"], "deterministic must NOT be attempted when the model succeeds");
    assert.equal(entry.result, "resolved");
    assert.equal(entry.modelFailureReason, undefined);
    assert.equal(ctx.failedRepairs.length, 0, "no failed-repair dump when the model succeeds");
    // execution record present
    assert.ok(ctx.run.executions.some((e) => e.pagePath === LATENCY_PAGE && e.executor === "model" && e.success));
    // page carries model provenance and the correct grounding
    const page = ctx.readFinal(LATENCY_PAGE);
    assert.match(page, /lastSemanticRepair:/);
    assert.match(page, /repairType: "model"/);
    assert.doesNotMatch(page, /S1\.P6\.E5/);
    assert.match(page, /sourceFormulaAnchors: \["S1\.P6\.E2"\]/);
    // case 5: no-mutation verification passes after finalization
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
    assert.deepEqual(ctx.finalize.criticalProblems, []);
  });

  test("case 2: invalid model candidate is rejected and deterministic fallback repairs the page", { skip }, async () => {
    const ctx = await driveExecutor({
      mutate: mutateLatency,
      repairExecutor: "model_with_deterministic_fallback",
      // Fake model returns the still-broken page (keeps E5) -> fails validation.
      modelRepair: (request) => (request.pagePath === LATENCY_PAGE ? { markdown: request.currentPageMarkdown } : null),
    });

    const entry = ctx.entryFor(LATENCY_PAGE);
    assert.equal(entry.executorUsed, "deterministic", "must fall back to deterministic");
    assert.deepEqual(entry.executorAttempted, ["model", "deterministic"]);
    assert.match(entry.modelFailureReason ?? "", /failed validation/i);
    assert.equal(entry.result, "resolved");
    assert.ok(ctx.failedRepairs.length >= 1, "rejected candidate must be dumped to failed-repairs/");
    // page carries deterministic provenance and the deterministic fix (E2)
    const page = ctx.readFinal(LATENCY_PAGE);
    assert.match(page, /repairType: "deterministic"/);
    assert.doesNotMatch(page, /S1\.P6\.E5/);
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
  });

  test("case 3: unavailable model (throws) falls back to deterministic", { skip }, async () => {
    const ctx = await driveExecutor({
      mutate: mutateLatency,
      repairExecutor: "model_with_deterministic_fallback",
      modelRepair: () => {
        throw new Error("model endpoint unavailable");
      },
    });

    const entry = ctx.entryFor(LATENCY_PAGE);
    assert.equal(entry.executorUsed, "deterministic");
    assert.deepEqual(entry.executorAttempted, ["model", "deterministic"]);
    assert.match(entry.modelFailureReason ?? "", /model executor error: model endpoint unavailable/);
    assert.equal(entry.result, "resolved");
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
  });

  test("case 4: model candidate touching unsupported files is rejected, deterministic fallback used", { skip }, async () => {
    let original;
    const ctx = await driveExecutor({
      mutate: (dir) => {
        original = read(dir, LATENCY_PAGE);
        mutateLatency(dir);
      },
      repairExecutor: "model_with_deterministic_fallback",
      // The page body is correct, but the candidate also patches a FOREIGN unit's
      // contract handles — out of scope for this page's repair.
      modelRepair: (request) =>
        request.pagePath === LATENCY_PAGE
          ? { markdown: original, contractHandlePatch: { unitId: "U_FOREIGN", handles: ["some-foreign-handle"] } }
          : null,
    });

    const entry = ctx.entryFor(LATENCY_PAGE);
    assert.equal(entry.executorUsed, "deterministic");
    assert.match(entry.modelFailureReason ?? "", /out of scope|unsupported/i);
    assert.ok(ctx.failedRepairs.length >= 1, "out-of-scope candidate must be dumped");
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
  });

  test("integration: deterministic disabled, model rewrites a repeated opening into a forward transition", { skip }, async () => {
    const MODEL_TRANSITION =
      "MODEL-REWRITE: Building directly on the previous unit, this page advances its specific argument without restating the earlier framing scenario.";
    const rewriteFirstProse = (markdown) => {
      const fmMatch = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
      const fm = fmMatch ? fmMatch[0] : "";
      const body = fmMatch ? markdown.slice(fmMatch[0].length) : markdown;
      const paras = body.replace(/^\n+/, "").split(/\n{2,}/);
      let idx = paras.findIndex((p) => {
        const t = p.trim();
        return t && !t.startsWith("#") && !t.startsWith("!") && !t.startsWith("```");
      });
      if (idx < 0) idx = 0;
      paras[idx] = MODEL_TRANSITION;
      return fm + paras.join("\n\n");
    };

    const ctx = await driveExecutor({
      mutate: (dir) => {
        // Inject the same opening motif into a later page (weak/repeated flow).
        write(dir, INJECT_OPENING_PAGE, read(dir, INJECT_OPENING_PAGE).replace(/(\n#{1,3} [^\n]+\n\n)/, `$1${OPENING_MOTIF}\n\n`));
      },
      repairExecutor: "model", // deterministic repair intentionally disabled
      modelRepair: (request) => ({ markdown: rewriteFirstProse(request.currentPageMarkdown), notes: ["model rewrote the repeated opening"] }),
    });

    // both repeated-opening pages were repaired by the MODEL (no deterministic)
    assert.equal(ctx.run.repairExecutorMode, "model");
    assert.ok(ctx.run.repairs.length >= 1);
    for (const entry of ctx.run.repairs) {
      assert.equal(entry.executorUsed, "model", `${entry.pagePath} must be model-repaired`);
      assert.deepEqual(entry.executorAttempted, ["model"]);
      assert.equal(entry.result, "resolved");
    }
    // the injected page shows the model's distinctive rewrite + model provenance
    const injected = ctx.readFinal(INJECT_OPENING_PAGE);
    assert.match(injected, /MODEL-REWRITE:/);
    assert.doesNotMatch(injected, /battery-powered robot moving through a quiet hallway/);
    assert.match(injected, /repairType: "model"/);
    // the repair log records model provenance and the artifact is accepted
    assert.ok(ctx.run.repairs.every((e) => e.executorUsed === "model"));
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
    assert.deepEqual(ctx.finalize.criticalProblems, []);
  });
});

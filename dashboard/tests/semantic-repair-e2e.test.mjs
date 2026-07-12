// End-to-end proof that the contract-driven semantic repair loop runs on
// generated artifacts, not only on hand-built unit fixtures.
//
// This suite starts from the real, accepted generated garden
// (quartz/content/test-2), injects ONE realistic semantic defect per fixture,
// and proves the full pipeline for each: before-repair validation fails, repair
// runs, finalize runs, no-mutation verification passes, and the artifact is
// accepted honestly.
//
// The garden is regenerated periodically and its section/page names change, so
// every fixture DISCOVERS its target page(s) from the on-disk contract +
// frontmatter (see tests/helpers/garden.mjs) instead of hardcoding paths. The
// affected-file assertions use a byte-level snapshot diff against the clean
// baseline (the authoritative "what actually changed").

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  finalizeGardenExport,
  repairLearningUnitsFromContract,
  verifyFinalArtifactNoMutation,
} from "../src/lib/garden-finalize.ts";
import {
  freshGarden,
  snapshot,
  changedSince,
  read,
  write,
  listLearnerPages,
  readContract,
  findFormulaPage,
  findMetricCalculatorPage,
  findResultSection,
  findLaterLearnerPages,
  injectOpeningMotif,
  OPENING_MOTIF,
  skipReason as skip,
} from "./helpers/garden.mjs";

const SOURCE_MAP = ".breadboard/planning/Source Map.md";
const SOURCE_COVERAGE = ".breadboard/planning/Source Coverage.md";
const SOURCE_VISUALS = ".breadboard/source-visuals.json";
const VISUAL_INDEX = ".breadboard/visual-index.json";
const CONTRACT = ".breadboard/learning-unit-contract.json";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Drive one degraded-artifact fixture end-to-end, capturing every observable
 * (including the post-pipeline file tree) before the temp dir is torn down. */
async function runFixture(mutate) {
  const { root, dir } = await freshGarden();
  try {
    const baseline = snapshot(dir);
    const meta = (await mutate(dir)) ?? {};
    const run = await repairLearningUnitsFromContract({ gardenDir: dir, gardenSlug: "test-2" });
    const finalize = finalizeGardenExport({ gardenDir: dir, gardenSlug: "test-2" });
    const verify = verifyFinalArtifactNoMutation({ gardenDir: dir, gardenSlug: "test-2" });
    const affected = changedSince(baseline, dir);
    const final = snapshot(dir);
    const readFinal = (rel) => {
      const buf = final.get(rel);
      if (!buf) throw new Error(`file not present after pipeline: ${rel}`);
      return buf.toString("utf-8");
    };
    const repairLog = JSON.parse(readFinal(".breadboard/repair-log.json"));
    const repairReport = readFinal(".breadboard/repair-report.md");
    const validationReport = readFinal(".breadboard/validation-report.md");
    return { meta, affected, run, finalize, verify, repairLog, repairReport, validationReport, readFinal };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertHealedAndAccepted(ctx, { defect }) {
  assert.ok(
    ctx.run.firstValidationFailures.some((f) => defect.test(f)),
    `pre-repair validation must fail on the injected defect; saw:\n${ctx.run.firstValidationFailures.join("\n")}`,
  );
  assert.ok(
    !ctx.run.finalValidationFailures.some((f) => defect.test(f)),
    `post-repair validation must no longer report the defect; saw:\n${ctx.run.finalValidationFailures.join("\n")}`,
  );
  assert.deepEqual(ctx.finalize.criticalProblems, [], "finalize must report no critical problems after repair");
  assert.equal(ctx.verify.accepted, true, "final artifact must be accepted");
  assert.deepEqual(ctx.verify.mutatedFiles, [], "no-mutation verification must pass");
  assert.deepEqual(ctx.verify.validationFailures, [], "no validation failures may remain");
  assert.match(ctx.validationReport, /^Accepted:\s+yes$/m, "validation-report.md must record Accepted: yes");
  assert.equal(ctx.repairLog.gardenSlug, "test-2");
  assert.equal(ctx.repairLog.finalVerification?.accepted, true);
  assert.match(ctx.repairReport, /## Final Verification/);
  assert.match(ctx.repairReport, /No-mutation check: pass/);
}

/** Pages the repair loop recorded — the authoritative "expected touched pages"
 * for page-only fixtures. */
function repairedPagePaths(ctx) {
  return [...new Set(ctx.run.repairs.map((r) => r.pagePath))].sort();
}

function assertAffectedWithin(ctx, allowed) {
  const allowedSet = new Set([...(ctx.run.finalizerChangedFiles ?? []), ...allowed]);
  for (const rel of ctx.affected) assert.ok(allowedSet.has(rel), `unexpected file touched: ${rel}`);
}

describe("semantic repair loop end-to-end on degraded generated artifacts", () => {
  test("fixture 1: repeated opening is caught, later duplicates rewritten, first occurrence kept", { skip }, async () => {
    const ctx = await runFixture((dir) => {
      const laterPages = findLaterLearnerPages(dir, 3);
      for (const rel of laterPages) write(dir, rel, injectOpeningMotif(read(dir, rel), OPENING_MOTIF));
      return { laterPages };
    });

    assertHealedAndAccepted(ctx, { defect: /repeated .*intro motif/i });
    assert.ok(ctx.run.requests.length > 0);
    const requestPaths = new Set(ctx.run.requests.map((r) => r.pagePath));
    assert.ok(
      ctx.meta.laterPages.some((rel) => requestPaths.has(rel)),
      `expected at least one injected page to be routed; saw ${[...requestPaths].join(", ")}`,
    );
    for (const rel of ctx.meta.laterPages) {
      if (requestPaths.has(rel)) {
        assert.doesNotMatch(ctx.readFinal(rel), /battery-powered robot moving through a quiet hallway/i, `${rel} opening must be rewritten`);
      }
    }
    const remainingMotifCount = ctx.meta.laterPages.filter((rel) => /battery-powered robot moving through a quiet hallway/i.test(ctx.readFinal(rel))).length;
    assert.ok(remainingMotifCount <= 1, `at most the first occurrence should remain; saw ${remainingMotifCount}`);
    // Repair touches the pages it logged; deterministic finalizer hygiene may
    // also normalize formula/visual metadata and reports those paths separately.
    const repaired = repairedPagePaths(ctx);
    assertAffectedWithin(ctx, repaired);
    for (const rel of repaired) assert.ok(ctx.affected.includes(rel), `expected repaired page to change: ${rel}`);
    assert.ok(ctx.run.repairs.every((r) => r.result === "resolved"));
  });

  test("fixture 2: wrong formula grounding is caught and regrounded to the right anchor", { skip }, async () => {
    const ctx = await runFixture((dir) => {
      const target = findFormulaPage(dir); // { rel, anchor, wrongAnchor }
      const s = read(dir, target.rel)
        .replace(/^sourceFormulaAnchors: \[([^\]]*)\]$/m, (line) => line.replace(`"${target.anchor}"`, `"${target.wrongAnchor}"`))
        .replace(new RegExp(`sourceAnchor: "${escapeRe(target.anchor)}"`, "g"), `sourceAnchor: "${target.wrongAnchor}"`);
      write(dir, target.rel, s);
      return { target };
    });

    const { rel, anchor, wrongAnchor } = ctx.meta.target;
    assertHealedAndAccepted(ctx, { defect: new RegExp(`grounded to ${escapeRe(wrongAnchor)}|content does not match|formula family`) });
    assert.ok(ctx.run.requests.some((r) => r.pagePath === rel && r.failureTypes.includes("formula_grounding")));
    // The page is regrounded; deterministic sync may also touch the contract or
    // the page's owned visual spec metadata, but nothing outside that scope.
    assertAffectedWithin(ctx, [rel, CONTRACT, ...ctx.affected.filter((f) => /^\.breadboard\/visuals\//.test(f))]);
    assert.ok(ctx.affected.includes(rel));
    const out = ctx.readFinal(rel);
    assert.match(out, new RegExp(`sourceFormulaAnchors: \\[[^\\]]*"${escapeRe(anchor)}"`), "must reground to the correct anchor");
    const formulaAnchorLine = out.match(/^sourceFormulaAnchors:.*$/m)?.[0] ?? "";
    assert.doesNotMatch(formulaAnchorLine, new RegExp(escapeRe(wrongAnchor)), "the wrong anchor must not remain a source definition anchor");
    assert.doesNotMatch(out, new RegExp(`sourceAnchor: "${escapeRe(wrongAnchor)}"`), "the wrong anchor must not remain on a source definition entry");
  });

  test("fixture 3: overbroad metric visual anchors are narrowed to the minimal sufficient set", { skip }, async () => {
    const ctx = await runFixture((dir) => {
      const { rel } = findMetricCalculatorPage(dir);
      const caps = {
        1: "Accuracy as correct predictions over total predictions",
        2: "Latency as decision time minus stimulus time",
        3: "Total spike count summed across neurons and time steps",
        4: "Total energy from spike and synaptic operation costs",
        5: "Normalized energy efficiency as accuracy per joule",
        6: "Convergence time as minimum epoch reaching target accuracy",
      };
      const extra = [1, 2, 3, 4, 5, 6]
        .map((n) => `        {\n          "description": "${caps[n]}",\n          "sourceId": "2510-27379v1",\n          "page": 6,\n          "equationId": "S1.P6.E${n}"\n        }`)
        .join(",\n");
      const s = read(dir, rel).replace(/("sourceAnchors": \[)([\s\S]*?)(\n  \],\n  "conceptTargets")/, `$1\n${extra}\n      $3`);
      write(dir, rel, s);
      return { rel };
    });

    assertHealedAndAccepted(ctx, { defect: /unrelated formula anchor|lacks a valid role|lacks a specific role reason/i });
    assert.ok(ctx.run.requests.some((r) => r.pagePath === ctx.meta.rel && r.failureTypes.includes("visual_grounding")));
    for (const f of ctx.affected) {
      // Narrowing a page's visual source anchors changes which source equations
      // are "used", so the Source Coverage projection legitimately updates too.
      assert.ok(f === ctx.meta.rel || /^\.breadboard\/visuals\//.test(f) || f === SOURCE_COVERAGE, `unexpected file touched: ${f}`);
    }
    assert.ok(ctx.affected.includes(ctx.meta.rel));
  });

  test("fixture 4: bad Zettelkasten handles are repaired in the contract, then synced to page tags", { skip }, async () => {
    const BAD = ["records-the-source-relationship", "states-what-the-reported-result-supports", "identifies-the-source-problem"];
    const ctx = await runFixture((dir) => {
      const pages = listLearnerPages(dir);
      const contract = readContract(dir);
      const unit = contract.learningUnits.find((u) => (u.zettelNotes?.length ?? 0) >= 1 && pages.some((p) => p.unitId === u.id));
      const pageRel = pages.find((p) => p.unitId === unit.id).rel;
      unit.zettelNotes = BAD.map((h) => ({ handle: h, claim: h.replace(/-/g, " "), connectedTo: [] }));
      write(dir, CONTRACT, JSON.stringify(contract, null, 2));
      write(dir, pageRel, read(dir, pageRel).replace(/tags: \[[^\]]*\]/, `tags: [${BAD.map((h) => `"${h}"`).join(", ")}]`));
      return { unitId: unit.id, pageRel };
    });

    assertHealedAndAccepted(ctx, { defect: /zettel handle .* (sounds like planner scaffolding|scaffold)/i });
    assert.ok(ctx.run.requests.some((r) => r.failureTypes.some((t) => t === "zettelkasten_handle" || t === "zettelkasten_handle_support")));
    assertAffectedWithin(ctx, [CONTRACT, ctx.meta.pageRel]);
    assert.ok(ctx.affected.includes(CONTRACT));
    assert.ok(ctx.affected.includes(ctx.meta.pageRel));
    const contract = JSON.parse(ctx.readFinal(CONTRACT));
    const handles = contract.learningUnits.find((u) => u.id === ctx.meta.unitId).zettelNotes.map((n) => n.handle);
    for (const bad of BAD) assert.ok(!handles.includes(bad), `bad contract handle ${bad} must be gone`);
    const page = ctx.readFinal(ctx.meta.pageRel);
    for (const bad of BAD) assert.ok(!page.includes(bad), `bad page tag ${bad} must be gone`);
    for (const h of handles) assert.match(h, /^[a-z0-9]+(?:-[a-z0-9]+)+$/, `handle ${h} must be a slash-free atomic claim`);
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

    assert.ok(
      ctx.run.firstValidationFailures.some((f) => /stale caveat|later pages|formulas.*unavailable/i.test(f)),
      `pre-repair validation must catch the stale caveat; saw:\n${ctx.run.firstValidationFailures.join("\n")}`,
    );
    // Not per-unit: reconciled deterministically by the finalizer, not a request.
    assert.equal(ctx.run.requests.length, 0);
    assert.ok(ctx.finalize.changed.includes(SOURCE_MAP));
    const out = ctx.readFinal(SOURCE_MAP);
    assert.doesNotMatch(out, /Only pages 1-2 are available in full text/i);
    assert.doesNotMatch(out, /exact notation is unavailable/i);
    assert.deepEqual(ctx.affected, [SOURCE_MAP]);
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.verify.mutatedFiles, []);
    assert.match(ctx.validationReport, /^Accepted:\s+yes$/m);
  });

  test("fixture 6: section title/role mismatch is caught and retitled to match its units", { skip }, async () => {
    const ctx = await runFixture((dir) => {
      const section = findResultSection(dir); // { sectionRel, indexRel, title }
      const number = section.title.match(/^(\d+)\./)?.[1] ?? "5";
      // A title clearly unrelated to this section's units (a neuron-biophysics
      // topic on a metrics/comparison section) — an unambiguous role mismatch.
      const badTitle = `${number}. Neuron Membrane Potential Dynamics`;
      const s = read(dir, section.indexRel)
        .replace(new RegExp(`title: "${escapeRe(section.title)}"`), `title: "${badTitle}"`)
        .replace(new RegExp(`^# ${escapeRe(section.title)}$`, "m"), `# ${badTitle}`);
      write(dir, section.indexRel, s);
      return { section };
    });

    assertHealedAndAccepted(ctx, { defect: /does not match (canonical )?_index title|folder name .* does not match|SECTION_SEMANTIC_MISMATCH/i });
    assert.ok(ctx.run.requests.some((r) => r.failureTypes.includes("section_semantics")));
    for (const f of ctx.affected) {
      assert.ok(
        f.startsWith("learning/") ||
          f.startsWith("(deleted) learning/") ||
          f === "_index.md" ||
          f === SOURCE_COVERAGE ||
          f === SOURCE_VISUALS ||
          f === VISUAL_INDEX ||
          /^\.breadboard\/visuals\//.test(f),
        `unexpected file touched: ${f}`,
      );
    }
    const rewrittenIndexes = [...new Set([...ctx.affected, ...ctx.run.changedFiles])]
      .filter((f) => f.startsWith("learning/") && f.endsWith("/_index.md"));
    assert.ok(rewrittenIndexes.length > 0, "a section index must be rewritten");
    // The topic-neutral retitle can rename the section FOLDER (the new title
    // differs from the injected one), so an old _index path in changedFiles may
    // have been renamed away — check every surviving rewritten index.
    let checked = 0;
    for (const rel of rewrittenIndexes) {
      let content;
      try {
        content = ctx.readFinal(rel);
      } catch {
        continue; // renamed away by the retitle
      }
      checked += 1;
      assert.doesNotMatch(content, /Neuron Membrane Potential Dynamics/, "the mismatched title must be gone");
    }
    assert.ok(checked > 0, "at least one surviving rewritten section index must be checked");
  });

  test("baseline sanity: the un-degraded generated garden yields zero repair requests and stays accepted", { skip }, async () => {
    const ctx = await runFixture(() => {});
    assert.equal(ctx.run.requests.length, 0, "clean artifact must generate no repair requests");
    assert.equal(ctx.verify.accepted, true);
    assert.deepEqual(ctx.affected, [], "clean artifact must not be modified by the repair loop");
  });
});

// Regression tests for the source-anchor registration pipeline.
//
// The stricter final-state audit correctly fails when a page/contract references
// a semantic source anchor (e.g. "S1.P1.energy-bottleneck") that is not in the
// canonical registry. These tests prove the fix: such anchors are registered
// from source text, replaced with an equivalent canonical anchor, or left
// blocking — the audit is never weakened.

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
  repairMissingCanonicalAnchors,
  resolveSourceAnchorCandidate,
  missingRegistryAnchorIds,
  describeMissingAnchorFailure,
} from "../src/lib/final-garden-state.ts";

const REAL_GARDEN = fileURLToPath(new URL("../../quartz/content/test-2", import.meta.url));
const AVAILABLE = fs.existsSync(path.join(REAL_GARDEN, ".breadboard", "learning-unit-contract.json"));
const LIVE_GARDEN_ENABLED = /^(1|true|yes)$/i.test((process.env.BREADBOARD_TEST_LIVE_GARDEN ?? "").trim());
const skip = !LIVE_GARDEN_ENABLED
  ? "opt-in live-garden integration test; set BREADBOARD_TEST_LIVE_GARDEN=1 to run"
  : (AVAILABLE ? false : "real generated garden quartz/content/test-2 is not present");

// A reconciled baseline that already passes the audit; each test copies it and
// injects exactly one anchor defect so assertions isolate the anchor rule.
let BASELINE = null;
before(() => {
  if (!AVAILABLE) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-anchor-base-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(REAL_GARDEN, dir, { recursive: true });
  reconcileFinalGardenState(dir, "test-2");
  BASELINE = dir;
});

function freshCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-anchor-"));
  const dir = path.join(root, "test-2");
  fs.cpSync(BASELINE, dir, { recursive: true });
  return dir;
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf-8");
const write = (dir, rel, s) => fs.writeFileSync(path.join(dir, ...rel.split("/")), s, "utf-8");
const readLedger = (dir) => JSON.parse(read(dir, ".breadboard/source-anchors.json"));
const writeLedger = (dir, l) => write(dir, ".breadboard/source-anchors.json", JSON.stringify(l, null, 2) + "\n");
const readContract = (dir) => JSON.parse(read(dir, ".breadboard/learning-unit-contract.json"));
const writeContract = (dir, j) => write(dir, ".breadboard/learning-unit-contract.json", JSON.stringify(j, null, 2) + "\n");
const contractUnits = (j) => j.learningUnits ?? j.units;

/** First section-1 learner page and its learningUnitId. */
function firstSection1Page(dir) {
  const secDir = fs.readdirSync(path.join(dir, "learning"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^1\./.test(e.name)).map((e) => e.name).sort()[0];
  const rel = fs.readdirSync(path.join(dir, "learning", secDir)).find((f) => f.endsWith(".md") && f !== "_index.md");
  const pageRel = `learning/${secDir}/${rel}`;
  const unitId = (read(dir, pageRel).match(/^learningUnitId:\s*"?([^"\n]+)"?/m) ?? [])[1];
  return { pageRel, unitId };
}

function stripFromLedger(dir, ids) {
  const l = readLedger(dir);
  l.sourceStructuralAnchors = (l.sourceStructuralAnchors ?? []).filter((a) => !ids.includes(a.id));
  l.sourceTextConceptAnchors = (l.sourceTextConceptAnchors ?? []).filter((a) => !ids.includes(a.id));
  writeLedger(dir, l);
}

/** Reference `anchorId` from a page's frontmatter and its contract unit. */
function referenceAnchor(dir, pageRel, unitId, anchorId) {
  let t = read(dir, pageRel);
  if (/^sourceAnchors:/m.test(t)) {
    const cur = (t.match(/^sourceAnchors:\s*\[([^\]]*)\]/m) ?? [, ""])[1];
    if (!cur.includes(anchorId)) t = t.replace(/^sourceAnchors:\s*\[[^\]]*\]/m, `sourceAnchors: [${cur.trim() ? cur.trim() + ", " : ""}"${anchorId}"]`);
  } else {
    t = t.replace(/^---\n/, `---\nsourceAnchors: ["${anchorId}"]\n`);
  }
  write(dir, pageRel, t);
  const j = readContract(dir);
  const u = contractUnits(j).find((x) => x.id === unitId);
  u.sourceAnchors = [...new Set([...(u.sourceAnchors ?? []), anchorId])];
  writeContract(dir, j);
}

function pageAnchors(dir, pageRel) {
  return (read(dir, pageRel).match(/^sourceAnchors:\s*\[([^\]]*)\]/m)?.[1] ?? "")
    .split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

describe("source-anchor registration pipeline", { skip }, () => {
  // -------------------------------------------------------------------------
  // Test 1: a missing generated semantic anchor fails the audit.
  // -------------------------------------------------------------------------
  test("1. referenced-but-unregistered semantic anchor fails the audit", () => {
    const dir = freshCopy();
    stripFromLedger(dir, ["S1.P1.energy-bottleneck", "S1.P1.brain-comparison"]);
    const { pageRel, unitId } = firstSection1Page(dir);
    referenceAnchor(dir, pageRel, unitId, "S1.P1.energy-bottleneck");
    referenceAnchor(dir, pageRel, unitId, "S1.P1.brain-comparison");

    const audit = auditFinalGardenState(buildFinalGardenState(dir, "test-2"));
    assert.equal(audit.ok, false, "Accepted: no");
    const missing = missingRegistryAnchorIds(audit.problems);
    assert.ok(missing.includes("S1.P1.energy-bottleneck"));
    assert.ok(missing.includes("S1.P1.brain-comparison"));
    // Fix 6 wording is available and lists the ids.
    const message = describeMissingAnchorFailure(missing);
    assert.match(message, /generated as a draft but not published/);
    assert.match(message, /S1\.P1\.energy-bottleneck/);
  });

  // -------------------------------------------------------------------------
  // Test 2: repair registers the missing semantic anchor from source text.
  // -------------------------------------------------------------------------
  test("2. repair registers a missing semantic anchor from source text", () => {
    const dir = freshCopy();
    const { pageRel, unitId } = firstSection1Page(dir);
    referenceAnchor(dir, pageRel, unitId, "S1.P1.energy-bottleneck");
    stripFromLedger(dir, ["S1.P1.energy-bottleneck"]);
    assert.equal(auditFinalGardenState(buildFinalGardenState(dir, "test-2")).ok, false, "unregistered before repair");

    const repair = repairMissingCanonicalAnchors(dir, "test-2");
    assert.ok(repair.registered.includes("S1.P1.energy-bottleneck"));
    const req = repair.requests.find((r) => r.missingAnchorId === "S1.P1.energy-bottleneck");
    assert.equal(req.repairAction, "register_from_source_text");
    assert.equal(req.inferredPage, 1);

    // A canonical record now exists with a real source basis.
    const record = readLedger(dir).sourceStructuralAnchors.find((a) => a.id === "S1.P1.energy-bottleneck");
    assert.ok(record, "record written to source-anchors.json");
    assert.equal(record.page, 1);
    assert.ok(record.exactText && record.exactText.length > 0, "exactText extracted, not invented");
    assert.ok(record.semanticSummary && record.conceptKeywords.length > 0);

    // Page and contract still reference the SAME id; audit passes.
    reconcileFinalGardenState(dir, "test-2");
    assert.ok(pageAnchors(dir, pageRel).includes("S1.P1.energy-bottleneck"));
    assert.ok(contractUnits(readContract(dir)).find((u) => u.id === unitId).sourceAnchors.includes("S1.P1.energy-bottleneck"));
    assert.equal(auditFinalGardenState(buildFinalGardenState(dir, "test-2")).ok, true, "Accepted: yes after repair");
  });

  // -------------------------------------------------------------------------
  // Test 3: repair replaces a missing anchor with an equivalent existing one.
  // -------------------------------------------------------------------------
  test("3. repair replaces a missing anchor with an equivalent existing anchor", () => {
    const dir = freshCopy();
    const { pageRel, unitId } = firstSection1Page(dir);
    // Pre-register an existing canonical anchor covering the same concept, whose
    // keywords are NOT present in the source prose (so register-from-source
    // cannot fire and the repair must reuse the existing anchor instead).
    const l = readLedger(dir);
    l.sourceStructuralAnchors.push({
      id: "S1.P1.qworble-concept",
      kind: "text_concept",
      title: "Qworble concept",
      page: 1,
      sourceId: "2510-27379v1",
      semanticSummary: "Existing canonical anchor for the qworble frobnitz concept.",
      conceptKeywords: ["qworble", "frobnitz"],
    });
    writeLedger(dir, l);
    referenceAnchor(dir, pageRel, unitId, "S1.P1.qworble-frobnitz");

    const repair = repairMissingCanonicalAnchors(dir, "test-2");
    const req = repair.requests.find((r) => r.missingAnchorId === "S1.P1.qworble-frobnitz");
    assert.equal(req.repairAction, "replace_with_existing_anchor");
    assert.equal(req.replacementAnchorId, "S1.P1.qworble-concept");
    assert.deepEqual(repair.replaced, [{ from: "S1.P1.qworble-frobnitz", to: "S1.P1.qworble-concept" }]);

    // No duplicate anchor was minted for the missing id.
    assert.equal(readLedger(dir).sourceStructuralAnchors.filter((a) => a.id === "S1.P1.qworble-frobnitz").length, 0);
    // Page/contract now reference the existing canonical id.
    assert.ok(pageAnchors(dir, pageRel).includes("S1.P1.qworble-concept"));
    assert.ok(!pageAnchors(dir, pageRel).includes("S1.P1.qworble-frobnitz"));
    assert.ok(contractUnits(readContract(dir)).find((u) => u.id === unitId).sourceAnchors.includes("S1.P1.qworble-concept"));

    reconcileFinalGardenState(dir, "test-2");
    assert.equal(auditFinalGardenState(buildFinalGardenState(dir, "test-2")).ok, true, "Accepted: yes after replace");
  });

  // -------------------------------------------------------------------------
  // Test 4: an unsupported missing anchor stays blocking (garden stays draft).
  // -------------------------------------------------------------------------
  test("4. unsupported missing anchor remains blocking", () => {
    const dir = freshCopy();
    const { pageRel, unitId } = firstSection1Page(dir);
    referenceAnchor(dir, pageRel, unitId, "S1.P1.florble-zonk");

    const repair = repairMissingCanonicalAnchors(dir, "test-2");
    assert.ok(repair.unresolved.includes("S1.P1.florble-zonk"));
    assert.equal(repair.requests.find((r) => r.missingAnchorId === "S1.P1.florble-zonk").repairAction, "remove_unsupported_anchor");
    assert.equal(repair.registered.length, 0);
    assert.equal(repair.replaced.length, 0);

    // The deterministic pass does NOT silently drop the reference, so the strict
    // audit still fails and the garden remains a draft.
    reconcileFinalGardenState(dir, "test-2");
    const audit = auditFinalGardenState(buildFinalGardenState(dir, "test-2"));
    assert.equal(audit.ok, false, "Accepted: no");
    assert.ok(missingRegistryAnchorIds(audit.problems).includes("S1.P1.florble-zonk"), "unresolved issue reported");
  });

  // -------------------------------------------------------------------------
  // Fix 2 primitive: candidate resolution proves an anchor before use.
  // -------------------------------------------------------------------------
  test("resolveSourceAnchorCandidate registers only when source basis exists", () => {
    const dir = freshCopy();
    const grounded = resolveSourceAnchorCandidate(dir, {
      proposedId: "S1.P1.energy-bottleneck",
      sourceId: "2510-27379v1",
      page: 1,
      kind: "abstract",
      title: "Energy bottleneck of conventional networks",
      conceptKeywords: ["energy", "bottleneck"],
      semanticSummary: "The source motivates SNNs by contrasting event-driven computation with energy-heavy ANN processing.",
      sourceSearchTerms: ["energy", "bottleneck", "power consumption"],
      requiredForUnitIds: ["U1"],
    });
    assert.ok(grounded, "resolves against real source prose");
    assert.equal(grounded.kind, "abstract");
    assert.ok(grounded.exactText.length > 0);

    const unsupported = resolveSourceAnchorCandidate(dir, {
      proposedId: "S1.P1.florble-zonk",
      sourceId: "2510-27379v1",
      page: 1,
      kind: "text",
      title: "Florble zonk",
      conceptKeywords: ["florble", "zonk"],
      semanticSummary: "No such concept exists in the source.",
      sourceSearchTerms: ["florble", "zonk"],
      requiredForUnitIds: ["U1"],
    });
    assert.equal(unsupported, null, "an id with no source basis must not be usable");
  });
});

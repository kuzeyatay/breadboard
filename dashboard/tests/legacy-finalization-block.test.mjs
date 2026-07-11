// Fix 2: FINALIZATION blocks publish-readiness on unresolved legacy text_concept
// records, derived from the FINAL ledger and independent of any migration report.
// The block is enforced only in the finalization context (enforceLegacyFinalization),
// which the production pipeline sets AFTER migrating; loop-mechanics tests do not.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCriticLoop } from "../src/lib/critic-loop.ts";

const SRC = "paperx";
const ENERGY = "Classic networks incur high power consumption, a critical energy bottleneck for mobile and edge computing deployment.";
const legacyNumeric = (id) => ({ id, sourceId: SRC, page: 1, kind: "concept", title: "Energy bottleneck", exactText: ENERGY, semanticSummary: "energy", conceptKeywords: ["energy", "bottleneck"], confidence: 0.72 });
const modern = (id) => ({ id, sourceId: SRC, page: 1, kind: "concept", title: "Energy bottleneck", exactText: ENERGY, semanticSummary: "energy", conceptKeywords: ["energy", "bottleneck"], confidence: "high", evidence: { totalScore: 0.9 }, relevance: { decision: "relevant", totalScore: 0.8 }, migration: { migrationStatus: "migrated", previousSchema: "numeric_confidence_legacy" } });

function buildGarden(text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-lfb-"));
  const dir = path.join(root, "test-2");
  fs.mkdirSync(path.join(dir, ".breadboard", "planning"), { recursive: true });
  fs.mkdirSync(path.join(dir, "learning", "1. Concepts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sources", "paper.md"), `---\ntitle: "P"\nsourceId: "${SRC}"\n---\n\n# Page 1\n\n${ENERGY}\n`);
  fs.writeFileSync(path.join(dir, ".breadboard", "source-anchors.json"), JSON.stringify({ sourceTextConceptAnchors: text, sourceStructuralAnchors: [] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, ".breadboard", "source-visuals.json"), "[]\n");
  const refs = text.map((a) => a.id);
  fs.writeFileSync(path.join(dir, ".breadboard", "learning-unit-contract.json"), JSON.stringify({ learningUnits: [{ id: "U1", title: "Concepts", sourceAnchors: refs, sourceFigures: [], sourceFormulas: [], sourceTables: [] }] }, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "learning", "1. Concepts", "1.1 Concepts.md"), `---\ntitle: "Concepts"\nknowledge_type: "learning-page"\nbreadboardType: "learning_page"\ngenerated_by: "learn_button"\nlearningUnitId: "U1"\nsourceAnchors: [${refs.map((id) => `"${id}"`).join(", ")}]\nsourceFormulaAnchors: []\ntags: ["concept/energy", "method/snn", "topic/efficiency"]\n---\n\nThis page explains the energy bottleneck at length. ${ENERGY} It matters because dense per-inference computation dominates power draw, and event-driven spiking avoids it in mobile and edge deployments where power is scarce.\n`);
  return dir;
}
const clean = () => { for (const d of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("bb-lfb-"))) { try { fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true }); } catch {} } };

describe("legacy finalization block (Fix 2)", () => {
  test("1. a garden with an unresolved legacy text anchor is NOT publish-ready under enforceLegacyFinalization", async () => {
    const dir = buildGarden([legacyNumeric("text-paperx-energy")]);
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: () => [], options: { maxRounds: 1, strictPublish: true }, repair: () => ({ attempted: 0, resolved: 0 }), enforceLegacyFinalization: true });
    assert.equal(res.status.publishReady, false);
    assert.equal(res.status.reason, "unresolved_legacy_anchor");
    assert.equal(res.status.draftGenerated, true, "still a draft");
    clean();
  });

  test("2. the SAME legacy garden is NOT blocked by legacy when the flag is off (loop-mechanics context)", async () => {
    const dir = buildGarden([legacyNumeric("text-paperx-energy")]);
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: () => [], options: { maxRounds: 1, strictPublish: true }, repair: () => ({ attempted: 0, resolved: 0 }) });
    assert.notEqual(res.status.reason, "unresolved_legacy_anchor");
    clean();
  });

  test("3. a fully migrated (modern) garden IS publish-ready even with enforcement on", async () => {
    const dir = buildGarden([modern("text-paperx-energy")]);
    const res = await runCriticLoop({ gardenDir: dir, gardenSlug: "test-2", critic: () => [], options: { maxRounds: 1, strictPublish: true }, repair: () => ({ attempted: 0, resolved: 0 }), enforceLegacyFinalization: true });
    assert.equal(res.status.publishReady, true, JSON.stringify(res.status));
    clean();
  });
});

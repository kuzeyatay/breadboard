import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { readCriticPolicySnapshot } from "../src/lib/learn-accepted-residues.ts";
import { runCriticLoop } from "../src/lib/critic-loop.ts";

test("critic snapshots the exact policy, reports matched reasons, and does not repair accepted findings", async (t) => {
  const garden = fs.mkdtempSync(path.join(os.tmpdir(), "bb-policy-report-"));
  t.after(() => fs.rmSync(garden, { recursive: true, force: true }));
  fs.mkdirSync(path.join(garden, ".breadboard"));
  fs.mkdirSync(path.join(garden, "learning"));
  const pagePath = "learning/1.1 Lesson.md";
  fs.writeFileSync(path.join(garden, pagePath), '---\ntitle: "Lesson"\nknowledge_type: "learning-page"\nlearningUnitId: "U1"\n---\nA sentence with a known omission.\n');
  const policyPath = path.join(garden, ".breadboard/accepted-critic-residues.json");
  const reason = "A specific reviewed limitation. " + "Keep the full explanation. ".repeat(20);
  const record = { issueId: `page:*:${pagePath}`, reason, acceptedAt: "2026-09-19T10:00:00Z" };
  const bytes = JSON.stringify({ version: 1, criticMaxRounds: 1, measurementReviewNewFindings: "warn", accepted: [record] });
  fs.writeFileSync(policyPath, bytes);
  const snapshot = readCriticPolicySnapshot(garden);
  assert.equal(snapshot.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  let repairCalls = 0;
  const finding = { id: "new-id", type: "other", severity: "blocking", pagePath, repairTarget: "unit_page", problem: "A known omission.", evidence: "A sentence with a known omission.", expected: "Explain it.", suggestedRepair: "Explain it." };
  const result = await runCriticLoop({
    gardenDir: garden, gardenSlug: "policy-test", acceptedResiduePolicy: snapshot,
    options: { maxRounds: snapshot.criticMaxRounds, measurementReviewNewFindings: snapshot.measurementReviewNewFindings },
    critic: () => { fs.writeFileSync(policyPath, '{"version":1,"accepted":[]}'); return [finding]; },
    repair: () => { repairCalls++; return { attempted: 1, resolved: 0 }; },
  });
  assert.equal(repairCalls, 0);
  assert.equal(result.finalBlockingIssues.length, 0);
  assert.deepEqual(result.acceptedResidues, [finding]);
  assert.deepEqual(result.appliedAcceptancePolicy.matches[0].exceptions, [record]);
  assert.deepEqual(result.finalDecision?.verifiedCriticBlockers, []);
  const report = fs.readFileSync(path.join(garden, ".breadboard/critic-report.md"), "utf8");
  for (const expected of [reason, record.issueId, record.acceptedAt, snapshot.sha256, finding.id, finding.type, pagePath, "Effective maximum rounds: 1", "New measurement findings: warn"]) assert.ok(report.includes(expected), expected);
  for (const filename of ["critic-loop.json", "critic-issues.json", "acceptance-status.json"]) {
    const json = JSON.parse(fs.readFileSync(path.join(garden, ".breadboard", filename), "utf8"));
    assert.deepEqual(json.appliedAcceptancePolicy.snapshot, snapshot);
    assert.equal(json.appliedAcceptancePolicy.matches[0].exceptions[0].reason, reason);
  }
  // The report remains an audit of the decision actually used, even after edit.
  assert.equal(readCriticPolicySnapshot(garden).records.length, 0);
});

test("an unrelated acceptance never hides or stops repair of another blocker", async (t) => {
  const garden = fs.mkdtempSync(path.join(os.tmpdir(), "bb-policy-unaccepted-"));
  t.after(() => fs.rmSync(garden, { recursive: true, force: true }));
  fs.mkdirSync(path.join(garden, ".breadboard"));
  const finding = { id: "unaccepted", type: "other", severity: "blocking", repairTarget: "global", problem: "Unresolved concept.", evidence: "Known omission.", expected: "Explain.", suggestedRepair: "Fix." };
  let calls = 0;
  const result = await runCriticLoop({ gardenDir: garden, gardenSlug: "test", critic: () => [finding], options: { maxRounds: 1 }, acceptedResidueIssueIds: ["different-issue"], repair: () => { calls++; return { attempted: 1, resolved: 0 }; }, writeReports: false });
  assert.equal(calls, 1);
  assert.equal(result.status.publishReady, false);
  assert.equal(result.finalBlockingIssues[0].id, finding.id);
});

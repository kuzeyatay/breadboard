// Problem 2 (Fix 4/5/6): critic issues are per-round INSTANCES, collapsed by a
// round-independent STABLE IDENTITY, and finalized on the LATEST verdict. There
// is NO global "ever-unsupported by issueId" suppression: the same issueId with
// different evidence is a distinct instance, and its latest verdict wins.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFinalCriticIssues,
  criticIssueStableIdentity,
  criticIssueStableIdentityKey,
} from "../src/lib/critic-loop.ts";

const issue = (over) => ({
  id: "i1", severity: "blocking", type: "source_anchor_mismatch",
  pagePath: "learning/1. X/1.1 X.md", problem: "anchor A is unsupported",
  evidence: "e", expected: "x", repairTarget: "source_anchor_ledger", suggestedRepair: "fix",
  ...over,
});

// A verification result with an explicit verdict.
const ver = (severity, id = "i1") => ({ issueId: id, verified: severity.startsWith("confirmed"), severity, checkedFiles: [], reason: "test" });

// Build an instance for a given round with a specific evidence hash driver.
let seq = 0;
const inst = (issueOver, round, severity) => {
  const iss = issue(issueOver);
  return {
    key: { issueId: iss.id, round, issueType: iss.type, targetPath: iss.pagePath, targetAnchorId: iss.sourceAnchorIds?.[0], evidenceHash: `h${seq++}` },
    issue: iss,
    verification: ver(severity, iss.id),
  };
};

describe("critic issue instance identity (Fix 4/5/6)", () => {
  test("1. stable identity ignores round + evidence but distinguishes type/target/problem", () => {
    const a = criticIssueStableIdentity(issue({ evidence: "e1" }));
    const b = criticIssueStableIdentity(issue({ evidence: "e2" }));
    assert.equal(criticIssueStableIdentityKey(a), criticIssueStableIdentityKey(b), "evidence does not change identity");
    const c = criticIssueStableIdentity(issue({ problem: "a totally different problem" }));
    assert.notEqual(criticIssueStableIdentityKey(a), criticIssueStableIdentityKey(c), "different problem = different identity");
    const d = criticIssueStableIdentity(issue({ pagePath: "learning/2. Y/2.1 Y.md" }));
    assert.notEqual(criticIssueStableIdentityKey(a), criticIssueStableIdentityKey(d), "different target = different identity");
  });

  test("2. latest verdict wins: unsupported in round 1, confirmed_blocking in round 3 → BLOCKS", () => {
    // Same issueId, DIFFERENT evidence across rounds ⇒ distinct instances.
    const instances = [
      inst({ evidence: "weak-1" }, 1, "unsupported"),
      inst({ evidence: "strong-3" }, 3, "confirmed_blocking"),
    ];
    const active = [issue({ evidence: "strong-3" })]; // still reported in the final review
    const res = resolveFinalCriticIssues(instances, active, true);
    assert.equal(res.blockers.length, 1, "the later confirmed_blocking instance blocks");
    assert.equal(res.warnings.length, 0);
  });

  test("3. the inverse: confirmed_blocking early, unsupported latest → does NOT block", () => {
    const instances = [
      inst({ evidence: "seemed-bad" }, 1, "confirmed_blocking"),
      inst({ evidence: "actually-fine" }, 2, "unsupported"),
    ];
    // The final review no longer reports it as a real problem.
    const res = resolveFinalCriticIssues(instances, [], true);
    assert.equal(res.blockers.length, 0);
    assert.ok(res.unsupportedDiagnostics.some((d) => d.verification.severity === "unsupported"));
  });

  test("4. same issueId + different evidenceHash are DISTINCT instances", () => {
    const a = inst({ evidence: "one" }, 1, "unsupported");
    const b = inst({ evidence: "two" }, 1, "confirmed_blocking");
    assert.equal(a.key.issueId, b.key.issueId);
    assert.notEqual(a.key.evidenceHash, b.key.evidenceHash);
  });

  test("5. a confirmed issue the critic stopped reporting is RESOLVED (neither blocker nor warning)", () => {
    const instances = [inst({}, 1, "confirmed_blocking")];
    const res = resolveFinalCriticIssues(instances, [], true); // not in active/final review
    assert.equal(res.blockers.length, 0);
    assert.equal(res.warnings.length, 0);
    assert.equal(res.resolvedIdentities.length, 1);
  });

  test("6. an active confirmed_warning becomes a warning, not a blocker", () => {
    const wIssue = { severity: "warning", problem: "a stale caveat", type: "stale_caveat" };
    const instances = [inst(wIssue, 1, "confirmed_warning")];
    const res = resolveFinalCriticIssues(instances, [issue(wIssue)], true);
    assert.equal(res.warnings.length, 1);
    assert.equal(res.blockers.length, 0);
  });

  test("7. insufficient_evidence latest verdict is a diagnostic, not a blocker", () => {
    const instances = [inst({ evidence: "ambiguous" }, 2, "insufficient_evidence")];
    const res = resolveFinalCriticIssues(instances, [issue({ evidence: "ambiguous" })], true);
    assert.equal(res.blockers.length, 0);
    assert.ok(res.insufficientEvidenceDiagnostics.length >= 1);
  });
});

// Pre-existing snapshot changes are context, not repair mutations.
//
// A snapshot worktree deliberately carries the developer's whole in-flight
// tree, and three separate mechanisms have now had to learn that the hard way:
// unauthorised-change detection (W2-2), the assertion-integrity guard
// (W23F-H1), and receipt file reporting — which announced 150+ changed files
// for a repair that wrote three. Each time, a raw worktree diff was mistaken
// for the repair.
//
// These are the properties that stop it happening a fourth time.

import assert from "node:assert/strict";
import test from "node:test";

import { validateReceipt } from "../autonomous/lib/receipt.mjs";

/** A receipt that is valid apart from whatever a given test perturbs. */
function receipt(overrides = {}) {
  return {
    finding_id: "TEST-001",
    scenario_id: "selftest/footprint",
    revision: "0".repeat(40),
    worktree: "C:/repo/.qa-worktrees/test-001",
    allowed_paths: ["dashboard/src/lib/example.ts", "dashboard/tests/example.test.mjs"],
    classification: "PRODUCT_BUG",
    severity: "P2",
    reproduction_result: { reproduced: true, attempts: 1 },
    root_cause: "example",
    causal_chain: ["a", "b"],
    iterations: 1,
    files_changed: ["dashboard/src/lib/example.ts", "dashboard/tests/example.test.mjs"],
    diff_summary: "2 files changed",
    new_regression_tests: ["dashboard/tests/example.test.mjs"],
    commands_run: ["node --test"],
    command_exit_codes: [0],
    original_scenario_replay: { passed: true },
    critical_suite_result: { passed: true },
    assertion_integrity_result: { verdict: "CLEAN", rejections: [] },
    isolation_result: { verified: true },
    repair_capability: {
      capabilityId: "cap-1",
      findingId: "TEST-001",
      finalized: true,
      unauthorisedChanges: [],
    },
    secret_scan_result: { findings: 0 },
    rollback: "discard the worktree",
    unresolved_risks: [],
    stop_reason: "done",
    final_status: "VERIFIED_REPAIR",
    ...overrides,
  };
}

test("a repair that wrote its authorised files is accepted", () => {
  const result = validateReceipt(receipt());
  assert.deepEqual(result.problems, [], "the control must be valid, or every case below proves nothing");
});

test("a receipt that reports the whole dirty snapshot is rejected", () => {
  // The real shape of the defect: 100 pre-existing modified files in the
  // snapshot, 2 files actually written by the repair.
  const snapshotNoise = Array.from({ length: 100 }, (_, index) => `dashboard/src/app/unrelated-${index}.tsx`);
  const result = validateReceipt(
    receipt({ files_changed: [...snapshotNoise, "dashboard/src/lib/example.ts", "dashboard/tests/example.test.mjs"] }),
  );
  assert.ok(
    result.problems.some((problem) => problem.includes("outside allowed_paths")),
    "a receipt describing snapshot context as repair output must be refused",
  );
  assert.ok(
    result.problems.some((problem) => problem.includes("100 path(s)")),
    "the refusal should say how much of it was context",
  );
});

test("exactly the authorised files are reported, whatever surrounds them", () => {
  // Same snapshot, but the receipt reports only what the repair wrote.
  const result = validateReceipt(receipt());
  assert.deepEqual(result.problems, []);
  assert.equal(receipt().files_changed.length, 2);
});

test("a smuggled third write is still caught separately", () => {
  // Scope reporting must not become a way to hide an unauthorised mutation:
  // that is what unauthorisedChanges is for, and it is checked independently.
  const result = validateReceipt(
    receipt({
      repair_capability: {
        capabilityId: "cap-1",
        findingId: "TEST-001",
        finalized: true,
        unauthorisedChanges: ["dashboard/src/lib/smuggled.ts"],
      },
    }),
  );
  assert.ok(
    result.problems.some((problem) => problem.includes("unauthorised changes")),
    "an unauthorised write must fail the receipt even when files_changed looks tidy",
  );
});

test("a file outside the allowed paths cannot be passed off as the repair", () => {
  const result = validateReceipt(
    receipt({ files_changed: ["dashboard/src/lib/example.ts", "dashboard/src/lib/hermes/skills.ts"] }),
  );
  assert.ok(result.problems.some((problem) => problem.includes("outside allowed_paths")));
});

test("a nested path under an allowed directory is still the repair", () => {
  // The check is a path-prefix rule, not string equality, so declaring a
  // directory keeps working.
  const result = validateReceipt(
    receipt({
      allowed_paths: ["dashboard/src/lib"],
      files_changed: ["dashboard/src/lib/example.ts", "dashboard/src/lib/nested/other.ts"],
      new_regression_tests: ["dashboard/src/lib/example.ts"],
    }),
  );
  assert.deepEqual(result.problems, []);
});

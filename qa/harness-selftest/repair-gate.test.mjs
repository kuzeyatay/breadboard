import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSeedablePath,
  classifyPath,
  enforceChangedFiles,
  evaluateRepairGate,
  MUTATION_SCOPE,
  NON_REPAIR_CLASSIFICATIONS,
  PATH_KIND,
} from "../autonomous/lib/repair-gate.mjs";

/**
 * These tests are the structural proof behind Week 1 exit criteria 5, 6 and 7:
 * a failure that is not a reproduced PRODUCT_BUG cannot authorise a production
 * source edit, no matter what a model decides it would like to do.
 */

function productBugFinding(overrides = {}) {
  return {
    status: "failed",
    classification: "PRODUCT_BUG",
    reproduction: { reproduced: true, attempts: 1 },
    diagnosis: {
      rootCause: "the garden rename handler writes the old slug",
      responsibleCodePath: "dashboard/src/app/actions/clusters.ts",
    },
    ...overrides,
  };
}

test("a reproduced, root-caused PRODUCT_BUG is the only path to production source", () => {
  const gate = evaluateRepairGate(productBugFinding());
  assert.equal(gate.productionSourceMutationAllowed, true);
  assert.equal(gate.allowedMutationScope, MUTATION_SCOPE.PRODUCTION_SOURCE);
  assert.deepEqual(gate.blockingReasons, []);
});

for (const classification of NON_REPAIR_CLASSIFICATIONS) {
  test(`${classification} can never mutate production source`, () => {
    const gate = evaluateRepairGate(productBugFinding({ classification }));
    assert.equal(
      gate.productionSourceMutationAllowed,
      false,
      `${classification} must not authorise a production edit`,
    );
    assert.notEqual(gate.allowedMutationScope, MUTATION_SCOPE.PRODUCTION_SOURCE);
    assert.ok(
      gate.blockingReasons.some((reason) => reason.includes("not repair eligible")),
      "the gate must state why production mutation was denied",
    );
  });
}

test("TEST_ENVIRONMENT permits a harness fix but no production edit", () => {
  const gate = evaluateRepairGate(productBugFinding({ classification: "TEST_ENVIRONMENT" }));
  assert.equal(gate.productionSourceMutationAllowed, false);
  assert.equal(gate.qaHarnessMutationAllowed, true);
  assert.equal(gate.allowedMutationScope, MUTATION_SCOPE.QA_HARNESS_ONLY);
});

test("EXTERNAL_DEPENDENCY permits nothing at all", () => {
  const gate = evaluateRepairGate(productBugFinding({ classification: "EXTERNAL_DEPENDENCY" }));
  assert.equal(gate.productionSourceMutationAllowed, false);
  assert.equal(gate.qaHarnessMutationAllowed, false);
  assert.equal(gate.allowedMutationScope, MUTATION_SCOPE.NONE);
});

test("FLAKY never authorises an automatic production edit", () => {
  const gate = evaluateRepairGate(productBugFinding({ classification: "FLAKY" }));
  assert.equal(gate.productionSourceMutationAllowed, false);
  assert.equal(gate.allowedMutationScope, MUTATION_SCOPE.NONE);
});

test("MISSING_FEATURE always raises a human gate", () => {
  const gate = evaluateRepairGate(productBugFinding({ classification: "MISSING_FEATURE" }));
  assert.equal(gate.requiresHumanGate, true);
  assert.equal(gate.productionSourceMutationAllowed, false);
});

test("an unknown classification fails closed", () => {
  const gate = evaluateRepairGate(productBugFinding({ classification: "PROBABLY_FINE" }));
  assert.equal(gate.productionSourceMutationAllowed, false);
  assert.equal(gate.allowedMutationScope, MUTATION_SCOPE.NONE);
  assert.ok(gate.blockingReasons.some((reason) => reason.includes("failing closed")));
});

test("a PRODUCT_BUG that was not reproduced cannot be repaired", () => {
  const gate = evaluateRepairGate(
    productBugFinding({ reproduction: { reproduced: false, attempts: 1 } }),
  );
  assert.equal(gate.productionSourceMutationAllowed, false);
  assert.ok(gate.blockingReasons.some((reason) => reason.includes("not reproduced")));
});

test("a PRODUCT_BUG without a root cause cannot be repaired", () => {
  const gate = evaluateRepairGate(
    productBugFinding({ diagnosis: { rootCause: "   ", responsibleCodePath: "x.ts" } }),
  );
  assert.equal(gate.productionSourceMutationAllowed, false);
  assert.ok(gate.blockingReasons.some((reason) => reason.includes("rootCause")));
});

test("a passing scenario cannot authorise a repair", () => {
  const gate = evaluateRepairGate(productBugFinding({ status: "passed" }));
  assert.equal(gate.productionSourceMutationAllowed, false);
});

test("a passing TEST_ENVIRONMENT finding cannot authorise even a harness edit", () => {
  const gate = evaluateRepairGate(
    productBugFinding({ status: "passed", classification: "TEST_ENVIRONMENT" }),
  );
  assert.equal(gate.productionSourceMutationAllowed, false);
  assert.equal(gate.qaHarnessMutationAllowed, false);
  assert.equal(gate.allowedMutationScope, MUTATION_SCOPE.NONE);
});

test("path classification separates product, oracle, harness, and trust boundaries", () => {
  assert.equal(classifyPath("dashboard/src/lib/db.ts").kind, PATH_KIND.PRODUCT);
  assert.equal(classifyPath("desktop/src/main.ts").kind, PATH_KIND.PRODUCT);
  assert.equal(classifyPath("qa/electron/specs/critical/journeys.spec.ts").kind, PATH_KIND.QA_ORACLE);
  assert.equal(classifyPath("qa/autonomous/scenarios.json").kind, PATH_KIND.QA_ORACLE);
  assert.equal(classifyPath("dashboard/tests/graft-code-index.test.mjs").kind, PATH_KIND.QA_ORACLE);
  assert.equal(classifyPath("qa/electron/fixtures.ts").kind, PATH_KIND.QA_HARNESS);
  assert.equal(classifyPath(".qa-results/week1/run/baseline.json").kind, PATH_KIND.QA_EVIDENCE);
  assert.equal(classifyPath("package.json").kind, PATH_KIND.INFRASTRUCTURE);
});

test("a bare oracle directory is an oracle, not production source", () => {
  // Week 2 regression: patterns are written against files, so a directory
  // prefix used to fall through to PRODUCT and could be named as an allowed
  // repair path — scoping a product repair over a tree full of assertions.
  for (const directory of ["dashboard/tests", "desktop/tests", "qa/electron/specs", "qa/fixtures"]) {
    assert.equal(
      classifyPath(directory).kind,
      PATH_KIND.QA_ORACLE,
      `${directory} must classify as a QA oracle`,
    );
  }
  assert.equal(classifyPath("dashboard/src/lib").kind, PATH_KIND.PRODUCT);
  assert.equal(classifyPath("desktop/src/main").kind, PATH_KIND.PRODUCT);
});

test("trust boundaries are classified forbidden on Windows and POSIX separators", () => {
  for (const forbidden of [
    "dashboard/src/lib/server-auth.ts",
    "dashboard\\src\\lib\\server-auth.ts",
    "dashboard/src/app/api/auth/route.ts",
    "desktop/src/preload.ts",
    "dashboard/src/lib/hermes/capability-tokens.ts",
    "dashboard/src/lib/permissions/gate.ts",
    "gbrain/migrations/0001_init.sql",
    "desktop/build/installer.nsh",
    "package-lock.json",
    ".env.local",
    "node_modules/left-pad/index.js",
  ]) {
    assert.equal(
      classifyPath(forbidden).kind,
      PATH_KIND.FORBIDDEN,
      `${forbidden} must be a forbidden trust boundary`,
    );
  }
});

test("changed-file enforcement rejects a production edit under a non-product gate", () => {
  const gate = evaluateRepairGate(productBugFinding({ classification: "TEST_ENVIRONMENT" }));
  const verdict = enforceChangedFiles({
    gate,
    changedFiles: ["dashboard/src/lib/quartz-garden-index.ts"],
    allowedPaths: ["dashboard/src"],
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.verdict, "REJECTED");
  assert.ok(verdict.violations.some((violation) => violation.rule === "production-mutation-denied"));
});

test("changed-file enforcement rejects anything outside the allowed paths", () => {
  const gate = evaluateRepairGate(productBugFinding());
  const verdict = enforceChangedFiles({
    gate,
    changedFiles: ["dashboard/src/app/actions/clusters.ts", "dashboard/src/lib/db.ts"],
    allowedPaths: ["dashboard/src/app/actions"],
  });
  assert.equal(verdict.allowed, false);
  assert.ok(
    verdict.violations.some(
      (violation) => violation.rule === "outside-allowed-paths" && violation.path.endsWith("db.ts"),
    ),
  );
});

test("changed-file enforcement rejects a forbidden path even for a valid PRODUCT_BUG", () => {
  const gate = evaluateRepairGate(productBugFinding());
  const verdict = enforceChangedFiles({
    gate,
    changedFiles: ["dashboard/src/lib/server-auth.ts"],
    allowedPaths: ["dashboard/src"],
  });
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.violations.some((violation) => violation.rule === "forbidden-path"));
});

test("touching a QA oracle always demands assertion-integrity review", () => {
  const gate = evaluateRepairGate(productBugFinding());
  const verdict = enforceChangedFiles({
    gate,
    changedFiles: [
      "dashboard/src/app/actions/clusters.ts",
      "qa/electron/specs/critical/journeys.spec.ts",
    ],
    allowedPaths: ["dashboard/src/app/actions", "qa/electron/specs"],
  });
  assert.equal(verdict.verdict, "REVIEW_REQUIRED");
  assert.ok(verdict.reviewRequired.some((entry) => entry.rule === "qa-oracle-modified"));
});

test("a controlled experiment cannot seed a defect in a trust boundary", () => {
  assert.throws(
    () => assertSeedablePath("dashboard/src/lib/server-auth.ts"),
    /Refusing to seed a controlled defect/,
  );
  assert.throws(() => assertSeedablePath("qa/electron/fixtures.ts"), /qa-harness/);
  assert.equal(assertSeedablePath("dashboard/src/lib/quartz-garden-index.ts").kind, PATH_KIND.PRODUCT);
});

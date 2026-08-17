import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reviewAssertionIntegrity,
  VERDICT,
} from "../autonomous/lib/assertion-integrity.mjs";

/**
 * Week 1 exit criterion 8. Each case is a diff a self-healer might actually
 * produce when it is easier to soften the oracle than to fix the product.
 */

function diff(file, removed, added) {
  const body = [
    `diff --git a/${file} b/${file}`,
    "--- a/" + file,
    "+++ b/" + file,
    "@@ -1,4 +1,4 @@",
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ];
  return body.join("\n");
}

const ORACLE = "qa/electron/specs/critical/journeys.spec.ts";

test("an unmodified oracle and an ordinary product edit are clean", () => {
  const review = reviewAssertionIntegrity(
    diff(
      "dashboard/src/lib/quartz-garden-index.ts",
      ["  return `${base}/${slug}`;"],
      ["  return `${base}/${encodeURIComponent(slug)}`;"],
    ),
  );
  assert.equal(review.verdict, VERDICT.CLEAN);
  assert.deepEqual(review.rejections, []);
});

test("deleting assertions from an oracle is rejected", () => {
  const review = reviewAssertionIntegrity(
    diff(
      ORACLE,
      [
        "    await expect(heading).toHaveText('Project Firefly');",
        "    await expect(body).toHaveText('FIREFLY-COPPER-17');",
      ],
      ["    await expect(heading).toHaveText('Project Firefly');"],
    ),
  );
  assert.equal(review.verdict, VERDICT.REJECTED);
  assert.ok(review.rejections.some((entry) => entry.rule === "assertions-removed"));
});

test("introducing test.skip during repair is rejected", () => {
  const review = reviewAssertionIntegrity(
    diff(ORACLE, ["  test('ingests a markdown fixture', async ({ qa }) => {"], [
      "  test.skip('ingests a markdown fixture', async ({ qa }) => {",
    ]),
  );
  assert.equal(review.verdict, VERDICT.REJECTED);
  assert.ok(review.rejections.some((entry) => entry.rule === "skip-introduced"));
});

test("introducing test.only during repair is rejected anywhere", () => {
  const review = reviewAssertionIntegrity(
    diff(ORACLE, ["  test('a', async () => {"], ["  test.only('a', async () => {"]),
  );
  assert.ok(review.rejections.some((entry) => entry.rule === "only-introduced"));
});

test("inflating a timeout without a proven timing defect is rejected", () => {
  const review = reviewAssertionIntegrity(
    diff(ORACLE, ["    await link.click({ timeout: 30_000 });"], [
      "    await link.click({ timeout: 600_000 });",
    ]),
  );
  assert.equal(review.verdict, VERDICT.REJECTED);
  assert.ok(review.rejections.some((entry) => entry.rule === "timeout-inflated"));
});

test("a modest timeout adjustment is only flagged, not auto-rejected", () => {
  const review = reviewAssertionIntegrity(
    diff(ORACLE, ["    await link.click({ timeout: 30_000 });"], [
      "    await link.click({ timeout: 45_000 });",
    ]),
  );
  assert.equal(review.verdict, VERDICT.REVIEW_REQUIRED);
  assert.deepEqual(review.rejections, []);
});

test("a new regression test that sets its own bound is not treated as inflation", () => {
  // Regression for a guard false positive found while running the Week 1
  // controlled experiments: a brand-new oracle file has nothing to inflate.
  const review = reviewAssertionIntegrity(
    diff("desktop/tests/qa-regression-readiness.test.ts", [], [
      "test('readiness rejects 5xx', async () => {",
      "  await runHealthCheck({ type: 'http', url, timeoutMs: 1000 });",
      "});",
    ]),
  );
  assert.deepEqual(review.rejections, []);
  assert.equal(review.verdict, VERDICT.REVIEW_REQUIRED);
});

test("a new oracle introducing an unusually large bound is flagged for a human", () => {
  const review = reviewAssertionIntegrity(
    diff("qa/electron/specs/critical/slow.spec.ts", [], [
      "  await page.click('#go', { timeout: 900_000 });",
    ]),
  );
  assert.deepEqual(review.rejections, []);
  assert.ok(review.findings.some((entry) => entry.rule === "large-timeout-introduced"));
});

test("replacing an exact comparison with truthiness is rejected", () => {
  const review = reviewAssertionIntegrity(
    diff(ORACLE, ["    expect(slug).toBe('critical-qa-garden');"], [
      "    expect(slug).toBeTruthy();",
    ]),
  );
  assert.equal(review.verdict, VERDICT.REJECTED);
  assert.ok(review.rejections.some((entry) => entry.rule === "exact-comparison-weakened"));
});

test("increasing retries is rejected", () => {
  const review = reviewAssertionIntegrity(
    diff("qa/electron/specs/critical/bootstrap.spec.ts", ["  retries: 0,"], ["  retries: 3,"]),
  );
  assert.equal(review.verdict, VERDICT.REJECTED);
  assert.ok(review.rejections.some((entry) => entry.rule === "retries-increased"));
});

test("dropping an expected-error assertion is rejected", () => {
  const review = reviewAssertionIntegrity(
    diff(
      ORACLE,
      ["    await expect(request()).rejects.toThrow(/forbidden/);"],
      ["    await request().catch(() => undefined);"],
    ),
  );
  assert.equal(review.verdict, VERDICT.REJECTED);
  assert.ok(review.rejections.some((entry) => entry.rule === "expected-error-dropped"));
});

test("introducing a swallowing catch in an oracle is rejected", () => {
  const review = reviewAssertionIntegrity(
    diff(ORACLE, ["    await assertGardenWorkspace(qa.page, garden);"], [
      "    try { await assertGardenWorkspace(qa.page, garden); } catch { }",
    ]),
  );
  assert.equal(review.verdict, VERDICT.REJECTED);
  assert.ok(review.rejections.some((entry) => entry.rule === "exception-swallowed"));
});

test("removing a scenario success criterion is rejected", () => {
  const review = reviewAssertionIntegrity(
    diff(
      "qa/autonomous/scenarios.json",
      [
        '      "the renamed garden keeps its notes",',
        '      "the rename survives a reload"',
      ],
      ['      "the renamed garden keeps its notes"'],
    ),
  );
  assert.equal(review.verdict, VERDICT.REJECTED);
  assert.ok(review.rejections.some((entry) => entry.rule === "success-criteria-weakened"));
});

test("an oracle change during an undeclared repair is flagged for human review", () => {
  const review = reviewAssertionIntegrity(
    diff(ORACLE, ["    const name = 'garden';"], ["    const name = 'garden-two';"]),
  );
  assert.equal(review.verdict, VERDICT.REVIEW_REQUIRED);
  assert.ok(review.findings.some((entry) => entry.rule === "undeclared-oracle-change"));
});

test("a declared harness fix still requires review but is labelled as declared", () => {
  const review = reviewAssertionIntegrity(
    diff(ORACLE, ["    const name = 'garden';"], ["    const name = 'garden-two';"]),
    { classification: "TEST_ENVIRONMENT" },
  );
  assert.equal(review.verdict, VERDICT.REVIEW_REQUIRED);
  assert.ok(review.findings.some((entry) => entry.rule === "declared-harness-oracle-change"));
});

test("a declared harness fix cannot smuggle in an oracle weakening", () => {
  const review = reviewAssertionIntegrity(
    diff(ORACLE, ["    expect(count).toBe(3);"], ["    expect(count).toBeDefined();"]),
    { classification: "TEST_ENVIRONMENT" },
  );
  assert.equal(review.verdict, VERDICT.REJECTED);
});

test("adding a regression test alongside a product fix stays clean of rejections", () => {
  const combined = [
    diff(
      "dashboard/src/lib/quartz-garden-index.ts",
      ["  const target = base + slug;"],
      ["  const target = `${base}/${slug}`;"],
    ),
    diff(
      "dashboard/tests/garden-index.test.mjs",
      [],
      [
        "test('index links use a path separator', () => {",
        "  assert.equal(indexLink('a', 'b'), 'a/b');",
        "});",
      ],
    ),
  ].join("\n");
  const review = reviewAssertionIntegrity(combined);
  assert.deepEqual(review.rejections, []);
  assert.equal(review.verdict, VERDICT.REVIEW_REQUIRED);
});

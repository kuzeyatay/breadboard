import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  scanForSecrets,
  validateReceipt,
  writeReceipt,
} from "../autonomous/lib/receipt.mjs";

function completeReceipt(overrides = {}) {
  return {
    finding_id: "seed-garden-slug",
    scenario_id: "garden-create-rename-return",
    revision: "91ed121d7709d89c872de63b84d16e55aa3be95c",
    worktree: ".qa-worktrees/seed-garden-slug",
    allowed_paths: ["dashboard/src/lib"],
    classification: "PRODUCT_BUG",
    severity: "P2",
    reproduction_result: "reproduced once against the isolated precondition",
    root_cause: "the rename path joined the base and slug without a separator",
    causal_chain: ["rename writes index", "index link is malformed", "note link 404s"],
    iterations: 1,
    files_changed: ["dashboard/src/lib/quartz-garden-index.ts"],
    diff_summary: " 1 file changed, 1 insertion(+), 1 deletion(-)",
    new_regression_tests: ["dashboard/tests/garden-index.test.mjs"],
    commands_run: ["npm run test:dashboard"],
    command_exit_codes: [0],
    original_scenario_replay: { passed: true, detail: "replayed through Electron" },
    critical_suite_result: { passed: true },
    assertion_integrity_result: { verdict: "CLEAN" },
    isolation_result: { verified: true },
    repair_capability: {
      capabilityId: "11111111-1111-1111-1111-111111111111",
      findingId: "seed-garden-slug",
      finalized: true,
      unauthorisedChanges: [],
      authorisedWrites: ["dashboard/src/lib/quartz-garden-index.ts"],
    },
    secret_scan_result: { clean: true },
    rollback: "git worktree remove --force .qa-worktrees/seed-garden-slug",
    unresolved_risks: [],
    stop_reason: "scenario_criteria_verified_and_receipt_written",
    final_status: "VERIFIED_REPAIR",
    ...overrides,
  };
}

test("a complete receipt validates", () => {
  assert.deepEqual(validateReceipt(completeReceipt()).problems, []);
});

test("a receipt missing required fields is rejected", () => {
  const receipt = completeReceipt();
  delete receipt.root_cause;
  delete receipt.rollback;
  const result = validateReceipt(receipt);
  assert.equal(result.valid, false);
  assert.ok(result.problems.some((problem) => problem.includes("root_cause")));
  assert.ok(result.problems.some((problem) => problem.includes("rollback")));
});

test("an unknown final status is rejected", () => {
  const result = validateReceipt(completeReceipt({ final_status: "PROBABLY_FINE" }));
  assert.equal(result.valid, false);
});

test("VERIFIED_REPAIR cannot be claimed without a passing replay", () => {
  const result = validateReceipt(
    completeReceipt({ original_scenario_replay: { passed: false } }),
  );
  assert.equal(result.valid, false);
  assert.ok(result.problems.some((problem) => problem.includes("replay")));
});

test("VERIFIED_REPAIR cannot be claimed without a regression test", () => {
  const result = validateReceipt(completeReceipt({ new_regression_tests: [] }));
  assert.equal(result.valid, false);
});

test("VERIFIED_REPAIR cannot be claimed for a non-product classification", () => {
  const result = validateReceipt(completeReceipt({ classification: "TEST_ENVIRONMENT" }));
  assert.equal(result.valid, false);
});

test("VERIFIED_REPAIR cannot be claimed over a rejected assertion-integrity verdict", () => {
  const result = validateReceipt(
    completeReceipt({ assertion_integrity_result: { verdict: "REJECTED" } }),
  );
  assert.equal(result.valid, false);
});

test("VERIFIED_REPAIR cannot be claimed without verified isolation", () => {
  const result = validateReceipt(completeReceipt({ isolation_result: { verified: false } }));
  assert.equal(result.valid, false);
});

test("commands and exit codes must correspond", () => {
  const result = validateReceipt(
    completeReceipt({ commands_run: ["a", "b"], command_exit_codes: [0] }),
  );
  assert.equal(result.valid, false);
});

test("the secret scanner catches the encodings QA artifacts realistically leak", () => {
  const samples = [
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
    "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123456789",
    "-----BEGIN RSA PRIVATE KEY-----",
    "AKIAIOSFODNN7EXAMPLE",
    'hermesCapabilitySecret: "9f2b1c8e4a6d0f3b7e5c1a9d"',
  ];
  for (const sample of samples) {
    assert.equal(scanForSecrets(sample).clean, false, `should have flagged: ${sample}`);
  }
  assert.equal(scanForSecrets("the rename handler joined paths without a separator").clean, true);
});

test("a receipt containing secret-like material is never written", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-receipt-"));
  try {
    assert.throws(
      () =>
        writeReceipt({
          receipt: completeReceipt({
            root_cause: "the session used Bearer abcdefghijklmnopqrstuvwxyz012345",
          }),
          outputDir: dir,
        }),
      /secret-like material/,
    );
    assert.deepEqual(fs.readdirSync(dir), [], "no partial receipt may be left behind");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an invalid receipt is never written", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-receipt-"));
  try {
    assert.throws(
      () => writeReceipt({ receipt: completeReceipt({ final_status: "NOPE" }), outputDir: dir }),
      /invalid repair receipt/,
    );
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a valid receipt writes both machine and human artifacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-receipt-"));
  try {
    const written = writeReceipt({ receipt: completeReceipt(), outputDir: dir });
    const parsed = JSON.parse(fs.readFileSync(written.jsonPath, "utf8"));
    assert.equal(parsed.final_status, "VERIFIED_REPAIR");
    assert.equal(parsed.schemaVersion, 1);
    const markdown = fs.readFileSync(written.markdownPath, "utf8");
    assert.match(markdown, /# Repair receipt: seed-garden-slug/);
    assert.match(markdown, /VERIFIED_REPAIR/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("VERIFIED_REPAIR cannot be claimed without a finalized repair capability", () => {
  const result = validateReceipt(
    completeReceipt({ repair_capability: { capabilityId: "x", findingId: "seed-garden-slug", finalized: false, unauthorisedChanges: [] } }),
  );
  assert.equal(result.valid, false);
  assert.ok(result.problems.some((problem) => problem.includes("finalized repair capability")));
});

test("VERIFIED_REPAIR cannot be claimed when the worktree was written outside the capability", () => {
  const result = validateReceipt(
    completeReceipt({
      repair_capability: {
        capabilityId: "x",
        findingId: "seed-garden-slug",
        finalized: true,
        unauthorisedChanges: ["dashboard/src/lib/smuggled.ts"],
      },
    }),
  );
  assert.equal(result.valid, false);
  assert.ok(result.problems.some((problem) => problem.includes("unauthorised changes")));
});

test("a repair capability belonging to a different finding is rejected", () => {
  const result = validateReceipt(
    completeReceipt({
      repair_capability: {
        capabilityId: "x",
        findingId: "some-other-finding",
        finalized: true,
        unauthorisedChanges: [],
      },
    }),
  );
  assert.equal(result.valid, false);
});

test("the named-secret rule fires on values, not on source identifiers", () => {
  // Real secret shapes must still be caught.
  for (const sample of [
    'hermesCapabilitySecret: "9f2b1c8e4a6d0f3b7e5c1a9d"',
    "nextAuthSecret = 'K7x2Qm9pLr4TvB8w'",
    'password: "Breadboard-QA-eKQ3ZmR2ZmZm"',
    "accessToken: abc123def456ghi789",
    'apiKey: "sk_live_51H8xY2eZvKqP"',
  ]) {
    assert.equal(scanForSecrets(sample).clean, false, `should have flagged: ${sample}`);
  }

  // A bare camelCase identifier as the value names a variable and leaks nothing.
  // Week 2 regression: this fired on `apiKey: chatmockApiKeyValue` in captured
  // source text, and a scanner that cries wolf gets ignored.
  for (const sample of [
    "apiKey: chatmockApiKeyValue",
    "secret: providerSecretName",
    "password: userPasswordField",
  ]) {
    assert.equal(scanForSecrets(sample).clean, true, `should not have flagged: ${sample}`);
  }
});

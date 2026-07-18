import test from "node:test";
import assert from "node:assert/strict";
import {
  assessVerification,
  evidenceKindForTool,
} from "../src/lib/openharness/evidence.ts";

const evidence = (kind) => ({
  id: `e-${kind}`,
  kind,
  title: kind,
  success: true,
  timestamp: new Date(0).toISOString(),
  details: {},
});

test("tool evidence remains source-distinguishable", () => {
  assert.equal(evidenceKindForTool("read"), "file_read");
  assert.equal(evidenceKindForTool("websearch"), "web_search");
  assert.equal(evidenceKindForTool("garden_search"), "garden");
  assert.equal(evidenceKindForTool("gbrain_search"), "memory");
  assert.equal(evidenceKindForTool("task"), "subagent");
});

test("deterministic honesty rejects unsupported operational claims", () => {
  const result = assessVerification(
    "I searched the web, tests passed, and GBrain is integrated.",
    [],
  );
  assert.equal(result.state, "contradicted");
  assert.equal(result.unsupportedClaims.length, 3);
});

test("matching evidence verifies supported claims", () => {
  const result = assessVerification("I searched the web and tests passed.", [
    evidence("web_search"),
    evidence("test"),
  ]);
  assert.equal(result.state, "verified");
  assert.deepEqual(result.unsupportedClaims, []);
});

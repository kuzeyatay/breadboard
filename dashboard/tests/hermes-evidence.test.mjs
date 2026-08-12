import test from "node:test";
import assert from "node:assert/strict";
import {
  activityLabelForTool,
  assessVerification,
  enforceRequiredWebEvidence,
  evidenceKindForTool,
  WEB_GROUNDING_UNAVAILABLE_MESSAGE,
} from "../src/lib/hermes/evidence.ts";

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
  assert.equal(evidenceKindForTool("web_search"), "web_search");
  assert.equal(evidenceKindForTool("web_extract"), "web_source");
  assert.equal(evidenceKindForTool("garden_search"), "garden");
  assert.equal(evidenceKindForTool("gbrain_search"), "memory");
  assert.equal(evidenceKindForTool("save_memory"), "memory");
  assert.equal(evidenceKindForTool("task"), "subagent");
  assert.equal(evidenceKindForTool("tool_search"), "tool_metadata");
  assert.equal(evidenceKindForTool("tool_describe"), "tool_metadata");
  assert.equal(evidenceKindForTool("capability_search"), "tool_metadata");
});

test("a planned web turn fails closed without actual web evidence", () => {
  const filtered = enforceRequiredWebEvidence(
    "Western Turkey may see a partial eclipse.",
    [evidence("command")],
    true,
  );
  assert.equal(filtered, WEB_GROUNDING_UNAVAILABLE_MESSAGE);
  const filteredVerification = assessVerification(
    filtered,
    [evidence("command")],
    { webGroundingRequired: true },
  );
  assert.equal(filteredVerification.state, "unverified");
  assert.deepEqual(filteredVerification.unsupportedClaims, []);

  const unsupported = assessVerification(
    "Western Turkey may see a partial eclipse.",
    [evidence("command")],
    { webGroundingRequired: true },
  );
  assert.equal(unsupported.state, "contradicted");
  assert.match(unsupported.unsupportedClaims[0], /needed current web evidence/i);

  const grounded = assessVerification(
    "The eclipse path does not cross Turkey.",
    [evidence("web_search")],
    { webGroundingRequired: true },
  );
  assert.equal(grounded.state, "verified");
  assert.equal(
    enforceRequiredWebEvidence(
      "The eclipse path does not cross Turkey.",
      [evidence("web_search")],
      true,
    ),
    "The eclipse path does not cross Turkey.",
  );
});

test("capability discovery does not verify external factual claims", () => {
  const result = assessVerification(
    "Rahmi Koç Müzesi is the strongest current option.",
    [evidence("tool_metadata")],
  );

  assert.equal(result.state, "unverified");
  assert.equal(result.evidence.length, 1);
  assert.equal(activityLabelForTool("tool_search"), "Inspecting capabilities");
});

test("save_memory reads as a durable-memory write", () => {
  assert.equal(evidenceKindForTool("save_memory"), "memory");
  assert.equal(activityLabelForTool("save_memory"), "Saving durable memory");
  // gbrain retrieval must not be mislabeled as a write.
  assert.equal(activityLabelForTool("gbrain_search"), "Consulting memory");
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

test("academic source claims require Garden, web, or user-provided evidence", () => {
  const unsupported = assessVerification(
    "The report includes academic references with DOI links.",
    [evidence("command")],
  );
  assert.equal(unsupported.state, "contradicted");
  assert.match(unsupported.unsupportedClaims[0], /Source-backed claim/);

  const grounded = assessVerification(
    "The report includes academic references with DOI links.",
    [evidence("garden")],
  );
  assert.equal(grounded.state, "verified");
});

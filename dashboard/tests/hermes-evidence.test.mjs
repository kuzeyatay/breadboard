import test from "node:test";
import assert from "node:assert/strict";
import {
  activityLabelForTool,
  assertsExternalFact,
  assessVerification,
  enforceRequiredWebEvidence,
  evidenceKindForTool,
  evidenceTitleForTool,
  WEB_GROUNDING_FAILED_MESSAGE,
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

const failed = (kind) => ({ ...evidence(kind), success: false });

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

test("the web gate withholds claims, never answers that make none", () => {
  // The turn that motivated this: "hi" planned as a web turn, answered
  // normally, and the whole reply replaced by a refusal at the last step.
  const greeting = "Hey! What would you like to work on?";
  assert.equal(assertsExternalFact(greeting), false);
  assert.equal(
    enforceRequiredWebEvidence(greeting, [evidence("command")], true),
    greeting,
  );

  for (const harmless of [
    "Hi there.",
    "Which file did you mean?",
    "I couldn't find anything matching that.",
    "I'm not able to reach that service right now.",
    "Let me know if you want me to keep going.",
  ]) {
    assert.equal(
      enforceRequiredWebEvidence(harmless, [evidence("command")], true),
      harmless,
      `withheld an answer that asserts nothing: ${harmless}`,
    );
  }

  // A first-person sentence still counts when it carries the claim itself.
  assert.equal(assertsExternalFact("I found the current price is $12."), true);

  // An answer that asserts nothing is not "contradicted" either — the panel
  // must not label a sound turn as one that outran its evidence.
  const summary = assessVerification(greeting, [evidence("command")], {
    webGroundingRequired: true,
  });
  assert.deepEqual(summary.unsupportedClaims, []);
});

test("a failed lookup is reported as failed, not as a refusal to answer", () => {
  const claim = "The merger closed last quarter.";
  assert.equal(
    enforceRequiredWebEvidence(claim, [failed("web_search")], true),
    WEB_GROUNDING_FAILED_MESSAGE,
  );
  // Never looking is a different fact about the turn than looking and failing.
  assert.equal(
    enforceRequiredWebEvidence(claim, [evidence("command")], true),
    WEB_GROUNDING_UNAVAILABLE_MESSAGE,
  );
  // Both notices are terminal: re-running the gate cannot rewrite one as the
  // other, which is what let the two states blur together in persisted rows.
  for (const notice of [
    WEB_GROUNDING_FAILED_MESSAGE,
    WEB_GROUNDING_UNAVAILABLE_MESSAGE,
  ]) {
    assert.equal(
      enforceRequiredWebEvidence(notice, [failed("web_search")], true),
      notice,
    );
    assert.equal(
      assessVerification(notice, [failed("web_search")], {
        webGroundingRequired: true,
      }).state,
      "unverified",
    );
  }
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

test("a tool that failed before writing a summary is still named in English", () => {
  // The runtime writes a summary only once a tool produced something. Without
  // a fallback the ledger showed the raw registry name beside "failed".
  assert.equal(evidenceTitleForTool("web_search", undefined), "Searching the web");
  assert.equal(evidenceTitleForTool("web_search", "   "), "Searching the web");
  assert.equal(evidenceTitleForTool("read"), "Reading file");
  // A written summary always wins: it says more than the generic label can.
  assert.equal(
    evidenceTitleForTool("web_search", "Did 10 searches in 5.0s"),
    "Did 10 searches in 5.0s",
  );
});

test("delegated runtime agents are reported without changing the verdict", () => {
  const delegation = [
    {
      agentId: "money-printer",
      agentName: "Money Printer",
      command: "/agents:money-printer",
      reason: "Video production is its work.",
      requiresApproval: true,
      requestedAt: new Date(0).toISOString(),
    },
  ];
  const delegated = assessVerification("Handing this to Money Printer.", [], {
    externalAgents: delegation,
  });
  assert.deepEqual(delegated.externalAgents, delegation);
  // A queued run is not a result, so it must not lift the answer's standing.
  assert.equal(delegated.state, "not_applicable");

  // The field is always present once assessed, so the panel can tell "none
  // were called" apart from "this summary predates the record".
  assert.deepEqual(assessVerification("Hello.", []).externalAgents, []);
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

import test from "node:test";
import assert from "node:assert/strict";
import {
  LearnCouncilExpiredStartedReceiptError,
  LearnCouncilTerminalReceiptError,
  expiredStartedLearnCouncilReceiptProof,
  runBoundedLearnCouncilSemanticAttempts,
} from "../src/lib/learn-council-semantic-recovery.ts";
import { createLearnFinalCriticProviders } from "../src/lib/learn-final-critic.ts";

function terminalReceipt(overrides = {}) {
  return {
    requestId: "lrq-terminal-1",
    requestHash: "a".repeat(64),
    dispatchGeneration: 2,
    dispatchCount: 2,
    redispatchCount: 1,
    redispatchAllowed: false,
    failureCode: "council_no_final_answer",
    ...overrides,
  };
}

function criticPacket() {
  return {
    gardenTitle: "electromagnetism-1",
    sections: [],
    sourceAnchors: [],
    visualSummaries: [],
    sourceCoverageSummary: { text: "", fullLength: 0, packetTruncated: false },
    sourceVisualSummaries: [],
    deterministicValidationSummary: "PASS",
    evidenceNote: "complete",
  };
}

test("an exact terminal receipt permits one new bounded semantic attempt", async () => {
  const contexts = [];
  const events = [];
  const firstFailure = new LearnCouncilTerminalReceiptError(terminalReceipt());
  const result = await runBoundedLearnCouncilSemanticAttempts({
    maxAttempts: 2,
    request: async (context) => {
      contexts.push(context);
      if (context.semanticAttempt === 0) throw firstFailure;
      return "completed";
    },
    onTerminalReceipt: (event) => events.push(event),
  });

  assert.equal(result, "completed");
  assert.deepEqual(contexts.map((context) => context.semanticAttempt), [0, 1]);
  assert.equal(contexts[1].priorTerminalReceipt.requestId, "lrq-terminal-1");
  assert.deepEqual(events.map((event) => event.nextSemanticAttempt), [1]);
});

test("an expired started receipt with an exact incomplete attempt prefix permits one fresh semantic identity", async () => {
  const proof = expiredStartedLearnCouncilReceiptProof({
    requestId: "lrq-generic-orphan-1",
    requestHash: "b".repeat(64),
    dispatchGeneration: 1,
    dispatchCount: 1,
    redispatchCount: 0,
    redispatchAllowed: false,
    attemptCount: 0,
    checkpointDispatchCount: 1,
    checkpointRedispatchCount: 0,
    startedAt: "2026-01-01T00:00:00.000Z",
    observedAt: "2026-01-01T00:31:01.000Z",
    maxStartedAgeMs: 31 * 60_000,
  });
  assert.equal(proof?.proofKind, "expired_started_receipt");

  const contexts = [];
  const result = await runBoundedLearnCouncilSemanticAttempts({
    maxAttempts: 2,
    request: async (context) => {
      contexts.push(context);
      if (context.semanticAttempt === 0) {
        throw new LearnCouncilExpiredStartedReceiptError(proof);
      }
      return "completed";
    },
  });

  assert.equal(result, "completed");
  assert.deepEqual(contexts.map((context) => context.semanticAttempt), [0, 1]);
  assert.equal(
    contexts[1].priorTerminalReceipt.failureCode,
    "council_started_receipt_expired",
  );
});

test("a live, mismatched, or partially unaccounted started receipt never authorizes a retry", () => {
  const base = {
    requestId: "lrq-generic-orphan-2",
    requestHash: "c".repeat(64),
    dispatchGeneration: 1,
    dispatchCount: 1,
    redispatchCount: 0,
    redispatchAllowed: false,
    attemptCount: 0,
    checkpointDispatchCount: 1,
    checkpointRedispatchCount: 0,
    startedAt: "2026-01-01T00:00:00.000Z",
    observedAt: "2026-01-01T00:30:59.999Z",
    maxStartedAgeMs: 31 * 60_000,
  };
  assert.equal(expiredStartedLearnCouncilReceiptProof(base), null);
  assert.equal(
    expiredStartedLearnCouncilReceiptProof({
      ...base,
      observedAt: "2026-01-01T00:31:01.000Z",
      checkpointDispatchCount: 2,
    }),
    null,
  );
  assert.equal(
    expiredStartedLearnCouncilReceiptProof({
      ...base,
      observedAt: "2026-01-01T00:31:01.000Z",
      attemptCount: 1,
    }),
    null,
  );
});

test("ambiguous and arbitrary HTTP failures remain single-shot by exact identity", async () => {
  for (const failure of [
    Object.assign(new Error("generic bad gateway"), { status: 502 }),
    Object.assign(new Error("request timed out after write"), { code: "ETIMEDOUT" }),
    new DOMException("cancelled", "AbortError"),
  ]) {
    let calls = 0;
    await assert.rejects(
      () => runBoundedLearnCouncilSemanticAttempts({
        maxAttempts: 3,
        request: async () => {
          calls += 1;
          throw failure;
        },
      }),
      (actual) => actual === failure,
    );
    assert.equal(calls, 1);
  }
});

test("a second terminal receipt exhausts the semantic budget without hiding it", async () => {
  const failures = [
    new LearnCouncilTerminalReceiptError(terminalReceipt()),
    new LearnCouncilTerminalReceiptError(terminalReceipt({ requestId: "lrq-terminal-2" })),
  ];
  let calls = 0;
  await assert.rejects(
    () => runBoundedLearnCouncilSemanticAttempts({
      maxAttempts: 2,
      request: async () => {
        throw failures[calls++];
      },
    }),
    (actual) => actual === failures[1],
  );
  assert.equal(calls, 2);
});

test("the final critic changes semantic identity only after durable no-answer proof", async () => {
  const requests = [];
  const retries = [];
  const providers = createLearnFinalCriticProviders({
    execute: async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        throw new LearnCouncilTerminalReceiptError(terminalReceipt());
      }
      return { content: '{"issues":[]}' };
    },
    maxSemanticAttempts: 2,
    onTerminalReceipt: (event) => retries.push(event),
  });

  assert.deepEqual(await providers.critic(criticPacket()), []);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.semanticAttempt), [0, 1]);
  assert.equal(requests[0].stageKey, requests[1].stageKey);
  assert.notEqual(requests[0].user, requests[1].user);
  assert.equal(requests[0].sourceContext.priorTerminalReceipt, undefined);
  assert.deepEqual(requests[1].sourceContext.priorTerminalReceipt, {
    failureCode: "council_no_final_answer",
    dispatchCount: 2,
  });
  assert.equal(retries.length, 1);
  assert.equal(retries[0].kind, "critic");
});

test("a fulfilled malformed critic response is terminal and never re-requested", async () => {
  let calls = 0;
  const providers = createLearnFinalCriticProviders({
    execute: async () => {
      calls += 1;
      return { content: '{"issues":[' };
    },
    maxSemanticAttempts: 3,
  });

  await assert.rejects(
    () => providers.critic(criticPacket()),
    /Critic response validation failed: invalid JSON/,
  );
  assert.equal(calls, 1);
});

test("anchor review and semantic repair also use durable finalization identities", async () => {
  const requests = [];
  const providers = createLearnFinalCriticProviders({
    execute: async (request) => {
      requests.push(request);
      if (request.kind === "anchor_critic") {
        return {
          content: JSON.stringify({
            anchorId: "S1.P1.field",
            decision: "confirm",
            confidence: "high",
            reason: "The supplied exact passage supports the field definition.",
            confirmedExactText: "The electric field is force per unit charge.",
          }),
        };
      }
      return { content: "---\ntitle: Repaired\n---\n\nComplete repaired lesson.\n" };
    },
  });

  const anchor = await providers.anchorConfirm({
    anchor: { id: "S1.P1.field" },
    existingAlternativeAnchors: [],
  });
  assert.equal(anchor.decision, "confirm");

  const repair = await providers.modelRepair({
    issue: {
      id: "semantic-1",
      severity: "blocking",
      type: "other",
      problem: "A claim is missing.",
      evidence: "The body omits it.",
      expected: "Teach the claim.",
      repairTarget: "unit_page",
      suggestedRepair: "Add the supported explanation.",
    },
    repairRequest: {
      id: "repair-1",
      issueIds: ["semantic-1"],
      targetKind: "unit_page",
      targetPath: "learning/1. Fields/1.1 Electric Field.md",
      instructions: ["Add the supported explanation."],
      evidence: ["The body omits it."],
    },
    finalGardenStateExcerpt: {},
    currentMarkdown: "---\ntitle: Original\n---\n\nOriginal lesson.\n",
  });

  assert.equal(repair.targetPath, "learning/1. Fields/1.1 Electric Field.md");
  assert.match(repair.revisedMarkdown, /Complete repaired lesson/);
  assert.deepEqual(requests.map((request) => request.kind), [
    "anchor_critic",
    "model_repair",
  ]);
  assert.ok(requests.every((request) => request.stageKey.startsWith("finalization:")));
});

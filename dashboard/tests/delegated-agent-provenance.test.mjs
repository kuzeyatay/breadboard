import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  agentLaunchContinuationIds,
  carriedExternalAgentsForContinuation,
  withCarriedExternalAgents,
} from "../src/lib/conversations/delegated-agent-provenance.ts";

const workerId = "agent-launch-c0c68023-8fdf-4cb5-83df-3e7efaed06d0";
const startedAt = "2026-08-30T14:23:54.041Z";
const requestedAt = "2026-08-30T14:23:54.047Z";

const row = ({
  clientMessageId,
  role,
  content = "",
  metadata = {},
  createdAt = startedAt,
}) => ({
  client_message_id: clientMessageId,
  role,
  content,
  metadata: JSON.stringify(metadata),
  created_at: createdAt,
});

const launchCall = {
  agentId: "max-research",
  agentName: "Max Research",
  command: "/agents:max-research",
  reason: "Reconcile the scientific evidence.",
  requiresApproval: true,
  requestedAt,
};

const originalAnswer = row({
  clientMessageId: "person-turn",
  role: "assistant",
  metadata: {
    verification: {
      state: "not_applicable",
      evidence: [],
      unsupportedClaims: [],
      assumptions: [],
      externalAgents: [launchCall],
    },
  },
});

const workerAnswer = row({
  clientMessageId: workerId,
  role: "assistant",
  metadata: {
    externalAgent: true,
    delegatedAgentRun: true,
    externalAgentOutcome: "completed",
    externalAgentStartedAt: startedAt,
    externalAgentRun: {
      kind: "max_research",
      runId: "job_max_research",
      query: "How does skeletal muscle hypertrophy work?",
    },
  },
});

const continuation = `<!-- agent-launch-result:${workerId} -->\nMax Research finished.`;

test("the hand-back marker names its exact durable worker", () => {
  assert.deepEqual(agentLaunchContinuationIds(continuation), [workerId]);
  assert.deepEqual(agentLaunchContinuationIds("ordinary follow-up"), []);
});

test("a saved Max Research turn restores the original launch receipt", () => {
  const calls = carriedExternalAgentsForContinuation({
    continuationText: continuation,
    messages: [originalAnswer, workerAnswer],
  });
  assert.deepEqual(calls, [{ ...launchCall, carried: true }]);
});

test("legacy Garden hand-backs keyed by runtime job id restore the same worker", () => {
  const calls = carriedExternalAgentsForContinuation({
    continuationText: "<!-- agent-launch-result:job_max_research -->\nMax Research finished.",
    messages: [originalAnswer, workerAnswer],
  });
  assert.deepEqual(calls, [{ ...launchCall, carried: true }]);
});

test("a durable worker still appears after the live launch queue is gone", () => {
  const calls = carriedExternalAgentsForContinuation({
    continuationText: continuation,
    messages: [workerAnswer],
    launchCalls: [],
  });
  assert.deepEqual(calls, [
    {
      agentId: "max-research",
      agentName: "Max Research",
      command: "/agents:max-research",
      requiresApproval: false,
      requestedAt: startedAt,
      carried: true,
    },
  ]);
});

test("an ordinary internal continuation cannot inherit an adjacent worker", () => {
  assert.deepEqual(
    carriedExternalAgentsForContinuation({
      continuationText: "Continue the previous answer.",
      messages: [originalAnswer, workerAnswer],
    }),
    [],
  );
});

test("legacy hand-backs can still use the live launch queue", () => {
  assert.deepEqual(
    carriedExternalAgentsForContinuation({
      continuationText: "Max Research finished.",
      messages: [],
      launchCalls: [launchCall],
    }),
    [{ ...launchCall, carried: true }],
  );
});

test("restore adds the worker without changing the saved verdict", () => {
  const repaired = withCarriedExternalAgents(
    {
      state: "partially_verified",
      evidence: [],
      unsupportedClaims: ["One claim needs support."],
      assumptions: [],
      externalAgents: [],
    },
    [{ ...launchCall, carried: true }],
  );
  assert.equal(repaired?.state, "partially_verified");
  assert.deepEqual(repaired?.unsupportedClaims, ["One claim needs support."]);
  assert.deepEqual(repaired?.externalAgents, [{ ...launchCall, carried: true }]);
});

test("both live dispatch and saved transcript restoration use durable receipts", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const turn = fs.readFileSync(
    path.join(root, "src/lib/conversations/turn-service.ts"),
    "utf8",
  );
  const garden = fs.readFileSync(
    path.join(root, "src/lib/hermes/garden-chat-adapter.ts"),
    "utf8",
  );
  const presentation = fs.readFileSync(
    path.join(root, "src/lib/hermes/session-presentation.ts"),
    "utf8",
  );
  assert.match(turn, /carriedExternalAgentsForContinuation\(/);
  assert.match(garden, /carriedExternalAgentsForContinuation\(/);
  assert.match(presentation, /withCarriedExternalAgents\(/);
});

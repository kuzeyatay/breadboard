// A hand-off the model made while the page had no live stream is rebuilt from
// the finished turn's evidence ledger so the run still starts. Live delivery
// and the rebuilt twin dedupe to one launch.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  restoredLaunchRequestId,
  undeliveredLaunchRequests,
} from "../src/app/components/hermes/undelivered-launches.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

function handoffTurn(overrides = {}) {
  return {
    role: "assistant",
    clientMessageId: "cm-1",
    tools: [
      { toolCallId: "call_search", toolName: "tool_search", status: "completed" },
      { toolCallId: "call_launch", toolName: "agent_launch", status: "completed" },
    ],
    verification: {
      evidence: [
        { toolCallId: "call_search", success: true, details: { toolName: "tool_search" } },
        {
          toolCallId: "call_launch",
          success: true,
          details: {
            toolName: "agent_launch",
            args: { agent: "max-research", brief: "Conduct max research on hypertrophy." },
          },
        },
      ],
    },
    ...overrides,
  };
}

test("a finished hand-off with nothing after it is rebuilt from its evidence", () => {
  const [request, ...rest] = undeliveredLaunchRequests([
    { role: "user", clientMessageId: "cm-1" },
    handoffTurn(),
  ]);
  assert.equal(rest.length, 0);
  assert.deepEqual(request, {
    requestId: restoredLaunchRequestId("call_launch"),
    agentId: "max-research",
    agentName: "Max Research",
    command: "/agents:max-research",
    brief: "Conduct max research on hypertrophy.",
    reason: "",
    awaitResult: true,
    requiresApproval: true,
    originClientMessageId: "cm-1",
  });
});

test("nothing is rebuilt while the turn is still running, failed, or already followed", () => {
  assert.deepEqual(undeliveredLaunchRequests([handoffTurn({ pending: true })]), []);
  assert.deepEqual(undeliveredLaunchRequests([handoffTurn({ failed: true })]), []);
  assert.deepEqual(undeliveredLaunchRequests([handoffTurn({ interrupted: true })]), []);
  // Max Research may already be attached server-side even when the launch
  // event never reached this page. Do not start a duplicate from the evidence
  // fallback when that durable private worker is present.
  assert.deepEqual(
    undeliveredLaunchRequests([handoffTurn({ delegatedAgentRun: true })]),
    [],
  );
  // The launched run's own turn came after it: delivered.
  assert.deepEqual(
    undeliveredLaunchRequests([handoffTurn(), { role: "assistant", externalAgent: { kind: "max-research" } }]),
    [],
  );
  // A new question came after it: overtaken.
  assert.deepEqual(undeliveredLaunchRequests([handoffTurn(), { role: "user" }]), []);
  // A failed launch call is not retried behind the model's back.
  const failedCall = handoffTurn();
  failedCall.tools[1].status = "failed";
  assert.deepEqual(undeliveredLaunchRequests([failedCall]), []);
  // No usable evidence, no request.
  assert.deepEqual(undeliveredLaunchRequests([handoffTurn({ verification: { evidence: [] } })]), []);
  assert.deepEqual(
    undeliveredLaunchRequests([
      handoffTurn({
        verification: {
          evidence: [{ toolCallId: "call_launch", success: true, details: { args: { agent: "Bad Agent!", brief: "x" } } }],
        },
      }),
    ]),
    [],
  );
});

test("the hook feeds rebuilt hand-offs and the queue treats them as the live request's twin", () => {
  const hook = source("../src/app/components/hermes/use-agent-session.ts");
  assert.match(hook, /import \{ undeliveredLaunchRequests \} from "\.\/undelivered-launches\.ts";/);
  assert.match(hook, /const restored = undeliveredLaunchRequests\(messages\);/);
  const queue = source("../src/app/components/hermes/use-agent-launch-queue.ts");
  assert.match(queue, /origin:\$\{request\.originClientMessageId\}:\$\{request\.agentId\}/);
  assert.match(queue, /if \(originKey && seenRef\.current\.has\(originKey\)\) return true;/);
  // The panel never shows a finished newest reply as an empty body.
  const panel = source("../src/app/components/hermes/agent-runtime-panel.tsx");
  assert.match(panel, /\(!streaming \? message\.content : ""\) \|\|/);
});

test("Terminal does not consume a restored hand-off before its conversation scope exists", () => {
  const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  const drain = terminal.slice(
    terminal.indexOf("const handleAgentLaunchEvent = agentLaunchQueue.handleEvent"),
    terminal.indexOf("// The result of a finished run", terminal.indexOf("const handleAgentLaunchEvent = agentLaunchQueue.handleEvent")),
  );
  assert.match(drain, /if \(session\.loadingSession \|\| !session\.sessionId\) return;/);
  assert.match(drain, /for \(const request of session\.agentLaunchRequests\)/);
  assert.ok(
    drain.indexOf("if (session.loadingSession || !session.sessionId) return;") <
      drain.indexOf("for (const request of session.agentLaunchRequests)"),
    "the null-scope guard must run before the queue can mark a restored launch seen",
  );
  assert.match(drain, /session\.loadingSession,/);
  assert.match(drain, /session\.sessionId,/);
});

test("a recovered launch queued during the snapshot paint adopts the restored scope", async () => {
  const { claimUnscopedAgentLaunchRequests } = await import(
    "../src/app/components/hermes/agent-launch-scope.ts"
  );
  const request = {
    requestId: "restored:call_launch",
    agentId: "max-research",
    agentName: "Max Research",
    command: "/agents:max-research",
    brief: "Conduct max research on hypertrophy.",
    reason: "",
    awaitResult: true,
    requiresApproval: true,
    originClientMessageId: "cm-1",
  };
  const queued = [{ request, scopeKey: null }];

  assert.equal(claimUnscopedAgentLaunchRequests(queued, null), queued);
  assert.deepEqual(
    claimUnscopedAgentLaunchRequests(queued, "conv-restored"),
    [{ request, scopeKey: "conv-restored" }],
  );

  const alreadyOwned = [{ request, scopeKey: "conv-original" }];
  assert.equal(
    claimUnscopedAgentLaunchRequests(alreadyOwned, "conv-other"),
    alreadyOwned,
    "a launch already bound to a conversation must never move to another one",
  );
});

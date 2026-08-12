import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentStreamTimeoutError,
  agentStreamTimeout,
  isAgentStreamTurnActivity,
  withAgentStreamTimeout,
} from "../src/app/components/hermes/agent-stream-watchdog.ts";

test("agent stream watchdog distinguishes connection and activity stalls", () => {
  assert.equal(
    agentStreamTimeout({
      connected: false,
      sawTurnActivity: false,
      waitingForPermission: false,
    })?.kind,
    "connect_timeout",
  );
  assert.equal(
    agentStreamTimeout({
      connected: true,
      sawTurnActivity: false,
      waitingForPermission: false,
    })?.kind,
    "first_activity_timeout",
  );
  assert.equal(
    agentStreamTimeout({
      connected: true,
      sawTurnActivity: true,
      waitingForPermission: false,
    })?.kind,
    "inactivity_timeout",
  );
});

test("permission waits do not expire", () => {
  assert.equal(
    agentStreamTimeout({
      connected: true,
      sawTurnActivity: true,
      waitingForPermission: true,
    }),
    null,
  );
});

test("artifact and delegated-agent events count as live turn activity", () => {
  assert.equal(
    isAgentStreamTurnActivity("artifact.progress", { status: "running" }),
    true,
  );
  assert.equal(
    isAgentStreamTurnActivity("subagent.update", { status: "running" }),
    true,
  );
  assert.equal(
    isAgentStreamTurnActivity("session.status", { status: "idle" }),
    false,
  );
});

test("agent stream watchdog rejects a stalled read with a recoverable error", async () => {
  await assert.rejects(
    withAgentStreamTimeout(new Promise(() => undefined), {
      timeoutMs: 5,
      kind: "first_activity_timeout",
    }),
    (error) =>
      error instanceof AgentStreamTimeoutError &&
      error.code === "first_activity_timeout" &&
      /try again/i.test(error.message),
  );
});

test("agent stream watchdog returns data received before the deadline", async () => {
  const result = await withAgentStreamTimeout(Promise.resolve("event"), {
    timeoutMs: 50,
    kind: "inactivity_timeout",
  });
  assert.equal(result, "event");
});

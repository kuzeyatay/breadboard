import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentStreamDisconnectedError,
  AgentStreamTimeoutError,
  agentStreamReconnectDelay,
  agentStreamTimeout,
  disposeAgentStreamReader,
  isRecoverableAgentStreamDisconnect,
  isAgentStreamTurnActivity,
  waitForAgentStreamReconnect,
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

test("agent stream reconnects bounded transport failures but not run timeouts", () => {
  assert.equal(
    isRecoverableAgentStreamDisconnect(new AgentStreamDisconnectedError()),
    true,
  );
  assert.equal(
    isRecoverableAgentStreamDisconnect(new TypeError("network error")),
    true,
  );
  assert.equal(
    isRecoverableAgentStreamDisconnect(
      new DOMException("The operation timed out", "TimeoutError"),
    ),
    true,
  );
  assert.equal(
    isRecoverableAgentStreamDisconnect(
      new AgentStreamTimeoutError("inactivity_timeout"),
    ),
    false,
  );
  assert.equal(agentStreamReconnectDelay(0), 500);
  assert.equal(agentStreamReconnectDelay(5), 16_000);
  assert.equal(agentStreamReconnectDelay(6), null);
});

test("agent stream reconnect delay remains abortable", async () => {
  const controller = new AbortController();
  const waiting = waitForAgentStreamReconnect(10_000, controller.signal);
  controller.abort();
  await assert.rejects(waiting, (error) => error?.name === "AbortError");
});

test("terminal stream cleanup cancels the body before releasing its reader", async () => {
  const calls = [];
  await disposeAgentStreamReader({
    async cancel() {
      calls.push("cancel");
    },
    releaseLock() {
      calls.push("release");
    },
  });
  assert.deepEqual(calls, ["cancel", "release"]);
});

test("an already-failed stream still releases its reader lock", async () => {
  const calls = [];
  await disposeAgentStreamReader({
    async cancel() {
      calls.push("cancel");
      throw new Error("already aborted");
    },
    releaseLock() {
      calls.push("release");
    },
  });
  assert.deepEqual(calls, ["cancel", "release"]);
});

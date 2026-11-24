import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { nextPendingHandBack } from "../src/lib/conversations/delegated-hand-back.ts";

const NOW = Date.parse("2026-11-24T10:00:00Z");
const worker = (id, outcome, extra = {}) => ({
  clientMessageId: id,
  role: "assistant",
  content: "",
  status: outcome === "running" ? "complete" : "complete",
  metadata: {
    delegatedAgentRun: true,
    externalAgent: true,
    externalAgentRun: { kind: "deep_research", runId: `job_${"a".repeat(64)}`, query: "q", output: "report" },
    externalAgentOutcome: outcome,
    externalAgentResult: `report from ${id}`,
    responseCompletedAt: "2026-11-13T10:12:00Z",
    ...extra,
  },
});
const continuation = (id) => ({
  clientMessageId: `c-${id}`, role: "user", status: "complete", metadata: {},
  content: `<!-- agent-launch-result:${id} -->\nfinished`,
});

test("a finished, never handed-back worker is continued with its own result", () => {
  const next = nextPendingHandBack([worker("w1", "completed")], { now: NOW });
  assert.equal(next.workerClientMessageId, "w1");
  assert.match(next.text, /agent-launch-result:w1/);
  assert.match(next.text, /report from w1/);
});

test("already handed back, still running, or Telegram-owned workers are skipped", () => {
  assert.equal(nextPendingHandBack([worker("w1", "completed"), continuation("w1")], { now: NOW }), null);
  assert.equal(nextPendingHandBack([worker("w1", "running")], { now: NOW }), null);
  assert.equal(nextPendingHandBack([worker("w1", "completed", { deliveryChannel: "telegram" })], { now: NOW }), null);
  assert.equal(nextPendingHandBack([worker("w1", "completed", { awaitResult: false })], { now: NOW }), null);
});

test("the skins chat case: one worker handed back, the other still owed", () => {
  const next = nextPendingHandBack(
    [worker("deep", "completed"), worker("reach", "completed"), continuation("reach")],
    { now: NOW },
  );
  assert.equal(next.workerClientMessageId, "deep");
});

test("an open page gets a grace period, and sweeps never revive old runs", () => {
  const fresh = worker("w1", "completed", { responseCompletedAt: new Date(NOW - 30_000).toISOString() });
  assert.equal(nextPendingHandBack([fresh], { now: NOW, minAgeMs: 120_000 }), null);
  assert.equal(nextPendingHandBack([worker("w1", "completed")], { now: NOW, maxAgeMs: 48 * 3_600_000 }), null);
});

test("a pending turn or an exhausted hop budget waits for the person", () => {
  const pending = { clientMessageId: "p", role: "assistant", status: "pending", content: "", metadata: {} };
  assert.equal(nextPendingHandBack([worker("w1", "completed"), pending], { now: NOW }), null);
  const hops = ["a", "b", "c", "d"].map(continuation);
  assert.equal(nextPendingHandBack([...hops, worker("w1", "completed")], { now: NOW }), null);
});

test("the background tick runs the hand-back sweep", () => {
  const source = readFileSync(new URL("../scripts/runtime-v2-background-executor.mjs", import.meta.url), "utf8");
  assert.match(source, /sweepDelegatedHandBacks/);
});

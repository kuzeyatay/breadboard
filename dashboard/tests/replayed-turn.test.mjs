// A message POST whose first attempt times out client-side is replayed with
// the same clientMessageId. While the server is still preparing that turn the
// replay answers `replayed: true, status: "pending"` with no run id. That used
// to end the turn as "The agent did not return an active run id." even though
// the server went on to run it; the client now waits for the run instead.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  isPendingReplay,
  settleReplayedTurn,
} from "../src/app/components/hermes/replayed-turn.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

function responses(bodies) {
  const queue = [...bodies];
  const calls = [];
  const dispatch = async () => {
    calls.push(Date.now());
    const body = queue.shift();
    if (body === undefined) throw new Error("dispatch called more than expected");
    return { ok: true, json: async () => body };
  };
  return { dispatch, calls };
}

test("only a pending replay without a run id is waited on", () => {
  assert.equal(isPendingReplay({ replayed: true, status: "pending", runId: null }), true);
  assert.equal(isPendingReplay({ replayed: true, status: "pending", runId: "" }), true);
  assert.equal(isPendingReplay({ replayed: true, status: "pending", runId: "run_1" }), false);
  assert.equal(isPendingReplay({ replayed: true, status: "complete", runId: null }), false);
  assert.equal(isPendingReplay({ accepted: true, runId: "run_1" }), false);
  assert.equal(isPendingReplay({}), false);
});

test("a body that is not a pending replay is returned untouched without dispatching", async () => {
  const { dispatch, calls } = responses([]);
  const body = { accepted: true, runId: "run_1", replayed: false };
  assert.equal(await settleReplayedTurn(body, dispatch), body);
  assert.equal(calls.length, 0);
});

test("the replay is polled until the run exists", async () => {
  const { dispatch, calls } = responses([
    { accepted: true, replayed: true, status: "pending", runId: null },
    { accepted: true, replayed: true, status: "pending", runId: null },
    { accepted: true, replayed: true, status: "pending", runId: "run_7" },
  ]);
  const slept = [];
  const settled = await settleReplayedTurn(
    { accepted: true, replayed: true, status: "pending", runId: null },
    dispatch,
    { intervalMs: 250, budgetMs: 10_000, sleep: async (ms) => { slept.push(ms); } },
  );
  assert.equal(settled.runId, "run_7");
  assert.equal(calls.length, 3);
  assert.deepEqual(slept, [250, 250, 250]);
});

test("a turn that completed while waiting is handed back for ordinary handling", async () => {
  const { dispatch } = responses([
    { accepted: false, replayed: true, status: "complete", runId: null },
  ]);
  const settled = await settleReplayedTurn(
    { accepted: true, replayed: true, status: "pending", runId: null },
    dispatch,
    { intervalMs: 1, sleep: async () => {} },
  );
  assert.equal(settled.status, "complete");
});

test("the wait is bounded by its budget and stops on abort", async () => {
  let clock = 0;
  const { dispatch, calls } = responses(
    Array.from({ length: 5 }, () => ({ accepted: true, replayed: true, status: "pending", runId: null })),
  );
  const pending = { accepted: true, replayed: true, status: "pending", runId: null };
  const exhausted = await settleReplayedTurn(pending, dispatch, {
    intervalMs: 1_000,
    budgetMs: 3_500,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  });
  assert.equal(exhausted.runId, null);
  assert.equal(calls.length, 3);

  const controller = new AbortController();
  controller.abort();
  const { dispatch: never, calls: none } = responses([]);
  assert.equal(await settleReplayedTurn(pending, never, { signal: controller.signal }), pending);
  assert.equal(none.length, 0);
});

test("a redo that collides with the live turn attaches to it instead of failing", () => {
  const client = source("../src/app/components/hermes/use-agent-session.ts");
  // The store refuses a second turn while an assistant row is pending. That
  // refusal is the durable proof the earlier reply is still being written, so
  // the client reloads the transcript and resumes it rather than reporting
  // "Another turn is already active" as a failed reply.
  assert.match(client, /sendResponse\.status === 409 &&\s*body\.code === "conversation_turn_active"/);
  assert.match(client, /resumePendingConversation\(activeSessionId, restoredMessages, viewEpoch\)/);
  const store = source("../src/lib/conversations/store.ts");
  assert.match(store, /"conversation_turn_active"/);
});

test("the chat client settles a replayed turn before it looks for the run id", () => {
  const client = source("../src/app/components/hermes/use-agent-session.ts");
  assert.match(client, /import \{ settleReplayedTurn \} from "\.\/replayed-turn\.ts";/);
  assert.match(client, /const responseBody = await settleReplayedTurn\(/);
  const route = source("../src/app/api/hermes/sessions/[sessionId]/messages/route.ts");
  // The server side of the contract: a replayed pending turn reports its status
  // and whatever run it has so far, never a bare failure.
  assert.match(route, /replayed: true,\s*status: result\.status,\s*runId: result\.run\?\.id \?\? null/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { HermesRpcClient } from "../src/lib/agent-runtime/hermes-wire.ts";

test("a fresh Hermes event subscription does not replay the previous turn", async () => {
  const client = new HermesRpcClient({
    baseUrl: "http://127.0.0.1:9119",
    sessionToken: "test",
    requestTimeoutMs: 1_000,
  });
  const socket = {
    readyState: 1,
    addEventListener() {},
    removeEventListener() {},
    close() {},
  };
  client.connect = async () => {};
  // The wire client is intentionally exercised at the event boundary: this
  // reproduces the journal that remains after turn one and then opens the
  // subscription used by turn two.
  client.socket = socket;
  client.handleFrame(JSON.stringify({
    jsonrpc: "2.0",
    method: "event",
    params: {
      type: "message.complete",
      session_id: "live",
      payload: { turn_id: "turn-1", status: "complete", text: "Got it." },
    },
  }));

  const iterator = client.events("live")[Symbol.asyncIterator]();
  const next = iterator.next();
  let settled = false;
  void next.finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(settled, false, "the prior completion must not be replayed");

  client.handleFrame(JSON.stringify({
    jsonrpc: "2.0",
    method: "event",
    params: {
      type: "message.start",
      session_id: "live",
      payload: { turn_id: "turn-2" },
    },
  }));
  const result = await next;
  assert.equal(result.done, false);
  assert.equal(result.value.payload.turn_id, "turn-2");
  await iterator.return();
  client.close();
});

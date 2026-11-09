import test from "node:test";
import assert from "node:assert/strict";
import { HermesRuntimeAdapter } from "../src/lib/agent-runtime/adapters/hermes.ts";

test("a completed reply stays complete while compaction retains its runtime leases", async () => {
  const adapter = new HermesRuntimeAdapter({ baseUrl: "http://127.0.0.1:9119",
    sessionToken: "test", requestTimeoutMs: 5_000 });
  const released = [];
  const requests = [];
  adapter.ensureSessionLease = async () => null;
  adapter.releaseSessionLease = async () => { released.push("runtime"); };
  adapter.releaseModelServiceLease = async (_session, id) => { released.push(id); };
  const maintenance = (running, turn_id = "turn-1") => adapter.trackMaintenance({
    type: "session.maintenance", session_id: "live", payload: { running, turn_id },
  });
  adapter.client = {
    async request(method) {
      requests.push(method);
      return method === "session.create" ? { session_id: "live", stored_session_id: "stored" } : {};
    },
    async *events(_id, _signal, connected) {
      connected?.();
      maintenance(true);
      yield { type: "session.maintenance", session_id: "live", payload: { running: true, turn_id: "turn-1" } };
      yield { type: "message.complete", session_id: "live", payload: {
        text: "Finished reply", status: "complete", turn_id: "turn-1",
      } };
    },
    clearSession() {}, close() {},
  };
  const session = await adapter.createSession({ surface: "garden_chat", sessionKey: "idle-compaction" });
  const events = [];
  for await (const event of adapter.streamSession({ ...session, messageId: "turn-1" })) events.push(event);
  assert.ok(events.some(event => event.type === "assistant.delta" && event.payload.text === "Finished reply"));
  assert.deepEqual(released, [], "the reply closes without killing background compaction");
  assert.ok(!events.some(event => event.type === "reasoning.status" && /compact/i.test(event.payload.label)));
  maintenance(false, "stale-turn");
  assert.deepEqual(released, [], "a stale completion cannot release current maintenance");
  const nextTurn = adapter.startRun({ ...session, text: "next", messageId: "turn-2" });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!requests.includes("prompt.submit"), "next-turn settings wait for the summarizer");
  maintenance(false);
  await nextTurn;
  assert.deepEqual(released, ["turn-1", "runtime"]);
  assert.ok(requests.includes("prompt.submit"));
});

test("finishing maintenance preserves a newer active turn's runtime", async () => {
  const adapter = new HermesRuntimeAdapter({ baseUrl: "http://127.0.0.1:9119", sessionToken: "test", requestTimeoutMs: 5_000 });
  const state = { liveSessionId: "live", leaseHolders: 1 };
  adapter.sessions.set("stored", state);
  const released = [];
  adapter.releaseSessionLease = async () => { released.push("runtime"); };
  adapter.releaseModelServiceLease = async (_session, id) => { released.push(id); };
  for (const running of [true, false]) adapter.trackMaintenance({
    type: "session.maintenance", session_id: "live", payload: { running, turn_id: "previous" },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(released, ["previous"]);
});

test("a dropped maintenance completion is recovered without leaking resources", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const adapter = new HermesRuntimeAdapter({ baseUrl: "http://127.0.0.1:9119", sessionToken: "test", requestTimeoutMs: 5_000 });
  const state = { liveSessionId: "live", leaseHolders: 0 };
  adapter.sessions.set("stored", state);
  const released = [];
  adapter.releaseSessionLease = async () => { released.push("runtime"); };
  adapter.releaseModelServiceLease = async (_session, id) => { released.push(id); };
  adapter.client = { async request(method) {
    assert.equal(method, "session.turn_result");
    return { state: "completed", maintenance_running: false };
  } };
  adapter.trackMaintenance({ type: "session.maintenance", session_id: "live",
    payload: { running: true, turn_id: "previous" } });
  const finished = state.maintenanceComplete;
  t.mock.timers.tick(10_000);
  await finished;
  assert.deepEqual(released, ["previous", "runtime"]);
});

test("stopping a send during maintenance prevents it from starting later", async () => {
  const adapter = new HermesRuntimeAdapter({ baseUrl: "http://127.0.0.1:9119", sessionToken: "test", requestTimeoutMs: 5_000 });
  adapter.sessions.set("stored", { liveSessionId: "live", leaseHolders: 0 });
  const requests = [];
  adapter.ensureSessionLease = async () => null;
  adapter.client = { async request(method) { requests.push(method); return {}; } };
  const event = (running) => ({ type: "session.maintenance", session_id: "live",
    payload: { running, turn_id: "previous" } });
  adapter.trackMaintenance(event(true));
  const input = { externalSessionId: "stored", text: "cancel this", messageId: "next" };
  const pending = adapter.startRun(input);
  const stopped = assert.rejects(pending, { name: "AbortError" });
  await adapter.stopRun(input);
  adapter.trackMaintenance(event(false));
  await stopped;
  assert.deepEqual(requests, ["session.interrupt"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { HermesRuntimeAdapter } from "../src/lib/agent-runtime/adapters/hermes.ts";

function adapterWithClient(client) {
  const adapter = new HermesRuntimeAdapter({baseUrl: "http://127.0.0.1:9119", sessionToken: "test", requestTimeoutMs: 5000});
  adapter.client = {clearSession() {}, close() {}, ...client};
  return adapter;
}

async function withLeases(t, capacity = 8) {
  const previous = {url: process.env.BREADBOARD_SUPERVISOR_CONTROL_URL, token: process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, transports: globalThis.__breadboardRuntimeControlTransportsV1};
  const live = new Set();
  let acquired = 0;
  process.env.BREADBOARD_SUPERVISOR_CONTROL_URL = "http://127.0.0.1:49877";
  process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "t".repeat(32);
  const json = (body) => new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}});
  globalThis.__breadboardRuntimeControlTransportsV1 = {
    async job() { throw new Error("unexpected job request"); },
    async service(input) {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/lease-contract")) return json({protocolVersion: 1, serviceId: "hermes", acquireTimeoutMs: 20000});
      if (pathname === "/v1/services/hermes/lease") {
        assert.ok(live.size < capacity, "replacement must release the abandoned lease before acquiring another");
        const leaseId = `lease-${++acquired}`;
        live.add(leaseId);
        await new Promise(resolve => setImmediate(resolve));
        return json({leaseId, serviceId: "hermes"});
      }
      const release = /^\/v1\/leases\/([^/]+)\/release$/.exec(pathname);
      if (release) { live.delete(release[1]); return json({released: true}); }
      throw new Error(`unexpected ${pathname}`);
    },
  };
  t.after(() => {
    for (const [name, value] of [["BREADBOARD_SUPERVISOR_CONTROL_URL", previous.url], ["BREADBOARD_SUPERVISOR_CONTROL_TOKEN", previous.token]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (previous.transports === undefined) delete globalThis.__breadboardRuntimeControlTransportsV1;
    else globalThis.__breadboardRuntimeControlTransportsV1 = previous.transports;
  });
  return {live, acquired: () => acquired};
}

test("a pre-dispatch viewer ignores an abandoned cached turn and binds the next durable run", async () => {
  let durable = {};
  const adapter = adapterWithClient({
    async request() { return {}; },
    async *events(_id, _signal, connected) {
      connected?.();
      yield {type: "message.complete", payload: {turn_id: "msg_old", text: "old answer", status: "complete"}};
      durable = {messageId: "msg_new", instruction: "finish the assignment", submitted: true};
      yield {type: "message.complete", payload: {turn_id: "msg_new", text: "new final report", status: "complete"}};
    },
  });
  adapter.sessions.set("stored", {externalSessionId: "stored", liveSessionId: "live", directory: process.cwd(), activeTurnId: "msg_old", activeTurnText: "old request", submittedTurnId: "msg_old"});
  const events = [];
  for await (const event of adapter.streamSession({externalSessionId: "stored", resolveActiveTurn: () => durable})) events.push(event);
  assert.equal(events.filter(e => e.type === "assistant.delta").map(e => e.payload.text).join(""), "new final report");
  assert.equal(events.filter(e => e.type === "assistant.completed").length, 1);
});

test("concurrent stream startup acquires one shared lease and releases it once", async (t) => {
  const leases = await withLeases(t);
  const adapter = adapterWithClient({
    async request() { return {}; },
    async *events(_id, signal) {
      yield {type: "message.delta", payload: {turn_id: "msg_current", text: "working"}};
      await new Promise(resolve => signal.addEventListener("abort", resolve, {once: true}));
    },
  });
  const input = {externalSessionId: "stored", liveSessionId: "live", directory: process.cwd(), messageId: "msg_current"};
  const first = adapter.streamSession(input), second = adapter.streamSession(input);
  await Promise.all([first.next(), second.next()]);
  assert.equal(leases.acquired(), 1);
  await first.return();
  assert.equal(leases.live.size, 1);
  await second.return();
  assert.equal(leases.live.size, 0);
});

test("repeated runtime recovery releases the replaced session even at the lease limit", async (t) => {
  const leases = await withLeases(t, 1);
  let sequence = 0;
  const closed = [];
  const adapter = adapterWithClient({async request(method, params) {
    if (method === "session.create") return {session_id: `live-${++sequence}`, stored_session_id: `stored-${sequence}`};
    if (method === "session.close") closed.push(params.session_id);
    return {};
  }});
  const base = {surface: "garden_chat", sessionKey: "autonomy-lease-test"};
  let session = await adapter.createSession(base);
  for (let i = 0; i < 12; i++) session = await adapter.restoreSession({...base, externalSessionId: session.externalSessionId});
  assert.equal(closed.length, 12);
  assert.equal(adapter.sessions.size, 1);
  await adapter.disposeSession(session);
  assert.equal(leases.live.size, 0);
});

test("an invalid session-create reply does not leak its startup lease", async (t) => {
  const leases = await withLeases(t);
  const adapter = adapterWithClient({async request() { return {}; }});
  await assert.rejects(adapter.createSession({surface: "garden_chat", sessionKey: "invalid-lease-test"}), /invalid session/);
  assert.equal(leases.live.size, 0);
});

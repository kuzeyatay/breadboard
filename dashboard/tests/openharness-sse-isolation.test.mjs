import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { OpenHarnessGateway } from "../src/lib/openharness/gateway.ts";

// A fake OpenHarness server whose /event stream interleaves events for TWO
// different sessions on the SAME workspace directory. This proves the gateway's
// per-session normalization filter prevents cross-session leakage even when the
// directory filter alone would let both through.
function startInterleavedServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/event") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      // Interleave session A and session B deltas, then idle both.
      send({ id: "1", type: "message.part.delta", properties: { sessionID: "A", field: "text", delta: "A1" } });
      send({ id: "2", type: "message.part.delta", properties: { sessionID: "B", field: "text", delta: "B1" } });
      send({ id: "3", type: "message.part.delta", properties: { sessionID: "A", field: "text", delta: "A2" } });
      send({ id: "4", type: "message.part.delta", properties: { sessionID: "B", field: "text", delta: "B2" } });
      send({ id: "5", type: "session.idle", properties: { sessionID: "A" } });
      send({ id: "6", type: "session.idle", properties: { sessionID: "B" } });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function makeGateway(port) {
  return new OpenHarnessGateway({
    enabled: true,
    baseUrl: `http://127.0.0.1:${port}`,
    username: "breadboard",
    password: "",
    root: path.join(os.tmpdir(), "bb-oh-sse-isolation"),
    agents: { terminal: "t", garden: "g", quartz: "q", capabilityScout: "s" },
    requestTimeoutMs: 5000,
    dashboardInternalUrl: "http://127.0.0.1:3000",
  });
}

test("two concurrent session subscriptions never receive each other's events", async () => {
  const { server, port } = await startInterleavedServer();
  try {
    const gateway = makeGateway(port);
    const collect = async (sessionId) => {
      const out = [];
      for await (const e of gateway.subscribeToSession({ openHarnessSessionId: sessionId, workspaceKey: "terminal/x" })) {
        if (e.type === "assistant.delta") out.push(e.payload.text);
        if (e.type === "session.status" && e.payload.status === "idle") break;
      }
      return out;
    };
    // Subscribe to both concurrently against the same interleaved stream.
    const [a, b] = await Promise.all([collect("A"), collect("B")]);
    assert.deepEqual(a, ["A1", "A2"], "session A only sees A deltas");
    assert.deepEqual(b, ["B1", "B2"], "session B only sees B deltas");
  } finally {
    server.close();
  }
});

test("a subscription for an unknown session id yields no other session's content", async () => {
  const { server, port } = await startInterleavedServer();
  try {
    const gateway = makeGateway(port);
    const out = [];
    for await (const e of gateway.subscribeToSession({ openHarnessSessionId: "C", workspaceKey: "terminal/x" })) {
      if (e.type === "assistant.delta") out.push(e.payload.text);
    }
    assert.deepEqual(out, [], "no deltas leak to an unrelated session id");
  } finally {
    server.close();
  }
});

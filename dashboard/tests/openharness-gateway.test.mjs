import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { OpenHarnessGateway } from "../src/lib/openharness/gateway.ts";

// A minimal fake OpenHarness server implementing the subset of the HTTP API the
// gateway uses. It records requests so tests can assert on auth headers, routing
// query params, and payloads, and drives an SSE stream for subscription tests.
function startFakeServer() {
  const state = { requests: [], sseControllers: new Set() };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.requests.push({
        method: req.method,
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams),
        auth: req.headers["authorization"] ?? null,
        body: body ? JSON.parse(body) : undefined,
      });

      if (url.pathname === "/global/health") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ healthy: true, version: "test-1" }));
      }
      if (url.pathname === "/agent") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify([
            { name: "breadboard-terminal", mode: "primary" },
            { name: "title", hidden: true },
          ]),
        );
      }
      if (url.pathname === "/config/providers") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            providers: [{ id: "chatmock", models: { "gpt-5": { id: "gpt-5", name: "GPT-5" } } }],
          }),
        );
      }
      if (url.pathname === "/session" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "oh_session_1" }));
      }
      if (url.pathname.endsWith("/prompt_async") && req.method === "POST") {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname.endsWith("/abort") && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end("true");
      }
      if (url.pathname.includes("/permissions/") && req.method === "POST") {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === "/event") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
        // Two sessions interleaved; the gateway must only surface oh_session_1.
        send({ id: "e1", type: "message.part.delta", properties: { sessionID: "oh_session_1", field: "text", delta: "Hi" } });
        send({ id: "e2", type: "message.part.delta", properties: { sessionID: "other", field: "text", delta: "leak" } });
        send({ id: "e3", type: "message.part.delta", properties: { sessionID: "oh_session_1", field: "text", delta: "!" } });
        send({ id: "e4", type: "session.idle", properties: { sessionID: "oh_session_1" } });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, state });
    });
  });
}

function makeGateway(port) {
  return new OpenHarnessGateway({
    enabled: true,
    baseUrl: `http://127.0.0.1:${port}`,
    username: "breadboard",
    password: "s3cret",
    root: path.join(os.tmpdir(), "bb-oh-gateway-test"),
    agents: { terminal: "breadboard-terminal", garden: "breadboard-garden", quartz: "breadboard-quartz", capabilityScout: "breadboard-capability-scout" },
    requestTimeoutMs: 5000,
  });
}

test("health returns server health and sends basic auth", async () => {
  const { server, port, state } = await startFakeServer();
  try {
    const gateway = makeGateway(port);
    const health = await gateway.health();
    assert.equal(health.healthy, true);
    assert.equal(health.version, "test-1");
    const healthReq = state.requests.find((r) => r.pathname === "/global/health");
    assert.equal(healthReq.auth, `Basic ${Buffer.from("breadboard:s3cret").toString("base64")}`);
  } finally {
    server.close();
  }
});

test("listAgents filters hidden agents", async () => {
  const { server, port } = await startFakeServer();
  try {
    const agents = await makeGateway(port).listAgents();
    assert.equal(agents.length, 1);
    assert.equal(agents[0].name, "breadboard-terminal");
  } finally {
    server.close();
  }
});

test("listModels flattens provider models", async () => {
  const { server, port } = await startFakeServer();
  try {
    const models = await makeGateway(port).listModels();
    assert.equal(models.length, 1);
    assert.equal(models[0].id, "gpt-5");
    assert.equal(models[0].providerId, "chatmock");
  } finally {
    server.close();
  }
});

test("createSession routes a workspace directory and picks the garden agent", async () => {
  const { server, port, state } = await startFakeServer();
  try {
    const gateway = makeGateway(port);
    const session = await gateway.createSession({
      surface: "garden_chat",
      sessionKey: "abc",
      gardenKey: "physics",
      title: "Garden chat",
    });
    assert.equal(session.openHarnessSessionId, "oh_session_1");
    assert.equal(session.agentName, "breadboard-garden");
    assert.equal(session.workspaceKey, "gardens/physics/abc");
    const createReq = state.requests.find((r) => r.pathname === "/session" && r.method === "POST");
    assert.ok(createReq.query.directory.includes("gardens"));
    assert.equal(createReq.body.agent, "breadboard-garden");
  } finally {
    server.close();
  }
});

test("sendMessage posts a text part to prompt_async", async () => {
  const { server, port, state } = await startFakeServer();
  try {
    const gateway = makeGateway(port);
    await gateway.sendMessage({
      openHarnessSessionId: "oh_session_1",
      workspaceKey: "terminal/abc",
      agentName: "breadboard-terminal",
      text: "hello",
      model: { providerID: "chatmock", modelID: "gpt-5.6-terra" },
      variant: "xhigh",
    });
    const promptReq = state.requests.find((r) => r.pathname.endsWith("/prompt_async"));
    assert.equal(promptReq.body.parts[0].text, "hello");
    assert.equal(promptReq.body.agent, "breadboard-terminal");
    assert.deepEqual(promptReq.body.model, { providerID: "chatmock", modelID: "gpt-5.6-terra" });
    assert.equal(promptReq.body.variant, "xhigh");
  } finally {
    server.close();
  }
});

test("subscribeToSession yields only this session's normalized events", async () => {
  const { server, port } = await startFakeServer();
  try {
    const gateway = makeGateway(port);
    const events = [];
    for await (const e of gateway.subscribeToSession({
      openHarnessSessionId: "oh_session_1",
      workspaceKey: "terminal/abc",
    })) {
      events.push(e);
    }
    // "leak" from the other session must be filtered out.
    const deltas = events.filter((e) => e.type === "assistant.delta").map((e) => e.payload.text);
    assert.deepEqual(deltas, ["Hi", "!"]);
    assert.ok(events.some((e) => e.type === "session.status" && e.payload.status === "idle"));
  } finally {
    server.close();
  }
});

test("abort and permission responses reach the server", async () => {
  const { server, port, state } = await startFakeServer();
  try {
    const gateway = makeGateway(port);
    await gateway.abortSession({ openHarnessSessionId: "oh_session_1", workspaceKey: "terminal/abc" });
    await gateway.respondToPermission({
      openHarnessSessionId: "oh_session_1",
      workspaceKey: "terminal/abc",
      requestId: "p1",
      decision: "once",
    });
    assert.ok(state.requests.some((r) => r.pathname.endsWith("/abort")));
    const permReq = state.requests.find((r) => r.pathname.includes("/permissions/"));
    assert.equal(permReq.body.response, "once");
  } finally {
    server.close();
  }
});

test("unreachable server surfaces a recoverable error", async () => {
  const gateway = makeGateway(1); // nothing listening on port 1
  await assert.rejects(gateway.health(), (err) => {
    assert.equal(err.recoverable, true);
    return true;
  });
});

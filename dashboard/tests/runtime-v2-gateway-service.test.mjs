import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { startRuntimeV2GatewayHttpService } from "../scripts/runtime-v2-gateway-http.mjs";

const TOKEN = "gateway-test-capability-token-0123456789abcdef";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("gateway service exposes public health but seals every control operation", async (t) => {
  const port = await freePort();
  process.env.BREADBOARD_TEST_GATEWAY_TOKEN = TOKEN;
  const service = await startRuntimeV2GatewayHttpService({
    name: "test-gateway",
    tokenEnvironmentName: "BREADBOARD_TEST_GATEWAY_TOKEN",
    argv: ["--port", String(port)],
    route: async ({ method, path, body }) => ({ method, path, body }),
  });
  t.after(async () => {
    await service.stop();
    delete process.env.BREADBOARD_TEST_GATEWAY_TOKEN;
  });

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: "test-gateway" });

  const denied = await fetch(`http://127.0.0.1:${port}/v1/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"userId":1}',
  });
  assert.equal(denied.status, 401);

  const accepted = await fetch(`http://127.0.0.1:${port}/v1/status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: '{"userId":1}',
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual((await accepted.json()).result, {
    method: "POST",
    path: "/v1/status",
    body: { userId: 1 },
  });
});

test("gateway service rejects ambient or malformed launch authority", async () => {
  process.env.BREADBOARD_TEST_GATEWAY_TOKEN = "short";
  await assert.rejects(
    startRuntimeV2GatewayHttpService({
      name: "test-gateway",
      tokenEnvironmentName: "BREADBOARD_TEST_GATEWAY_TOKEN",
      argv: ["--port", "8080"],
      route: async () => ({}),
    }),
    /capability is invalid/u,
  );
  delete process.env.BREADBOARD_TEST_GATEWAY_TOKEN;
});

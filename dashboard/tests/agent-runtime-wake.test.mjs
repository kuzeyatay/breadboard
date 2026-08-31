import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";

import { wakeAgentRuntime } from "../src/lib/agent-runtime/wake.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const WAKE_ENV_NAMES = [
  "BREADBOARD_SUPERVISOR_CONTROL_URL",
  "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
  "BREADBOARD_TELEGRAM_GATEWAY_TOKEN",
  "BREADBOARD_WHATSAPP_GATEWAY_TOKEN",
  "BREADBOARD_INTERNAL_URL",
];

function withEnv(overrides, run) {
  const saved = new Map(WAKE_ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of WAKE_ENV_NAMES) delete process.env[name];
  for (const [name, value] of Object.entries(overrides)) process.env[name] = value;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
}

const GATEWAY_TOKEN = "telegram-gateway-token-0123456789abcdef";

test("with nothing to wake, an unsupervised dev stack is a successful no-op", async () => {
  await withEnv({}, async () => {
    assert.equal(await wakeAgentRuntime("telegram-inbound"), true);
  });
});

test("a gateway process wakes the runtime through the dashboard's internal route", async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true,"supervised":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await withEnv(
      {
        BREADBOARD_TELEGRAM_GATEWAY_TOKEN: GATEWAY_TOKEN,
        BREADBOARD_INTERNAL_URL: `http://127.0.0.1:${port}`,
      },
      async () => {
        assert.equal(await wakeAgentRuntime("telegram-inbound"), true);
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/api/internal/agent-runtime-wake");
  // The gateway authenticates with its own service token — the same shared
  // secret the dashboard holds to call into the gateway.
  assert.equal(requests[0].authorization, `Bearer ${GATEWAY_TOKEN}`);
  assert.deepEqual(JSON.parse(requests[0].body), { reason: "telegram-inbound" });
});

test("a wake the dashboard refuses is reported as a failure, not thrown", async () => {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"ok":false,"code":"wake_failed"}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await withEnv(
      {
        BREADBOARD_WHATSAPP_GATEWAY_TOKEN: GATEWAY_TOKEN,
        BREADBOARD_INTERNAL_URL: `http://127.0.0.1:${port}`,
      },
      async () => {
        assert.equal(await wakeAgentRuntime("whatsapp-inbound"), false);
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the internal wake route only answers gateway tokens and only wakes hermes", () => {
  const route = source("../src/app/api/internal/agent-runtime-wake/route.ts");
  // Auth is the gateway service tokens, compared in constant time; without a
  // configured token the route does not exist.
  assert.match(route, /BREADBOARD_TELEGRAM_GATEWAY_TOKEN/);
  assert.match(route, /BREADBOARD_WHATSAPP_GATEWAY_TOKEN/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /status: 404/);
  // The route's only capability is the shared Hermes wake lease — it must not
  // proxy arbitrary supervisor control for the gateways.
  assert.match(route, /holdAgentRuntimeLease\(/);
  assert.doesNotMatch(route, /acquireServiceLease\(/);

  const wake = source("../src/lib/agent-runtime/wake.ts");
  // The dashboard-side holder leases hermes specifically and releases on a
  // timer, so back-to-back messages share one lease.
  assert.match(wake, /acquireServiceLease\("hermes", reason\)/);
  assert.match(wake, /releaseSupervisorLease\(/);
  assert.match(wake, /timer\.unref\(\)/);
});

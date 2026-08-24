import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  SupervisorResourceExhaustedError,
  acquireServiceLease,
  withCapabilityLease,
  withServiceLease,
} from "../src/lib/supervisor-control.ts";

async function controlHarness(handler) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      body: body ? JSON.parse(body) : {},
    });
    const result = await handler(request, requests.at(-1));
    response.writeHead(result.status ?? 200, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const env = {
    BREADBOARD_SUPERVISOR_CONTROL_URL: `http://127.0.0.1:${address.port}`,
    BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "test-secret",
  };
  return {
    env,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("a service lease stays active for the operation and releases on cancellation", async () => {
  let active = false;
  const harness = await controlHarness(async (request) => {
    if (request.url === "/v1/services/hermes/lease") {
      active = true;
      return { body: { ok: true, leaseId: "11111111-1111-1111-1111-111111111111", serviceId: "hermes" } };
    }
    if (request.url === "/v1/leases/11111111-1111-1111-1111-111111111111/release") {
      active = false;
      return { body: { ok: true, released: true } };
    }
    return { status: 404, body: { ok: false } };
  });
  try {
    await assert.rejects(
      withServiceLease("hermes", "cancelled-stream", async () => {
        assert.equal(active, true);
        throw new DOMException("client disconnected", "AbortError");
      }, harness.env),
      (error) => error?.name === "AbortError",
    );
    assert.equal(active, false);
    assert.deepEqual(harness.requests.map((request) => request.url), [
      "/v1/services/hermes/lease",
      "/v1/leases/11111111-1111-1111-1111-111111111111/release",
    ]);
    assert.ok(harness.requests.every((request) => request.authorization === "Bearer test-secret"));
    assert.ok(harness.requests.every((request) => !request.url.includes("test-secret")));
  } finally {
    await harness.close();
  }
});

test("commit admission denial remains structured and is never retried", async () => {
  const harness = await controlHarness(async () => ({
    status: 503,
    body: {
      code: "BREADBOARD_RESOURCE_EXHAUSTED",
      resource: "windows_commit",
      requiredHeadroomMb: 8192,
      availableHeadroomMb: 5376,
      retryable: false,
      state: "critical",
    },
  }));
  try {
    await assert.rejects(
      acquireServiceLease("ui-tars", "browser-run", harness.env),
      (error) => {
        assert.ok(error instanceof SupervisorResourceExhaustedError);
        assert.equal(error.result.availableHeadroomMb, 5376);
        assert.equal(error.result.retryable, false);
        return true;
      },
    );
    assert.equal(harness.requests.length, 1);
  } finally {
    await harness.close();
  }
});

test("bare dashboard development degrades to a local no-op lease", async () => {
  let ran = false;
  const result = await withCapabilityLease("document-ingestion", "ingest", async () => {
    ran = true;
    return 42;
  }, {});
  assert.equal(ran, true);
  assert.equal(result, 42);
});

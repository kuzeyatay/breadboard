import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

process.env.GBRAIN_BACKEND = "fake";
process.env.GBRAIN_TEST_MODE = "1";
process.env.GBRAIN_EMBEDDING_PROVIDER = "none";

const {
  DEFAULT_NODE_REQUEST_BODY_LIMIT_BYTES,
  initializeNodeAdapterStore,
  startNodeAdapter,
} = await import(
  "../src/node-server.ts"
);
const { createAdapterRequestHandler } = await import("../src/request-handler.ts");
const { GBrainEngineBackend } = await import("../src/backends/gbrain-backend.ts");

const SECRET = "node-test-secret-12345";

function boot(overrides = {}, transportOptions = {}) {
  return startNodeAdapter(
    {
      host: "127.0.0.1",
      port: 0,
      secret: SECRET,
      pgDir: ":memory:",
      embeddingProvider: "hash",
      ...overrides,
    },
    transportOptions,
  );
}

function searchRequest(query = "probe") {
  return new Request("http://127.0.0.1/search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      scope: { userId: "node-test", authorizedSourceIds: ["source"] },
      query,
    }),
  });
}

test("Node adapter refuses missing secrets and non-loopback binds", async () => {
  await assert.rejects(
    startNodeAdapter({ port: 0, secret: "", pgDir: ":memory:" }),
    /secret/iu,
  );
  await assert.rejects(
    startNodeAdapter({
      host: "0.0.0.0",
      port: 0,
      secret: SECRET,
      pgDir: ":memory:",
    }),
    /loopback/iu,
  );
});

test("Node transport preserves health, auth, scope, and sanitized errors", async () => {
  const server = await boot();
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    const health = await fetch(`${origin}/health`);
    const healthBody = await health.json();
    assert.equal(health.status, 200);
    assert.equal(healthBody.status, "healthy");
    assert.equal(healthBody.backend, "fake");
    assert.equal(JSON.stringify(healthBody).includes(SECRET), false);

    const unauthorized = await fetch(`${origin}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: { userId: "node-test", authorizedSourceIds: ["source"] },
        query: "probe",
      }),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error, "unauthorized");

    const missingScope = await fetch(`${origin}/search`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "probe" }),
    });
    assert.equal(missingScope.status, 400);
    assert.equal((await missingScope.json()).error, "missing_scope");

    const invalidJson = await fetch(`${origin}/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: "not-json",
    });
    const invalidJsonText = await invalidJson.text();
    assert.equal(invalidJson.status, 400);
    assert.equal(JSON.parse(invalidJsonText).error, "invalid_json");
    assert.equal(invalidJsonText.includes(SECRET), false);
    assert.equal(invalidJsonText.includes("Error"), false);
  } finally {
    await Promise.all([server.stop(), server.stop()]);
  }
});

test("shared request timeouts are cleared after a fast operation", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let trackedTimeout = null;
  let cleared = false;
  globalThis.setTimeout = ((handler, milliseconds, ...args) => {
    trackedTimeout = originalSetTimeout(handler, milliseconds, ...args);
    return trackedTimeout;
  });
  globalThis.clearTimeout = ((timeout) => {
    if (timeout === trackedTimeout) cleared = true;
    return originalClearTimeout(timeout);
  });

  const store = {
    backendName: "fake",
    mode: "lexical_degraded",
    providerName: "none",
    embeddingsAvailable: false,
    search: async () => ({ results: [], mode: "lexical_degraded", warnings: [] }),
  };
  const handler = createAdapterRequestHandler(store, {
    host: "127.0.0.1",
    port: 0,
    secret: SECRET,
    dataDir: ":memory:",
    pgDir: ":memory:",
    embeddingProvider: "none",
    embeddingModel: "",
    queryTimeoutMs: 60_000,
    version: "test",
  });

  try {
    const response = await handler(
      new Request("http://127.0.0.1/search", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          scope: { userId: "node-test", authorizedSourceIds: ["source"] },
          query: "probe",
        }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(cleared, true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (trackedTimeout !== null) originalClearTimeout(trackedTimeout);
  }
});

test("a timed-out backend operation retains the only slot until it settles", async () => {
  let release;
  const slowResult = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const store = {
    backendName: "fake",
    mode: "lexical_degraded",
    providerName: "none",
    embeddingsAvailable: false,
    search: async () => {
      calls += 1;
      if (calls === 1) return slowResult;
      return { results: [], mode: "lexical_degraded", warnings: [] };
    },
  };
  const handler = createAdapterRequestHandler(store, {
    host: "127.0.0.1",
    port: 0,
    secret: SECRET,
    dataDir: ":memory:",
    pgDir: ":memory:",
    embeddingProvider: "none",
    embeddingModel: "",
    queryTimeoutMs: 15,
    version: "test",
  });

  const timedOut = await handler(searchRequest("slow"));
  assert.equal(timedOut.status, 504);
  assert.equal((await timedOut.json()).error, "query_timeout");

  const overlapping = await handler(searchRequest("must-not-overlap"));
  assert.equal(overlapping.status, 503);
  assert.equal((await overlapping.json()).error, "backend_busy");
  assert.equal(calls, 1);
  assert.equal(await handler.drain(5), false);

  release({ results: [], mode: "lexical_degraded", warnings: [] });
  assert.equal(await handler.drain(250), true);
  const afterSettlement = await handler(searchRequest("after-settlement"));
  assert.equal(afterSettlement.status, 200);
  assert.equal(calls, 2);
});

test("operation admission precedes JSON materialization for concurrent 64 MiB requests", async () => {
  let markParsingStarted;
  const parsingStarted = new Promise((resolve) => {
    markParsingStarted = resolve;
  });
  let releaseFirstBody;
  const firstBody = new Promise((resolve) => {
    releaseFirstBody = resolve;
  });
  let backendCalls = 0;
  const store = {
    backendName: "fake",
    mode: "lexical_degraded",
    providerName: "none",
    embeddingsAvailable: false,
    search: async () => {
      backendCalls += 1;
      return { results: [], mode: "lexical_degraded", warnings: [] };
    },
  };
  const handler = createAdapterRequestHandler(store, {
    host: "127.0.0.1",
    port: 0,
    secret: SECRET,
    dataDir: ":memory:",
    pgDir: ":memory:",
    embeddingProvider: "none",
    embeddingModel: "",
    queryTimeoutMs: 1_000,
    version: "test",
  });
  const headers = new Headers({
    authorization: `Bearer ${SECRET}`,
    "content-type": "application/json",
  });
  const firstRequest = {
    url: "http://127.0.0.1/search",
    method: "POST",
    headers,
    async json() {
      markParsingStarted();
      return firstBody;
    },
  };

  const firstResponse = handler(firstRequest);
  await parsingStarted;
  let competitorMaterializations = 0;
  const competitors = Array.from({ length: 24 }, () => ({
    url: "http://127.0.0.1/search",
    method: "POST",
    headers: new Headers({
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
      "content-length": String(DEFAULT_NODE_REQUEST_BODY_LIMIT_BYTES),
    }),
    async json() {
      competitorMaterializations += 1;
      throw new Error("a rejected 64 MiB body must never be materialized");
    },
  }));
  const rejected = await Promise.all(competitors.map((request) => handler(request)));
  assert.deepEqual(rejected.map(({ status }) => status), new Array(24).fill(503));
  assert.deepEqual(
    await Promise.all(rejected.map((response) => response.json().then(({ error }) => error))),
    new Array(24).fill("backend_busy"),
  );
  assert.equal(competitorMaterializations, 0);
  assert.equal(backendCalls, 0);

  releaseFirstBody({
    scope: { userId: "node-test", authorizedSourceIds: ["source"] },
    query: "admitted",
  });
  assert.equal((await firstResponse).status, 200);
  assert.equal(backendCalls, 1);
  assert.equal(await handler.drain(250), true);
});

test("readiness fails closed while liveness stays sanitized", async () => {
  const store = {
    backendName: "fake",
    mode: "lexical_degraded",
    providerName: "none",
    embeddingsAvailable: false,
    stats: async () => {
      throw new Error("sensitive database path C:\\private\\store");
    },
  };
  const handler = createAdapterRequestHandler(store, {
    host: "127.0.0.1",
    port: 0,
    secret: SECRET,
    dataDir: "C:\\private",
    pgDir: "C:\\private\\store",
    embeddingProvider: "none",
    embeddingModel: "",
    queryTimeoutMs: 100,
    version: "test",
  });

  const ready = await handler(new Request("http://127.0.0.1/ready"));
  const readyText = await ready.text();
  assert.equal(ready.status, 503);
  assert.equal(JSON.parse(readyText).ready, false);
  assert.equal(JSON.parse(readyText).error, "internal_error");
  assert.equal(readyText.includes("C:\\private"), false);

  const health = await handler(new Request("http://127.0.0.1/health"));
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ready, false);
});

test("real GBrain count-query failure cannot masquerade as ready zero stats", async () => {
  let countQueries = 0;
  const backend = new GBrainEngineBackend({
    pgDir: ":memory:",
    embeddingEnv: { provider: "none", testMode: true },
  });
  backend.engine = {
    async executeRaw() {
      countQueries += 1;
      throw new Error("database unavailable at C:\\private\\gbrain");
    },
  };
  const handler = createAdapterRequestHandler(backend, {
    host: "127.0.0.1",
    port: 0,
    secret: SECRET,
    dataDir: "C:\\private",
    pgDir: "C:\\private\\gbrain",
    embeddingProvider: "none",
    embeddingModel: "",
    queryTimeoutMs: 100,
    version: "test",
  });

  const ready = await handler(new Request("http://127.0.0.1/ready"));
  const body = await ready.text();
  assert.equal(ready.status, 503);
  assert.equal(JSON.parse(body).ready, false);
  assert.equal(JSON.parse(body).error, "internal_error");
  assert.equal(JSON.parse(body).sources, 0);
  assert.equal(body.includes("C:\\private"), false);
  assert.equal(countQueries, 1);
  await assert.rejects(backend.stats(), /database unavailable/u);
});

test("partial backend initialization is closed before the error escapes", async () => {
  const startupError = new Error("init failed");
  let closed = 0;
  const store = {
    init: async () => {
      throw startupError;
    },
    close: async () => {
      closed += 1;
    },
  };

  await assert.rejects(initializeNodeAdapterStore(store), (error) => error === startupError);
  assert.equal(closed, 1);
});

test("Node transport bounds declared and chunked request bodies", async () => {
  assert.equal(DEFAULT_NODE_REQUEST_BODY_LIMIT_BYTES, 64 * 1024 * 1024);
  const server = await boot({}, { maxRequestBodyBytes: 128 });
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    const declared = await fetch(`${origin}/search`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ payload: "x".repeat(256) }),
    });
    assert.equal(declared.status, 413);
    assert.equal((await declared.json()).error, "request_too_large");

    const chunkedBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(80).fill(0x20));
        controller.enqueue(new Uint8Array(80).fill(0x20));
        controller.close();
      },
    });
    const chunked = await fetch(`${origin}/search`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRET}`,
        "content-type": "application/json",
      },
      body: chunkedBody,
      duplex: "half",
    });
    assert.equal(chunked.status, 413);
    assert.equal((await chunked.json()).error, "request_too_large");
  } finally {
    await server.stop();
  }
});

test("a busy 64 MiB request is rejected before parsing and closes its partial keepalive", async () => {
  const server = await boot({ queryTimeoutMs: 1_000 });
  const origin = `http://127.0.0.1:${server.port}`;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  let release;
  const slowResult = new Promise((resolve) => {
    release = resolve;
  });
  let backendCalls = 0;
  server.store.search = async () => {
    backendCalls += 1;
    markStarted();
    return slowResult;
  };

  const first = fetch(`${origin}/search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      scope: { userId: "node-test", authorizedSourceIds: ["source"] },
      query: "hold the backend slot",
    }),
  });
  await started;

  const agent = new http.Agent({ keepAlive: true });
  try {
    const busy = await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) reject(new Error("partial busy request did not terminate"));
      }, 5_000);
      timeout.unref();
      const request = http.request(
        {
          host: "127.0.0.1",
          port: server.port,
          path: "/search",
          method: "POST",
          agent,
          headers: {
            authorization: `Bearer ${SECRET}`,
            "content-type": "application/json",
            "content-length": String(DEFAULT_NODE_REQUEST_BODY_LIMIT_BYTES),
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            text += chunk;
          });
          response.on("end", () => {
            settled = true;
            clearTimeout(timeout);
            resolve({
              status: response.statusCode,
              connection: response.headers.connection,
              body: text,
            });
          });
        },
      );
      request.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      });
      // Send only a prefix. Early admission must reject without waiting for or
      // retaining the remaining 64 MiB, and the server must close this socket.
      request.write("{");
    });
    assert.equal(busy.status, 503);
    assert.equal(JSON.parse(busy.body).error, "backend_busy");
    assert.equal(busy.connection, "close");
    assert.equal(backendCalls, 1);
  } finally {
    agent.destroy();
  }

  release({ results: [], mode: "lexical_degraded", warnings: [] });
  assert.equal((await first).status, 200);
  const after = await fetch(`${origin}/search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      scope: { userId: "node-test", authorizedSourceIds: ["source"] },
      query: "after partial rejection",
    }),
  });
  assert.equal(after.status, 200);
  assert.equal(backendCalls, 2);
  await server.stop();
});

test("Node shutdown drains admitted backend work before closing the store", async () => {
  const server = await boot(
    { queryTimeoutMs: 500 },
    { shutdownDrainTimeoutMs: 1_000 },
  );
  const origin = `http://127.0.0.1:${server.port}`;
  let release;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const slowResult = new Promise((resolve) => {
    release = resolve;
  });
  server.store.search = async () => {
    markStarted();
    return slowResult;
  };
  const originalClose = server.store.close.bind(server.store);
  let storeClosed = false;
  server.store.close = async () => {
    storeClosed = true;
    await originalClose();
  };

  const request = fetch(`${origin}/search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      scope: { userId: "node-test", authorizedSourceIds: ["source"] },
      query: "slow shutdown",
    }),
  }).catch(() => null);
  await started;
  const stopping = server.stop();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(storeClosed, false);

  release({ results: [], mode: "lexical_degraded", warnings: [] });
  await stopping;
  await request;
  assert.equal(storeClosed, true);
});

test("a shutdown drain deadline never race-closes an active backend", async () => {
  const server = await boot(
    { queryTimeoutMs: 500 },
    { shutdownDrainTimeoutMs: 20 },
  );
  const origin = `http://127.0.0.1:${server.port}`;
  let release;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const slowResult = new Promise((resolve) => {
    release = resolve;
  });
  server.store.search = async () => {
    markStarted();
    return slowResult;
  };
  const originalClose = server.store.close.bind(server.store);
  let storeClosed = false;
  server.store.close = async () => {
    storeClosed = true;
    await originalClose();
  };

  const request = fetch(`${origin}/search`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      scope: { userId: "node-test", authorizedSourceIds: ["source"] },
      query: "bounded shutdown",
    }),
  }).catch(() => null);
  await started;

  await assert.rejects(server.stop(), /gbrain_backend_drain_timeout/u);
  assert.equal(storeClosed, false);
  release({ results: [], mode: "lexical_degraded", warnings: [] });
  await request;
  for (let attempt = 0; attempt < 50 && !storeClosed; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(storeClosed, true);
});

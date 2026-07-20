import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { runHealthCheck, waitForHealthy } from "../src/main/health-checker";
import { findFreePort } from "../src/main/ports";

async function withServer(
  handler: http.RequestListener,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  const port = await findFreePort();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("http check passes on 200 and honors body expectations", async () => {
  await withServer(
    (request, response) => {
      response.end(JSON.stringify({ providers: ["chatmock"] }));
    },
    async (port) => {
      assert.equal(
        await runHealthCheck({ type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000 }),
        true,
      );
      assert.equal(
        await runHealthCheck({
          type: "http",
          url: `http://127.0.0.1:${port}/`,
          expectBodyIncludes: "chatmock",
          timeoutMs: 1000,
        }),
        true,
      );
      assert.equal(
        await runHealthCheck({
          type: "http",
          url: `http://127.0.0.1:${port}/`,
          expectBodyIncludes: "not-there",
          timeoutMs: 1000,
        }),
        false,
      );
    },
  );
});

test("acceptAnyStatus treats a 404 as ready but still needs a live server", async () => {
  // Quartz answers 404 for / until the garden has pages; the server being up
  // is the real readiness signal.
  await withServer(
    (request, response) => {
      response.statusCode = 404;
      response.end("not found");
    },
    async (port) => {
      const url = `http://127.0.0.1:${port}/`;
      assert.equal(await runHealthCheck({ type: "http", url, timeoutMs: 1000 }), false);
      assert.equal(
        await runHealthCheck({ type: "http", url, acceptAnyStatus: true, timeoutMs: 1000 }),
        true,
      );
    },
  );
  const deadPort = await findFreePort();
  assert.equal(
    await runHealthCheck({
      type: "http",
      url: `http://127.0.0.1:${deadPort}/`,
      acceptAnyStatus: true,
      timeoutMs: 500,
    }),
    false,
  );
});

test("http check fails on 500 and on connection refusal", async () => {
  await withServer(
    (request, response) => {
      response.statusCode = 500;
      response.end();
    },
    async (port) => {
      assert.equal(
        await runHealthCheck({ type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000 }),
        false,
      );
    },
  );
  const deadPort = await findFreePort();
  assert.equal(
    await runHealthCheck({ type: "http", url: `http://127.0.0.1:${deadPort}/`, timeoutMs: 500 }),
    false,
  );
});

test("waitForHealthy times out with a reason and aborts early when asked", async () => {
  const deadPort = await findFreePort();
  const spec = { type: "http" as const, url: `http://127.0.0.1:${deadPort}/`, timeoutMs: 200 };
  const timedOut = await waitForHealthy(spec, { startupTimeoutMs: 700, intervalMs: 100 });
  assert.equal(timedOut.ok, false);
  if (!timedOut.ok) assert.match(timedOut.reason, /timed out/);

  const aborted = await waitForHealthy(spec, {
    startupTimeoutMs: 10_000,
    intervalMs: 100,
    shouldAbort: () => "process exited",
  });
  assert.equal(aborted.ok, false);
  if (!aborted.ok) assert.equal(aborted.reason, "process exited");
});

test("tcp check", async () => {
  await withServer(
    (request, response) => response.end(),
    async (port) => {
      assert.equal(
        await runHealthCheck({ type: "tcp", host: "127.0.0.1", port, timeoutMs: 500 }),
        true,
      );
    },
  );
  const deadPort = await findFreePort();
  assert.equal(
    await runHealthCheck({ type: "tcp", host: "127.0.0.1", port: deadPort, timeoutMs: 500 }),
    false,
  );
});

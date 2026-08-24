// Run with: node --test scripts/service-probe.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";

import { isListening, probeService } from "./service-probe.mjs";

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    url: (path = "/") => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("nothing listening reads as absent, not as a stranger", async () => {
  // A free port must never look occupied: that would stop the stack from
  // starting the service at all.
  const closed = await serve((_request, response) => response.end("ok"));
  const url = closed.url();
  await closed.close();
  assert.equal(await probeService({ url, timeoutMs: 500 }), "absent");
});

test("a healthy service is reused", async () => {
  const server = await serve((_request, response) => response.end('{"status":"ok"}'));
  try {
    assert.equal(await probeService({ url: server.url("/health") }), "running");
    assert.equal(
      await probeService({ url: server.url("/health"), expectBodyIncludes: '"status":"ok"' }),
      "running",
    );
  } finally {
    await server.close();
  }
});

test("a body that does not match makes the occupant foreign", async () => {
  // An unrelated app on the port answers 200 to anything; only the shape of the
  // answer separates it from ours.
  const server = await serve((_request, response) => response.end("<html>someone else</html>"));
  try {
    assert.equal(
      await probeService({ url: server.url("/health"), expectBodyIncludes: '"status":"ok"' }),
      "foreign",
    );
  } finally {
    await server.close();
  }
});

test("a gated endpoint separates our instance from one holding another secret", async () => {
  const server = await serve((request, response) => {
    if (request.headers.authorization !== "Bearer ours") {
      response.statusCode = 401;
      response.end('{"error":"unauthorized"}');
      return;
    }
    response.statusCode = 404;
    response.end('{"error":"not_found"}');
  });
  const gated = { url: server.url("/api/__probe"), acceptStatuses: [200, 400, 404, 405] };
  try {
    assert.equal(
      await probeService({ ...gated, headers: { Authorization: "Bearer ours" } }),
      "running",
    );
    assert.equal(
      await probeService({ ...gated, headers: { Authorization: "Bearer theirs" } }),
      "foreign",
    );
  } finally {
    await server.close();
  }
});

test("a POST probe carries its body to the gated route", async () => {
  const server = await serve((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      response.statusCode = request.method === "POST" && body === "{}" ? 400 : 500;
      response.end('{"error":"missing_scope"}');
    });
  });
  try {
    assert.equal(
      await probeService({
        url: server.url("/search"),
        method: "POST",
        body: "{}",
        acceptStatuses: [200, 400, 404, 405],
      }),
      "running",
    );
  } finally {
    await server.close();
  }
});

test("a bound port that never answers HTTP is foreign, never absent", async () => {
  // A service still starting, or one that does not speak HTTP at all: either
  // way the port is taken and spawning onto it would fail.
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    assert.equal(await isListening(port), true);
    assert.equal(
      await probeService({ url: `http://127.0.0.1:${port}/health`, timeoutMs: 500 }),
      "foreign",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a server that is still compiling is waited out, not spawned over", async () => {
  // The failure this exists for: a cold `next dev` holds the request open while
  // it compiles the route, and a single short probe read that as an empty port,
  // relocated the dashboard, and died on Next's one-dev-server-per-directory
  // lock.
  let answerAfter = Date.now() + 1_200;
  const server = await serve((_request, response) => {
    const reply = () => response.end('{"status":"ok"}');
    const wait = answerAfter - Date.now();
    if (wait > 0) setTimeout(reply, wait);
    else reply();
  });
  const spec = {
    url: server.url("/api/health"),
    expectBodyIncludes: '"status":"ok"',
    timeoutMs: 300,
  };
  try {
    assert.equal(await probeService(spec), "foreign", "one short attempt gives up too early");
    assert.equal(await probeService(spec, 10_000), "running");
  } finally {
    answerAfter = 0;
    await server.close();
  }
});

test("a stranger that answers is settled on the first reply, not waited out", async () => {
  const server = await serve((_request, response) => response.end("<html>someone else</html>"));
  const started = Date.now();
  try {
    assert.equal(
      await probeService(
        { url: server.url("/api/health"), expectBodyIncludes: '"status":"ok"' },
        30_000,
      ),
      "foreign",
    );
    assert.ok(Date.now() - started < 5_000, "an answer ends the wait immediately");
  } finally {
    await server.close();
  }
});

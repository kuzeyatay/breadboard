import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { adoptionBudgetMs, adoptionProbe, isOurServiceRunning } from "../src/main/service-adoption";
import { defaultPersistentConfig } from "../src/main/runtime-config";
import type { ResolvedPaths } from "../src/main/path-resolver";

const persistent = defaultPersistentConfig();
const paths = { configDir: "C:/nowhere" } as unknown as ResolvedPaths;
const context = { persistent, paths };

test("services with no way to identify an instance are never adopted", () => {
  // Postiz's coordinator is authorized by a token minted per launch, so a
  // running one could never answer this launch: it must always start fresh.
  assert.equal(adoptionProbe("postiz", 4007, context), null);
  assert.equal(adoptionProbe("something-new", 1234, context), null);
});

test("Hermes is identified by a gated route, not by its public status probe", () => {
  const probe = adoptionProbe("hermes", 9119, context);
  assert.ok(probe && probe.type === "http");
  assert.ok(!probe.url.endsWith("/api/status"));
  assert.equal(probe.headers?.["Authorization"], `Bearer ${persistent.hermesSessionToken}`);
  // 401 is the interesting failure; anything past the gate proves the token.
  assert.ok(probe.acceptStatuses?.includes(404));
  assert.ok(!probe.acceptStatuses?.includes(401));
});

test("GBrain is identified through a POST, because its /health answers anyone", () => {
  const probe = adoptionProbe("gbrain", 7717, context);
  assert.ok(probe && probe.type === "http");
  assert.equal(probe.method, "POST");
  assert.equal(probe.headers?.["Authorization"], `Bearer ${persistent.gbrainAdapterSecret}`);
});

test("an instance holding a different secret is not ours", async () => {
  // The dev-stack case: a real Breadboard service of the right kind, with
  // credentials this install does not hold. Adopting it would look healthy here
  // and 401 on the first request the dashboard makes.
  const server = http.createServer((request, response) => {
    const expected = `Bearer ${persistent.cadServiceSecret}`;
    response.statusCode = request.headers.authorization === expected ? 200 : 401;
    response.end('{"status":"ok"}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  try {
    assert.equal(await isOurServiceRunning("cad", address.port, context), true);
    const stranger = {
      persistent: { ...persistent, cadServiceSecret: "someone-elses" },
      paths,
    };
    assert.equal(await isOurServiceRunning("cad", address.port, stranger), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("nothing listening is not an instance to adopt", async () => {
  assert.equal(await isOurServiceRunning("chatmock", 1, context), false);
});

test('legacy ChatMock health cannot pass the subscription voice capability check', async () => {
  let current = false;
  const server = http.createServer((_request, response) => {
    response.end(JSON.stringify(current ? { status: 'ok', breadboard_subscription_voice: 1 } : { status: 'ok' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    assert.equal(await isOurServiceRunning('chatmock', address.port, context), false);
    current = true;
    assert.equal(await isOurServiceRunning('chatmock', address.port, context), true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("a dashboard still compiling its route is waited out, not declared a stranger", async () => {
  // The regression this budget exists for: `next dev` holds the first request
  // to a route open while it compiles it (fifteen seconds is ordinary). A
  // single short probe read that as "not ours", moved the dashboard to a spare
  // port, and Next killed it — one dev server per directory.
  const server = http.createServer((_request, response) => {
    setTimeout(() => response.end('{"status":"ok"}'), 1_500);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  try {
    assert.ok(adoptionBudgetMs("dashboard") > 3_000, "the dashboard needs room to compile");
    assert.equal(await isOurServiceRunning("dashboard", address.port, context), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a stranger that answers ends the wait immediately", async () => {
  const server = http.createServer((_request, response) => response.end("<html>not us</html>"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const started = Date.now();
  try {
    assert.equal(await isOurServiceRunning("dashboard", address.port, context), false);
    assert.ok(Date.now() - started < 5_000, "a reply settles it without spending the budget");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { appStreamUrl, forwardAppStream } from "../src/main/app-stream-transport";
import { runElectronFixture } from "./helpers/run-electron-fixture";

const origin = "http://127.0.0.1:32123";
test("stream transport accepts only app feeds on the current loopback dashboard", () => {
  for (const route of ["/api/hermes/sessions/conv_one/events?surface=dashboard_terminal", "/api/deep-research/runs/run_one/events?since=2", "/api/ui-tars/agents/one/runs/two/events"]) {
    assert.equal(appStreamUrl(origin + route, origin, "GET")?.href, origin + route);
    assert.equal(appStreamUrl(origin + route, origin, "POST"), null);
  }
  assert.ok(appStreamUrl(origin + "/api/hermes/sessions/conv_one/direct", origin, "POST"));
  for (const route of ["/api/auth/session", "/api/calendar/events", "/api/hermes/sessions/conv_one/direct", "/api/hermes/sessions/conv_one/messages"]) {
    assert.equal(appStreamUrl(origin + route, origin, "GET"), null);
  }
  for (const url of ["https://example.com/api/hermes/sessions/one/events", "http://127.0.0.1:32124/api/hermes/sessions/one/events", "http://user:pass@127.0.0.1:32123/api/hermes/sessions/one/events"]) {
    assert.equal(appStreamUrl(url, origin, "GET"), null);
  }
  assert.equal(appStreamUrl(origin + "/api/hermes/sessions/one/events", null, "GET"), null);
});

test("stream forwarding preserves live replies, fresh authentication, errors and cancellation", async () => {
  let credential = "first";
  const cookies = { get: async () => [{ name: "session", value: credential }] };
  const controller = new AbortController();
  const url = new URL(origin + "/api/hermes/sessions/one/events");
  let upstreamSignal: AbortSignal | undefined;
  const seen: string[] = [];
  const fetchStream = (async (_url, init) => {
    const headers = new Headers(init?.headers);
    seen.push(headers.get("Cookie")!);
    assert.equal(headers.get("Last-Event-ID"), "4");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    upstreamSignal = init?.signal ?? undefined;
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("data: first\n\n")); } }), {
      headers: { "content-type": "text/event-stream", "set-cookie": "not-forwarded=1" },
    });
  }) as typeof fetch;
  const request = () => new Request(url, { headers: { "Last-Event-ID": "4", Cookie: "forged=1" }, signal: controller.signal });
  const response = await forwardAppStream(url, request(), { cookies } as any, fetchStream);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
  await reader.cancel();
  credential = "second";
  const next = await forwardAppStream(url, request(), { cookies } as any, fetchStream);
  controller.abort();
  assert.equal(upstreamSignal?.aborted, true);
  await next.body?.cancel();
  assert.deepEqual(seen, ["session=first", "session=second"]);
  const failure = await forwardAppStream(url, new Request(url), { cookies } as any,
    (async () => Response.json({ error: "expired" }, { status: 401 })) as typeof fetch);
  assert.equal(failure.status, 401);
  assert.deepEqual(await failure.json(), { error: "expired" });
});

test("a 1757-page PDF loads with six live chat feeds, including EventSource and direct replies", { timeout: 45_000 }, async t => {
  const desktop = path.resolve(__dirname, "../..");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bb-app-stream-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
  try {
    const result = await runElectronFixture(require("electron") as string,
      [path.join(desktop, "tests/fixtures/app-stream-transport.cjs"), directory], desktop, env, 40_000);
    assert.equal(result.error, undefined, `${result.error?.message}\n${result.output}`);
    assert.equal(result.status, 0, result.output);
    const timing = result.output.split(/\r?\n/).find(line => line.startsWith('{"pdfReadyMs":'));
    if (timing) t.diagnostic(timing);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

// The dashboard's half of the loopback contract, against a fake sidecar.
//
// A real Python service is not needed to pin the thing that matters: every way
// the sidecar can fail to answer maps onto exactly one reason the dialog knows
// how to render, and none of them ever becomes "try somewhere else". The fake
// below answers on a free loopback port with a throwaway secret, so these tests
// run on a checkout that has never done the humanizer setup.

import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";

const service = await import("../src/lib/humanizer/service.ts");

let server;
let baseUrl;
/** What the fake answers next. Each test sets this. */
let respond = () => ({ status: 200, body: {} });
const seen = [];

before(async () => {
  server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      seen.push({
        path: request.url,
        method: request.method,
        authorization: request.headers.authorization ?? "",
        body: raw ? JSON.parse(raw) : null,
      });
      const answer = respond(seen[seen.length - 1], response);
      if (!answer) return; // the handler took over (used by the timeout test)
      const payload = Object.hasOwn(answer, "raw")
        ? answer.raw
        : JSON.stringify(answer.body);
      response.writeHead(answer.status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      response.end(payload);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
});

function env(overrides = {}) {
  return {
    HUMANIZER_SERVICE_URL: baseUrl,
    HUMANIZER_SERVICE_SECRET: "loopback-test-secret",
    ...overrides,
  };
}

function completeBody(overrides = {}) {
  return {
    requestId: "req-1",
    status: "complete",
    modelId: "cive202/humanize-ai-text-bart-large",
    modelRevision: "main",
    device: "cpu",
    dtype: "float32",
    originalText: "The system represents a groundbreaking step forward.",
    rewrittenText: "The system is a real step up.",
    chunks: { total: 3, rewritten: 2, reverted: 1 },
    preservation: {
      passed: true,
      warnings: [{ code: "literal_invented", chunkIndex: 1, kinds: ["percent"], count: 1 }],
    },
    timingMs: { load: 0, inference: 1420, total: 1495 },
    ...overrides,
  };
}

test("a successful rewrite carries the sidecar's counts and warnings through", async () => {
  respond = () => ({ status: 200, body: completeBody() });
  const result = await service.humanizerRewrite({ requestId: "req-1", text: "hello" }, env());
  assert.equal(result.ok, true);
  assert.equal(result.rewrittenText, "The system is a real step up.");
  assert.deepEqual(result.chunks, { total: 3, rewritten: 2, reverted: 1 });
  assert.equal(result.preservation.warnings[0].code, "literal_invented");
  assert.deepEqual(result.preservation.warnings[0].kinds, ["percent"]);
});

test("the bearer travels on every call and the browser never sees it", async () => {
  seen.length = 0;
  respond = () => ({ status: 200, body: completeBody() });
  await service.humanizerRewrite({ requestId: "req-2", text: "hello" }, env());
  assert.equal(seen.at(-1).authorization, "Bearer loopback-test-secret");
  assert.equal(seen.at(-1).path, "/humanize");
  // Only what the contract allows: no model id, no device, no paths.
  assert.deepEqual(Object.keys(seen.at(-1).body).sort(), ["mode", "requestId", "text"]);
});

test("a sidecar that is not running is unavailable, not an error to fall back from", async () => {
  const result = await service.humanizerRewrite(
    { requestId: "req-3", text: "hello" },
    // A port nothing is listening on.
    env({ HUMANIZER_SERVICE_URL: "http://127.0.0.1:1" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unavailable");
});

test("a missing checkpoint is its own reason", async () => {
  respond = () => ({ status: 409, body: { error: "humanizer_model_not_installed" } });
  const result = await service.humanizerRewrite({ requestId: "req-4", text: "hello" }, env());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_installed");
});

test("a busy sidecar is distinguished from a broken one", async () => {
  respond = () => ({ status: 503, body: { error: "humanizer_busy" } });
  assert.equal(
    (await service.humanizerRewrite({ requestId: "req-5", text: "hello" }, env())).reason,
    "busy",
  );
  respond = () => ({ status: 503, body: { error: "humanizer_model_unavailable", detail: "no torch" } });
  assert.equal(
    (await service.humanizerRewrite({ requestId: "req-6", text: "hello" }, env())).reason,
    "inference_failed",
  );
});

test("a preservation failure is refused rather than offered", async () => {
  respond = () => ({
    status: 200,
    body: completeBody({
      status: "preservation_failed",
      rewrittenText: "The system represents a groundbreaking step forward.",
      preservation: {
        passed: false,
        warnings: [{ code: "document_structure_changed", chunkIndex: -1, kinds: [], count: 2 }],
      },
    }),
  });
  const result = await service.humanizerRewrite({ requestId: "req-7", text: "hello" }, env());
  assert.equal(result.ok, false);
  assert.equal(result.reason, "preservation_failed");
});

test("terminal protocol outputs never become rewrite candidates", async () => {
  const cases = [
    { label: "empty body", answer: { status: 200, raw: "" } },
    { label: "literal null body", answer: { status: 200, raw: "null" } },
    { label: "fenced null body", answer: { status: 200, raw: "```json\nnull\n```" } },
    { label: "missing rewrittenText", answer: { status: 200, body: completeBody({ rewrittenText: undefined }) } },
    { label: "empty rewrittenText", answer: { status: 200, body: completeBody({ rewrittenText: "" }) } },
    { label: "literal null rewrittenText", answer: { status: 200, body: completeBody({ rewrittenText: "null" }) } },
    { label: "fenced null rewrittenText", answer: { status: 200, body: completeBody({ rewrittenText: "```markdown\nnull\n```" }) } },
  ];

  for (const { label, answer } of cases) {
    seen.length = 0;
    respond = () => answer;
    const result = await service.humanizerRewrite(
      { requestId: `terminal-${seen.length}`, text: "hello" },
      env(),
    );
    assert.equal(result.ok, false, label);
    assert.equal(result.reason, "inference_failed", label);
    assert.equal(seen.length, 1, `${label} must remain one outbound request`);
  }
});

test("a caller that goes away is cancelled, and the sidecar is told", async () => {
  respond = (_request, response) => {
    // Never answers: the abort has to be what ends this.
    response.setTimeout(0);
    return null;
  };
  const controller = new AbortController();
  const pending = service.humanizerRewrite(
    { requestId: "req-8", text: "hello", signal: controller.signal },
    env(),
  );
  setTimeout(() => controller.abort(), 50);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.reason, "cancelled");

  seen.length = 0;
  respond = () => ({ status: 200, body: { cancelled: true } });
  await service.humanizerCancel("req-8", env());
  assert.equal(seen.at(-1).path, "/cancel");
  assert.equal(seen.at(-1).body.requestId, "req-8");
});

test("a sidecar that never answers times out rather than hanging", async () => {
  respond = (_request, response) => {
    response.setTimeout(0);
    return null;
  };
  const result = await service.humanizerRewrite(
    { requestId: "req-9", text: "hello" },
    env({ BREADBOARD_HUMANIZER_TIMEOUT_MS: "5000" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
});

test("disabled mode never touches the network", async () => {
  seen.length = 0;
  const result = await service.humanizerRewrite(
    { requestId: "req-10", text: "hello" },
    env({ HUMANIZER_MODE: "disabled" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "disabled");
  assert.equal(seen.length, 0);
  assert.equal((await service.humanizerHealth(env({ HUMANIZER_MODE: "disabled" }))).status, "unreachable");
  assert.equal(seen.length, 0);
});

test("health reports the model state without loading anything", async () => {
  respond = () => ({
    status: 200,
    body: {
      status: "ok",
      modelState: "not_installed",
      serviceVersion: "1.0.0",
      pythonVersion: "3.13.1",
      torchVersion: "2.6.0",
      transformersVersion: "4.44.2",
      cudaVersion: "12.4",
      modelId: "cive202/humanize-ai-text-bart-large",
      modelRevision: "main",
      device: "cpu",
      dtype: "unknown",
      modelLoaded: false,
      modelInstalled: false,
      busy: false,
      detail: "",
    },
  });
  const health = await service.humanizerHealth(env());
  assert.equal(health.status, "ok");
  assert.equal(health.modelState, "not_installed");
  assert.equal(health.modelInstalled, false);
  assert.equal(health.modelRevision, "main");
});

test("an unreachable sidecar reports a state rather than throwing", async () => {
  const health = await service.humanizerHealth(env({ HUMANIZER_SERVICE_URL: "http://127.0.0.1:1" }));
  assert.equal(health.status, "unreachable");
  assert.equal(health.modelState, "unknown");
});

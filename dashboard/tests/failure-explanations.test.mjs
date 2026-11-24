import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  explainFailure,
  FAILURE_EXPLANATIONS,
  failureKindForStatus,
  friendlyFetchScript,
} from "../src/lib/failure-explanations.ts";
import { describeError } from "../src/lib/hermes/route-core.ts";

test("raw transport failures become plain explanations; prose passes through", () => {
  assert.equal(explainFailure(new TypeError("Failed to fetch")), FAILURE_EXPLANATIONS.server_unreachable);
  assert.equal(explainFailure("fetch failed"), FAILURE_EXPLANATIONS.server_unreachable);
  assert.equal(explainFailure("terminated"), FAILURE_EXPLANATIONS.stream_cut);
  assert.equal(explainFailure("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"), FAILURE_EXPLANATIONS.html_instead_of_json);
  assert.equal(explainFailure("SQLITE_BUSY: database is locked"), FAILURE_EXPLANATIONS.database_busy);
  assert.equal(explainFailure("ENOSPC: no space left on device, write"), FAILURE_EXPLANATIONS.disk_full);
  assert.equal(explainFailure("Breadboard tool service is unavailable: [WinError 10061]"), FAILURE_EXPLANATIONS.runtime_unreachable);
  assert.equal(explainFailure("That file is not a PDF."), "That file is not a PDF.");
  assert.equal(failureKindForStatus(503), "service_unavailable");
  assert.equal(failureKindForStatus(400), null);
});

test("server errors name the category without leaking the raw text", () => {
  const busy = describeError(new Error("SQLITE_BUSY at C:\\Users\\me\\secret\\brain.db"));
  assert.equal(busy.status, 503);
  assert.equal(busy.body.error, FAILURE_EXPLANATIONS.database_busy);
  assert.ok(!JSON.stringify(busy.body).includes("secret"));
  assert.equal(describeError(new Error("boom")).body.error, FAILURE_EXPLANATIONS.server_error);
});

function browser(fetchImpl, { online = true } = {}) {
  class FakeResponse { json() { return Promise.reject(new SyntaxError("Unexpected token '<'")); } }
  const window = { fetch: fetchImpl };
  const context = {
    window, location: { href: "http://127.0.0.1:3000/garden/x" }, navigator: { onLine: online },
    URL, TypeError, SyntaxError, DOMException, Response: FakeResponse,
  };
  vm.runInNewContext(friendlyFetchScript, context);
  return { fetch: window.fetch, Response: FakeResponse, context };
}

test("the browser script rewrites network failures but keeps their type", async () => {
  const { fetch } = browser(() => Promise.reject(new TypeError("Failed to fetch")));
  const local = await fetch("/api/chat").catch((error) => error);
  assert.equal(local.constructor.name, "TypeError");
  assert.equal(local.message, FAILURE_EXPLANATIONS.server_unreachable);
  assert.equal(local.cause.message, "Failed to fetch");
  const offline = await browser(() => Promise.reject(new TypeError("Failed to fetch")), { online: false })
    .fetch("https://example.com/x").catch((error) => error);
  assert.equal(offline.message, FAILURE_EXPLANATIONS.offline);
});

test("aborts are untouched and HTML-for-JSON is explained", async () => {
  const abort = new DOMException("The user aborted a request.", "AbortError");
  const { fetch, Response } = browser(() => Promise.reject(abort));
  assert.equal(await fetch("/api/x").catch((error) => error), abort);
  const parsed = await new Response().json().catch((error) => error);
  assert.equal(parsed.message, FAILURE_EXPLANATIONS.html_instead_of_json);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  describeError,
  readJsonBody,
  requireString,
  MAX_REQUEST_BYTES,
} from "../src/lib/hermes/route-core.ts";
import { HermesRpcErrorResponse } from "../src/lib/agent-runtime/hermes-wire.ts";

function jsonRequest(body, headers = {}) {
  return new Request("http://localhost/api/hermes/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("readJsonBody parses a JSON object", async () => {
  const parsed = await readJsonBody(jsonRequest({ text: "hi" }));
  assert.equal(parsed.text, "hi");
});

test("readJsonBody rejects a non-object body", async () => {
  await assert.rejects(readJsonBody(jsonRequest([1, 2, 3])), (err) => err instanceof ApiError && err.status === 400);
});

test("readJsonBody rejects invalid JSON", async () => {
  await assert.rejects(readJsonBody(jsonRequest("{not json")), (err) => err instanceof ApiError);
});

test("readJsonBody rejects oversized body by content-length", async () => {
  const req = jsonRequest({ x: 1 }, { "content-length": String(MAX_REQUEST_BYTES + 1) });
  await assert.rejects(readJsonBody(req), (err) => err instanceof ApiError && err.status === 413);
});

test("readJsonBody rejects oversized actual body", async () => {
  const big = JSON.stringify({ text: "a".repeat(MAX_REQUEST_BYTES + 10) });
  await assert.rejects(readJsonBody(jsonRequest(big)), (err) => err instanceof ApiError && err.status === 413);
});

test("readJsonBody supports a route-specific authenticated upload limit", async () => {
  const body = { text: "a".repeat(MAX_REQUEST_BYTES + 10) };
  const parsed = await readJsonBody(jsonRequest(body), MAX_REQUEST_BYTES * 2);
  assert.equal(parsed.text.length, body.text.length);
});

test("requireString validates presence and length", () => {
  assert.equal(requireString("ok", "field"), "ok");
  assert.throws(() => requireString("", "field"), (err) => err instanceof ApiError);
  assert.throws(() => requireString(123, "field"), (err) => err instanceof ApiError);
  assert.throws(() => requireString("x".repeat(11), "field", 10), (err) => err instanceof ApiError);
});

test("describeError maps ApiError to its status", () => {
  const res = describeError(new ApiError(404, "not_found", "Nope"));
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "not_found");
});

test("describeError maps a Hermes RPC error to 503 without leaking internals", () => {
  const res = describeError(
    new HermesRpcErrorResponse(-32000, "connect ECONNREFUSED 127.0.0.1:4096"),
  );
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "The agent runtime is unavailable.");
  assert.equal(res.body.code, -32000);
  assert.equal(res.body.recoverable, true);
  assert.ok(!JSON.stringify(res.body).includes("4096"));
});

test("describeError hides internal detail message for unexpected errors", () => {
  const res = describeError(new Error("boom at /secret/path"));
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "Internal server error");
  assert.equal("detail" in res.body, false);
  assert.ok(!JSON.stringify(res.body).includes("/secret/path"));
});

test("describeError preserves the status of a RouteError-shaped error (401 not 500)", () => {
  // Mirrors server-auth.ts RouteError: an Error carrying a numeric HTTP status.
  class RouteError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  const unauthorized = describeError(new RouteError(401, "Unauthorized"));
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error, "Unauthorized");

  const notFound = describeError(new RouteError(404, "Cluster not found"));
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error, "Cluster not found");
});

test("describeError ignores an out-of-range or non-numeric status", () => {
  const weird = new Error("boom");
  weird.status = 200; // not an error status → fall through to 500
  assert.equal(describeError(weird).status, 500);
  const stringStatus = new Error("boom");
  stringStatus.status = "teapot";
  assert.equal(describeError(stringStatus).status, 500);
});

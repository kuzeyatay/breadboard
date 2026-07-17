import test from "node:test";
import assert from "node:assert/strict";
import {
  corsHeaders,
  enforceRateLimit,
  newClientToken,
} from "../src/lib/openharness/quartz-support.ts";
import { ApiError } from "../src/lib/openharness/route-core.ts";

test("corsHeaders echoes an allowed origin and always sets credentials", () => {
  const headers = corsHeaders("http://localhost:8081");
  assert.equal(headers["Access-Control-Allow-Origin"], "http://localhost:8081");
  assert.equal(headers["Access-Control-Allow-Credentials"], "true");
  assert.match(headers["Access-Control-Allow-Methods"], /POST/);
});

test("corsHeaders falls back to an allowlisted origin for an unknown origin", () => {
  const headers = corsHeaders("http://evil.example.com");
  assert.notEqual(headers["Access-Control-Allow-Origin"], "http://evil.example.com");
});

test("enforceRateLimit allows up to the window limit then throws 429", () => {
  const key = `test-key-${Math.random()}`;
  const now = 1_000_000;
  // 20 allowed per fixed window.
  for (let i = 0; i < 20; i += 1) {
    enforceRateLimit(key, now);
  }
  assert.throws(() => enforceRateLimit(key, now), (err) => err instanceof ApiError && err.status === 429);
});

test("enforceRateLimit resets after the window", () => {
  const key = `test-reset-${Math.random()}`;
  const start = 2_000_000;
  for (let i = 0; i < 20; i += 1) enforceRateLimit(key, start);
  assert.throws(() => enforceRateLimit(key, start));
  // Advance beyond the 60s window.
  enforceRateLimit(key, start + 61_000);
});

test("newClientToken returns a long unguessable token", () => {
  const a = newClientToken();
  const b = newClientToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 24);
});

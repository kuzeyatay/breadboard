import test from "node:test";
import assert from "node:assert/strict";
import { redact, safeErrorMessage, makeRedactor } from "../src/redaction.ts";

test("redacts held secrets by value", () => {
  const out = redact("secret=abcdef123456 tail", ["abcdef123456"]);
  assert.ok(!out.includes("abcdef123456"));
  assert.ok(out.includes("[REDACTED]"));
});

test("redacts OpenAI-shaped keys we do not hold", () => {
  const out = redact("using key sk-abcdef0123456789ABCDEF here");
  assert.ok(!out.includes("sk-abcdef0123456789ABCDEF"));
});

test("redacts anthropic and bearer tokens", () => {
  assert.ok(!redact("sk-ant-0123456789abcdefghij").includes("sk-ant-0123456789"));
  assert.ok(!redact("authorization: Bearer abcdef0123456789xyz").includes("abcdef0123456789xyz"));
});

test("redacts key=value assignment forms", () => {
  const out = redact('api_key: "verysecretlongtoken123"');
  assert.ok(!out.includes("verysecretlongtoken123"));
});

test("safeErrorMessage strips paths and secrets, never a stack", () => {
  const err = new Error("failed at C:\\Users\\me\\secret\\file.ts with sk-abcdef0123456789ABCDEF");
  const msg = safeErrorMessage(err, []);
  assert.ok(!msg.includes("C:\\Users"));
  assert.ok(!msg.includes("sk-abcdef0123456789ABCDEF"));
});

test("makeRedactor ignores too-short secrets", () => {
  const r = makeRedactor(["ab"]);
  assert.equal(r("value ab here"), "value ab here");
});

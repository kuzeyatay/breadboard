import test from "node:test";
import assert from "node:assert/strict";
import {
  issueCapabilityToken,
  verifyCapabilityToken,
  tokenAllows,
} from "../src/lib/hermes/capability-token.ts";

const scope = {
  userId: 7,
  surface: "garden_chat",
  breadboardSessionId: "12",
  hermesSessionId: "oh_abc",
  gardenId: "physics",
  allowedTools: ["garden_search", "garden_get_page"],
};

test("issues and verifies a well-formed token", () => {
  const token = issueCapabilityToken(scope);
  const result = verifyCapabilityToken(token);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.token.userId, 7);
    assert.equal(result.token.gardenId, "physics");
    assert.deepEqual(result.token.allowedTools, ["garden_search", "garden_get_page"]);
  }
});

test("rejects a tampered payload", () => {
  const token = issueCapabilityToken(scope);
  const [, sig] = token.split(".");
  const tamperedBody = Buffer.from(
    JSON.stringify({ ...scope, gardenId: "secret-garden", exp: Date.now() + 1000, iat: Date.now() }),
  ).toString("base64url");
  const result = verifyCapabilityToken(`${tamperedBody}.${sig}`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "bad_signature");
});

test("rejects an expired token", () => {
  const token = issueCapabilityToken(scope, { ttlMs: -1 });
  const result = verifyCapabilityToken(token);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "expired");
});

test("rejects malformed input", () => {
  assert.equal(verifyCapabilityToken("not-a-token").ok, false);
  assert.equal(verifyCapabilityToken("").ok, false);
  assert.equal(verifyCapabilityToken(null).ok, false);
});

test("tokenAllows enforces tool + garden scope", () => {
  const token = issueCapabilityToken(scope);
  const verified = verifyCapabilityToken(token);
  assert.ok(verified.ok);
  if (verified.ok) {
    assert.equal(tokenAllows(verified.token, { tool: "garden_search", gardenId: "physics" }), true);
    // Wrong garden id supplied by the model is rejected.
    assert.equal(tokenAllows(verified.token, { tool: "garden_search", gardenId: "chemistry" }), false);
    // Tool not in the allowlist is rejected.
    assert.equal(tokenAllows(verified.token, { tool: "bash", gardenId: "physics" }), false);
  }
});

test("server-minted capability permits only server-derived garden ids", () => {
  const token = issueCapabilityToken({
    ...scope,
    conversationId: 42,
    allowedGardenIds: [9, 3, 9],
    activeGardenId: 3,
  });
  const verified = verifyCapabilityToken(token);
  assert.ok(verified.ok);
  if (verified.ok) {
    assert.deepEqual(verified.token.allowedGardenIds, [3, 9]);
    assert.equal(tokenAllows(verified.token, { tool: "garden_search", gardenId: 9 }), true);
    assert.equal(tokenAllows(verified.token, { tool: "garden_search", gardenId: 10 }), false);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { framePolicy } from "../src/frame-policy.js";

const artifactOrigin = "http://127.0.0.1:4321";

test("localhost URL reviews retain the app origin", () => {
  const policy = framePolicy({ kind: "url" }, artifactOrigin);
  assert.match(policy.sandbox, /\ballow-same-origin\b/);
  assert.equal(policy.incomingOrigin, artifactOrigin);
  assert.equal(policy.targetOrigin, artifactOrigin);
});

test("file and Markdown reviews use an opaque origin", () => {
  for (const page of [{ kind: "file", markdown: false }, { kind: "file", markdown: true }]) {
    const policy = framePolicy(page, artifactOrigin);
    assert.doesNotMatch(policy.sandbox, /\ballow-same-origin\b/);
    assert.equal(policy.incomingOrigin, "null");
    assert.equal(policy.targetOrigin, "*");
  }
});

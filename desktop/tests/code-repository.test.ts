import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCodeRepository } from "../src/main/code-repository";

test("ordinary Code tabs need no repository lookup", async () => {
  assert.equal(await resolveCodeRepository("https://breadboard.test/code", async () => { throw Error("unexpected fetch"); }), undefined);
});

test("Garden lookups keep credentials on the current origin and encode the slug", async () => {
  let called = false;
  await assert.rejects(resolveCodeRepository("https://breadboard.test/code?garden=a%26b", async (url, options) => {
    called = true;
    assert.equal(String(url), "https://breadboard.test/api/code/repository?garden=a%26b");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.credentials, "include");
    return Response.json({}, { status: 401 });
  }), /Sign in to Breadboard/);
  assert.equal(called, true);
});

test("empty Garden links fail instead of selecting an arbitrary connected repository", async () => {
  await assert.rejects(resolveCodeRepository("https://breadboard.test/code?garden=", async () => { throw Error("unexpected fetch"); }), /Choose a Garden/);
});

test("repository responses cannot silently switch Gardens or use a relative folder", async () => {
  for (const repository of [{ gardenSlug: "different", path: "C:/repo" }, { gardenSlug: "wanted", path: "../repo" }]) {
    await assert.rejects(resolveCodeRepository("https://breadboard.test/code?garden=wanted", async () => Response.json({ repository })), /invalid repository connection/);
  }
});

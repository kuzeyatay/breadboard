import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateRuntimeV2BackgroundRequest } from "../../dashboard/scripts/runtime-v2-background-executor.mjs";
import { sourceRepairRelease } from "../../dashboard/scripts/source-repair-release.mjs";
const scope = { userId: 1, gardenId: null, conversationId: null };
const request = { protocolVersion: 1, operation: "source-repair", repairId: "sr-0123456789abcdef01234567" };

test("repair job is authenticated and accepts only a durable checkpoint id", () => {
  assert.equal(validateRuntimeV2BackgroundRequest(request, scope).userId, 1);
  for (const input of [{ ...request, command: "unsafe" }, { ...request, repairId: "../../other" }, { ...request, protocolVersion: 2 }]) {
    assert.throws(() => validateRuntimeV2BackgroundRequest(input, scope));
  }
  for (const denied of [{ ...scope, userId: null }, { ...scope, gardenId: "other" }, { ...scope, conversationId: "other" }]) {
    assert.throws(() => validateRuntimeV2BackgroundRequest(request, denied));
  }
});

test("registered repair has one worker and an explicit build-sized budget", () => {
  const workers = JSON.parse(fs.readFileSync("desktop/runtime-v2/manifests/workers.json", "utf8")).workers;
  const repair = workers.find(worker => worker.jobTypes.includes("source-repair"));
  assert.equal(repair.submissionAuthority, "user"); assert.equal(repair.maximumConcurrency, 1);
  assert.ok(repair.estimatedColdStartCommitMb >= 11264); assert.ok(repair.maximumRuntimeMs <= 7200000);
  assert.equal(repair.allowedEntrypoint, "dashboard/scripts/runtime-v2-source-repair-worker.mjs");
});

test("release selector leaves an unconfigured source installation on its base build", async () => {
  const root = fs.mkdtempSync(path.resolve(".tmp/source-repair-tests/selector-"));
  const env = { BREADBOARD_DATA_DIR: root };
  assert.equal(await sourceRepairRelease(env), null); assert.equal(env.BREADBOARD_SOURCE_REPAIR_READY, "1");
});

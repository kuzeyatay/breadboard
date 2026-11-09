import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { standaloneBuildManifest, waitForCompleteStandaloneBuild } from "../scripts/standalone-build-ready.mjs";

function layout(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-standalone-ready-"));
  const server = path.join(root, name, "standalone", "server.js");
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(server, "");
  return { root, server, manifest: path.join(root, name, "breadboard-build-manifest.json") };
}

test("a server.js whose build manifest has not been written yet is not served", async () => {
  const { server } = layout(".next-desktop");
  await assert.rejects(
    waitForCompleteStandaloneBuild(server, { timeoutMs: 200, pollMs: 20 }),
    /still incomplete/,
  );
});

test("the server starts once the manifest lands", async () => {
  const { server, manifest } = layout(".next-desktop");
  const logs = [];
  setTimeout(() => fs.writeFileSync(manifest, "{}"), 60);
  await waitForCompleteStandaloneBuild(server, { timeoutMs: 2_000, pollMs: 10, log: (line) => logs.push(line) });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /waiting for the standalone dashboard build/);
});

test("a complete build is served without waiting", async () => {
  const { server, manifest } = layout(".next-desktop");
  fs.writeFileSync(manifest, "{}");
  const logs = [];
  await waitForCompleteStandaloneBuild(server, { timeoutMs: 50, log: (line) => logs.push(line) });
  assert.deepEqual(logs, []);
});

test("the packaged dashboard-standalone tree carries no manifest and is never gated", async () => {
  const { server } = layout("dashboard");
  assert.equal(standaloneBuildManifest(server), null);
  await waitForCompleteStandaloneBuild(server, { timeoutMs: 50 });
});

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const { globTouchesMutableData, guardTraceOptions, isMutableDataPath } = require("../scripts/next-trace-guard.cjs");

test("Next trace globs cannot enter mutable dashboard data", () => {
  assert.equal(globTouchesMutableData("dashboard/**/*"), true);
  assert.equal(globTouchesMutableData("dashboard/db/**/*"), true);
  assert.equal(globTouchesMutableData("dashboard/src/**/*.ts"), false);
  assert.equal(globTouchesMutableData("dashboard/src/lib/runtime-paths.ts"), false);
});

test("build-time directory scans cannot enter mutable runtime roots", () => {
  assert.equal(isMutableDataPath(new URL("../../dashboard/db/profile", import.meta.url)), true);
  assert.equal(isMutableDataPath(new URL("../../dashboard/database/brain.db", import.meta.url)), true);
  assert.equal(isMutableDataPath(new URL("../../dashboard/src/lib", import.meta.url)), false);
  assert.deepEqual(fsReaddirSync(new URL("../../dashboard/db", import.meta.url)), []);
});

test("the trace guard preserves Next's existing ignore function", () => {
  const options = guardTraceOptions({ ignore: (candidate) => candidate === "already-ignored" });
  assert.equal(options.ignore("dashboard/**/*"), true);
  assert.equal(options.ignore("already-ignored"), true);
  assert.equal(options.ignore("dashboard/src/**/*.ts"), false);
});

function fsReaddirSync(directory) {
  return require("node:fs").readdirSync(directory);
}

test("the standalone dashboard build isolates its larger heap from the lean runtime", () => {
  const buildScript = fs.readFileSync(new URL("../scripts/build-dashboard.mjs", import.meta.url), "utf8");
  const leanScript = fs.readFileSync(new URL("../scripts/dev-fast.mjs", import.meta.url), "utf8");
  assert.match(buildScript, /const dashboardBuildHeapMb = 8_192/);
  assert.match(buildScript, /`--max-old-space-size=\$\{dashboardBuildHeapMb\}`/);
  assert.match(buildScript, /"--require",[\s\S]*traceGuard,[\s\S]*nextBin,[\s\S]*"build",[\s\S]*"--webpack"/);
  assert.match(leanScript, /:\s*11_264;/);
});

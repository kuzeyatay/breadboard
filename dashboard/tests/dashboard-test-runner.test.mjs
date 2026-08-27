import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  SERIAL_BROWSER_TEST_FILES,
  dashboardTestLanes,
  discoverDashboardTestFiles,
  nodeTestArguments,
  partitionDashboardTestFiles,
  runDashboardTestPlan,
} from "../scripts/run-dashboard-tests.mjs";

test("dashboard test discovery partitions the exact real-browser lane", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.scripts.test, "node scripts/run-dashboard-tests.mjs");
  const discovered = discoverDashboardTestFiles();
  const partition = partitionDashboardTestFiles(discovered);
  assert.ok(discovered.includes("dashboard-test-runner.test.mjs"));
  assert.deepEqual(partition.browser, [...SERIAL_BROWSER_TEST_FILES]);
  assert.deepEqual(partition.browser, [
    "generated-visual-presentation-convergence.test.mjs",
    "interactive-visualizer.test.mjs",
    "generated-visual-spatial-scene.test.mjs",
    "generated-visualization-pipeline.test.mjs",
  ]);
  assert.deepEqual(
    [...partition.parallel, ...partition.browser].sort(),
    discovered,
  );
  assert.equal(
    partition.parallel.some((file) => partition.browser.includes(file)),
    false,
  );
  assert.throws(
    () => partitionDashboardTestFiles(
      discovered.filter((file) => file !== SERIAL_BROWSER_TEST_FILES[0]),
    ),
    /missing required file.*generated-visual-presentation-convergence/u,
  );
});

test("ordinary tests retain one default-parallel lane and browser files run singly", () => {
  const discovered = [
    "zeta.test.mjs",
    ...SERIAL_BROWSER_TEST_FILES,
    "alpha.test.mjs",
  ];
  const lanes = dashboardTestLanes(discovered);
  assert.deepEqual(lanes[0], {
    id: "parallel",
    mode: "parallel",
    files: ["alpha.test.mjs", "zeta.test.mjs"],
  });
  assert.deepEqual(
    lanes.slice(1).map((lane) => lane.files),
    SERIAL_BROWSER_TEST_FILES.map((file) => [file]),
  );
  assert.ok(lanes.slice(1).every((lane) => lane.mode === "serial-browser"));
  const parallelArguments = nodeTestArguments(lanes[0]);
  assert.deepEqual(parallelArguments.slice(0, 2), [
    "--test",
    "--experimental-strip-types",
  ]);
  assert.equal(
    parallelArguments.some((argument) => argument.startsWith("--test-concurrency")),
    false,
  );
  assert.deepEqual(parallelArguments.slice(2), [
    path.join("tests", "alpha.test.mjs"),
    path.join("tests", "zeta.test.mjs"),
  ]);
});

test("the browser lane is awaited serially and the first failure propagates", async () => {
  const discovered = ["ordinary.test.mjs", ...SERIAL_BROWSER_TEST_FILES];
  const started = [];
  let activeBrowserLanes = 0;
  let maximumActiveBrowserLanes = 0;
  const failureLane = `browser:${SERIAL_BROWSER_TEST_FILES[1]}`;
  const status = await runDashboardTestPlan(discovered, async (lane) => {
    started.push(lane.id);
    if (lane.mode === "serial-browser") {
      activeBrowserLanes += 1;
      maximumActiveBrowserLanes = Math.max(
        maximumActiveBrowserLanes,
        activeBrowserLanes,
      );
      await Promise.resolve();
      activeBrowserLanes -= 1;
    }
    return lane.id === failureLane ? 17 : 0;
  });
  assert.equal(status, 17);
  assert.equal(maximumActiveBrowserLanes, 1);
  assert.deepEqual(started, [
    "parallel",
    `browser:${SERIAL_BROWSER_TEST_FILES[0]}`,
    failureLane,
  ]);
});

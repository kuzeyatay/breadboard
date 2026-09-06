import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

test("desktop tests isolate physical-screen and native-focus fixtures", () => {
  const desktopRoot = path.resolve(__dirname, "..", "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.test, "npm run build && node scripts/run-desktop-tests.mjs");

  const runnerUrl = pathToFileURL(path.join(desktopRoot, "scripts", "run-desktop-tests.mjs")).href;
    const probe = `
    import {
      SERIAL_SCREEN_TEST_FILES,
      desktopTestLanes,
      nodeTestArguments,
      partitionDesktopTestFiles,
    } from ${JSON.stringify(runnerUrl)};
    const discovered = ["zeta.test.js", ...SERIAL_SCREEN_TEST_FILES, "alpha.test.js"];
    process.stdout.write(JSON.stringify({
      serial: SERIAL_SCREEN_TEST_FILES,
      partition: partitionDesktopTestFiles(discovered),
      lanes: desktopTestLanes(discovered),
      args: nodeTestArguments(desktopTestLanes(discovered)[0]),
    }));
  `;
  const run = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], {
    cwd: desktopRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.deepEqual(result.serial, ["tab-manager.test.js", "browser-downloads-popover-integration.test.js", "browser-fullscreen-integration.test.js", "browser-picture-in-picture-integration.test.js"]);
  assert.deepEqual(result.partition, {
    parallel: ["alpha.test.js", "zeta.test.js"],
    screen: ["tab-manager.test.js", "browser-downloads-popover-integration.test.js", "browser-fullscreen-integration.test.js", "browser-picture-in-picture-integration.test.js"],
  });
  assert.deepEqual(result.lanes.map((lane: { files: string[] }) => lane.files), [
    ["alpha.test.js", "zeta.test.js"],
    ["tab-manager.test.js"],
    ["browser-downloads-popover-integration.test.js"],
    ["browser-fullscreen-integration.test.js"],
    ["browser-picture-in-picture-integration.test.js"],
  ]);
  assert.deepEqual(result.args, [
    "--test",
    path.join("dist-tests", "tests", "alpha.test.js"),
    path.join("dist-tests", "tests", "zeta.test.js"),
  ]);
});

test("desktop test discovery ignores stale JavaScript whose source was removed", () => {
  const desktopRoot = path.resolve(__dirname, "..", "..");
  const runnerUrl = pathToFileURL(path.join(desktopRoot, "scripts", "run-desktop-tests.mjs")).href;
  const fixtureEntries = [
    { name: "current.test.js", isFile: () => true },
    { name: "removed.test.js", isFile: () => true },
    { name: "notes.txt", isFile: () => true },
  ];
  const probe = `
    import { discoverDesktopTestFiles } from ${JSON.stringify(runnerUrl)};
    const entries = ${JSON.stringify(fixtureEntries.map((entry) => entry.name))}
      .map((name) => ({ name, isFile: () => true }));
    process.stdout.write(JSON.stringify(discoverDesktopTestFiles(
      "compiled",
      () => entries,
      "source",
      (file) => file.endsWith("current.test.ts"),
    )));
  `;
  const run = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], {
    cwd: desktopRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), ["current.test.js"]);
});

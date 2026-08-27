import assert from "node:assert/strict";
import test from "node:test";

import {
  desktopDevEnvironment,
  leanDashboardArgument,
  parseDesktopDevArguments,
} from "../scripts/dev.mjs";

test("ordinary desktop development overwrites an inherited standalone mode with hot", () => {
  const launch = parseDesktopDevArguments(["--inspect-renderer"]);
  const environment = desktopDevEnvironment(
    {
      BREADBOARD_DESKTOP_DASHBOARD_MODE: "standalone",
      ELECTRON_RUN_AS_NODE: "1",
      PRESERVED: "yes",
    },
    launch.dashboardMode,
  );

  assert.equal(launch.dashboardMode, "hot");
  assert.deepEqual(launch.electronArgs, ["--inspect-renderer"]);
  assert.equal(environment.BREADBOARD_DESKTOP_DASHBOARD_MODE, "hot");
  assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(environment.PRESERVED, "yes");
});

test("the private dev-fast marker is the only launcher argument that selects lean mode", () => {
  const launch = parseDesktopDevArguments([
    "--inspect-renderer",
    leanDashboardArgument,
    "--enable-logging",
  ]);
  const environment = desktopDevEnvironment(
    { BREADBOARD_DESKTOP_DASHBOARD_MODE: "hot" },
    launch.dashboardMode,
  );

  assert.equal(launch.dashboardMode, "standalone");
  assert.deepEqual(launch.electronArgs, ["--inspect-renderer", "--enable-logging"]);
  assert.equal(environment.BREADBOARD_DESKTOP_DASHBOARD_MODE, "standalone");
});

test("desktop development rejects an ambiguous repeated lean marker", () => {
  assert.throws(
    () => parseDesktopDevArguments([leanDashboardArgument, leanDashboardArgument]),
    /more than once/u,
  );
});

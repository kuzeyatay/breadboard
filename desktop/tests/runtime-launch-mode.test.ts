import assert from "node:assert/strict";
import test from "node:test";
import { runtimeLaunchMode } from "../src/main/runtime-launch-mode";

test("packaged Electron always selects the packaged Runtime V2 profile", () => {
  assert.equal(
    runtimeLaunchMode("packaged", { BREADBOARD_DESKTOP_DASHBOARD_MODE: "standalone" }),
    "packaged",
  );
});

test("the explicit standalone development path selects lean Runtime V2", () => {
  assert.equal(
    runtimeLaunchMode("dev", { BREADBOARD_DESKTOP_DASHBOARD_MODE: "  STANDALONE " }),
    "lean",
  );
});

test("ordinary development selects the hot compiler path", () => {
  assert.equal(runtimeLaunchMode("dev", {}), "hot");
  assert.equal(
    runtimeLaunchMode("dev", { BREADBOARD_DESKTOP_DASHBOARD_MODE: "hot" }),
    "hot",
  );
});

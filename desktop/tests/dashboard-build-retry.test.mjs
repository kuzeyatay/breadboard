import assert from "node:assert/strict";
import test from "node:test";

import { isTransientDashboardBuildFailure } from "../scripts/dashboard-build-retry.mjs";

test("retries a missing Next temporary file inside the managed dashboard output", () => {
  assert.equal(isTransientDashboardBuildFailure(
    "Error: ENOENT: no such file or directory, rename 'dashboard\\.next-desktop\\static\\build\\_buildManifest.js.tmp.123'",
  ), true);
});

test("retries a Windows lock while rotating the managed dashboard output", () => {
  assert.equal(isTransientDashboardBuildFailure(
    "Error: EPERM: operation not permitted, rename 'dashboard\\.next-desktop' -> 'dashboard\\.next-desktop-last-good'",
  ), true);
});

test("retries a Turbopack generated-file write reported as Windows os error 3", () => {
  assert.equal(isTransientDashboardBuildFailure(
    'TurbopackInternalError: failed to write to "C:\\repo\\dashboard\\.next-desktop\\server\\app\\api\\agent-settings\\route.js.nft.json"\nCaused by:\n- The system cannot find the path specified. (os error 3)',
  ), true);
});

test("does not retry source, type, or unrelated filesystem failures", () => {
  assert.equal(isTransientDashboardBuildFailure("Type error: Property 'x' does not exist"), false);
  assert.equal(isTransientDashboardBuildFailure("ENOENT: missing dashboard/src/app/page.tsx"), false);
  assert.equal(isTransientDashboardBuildFailure("EPERM: rename C:\\unrelated.tmp"), false);
});

test("retries the missing generated pages manifest from the Windows build log", () => {
  assert.equal(isTransientDashboardBuildFailure(
    "Error: ENOENT: no such file or directory, open 'C:\\Users\\20252082\\breadboard\\dashboard\\.next-desktop\\server\\pages-manifest.json'",
  ), true);
  assert.equal(isTransientDashboardBuildFailure(
    "Error: ENOENT: no such file or directory, open '/repo/dashboard/.next-desktop/server/pages-manifest.json'",
  ), true);
});

test("does not mistake other missing inputs for a generated manifest failure", () => {
  for (const missing of [
    "dashboard/src/pages-manifest.json",
    "dashboard/.next-desktop-other/server/pages-manifest.json",
    "dashboard/.next-desktop/server/application-data.json",
    "dashboard/.next-desktop-last-good/server/pages-manifest.json",
  ]) {
    assert.equal(isTransientDashboardBuildFailure(
      `Compiled into dashboard/.next-desktop\nError: ENOENT: no such file or directory, open '${missing}'`,
    ), false);
  }
});

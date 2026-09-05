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

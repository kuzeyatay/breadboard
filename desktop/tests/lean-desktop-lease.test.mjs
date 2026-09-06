import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

import {
  claimLeanDesktopLease,
  claimDashboardBuildLease,
  dashboardBuildLeasePath,
  duplicateLeanDesktopWarning,
  leanDesktopLeasePath,
  readLeanDesktopLease,
  releaseLeanDesktopLease,
  releaseDashboardBuildLease,
} from "../scripts/lean-desktop-lease.mjs";

const desktopRoot = path.resolve(import.meta.dirname, "..");

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bb-lean-lease-"));
}

test("a live lean desktop lifecycle excludes a second command", () => {
  const repoRoot = tempRepo();
  try {
    const first = claimLeanDesktopLease({
      repoRoot,
      pid: 111,
      claimId: "first",
      isAlive: () => true,
    });
    const second = claimLeanDesktopLease({
      repoRoot,
      pid: 222,
      claimId: "second",
      isAlive: (pid) => pid === 111,
    });

    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
    assert.equal(second.existing?.pid, 111);
    assert.equal(readLeanDesktopLease(leanDesktopLeasePath(repoRoot))?.claimId, "first");
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("a stale lease is replaced and only its owning generation can release it", () => {
  const repoRoot = tempRepo();
  try {
    claimLeanDesktopLease({
      repoRoot,
      pid: 111,
      claimId: "stale",
      isAlive: () => true,
    });
    const replacement = claimLeanDesktopLease({
      repoRoot,
      pid: 222,
      claimId: "replacement",
      isAlive: () => false,
    });

    assert.equal(replacement.acquired, true);
    assert.equal(replacement.staleReplaced, true);
    releaseLeanDesktopLease(repoRoot, { pid: 222, claimId: "stale" });
    assert.equal(
      readLeanDesktopLease(leanDesktopLeasePath(repoRoot))?.claimId,
      "replacement",
    );
    releaseLeanDesktopLease(repoRoot, replacement.record);
    assert.equal(readLeanDesktopLease(leanDesktopLeasePath(repoRoot)), null);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("the duplicate warning is actionable and does not disclose checkout paths", () => {
  const warning = duplicateLeanDesktopWarning({
    pid: 4242,
    startedAt: "2026-09-02T09:00:00.000Z",
    checkout: "C:/Users/someone/private-checkout",
    claimId: "claim",
  });

  assert.match(warning, /pid=4242/);
  assert.match(warning, /close.*Breadboard.*stop.*command/i);
  assert.doesNotMatch(warning, /private-checkout/);
});

test("dev-fast claims the lease before any dashboard recovery mutation", () => {
  const source = fs.readFileSync(path.join(desktopRoot, "scripts", "dev-fast.mjs"), "utf8");
  const claim = source.indexOf("claimLeanDesktopLease({ repoRoot })");
  const exitRelease = source.indexOf('process.once("exit"');
  const recovery = source.indexOf("recoverInterruptedDashboardBuild(repoRoot);");
  const desktopLaunch = source.indexOf('const child = spawn(process.execPath');

  assert.ok([claim, exitRelease, recovery, desktopLaunch].every((index) => index >= 0));
  assert.ok(claim < exitRelease);
  assert.ok(exitRelease < recovery);
  assert.ok(recovery < desktopLaunch);
  const outputClaim = source.indexOf("claimDashboardBuildLease({ repoRoot })");
  const outputRelease = source.lastIndexOf("releaseDashboardBuildLease(repoRoot, dashboardLease.record)");
  assert.ok(exitRelease < outputClaim && outputClaim < recovery);
  assert.ok(recovery < outputRelease && outputRelease < desktopLaunch);
  assert.match(source, /BREADBOARD_DASHBOARD_BUILD_CLAIM_ID: dashboardLease.record.claimId/u);
});

test("a direct build excludes output recovery and another direct build", () => {
  const repoRoot = tempRepo();
  try {
    const first = claimDashboardBuildLease({ repoRoot, pid: 111, isAlive: () => true });
    assert.equal(first.acquired, true);
    assert.equal(first.inherited, false);
    assert.equal(claimDashboardBuildLease({ repoRoot, pid: 222, isAlive: () => true }).acquired, false);
    releaseDashboardBuildLease(repoRoot, first.record);
    // The Electron lifecycle lease does not prevent an in-app rebuild after
    // the launcher's initial output work has completed.
    claimLeanDesktopLease({ repoRoot, pid: 111, isAlive: () => true });
    assert.equal(claimDashboardBuildLease({ repoRoot, pid: 222, isAlive: () => true }).acquired, true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("borrowing a live launcher lease requires its claim ID and immediate parent PID", () => {
  const repoRoot = tempRepo();
  try {
    const launcher = claimDashboardBuildLease({ repoRoot, pid: 111, isAlive: () => true });
    for (const [parentPid, inheritedClaimId, expected] of [
      [111, launcher.record.claimId, true],
      [333, launcher.record.claimId, false],
      [111, "outdated-claim", false],
      [111, undefined, false],
    ]) {
      const build = claimDashboardBuildLease({
        repoRoot, pid: 222, parentPid, inheritedClaimId, isAlive: () => true,
      });
      assert.equal(build.acquired, expected);
      assert.equal(build.inherited, expected);
      assert.deepEqual(readLeanDesktopLease(dashboardBuildLeasePath(repoRoot)), launcher.record);
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("the build entry point locks before resource admission and releases only owned leases", () => {
  const repoRoot = tempRepo();
  const scripts = path.join(repoRoot, "desktop", "scripts");
  try {
    fs.mkdirSync(scripts, { recursive: true });
    for (const name of ["build-dashboard.mjs", "dev-fast.mjs", "lean-desktop-lease.mjs"]) {
      fs.copyFileSync(path.join(desktopRoot, "scripts", name), path.join(scripts, name));
    }
    for (const [name, exports] of [
      ["dashboard-build-cache.mjs", ["availableDashboardBuild", "reusableDashboardBuild", "beginDashboardBuild", "completeDashboardBuild",
        "recoverInterruptedDashboardBuild", "refreshStandaloneDashboardAssets", "writeDashboardBuildManifest"]],
      ["dashboard-build-retry.mjs", ["isTransientDashboardBuildFailure"]],
      ["dashboard-trace-safety.mjs", ["assertSafeDashboardTraces"]],
    ]) {
      fs.writeFileSync(path.join(scripts, name), exports.map((name) =>
        `export function ${name}() { throw new Error('Unexpected build work'); }`).join("\n"));
    }
    // Stop at the first heavy boundary, after checking that the real entry
    // point has secured a lease. No Next build or provisioning runs in this test.
    fs.writeFileSync(path.join(scripts, "commit-preflight.mjs"), `
      import fs from 'node:fs';
      export function assertWindowsCommitHeadroom() {
        const lease = JSON.parse(fs.readFileSync(new URL('../../.runtime/dashboard-build.lock.json', import.meta.url)));
        console.log('admitted:' + lease.pid);
        process.exit(0);
      }
    `);
    const run = (claimId = "", entry = "build-dashboard.mjs") => spawnSync(process.execPath, [path.join(scripts, entry)], {
      encoding: "utf8", windowsHide: true,
      env: { ...process.env, BREADBOARD_DASHBOARD_BUILD_CLAIM_ID: claimId },
    });

    const direct = run();
    assert.equal(direct.status, 0, direct.stderr);
    assert.match(direct.stdout, /admitted:\d+/u);
    assert.equal(readLeanDesktopLease(dashboardBuildLeasePath(repoRoot)), null);

    const launcher = claimDashboardBuildLease({ repoRoot });
    const blocked = run();
    assert.equal(blocked.status, 2, blocked.stderr);
    assert.match(blocked.stderr, /already running/u);
    assert.equal(blocked.stdout, "");
    assert.deepEqual(readLeanDesktopLease(dashboardBuildLeasePath(repoRoot)), launcher.record);

    const blockedLauncher = run("", "dev-fast.mjs");
    assert.equal(blockedLauncher.status, 2, blockedLauncher.stderr);
    assert.match(blockedLauncher.stderr, /already running/u);
    assert.equal(readLeanDesktopLease(leanDesktopLeasePath(repoRoot)), null);
    assert.deepEqual(readLeanDesktopLease(dashboardBuildLeasePath(repoRoot)), launcher.record);

    const inherited = run(launcher.record.claimId);
    assert.equal(inherited.status, 0, inherited.stderr);
    assert.match(inherited.stdout, new RegExp(`admitted:${process.pid}`));
    assert.deepEqual(readLeanDesktopLease(dashboardBuildLeasePath(repoRoot)), launcher.record);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

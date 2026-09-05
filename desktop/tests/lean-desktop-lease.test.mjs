import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  claimLeanDesktopLease,
  duplicateLeanDesktopWarning,
  leanDesktopLeasePath,
  readLeanDesktopLease,
  releaseLeanDesktopLease,
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
});

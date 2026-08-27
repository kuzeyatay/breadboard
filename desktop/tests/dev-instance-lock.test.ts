import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  claimDevInstance,
  devInstanceLockPath,
  duplicateStackWarning,
  readDevInstanceRecord,
  releaseDevInstance,
  requiresExclusiveHotCheckout,
  type DevInstanceRecord,
} from "../src/main/dev-instance-lock";

const DESKTOP_ROOT = path.resolve(__dirname, "..", "..");

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bb-devlock-"));
}

test("the first claim writes a record identifying owner, pid, start time and checkout", () => {
  const repoRoot = tempRepo();
  const result = claimDevInstance({ repoRoot, owner: "desktop", pid: 4242 });
  assert.equal(result.conflict, false);
  assert.equal(result.existing, null);

  const record = readDevInstanceRecord(devInstanceLockPath(repoRoot));
  assert.ok(record);
  assert.equal(record?.owner, "desktop");
  assert.equal(record?.pid, 4242);
  assert.equal(path.resolve(record?.checkout ?? ""), path.resolve(repoRoot));
  assert.ok(!Number.isNaN(Date.parse(record?.startedAt ?? "")));
  assert.match(record?.claimId ?? "", /^[0-9a-f-]{36}$/i);
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

test("the exclusive Hot guard applies to ordinary and QA dev, but not lean or packaged launches", () => {
  assert.equal(
    requiresExclusiveHotCheckout({
      desktopMode: "dev",
      launchMode: "hot",
      qaMode: false,
    }),
    true,
  );
  assert.equal(
    requiresExclusiveHotCheckout({
      desktopMode: "dev",
      launchMode: "hot",
      qaMode: true,
    }),
    true,
  );
  assert.equal(
    requiresExclusiveHotCheckout({
      desktopMode: "dev",
      launchMode: "lean",
      qaMode: false,
    }),
    false,
  );
  assert.equal(
    requiresExclusiveHotCheckout({
      desktopMode: "packaged",
      launchMode: "packaged",
      qaMode: false,
    }),
    false,
  );
});

test("AppLifecycle reports a Hot claim failure before constructing or starting Runtime V2", () => {
  const source = fs.readFileSync(
    path.join(DESKTOP_ROOT, "src", "main", "app-lifecycle.ts"),
    "utf8",
  );
  const launchMode = source.indexOf(
    "const launchMode = runtimeLaunchMode(this.paths.mode);",
  );
  const guard = source.indexOf("requiresExclusiveHotCheckout({", launchMode);
  const claim = source.indexOf("claimDevInstance({ repoRoot", guard);
  const successfulOwnership = source.indexOf(
    "this.devInstanceLockRepoRoot = repoRoot;",
    claim,
  );
  const constructionGate = source.indexOf(
    "if (hotCheckoutFailure === null)",
    claim,
  );
  const runtimeConstruction = source.indexOf("new RuntimeProcess({", constructionGate);
  const startupScreen = source.indexOf(
    "await this.windows.showStartupScreen();",
    runtimeConstruction,
  );
  const failureGate = source.indexOf(
    "if (hotCheckoutFailure !== null)",
    startupScreen,
  );
  const dataPreparation = source.indexOf("await this.prepareDataLayer();", failureGate);
  const runtimeStart = source.indexOf("await this.startRuntime();", dataPreparation);

  assert.ok(
    [
      launchMode,
      guard,
      claim,
      successfulOwnership,
      constructionGate,
      runtimeConstruction,
      startupScreen,
      failureGate,
      dataPreparation,
      runtimeStart,
    ].every((position) => position >= 0),
    "the complete Hot guard and existing startup-failure flow must remain present",
  );
  assert.ok(launchMode < guard && guard < claim);
  assert.ok(claim < successfulOwnership && successfulOwnership < constructionGate);
  assert.ok(constructionGate < runtimeConstruction && runtimeConstruction < startupScreen);
  assert.ok(startupScreen < failureGate && failureGate < dataPreparation);
  assert.ok(dataPreparation < runtimeStart);
});

test("an interleaved first claim cannot overwrite the exclusive winner", () => {
  const repoRoot = tempRepo();
  const lockPath = devInstanceLockPath(repoRoot);
  let competitorStarted = false;

  const first = claimDevInstance({
    repoRoot,
    owner: "desktop-a",
    pid: 111,
    isAlive: (pid) => pid === 222,
    createExclusive: (file, contents) => {
      if (!competitorStarted && file === lockPath) {
        competitorStarted = true;
        const competitor = claimDevInstance({
          repoRoot,
          owner: "desktop-b",
          pid: 222,
        });
        assert.equal(competitor.conflict, false);
      }
      fs.writeFileSync(file, contents, { encoding: "utf8", flag: "wx" });
    },
  });

  assert.equal(first.conflict, true);
  assert.equal(first.existing?.pid, 222);
  assert.equal(readDevInstanceRecord(lockPath)?.pid, 222);
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

test("a live foreign stack is reported as a conflict and the record is left intact", () => {
  const repoRoot = tempRepo();
  claimDevInstance({ repoRoot, owner: "stack", pid: 111, isAlive: () => true });

  const second = claimDevInstance({
    repoRoot,
    owner: "desktop",
    pid: 222,
    isAlive: (pid) => pid === 111,
  });
  assert.equal(second.conflict, true);
  assert.equal(second.existing?.owner, "stack");
  assert.equal(second.existing?.pid, 111);

  // The incumbent must keep the lock.
  assert.equal(readDevInstanceRecord(devInstanceLockPath(repoRoot))?.pid, 111);
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

test("a stale record from a dead process is taken over", () => {
  const repoRoot = tempRepo();
  claimDevInstance({ repoRoot, owner: "stack", pid: 111, isAlive: () => true });

  const second = claimDevInstance({
    repoRoot,
    owner: "desktop",
    pid: 222,
    isAlive: () => false, // the previous stack crashed
  });
  assert.equal(second.conflict, false);
  assert.equal(second.staleReplaced, true);
  assert.equal(readDevInstanceRecord(devInstanceLockPath(repoRoot))?.pid, 222);
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

test("a record from a different checkout never conflicts", () => {
  const repoRoot = tempRepo();
  const other = tempRepo();
  const lockPath = devInstanceLockPath(repoRoot);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const foreign: DevInstanceRecord = {
    owner: "stack",
    pid: 111,
    startedAt: new Date().toISOString(),
    checkout: other,
  };
  fs.writeFileSync(lockPath, JSON.stringify(foreign));

  const result = claimDevInstance({ repoRoot, owner: "desktop", pid: 222, isAlive: () => true });
  assert.equal(result.conflict, false, "a different clone is not a duplicate stack");
  assert.equal(readDevInstanceRecord(lockPath)?.pid, 222);
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

test("the same process re-claiming its own lock is not a conflict", () => {
  const repoRoot = tempRepo();
  claimDevInstance({ repoRoot, owner: "desktop", pid: 777, isAlive: () => true });
  const again = claimDevInstance({ repoRoot, owner: "desktop", pid: 777, isAlive: () => true });
  assert.equal(again.conflict, false);
  assert.equal(again.staleReplaced, false);
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

test("a corrupt or truncated lock file is treated as absent", () => {
  const repoRoot = tempRepo();
  const lockPath = devInstanceLockPath(repoRoot);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (const contents of ["", "{", "null", "[]", '{"owner":"stack"}', '{"pid":"nope"}']) {
    fs.writeFileSync(lockPath, contents);
    assert.equal(readDevInstanceRecord(lockPath), null, `contents=${JSON.stringify(contents)}`);
    const result = claimDevInstance({ repoRoot, owner: "desktop", pid: 999, isAlive: () => true });
    assert.equal(result.conflict, false);
  }
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

test("release only removes the lock this process owns", () => {
  const repoRoot = tempRepo();
  claimDevInstance({ repoRoot, owner: "stack", pid: 111, isAlive: () => true });

  releaseDevInstance(repoRoot, 222);
  assert.ok(readDevInstanceRecord(devInstanceLockPath(repoRoot)), "a foreign lock is untouched");

  releaseDevInstance(repoRoot, 111);
  assert.equal(readDevInstanceRecord(devInstanceLockPath(repoRoot)), null);
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

test("an unwritable Hot lock fails closed", () => {
  const repoRoot = tempRepo();
  assert.throws(
    () =>
      claimDevInstance({
        repoRoot,
        owner: "desktop",
        pid: 5,
        createExclusive: () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        },
      }),
    /could not secure the Hot development lock/,
  );
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

test("the warning names the owner, pid and start time and carries no paths or secrets", () => {
  const startedAt = new Date().toISOString();
  const warning = duplicateStackWarning({
    owner: "stack",
    pid: 4242,
    startedAt,
    checkout: "C:/Users/someone/breadboard",
  });
  assert.match(warning, /owner=stack/);
  assert.match(warning, /pid=4242/);
  assert.ok(warning.includes(startedAt));
  assert.ok(
    !warning.includes("C:/Users/someone"),
    "the warning must not echo a filesystem path back at the user",
  );
  assert.match(warning, /second compiler.*not allowed/i);
});

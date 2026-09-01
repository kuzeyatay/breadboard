import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { copyFileWithLockRetry } from "./copy-file-with-retry.mjs";

function failure(code) {
  return Object.assign(new Error(code), { code });
}

test("retries a transient Windows executable lock", async () => {
  let attempts = 0;
  let retryReports = 0;

  await copyFileWithLockRetry("built.exe", "staged.exe", {
    copyFile: async () => {
      attempts += 1;
      if (attempts < 3) throw failure("EBUSY");
    },
    now: () => 0,
    wait: async () => undefined,
    onRetry: () => {
      retryReports += 1;
    },
  });

  assert.equal(attempts, 3);
  assert.equal(retryReports, 1);
});

test("does not retry an unrelated copy failure", async () => {
  let attempts = 0;

  await assert.rejects(
    copyFileWithLockRetry("missing.exe", "staged.exe", {
      copyFile: async () => {
        attempts += 1;
        throw failure("ENOENT");
      },
    }),
    { code: "ENOENT" },
  );

  assert.equal(attempts, 1);
});

test("turns a persistent lock into an actionable error", async () => {
  const times = [0, 101];

  await assert.rejects(
    copyFileWithLockRetry("built.exe", "staged.exe", {
      timeoutMs: 100,
      copyFile: async () => {
        throw failure("EBUSY");
      },
      now: () => times.shift() ?? 101,
      wait: async () => undefined,
    }),
    (error) => {
      assert.equal(error.code, "EBUSY");
      assert.match(error.message, /previous Breadboard desktop process/u);
      assert.equal(error.cause.code, "EBUSY");
      return true;
    },
  );
});

test(
  "waits for a real Windows executable lock to clear",
  { skip: process.platform !== "win32" },
  async (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-copy-retry-"));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const runningExecutable = path.join(directory, "locked-node.exe");
    fs.copyFileSync(process.execPath, runningExecutable);

    const child = spawn(runningExecutable, ["-e", "setTimeout(() => {}, 500)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await once(child, "spawn");
    let retryReports = 0;

    await copyFileWithLockRetry(process.execPath, runningExecutable, {
      timeoutMs: 5_000,
      intervalMs: 25,
      onRetry: () => {
        retryReports += 1;
      },
    });

    assert.equal(child.exitCode, 0);
    assert.equal(retryReports, 1);
  },
);

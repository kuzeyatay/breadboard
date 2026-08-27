import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { connectFreshPgliteWithWindowsRecovery } from "../src/backends/gbrain-backend.ts";

const temporaryDirectories: string[] = [];
const EINVAL = new Error(
  'PGLite failed to initialize its WASM runtime.\n' +
    '  Original error: Non-Error rejection: {"$type":"Object","name":"ErrnoError","errno":28}',
);

function freshDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gbrain-pglite-recovery-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("fresh Windows Bun store retries EINVAL once with the same untouched directory", async () => {
  const directory = freshDirectory();
  const delays: number[] = [];
  let attempts = 0;

  const result = await connectFreshPgliteWithWindowsRecovery(
    async () => {
      attempts += 1;
      expect(fs.readdirSync(directory)).toEqual([]);
      if (attempts === 1) throw EINVAL;
      return "connected";
    },
    {
      pgDir: directory,
      platform: "win32",
      bunVersion: "1.3.14",
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    },
  );

  expect(result).toBe("connected");
  expect(attempts).toBe(2);
  expect(delays).toEqual([150]);
  expect(fs.existsSync(directory)).toBe(true);
  expect(fs.readdirSync(directory)).toEqual([]);
});

test("an existing store is never retried", async () => {
  const directory = freshDirectory();
  fs.writeFileSync(path.join(directory, "existing-data"), "do not touch");
  let attempts = 0;

  await expect(
    connectFreshPgliteWithWindowsRecovery(
      async () => {
        attempts += 1;
        throw EINVAL;
      },
      { pgDir: directory, platform: "win32", bunVersion: "1.3.14" },
    ),
  ).rejects.toBe(EINVAL);

  expect(attempts).toBe(1);
  expect(fs.readFileSync(path.join(directory, "existing-data"), "utf8")).toBe("do not touch");
});

test("non-EINVAL failures and non-Bun runtimes are never retried", async () => {
  for (const scenario of [
    { error: new Error("different failure"), bunVersion: "1.3.14" },
    { error: EINVAL, bunVersion: "" },
  ]) {
    const directory = freshDirectory();
    let attempts = 0;
    await expect(
      connectFreshPgliteWithWindowsRecovery(
        async () => {
          attempts += 1;
          throw scenario.error;
        },
        { pgDir: directory, platform: "win32", bunVersion: scenario.bunVersion },
      ),
    ).rejects.toBe(scenario.error);
    expect(attempts).toBe(1);
  }
});

test("a repeated fresh-store EINVAL stops after the second attempt with accurate diagnostics", async () => {
  const directory = freshDirectory();
  let attempts = 0;

  await expect(
    connectFreshPgliteWithWindowsRecovery(
      async () => {
        attempts += 1;
        throw EINVAL;
      },
      {
        pgDir: directory,
        platform: "win32",
        bunVersion: "1.3.14",
        delay: async () => {},
      },
    ),
  ).rejects.toThrow(/EINVAL \(errno 28\).*one bounded retry[\s\S]*not evidence of lock contention/u);

  expect(attempts).toBe(2);
  expect(fs.readdirSync(directory)).toEqual([]);
});

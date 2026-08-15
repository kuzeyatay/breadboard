import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { parseStartupOptions } from "../src/main/startup-options";

test("startup options separate dev mode from an isolated absolute data path", () => {
  const dataDir = path.join(os.tmpdir(), "breadboard-smoke-user-data");
  assert.deepEqual(parseStartupOptions(["electron", ".", "--breadboard-dev"], {}), {
    forceDev: true,
    userDataDir: null,
    qaDownloadsDir: null,
    qaMode: false,
    qaServiceProfile: "critical",
  });
  assert.deepEqual(
    parseStartupOptions(
      ["Breadboard.exe", `--breadboard-user-data-dir=${dataDir}`],
      {},
    ),
    {
      forceDev: false,
      userDataDir: path.resolve(dataDir),
      qaDownloadsDir: null,
      qaMode: false,
      qaServiceProfile: "critical",
    },
  );
});

test("QA mode is double-gated, isolated, development-only, and profile-validated", () => {
  const dataDir = path.join(os.tmpdir(), "breadboard-qa-user-data");
  const args = [
    "electron",
    ".",
    "--breadboard-dev",
    "--breadboard-qa",
    `--breadboard-user-data-dir=${dataDir}`,
  ];
  assert.deepEqual(
    parseStartupOptions(args, {
      BREADBOARD_QA_MODE: "1",
      BREADBOARD_QA_SERVICE_PROFILE: "critical",
    }),
    {
      forceDev: true,
      userDataDir: path.resolve(dataDir),
      qaDownloadsDir: path.join(path.dirname(path.resolve(dataDir)), "downloads"),
      qaMode: true,
      qaServiceProfile: "critical",
    },
  );
  assert.throws(() => parseStartupOptions(args, {}), /requires both/);
  assert.throws(
    () =>
      parseStartupOptions(
        ["electron", ".", "--breadboard-qa", `--breadboard-user-data-dir=${dataDir}`],
        { BREADBOARD_QA_MODE: "1" },
      ),
    /requires --breadboard-dev/,
  );
  assert.throws(
    () =>
      parseStartupOptions(
        ["electron", ".", "--breadboard-dev", "--breadboard-qa"],
        { BREADBOARD_QA_MODE: "1" },
      ),
    /requires --breadboard-user-data-dir/,
  );
  assert.throws(
    () =>
      parseStartupOptions(args, {
        BREADBOARD_QA_MODE: "1",
        BREADBOARD_QA_SERVICE_PROFILE: "full",
      }),
    /must be "critical".*broader profiles are blocked/,
  );
});

test("startup rejects ambiguous or unsafe data directory overrides", () => {
  assert.throws(
    () => parseStartupOptions(["Breadboard.exe", "--breadboard-user-data-dir=relative"], {}),
    /absolute path/,
  );
  assert.throws(
    () =>
      parseStartupOptions(
        [
          "Breadboard.exe",
          `--breadboard-user-data-dir=${path.join(os.tmpdir(), "one")}`,
          `--breadboard-user-data-dir=${path.join(os.tmpdir(), "two")}`,
        ],
        {},
      ),
    /Only one/,
  );
  assert.throws(
    () =>
      parseStartupOptions(
        ["Breadboard.exe", `--breadboard-user-data-dir=${path.parse(os.tmpdir()).root}`],
        {},
      ),
    /filesystem root/,
  );
});

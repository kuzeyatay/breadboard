import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { parseStartupOptions } from "../src/main/startup-options";

test("startup options separate dev mode from an isolated absolute data path", () => {
  const dataDir = path.join(os.tmpdir(), "breadboard-smoke-user-data");
  assert.deepEqual(parseStartupOptions(["electron", ".", "--breadboard-dev"]), {
    forceDev: true,
    userDataDir: null,
  });
  assert.deepEqual(
    parseStartupOptions(["Breadboard.exe", `--breadboard-user-data-dir=${dataDir}`]),
    { forceDev: false, userDataDir: path.resolve(dataDir) },
  );
});

test("startup rejects ambiguous or unsafe data directory overrides", () => {
  assert.throws(
    () => parseStartupOptions(["Breadboard.exe", "--breadboard-user-data-dir=relative"]),
    /absolute path/,
  );
  assert.throws(
    () =>
      parseStartupOptions([
        "Breadboard.exe",
        `--breadboard-user-data-dir=${path.join(os.tmpdir(), "one")}`,
        `--breadboard-user-data-dir=${path.join(os.tmpdir(), "two")}`,
      ]),
    /Only one/,
  );
  assert.throws(
    () => parseStartupOptions(["Breadboard.exe", `--breadboard-user-data-dir=${path.parse(os.tmpdir()).root}`]),
    /filesystem root/,
  );
});


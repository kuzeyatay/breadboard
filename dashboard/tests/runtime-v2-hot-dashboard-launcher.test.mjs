import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HOT_DASHBOARD_DIST_DIR,
  pinHotDashboardOutput,
  shadowProjectDotenvKeys,
  shouldShadowProjectDotenv,
} from "../scripts/runtime-v2-hot-dashboard.mjs";

function capturedThrow(callback, expected) {
  let captured;
  assert.throws(() => {
    try {
      callback();
    } catch (error) {
      captured = error;
      throw error;
    }
  }, expected);
  assert.ok(captured instanceof Error);
  return captured;
}

test("dotenv shadowing follows the trusted distinct-data-root signal alone", () => {
  assert.equal(shouldShadowProjectDotenv({}), false);
  assert.equal(shouldShadowProjectDotenv({ BREADBOARD_DATA_DIR: "   " }), false);
  assert.equal(
    shouldShadowProjectDotenv({ BREADBOARD_DATA_DIR: "C:\\isolated", BREADBOARD_DASHBOARD_BUNDLER: "" }),
    true,
  );
});

test("Hot Runtime pins a dedicated development output instead of restoring an old compiler cache", () => {
  const environment = { BREADBOARD_NEXT_DIST_DIR: "C:\\outside" };
  pinHotDashboardOutput(environment);
  assert.equal(HOT_DASHBOARD_DIST_DIR, ".next-dev");
  assert.deepEqual(environment, { BREADBOARD_NEXT_DIST_DIR: ".next-dev" });
});

test("isolated hot launch shadows checkout dotenv keys without copying their values", (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hot-dotenv-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(project, ".env.development.local"),
    [
      "DEVELOPMENT_SECRET=do-not-copy",
      "export SHARED_SECRET=also-private",
      'MULTILINE_SECRET="first-private-line',
      "VALUE_SHAPED_TEXT=must-stay-inside-the-value",
      'last-private-line"',
      "DOTTED.SECRET-HYPHEN=private-too",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(project, ".env.local"),
    "LOCAL_SECRET='still-private'\nBREADBOARD_DATA_DIR=must-not-replace-trusted\n",
  );
  fs.writeFileSync(path.join(project, ".env.development"), "DEVELOPMENT_ONLY: private\n");
  fs.writeFileSync(path.join(project, ".env"), "BASE_SECRET=private\n");

  const environment = {
    BREADBOARD_DATA_DIR: path.join(project, "isolated-data"),
    SHARED_SECRET: "trusted-runtime-value",
  };
  shadowProjectDotenvKeys(project, environment);

  assert.deepEqual(environment, {
    BREADBOARD_DATA_DIR: path.join(project, "isolated-data"),
    SHARED_SECRET: "trusted-runtime-value",
    DEVELOPMENT_SECRET: "",
    MULTILINE_SECRET: "",
    "DOTTED.SECRET-HYPHEN": "",
    LOCAL_SECRET: "",
    DEVELOPMENT_ONLY: "",
    BASE_SECRET: "",
  });
  assert.equal(Object.hasOwn(environment, "VALUE_SHAPED_TEXT"), false);
  assert.doesNotMatch(JSON.stringify(environment), /private|do-not-copy/u);
});

test("isolated hot launch rejects oversized dotenv input before reading it", (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hot-dotenv-large-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, ".env.local"), Buffer.alloc(1024 * 1024 + 1, 65));
  assert.throws(
    () => shadowProjectDotenvKeys(project, {}),
    /rejected oversized \.env\.local/u,
  );
});

test("isolated hot launch enforces the dotenv declaration bound atomically", (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hot-dotenv-count-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const dotenv = path.join(project, ".env.local");
  const declarations = (count) => Array.from(
    { length: count },
    (_, index) => `SECRET_${String(index).padStart(3, "0")}=private-value-${index}`,
  ).join("\n");

  fs.writeFileSync(dotenv, declarations(256));
  const accepted = {};
  shadowProjectDotenvKeys(project, accepted);
  assert.equal(Object.keys(accepted).length, 256);
  assert.equal(Object.values(accepted).every((value) => value === ""), true);
  assert.doesNotMatch(JSON.stringify(accepted), /private-value/u);

  fs.writeFileSync(dotenv, declarations(257));
  const rejected = { TRUSTED_VALUE: "keep-me" };
  const error = capturedThrow(
    () => shadowProjectDotenvKeys(project, rejected),
    /rejected too-many-keys \.env\.local/u,
  );
  assert.deepEqual(rejected, { TRUSTED_VALUE: "keep-me" });
  assert.doesNotMatch(error.message, /private-value/u);
});

test("isolated hot launch rejects malformed dotenv without leaking or partially shadowing", (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hot-dotenv-malformed-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(project, ".env.local"),
    "VALID_BEFORE_FAILURE=private-before\nmalformed private-after text\n",
  );
  const environment = { TRUSTED_VALUE: "keep-me" };

  const error = capturedThrow(
    () => shadowProjectDotenvKeys(project, environment),
    /rejected malformed \.env\.local/u,
  );
  assert.deepEqual(environment, { TRUSTED_VALUE: "keep-me" });
  assert.doesNotMatch(error.message, /private-before|private-after/u);
});

test("isolated hot launch rejects a dotenv symlink before observing its target", (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hot-dotenv-link-project-"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "bb-hot-dotenv-link-target-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const target = path.join(external, "developer-secrets.env");
  const candidate = path.join(project, ".env.local");
  fs.writeFileSync(target, "EXTERNAL_SECRET=external-private-value\n");
  try {
    fs.symlinkSync(target, candidate, "file");
  } catch (error) {
    if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
    try {
      fs.symlinkSync(external, candidate, process.platform === "win32" ? "junction" : "dir");
    } catch (fallbackError) {
      if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(fallbackError?.code)) {
        throw fallbackError;
      }
      t.skip(`symlinks are unavailable on this host (${fallbackError.code})`);
      return;
    }
  }

  const environment = {};
  const error = capturedThrow(
    () => shadowProjectDotenvKeys(project, environment),
    /rejected non-regular \.env\.local/u,
  );
  assert.deepEqual(environment, {});
  assert.doesNotMatch(error.message, /external-private-value/u);
});

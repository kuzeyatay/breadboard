import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  cliproxyHome,
  migrateLegacyCliproxyState,
  prepareDevelopmentCliproxyRuntime,
  renderCliproxyConfig,
} from "../src/main/cliproxy";
import type { ResolvedPaths } from "../src/main/path-resolver";

test("subscription quota refusals return promptly to ChatMock failover", () => {
  const config = renderCliproxyConfig({
    home: "C:/Breadboard/cliproxy",
    port: 8317,
    apiKey: "loopback-api-key",
    managementKey: "loopback-management-key",
  });

  assert.match(config, /^request-retry: 0$/m);
  assert.doesNotMatch(config, /^request-retry: [1-9]\d*$/m);
  assert.match(config, /^  switch-project: true$/m);
});

test("QA mode never reuses the developer subscription account cache", () => {
  const previous = process.env["CLIPROXY_HOME"];
  delete process.env["CLIPROXY_HOME"];
  try {
    const paths = {
      mode: "dev",
      qaMode: true,
      dataRoot: path.resolve("C:/qa-user-data/Data"),
    } as ResolvedPaths;
    assert.equal(cliproxyHome(paths), path.join(paths.dataRoot, "cliproxy"));
  } finally {
    if (previous === undefined) delete process.env["CLIPROXY_HOME"];
    else process.env["CLIPROXY_HOME"] = previous;
  }
});

test("Runtime V2 development preparation preserves legacy accounts without legacy secrets", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cliproxy-cutover-"));
  const legacyHome = path.join(root, "legacy");
  const dataRoot = path.join(root, "data");
  const runtimeHome = path.join(dataRoot, "cliproxy");
  const binaryName = process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
  fs.mkdirSync(path.join(legacyHome, "bin"), { recursive: true });
  fs.mkdirSync(path.join(legacyHome, "auth"), { recursive: true });
  fs.writeFileSync(path.join(legacyHome, "bin", binaryName), "reviewed-binary");
  fs.writeFileSync(path.join(legacyHome, "auth", "antigravity-test.json"), "account");
  fs.writeFileSync(path.join(legacyHome, "api-key"), "legacy-api-key");
  fs.writeFileSync(path.join(legacyHome, "management-key"), "legacy-management-key");

  let provisionedHome = "";
  try {
    await prepareDevelopmentCliproxyRuntime(
      {
        mode: "dev",
        qaMode: false,
        dataRoot,
      } as ResolvedPaths,
      () => undefined,
      {
        legacyHome,
        provision: async (home) => {
          provisionedHome = home;
          assert.ok(fs.existsSync(path.join(home, "bin", binaryName)));
        },
      },
    );

    assert.equal(provisionedHome, runtimeHome);
    assert.equal(fs.readFileSync(path.join(runtimeHome, "bin", binaryName), "utf8"), "reviewed-binary");
    assert.equal(
      fs.readFileSync(path.join(runtimeHome, "auth", "antigravity-test.json"), "utf8"),
      "account",
    );
    assert.equal(fs.existsSync(path.join(runtimeHome, "api-key")), false);
    assert.equal(fs.existsSync(path.join(runtimeHome, "management-key")), false);

    const repeated = migrateLegacyCliproxyState(legacyHome, runtimeHome);
    assert.deepEqual(repeated, { binaryCopied: false, authFilesCopied: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packaged and QA preparation never imports development subscription state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cliproxy-isolation-"));
  let provisionCalls = 0;
  try {
    for (const paths of [
      { mode: "packaged", qaMode: false, dataRoot: path.join(root, "packaged") },
      { mode: "dev", qaMode: true, dataRoot: path.join(root, "qa") },
    ] as const) {
      await prepareDevelopmentCliproxyRuntime(
        paths as ResolvedPaths,
        () => undefined,
        { provision: async () => { provisionCalls += 1; } },
      );
    }
    assert.equal(provisionCalls, 0);
    assert.equal(fs.existsSync(path.join(root, "packaged")), false);
    assert.equal(fs.existsSync(path.join(root, "qa")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  defaultPersistentConfig,
  loadOrCreatePersistentConfig,
  validatePersistentConfig,
  savePersistentConfig,
  redactSecrets,
  redactedConfigSummary,
  atomicWriteFile,
} from "../src/main/runtime-config";

test("defaults generate strong distinct secrets", () => {
  const a = defaultPersistentConfig();
  const b = defaultPersistentConfig();
  assert.ok(a.nextAuthSecret.length >= 32);
  assert.ok(a.openharnessPassword.length >= 24);
  assert.notEqual(a.nextAuthSecret, b.nextAuthSecret);
  assert.notEqual(a.nextAuthSecret, a.openharnessPassword);
  assert.equal(a.openharnessMode, "required");
  assert.equal(a.agentRuntime, "hermes");
  assert.equal(a.agentRuntimeFallback, null);
  assert.ok(a.hermesSessionToken.length >= 32);
  assert.ok(a.hermesToolSecret.length >= 32);
  assert.notEqual(a.hermesSessionToken, b.hermesSessionToken);
  assert.equal(a.scriberrEnabled, false);
});

test("load-or-create persists and reloads the same config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cfg-"));
  const created = loadOrCreatePersistentConfig(dir);
  const reloaded = loadOrCreatePersistentConfig(dir);
  assert.deepEqual(created, reloaded);
});

test("validation rejects missing secrets and bad modes", () => {
  assert.throws(() => validatePersistentConfig(null));
  assert.throws(() => validatePersistentConfig({ version: 1 }));
  const valid = defaultPersistentConfig();
  assert.throws(() =>
    validatePersistentConfig({ ...valid, openharnessMode: "sometimes" }),
  );
  assert.throws(() =>
    validatePersistentConfig({ ...valid, agentRuntime: "something-else" }),
  );
  assert.throws(() =>
    validatePersistentConfig({
      ...valid,
      agentRuntime: "hermes",
      agentRuntimeFallback: "hermes",
    }),
  );
  assert.throws(() => validatePersistentConfig({ ...valid, version: 2 }));
  assert.deepEqual(validatePersistentConfig({ ...valid }), valid);
});

test("save uses atomic replace and keeps file valid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cfg-"));
  const config = loadOrCreatePersistentConfig(dir);
  config.scriberrEnabled = true;
  savePersistentConfig(dir, config);
  const reloaded = loadOrCreatePersistentConfig(dir);
  assert.equal(reloaded.scriberrEnabled, true);
  // No temp files left behind.
  const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"));
  assert.equal(leftovers.length, 0);
});

test("atomicWriteFile replaces content wholly", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-aw-"));
  const file = path.join(dir, "x.json");
  atomicWriteFile(file, "first");
  atomicWriteFile(file, "second");
  assert.equal(fs.readFileSync(file, "utf8"), "second");
});

test("log redaction removes every secret", () => {
  const config = defaultPersistentConfig();
  const line = `auth=${config.openharnessPassword} token=${config.openharnessToolSecret} n=${config.nextAuthSecret} c=${config.openharnessCapabilitySecret} hs=${config.hermesSessionToken} ht=${config.hermesToolSecret}`;
  const clean = redactSecrets(line, config);
  assert.ok(!clean.includes(config.openharnessPassword));
  assert.ok(!clean.includes(config.openharnessToolSecret));
  assert.ok(!clean.includes(config.nextAuthSecret));
  assert.ok(!clean.includes(config.openharnessCapabilitySecret));
  assert.ok(!clean.includes(config.hermesSessionToken));
  assert.ok(!clean.includes(config.hermesToolSecret));
  assert.ok(clean.includes("[redacted]"));
});

test("diagnostics summary exposes no secret values", () => {
  const persistent = defaultPersistentConfig();
  const summary = JSON.stringify(
    redactedConfigSummary({
      persistent,
      ports: {
        dashboard: 3000,
        chatmock: 8765,
        openharness: 4096,
        hermes: 9119,
        quartz: 8081,
        quartzWs: 3001,
      },
    }),
  );
  assert.ok(!summary.includes(persistent.nextAuthSecret));
  assert.ok(!summary.includes(persistent.openharnessPassword));
  assert.ok(!summary.includes(persistent.openharnessToolSecret));
  assert.ok(!summary.includes(persistent.openharnessCapabilitySecret));
  assert.ok(!summary.includes(persistent.hermesSessionToken));
  assert.ok(!summary.includes(persistent.hermesToolSecret));
  assert.ok(!summary.includes('"hermes":9119'));
});

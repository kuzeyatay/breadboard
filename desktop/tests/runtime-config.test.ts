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
  redactedPersistentConfigSummary,
  atomicWriteFile,
} from "../src/main/runtime-config";

test("defaults generate strong distinct secrets", () => {
  const a = defaultPersistentConfig();
  const b = defaultPersistentConfig();
  assert.ok(a.nextAuthSecret.length >= 32);
  assert.notEqual(a.nextAuthSecret, b.nextAuthSecret);
  assert.ok(a.hermesSessionToken.length >= 32);
  assert.ok(a.hermesToolSecret.length >= 32);
  assert.ok(a.hermesCapabilitySecret.length >= 32);
  assert.notEqual(a.hermesSessionToken, b.hermesSessionToken);
  assert.notEqual(a.hermesCapabilitySecret, b.hermesCapabilitySecret);
  assert.equal(a.scriberrEnabled, true);
  assert.equal(a.comfyUiMode, "managed");
  assert.equal(a.comfyUiExternalUrl, null);
  assert.equal(a.scriberrUsername, "breadboard");
  assert.ok(a.scriberrPassword.length >= 24);
  assert.notEqual(a.scriberrPassword, b.scriberrPassword);
});

test("load-or-create persists and reloads the same config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-cfg-"));
  const created = loadOrCreatePersistentConfig(dir);
  const reloaded = loadOrCreatePersistentConfig(dir);
  assert.deepEqual(created, reloaded);
});

test("validation rejects missing secrets and unsupported versions", () => {
  assert.throws(() => validatePersistentConfig(null));
  assert.throws(() => validatePersistentConfig({ version: 2 }));
  const valid = defaultPersistentConfig();
  assert.throws(() => validatePersistentConfig({ ...valid, version: 3 }));
  assert.deepEqual(validatePersistentConfig({ ...valid }), valid);
});

test("version 1 configs migrate their runtime secrets to Hermes", () => {
  const current = defaultPersistentConfig();
  const legacyPrefix = ["open", "harness"].join("");
  const legacyToolSecret = "t".repeat(48);
  const legacyCapabilitySecret = "c".repeat(48);
  const legacy = {
    ...current,
    version: 1,
    hermesToolSecret: undefined,
    hermesCapabilitySecret: undefined,
    [`${legacyPrefix}ToolSecret`]: legacyToolSecret,
    [`${legacyPrefix}CapabilitySecret`]: legacyCapabilitySecret,
  };
  const migrated = validatePersistentConfig(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.hermesToolSecret, legacyToolSecret);
  assert.equal(migrated.hermesCapabilitySecret, legacyCapabilitySecret);
});

test("ComfyUI desktop configuration is closed and external URLs are credential-free", () => {
  const current = defaultPersistentConfig();
  assert.equal(
    validatePersistentConfig({
      ...current,
      comfyUiMode: "external",
      comfyUiExternalUrl: "http://127.0.0.1:8188/",
    }).comfyUiExternalUrl,
    "http://127.0.0.1:8188",
  );
  assert.throws(() =>
    validatePersistentConfig({
      ...current,
      comfyUiMode: "external",
      comfyUiExternalUrl: null,
    }),
  );
  assert.throws(() =>
    validatePersistentConfig({
      ...current,
      comfyUiMode: "external",
      comfyUiExternalUrl: "http://user:secret@127.0.0.1:8188",
    }),
  );
  assert.throws(() =>
    validatePersistentConfig({ ...current, comfyUiMode: "ambient" }),
  );
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
  const line = `n=${config.nextAuthSecret} c=${config.hermesCapabilitySecret} hs=${config.hermesSessionToken} ht=${config.hermesToolSecret} scriberr=${config.scriberrPassword}`;
  const clean = redactSecrets(line, config);
  assert.ok(!clean.includes(config.nextAuthSecret));
  assert.ok(!clean.includes(config.hermesCapabilitySecret));
  assert.ok(!clean.includes(config.hermesSessionToken));
  assert.ok(!clean.includes(config.hermesToolSecret));
  assert.ok(!clean.includes(config.scriberrPassword));
  assert.ok(clean.includes("[redacted]"));
});

test("diagnostics summary exposes no secret values", () => {
  const persistent = defaultPersistentConfig();
  const persistentSummary = JSON.stringify(
    redactedPersistentConfigSummary(persistent),
  );
  const summary = JSON.stringify(
    redactedConfigSummary({
      persistent,
      ports: {
        dashboard: 3000,
        chatmock: 8765,
        hermes: 9119,
        postiz: 4007,
        quartz: 8081,
        quartzWs: 3001,
      },
    }),
  );
  assert.ok(!summary.includes(persistent.nextAuthSecret));
  assert.ok(!summary.includes(persistent.hermesCapabilitySecret));
  assert.ok(!summary.includes(persistent.hermesSessionToken));
  assert.ok(!summary.includes(persistent.hermesToolSecret));
  assert.ok(!summary.includes(persistent.scriberrPassword));
  assert.ok(!summary.includes('"hermes":9119'));
  assert.ok(!persistentSummary.includes(persistent.nextAuthSecret));
  assert.ok(!persistentSummary.includes(persistent.hermesCapabilitySecret));
  assert.ok(!persistentSummary.includes(persistent.hermesSessionToken));
  assert.ok(!persistentSummary.includes(persistent.hermesToolSecret));
  assert.ok(!persistentSummary.includes(persistent.scriberrPassword));
  assert.ok(!persistentSummary.includes('"ports"'));
});

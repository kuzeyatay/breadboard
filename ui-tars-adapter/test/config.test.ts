import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAgentConfiguration,
  defaultAgentConfiguration,
  resolveConfig,
  assertSecret,
} from "../src/config.ts";

const base = {
  operator: "browser",
  browserStrategy: "dom",
  desktopCoordinateSpace: "screen_pixels",
  provider: "openai",
  model: "gpt-x",
  maxSteps: 25,
  timeoutMs: 300000,
  approvalMode: "sensitive_actions",
  allowedDomains: ["example.com"],
  allowDownloads: false,
  allowClipboard: false,
  allowFileUpload: false,
};

test("valid configuration passes and normalizes domains", () => {
  const r = validateAgentConfiguration({ ...base, allowedDomains: ["Example.COM"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value?.allowedDomains, ["example.com"]);
});

test("computer operator is accepted explicitly", () => {
  const r = validateAgentConfiguration({ ...base, operator: "computer" });
  assert.equal(r.ok, true);
  assert.equal(r.value?.operator, "computer");
});

test("unknown operator is rejected", () => {
  const r = validateAgentConfiguration({ ...base, operator: "phone" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("invalid_operator"));
});

test("desktop coordinate protocols are explicit and legacy configs migrate to pixels", () => {
  const normalized = validateAgentConfiguration({
    ...base,
    desktopCoordinateSpace: "normalized_1000",
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.value?.desktopCoordinateSpace, "normalized_1000");

  const { desktopCoordinateSpace: _legacyField, ...legacy } = base;
  const migrated = validateAgentConfiguration(legacy);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.value?.desktopCoordinateSpace, "screen_pixels");

  const invalid = validateAgentConfiguration({
    ...base,
    desktopCoordinateSpace: "screen_percent",
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.includes("invalid_desktop_coordinate_space"));
});

test("invalid strategy / approval mode rejected", () => {
  assert.equal(validateAgentConfiguration({ ...base, browserStrategy: "vision" }).ok, false);
  assert.equal(validateAgentConfiguration({ ...base, approvalMode: "never" }).ok, false);
});

test("out-of-range steps and timeout rejected", () => {
  assert.equal(validateAgentConfiguration({ ...base, maxSteps: 0 }).ok, false);
  assert.equal(validateAgentConfiguration({ ...base, maxSteps: 9999 }).ok, false);
  assert.equal(validateAgentConfiguration({ ...base, timeoutMs: 10 }).ok, false);
  assert.equal(validateAgentConfiguration({ ...base, timeoutMs: 999999999 }).ok, false);
});

test("bad endpoint rejected, https accepted, omitted allowed", () => {
  assert.equal(validateAgentConfiguration({ ...base, endpoint: "ftp://x" }).ok, false);
  assert.equal(validateAgentConfiguration({ ...base, endpoint: "https://api.x/v1" }).ok, true);
  const noEndpoint = validateAgentConfiguration(base);
  assert.equal(noEndpoint.ok, true);
  assert.equal(noEndpoint.value?.endpoint, undefined);
});

test("non-boolean permission flags rejected", () => {
  assert.equal(validateAgentConfiguration({ ...base, allowDownloads: "yes" }).ok, false);
});

test("default configuration is valid and safe", () => {
  const def = defaultAgentConfiguration();
  assert.equal(def.approvalMode, "sensitive_actions");
  assert.equal(def.browserStrategy, "dom");
  assert.equal(def.desktopCoordinateSpace, "screen_pixels");
  assert.equal(def.allowDownloads, true);
});

test("resolveConfig rejects non-loopback host", () => {
  assert.throws(() => resolveConfig({ UI_TARS_ADAPTER_HOST: "0.0.0.0" } as NodeJS.ProcessEnv));
});

test("resolveConfig defaults to loopback + fake runtime", () => {
  const c = resolveConfig({} as NodeJS.ProcessEnv);
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.runtime, "fake");
});

test("assertSecret enforces a strong secret", () => {
  assert.throws(() => assertSecret({ ...resolveConfig({} as NodeJS.ProcessEnv), secret: "short" }));
  assert.doesNotThrow(() =>
    assertSecret({ ...resolveConfig({} as NodeJS.ProcessEnv), secret: "x".repeat(32) }),
  );
});

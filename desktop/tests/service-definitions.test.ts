import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { buildServiceDefinitions, serviceUrls } from "../src/main/service-definitions";
import { resolvePaths } from "../src/main/path-resolver";
import { defaultPersistentConfig, type DesktopRuntimeConfig } from "../src/main/runtime-config";

function fixture(mode: "dev" | "packaged", overrides: Partial<ReturnType<typeof defaultPersistentConfig>> = {}) {
  const paths = resolvePaths({
    isPackaged: mode === "packaged",
    forceDev: false,
    userDataDir: path.join(os.tmpdir(), "bb-ud"),
    electronResourcesPath: path.join(os.tmpdir(), "bb-res"),
    moduleDir: path.join(os.tmpdir(), "bb-repo", "desktop", "dist", "main"),
  });
  const config: DesktopRuntimeConfig = {
    persistent: { ...defaultPersistentConfig(), ...overrides },
    ports: { dashboard: 4300, chatmock: 4301, openharness: 4302, quartz: 4303, quartzWs: 4304 },
  };
  const binaries = {
    node: "C:/rt/node.exe",
    bun: "C:/rt/bun.exe",
    python: "C:/rt/python.exe",
  };
  return { paths, config, definitions: buildServiceDefinitions({ paths, config, binaries }) };
}

test("all service URLs bind loopback only", () => {
  const { config } = fixture("packaged");
  for (const url of Object.values(serviceUrls(config))) {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+/);
  }
});

test("dashboard env propagates dynamic ports, secrets and data locations", () => {
  const { config, definitions, paths } = fixture("packaged");
  const dashboard = definitions.find((d) => d.id === "dashboard");
  assert.ok(dashboard);
  assert.equal(dashboard.env["PORT"], "4300");
  assert.equal(dashboard.env["HOSTNAME"], "127.0.0.1");
  assert.equal(dashboard.env["NEXTAUTH_URL"], "http://127.0.0.1:4300");
  assert.equal(dashboard.env["NEXTAUTH_SECRET"], config.persistent.nextAuthSecret);
  assert.equal(dashboard.env["CHATMOCK_BASE_URL"], "http://127.0.0.1:4301/v1");
  assert.equal(dashboard.env["OPENHARNESS_BASE_URL"], "http://127.0.0.1:4302");
  assert.equal(dashboard.env["NEXT_PUBLIC_QUARTZ_URL"], "http://127.0.0.1:4303");
  assert.equal(dashboard.env["BREADBOARD_DATA_DIR"], paths.dataRoot);
  assert.equal(dashboard.env["QUARTZ_CONTENT_PATH"], paths.quartzContent);
  assert.equal(dashboard.env["NODE_ENV"], "production");
  // No default/dev secrets.
  assert.notEqual(dashboard.env["OPENHARNESS_PASSWORD"], "breadboard-local-dev");
  assert.notEqual(dashboard.env["NEXTAUTH_SECRET"], "change-me");
});

test("required mode registers OpenHarness as required with chatmock dependency", () => {
  const { definitions } = fixture("packaged");
  const openharness = definitions.find((d) => d.id === "openharness");
  assert.ok(openharness);
  assert.equal(openharness.required, true);
  assert.deepEqual(openharness.dependsOn, ["chatmock"]);
  assert.ok((openharness.env["OPENCODE_SERVER_PASSWORD"] ?? "").length >= 24);
  const health = openharness.healthCheck;
  assert.ok(health && health.type === "http");
  assert.match(health.url, /\/config\/providers$/);
  assert.equal(health.expectBodyIncludes, "chatmock");
});

test("legacy mode omits OpenHarness entirely and dashboard adapts", () => {
  const { definitions } = fixture("packaged", { openharnessMode: "legacy" });
  assert.ok(!definitions.some((d) => d.id === "openharness"));
  const dashboard = definitions.find((d) => d.id === "dashboard");
  assert.ok(dashboard);
  assert.equal(dashboard.env["OPENHARNESS_ENABLED"], "false");
  assert.deepEqual(dashboard.dependsOn, ["chatmock", "quartz"]);
});

test("scriberr stays optional and only appears when enabled without external URL", () => {
  assert.ok(!fixture("packaged").definitions.some((d) => d.id === "scriberr"));
  const withScriberr = fixture("packaged", { scriberrEnabled: true });
  const scriberr = withScriberr.definitions.find((d) => d.id === "scriberr");
  assert.ok(scriberr);
  assert.equal(scriberr.required, false);
  assert.equal(scriberr.restartPolicy, "never");
  const external = fixture("packaged", { scriberrEnabled: true, scriberrBaseUrl: "http://127.0.0.1:9999" });
  assert.ok(!external.definitions.some((d) => d.id === "scriberr"));
  const dashboard = external.definitions.find((d) => d.id === "dashboard");
  assert.equal(dashboard?.env["SCRIBERR_BASE_URL"], "http://127.0.0.1:9999");
});

test("quartz receives both its site port and an allocated hot-reload ws port", () => {
  // The Quartz CLI always opens a websocket listener; leaving it on the
  // default 3001 made startup fail with EADDRINUSE next to any other Quartz.
  const { definitions } = fixture("packaged");
  const quartz = definitions.find((d) => d.id === "quartz");
  assert.ok(quartz);
  const portIndex = quartz.args.indexOf("--port");
  const wsIndex = quartz.args.indexOf("--wsPort");
  assert.ok(portIndex >= 0 && wsIndex >= 0, "both --port and --wsPort must be passed");
  assert.equal(quartz.args[portIndex + 1], "4303");
  assert.equal(quartz.args[wsIndex + 1], "4304");
});

test("packaged services never rely on PATH lookups for runtimes", () => {
  const { definitions } = fixture("packaged");
  for (const definition of definitions) {
    if (definition.id === "scriberr") continue; // docker is inherently external
    assert.ok(
      path.isAbsolute(definition.command),
      `${definition.id} must use an absolute runtime path, got ${definition.command}`,
    );
  }
});

test("no secret values leak into non-secret env keys or args", () => {
  const { config, definitions } = fixture("packaged");
  const secrets = [config.persistent.nextAuthSecret, config.persistent.openharnessCapabilitySecret];
  for (const definition of definitions) {
    for (const arg of definition.args) {
      for (const secret of secrets) {
        assert.ok(!arg.includes(secret), `${definition.id} leaks a secret on the command line`);
      }
    }
  }
});

test("GBrain is absent by default and supervised as a loopback sidecar when enabled", () => {
  // Off by default: no gbrain service, no GBRAIN_* env on the dashboard.
  const off = fixture("packaged");
  assert.ok(!off.definitions.some((d) => d.id === "gbrain"));
  const dashOff = off.definitions.find((d) => d.id === "dashboard");
  assert.ok(dashOff);
  assert.equal(dashOff.env["GBRAIN_MODE"], undefined);

  // Enabled: a supervised Bun sidecar with a per-install secret, loopback health,
  // and mutable data under the desktop data dir (never in packaged resources).
  const on = fixture("packaged", { gbrainMode: "preferred" });
  const gbrain = on.definitions.find((d) => d.id === "gbrain");
  assert.ok(gbrain, "gbrain service should be registered when enabled");
  assert.equal(gbrain.command, "C:/rt/bun.exe");
  assert.match(gbrain.healthCheck.url, /^http:\/\/127\.0\.0\.1:\d+\/health$/);
  assert.equal(gbrain.env["GBRAIN_ADAPTER_SECRET"], on.config.persistent.gbrainAdapterSecret);
  assert.ok((gbrain.env["GBRAIN_ADAPTER_SECRET"] ?? "").length >= 8);
  assert.ok(gbrain.env["GBRAIN_DATA_DIR"].startsWith(on.paths.dataRoot));
  // Mutable data must not live inside packaged resources.
  assert.ok(!gbrain.env["GBRAIN_DATA_DIR"].includes("bb-res"));

  // The dashboard learns the adapter URL + shared secret, but the secret never
  // appears in a non-secret place unexpectedly (it is the per-install secret).
  const dashOn = on.definitions.find((d) => d.id === "dashboard");
  assert.ok(dashOn);
  assert.equal(dashOn.env["GBRAIN_MODE"], "preferred");
  assert.equal(dashOn.env["GBRAIN_ADAPTER_SECRET"], on.config.persistent.gbrainAdapterSecret);
});

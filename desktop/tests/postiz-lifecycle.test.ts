// Postiz must not start when Breadboard starts.
//
// These cover the supervisor half of that promise: what `startAll()` does with
// each startup policy, what the registered Postiz service actually is (a
// coordinator, not the stack), and where the per-launch capability token is
// allowed to appear.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { LogManager } from "../src/main/log-manager";
import {
  ServiceManager,
  startupPolicyOf,
  type DesktopServiceDefinition,
} from "../src/main/service-manager";
import { buildServiceDefinitions } from "../src/main/service-definitions";
import { resolvePaths } from "../src/main/path-resolver";
import {
  defaultPersistentConfig,
  mintLaunchSecrets,
  type DesktopRuntimeConfig,
} from "../src/main/runtime-config";

function newManager(): ServiceManager {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-postiz-logs-"));
  return new ServiceManager(new LogManager({ logsDir }));
}

function nodeService(
  id: string,
  script: string,
  overrides: Partial<DesktopServiceDefinition> = {},
): DesktopServiceDefinition {
  return {
    id,
    displayName: id,
    required: true,
    command: process.execPath,
    args: ["-e", script],
    cwd: os.tmpdir(),
    env: { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "" },
    startupTimeoutMs: 15_000,
    gracefulShutdownMs: 500,
    restartPolicy: "never",
    ...overrides,
  };
}

const HTTP_OK_SERVER = (port: number) =>
  `require("http").createServer((q,s)=>{s.end("ok")}).listen(${port},"127.0.0.1");setInterval(()=>{},1000)`;

/** Writes a marker file the moment it runs, so "did this ever start?" is provable. */
const MARKER_SERVER = (port: number, marker: string) =>
  `require("fs").writeFileSync(${JSON.stringify(marker)},"started");` + HTTP_OK_SERVER(port);

async function freePort(): Promise<number> {
  const { findFreePort } = await import("../src/main/ports");
  return findFreePort();
}

function desktopFixture(): DesktopRuntimeConfig {
  return {
    persistent: defaultPersistentConfig(),
    launchSecrets: mintLaunchSecrets(),
    ports: {
      dashboard: 4300,
      chatmock: 4301,
      hermes: 4305,
      postiz: 4306,
      quartz: 4303,
      quartzWs: 4304,
      voicebox: 4310,
    },
  };
}

function definitionsFor(mode: "dev" | "packaged" = "packaged") {
  const paths = resolvePaths({
    isPackaged: mode === "packaged",
    forceDev: false,
    userDataDir: path.join(os.tmpdir(), "bb-ud"),
    electronResourcesPath: path.join(os.tmpdir(), "bb-res"),
    moduleDir: path.join(os.tmpdir(), "bb-repo", "desktop", "dist", "main"),
  });
  const config = desktopFixture();
  const binaries = { node: "C:/rt/node.exe", bun: "C:/rt/bun.exe", python: "C:/rt/python.exe" };
  return { paths, config, definitions: buildServiceDefinitions({ paths, config, binaries }) };
}

// ------------------------------------------------------------ startup policy

test("the startup policy of a definition is explicit, not inferred from two flags", () => {
  assert.equal(startupPolicyOf({ required: true }), "eager");
  assert.equal(startupPolicyOf({ required: false }), "eager");
  assert.equal(startupPolicyOf({ required: false, startInBackground: true }), "background");
  assert.equal(
    startupPolicyOf({ required: false, startupPolicy: "on-demand" }),
    "on-demand",
  );
  // An explicit policy wins over the older flag rather than quietly disagreeing.
  assert.equal(
    startupPolicyOf({ required: false, startInBackground: true, startupPolicy: "on-demand" }),
    "on-demand",
  );
  // Startup readiness has to mean something, so a required service is eager
  // whatever else it says.
  assert.equal(
    startupPolicyOf({ required: true, startupPolicy: "on-demand" }),
    "eager",
  );
});

test("startAll never starts an on-demand service, and startService still can", async () => {
  const manager = newManager();
  const corePort = await freePort();
  const lazyPort = await freePort();
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bb-marker-")), "started");

  manager.register(
    nodeService("core", HTTP_OK_SERVER(corePort), {
      healthCheck: {
        type: "http",
        url: `http://127.0.0.1:${corePort}/`,
        timeoutMs: 1_000,
        intervalMs: 200,
      },
    }),
  );
  manager.register(
    nodeService("lazy", MARKER_SERVER(lazyPort, marker.replaceAll("\\", "\\\\")), {
      required: false,
      startupPolicy: "on-demand",
      healthCheck: {
        type: "http",
        url: `http://127.0.0.1:${lazyPort}/`,
        timeoutMs: 1_000,
        intervalMs: 200,
      },
    }),
  );

  await manager.startAll();
  assert.equal(manager.status("core").state, "healthy");
  // Not "failed", and not "healthy": it was never asked to run.
  assert.equal(manager.status("lazy").state, "pending");
  assert.equal(fs.existsSync(marker), false, "an on-demand service must not have executed");

  assert.equal(await manager.startService("lazy"), true);
  assert.equal(manager.status("lazy").state, "healthy");
  assert.equal(fs.existsSync(marker), true);

  await manager.stopAll();
});

test("startAll does not wait for a background service to become healthy", async () => {
  const manager = newManager();
  const corePort = await freePort();
  const slowPort = await freePort();
  manager.register(
    nodeService("core", HTTP_OK_SERVER(corePort), {
      healthCheck: {
        type: "http",
        url: `http://127.0.0.1:${corePort}/`,
        timeoutMs: 1_000,
        intervalMs: 200,
      },
    }),
  );
  manager.register(
    nodeService(
      "slow",
      `setTimeout(()=>{${HTTP_OK_SERVER(slowPort)}},3000);setInterval(()=>{},1000)`,
      {
        required: false,
        startupPolicy: "background",
        healthCheck: {
          type: "http",
          url: `http://127.0.0.1:${slowPort}/`,
          timeoutMs: 1_000,
          intervalMs: 200,
        },
      },
    ),
  );

  const startedAt = Date.now();
  await manager.startAll();
  assert.ok(
    Date.now() - startedAt < 2_500,
    "startAll must not have waited for the background service",
  );
  assert.notEqual(manager.status("slow").state, "healthy");
  await manager.stopAll();
});

test("a required service still fails startup, unchanged by the policy field", async () => {
  const manager = newManager();
  manager.register(nodeService("boom", "process.exit(3)"));
  await assert.rejects(() => manager.startAll(), /Required service "boom" failed/);
  await manager.stopAll();
});

// --------------------------------------------------- the registered service

test("Electron has no Postiz service definition or coordinator fallback", () => {
  const { definitions } = definitionsFor();
  assert.equal(definitions.some((definition) => definition.id === "postiz"), false);
  assert.equal(
    definitions.some((definition) =>
      definition.args.some((argument) => /start-postiz-supervisor\.mjs$/u.test(argument))),
    false,
  );
  const dashboard = definitions.find((definition) => definition.id === "dashboard");
  assert.ok(dashboard);
  assert.equal("POSTIZ_COORDINATOR_URL" in dashboard.env, false);
  assert.equal("POSTIZ_COORDINATOR_TOKEN" in dashboard.env, false);
});

test("no service definition asks Breadboard to run Docker at startup", () => {
  const { definitions } = definitionsFor();
  for (const definition of definitions) {
    assert.equal(
      /docker|wsl/i.test(path.basename(definition.command)),
      false,
      `${definition.id} must not launch a container engine`,
    );
    for (const arg of definition.args) {
      assert.equal(
        /^(docker|wsl)(\.exe)?$/i.test(path.basename(arg)),
        false,
        `${definition.id} must not launch a container engine`,
      );
    }
  }
});

test("Electron mints only its Runtime control capability", () => {
  assert.deepEqual(Object.keys(mintLaunchSecrets()), ["supervisorControlToken"]);
});

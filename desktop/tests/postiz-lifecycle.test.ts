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
import { buildServiceDefinitions, serviceUrls } from "../src/main/service-definitions";
import { resolvePaths } from "../src/main/path-resolver";
import {
  defaultPersistentConfig,
  mintLaunchSecrets,
  redactSecrets,
  redactedConfigSummary,
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
      postizSupervisor: 4307,
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

function find(definitions: DesktopServiceDefinition[], id: string): DesktopServiceDefinition {
  const found = definitions.find((definition) => definition.id === id);
  assert.ok(found, `expected a "${id}" service definition`);
  return found;
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

test("the registered Postiz service is the coordinator, not the container stack", () => {
  const { definitions } = definitionsFor();
  const postiz = find(definitions, "postiz");

  assert.equal(postiz.required, false);
  assert.equal(startupPolicyOf(postiz), "eager");
  // The entrypoint is the coordinator script; nothing here is a Docker command.
  assert.match(postiz.args.at(-1) ?? "", /start-postiz-supervisor\.mjs$/);
  assert.equal(
    postiz.args.some((arg) => /docker|compose/i.test(arg)),
    false,
  );
  assert.equal(/docker/i.test(postiz.command), false);
});

test("Postiz readiness means the coordinator answers, never that containers are up", () => {
  const { definitions } = definitionsFor();
  const postiz = find(definitions, "postiz");
  assert.equal(postiz.healthCheck?.type, "http");
  assert.match(postiz.healthCheck?.url ?? "", /^http:\/\/127\.0\.0\.1:\d+\/health$/);
  // The old contract required `"ready":true`, which the previous supervisor
  // only published after nine containers were running.
  assert.equal(postiz.healthCheck?.expectBodyIncludes, '"ok":true');
  // Seconds, not the twenty minutes a cold Docker start and image pull needed.
  assert.ok(
    postiz.startupTimeoutMs <= 60_000,
    `coordinator startup budget should be seconds, got ${postiz.startupTimeoutMs}ms`,
  );
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

// --------------------------------------------------------- capability secret

test("the coordinator token reaches the coordinator and the dashboard, and nothing else", () => {
  const { config, definitions } = definitionsFor();
  const token = config.launchSecrets?.postizCoordinatorToken ?? "";
  assert.ok(token.length >= 32);

  const holders = definitions.filter((definition) =>
    Object.values(definition.env).some((value) => value.includes(token)),
  );
  assert.deepEqual(
    holders.map((definition) => definition.id).sort(),
    ["dashboard", "postiz"],
  );
  assert.equal(find(definitions, "postiz").env["POSTIZ_COORDINATOR_TOKEN"], token);
  assert.equal(find(definitions, "dashboard").env["POSTIZ_COORDINATOR_TOKEN"], token);
  assert.match(
    find(definitions, "dashboard").env["POSTIZ_COORDINATOR_URL"] ?? "",
    /^http:\/\/127\.0\.0\.1:\d+$/,
  );
});

test("the coordinator token is redacted from logs and absent from the renderer summary", () => {
  const config = desktopFixture();
  const token = config.launchSecrets?.postizCoordinatorToken ?? "";
  const line = redactSecrets(
    `[postiz-coordinator] authorization: Bearer ${token}`,
    config.persistent,
    Object.values(config.launchSecrets ?? {}),
  );
  assert.equal(line.includes(token), false);
  assert.match(line, /\[redacted\]/);

  // The diagnostics summary is renderer-visible; nothing secret may be in it.
  assert.equal(JSON.stringify(redactedConfigSummary(config)).includes(token), false);
});

test("a fresh launch mints a different coordinator token", () => {
  assert.notEqual(
    mintLaunchSecrets().postizCoordinatorToken,
    mintLaunchSecrets().postizCoordinatorToken,
  );
});

test("the published endpoints file never carries the coordinator token", () => {
  const config = desktopFixture();
  const token = config.launchSecrets?.postizCoordinatorToken ?? "";
  // `serviceUrls` is exactly what app-lifecycle writes into endpoints.json.
  assert.equal(JSON.stringify(serviceUrls(config)).includes(token), false);
});

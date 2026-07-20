import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { LogManager } from "../src/main/log-manager";
import { ServiceManager, type DesktopServiceDefinition } from "../src/main/service-manager";
import { isProcessAlive } from "../src/main/process-tree";

function newManager(): { manager: ServiceManager; logsDir: string } {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-logs-"));
  const manager = new ServiceManager(new LogManager({ logsDir }));
  return { manager, logsDir };
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

async function freePort(): Promise<number> {
  const { findFreePort } = await import("../src/main/ports");
  return findFreePort();
}

test("startPlan orders dependencies into waves and rejects cycles", () => {
  const { manager } = newManager();
  manager.register(nodeService("a", ""));
  manager.register(nodeService("b", "", { dependsOn: ["a"] }));
  manager.register(nodeService("c", "", { dependsOn: ["a"] }));
  manager.register(nodeService("d", "", { dependsOn: ["b", "c"] }));
  const plan = manager.startPlan();
  assert.deepEqual(plan[0], ["a"]);
  assert.deepEqual(new Set(plan[1]), new Set(["b", "c"]));
  assert.deepEqual(plan[2], ["d"]);

  const cyclic = newManager().manager;
  cyclic.register(nodeService("x", "", { dependsOn: ["y"] }));
  cyclic.register(nodeService("y", "", { dependsOn: ["x"] }));
  assert.throws(() => cyclic.startPlan(), /cycle/i);

  const unknown = newManager().manager;
  unknown.register(nodeService("solo", "", { dependsOn: ["ghost"] }));
  assert.throws(() => unknown.startPlan(), /unknown service/i);
});

test("a service with an http health check becomes healthy and is tree-killed on stopAll", async () => {
  const { manager } = newManager();
  const port = await freePort();
  manager.register(
    nodeService("web", HTTP_OK_SERVER(port), {
      healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
    }),
  );
  await manager.startAll();
  const status = manager.status("web");
  assert.equal(status.state, "healthy");
  assert.ok(status.pid !== null);
  const pid = status.pid as number;
  await manager.stopAll();
  assert.equal(manager.status("web").state, "stopped");
  // The OS may need a moment to reap.
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(isProcessAlive(pid), false);
});

test("required service failure rejects startAll; optional failure does not", async () => {
  {
    const { manager } = newManager();
    manager.register(nodeService("dies", "process.exit(3)", { startupTimeoutMs: 4000 }));
    await assert.rejects(() => manager.startAll(), /dies/);
  }
  {
    const { manager } = newManager();
    const port = await freePort();
    manager.register(
      nodeService("ok", HTTP_OK_SERVER(port), {
        healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
      }),
    );
    manager.register(
      nodeService("flaky-optional", "process.exit(5)", {
        required: false,
        startupTimeoutMs: 4000,
      }),
    );
    await manager.startAll();
    assert.equal(manager.status("ok").state, "healthy");
    assert.equal(manager.status("flaky-optional").state, "failed");
    await manager.stopAll();
  }
});

test("health check timeout marks the service failed and kills it", async () => {
  const { manager } = newManager();
  const port = await freePort();
  // Server that never answers healthily (immediate 500s).
  manager.register(
    nodeService(
      "unhealthy",
      `require("http").createServer((q,s)=>{s.statusCode=500;s.end()}).listen(${port},"127.0.0.1");setInterval(()=>{},1000)`,
      {
        required: false,
        healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 500, intervalMs: 100 },
        startupTimeoutMs: 1_500,
      },
    ),
  );
  await manager.startAll();
  const status = manager.status("unhealthy");
  assert.equal(status.state, "failed");
  assert.match(status.lastError ?? "", /timed out/);
});

test("dependents of a failed dependency fail with a clear reason", async () => {
  const { manager } = newManager();
  manager.register(nodeService("base", "process.exit(1)", { required: false, startupTimeoutMs: 3000 }));
  manager.register(nodeService("child", "setInterval(()=>{},1000)", { required: false, dependsOn: ["base"] }));
  await manager.startAll();
  assert.equal(manager.status("child").state, "failed");
  assert.match(manager.status("child").lastError ?? "", /dependency "base"/);
});

test("restart-on-failure restarts a crashed healthy service and caps the loop", async () => {
  const { manager } = newManager();
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bb-restart-")), "count.txt");
  // Service dies 300ms after becoming "healthy" (no health check => healthy
  // after grace period).
  manager.register(
    nodeService(
      "crashy",
      `const fs=require("fs");fs.appendFileSync(${JSON.stringify(marker)},"x");setTimeout(()=>process.exit(9),700)`,
      { required: false, restartPolicy: "on-failure" },
    ),
  );
  await manager.startAll();
  assert.equal(manager.status("crashy").state, "healthy");
  // Wait for a few crash/restart cycles: cap is 3 restarts in the window.
  await new Promise((resolve) => setTimeout(resolve, 12_000));
  const runs = fs.readFileSync(marker, "utf8").length;
  assert.ok(runs >= 2, `expected at least one restart, saw ${runs} runs`);
  assert.ok(runs <= 4, `restart cap exceeded: ${runs} runs`);
  await manager.stopAll();
});

test("stopAll shuts down in reverse dependency order", async () => {
  const { manager } = newManager();
  const events: string[] = [];
  manager.on("state-changed", (status) => {
    if (status.state === "stopping") events.push(status.id);
  });
  const portA = await freePort();
  const portB = await freePort();
  manager.register(
    nodeService("first", HTTP_OK_SERVER(portA), {
      healthCheck: { type: "http", url: `http://127.0.0.1:${portA}/`, timeoutMs: 1000, intervalMs: 200 },
    }),
  );
  manager.register(
    nodeService("second", HTTP_OK_SERVER(portB), {
      dependsOn: ["first"],
      healthCheck: { type: "http", url: `http://127.0.0.1:${portB}/`, timeoutMs: 1000, intervalMs: 200 },
    }),
  );
  await manager.startAll();
  await manager.stopAll();
  assert.deepEqual(events, ["second", "first"]);
});

test("grandchild processes are terminated with the tree", async () => {
  const { manager } = newManager();
  const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bb-tree-")), "grandchild.pid");
  const port = await freePort();
  // Parent spawns a detached-ish grandchild and then serves HTTP.
  const script =
    `const {spawn}=require("child_process");const fs=require("fs");` +
    `const g=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});` +
    `fs.writeFileSync(${JSON.stringify(pidFile)},String(g.pid));` +
    `require("http").createServer((q,s)=>{s.end("ok")}).listen(${port},"127.0.0.1");setInterval(()=>{},1000)`;
  manager.register(
    nodeService("parent", script, {
      healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
    }),
  );
  await manager.startAll();
  const grandchildPid = Number(fs.readFileSync(pidFile, "utf8"));
  assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0);
  assert.equal(isProcessAlive(grandchildPid), true);
  await manager.stopAll();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(isProcessAlive(grandchildPid), false);
});

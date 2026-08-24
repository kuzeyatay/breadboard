import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { LogManager } from "../src/main/log-manager";
import {
  ServiceManager,
  SourceChangeVerifier,
  watchedSourceFilename,
  type DesktopServiceDefinition,
} from "../src/main/service-manager";
import type {
  ProcessMemorySample,
  ProcessMetricsProvider,
  ResourceBreach,
  ServiceResourceBudget,
} from "../src/main/resource-monitor";
import type { MemoryPolicy, SystemMemorySnapshot } from "../src/main/memory-policy";
import { isProcessAlive } from "../src/main/process-tree";

function newManager(): { manager: ServiceManager; logsDir: string } {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-logs-"));
  const manager = new ServiceManager(new LogManager({ logsDir }));
  return { manager, logsDir };
}

const constrainedPolicy: MemoryPolicy = {
  dashboardDevHeapMb: 6_144,
  dashboardTreeSoftLimitMb: 11_264,
  dashboardTreeHardLimitMb: 13_312,
  minFreeCommitMb: 8_000,
  criticalFreeCommitMb: 4_000,
  emergencyFreeCommitMb: 2_000,
  sampleIntervalMs: 3_600_000,
  recoveryHysteresisMb: 500,
};

function governedManager(freeCommitMb: number): { manager: ServiceManager; logsDir: string } {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-logs-"));
  const snapshot: SystemMemorySnapshot = {
    sampledAt: Date.now(),
    commitTotalMb: 42_000 - freeCommitMb,
    commitLimitMb: 42_000,
    physicalTotalMb: 32_000,
    physicalAvailableMb: 4_000,
  };
  const manager = new ServiceManager(new LogManager({ logsDir }), {
    memoryPolicy: constrainedPolicy,
    systemMetrics: { async sample() { return snapshot; } },
  });
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

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition was not met before timeout");
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

test("on-demand leases single-flight startup, protect active work, idle-stop, and restart", async () => {
  const { manager } = newManager();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-on-demand-"));
  const startsPath = path.join(stateDir, "starts.ndjson");
  manager.register(
    nodeService(
      "lazy",
      `require("fs").appendFileSync(${JSON.stringify(startsPath)}, JSON.stringify({pid:process.pid})+"\\n");setInterval(()=>{},1000)`,
      {
        required: false,
        startPolicy: "on-demand",
        idleTtlMs: 150,
      },
    ),
  );

  try {
    await manager.startAll();
    assert.equal(manager.status("lazy").state, "pending", "startup must leave optional work cold");
    assert.equal(fs.existsSync(startsPath), false);

    const leases = await Promise.all(
      Array.from({ length: 10 }, (_, index) => manager.acquireServiceLease("lazy", `request-${index}`)),
    );
    const firstPid = manager.status("lazy").pid;
    assert.ok(typeof firstPid === "number");
    assert.equal(manager.status("lazy").activeLeases, 10);
    assert.equal(fs.readFileSync(startsPath, "utf8").trim().split("\n").length, 1);

    for (const lease of leases.slice(0, -1)) lease.release();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(manager.status("lazy").state, "healthy", "one active lease must prevent idle shutdown");
    assert.equal(isProcessAlive(firstPid as number), true);

    leases.at(-1)?.release();
    await waitUntil(() => manager.status("lazy").state === "stopped", 10_000);
    await waitUntil(() => !isProcessAlive(firstPid as number), 10_000);

    const restarted = await manager.acquireServiceLease("lazy", "next-use");
    const secondPid = manager.status("lazy").pid;
    assert.ok(typeof secondPid === "number");
    assert.notEqual(secondPid, firstPid);
    assert.equal(fs.readFileSync(startsPath, "utf8").trim().split("\n").length, 2);
    restarted.release();
  } finally {
    await manager.stopAll();
  }
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

test("a background optional service does not hold startup open", async () => {
  const { manager } = newManager();
  manager.register(
    nodeService("slow-optional", "setInterval(()=>{},1000)", {
      required: false,
      startInBackground: true,
      healthCheck: {
        type: "http",
        url: "http://127.0.0.1:1/health",
        timeoutMs: 100,
        intervalMs: 100,
      },
      startupTimeoutMs: 10_000,
    }),
  );

  const startedAt = Date.now();
  await manager.startAll();
  assert.ok(Date.now() - startedAt < 1_000, "background startup should return immediately");
  assert.equal(manager.status("slow-optional").state, "starting");
  await manager.stopAll();
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

test("a supervised development service reloads when its integration source changes", async () => {
  const { manager } = newManager();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-reload-"));
  const watched = path.join(root, "integration.py");
  const starts = path.join(root, "starts.txt");
  fs.writeFileSync(watched, "first");

  manager.register(
    nodeService(
      "reloadable",
      `require("fs").appendFileSync(${JSON.stringify(starts)}, String(process.pid) + "\\n");setInterval(()=>{},1000)`,
      { required: false, restartOnChange: [watched] },
    ),
  );

  try {
    await manager.startAll();
    const firstPid = manager.status("reloadable").pid;
    assert.ok(firstPid);

    fs.writeFileSync(watched, "second");
    await waitUntil(() => {
      const status = manager.status("reloadable");
      return status.state === "healthy" && status.restarts === 1 && status.pid !== firstPid;
    });

    const recordedStarts = fs.readFileSync(starts, "utf8").trim().split(/\r?\n/);
    assert.equal(recordedStarts.length, 2);
  } finally {
    await manager.stopAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source restarts require a verified byte change, including ambiguous watcher events", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-verifier-"));
  const watched = path.join(root, "integration.py");
  fs.writeFileSync(watched, "first");
  const verifier = new SourceChangeVerifier([watched]);

  assert.equal(watchedSourceFilename(null), null);
  assert.equal(watchedSourceFilename(""), null);
  assert.equal(watchedSourceFilename(Buffer.alloc(0)), null);
  assert.equal(watchedSourceFilename(Buffer.from("integration.py")), "integration.py");
  assert.equal(
    watchedSourceFilename("CATALOG.PY"),
    process.platform === "win32" ? "catalog.py" : "CATALOG.PY",
  );

  assert.deepEqual(verifier.changedPaths(null), []);
  assert.deepEqual(verifier.changedPaths("integration.py"), []);
  assert.deepEqual(verifier.changedPaths("unrelated.py"), []);

  fs.writeFileSync(watched, "second");
  assert.deepEqual(verifier.changedPaths(null), [watched]);
  assert.deepEqual(verifier.changedPaths(null), []);

  fs.writeFileSync(watched, "third");
  assert.deepEqual(verifier.changedPaths(Buffer.from("integration.py")), [watched]);
  fs.rmSync(root, { recursive: true, force: true });
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

// --- memory budget containment -----------------------------------------------

/**
 * A metrics provider driven entirely by the test. Real process trees are never
 * measured here, so these assertions do not depend on the host's memory.
 */
function fakeMetrics(bytesFor: (pid: number) => number | undefined): ProcessMetricsProvider {
  return {
    async sample(rootPids: number[]): Promise<Map<number, ProcessMemorySample>> {
      const result = new Map<number, ProcessMemorySample>();
      for (const pid of rootPids) {
        const bytes = bytesFor(pid);
        if (bytes === undefined) continue;
        result.set(pid, {
          pid,
          rssBytes: bytes,
          privateBytes: bytes,
          descendantCount: 1,
          treeRssBytes: bytes,
          treePrivateBytes: bytes,
          sampledAt: Date.now(),
        });
      }
      return result;
    },
  };
}

const MB = 1024 * 1024;

function budgetOf(overrides: Partial<ServiceResourceBudget> = {}): ServiceResourceBudget {
  return {
    warningBytes: 100 * MB,
    hardLimitBytes: 200 * MB,
    consecutiveSamplesBeforeAction: 2,
    sampleIntervalMs: 3_600_000,
    ...overrides,
  };
}

function managerWithMetrics(provider: ProcessMetricsProvider): {
  manager: ServiceManager;
  logsDir: string;
} {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-logs-"));
  const manager = new ServiceManager(new LogManager({ logsDir }), {
    metricsProvider: provider,
    // Keep the background loop effectively idle; tests drive sampling directly.
    resourceSampleIntervalMs: 3_600_000,
  });
  return { manager, logsDir };
}

test("a transient spike is tolerated, but a sustained breach fails without retry", async () => {
  let bytes = 10 * MB;
  const { manager, logsDir } = managerWithMetrics(fakeMetrics(() => bytes));
  const port = await freePort();
  manager.register(
    nodeService("hungry", HTTP_OK_SERVER(port), {
      required: false,
      restartPolicy: "on-failure",
      healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
      resourceBudget: budgetOf(),
    }),
  );
  try {
    await manager.startAll();
    const firstPid = manager.status("hungry").pid;
    assert.ok(firstPid);
    assert.deepEqual(manager.monitoredServiceIds(), ["hungry"]);

    // One sample far above the hard limit, then back down: no action.
    bytes = 900 * MB;
    await manager.sampleResourcesNow();
    bytes = 10 * MB;
    await manager.sampleResourcesNow();
    await manager.sampleResourcesNow();
    assert.equal(manager.status("hungry").state, "healthy");
    assert.equal(manager.status("hungry").pid, firstPid);
    assert.equal(manager.status("hungry").restarts, 0);

    // Two consecutive samples above the hard limit: contained.
    bytes = 900 * MB;
    await manager.sampleResourcesNow();
    await manager.sampleResourcesNow();

    await waitUntil(() => manager.status("hungry").state === "failed", 20_000);
    assert.equal(isProcessAlive(firstPid as number), false, "the old tree must be gone");
    assert.equal(manager.status("hungry").restarts, 0, "resource exhaustion is never blindly retried");
    assert.match(manager.status("hungry").lastError ?? "", /memory budget/);

    const log = fs.readFileSync(path.join(logsDir, "hungry.log"), "utf8");
    assert.match(log, /memory hard-limit for "hungry"/);
    assert.match(log, /threshold=200MB/);
  } finally {
    await manager.stopAll();
  }
});

test("a sustained warning is logged once without restarting the service", async () => {
  const { manager, logsDir } = managerWithMetrics(fakeMetrics(() => 150 * MB));
  const port = await freePort();
  const breaches: ResourceBreach[] = [];
  manager.register(
    nodeService("warned", HTTP_OK_SERVER(port), {
      required: false,
      healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
      resourceBudget: budgetOf(),
    }),
  );
  manager.on("resource-breach", (breach: ResourceBreach) => breaches.push(breach));
  try {
    await manager.startAll();
    const pid = manager.status("warned").pid;
    for (let index = 0; index < 8; index += 1) await manager.sampleResourcesNow();

    assert.equal(manager.status("warned").state, "healthy", "a warning must not restart");
    assert.equal(manager.status("warned").pid, pid);
    assert.equal(breaches.length, 1, `expected one warning, got ${breaches.length}`);
    assert.equal(breaches[0]?.kind, "warning");

    const log = fs.readFileSync(path.join(logsDir, "warned.log"), "utf8");
    assert.equal((log.match(/memory warning/g) ?? []).length, 1);
  } finally {
    await manager.stopAll();
  }
});

test("a resource kill terminates the whole descendant tree", async () => {
  const grandchildFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bb-rtree-")), "g.pid");
  const port = await freePort();
  let bytes = 10 * MB;
  const { manager } = managerWithMetrics(fakeMetrics(() => bytes));
  const script =
    `const {spawn}=require("child_process");const fs=require("fs");` +
    `const g=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});` +
    `fs.writeFileSync(${JSON.stringify(grandchildFile)},String(g.pid));` +
    `require("http").createServer((q,s)=>{s.end("ok")}).listen(${port},"127.0.0.1");setInterval(()=>{},1000)`;
  manager.register(
    nodeService("treeful", script, {
      required: false,
      restartPolicy: "never",
      healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
      resourceBudget: budgetOf(),
    }),
  );
  try {
    await manager.startAll();
    const grandchildPid = Number(fs.readFileSync(grandchildFile, "utf8"));
    assert.equal(isProcessAlive(grandchildPid), true);

    bytes = 900 * MB;
    await manager.sampleResourcesNow();
    await manager.sampleResourcesNow();

    await waitUntil(() => !isProcessAlive(grandchildPid), 20_000);
    assert.equal(isProcessAlive(grandchildPid), false, "no orphan descendants");
  } finally {
    await manager.stopAll();
  }
});

test("a required service that breaches its hard budget fails once and does not retry", async () => {
  const { manager } = managerWithMetrics(fakeMetrics(() => 900 * MB));
  const fatals: Array<{ id: string; reason: string }> = [];
  manager.register(
    nodeService("greedy", "setInterval(()=>{},1000)", {
      required: true,
      restartPolicy: "on-failure",
      resourceBudget: budgetOf({ consecutiveSamplesBeforeAction: 1 }),
    }),
  );
  manager.on("fatal", (id: string, reason: string) => fatals.push({ id, reason }));
  try {
    await manager.startAll();
    // A memory-pressure termination is terminal for this attempt. Repeating
    // the same allocation automatically is not recovery.
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && manager.status("greedy").state !== "failed") {
      await manager.sampleResourcesNow();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const status = manager.status("greedy");
    assert.equal(status.state, "failed", `expected a clear fatal state, got ${status.state}`);
    assert.match(status.lastError ?? "", /memory budget/);
    assert.equal(status.restarts, 0);
    assert.ok(
      fatals.some((entry) => entry.id === "greedy"),
      "a required service must report fatal",
    );
  } finally {
    await manager.stopAll();
  }
});

test("an optional service breaching its budget leaves unrelated services alone", async () => {
  const portGood = await freePort();
  const portBad = await freePort();
  let badBytes = 10 * MB;
  let badPid: number | null = null;
  const { manager } = managerWithMetrics(
    fakeMetrics((pid) => (badPid !== null && pid === badPid ? badBytes : 10 * MB)),
  );
  manager.register(
    nodeService("good", HTTP_OK_SERVER(portGood), {
      required: true,
      healthCheck: {
        type: "http",
        url: `http://127.0.0.1:${portGood}/`,
        timeoutMs: 1000,
        intervalMs: 200,
      },
      resourceBudget: budgetOf(),
    }),
  );
  manager.register(
    nodeService("bad", HTTP_OK_SERVER(portBad), {
      required: false,
      restartPolicy: "never",
      healthCheck: {
        type: "http",
        url: `http://127.0.0.1:${portBad}/`,
        timeoutMs: 1000,
        intervalMs: 200,
      },
      resourceBudget: budgetOf(),
    }),
  );
  try {
    await manager.startAll();
    const goodPid = manager.status("good").pid;
    badPid = manager.status("bad").pid;
    badBytes = 900 * MB;
    await manager.sampleResourcesNow();
    await manager.sampleResourcesNow();

    await waitUntil(() => manager.status("bad").state === "failed", 20_000);
    assert.equal(manager.status("good").state, "healthy", "an unrelated service must survive");
    assert.equal(manager.status("good").pid, goodPid);
  } finally {
    await manager.stopAll();
  }
});

test("monitoring stops after stopService, restart and stopAll", async () => {
  const { manager } = managerWithMetrics(fakeMetrics(() => 10 * MB));
  const portA = await freePort();
  const portB = await freePort();
  manager.register(
    nodeService("alpha", HTTP_OK_SERVER(portA), {
      required: false,
      healthCheck: { type: "http", url: `http://127.0.0.1:${portA}/`, timeoutMs: 1000, intervalMs: 200 },
      resourceBudget: budgetOf(),
    }),
  );
  manager.register(
    nodeService("beta", HTTP_OK_SERVER(portB), {
      required: false,
      healthCheck: { type: "http", url: `http://127.0.0.1:${portB}/`, timeoutMs: 1000, intervalMs: 200 },
      resourceBudget: budgetOf(),
    }),
  );
  await manager.startAll();
  assert.deepEqual(manager.monitoredServiceIds().sort(), ["alpha", "beta"]);

  // stopService() drops that service's monitor and leaves the other one.
  await manager.stopService("alpha");
  assert.deepEqual(manager.monitoredServiceIds(), ["beta"]);

  // Restarting re-registers a monitor, and never for the old pid.
  const oldPid = manager.status("beta").pid;
  await manager.stopService("beta");
  assert.deepEqual(manager.monitoredServiceIds(), []);
  await manager.startService("beta");
  assert.deepEqual(manager.monitoredServiceIds(), ["beta"]);
  assert.notEqual(manager.status("beta").pid, oldPid);

  await manager.stopAll();
  assert.deepEqual(manager.monitoredServiceIds(), []);
});

test("monitoring stops when a service exits on its own", async () => {
  const { manager } = managerWithMetrics(fakeMetrics(() => 10 * MB));
  manager.register(
    nodeService("shortlived", "setTimeout(()=>process.exit(0),700)", {
      required: false,
      restartPolicy: "never",
      resourceBudget: budgetOf(),
    }),
  );
  try {
    await manager.startAll();
    assert.deepEqual(manager.monitoredServiceIds(), ["shortlived"]);
    await waitUntil(() => manager.status("shortlived").state === "failed", 10_000);
    assert.deepEqual(manager.monitoredServiceIds(), [], "a dead pid must not stay watched");
  } finally {
    await manager.stopAll();
  }
});

test("a service with no declared budget is never monitored", async () => {
  const { manager } = managerWithMetrics(fakeMetrics(() => 900 * MB));
  const port = await freePort();
  manager.register(
    nodeService("unbudgeted", HTTP_OK_SERVER(port), {
      required: false,
      healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
    }),
  );
  try {
    await manager.startAll();
    assert.deepEqual(manager.monitoredServiceIds(), []);
    for (let index = 0; index < 5; index += 1) await manager.sampleResourcesNow();
    assert.equal(manager.status("unbudgeted").state, "healthy");
    assert.equal(manager.status("unbudgeted").restarts, 0);
  } finally {
    await manager.stopAll();
  }
});

test("an adopted service reuses the running instance instead of spawning one", async () => {
  // The whole point: something is already serving this port, so startup must
  // not put a second copy of the same service behind it.
  const port = await freePort();
  const server = http.createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { manager } = newManager();
  let spawned = false;
  manager.register(
    nodeService("adoptable", `process.stdout.write("spawned");setInterval(()=>{},1000)`, {
      adoptExternal: true,
      healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
    }),
  );
  manager.on("log-line", (_id, line) => {
    if (line.includes("spawned")) spawned = true;
  });
  try {
    assert.equal(await manager.startService("adoptable"), true);
    const status = manager.status("adoptable");
    assert.equal(status.state, "healthy");
    assert.equal(status.adopted, true);
    assert.equal(status.pid, null);
    assert.equal(spawned, false);
  } finally {
    await manager.stopAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("adoption is confirmed before cold-start memory admission", async () => {
  const port = await freePort();
  const server = http.createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  // 9 GB of headroom cannot preserve the 8 GB reserve while cold-starting a
  // 6 GB tree. It is nevertheless safe to reuse the already-running server.
  const { manager } = governedManager(9_000);
  manager.register(
    nodeService("hot-dashboard", `setInterval(()=>{},1000)`, {
      adoptExternal: true,
      estimatedColdStartCommitMb: 6_000,
      healthCheck: {
        type: "http",
        url: `http://127.0.0.1:${port}/`,
        timeoutMs: 1_000,
        intervalMs: 200,
      },
    }),
  );
  try {
    assert.equal(await manager.startService("hot-dashboard"), true);
    assert.equal(manager.status("hot-dashboard").state, "healthy");
    assert.equal(manager.status("hot-dashboard").adopted, true);
    assert.equal(manager.status("hot-dashboard").pid, null);
  } finally {
    await manager.stopAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("required admission rejection becomes a visible failed service", async () => {
  const { manager } = governedManager(9_000);
  manager.register(
    nodeService("cold-dashboard", `setInterval(()=>{},1000)`, {
      estimatedColdStartCommitMb: 6_000,
    }),
  );
  try {
    await assert.rejects(() => manager.startAll(), /Required service "cold-dashboard" failed/);
    const status = manager.status("cold-dashboard");
    assert.equal(status.state, "failed");
    assert.equal(status.pid, null);
    assert.match(status.lastError ?? "", /^BREADBOARD_RESOURCE_EXHAUSTED:/);
    assert.match(status.lastError ?? "", /14000 MB is required/);
  } finally {
    await manager.stopAll();
  }
});

test("stopping an adopted service leaves the process it did not start alone", async () => {
  const port = await freePort();
  const server = http.createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { manager } = newManager();
  manager.register(
    nodeService("adoptable", `setInterval(()=>{},1000)`, {
      adoptExternal: true,
      healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
    }),
  );
  try {
    await manager.startService("adoptable");
    await manager.stopService("adoptable");
    assert.equal(manager.status("adoptable").state, "stopped");
    // Still serving: stopping Breadboard must not take down the stack that
    // owns this process.
    assert.equal(server.listening, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a service marked adoptable still starts when nothing is running", async () => {
  // The instance can die between the startup probe and the actual start; the
  // supervisor must fall back to a normal spawn rather than report a phantom.
  const port = await freePort();
  const { manager } = newManager();
  manager.register(
    nodeService("adoptable", HTTP_OK_SERVER(port), {
      adoptExternal: true,
      healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
    }),
  );
  try {
    assert.equal(await manager.startService("adoptable"), true);
    const status = manager.status("adoptable");
    assert.equal(status.adopted, false);
    assert.ok(typeof status.pid === "number");
  } finally {
    await manager.stopAll();
  }
});

test("adoptionCheck decides adoption when it is stricter than the health check", async () => {
  // Hermes's shape: a public endpoint answers everyone, so adoption has to
  // hang off a gated one that a foreign instance fails.
  const port = await freePort();
  const server = http.createServer((request, response) => {
    if (request.url === "/gated" && request.headers.authorization !== "Bearer ours") {
      response.statusCode = 401;
      response.end("no");
      return;
    }
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { manager } = newManager();
  manager.register(
    nodeService("stranger", `setInterval(()=>{},1000)`, {
      adoptExternal: true,
      healthCheck: { type: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000, intervalMs: 200 },
      adoptionCheck: {
        type: "http",
        url: `http://127.0.0.1:${port}/gated`,
        headers: { Authorization: "Bearer theirs" },
        timeoutMs: 1000,
      },
    }),
  );
  try {
    // The port is taken by a foreign instance, so our own start cannot become
    // healthy either — what matters is that it was never adopted.
    await manager.startService("stranger");
    assert.equal(manager.status("stranger").adopted, false);
  } finally {
    await manager.stopAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

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
  type ServiceManagerOptions,
} from "../src/main/service-manager";
import type {
  ProcessMemorySample,
  ProcessMetricsProvider,
  ResourceBreach,
  ServiceResourceBudget,
} from "../src/main/resource-monitor";
import type { MemoryPolicy, SystemMemorySnapshot } from "../src/main/memory-policy";
import {
  MemoryGovernor,
  ResourceExhaustionError,
  type AdmissionRequest,
  type MemoryRefreshOptions,
} from "../src/main/memory-governor";
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

function mutableGovernedManager(
  initialFreeCommitMb: number,
  options: Pick<ServiceManagerOptions, "minimumLeaseMs"> = {},
): {
  manager: ServiceManager;
  logsDir: string;
  setFreeCommitMb(value: number): void;
  sampleCount(): number;
  resetSampleCount(): void;
} {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-logs-"));
  let freeCommitMb = initialFreeCommitMb;
  let samples = 0;
  const manager = new ServiceManager(new LogManager({ logsDir }), {
    memoryPolicy: constrainedPolicy,
    ...options,
    systemMetrics: {
      async sample() {
        samples += 1;
        return {
          sampledAt: Date.now(),
          commitTotalMb: 42_000 - freeCommitMb,
          commitLimitMb: 42_000,
          physicalTotalMb: 32_000,
          physicalAvailableMb: 4_000,
        };
      },
    },
  });
  return {
    manager,
    logsDir,
    setFreeCommitMb(value) { freeCommitMb = value; },
    sampleCount() { return samples; },
    resetSampleCount() { samples = 0; },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function memoryGovernorOf(manager: ServiceManager): MemoryGovernor {
  const governor = (manager as unknown as { governor: MemoryGovernor | null }).governor;
  if (!governor) throw new Error("test requires a governed ServiceManager");
  return governor;
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

test("an eager but idle runtime does not occupy a heavyweight concurrency group", async () => {
  const { manager, logsDir } = governedManager(15_000);
  manager.register(
    nodeService("runtime", "setInterval(()=>{},1000)", {
      startPolicy: "eager",
      estimatedColdStartCommitMb: 0,
      concurrencyGroup: "large-generation",
    }),
  );
  manager.register(
    nodeService("browser", "setInterval(()=>{},1000)", {
      required: false,
      startPolicy: "on-demand",
      estimatedColdStartCommitMb: 4_000,
      priority: 90,
      concurrencyGroup: "browser-automation",
    }),
  );

  try {
    await manager.startAll();
    assert.equal(manager.status("runtime").state, "healthy");
    assert.equal(manager.status("runtime").activeLeases, 0);

    // 15 GiB is enough for the browser's reserve + one estimate, but not the
    // doubled overlap requirement. This can pass only if the idle runtime is
    // correctly excluded from active heavyweight work.
    const lease = await manager.acquireServiceLease("browser", "test-browser-run");
    assert.equal(manager.status("browser").state, "healthy");
    lease.release();
  } finally {
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("parallel startup admissions are serialized until prior commit is observable", async () => {
  const runtime = mutableGovernedManager(15_000);
  const { manager, logsDir } = runtime;
  manager.register(nodeService("first", "setInterval(()=>{},1000)", {
    estimatedColdStartCommitMb: 6_000,
    priority: 100,
  }));
  manager.register(nodeService("second", "setInterval(()=>{},1000)", {
    estimatedColdStartCommitMb: 6_000,
    priority: 90,
  }));
  manager.on("state-changed", (status) => {
    if (status.id === "first" && status.state === "healthy") {
      // The first tree has materialized its allocation. The second applicant
      // must sample this value rather than spending the first one's stale
      // 15 GB pre-start view.
      runtime.setFreeCommitMb(9_000);
    }
  });

  try {
    await assert.rejects(() => manager.startAll(), /Required service "second" failed/);
    assert.equal(manager.status("first").state, "healthy");
    assert.equal(manager.status("second").state, "failed");
    assert.equal(manager.status("second").pid, null);
  } finally {
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("capability admission reclaims an explicit owned tree once and restores it on release", async () => {
  const runtime = mutableGovernedManager(12_000);
  const { manager, logsDir } = runtime;
  manager.register(nodeService("reclaimable", "setInterval(()=>{},1000)", {
    required: false,
    startPolicy: "eager",
    estimatedColdStartCommitMb: 0,
    priority: 70,
    pressureSheddable: true,
  }));
  manager.registerCapability({
    id: "foreground-job",
    estimatedColdStartCommitMb: 3_000,
    priority: 70,
    reserveFloor: "critical",
    concurrencyGroup: "large-generation",
  });
  manager.on("state-changed", (status) => {
    if (status.id === "reclaimable" && status.state === "stopped") {
      runtime.setFreeCommitMb(7_500);
    }
  });

  try {
    await manager.startAll();
    assert.equal(manager.status("reclaimable").state, "healthy");
    runtime.setFreeCommitMb(6_500);
    runtime.resetSampleCount();

    const lease = await manager.acquireCapabilityLease("foreground-job", "test-reclaim");
    assert.equal(runtime.sampleCount(), 2, "one failed sample plus one post-reclaim sample");
    assert.equal(manager.status("reclaimable").state, "stopped");
    assert.deepEqual(manager.activeLeaseSummary(), [{ targetId: "foreground-job", count: 1 }]);

    // The foreground allocation is gone before restoration starts.
    runtime.setFreeCommitMb(12_000);
    lease.release();
    await waitUntil(() => manager.status("reclaimable").state === "healthy");
    assert.deepEqual(manager.activeLeaseSummary(), []);
  } finally {
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("every overlapping capability holds a reclaimed service in either release order", async () => {
  for (const releaseFirst of ["original", "overlap"] as const) {
    const runtime = mutableGovernedManager(12_000);
    const { manager, logsDir } = runtime;
    manager.register(nodeService("reclaimable", "setInterval(()=>{},1000)", {
      required: false,
      startPolicy: "eager",
      estimatedColdStartCommitMb: 0,
      priority: 70,
      pressureSheddable: true,
    }));
    manager.registerCapability({
      id: "original-job",
      estimatedColdStartCommitMb: 3_000,
      priority: 90,
      reserveFloor: "critical",
      concurrencyGroup: "large-generation",
    });
    manager.registerCapability({
      id: "overlap-job",
      estimatedColdStartCommitMb: 3_000,
      priority: 90,
      reserveFloor: "critical",
      concurrencyGroup: "browser-automation",
    });
    manager.on("state-changed", (status) => {
      if (status.id === "reclaimable" && status.state === "stopped") {
        runtime.setFreeCommitMb(12_000);
      }
    });

    let originalLease: Awaited<ReturnType<ServiceManager["acquireCapabilityLease"]>> | null = null;
    let overlapLease: Awaited<ReturnType<ServiceManager["acquireCapabilityLease"]>> | null = null;
    try {
      await manager.startAll();
      runtime.setFreeCommitMb(6_500);
      originalLease = await manager.acquireCapabilityLease("original-job", "forces reclaim");
      overlapLease = await manager.acquireCapabilityLease("overlap-job", "overlaps reclaim");
      assert.equal(manager.status("reclaimable").state, "stopped");

      const first = releaseFirst === "original" ? originalLease : overlapLease;
      const last = releaseFirst === "original" ? overlapLease : originalLease;
      first.release();
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(
        manager.status("reclaimable").state,
        "stopped",
        `${releaseFirst} release must not restore while the other capability overlaps`,
      );

      last.release();
      await waitUntil(() => manager.status("reclaimable").state === "healthy");
      assert.deepEqual(manager.activeLeaseSummary(), []);
    } finally {
      originalLease?.release();
      overlapLease?.release();
      await manager.stopAll();
      fs.rmSync(logsDir, { recursive: true, force: true });
    }
  }
});

test("capability lease expiry releases its reclaim hold and restores the service", async () => {
  const runtime = mutableGovernedManager(12_000, { minimumLeaseMs: 20 });
  const { manager, logsDir } = runtime;
  manager.register(nodeService("reclaimable", "setInterval(()=>{},1000)", {
    required: false,
    startPolicy: "eager",
    estimatedColdStartCommitMb: 0,
    pressureSheddable: true,
  }));
  manager.registerCapability({
    id: "expiring-job",
    estimatedColdStartCommitMb: 3_000,
    priority: 90,
    reserveFloor: "critical",
    concurrencyGroup: "large-generation",
    maxLeaseMs: 40,
  });
  manager.on("state-changed", (status) => {
    if (status.id === "reclaimable" && status.state === "stopped") {
      runtime.setFreeCommitMb(12_000);
    }
  });

  try {
    await manager.startAll();
    runtime.setFreeCommitMb(6_500);
    await manager.acquireCapabilityLease("expiring-job", "abandoned work");
    assert.equal(manager.status("reclaimable").state, "stopped");
    await waitUntil(() => manager.activeLeaseSummary().length === 0);
    await waitUntil(() => manager.status("reclaimable").state === "healthy");
    assert.match(manager.tailLog("desktop").join("\n"), /expired abandoned lease/);
  } finally {
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("a pending service lease claim prevents reclaim before lease publication", async () => {
  const runtime = mutableGovernedManager(12_000);
  const { manager, logsDir } = runtime;
  manager.register(nodeService("reclaimable", "setInterval(()=>{},1000)", {
    required: false,
    startPolicy: "eager",
    estimatedColdStartCommitMb: 0,
    pressureSheddable: true,
  }));
  manager.registerCapability({
    id: "foreground-job",
    estimatedColdStartCommitMb: 3_000,
    priority: 90,
    reserveFloor: "critical",
    concurrencyGroup: "large-generation",
  });

  const publicationGate = deferred<void>();
  const startReturned = deferred<void>();
  const originalStartService = manager.startService.bind(manager);
  manager.startService = async (id: string) => {
    const ok = await originalStartService(id);
    startReturned.resolve(undefined);
    await publicationGate.promise;
    return ok;
  };

  let serviceLease: Awaited<ReturnType<ServiceManager["acquireServiceLease"]>> | null = null;
  try {
    // Use the unpatched implementation for initial startup.
    manager.startService = originalStartService;
    await manager.startAll();
    const originalPid = manager.status("reclaimable").pid;
    manager.startService = async (id: string) => {
      const ok = await originalStartService(id);
      startReturned.resolve(undefined);
      await publicationGate.promise;
      return ok;
    };

    const serviceLeasePromise = manager.acquireServiceLease("reclaimable", "about to use service");
    await startReturned.promise;
    runtime.setFreeCommitMb(6_500);
    await assert.rejects(
      () => manager.acquireCapabilityLease("foreground-job", "must not steal claimed tree"),
      /Windows commit headroom/,
    );
    assert.equal(manager.status("reclaimable").state, "healthy");
    assert.equal(manager.status("reclaimable").pid, originalPid);

    publicationGate.resolve(undefined);
    serviceLease = await serviceLeasePromise;
    assert.equal(manager.status("reclaimable").activeLeases, 1);
  } finally {
    publicationGate.resolve(undefined);
    serviceLease?.release();
    manager.startService = originalStartService;
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("pressure reclaim rolls back already-stopped services when a later stop fails", async () => {
  const runtime = mutableGovernedManager(12_000);
  const { manager, logsDir } = runtime;
  manager.register(nodeService("first-reclaimable", "setInterval(()=>{},1000)", {
    required: false,
    startPolicy: "eager",
    estimatedColdStartCommitMb: 0,
    priority: 10,
    pressureSheddable: true,
  }));
  manager.register(nodeService("second-reclaimable", "setInterval(()=>{},1000)", {
    required: false,
    startPolicy: "eager",
    estimatedColdStartCommitMb: 0,
    priority: 20,
    pressureSheddable: true,
  }));
  manager.registerCapability({
    id: "foreground-job",
    estimatedColdStartCommitMb: 3_000,
    priority: 90,
    reserveFloor: "critical",
    concurrencyGroup: "large-generation",
  });
  manager.on("state-changed", (status) => {
    if (status.id === "first-reclaimable" && status.state === "stopped") {
      runtime.setFreeCommitMb(12_000);
    }
  });
  const originalStopService = manager.stopService.bind(manager);
  manager.stopService = async (id: string) => {
    if (id === "second-reclaimable") throw new Error("injected second stop failure");
    await originalStopService(id);
  };

  try {
    await manager.startAll();
    runtime.setFreeCommitMb(6_500);
    await assert.rejects(
      () => manager.acquireCapabilityLease("foreground-job", "transaction rollback"),
      /injected second stop failure/,
    );
    assert.equal(manager.status("first-reclaimable").state, "healthy");
    assert.equal(manager.status("second-reclaimable").state, "healthy");
    assert.deepEqual(manager.activeLeaseSummary(), []);
  } finally {
    manager.stopService = originalStopService;
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("failed post-reclaim admission restores despite a pre-existing capability lease", async () => {
  const runtime = mutableGovernedManager(12_000);
  const { manager, logsDir } = runtime;
  manager.register(nodeService("reclaimable", "setInterval(()=>{},1000)", {
    required: false,
    startPolicy: "eager",
    estimatedColdStartCommitMb: 0,
    pressureSheddable: true,
  }));
  manager.registerCapability({
    id: "existing-job",
    estimatedColdStartCommitMb: 1_000,
    priority: 90,
    reserveFloor: "critical",
    concurrencyGroup: "browser-automation",
  });
  manager.registerCapability({
    id: "rejected-job",
    estimatedColdStartCommitMb: 3_000,
    priority: 90,
    reserveFloor: "critical",
    concurrencyGroup: "large-generation",
  });
  manager.on("state-changed", (status) => {
    if (status.id === "reclaimable" && status.state === "stopped") {
      // Enough to restore the zero-estimate service, but not enough for the
      // rejected capability's 10 GB overlap requirement.
      runtime.setFreeCommitMb(9_000);
    }
  });

  let existingLease: Awaited<ReturnType<ServiceManager["acquireCapabilityLease"]>> | null = null;
  const governor = memoryGovernorOf(manager);
  const originalAdmit = governor.admit.bind(governor);
  let rejectedAdmissionCalls = 0;
  try {
    await manager.startAll();
    existingLease = await manager.acquireCapabilityLease("existing-job", "already running");
    governor.admit = async (
      request: AdmissionRequest,
      refresh: MemoryRefreshOptions = {},
    ): Promise<void> => {
      if (request.id !== "rejected-job") {
        await originalAdmit(request, refresh);
        return;
      }
      rejectedAdmissionCalls += 1;
      throw new ResourceExhaustionError({
        code: "BREADBOARD_RESOURCE_EXHAUSTED",
        resource: "windows_commit",
        denialReason: "headroom",
        requiredHeadroomMb: 10_000,
        availableHeadroomMb: rejectedAdmissionCalls === 1 ? 6_500 : 9_000,
        reserveHeadroomMb: 4_000,
        incomingEstimateMb: 3_000,
        overlapHeadroomMb: 0,
        retryable: false,
        state: "constrained",
      });
    };
    runtime.setFreeCommitMb(6_500);
    await assert.rejects(
      () => manager.acquireCapabilityLease("rejected-job", "post-reclaim still unsafe"),
      /Windows commit headroom/,
    );
    assert.equal(rejectedAdmissionCalls, 2, "one initial denial and one post-reclaim denial");
    assert.equal(manager.status("reclaimable").state, "healthy");
    assert.deepEqual(manager.activeLeaseSummary(), [{ targetId: "existing-job", count: 1 }]);
  } finally {
    governor.admit = originalAdmit;
    existingLease?.release();
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("overlapping heavyweight leases coexist without shedding an unrelated service", async () => {
  const runtime = mutableGovernedManager(20_000);
  const { manager, logsDir } = runtime;
  manager.register(nodeService("reclaimable", "setInterval(()=>{},1000)", {
    required: false,
    startPolicy: "eager",
    estimatedColdStartCommitMb: 0,
    pressureSheddable: true,
  }));
  for (const [id, group] of [
    ["active-job", "browser-automation"],
    ["rejected-job", "large-generation"],
  ] as const) {
    manager.registerCapability({
      id,
      estimatedColdStartCommitMb: 1_000,
      priority: 90,
      reserveFloor: "critical",
      concurrencyGroup: group,
    });
  }

  let activeLease: Awaited<ReturnType<ServiceManager["acquireCapabilityLease"]>> | null = null;
  let overlappingLease: Awaited<ReturnType<ServiceManager["acquireCapabilityLease"]>> | null = null;
  try {
    await manager.startAll();
    const pid = manager.status("reclaimable").pid;
    activeLease = await manager.acquireCapabilityLease("active-job", "first bounded owner");
    overlappingLease = await manager.acquireCapabilityLease(
      "rejected-job",
      "overlapping bounded owner",
    );
    assert.equal(manager.status("reclaimable").state, "healthy");
    assert.equal(manager.status("reclaimable").pid, pid);
    assert.deepEqual(manager.activeLeaseSummary(), [
      { targetId: "active-job", count: 1 },
      { targetId: "rejected-job", count: 1 },
    ]);
    assert.equal(
      manager.tailLog("reclaimable").some((line) => line.includes("reclaiming pressure-sheddable")),
      false,
    );
  } finally {
    activeLease?.release();
    overlappingLease?.release();
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("local-pressure denial never sheds a service because reclaim cannot clear it", async () => {
  const runtime = mutableGovernedManager(20_000);
  const { manager, logsDir } = runtime;
  manager.register(nodeService("reclaimable", "setInterval(()=>{},1000)", {
    required: false,
    startPolicy: "eager",
    estimatedColdStartCommitMb: 0,
    pressureSheddable: true,
  }));
  manager.registerCapability({
    id: "low-priority-job",
    estimatedColdStartCommitMb: 1_000,
    priority: 70,
    reserveFloor: "critical",
    concurrencyGroup: "large-generation",
  });

  try {
    await manager.startAll();
    const pid = manager.status("reclaimable").pid;
    memoryGovernorOf(manager).constrainNewHeavyWork(60_000);
    await assert.rejects(
      () => manager.acquireCapabilityLease("low-priority-job", "pressure denial"),
      /Memory pressure prevents new work/,
    );
    assert.equal(manager.status("reclaimable").state, "healthy");
    assert.equal(manager.status("reclaimable").pid, pid);
    assert.equal(
      manager.tailLog("reclaimable").some((line) => line.includes("reclaiming pressure-sheddable")),
      false,
    );
  } finally {
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("pressure restoration awaits an existing start promise and remains retryable", async () => {
  const runtime = mutableGovernedManager(12_000);
  const { manager, logsDir } = runtime;
  manager.register(nodeService("reclaimable", "setInterval(()=>{},1000)", {
    required: false,
    startPolicy: "eager",
    estimatedColdStartCommitMb: 0,
    pressureSheddable: true,
  }));
  manager.registerCapability({
    id: "foreground-job",
    estimatedColdStartCommitMb: 3_000,
    priority: 90,
    reserveFloor: "critical",
    concurrencyGroup: "large-generation",
  });
  manager.on("state-changed", (status) => {
    if (status.id === "reclaimable" && status.state === "stopped") {
      runtime.setFreeCommitMb(12_000);
    }
  });

  const existingStart = deferred<boolean>();
  type ManagedStartAccess = { startPromise: Promise<boolean> | null };
  const internal = manager as unknown as { services: Map<string, ManagedStartAccess> };
  try {
    await manager.startAll();
    runtime.setFreeCommitMb(6_500);
    const lease = await manager.acquireCapabilityLease("foreground-job", "forces reclaim");
    const managed = internal.services.get("reclaimable");
    assert.ok(managed);
    managed.startPromise = existingStart.promise;

    lease.release();
    await waitUntil(() => manager.tailLog("reclaimable").some((line) => line.includes("restoring service")));
    assert.equal(
      manager.tailLog("reclaimable").some((line) => line.includes("restore remains pending")),
      false,
      "restore must remain attached to the existing promise while it is unresolved",
    );

    existingStart.resolve(false);
    await waitUntil(() => manager.tailLog("reclaimable").some((line) => line.includes("restore remains pending")));
    managed.startPromise = null;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(await manager.startService("reclaimable"), true);
    assert.equal(manager.status("reclaimable").state, "healthy");
  } finally {
    existingStart.resolve(false);
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("shutdown drains queued starts and capability acquisitions without late publication", async () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-logs-"));
  const sampleStarted = deferred<void>();
  const sampleResult = deferred<SystemMemorySnapshot>();
  const manager = new ServiceManager(new LogManager({ logsDir }), {
    memoryPolicy: constrainedPolicy,
    systemMetrics: {
      async sample() {
        sampleStarted.resolve(undefined);
        return sampleResult.promise;
      },
    },
  });
  const spawnedPath = path.join(logsDir, "queued-service-spawned.txt");
  manager.register(nodeService(
    "queued-service",
    `require("fs").writeFileSync(${JSON.stringify(spawnedPath)}, "spawned");setInterval(()=>{},1000)`,
  ));
  for (const id of ["first-job", "queued-job"]) {
    manager.registerCapability({
      id,
      estimatedColdStartCommitMb: 1_000,
      priority: 90,
      reserveFloor: "critical",
      concurrencyGroup: id === "first-job" ? "large-generation" : "browser-automation",
    });
  }

  try {
    const firstAdmission = assert.rejects(
      manager.acquireCapabilityLease("first-job", "holds admission turn"),
      /shutting down/,
    );
    await sampleStarted.promise;
    const queuedStart = manager.startService("queued-service");
    const queuedAdmission = assert.rejects(
      manager.acquireCapabilityLease("queued-job", "queued behind first"),
      /shutting down/,
    );
    const shutdown = manager.stopAll();
    sampleResult.resolve({
      sampledAt: Date.now(),
      commitTotalMb: 20_000,
      commitLimitMb: 42_000,
      physicalTotalMb: 32_000,
      physicalAvailableMb: 8_000,
    });

    assert.equal(await queuedStart, false);
    await Promise.all([firstAdmission, queuedAdmission, shutdown]);
    assert.equal(manager.status("queued-service").state, "stopped");
    assert.equal(fs.existsSync(spawnedPath), false);
    assert.deepEqual(manager.activeLeaseSummary(), []);
  } finally {
    sampleResult.resolve({
      sampledAt: Date.now(),
      commitTotalMb: 20_000,
      commitLimitMb: 42_000,
      physicalTotalMb: 32_000,
      physicalAvailableMb: 8_000,
    });
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("shutdown aborts an in-flight health wait instead of waiting for its startup timeout", async () => {
  const { manager, logsDir } = newManager();
  manager.register(nodeService("slow-health", "setInterval(()=>{},1000)", {
    healthCheck: {
      type: "http",
      url: "http://127.0.0.1:1/never",
      timeoutMs: 100,
      intervalMs: 100,
    },
    startupTimeoutMs: 20_000,
  }));

  try {
    const starting = manager.startService("slow-health");
    await waitUntil(() => manager.status("slow-health").pid !== null);
    const shutdownAt = Date.now();
    await manager.stopAll();
    assert.equal(await starting, false);
    assert.ok(Date.now() - shutdownAt < 3_000, "shutdown must abort the 20s health wait");
    assert.equal(manager.status("slow-health").state, "stopped");
  } finally {
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
});

test("shutdown cannot let the 500ms liveness path publish healthy afterward", async () => {
  const { manager, logsDir } = newManager();
  const states: string[] = [];
  manager.register(nodeService("liveness", "setInterval(()=>{},1000)"));
  manager.on("state-changed", (status) => {
    if (status.id === "liveness") states.push(status.state);
  });

  try {
    const starting = manager.startService("liveness");
    await waitUntil(() => manager.status("liveness").pid !== null);
    await manager.stopAll();
    assert.equal(await starting, false);
    assert.equal(states.includes("healthy"), false);
    assert.equal(manager.status("liveness").state, "stopped");
  } finally {
    await manager.stopAll();
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
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

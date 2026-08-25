import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LogManager } from "../src/main/log-manager";
import { ServiceManager } from "../src/main/service-manager";
import { SupervisorControlPlane } from "../src/main/supervisor-control-plane";

const TOKEN = "supervisor-control-plane-test-secret";
const OWNER_PID = 424_242;

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

async function post(
  port: number,
  route: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function harness(options: {
  ownerProcessIsAlive: (pid: number) => boolean;
  ownerExitWatchMaxMs?: number;
}): Promise<{
  logs: LogManager;
  logsDir: string;
  manager: ServiceManager;
  plane: SupervisorControlPlane;
  port: number;
  acquire(): Promise<string>;
  close(): Promise<void>;
}> {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-control-plane-"));
  const logs = new LogManager({ logsDir });
  const manager = new ServiceManager(logs);
  manager.registerCapability({
    id: "learn-worker",
    estimatedColdStartCommitMb: 6_144,
    priority: 70,
    concurrencyGroup: "large-generation",
    maxLeaseMs: 60_000,
  });
  const plane = new SupervisorControlPlane({
    port: 0,
    secret: TOKEN,
    services: manager,
    logs,
    ownerProcessIsAlive: options.ownerProcessIsAlive,
    ownerExitPollMs: 10,
    ...(options.ownerExitWatchMaxMs === undefined
      ? {}
      : { ownerExitWatchMaxMs: options.ownerExitWatchMaxMs }),
  });
  const port = await plane.start();
  return {
    logs,
    logsDir,
    manager,
    plane,
    port,
    async acquire() {
      const acquired = await post(port, "/v1/capabilities/learn-worker/lease", {
        reason: "generic-worker-test",
      });
      assert.equal(acquired.status, 200);
      assert.equal(typeof acquired.body.leaseId, "string");
      return acquired.body.leaseId as string;
    },
    async close() {
      await plane.stop();
      await manager.stopAll();
      logs.closeAll();
      fs.rmSync(logsDir, { recursive: true, force: true });
    },
  };
}

test("deferred release acknowledges immediately and retains the lease until PID-observed exit", async () => {
  let alive = true;
  const fixture = await harness({ ownerProcessIsAlive: () => alive });
  try {
    const leaseId = await fixture.acquire();
    const route = `/v1/leases/${leaseId}/release`;
    const first = await post(fixture.port, route, { afterOwnerPidExit: OWNER_PID });
    assert.deepEqual(first, {
      status: 200,
      body: {
        ok: true,
        released: false,
        deferred: true,
        ownerPid: OWNER_PID,
      },
    });
    assert.deepEqual(fixture.manager.activeLeaseSummary(), [
      { targetId: "learn-worker", count: 1 },
    ]);

    const duplicate = await post(fixture.port, route, {
      afterOwnerPidExit: OWNER_PID,
    });
    assert.equal(duplicate.body.deferred, true);
    const differentOwner = await post(fixture.port, route, {
      afterOwnerPidExit: OWNER_PID + 1,
    });
    assert.equal(differentOwner.status, 400);
    const genericDuplicate = await post(fixture.port, route, {});
    assert.equal(genericDuplicate.body.released, false);
    assert.deepEqual(fixture.manager.activeLeaseSummary(), [
      { targetId: "learn-worker", count: 1 },
    ]);

    alive = false;
    await waitFor(
      () => fixture.manager.activeLeaseSummary().length === 0,
      "The lease did not release after the recorded owner PID exited.",
    );
    assert.equal(fixture.plane.pendingOwnerExitReleaseCount(), 0);
  } finally {
    await fixture.close();
  }
});

test("an already-dead owner releases synchronously without installing a poll", async () => {
  const fixture = await harness({ ownerProcessIsAlive: () => false });
  try {
    const leaseId = await fixture.acquire();
    const released = await post(fixture.port, `/v1/leases/${leaseId}/release`, {
      afterOwnerPidExit: OWNER_PID,
    });
    assert.deepEqual(released, {
      status: 200,
      body: {
        ok: true,
        released: true,
        deferred: false,
        ownerPid: OWNER_PID,
      },
    });
    assert.deepEqual(fixture.manager.activeLeaseSummary(), []);
    assert.equal(fixture.plane.pendingOwnerExitReleaseCount(), 0);
  } finally {
    await fixture.close();
  }
});

test("owner-exit release rejects invalid and nonpositive PIDs", async () => {
  const fixture = await harness({ ownerProcessIsAlive: () => true });
  try {
    const leaseId = await fixture.acquire();
    const route = `/v1/leases/${leaseId}/release`;
    for (const invalid of [0, -1, "424242", 1.5]) {
      const response = await post(fixture.port, route, {
        afterOwnerPidExit: invalid,
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, "invalid_request");
    }
    const unknownLease = await post(
      fixture.port,
      "/v1/leases/33333333-3333-3333-3333-333333333333/release",
      { afterOwnerPidExit: OWNER_PID },
    );
    assert.equal(unknownLease.status, 400);
    assert.equal(unknownLease.body.error, "invalid_request");
    assert.equal(fixture.plane.pendingOwnerExitReleaseCount(), 0);
    assert.deepEqual(fixture.manager.activeLeaseSummary(), [
      { targetId: "learn-worker", count: 1 },
    ]);
  } finally {
    await fixture.close();
  }
});

test("owner PID observers are bounded and control-plane stop clears them", async () => {
  const bounded = await harness({
    ownerProcessIsAlive: () => true,
    ownerExitWatchMaxMs: 100,
  });
  try {
    const leaseId = await bounded.acquire();
    await post(bounded.port, `/v1/leases/${leaseId}/release`, {
      afterOwnerPidExit: OWNER_PID,
    });
    assert.equal(bounded.plane.pendingOwnerExitReleaseCount(), 1);
    await waitFor(
      () => bounded.plane.pendingOwnerExitReleaseCount() === 0,
      "The PID observer outlived its configured lease-watch bound.",
    );
    // The authoritative ServiceManager TTL still owns expiry; dropping only the
    // redundant PID observer must not release a still-running owner's lease.
    assert.deepEqual(bounded.manager.activeLeaseSummary(), [
      { targetId: "learn-worker", count: 1 },
    ]);
    const duplicateAfterBound = await post(
      bounded.port,
      `/v1/leases/${leaseId}/release`,
      {},
    );
    assert.equal(duplicateAfterBound.body.released, false);
    assert.deepEqual(bounded.manager.activeLeaseSummary(), [
      { targetId: "learn-worker", count: 1 },
    ]);
  } finally {
    await bounded.close();
  }

  const stopped = await harness({ ownerProcessIsAlive: () => true });
  try {
    const leaseId = await stopped.acquire();
    await post(stopped.port, `/v1/leases/${leaseId}/release`, {
      afterOwnerPidExit: OWNER_PID,
    });
    assert.equal(stopped.plane.pendingOwnerExitReleaseCount(), 1);
    await stopped.plane.stop();
    assert.equal(stopped.plane.pendingOwnerExitReleaseCount(), 0);
    assert.deepEqual(stopped.manager.activeLeaseSummary(), [
      { targetId: "learn-worker", count: 1 },
    ]);
  } finally {
    await stopped.close();
  }
});

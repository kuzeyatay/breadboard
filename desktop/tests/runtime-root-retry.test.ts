import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { AppLifecycle } from "../src/main/app-lifecycle";

const desktopRoot = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(
  path.join(desktopRoot, "src", "main", "app-lifecycle.ts"),
  "utf8",
);

test("an initial startup failure recovers automatically after the old root exits", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events: string[] = [];
  let confirmExit!: (result: { exited: boolean }) => void;
  const oldRootExit = new Promise<{ exited: boolean }>((resolve) => { confirmExit = resolve; });
  const replacement = {
    state: "idle",
    async start() {
      events.push("replacement-start");
      this.state = "ready";
      return { dashboardUrl: "http://127.0.0.1:43122/" };
    },
    async status() { return {}; },
  };
  // Exercise the lifecycle methods with fake process/window boundaries,
  // without installing Electron's global rejection handler or launching it.
  const lifecycle = Object.assign(Object.create(AppLifecycle.prototype), {
    runtime: {
      state: "failed",
      async start() { throw new Error("Runtime closed stdout before a ready handshake."); },
      stop() { events.push("stop-old-root"); return oldRootExit; },
      snapshot() { return null; },
    },
    quitting: false,
    runtimeStopped: false,
    runtimeRestartInFlight: null,
    runtimeRootRetryTimer: null,
    runtimeRootStabilityTimer: null,
    runtimeStatusTimer: null,
    runtimeRootRetryAttempt: 0,
    logs: { forService: () => ({ write() {}, readTail: () => [] }) },
    windows: {
      sendToRenderer() {},
      tabs: { setNewTabUrl() {}, setBrowserUrl() {} },
    },
    createRuntimeProcess() { events.push("create-replacement"); return replacement; },
    allowDashboardOrigin() {},
    startVoiceCompanion() {},
    startRuntimeStatusPolling() {},
    async applyRuntimeSnapshot() { events.push("dashboard-ready"); },
  }) as {
    startRuntime(): Promise<void>;
    clearScheduledRuntimeRootRetry(): void;
    runtimeRootRetryTimer: NodeJS.Timeout | null;
    runtimeRootRetryAttempt: number;
    startupState: { phase: string };
    quitting: boolean;
  };
  t.after(() => lifecycle.clearScheduledRuntimeRootRetry());

  await lifecycle.startRuntime();
  assert.equal(lifecycle.startupState.phase, "failed");
  assert.ok(lifecycle.runtimeRootRetryTimer, "first-launch failures must schedule recovery");
  assert.equal(lifecycle.runtimeRootRetryAttempt, 1);
  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.deepEqual(events, ["stop-old-root"], "a replacement must await the old root's exit");

  confirmExit({ exited: true });
  await setImmediate();
  assert.deepEqual(events, [
    "stop-old-root", "create-replacement", "replacement-start", "dashboard-ready",
  ]);
  assert.equal(lifecycle.runtimeRootRetryTimer, null);
});

test("startup failure during quit does not schedule another runtime", async () => {
  const lifecycle = Object.assign(Object.create(AppLifecycle.prototype), {
    runtime: { async start() { throw new Error("startup interrupted"); } },
    quitting: true,
    runtimeRootRetryTimer: null,
    logs: { forService: () => ({ write() {} }) },
    setStartupState() {},
    failRuntimeStartup() {},
  }) as { startRuntime(): Promise<void>; runtimeRootRetryTimer: NodeJS.Timeout | null };
  await lifecycle.startRuntime();
  assert.equal(lifecycle.runtimeRootRetryTimer, null);
});

test("a failed Runtime root is retried before service-snapshot validation", () => {
  assert.match(source, /export const RUNTIME_ROOT_RETRY_ID = "desktop-runtime";/);
  assert.match(
    source,
    /serviceId === RUNTIME_ROOT_RETRY_ID[\s\S]{0,220}return this\.retryRuntimeRoot\(\);[\s\S]{0,220}const snapshot = runtime\?\.snapshot\(\);/,
  );
  assert.match(
    source,
    /failure: \{\s*serviceId: RUNTIME_ROOT_RETRY_ID,\s*displayName: "Breadboard Runtime"/,
  );
});

test("Runtime root retry replaces the single-use process only after exit", () => {
  assert.match(source, /if \(this\.runtimeRestartInFlight\) return this\.runtimeRestartInFlight;/);
  assert.match(
    source,
    /const stopped = await previousRuntime\.stop\(\);[\s\S]{0,420}if \(!stopped\.exited\)[\s\S]{0,900}this\.runtime = this\.createRuntimeProcess\(\);[\s\S]{0,120}await this\.startRuntime\(\);/,
  );
  assert.match(
    source,
    /this\.allowedOrigins\.origins\.delete\(new URL\(this\.runtimeDashboardUrl\)\.origin\);/,
  );
});

test("an unexpected Runtime root exit schedules bounded automatic recovery", () => {
  assert.match(
    source,
    /export const RUNTIME_ROOT_AUTO_RETRY_DELAYS_MS = Object\.freeze\(\[\s*1_000,\s*2_000,\s*5_000,\s*10_000,\s*30_000,/,
  );
  assert.match(
    source,
    /private handleUnexpectedRuntimeExit[\s\S]{0,900}this\.scheduleRuntimeRootRetry\(\);/,
  );
  assert.match(
    source,
    /private scheduleRuntimeRootRetry[\s\S]{0,2500}void this\.retryRuntimeRoot\(\);/,
  );
  assert.match(
    source,
    /this\.runtimeRootRetryAttempt = 0;[\s\S]{0,300}Runtime recovery is stable; retry backoff reset/,
  );
});

test("quitting cancels pending Runtime recovery timers", () => {
  const quitHandler = source.match(
    /app\.on\("before-quit", \(event\) => \{([\s\S]*?)\n    \}\);/,
  )?.[1];
  assert.ok(quitHandler, "the desktop must install its quit handler");
  assert.match(
    quitHandler,
    /this\.quitting = true;\s*this\.clearScheduledRuntimeRootRetry\(\);\s*this\.clearRuntimeRootStabilityTimer\(\);/,
  );
});

import { EventEmitter } from "node:events";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_RUNTIME_PROTOCOL_LINE_BYTES,
  RUNTIME_EXECUTABLE_NAME,
  RuntimeProcess,
  RuntimeProcessError,
  type RuntimeChildProcess,
  type RuntimeProcessDependencies,
  type RuntimeServiceStatus,
  type RuntimeSpawnOptions,
} from "../src/main/runtime-process";

const RUNTIME_PID = 43_210;
const CONTROL_TOKEN = "private-runtime-control-token-123456";

const DASHBOARD_SERVICE: RuntimeServiceStatus = {
  id: "dashboard",
  displayName: "Breadboard workspace",
  required: true,
  state: "ready",
  lastError: null,
  restarts: 0,
  adopted: false,
};

class FakeRuntimeChild extends EventEmitter {
  readonly pid = RUNTIME_PID;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly killSignals: Array<NodeJS.Signals | number | undefined> = [];
  #exited = false;

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    this.exit(null, signal === "SIGKILL" ? "SIGKILL" : null);
    return true;
  }

  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    if (this.#exited) return;
    this.#exited = true;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

interface SpawnCall {
  readonly executable: string;
  readonly args: readonly string[];
  readonly options: RuntimeSpawnOptions;
}

function createHarness(
  fetchImpl?: typeof fetch,
  onLog?: (source: "stdout" | "stderr", line: string) => void,
): {
  readonly runtime: RuntimeProcess;
  readonly child: FakeRuntimeChild;
  readonly spawnCalls: SpawnCall[];
  readonly bootstrapChunks: Buffer[];
} {
  const child = new FakeRuntimeChild();
  const spawnCalls: SpawnCall[] = [];
  const bootstrapChunks: Buffer[] = [];
  child.stdin.on("data", (chunk: Buffer | string) => {
    bootstrapChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8"));
  });

  const binDir = path.resolve("runtime-process-test", "bin");
  const dependencies: Partial<RuntimeProcessDependencies> = {
    binaryExists: () => true,
    hostEnvironment: {
      PATH: "safe-test-path",
      SystemRoot: "C:\\Windows",
      BREADBOARD_LEGACY_COMMAND: "must-not-cross-runtime-boundary",
    },
    spawnRuntime: (executable, args, options) => {
      spawnCalls.push({ executable, args: [...args], options });
      return child as unknown as RuntimeChildProcess;
    },
    fetch:
      fetchImpl ??
      (async () => {
        throw new Error("unexpected control request");
      }),
  };
  const runtime = new RuntimeProcess(
    {
      binDir,
      bootstrap: {
        mode: "lean",
        appRoot: path.resolve("runtime-process-test", "app"),
        runtimeRoot: path.resolve("runtime-process-test", "runtime"),
        dataRoot: path.resolve("runtime-process-test", "data"),
        configRoot: path.resolve("runtime-process-test", "config"),
      },
      startupTimeoutMs: 1_000,
      controlRequestTimeoutMs: 100,
      gracefulShutdownTimeoutMs: 100,
      forcedShutdownTimeoutMs: 100,
      ...(onLog ? { onLog } : {}),
    },
    dependencies,
  );
  return { runtime, child, spawnCalls, bootstrapChunks };
}

function readyRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "runtime-ready",
    protocolVersion: 1,
    runtimePid: RUNTIME_PID,
    controlBaseUrl: "http://127.0.0.1:43121",
    controlToken: CONTROL_TOKEN,
    dashboardUrl: "http://127.0.0.1:43122/",
    services: [DASHBOARD_SERVICE],
    ...overrides,
  };
}

function sendReady(child: FakeRuntimeChild, overrides: Record<string, unknown> = {}): void {
  child.stdout.write(`${JSON.stringify(readyRecord(overrides))}\n`);
}

test("launches only the fixed Runtime V2 executable and keeps handshake authority private", async () => {
  const harness = createHarness();
  const started = harness.runtime.start();
  sendReady(harness.child);
  const snapshot = await started;

  assert.equal(harness.spawnCalls.length, 1);
  const spawnCall = harness.spawnCalls[0] as SpawnCall;
  assert.equal(spawnCall.executable, path.join(spawnCall.options.cwd, RUNTIME_EXECUTABLE_NAME));
  assert.deepEqual(spawnCall.args, []);
  assert.equal(spawnCall.options.shell, false);
  assert.equal(spawnCall.options.detached, false);
  assert.deepEqual(spawnCall.options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(spawnCall.options.env["BREADBOARD_LEGACY_COMMAND"], undefined);
  assert.equal(spawnCall.options.env["PATH"], undefined);

  const bootstrap = Buffer.concat(harness.bootstrapChunks).toString("utf8");
  assert.ok(Buffer.byteLength(bootstrap, "utf8") <= MAX_RUNTIME_PROTOCOL_LINE_BYTES);
  assert.deepEqual(JSON.parse(bootstrap), {
    type: "runtime-bootstrap",
    protocolVersion: 1,
    mode: "lean",
    appRoot: path.resolve("runtime-process-test", "app"),
    runtimeRoot: path.resolve("runtime-process-test", "runtime"),
    dataRoot: path.resolve("runtime-process-test", "data"),
    configRoot: path.resolve("runtime-process-test", "config"),
  });
  assert.equal(
    harness.child.stdin.writableEnded,
    false,
    "stdin remains open so EOF continues to prove Electron parent disconnect",
  );

  assert.deepEqual(snapshot, {
    protocolVersion: 1,
    runtimePid: RUNTIME_PID,
    dashboardUrl: "http://127.0.0.1:43122/",
    services: [DASHBOARD_SERVICE],
  });
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.services));
  assert.ok(Object.isFrozen(snapshot.services[0]));
  const publicJson = JSON.stringify({ runtime: harness.runtime, snapshot });
  assert.doesNotMatch(publicJson, new RegExp(CONTROL_TOKEN));
  assert.doesNotMatch(publicJson, /43121/);
});

test("requires runtimeRoot to be an absolute private bootstrap authority", () => {
  assert.throws(
    () =>
      new RuntimeProcess({
        binDir: path.resolve("runtime-process-test", "bin"),
        bootstrap: {
          mode: "lean",
          appRoot: path.resolve("runtime-process-test", "app"),
          runtimeRoot: "relative/runtime-root",
          dataRoot: path.resolve("runtime-process-test", "data"),
          configRoot: path.resolve("runtime-process-test", "config"),
        },
      }),
    (error: unknown) =>
      error instanceof RuntimeProcessError &&
      error.code === "INVALID_CONFIGURATION" &&
      /runtimeRoot must be an absolute path/.test(error.message),
  );
});

test("discards partial startup output instead of forwarding its tail after readiness", async () => {
  const lines: Array<{ source: "stdout" | "stderr"; line: string }> = [];
  const harness = createHarness(undefined, (source, line) => lines.push({ source, line }));
  const started = harness.runtime.start();

  harness.child.stderr.write("startup-secret-without-a-newline");
  sendReady(harness.child);
  await started;
  harness.child.stderr.write("safe post-ready line\n");

  assert.deepEqual(lines, [{ source: "stderr", line: "safe post-ready line" }]);
});

test("rejects duplicate starts instead of spawning a second owner or legacy fallback", async () => {
  const harness = createHarness();
  const started = harness.runtime.start();
  sendReady(harness.child);
  await started;

  await assert.rejects(
    harness.runtime.start(),
    (error: unknown) =>
      error instanceof RuntimeProcessError &&
      error.code === "DUPLICATE_START" &&
      /legacy fallback is disabled/.test(error.message),
  );
  assert.equal(harness.spawnCalls.length, 1);
});

test("fails closed on a mismatched PID, non-loopback authority, or oversized ready line", async (t) => {
  await t.test("mismatched PID", async () => {
    const harness = createHarness();
    const started = harness.runtime.start();
    sendReady(harness.child, { runtimePid: RUNTIME_PID + 1 });
    await assert.rejects(
      started,
      (error: unknown) =>
        error instanceof RuntimeProcessError && error.code === "PROTOCOL_VIOLATION",
    );
    assert.deepEqual(harness.child.killSignals, ["SIGKILL"]);
  });

  await t.test("non-loopback control URL", async () => {
    const harness = createHarness();
    const started = harness.runtime.start();
    sendReady(harness.child, { controlBaseUrl: "http://192.0.2.10:43121/" });
    await assert.rejects(started, /loopback HTTP URL/);
    assert.deepEqual(harness.child.killSignals, ["SIGKILL"]);
  });

  await t.test("oversized ready line", async () => {
    const harness = createHarness();
    const started = harness.runtime.start();
    harness.child.stdout.write(Buffer.alloc(MAX_RUNTIME_PROTOCOL_LINE_BYTES + 1, 0x78));
    await assert.rejects(started, /ready handshake exceeds/);
    assert.deepEqual(harness.child.killSignals, ["SIGKILL"]);
  });

  await t.test("unknown ready field", async () => {
    const harness = createHarness();
    const started = harness.runtime.start();
    sendReady(harness.child, { hiddenAuthority: "must-not-be-accepted" });
    await assert.rejects(started, /missing or unknown fields/);
    assert.deepEqual(harness.child.killSignals, ["SIGKILL"]);
  });
});

test("authenticates bounded status and shutdown requests without exposing the token", async () => {
  const calls: Array<{ readonly url: string; readonly method: string; readonly authorization: string | null }> = [];
  let child: FakeRuntimeChild | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (url.endsWith("/v1/status")) {
      return new Response(
        JSON.stringify({
          type: "runtime-status",
          protocolVersion: 1,
          runtimePid: RUNTIME_PID,
          acceptingWork: true,
          services: [{ ...DASHBOARD_SERVICE, state: "busy", restarts: 2 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    queueMicrotask(() => child?.exit(0, null));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const harness = createHarness(fetchImpl);
  child = harness.child;
  const started = harness.runtime.start();
  sendReady(harness.child);
  await started;

  const status = await harness.runtime.status();
  assert.equal(status.acceptingWork, true);
  assert.equal(status.services[0]?.state, "busy");
  assert.equal(status.services[0]?.restarts, 2);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(CONTROL_TOKEN));

  const stopped = await harness.runtime.stop();
  assert.deepEqual(stopped, { graceful: true, forced: false, exited: true });
  assert.equal(harness.runtime.state, "stopped");
  assert.deepEqual(
    calls.map(({ url, method }) => ({ url, method })),
    [
      { url: "http://127.0.0.1:43121/v1/status", method: "GET" },
      { url: "http://127.0.0.1:43121/v1/shutdown", method: "POST" },
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.authorization),
    [`Bearer ${CONTROL_TOKEN}`, `Bearer ${CONTROL_TOKEN}`],
  );
  assert.doesNotMatch(JSON.stringify(harness.runtime.snapshot()), new RegExp(CONTROL_TOKEN));
  assert.equal(harness.child.stdin.writableEnded, true);
});

test("signals only the runtime root when authenticated shutdown cannot be requested", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("control listener unavailable");
  };
  const harness = createHarness(fetchImpl);
  const started = harness.runtime.start();
  sendReady(harness.child);
  await started;

  const stopped = await harness.runtime.stop();
  assert.deepEqual(stopped, { graceful: false, forced: true, exited: true });
  assert.deepEqual(harness.child.killSignals, ["SIGKILL"]);
  assert.equal(harness.spawnCalls.length, 1);
  assert.equal(harness.runtime.state, "stopped");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeChildProcessGone,
  describeGpuAdapter,
  describeGpuFeatureStatus,
  installGpuDiagnostics,
  type ChildProcessGoneDetails,
  type GpuDiagnosticsHost,
} from "../src/main/gpu-diagnostics";

function fakeHost(overrides: Partial<GpuDiagnosticsHost> = {}): {
  host: GpuDiagnosticsHost;
  fire: (details: ChildProcessGoneDetails) => void;
} {
  let listener: ((details: ChildProcessGoneDetails) => void) | null = null;
  const host: GpuDiagnosticsHost = {
    onChildProcessGone: (fn) => {
      listener = fn;
    },
    getGPUFeatureStatus: () => ({ gpu_compositing: "enabled", webgl: "enabled" }),
    getGPUInfo: async () => ({
      gpuDevice: [{ vendorId: 4098, deviceId: 5763, driverVersion: "31.0.1", active: true }],
    }),
    ...overrides,
  };
  return { host, fire: (details) => listener?.(details) };
}

test("a GPU child-process exit is recorded with type, reason and exit code", async () => {
  const lines: string[] = [];
  const { host, fire } = fakeHost();
  installGpuDiagnostics(host, (line) => lines.push(line));
  await new Promise((resolve) => setImmediate(resolve));

  fire({ type: "GPU", reason: "crashed", exitCode: 34 });

  const gone = lines.find((line) => line.includes("chromium child process gone"));
  assert.ok(gone, `no exit line in ${JSON.stringify(lines)}`);
  assert.match(gone as string, /type=GPU/);
  assert.match(gone as string, /reason=crashed/);
  assert.match(gone as string, /exitCode=34/);
  // A GPU failure also snapshots the feature status for comparison.
  assert.ok(lines.filter((line) => line.includes("gpu feature status")).length >= 2);
});

test("the startup baseline records feature status and adapter identity", async () => {
  const lines: string[] = [];
  const { host } = fakeHost();
  installGpuDiagnostics(host, (line) => lines.push(line));
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(lines.some((line) => line.includes("gpu feature status: gpu_compositing=enabled")));
  const adapter = lines.find((line) => line.includes("gpu adapter"));
  assert.ok(adapter);
  assert.match(adapter as string, /vendorId=4098/);
  assert.match(adapter as string, /driverVersion=31\.0\.1/);
});

test("diagnostics are bounded and never serialize an unknown blob wholesale", () => {
  const huge: Record<string, unknown> = {};
  for (let index = 0; index < 500; index += 1) huge[`feature_${index}`] = "enabled";
  const status = describeGpuFeatureStatus(huge);
  assert.ok(status.length <= 820, `feature status must stay bounded, got ${status.length}`);
  assert.ok(status.endsWith("(truncated)"));

  // Unknown adapter fields are dropped rather than echoed.
  const adapter = describeGpuAdapter({
    gpuDevice: [{ vendorId: 1, deviceId: 2, machineSerial: "SECRET-SERIAL" }],
    auxAttributes: { userDataDir: "C:/Users/someone" },
  });
  assert.match(adapter, /vendorId=1/);
  assert.ok(!adapter.includes("SECRET-SERIAL"));
  assert.ok(!adapter.includes("C:/Users/someone"));
});

test("malformed GPU info degrades to a stable marker", () => {
  assert.equal(describeGpuAdapter(null), "unavailable");
  assert.equal(describeGpuAdapter("nope"), "unavailable");
  assert.equal(describeGpuAdapter({}), "unavailable");
  assert.equal(describeGpuFeatureStatus({}), "unavailable");
});

test("a throwing host never propagates out of the diagnostics hook", async () => {
  const lines: string[] = [];
  const { host, fire } = fakeHost({
    getGPUFeatureStatus: () => {
      throw new Error("no gpu process");
    },
    getGPUInfo: async () => {
      throw new Error("unavailable");
    },
  });
  installGpuDiagnostics(host, (line) => lines.push(line));
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotThrow(() => fire({ type: "GPU", reason: "crashed", exitCode: 34 }));
});

test("non-GPU child process exits are still recorded", () => {
  const details = describeChildProcessGone({
    type: "Utility",
    reason: "oom",
    exitCode: 1,
    serviceName: "network.mojom.NetworkService",
    name: "Network Service",
  });
  assert.match(details, /type=Utility/);
  assert.match(details, /service=network\.mojom\.NetworkService/);
  assert.match(details, /name=Network Service/);
});

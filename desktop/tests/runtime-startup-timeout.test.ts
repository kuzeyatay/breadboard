import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { RuntimeProcess, RuntimeProcessError } from "../src/main/runtime-process";
import {
  MAX_RUNTIME_STARTUP_TIMEOUT_MS,
  RUNTIME_STARTUP_GRACE_MS,
  runtimeInitialStartupTimeoutMs,
} from "../src/main/runtime-startup-timeout";

const DESKTOP_ROOT = path.resolve(__dirname, "..", "..");

function fixture(t: TestContext): string {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-runtime-startup-"));
  fs.mkdirSync(path.join(runtimeRoot, "runtime-v2", "manifests"), { recursive: true });
  t.after(() => fs.rmSync(runtimeRoot, { recursive: true, force: true }));
  return runtimeRoot;
}

function writeServices(runtimeRoot: string, services: readonly unknown[]): void {
  fs.writeFileSync(
    path.join(runtimeRoot, "runtime-v2", "manifests", "services.json"),
    JSON.stringify({ version: 4, services }),
  );
}

function service(input: {
  readonly id: string;
  readonly requirement?: "required" | "optional";
  readonly startupPolicy?: "eager" | "on-demand";
  readonly modes?: readonly string[];
  readonly startupTimeoutMs: number;
}): Record<string, unknown> {
  return {
    id: input.id,
    requirement: input.requirement ?? "required",
    startupPolicy: input.startupPolicy ?? "eager",
    launchProfiles: [{ modes: input.modes ?? ["hot"] }],
    readiness: { startupTimeoutMs: input.startupTimeoutMs },
  };
}

test("hot startup follows the longest required eager manifest deadline", (t) => {
  const runtimeRoot = fixture(t);
  writeServices(runtimeRoot, [
    service({ id: "chatmock", startupTimeoutMs: 90_000 }),
    service({ id: "dashboard", startupTimeoutMs: 180_000 }),
    service({ id: "optional-eager", requirement: "optional", startupTimeoutMs: 500_000 }),
    service({ id: "required-on-demand", startupPolicy: "on-demand", startupTimeoutMs: 600_000 }),
  ]);

  assert.equal(
    runtimeInitialStartupTimeoutMs(runtimeRoot, "hot"),
    180_000 + RUNTIME_STARTUP_GRACE_MS,
  );
});

test("the checked-in hot manifest cannot outlive Electron's initial deadline", () => {
  assert.equal(
    runtimeInitialStartupTimeoutMs(path.join(DESKTOP_ROOT, "build-resources"), "hot"),
    180_000 + RUNTIME_STARTUP_GRACE_MS,
  );
});

test("AppLifecycle uses the manifest-derived initial deadline", () => {
  const source = fs.readFileSync(path.join(DESKTOP_ROOT, "src", "main", "app-lifecycle.ts"), "utf8");
  assert.match(source, /const launchMode = runtimeLaunchMode\(this\.paths\.mode\);/u);
  assert.match(
    source,
    /startupTimeoutMs:\s*runtimeInitialStartupTimeoutMs\(this\.paths\.runtimeRoot, launchMode\)/u,
  );
  assert.doesNotMatch(source, /startupTimeoutMs:\s*120_000/u);
});

test("required eager deadline derivation fails closed", (t) => {
  const runtimeRoot = fixture(t);
  writeServices(runtimeRoot, [
    service({ id: "dashboard", modes: ["lean"], startupTimeoutMs: 180_000 }),
  ]);
  assert.throws(
    () => runtimeInitialStartupTimeoutMs(runtimeRoot, "hot"),
    /dashboard has no hot launch profile/u,
  );

  writeServices(runtimeRoot, [
    {
      ...service({ id: "dashboard", startupTimeoutMs: 180_000 }),
      readiness: {},
    },
  ]);
  assert.throws(
    () => runtimeInitialStartupTimeoutMs(runtimeRoot, "hot"),
    /dashboard has an invalid startup deadline/u,
  );
});

test("only initial startup may use the manifest-sized timeout ceiling", () => {
  const options = {
    binDir: path.resolve("runtime-startup-timeout-test", "bin"),
    bootstrap: {
      mode: "hot" as const,
      appRoot: path.resolve("runtime-startup-timeout-test", "app"),
      runtimeRoot: path.resolve("runtime-startup-timeout-test", "runtime"),
      dataRoot: path.resolve("runtime-startup-timeout-test", "data"),
      configRoot: path.resolve("runtime-startup-timeout-test", "config"),
    },
  };

  assert.doesNotThrow(
    () => new RuntimeProcess({ ...options, startupTimeoutMs: 210_000 }),
  );
  assert.throws(
    () => new RuntimeProcess({ ...options, controlRequestTimeoutMs: 210_000 }),
    (error: unknown) =>
      error instanceof RuntimeProcessError && error.code === "INVALID_CONFIGURATION",
  );
  assert.throws(
    () => new RuntimeProcess({ ...options, startupTimeoutMs: MAX_RUNTIME_STARTUP_TIMEOUT_MS + 1 }),
    (error: unknown) =>
      error instanceof RuntimeProcessError && error.code === "INVALID_CONFIGURATION",
  );
});

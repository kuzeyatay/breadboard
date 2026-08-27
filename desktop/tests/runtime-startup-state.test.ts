import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRuntimeStartup,
  runtimeStartupFailureReason,
} from "../src/main/runtime-startup-state";
import type { RuntimeServiceStatus } from "../src/main/runtime-process";

function service(
  id: string,
  state: RuntimeServiceStatus["state"],
  required: boolean,
  lastError: string | null = null,
  startupPolicy: RuntimeServiceStatus["startupPolicy"] = "eager",
): RuntimeServiceStatus {
  return {
    id,
    displayName: id === "dashboard" ? "Breadboard workspace" : id,
    required,
    startupPolicy,
    state,
    lastError,
    restarts: 0,
    adopted: false,
  };
}

test("required on-demand services do not block eager startup", () => {
  const result = classifyRuntimeStartup([
    service("chatmock", "ready", true),
    service("dashboard", "ready", true),
    service("gbrain", "available-but-stopped", true, null, "on-demand"),
    service("comfyui", "installation-unavailable", true, null, "on-demand"),
  ]);
  assert.deepEqual(result, { phase: "ready", message: "Ready", failure: null });
});

test("required startup progress preserves the existing service-specific wording", () => {
  const result = classifyRuntimeStartup([
    service("chatmock", "ready", true),
    service("dashboard", "starting", true),
  ]);
  assert.deepEqual(result, {
    phase: "starting",
    message: "Starting workspace",
    failure: null,
  });
});

test("required eager failures stay visible and retryable without blocking on-demand capabilities", () => {
  const failed = service(
    "dashboard",
    "resource-blocked",
    true,
    "BREADBOARD_RESOURCE_EXHAUSTED: safe startup denied",
  );
  const result = classifyRuntimeStartup([
    service("chatmock", "ready", true),
    failed,
    service("gbrain", "available-but-stopped", true, null, "on-demand"),
  ]);
  assert.equal(result.phase, "failed");
  assert.equal(result.failure, failed);
  assert.equal(result.message, "Breadboard workspace could not start");
  assert.equal(
    runtimeStartupFailureReason(failed),
    "BREADBOARD_RESOURCE_EXHAUSTED: safe startup denied",
  );
});

test("missing installation and generic failure reasons remain truthful", () => {
  assert.equal(
    runtimeStartupFailureReason(service("dashboard", "installation-unavailable", true)),
    "The required service installation is unavailable.",
  );
  assert.equal(
    runtimeStartupFailureReason(service("dashboard", "failed", true)),
    "The service stopped before it became ready.",
  );
});

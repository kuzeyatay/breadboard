import assert from "node:assert/strict";
import test from "node:test";

import {
  runtimeStartupResourceFailure,
  safeRuntimeStartupDiagnostic,
} from "../src/lib/agent-runtime/startup-error.ts";
import { SupervisorResourceExhaustedError } from "../src/lib/supervisor-control.ts";

test("runtime startup diagnostics preserve bounded admission evidence", () => {
  const error = new SupervisorResourceExhaustedError({
    code: "BREADBOARD_RESOURCE_EXHAUSTED",
    resource: "windows_commit",
    requiredHeadroomMb: 9_728,
    availableHeadroomMb: 9_125,
    retryable: false,
    state: "constrained",
    denialReason: "headroom",
  });

  assert.deepEqual(
    safeRuntimeStartupDiagnostic({
      runtimeKind: "hermes",
      stage: "primary_create",
      error,
    }),
    {
      runtimeKind: "hermes",
      stage: "primary_create",
      errorName: "SupervisorResourceExhaustedError",
      errorCode: "BREADBOARD_RESOURCE_EXHAUSTED",
      resource: "windows_commit",
      requiredHeadroomMb: 9_728,
      availableHeadroomMb: 9_125,
      denialReason: "headroom",
    },
  );
  const client = runtimeStartupResourceFailure(error);
  assert.equal(client.code, "runtime_resource_exhausted");
  assert.match(client.message, /9,?728|9728/);
  assert.match(client.message, /9,?125|9125/);
});

test("runtime startup diagnostics never copy unexpected messages or stacks", () => {
  const secret = "Bearer top-secret-token at C:\\Users\\private\\runtime.json";
  const error = new Error(secret);
  error.name = secret;
  error.code = secret;
  const diagnostic = safeRuntimeStartupDiagnostic({
    runtimeKind: "hermes",
    stage: "fallback_create",
    error,
  });

  assert.deepEqual(diagnostic, {
    runtimeKind: "hermes",
    stage: "fallback_create",
    errorName: "Error",
  });
  assert.ok(!JSON.stringify(diagnostic).includes("top-secret-token"));
  assert.equal(runtimeStartupResourceFailure(error), null);
});

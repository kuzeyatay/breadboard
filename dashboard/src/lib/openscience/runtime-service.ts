import type { OpenscienceService } from "./service.ts";
import {
  callRuntimeAgentService,
  inspectRuntimeAgentService,
  scopedAgentRequest,
  withRuntimeAgentServiceLease,
  type RuntimeAgentScope,
} from "../runtime-agent-service.ts";
import type { SetupStatus } from "./setup.ts";
import type { RuntimeAvailability } from "./runtime.ts";

export interface OpenscienceRuntimeStatus {
  availability: RuntimeAvailability;
  setup: SetupStatus;
  service: OpenscienceService | null;
}

export function withOpenscienceServiceLease<T>(
  scope: RuntimeAgentScope,
  operation: () => Promise<T>,
): Promise<T> {
  return withRuntimeAgentServiceLease("openscience", `run:${scope.runId ?? scope.userId}`, operation);
}

export function ensureOpenscienceService(
  scope: RuntimeAgentScope,
): Promise<OpenscienceService> {
  return callRuntimeAgentService(
    "openscience",
    "/v1/ensure",
    scopedAgentRequest(scope),
  );
}

export function stopOpenscienceRuntime(scope: RuntimeAgentScope): Promise<void> {
  return withRuntimeAgentServiceLease("openscience", "user-authorized-stop", async () => {
    await callRuntimeAgentService(
      "openscience",
      "/v1/stop",
      scopedAgentRequest(scope),
    );
  });
}

export function inspectOpenscienceRuntime(userId: number) {
  return inspectRuntimeAgentService("openscience", { userId });
}

export function readOpenscienceRuntimeStatus(
  scope: RuntimeAgentScope,
): Promise<OpenscienceRuntimeStatus> {
  return withRuntimeAgentServiceLease("openscience", "authenticated-status", () =>
    callRuntimeAgentService(
      "openscience",
      "/v1/status",
      scopedAgentRequest(scope),
      { timeoutMs: 30_000 },
    ));
}

export type { SetupStatus };

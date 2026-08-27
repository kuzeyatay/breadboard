import type { WardrobeService, StartOptions } from "./service.ts";
import type { SetupStatus } from "./status.ts";
import type { WardrobeAvailability } from "./runtime.ts";
import {
  callRuntimeAgentService,
  inspectRuntimeAgentService,
  scopedAgentRequest,
  withRuntimeAgentServiceLease,
  type RuntimeAgentScope,
} from "../runtime-agent-service.ts";

export function withWardrobeServiceLease<T>(
  scope: RuntimeAgentScope,
  operation: () => Promise<T>,
): Promise<T> {
  return withRuntimeAgentServiceLease(
    "wardrobe",
    `run:${scope.runId ?? scope.userId}`,
    operation,
  );
}

export function ensureWardrobeService(
  scope: RuntimeAgentScope,
  options: StartOptions,
  signal?: AbortSignal,
): Promise<WardrobeService> {
  return callRuntimeAgentService(
    "wardrobe",
    "/v1/ensure",
    scopedAgentRequest(scope, { options }),
    { signal },
  );
}

export function stopWardrobeRuntime(scope: RuntimeAgentScope): Promise<void> {
  return withRuntimeAgentServiceLease(
    "wardrobe",
    "user-authorized-stop",
    async () => {
      await callRuntimeAgentService(
        "wardrobe",
        "/v1/stop",
        scopedAgentRequest(scope),
      );
    },
  );
}

export function inspectWardrobeRuntime(userId: number) {
  return inspectRuntimeAgentService("wardrobe", { userId }) as Promise<{
    snapshot: Awaited<
      ReturnType<typeof inspectRuntimeAgentService>
    >["snapshot"];
    status: {
      availability: WardrobeAvailability;
      setup: SetupStatus;
      service: WardrobeService | null;
    } | null;
  }>;
}

export function readWardrobeRuntimeStatus(scope: RuntimeAgentScope): Promise<{
  availability: WardrobeAvailability;
  setup: SetupStatus;
  service: WardrobeService | null;
}> {
  return withRuntimeAgentServiceLease("wardrobe", "authenticated-status", () =>
    callRuntimeAgentService(
      "wardrobe",
      "/v1/status",
      scopedAgentRequest(scope),
      { timeoutMs: 30_000 },
    ),
  );
}

export function reopenWardrobeService(
  scope: RuntimeAgentScope,
): Promise<WardrobeService> {
  return withRuntimeAgentServiceLease("wardrobe", "open-durable-gallery", () =>
    callRuntimeAgentService(
      "wardrobe",
      "/v1/reopen",
      scopedAgentRequest(scope),
      { timeoutMs: 3 * 60_000 },
    ),
  );
}

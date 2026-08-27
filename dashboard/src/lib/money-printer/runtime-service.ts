import type { MoneyPrinterService, StartOptions } from "./service.ts";
import type { MoneyPrinterHealth } from "./runtime.ts";
import {
  callRuntimeAgentService,
  inspectRuntimeAgentService,
  scopedAgentRequest,
  withRuntimeAgentServiceLease,
  type RuntimeAgentScope,
} from "../runtime-agent-service.ts";

export function withMoneyPrinterServiceLease<T>(
  scope: RuntimeAgentScope,
  operation: () => Promise<T>,
): Promise<T> {
  return withRuntimeAgentServiceLease("money-printer", `run:${scope.runId ?? scope.userId}`, operation);
}

export function ensureMoneyPrinterService(
  scope: RuntimeAgentScope,
  options: StartOptions,
): Promise<MoneyPrinterService> {
  return callRuntimeAgentService(
    "money-printer",
    "/v1/ensure",
    scopedAgentRequest(scope, { options }),
  );
}

export function stopMoneyPrinterRuntime(scope: RuntimeAgentScope): Promise<void> {
  return withRuntimeAgentServiceLease("money-printer", "cancel-last-run", async () => {
    await callRuntimeAgentService(
      "money-printer",
      "/v1/stop",
      scopedAgentRequest(scope),
    );
  });
}

/**
 * Stop the clone behind an already-held Runtime job dependency. Disposable
 * workers receive only this service-specific loopback capability, never the
 * supervisor control token needed to acquire or release service authority.
 */
export async function stopMoneyPrinterWorkerService(
  scope: RuntimeAgentScope,
): Promise<void> {
  await callRuntimeAgentService(
    "money-printer",
    "/v1/stop",
    scopedAgentRequest(scope),
  );
}

export function inspectMoneyPrinterRuntime(userId: number) {
  return inspectRuntimeAgentService("money-printer", { userId }) as Promise<{
    snapshot: Awaited<ReturnType<typeof inspectRuntimeAgentService>>["snapshot"];
    status: {
      availability: MoneyPrinterHealth;
      service: MoneyPrinterService | null;
      log: string;
    } | null;
  }>;
}

export function readMoneyPrinterRuntimeStatus(
  scope: RuntimeAgentScope,
  refresh = false,
): Promise<{
  availability: MoneyPrinterHealth;
  service: MoneyPrinterService | null;
  log: string;
}> {
  return withRuntimeAgentServiceLease("money-printer", "authenticated-status", () =>
    callRuntimeAgentService(
      "money-printer",
      "/v1/status",
      scopedAgentRequest(scope, { refresh }),
      { timeoutMs: 60_000 },
    ));
}

export async function readMoneyPrinterServiceLog(scope: RuntimeAgentScope): Promise<string> {
  const status = await callRuntimeAgentService<{ log?: unknown }>(
    "money-printer",
    "/v1/status",
    scopedAgentRequest(scope),
    { timeoutMs: 5_000 },
  );
  return typeof status.log === "string" ? status.log.slice(-8_000) : "";
}

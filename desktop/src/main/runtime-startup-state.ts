import type { RuntimeServiceStatus } from "./runtime-process";

export type RuntimeStartupPhase = "starting" | "ready" | "failed";

export interface RuntimeStartupClassification {
  readonly phase: RuntimeStartupPhase;
  readonly message: string;
  readonly failure: RuntimeServiceStatus | null;
}

const TERMINAL_STARTUP_FAILURES = new Set<RuntimeServiceStatus["state"]>([
  "failed",
  "resource-blocked",
  "installation-unavailable",
]);

/** Classifies only required eager services; mandatory on-demand services start on first lease. */
export function classifyRuntimeStartup(
  services: readonly RuntimeServiceStatus[],
): RuntimeStartupClassification {
  const requiredStartup = services.filter(
    (service) => service.required && service.startupPolicy === "eager",
  );
  const failure = requiredStartup.find((service) =>
    TERMINAL_STARTUP_FAILURES.has(service.state),
  );
  if (failure) {
    return Object.freeze({
      phase: "failed",
      message: `${failure.displayName} could not start`,
      failure,
    });
  }

  const pending = requiredStartup.find(
    (service) => service.state !== "ready" && service.state !== "busy",
  );
  if (pending) {
    return Object.freeze({
      phase: "starting",
      message: startingMessage(pending.id),
      failure: null,
    });
  }

  return Object.freeze({ phase: "ready", message: "Ready", failure: null });
}

export function runtimeStartupFailureReason(service: RuntimeServiceStatus): string {
  if (service.lastError) return service.lastError;
  switch (service.state) {
    case "resource-blocked":
      return "Breadboard does not have enough safe memory headroom to start this service.";
    case "installation-unavailable":
      return "The required service installation is unavailable.";
    default:
      return "The service stopped before it became ready.";
  }
}

export function startingMessage(serviceId: string): string {
  switch (serviceId) {
    case "chatmock":
      return "Starting local AI";
    case "hermes":
      return "Starting agent runtime";
    case "postiz":
      return "Starting social publishing (first launch can take several minutes)";
    case "quartz":
      return "Starting garden";
    case "humanizer":
      return "Loading local rewriting model";
    case "dashboard":
      return "Starting workspace";
    default:
      return "Starting local services";
  }
}

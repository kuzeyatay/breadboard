// The disposable DeerFlow worker receives exactly one closed loopback endpoint.
// Keeping this in a separate module means importing the run manager cannot even
// load the trusted config writer used by the Next.js facade.

import { resolveManagedServiceEndpoint } from "../runtime-v2/managed-service-endpoint.ts";

export interface DeerFlowWorkerService {
  readonly url: string;
  readonly startedAt: number;
}

export function preparedService(): DeerFlowWorkerService {
  const endpoint = resolveManagedServiceEndpoint("deer-flow");
  if (!endpoint) {
    throw new Error("The prepared DeerFlow Runtime service is unavailable.");
  }
  return { url: endpoint.url, startedAt: Date.now() };
}

/** Runtime owns service logs; worker results never expose process output. */
export function serviceLog(): string {
  return "";
}

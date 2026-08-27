// Runtime V2 owns the DeerFlow Gateway process tree. This adapter prepares the
// trusted configuration the service reads and resolves only the closed,
// loopback endpoint injected by Runtime (or an explicitly configured external
// endpoint in bare-dashboard development). It never launches or stops Python.

import { writeConfig, type ConfigInput } from "./config.ts";
import { resolveManagedServiceEndpoint } from "../runtime-v2/managed-service-endpoint.ts";

export interface DeerFlowService {
  readonly url: string;
  readonly home: string;
  readonly startedAt: number;
}

/** Prepare this run's config before its Runtime lease starts a cold Gateway. */
export async function prepareService(input: ConfigInput): Promise<DeerFlowService> {
  const endpoint = resolveManagedServiceEndpoint("deer-flow");
  if (!endpoint) {
    throw new Error(
      "DeerFlow is external in bare-dashboard mode; set DEER_FLOW_SERVICE_URL to its loopback origin.",
    );
  }
  const generated = await writeConfig(input);
  return {
    url: endpoint.url,
    home: generated.home,
    startedAt: Date.now(),
  };
}

/** Runtime owns service logs; dashboard responses never expose process output. */
export function serviceLog(): string {
  return "";
}

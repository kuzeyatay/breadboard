import { isRuntimeV2ServiceControlConfigured } from "../supervisor-control.ts";
import { RuntimeAuthorityUnavailableError } from "./authority-error.ts";

export type ConfiguredRuntimeAgentServiceId =
  | "deer-flow"
  | "vibe-trading"
  | "stock-analyst";

export interface ManagedServiceEndpoint {
  readonly url: string;
  readonly apiKey: string;
  readonly runtimeOwned: boolean;
}

const ENDPOINT_KEYS: Record<ConfiguredRuntimeAgentServiceId, string> = {
  "deer-flow": "DEER_FLOW_SERVICE_URL",
  "vibe-trading": "VIBE_TRADING_SERVICE_URL",
  "stock-analyst": "STOCK_ANALYST_SERVICE_URL",
};

function validateLoopbackRoot(raw: string, variable: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RuntimeAuthorityUnavailableError(`${variable} is invalid.`);
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new RuntimeAuthorityUnavailableError(
      `${variable} must be an HTTP loopback origin.`,
    );
  }
  return url.origin;
}

/**
 * Runtime mode accepts only the closed endpoint injected by the native owner.
 * Bare-dashboard development is external-only and must opt in with the same
 * server-side variable; absence never falls back to spawning a process.
 */
export function resolveManagedServiceEndpoint(
  serviceId: ConfiguredRuntimeAgentServiceId,
  env: NodeJS.ProcessEnv = process.env,
): ManagedServiceEndpoint | null {
  const variable = ENDPOINT_KEYS[serviceId];
  const raw = env[variable]?.trim();
  const runtimeOwned = isRuntimeV2ServiceControlConfigured(env);
  if (!raw) {
    if (runtimeOwned) {
      throw new RuntimeAuthorityUnavailableError(`${variable} was not supplied by Runtime V2.`);
    }
    return null;
  }
  const apiKey =
    serviceId === "vibe-trading"
      ? env.VIBE_TRADING_SERVICE_API_KEY?.trim() ?? ""
      : "";
  if (serviceId === "vibe-trading" && apiKey.length < 32) {
    if (runtimeOwned) {
      throw new RuntimeAuthorityUnavailableError(
        "VIBE_TRADING_SERVICE_API_KEY was not supplied by Runtime V2.",
      );
    }
    return null;
  }
  return {
    url: validateLoopbackRoot(raw, variable),
    apiKey,
    runtimeOwned,
  };
}

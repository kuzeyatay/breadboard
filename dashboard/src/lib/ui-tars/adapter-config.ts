// Resolution of UI-TARS runtime mode + loopback adapter connection settings.
//
// UI_TARS_MODE = optional | required (default: optional).
//  - optional: startup failure is isolated, but the agent remains registered
//    and first use still attempts the adapter or reports it unavailable.
//  - required: dev/dedicated only; callers may surface an actionable error.
// Legacy `disabled` values normalize to failure-isolated `optional`; a service
// requirement never permits omitting or hiding the capability.

export type UITarsMode = "optional" | "required";

export interface UITarsAdapterConfig {
  mode: UITarsMode;
  adapterUrl: string;
  secret: string;
  requestTimeoutMs: number;
}

export function uiTarsMode(env: NodeJS.ProcessEnv = process.env): UITarsMode {
  const raw = (env.UI_TARS_MODE ?? "optional").toLowerCase();
  return raw === "required" ? "required" : "optional";
}

/** UI-TARS remains reachable; `optional` controls startup failure isolation. */
export function uiTarsEnabled(): boolean {
  return true;
}

export function resolveUITarsConfig(env: NodeJS.ProcessEnv = process.env): UITarsAdapterConfig {
  return {
    mode: uiTarsMode(env),
    adapterUrl: env.UI_TARS_ADAPTER_URL ?? "http://127.0.0.1:7719",
    secret: env.UI_TARS_ADAPTER_SECRET ?? "",
    requestTimeoutMs: Number(env.UI_TARS_REQUEST_TIMEOUT_MS ?? 15000) || 15000,
  };
}

// Resolution of UI-TARS runtime mode + loopback adapter connection settings.
//
// UI_TARS_MODE = disabled | optional | required (default: optional).
//  - disabled: never contact the adapter; agent shown as disabled.
//  - optional: try the adapter; if unavailable, Breadboard stays fully usable
//    and the agent shows a diagnostic "unavailable" state.
//  - required: dev/dedicated only; callers may surface an actionable error.

export type UITarsMode = "disabled" | "optional" | "required";

export interface UITarsAdapterConfig {
  mode: UITarsMode;
  adapterUrl: string;
  secret: string;
  requestTimeoutMs: number;
}

export function uiTarsMode(env: NodeJS.ProcessEnv = process.env): UITarsMode {
  const raw = (env.UI_TARS_MODE ?? "optional").toLowerCase();
  if (raw === "disabled" || raw === "required") return raw;
  return "optional";
}

/** True when the dashboard should attempt to talk to the adapter at all. */
export function uiTarsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return uiTarsMode(env) !== "disabled";
}

export function resolveUITarsConfig(env: NodeJS.ProcessEnv = process.env): UITarsAdapterConfig {
  return {
    mode: uiTarsMode(env),
    adapterUrl: env.UI_TARS_ADAPTER_URL ?? "http://127.0.0.1:7719",
    secret: env.UI_TARS_ADAPTER_SECRET ?? "",
    requestTimeoutMs: Number(env.UI_TARS_REQUEST_TIMEOUT_MS ?? 15000) || 15000,
  };
}

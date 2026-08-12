// Resolution of Deep Research mode + loopback service connection settings.
//
// DEEP_RESEARCH_MODE = disabled | optional | required (default: optional).
//  - disabled: never contact the service; the agent is shown as disabled.
//  - optional: try the service; if it is down Breadboard stays fully usable and
//    the agent shows a diagnostic "unavailable" state.
//  - required: dev/dedicated only; callers may surface an actionable error.

export type DeepResearchMode = "disabled" | "optional" | "required";

export interface DeepResearchConfig {
  mode: DeepResearchMode;
  serviceUrl: string;
  secret: string;
  requestTimeoutMs: number;
}

/** Kept away from Postiz supervisor's 7721 default. */
export const DEEP_RESEARCH_DEFAULT_PORT = 7722;

export function deepResearchMode(env: NodeJS.ProcessEnv = process.env): DeepResearchMode {
  const raw = (env.DEEP_RESEARCH_MODE ?? "optional").trim().toLowerCase();
  if (raw === "disabled" || raw === "required") return raw;
  return "optional";
}

/** True when the dashboard should attempt to talk to the service at all. */
export function deepResearchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return deepResearchMode(env) !== "disabled";
}

export function resolveDeepResearchConfig(
  env: NodeJS.ProcessEnv = process.env,
): DeepResearchConfig {
  return {
    mode: deepResearchMode(env),
    serviceUrl:
      env.DEEP_RESEARCH_URL?.trim() ||
      `http://127.0.0.1:${DEEP_RESEARCH_DEFAULT_PORT}`,
    secret: env.DEEP_RESEARCH_SECRET ?? "",
    requestTimeoutMs: Number(env.DEEP_RESEARCH_REQUEST_TIMEOUT_MS ?? 15_000) || 15_000,
  };
}

/** Run-shape limits enforced on both sides of the loopback boundary. */
export const RUN_LIMITS = {
  maxQueryLength: 4_000,
  minBreadth: 1,
  maxBreadth: 10,
  minDepth: 1,
  maxDepth: 5,
} as const;

export interface RunRequest {
  query: string;
  breadth: number;
  depth: number;
  output: "report" | "answer";
}

export type RunRequestValidation =
  | { ok: true; value: RunRequest }
  | { ok: false; error: string };

/** Validate a browser-supplied run request. Returns stable error codes. */
export function validateRunRequest(input: unknown): RunRequestValidation {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "invalid_body" };
  }
  const body = input as Record<string, unknown>;

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || query.length > RUN_LIMITS.maxQueryLength) {
    return { ok: false, error: "invalid_query" };
  }

  const breadth = Number(body.breadth ?? 3);
  if (
    !Number.isInteger(breadth) ||
    breadth < RUN_LIMITS.minBreadth ||
    breadth > RUN_LIMITS.maxBreadth
  ) {
    return { ok: false, error: "invalid_breadth" };
  }

  const depth = Number(body.depth ?? 2);
  if (!Number.isInteger(depth) || depth < RUN_LIMITS.minDepth || depth > RUN_LIMITS.maxDepth) {
    return { ok: false, error: "invalid_depth" };
  }

  const output = body.output === "answer" ? "answer" : "report";
  return { ok: true, value: { query, breadth, depth, output } };
}

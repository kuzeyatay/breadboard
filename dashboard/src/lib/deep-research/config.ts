// Resolution of Deep Research mode + loopback service connection settings.
//
// DEEP_RESEARCH_MODE = optional | required (default: optional).
// "optional" is startup-failure isolation only: the capability remains
// registered and first use still attempts it. Historical `disabled` values are
// normalized to optional rather than hiding a mandatory agent.

import { DEFAULT_BREADTH, DEFAULT_DEPTH } from "./identity.ts";

export type DeepResearchMode = "optional" | "required";

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
  if (raw === "required") return raw;
  return "optional";
}

/** The agent is never hidden; optional only isolates startup failure. */
export function deepResearchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  void env;
  return true;
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

  const breadth = Number(body.breadth ?? DEFAULT_BREADTH);
  if (
    !Number.isInteger(breadth) ||
    breadth < RUN_LIMITS.minBreadth ||
    breadth > RUN_LIMITS.maxBreadth
  ) {
    return { ok: false, error: "invalid_breadth" };
  }

  const depth = Number(body.depth ?? DEFAULT_DEPTH);
  if (!Number.isInteger(depth) || depth < RUN_LIMITS.minDepth || depth > RUN_LIMITS.maxDepth) {
    return { ok: false, error: "invalid_depth" };
  }

  const output = body.output === "answer" ? "answer" : "report";
  return { ok: true, value: { query, breadth, depth, output } };
}

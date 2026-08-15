// Deep Research service: the authorization layer between the authenticated
// dashboard API and the loopback research service. Enforces run ownership (the
// browser only ever names a runId; the userId comes from the session), rate
// limits, and mode gating. No secret crosses into a response.

import {
  DeepResearchClient,
  DeepResearchServiceError as ClientError,
  type RunEvent,
  type RunSummary,
  type ServiceHealth,
} from "./client.ts";
import {
  deepResearchMode,
  resolveDeepResearchConfig,
  validateRunRequest,
  type DeepResearchMode,
} from "./config.ts";
import { ensureDeepResearchService } from "./runtime.ts";
import { composeAgentMemoryContext } from "../conversations/agent-memory-context.ts";

export class DeepResearchError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.name = "DeepResearchError";
  }
}

export type RuntimeState = "available" | "unavailable" | "misconfigured" | "disabled";

const DISABLED_HEALTH: ServiceHealth = {
  status: "unavailable",
  engine: null,
  version: null,
  model: null,
  search: { configured: false, backend: null },
  persistence: { configured: false, healthy: false },
  ready: false,
  activeRuns: 0,
};

// Per-user launch rate limiting. A run costs model quota and search credits, so
// the ceiling is low and deliberate.
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= max) throw new DeepResearchError(429, "rate_limited");
  bucket.count += 1;
}

function client(): DeepResearchClient {
  return new DeepResearchClient(resolveDeepResearchConfig());
}

/** Map a client-side failure code onto an HTTP-shaped service error. */
function translate(error: unknown): DeepResearchError {
  if (error instanceof DeepResearchError) return error;
  if (error instanceof ClientError) {
    switch (error.code) {
      case "unauthorized":
        return new DeepResearchError(503, "service_misconfigured");
      case "run_not_found":
        return new DeepResearchError(404, "run_not_found");
      case "search_not_configured":
        return new DeepResearchError(409, "search_not_configured");
      case "model_not_configured":
        return new DeepResearchError(409, "model_not_configured");
      case "too_many_runs":
        return new DeepResearchError(429, "too_many_runs");
      case "timeout":
      case "unavailable":
        return new DeepResearchError(503, "service_unavailable");
      default:
        return new DeepResearchError(502, error.code);
    }
  }
  return new DeepResearchError(500, "internal_error");
}

export function mode(): DeepResearchMode {
  return deepResearchMode();
}

export async function health(): Promise<{
  mode: DeepResearchMode;
  runtimeState: RuntimeState;
  health: ServiceHealth;
}> {
  const currentMode = deepResearchMode();
  if (currentMode === "disabled") {
    return { mode: currentMode, runtimeState: "disabled", health: DISABLED_HEALTH };
  }
  let serviceHealth = await client().health();
  if (
    serviceHealth.status !== "healthy" &&
    resolveDeepResearchConfig().secret.trim()
  ) {
    await ensureDeepResearchService();
    serviceHealth = await client().health();
  }
  const runtimeState: RuntimeState =
    serviceHealth.status !== "healthy"
      ? "unavailable"
      : serviceHealth.ready
        ? "available"
        : "misconfigured";
  return { mode: currentMode, runtimeState, health: serviceHealth };
}

/** The launching chat, when the caller sent one. Never required. */
function conversationPublicIdFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>).conversationPublicId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireEnabled(): void {
  if (deepResearchMode() === "disabled") throw new DeepResearchError(409, "deep_research_disabled");
  if (!resolveDeepResearchConfig().secret) {
    // Without the shared secret every call would 401; say so instead of
    // reporting the service as merely "down".
    throw new DeepResearchError(503, "service_misconfigured");
  }
}

export async function startRun(userId: number, body: unknown): Promise<RunSummary> {
  requireEnabled();
  await ensureDeepResearchService();
  const validated = validateRunRequest(body);
  if (!validated.ok) throw new DeepResearchError(400, validated.error);
  rateLimit(`run:${userId}`, 5, 10 * 60 * 1000);
  // Durable memory about the user, selected against this question. Never blocks
  // the run: an unavailable memory layer resolves to no context. It travels as
  // its own field rather than inside the query, which the engine embeds in a
  // <prompt> tag to generate search terms — memory belongs in the system
  // prompt, not in what gets searched for.
  const memory = await composeAgentMemoryContext({
    userId,
    agentId: "deep_research",
    query: validated.value.query,
    // Carried alongside the validated request rather than inside it: the run
    // itself has no use for the chat id, only the memory gate does.
    conversationPublicId: conversationPublicIdFrom(body),
  });
  try {
    return await client().createRun({
      ownerUserId: userId,
      ...validated.value,
      userContext: memory?.text ?? "",
    });
  } catch (error) {
    throw translate(error);
  }
}

export async function getRun(userId: number, runId: string): Promise<RunSummary> {
  requireEnabled();
  try {
    return await client().getRun(runId, userId);
  } catch (error) {
    throw translate(error);
  }
}

export async function listEvents(
  userId: number,
  runId: string,
  since: number,
): Promise<RunEvent[]> {
  requireEnabled();
  try {
    return await client().eventsSince(runId, userId, since);
  } catch (error) {
    throw translate(error);
  }
}

export async function abortRun(userId: number, runId: string): Promise<RunSummary> {
  requireEnabled();
  try {
    return await client().abort(runId, userId);
  } catch (error) {
    throw translate(error);
  }
}

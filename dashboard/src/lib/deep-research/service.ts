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
import { DEEP_RESEARCH_AGENT_ID } from "./identity.ts";
import { ensureDeepResearchService } from "./runtime.ts";
import type { EvidenceWebsite } from "../hermes/evidence.ts";
import { composeAgentMemoryContext } from "../conversations/agent-memory-context.ts";
import {
  contextSection,
  conversationContextFromBody,
} from "../conversations/agent-context.ts";

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

function isRecoverableConnectionFailure(error: unknown): boolean {
  return (
    error instanceof ClientError &&
    (error.code === "unavailable" || error.code === "timeout")
  );
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
    agentId: DEEP_RESEARCH_AGENT_ID,
    query: validated.value.query,
    // Carried alongside the validated request rather than inside it: the run
    // itself has no use for the chat id, only the memory gate does.
    conversationPublicId: conversationPublicIdFrom(body),
  });
  try {
    return await client().createRun({
      ownerUserId: userId,
      ...validated.value,
      // The chat travels here for the same reason the memory does: the query
      // is what gets searched for, and an earlier message is background.
      userContext: [
        memory?.text ?? "",
        contextSection(
          conversationContextFromBody(
            userId,
            body && typeof body === "object" ? (body as Record<string, unknown>) : {},
          ),
        ),
      ]
        .filter((section) => section.trim())
        .join("\n\n"),
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
    if (!isRecoverableConnectionFailure(error)) throw translate(error);

    // A run can outlive the Next.js worker that launched the bundled sidecar.
    // Restart it while the event stream is still polling. Its durable snapshot
    // then becomes an explicit service_restarted failure, which lets the chat
    // persist a truthful terminal state instead of counting forever.
    if (!(await ensureDeepResearchService())) throw translate(error);
    try {
      return await client().eventsSince(runId, userId, since);
    } catch (retryError) {
      throw translate(retryError);
    }
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

/**
 * The pages one finished run actually read, for the evidence panel.
 *
 * A delegated run searches in its own process, so nothing it visited appears in
 * the delegating turn's evidence rows — the panel could only report "no
 * sources" about an answer built entirely from those pages. This reads them
 * back from the run's own event log, which is the service's record rather than
 * the browser's, so a listed source is one the run really registered.
 *
 * Never throws and never blocks: an unavailable service, a pruned run or a
 * disabled integration all resolve to an empty list, which the panel renders as
 * the same "no sources" it would have shown anyway.
 */
export async function runWebsites(
  userId: number,
  runId: string,
): Promise<EvidenceWebsite[]> {
  if (deepResearchMode() === "disabled") return [];
  let events: RunEvent[];
  try {
    events = await listEvents(userId, runId, 0);
  } catch {
    return [];
  }

  const byUrl = new Map<string, EvidenceWebsite>();
  const add = (url: unknown, title?: unknown) => {
    if (typeof url !== "string") return;
    const trimmed = url.trim();
    if (!trimmed) return;
    let domain: string | undefined;
    try {
      domain = new URL(trimmed).hostname.replace(/^www\./i, "");
    } catch {
      // A malformed URL still names a page the run read; list it unadorned
      // rather than dropping the only record that it was consulted.
    }
    const existing = byUrl.get(trimmed);
    const named = typeof title === "string" && title.trim() ? title.trim() : undefined;
    if (existing) {
      if (!existing.title && named) existing.title = named;
      return;
    }
    byUrl.set(trimmed, {
      url: trimmed,
      ...(named ? { title: named } : {}),
      ...(domain ? { domain } : {}),
    });
  };

  for (const event of events) {
    // The registered source list is the good one: it carries titles and is what
    // the report's [S1] citations point at. `visitedUrls` is the fallback for a
    // run that failed before its sources were registered — pages it read but
    // never got to cite still belong in the ledger.
    const sources = event.payload?.sources;
    if (Array.isArray(sources)) {
      for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        const record = source as Record<string, unknown>;
        add(record.url, record.title);
      }
    }
    const visited = event.payload?.visitedUrls;
    if (Array.isArray(visited)) for (const url of visited) add(url);
  }

  return [...byUrl.values()];
}

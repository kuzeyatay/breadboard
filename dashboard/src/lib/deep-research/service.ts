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
import type { EvidenceWebsite } from "../hermes/evidence.ts";
import { composeAgentMemoryContext } from "../conversations/agent-memory-context.ts";
import {
  contextSection,
  conversationContextFromBody,
} from "../conversations/agent-context.ts";
import { randomUUID } from "node:crypto";
import {
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
} from "../supervisor-control.ts";
import { readOuterAgentRunView } from "../runtime-v2/outer-agent-run.ts";

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

export type RuntimeState = "available" | "unavailable" | "misconfigured";

const STOPPED_HEALTH: ServiceHealth = {
  status: "unavailable",
  engine: null,
  version: null,
  model: null,
  search: { configured: false, backend: null },
  persistence: { configured: false, healthy: false },
  ready: false,
  activeRuns: 0,
};

function client(): DeepResearchClient {
  return new DeepResearchClient(resolveDeepResearchConfig());
}

function translate(error: unknown): DeepResearchError {
  if (error instanceof DeepResearchError) return error;
  if (error instanceof ClientError) {
    const status = error.code === "run_not_found"
      ? 404
      : error.code === "too_many_runs"
        ? 429
        : ["search_not_configured", "model_not_configured"].includes(error.code)
          ? 409
          : ["unauthorized", "timeout", "unavailable"].includes(error.code)
            ? 503
            : 502;
    return new DeepResearchError(status, error.code);
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
  if (isRuntimeV2ServiceControlConfigured()) {
    const snapshot = await readSupervisedServiceSnapshot("deep-research");
    if (!snapshot) {
      return { mode: currentMode, runtimeState: "unavailable", health: STOPPED_HEALTH };
    }
    if (snapshot.state === "available-but-stopped" || snapshot.state === "stopped") {
      return { mode: currentMode, runtimeState: "available", health: STOPPED_HEALTH };
    }
    if (
      snapshot.state === "installation-unavailable" ||
      snapshot.state === "resource-blocked" ||
      snapshot.state === "failed"
    ) {
      return { mode: currentMode, runtimeState: "unavailable", health: STOPPED_HEALTH };
    }
  }
  const serviceHealth = await client().health();
  const runtimeState: RuntimeState =
    serviceHealth.status !== "healthy"
      ? "unavailable"
      : serviceHealth.ready
        ? "available"
        : "misconfigured";
  return { mode: currentMode, runtimeState, health: serviceHealth };
}

/**
 * Worker-internal direct sidecar API used by Max Research's optional nested
 * participant. Public Deep Research routes never call these functions; their
 * finite attempts go through runtime-run-manager.ts. The Max coordinator is
 * itself a fresh Runtime worker and receives only this service capability.
 */
export async function startRun(userId: number, body: unknown): Promise<RunSummary> {
  if (!resolveDeepResearchConfig().secret) {
    throw new DeepResearchError(503, "service_misconfigured");
  }
  const validated = validateRunRequest(body);
  if (!validated.ok) throw new DeepResearchError(400, validated.error);
  const request = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const conversationPublicId = typeof request.conversationPublicId === "string"
    ? request.conversationPublicId.trim() || null
    : null;
  const memory = await composeAgentMemoryContext({
    userId,
    agentId: DEEP_RESEARCH_AGENT_ID,
    query: validated.value.query,
    conversationPublicId,
  });
  try {
    return await client().createRun({
      runId: `drrun_${randomUUID().replaceAll("-", "")}`,
      ownerUserId: userId,
      ...validated.value,
      userContext: [
        memory?.text ?? "",
        contextSection(conversationContextFromBody(userId, request)),
      ].filter((section) => section.trim()).join("\n\n"),
    });
  } catch (error) {
    throw translate(error);
  }
}

export async function getRun(userId: number, runId: string): Promise<RunSummary> {
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
  try {
    return await client().eventsSince(runId, userId, since);
  } catch (error) {
    throw translate(error);
  }
}

export async function abortRun(userId: number, runId: string): Promise<RunSummary> {
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
 * unavailable integration all resolve to an empty list, which the panel renders as
 * the same "no sources" it would have shown anyway.
 */
export async function runWebsites(
  userId: number,
  runId: string,
): Promise<EvidenceWebsite[]> {
  let events: readonly RunEvent[];
  try {
    events = (await readOuterAgentRunView("deep-research", userId, runId, 0)).events;
  } catch {
    try {
      // Max Research can run an optional nested participant directly inside
      // its own Runtime worker; that sidecar sub-run has no outer correlation.
      events = await client().eventsSince(runId, userId, 0);
    } catch {
      return [];
    }
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

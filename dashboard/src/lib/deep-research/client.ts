// Typed dashboard client for the loopback Deep Research service.
//
// Every call carries an AbortSignal-backed timeout and collapses failures to
// stable codes — a raw stack, path, or secret never reaches the browser. The
// service secret is held only here (server-side).

import {
  resolveDeepResearchConfig,
  type DeepResearchConfig,
} from "./config.ts";

export interface ServiceHealth {
  status: "healthy" | "unavailable";
  engine: string | null;
  version: string | null;
  model: { provider: string; model: string; endpoint: string | null } | null;
  search: { configured: boolean; backend: string | null };
  persistence: { configured: boolean; healthy: boolean };
  ready: boolean;
  activeRuns: number;
}

export interface RunSummary {
  runId: string;
  ownerUserId: number;
  status: "running" | "completed" | "failed" | "aborted";
  query: string;
  breadth: number;
  depth: number;
  output: "report" | "answer";
  createdAt: string;
  completedAt?: string;
  lastSequence: number;
  learningCount: number;
  sourceCount: number;
  evidenceCount?: number;
  warningCount?: number;
  budget?: {
    searches: number;
    modelCalls: number;
    sources: number;
    tokens: number;
    elapsedMs: number;
    stoppedReason?: string;
  };
  coverage?: {
    totalClaims: number;
    citedClaims: number;
    ratio: number;
    referencedSources: number;
    totalSources: number;
    sourceRatio: number;
  };
  result?: string;
  failure?: { code: string; message: string };
}

export interface RunEvent {
  sequenceNumber: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export class DeepResearchServiceError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "DeepResearchServiceError";
  }
}

const UNAVAILABLE_HEALTH: ServiceHealth = {
  status: "unavailable",
  engine: null,
  version: null,
  model: null,
  search: { configured: false, backend: null },
  persistence: { configured: false, healthy: false },
  ready: false,
  activeRuns: 0,
};

export class DeepResearchClient {
  private config: DeepResearchConfig;

  constructor(config: DeepResearchConfig = resolveDeepResearchConfig()) {
    this.config = config;
  }

  private async call<T>(method: string, pathName: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const res = await fetch(new URL(pathName, this.config.serviceUrl), {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.secret}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({ ok: false, error: "invalid_response" }))) as {
        ok?: boolean;
        error?: string;
        data?: T;
      };
      if (!res.ok || data.ok === false) {
        throw new DeepResearchServiceError(
          typeof data.error === "string" ? data.error : "service_error",
        );
      }
      return data.data as T;
    } catch (error) {
      if (error instanceof DeepResearchServiceError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new DeepResearchServiceError("timeout");
      }
      throw new DeepResearchServiceError("unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<ServiceHealth> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(this.config.requestTimeoutMs, 4_000),
    );
    try {
      const res = await fetch(new URL("/health", this.config.serviceUrl), {
        signal: controller.signal,
      });
      if (!res.ok) return UNAVAILABLE_HEALTH;
      return normalizeHealth(await res.json());
    } catch {
      return UNAVAILABLE_HEALTH;
    } finally {
      clearTimeout(timer);
    }
  }

  createRun(params: {
    ownerUserId: number;
    query: string;
    /** Background about the requester; the service keeps it out of summaries. */
    userContext?: string;
    breadth: number;
    depth: number;
    output: "report" | "answer";
  }): Promise<RunSummary> {
    return this.call<RunSummary>("POST", "/runs", params);
  }

  getRun(runId: string, userId: number): Promise<RunSummary> {
    return this.call<RunSummary>(
      "GET",
      `/runs/${encodeURIComponent(runId)}?userId=${userId}`,
    );
  }

  eventsSince(runId: string, userId: number, since: number): Promise<RunEvent[]> {
    return this.call<RunEvent[]>(
      "GET",
      `/runs/${encodeURIComponent(runId)}/events?userId=${userId}&since=${since}`,
    );
  }

  abort(runId: string, userId: number): Promise<RunSummary> {
    return this.call<RunSummary>("POST", `/runs/${encodeURIComponent(runId)}/abort`, { userId });
  }
}

/** Shape an untrusted /health body into the redacted status the UI consumes. */
export function normalizeHealth(input: unknown): ServiceHealth {
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  const rawModel = (typeof body.model === "object" && body.model !== null
    ? body.model
    : null) as Record<string, unknown> | null;
  const rawSearch = (typeof body.search === "object" && body.search !== null
    ? body.search
    : {}) as Record<string, unknown>;
  const rawPersistence = (
    typeof body.persistence === "object" && body.persistence !== null
      ? body.persistence
      : {}
  ) as Record<string, unknown>;

  const provider = typeof rawModel?.provider === "string" ? rawModel.provider : "";
  const model = typeof rawModel?.model === "string" ? rawModel.model : "";

  const isDeepResearch =
    body.status === "ok" && body.engine === "open-deep-research";
  if (!isDeepResearch) return { ...UNAVAILABLE_HEALTH };

  return {
    status: "healthy",
    engine: typeof body.engine === "string" ? body.engine : null,
    version: typeof body.version === "string" ? body.version : null,
    model: provider
      ? {
          provider,
          model,
          endpoint: typeof rawModel?.endpoint === "string" ? rawModel.endpoint : null,
        }
      : null,
    search: {
      configured: Boolean(rawSearch.configured),
      backend: typeof rawSearch.backend === "string" ? rawSearch.backend : null,
    },
    persistence: {
      configured: Boolean(rawPersistence.configured),
      healthy: Boolean(rawPersistence.healthy),
    },
    ready: Boolean(body.ready),
    activeRuns: Number.isFinite(Number(body.activeRuns)) ? Number(body.activeRuns) : 0,
  };
}

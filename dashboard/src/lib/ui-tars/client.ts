// Typed dashboard client for the loopback UI-TARS adapter.
//
// Every method carries an AbortSignal-backed timeout and returns a normalized,
// redacted result. Adapter errors collapse to stable codes — a raw stack, path,
// or secret never propagates to the browser or the model. The adapter secret is
// held only here (server-side) and is never sent to the frontend.

import { resolveUITarsConfig, type UITarsAdapterConfig } from "./adapter-config.ts";

export interface AdapterHealth {
  status: "healthy" | "unavailable";
  runtime: "fake" | "agent-tars" | null;
  realBrowser: boolean;
  operator: "browser" | null;
  operators?: Array<"browser" | "computer">;
  version: string | null;
}

export interface AdapterCapabilities {
  runtime: "fake" | "agent-tars";
  operator: "browser";
  operators: Array<"browser" | "computer">;
  strategies: Array<"gui" | "dom" | "hybrid">;
  realBrowser: boolean;
  version: string;
}

export interface AdapterRunSummary {
  runId: string;
  ownerUserId: number;
  status: string;
  task: string;
  operatorType: "browser" | "computer";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failure?: { code: string; message: string };
  lastSequence: number;
  pendingApproval?: {
    actionId: string;
    action: string;
    target: string;
    explanation: string;
    risk: string;
    screenshotBefore?: string;
    requestedAt: string;
    expiresAt: string;
  };
}

export interface AdapterEvent {
  runId: string;
  sequenceNumber: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export class UITarsAdapterError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "UITarsAdapterError";
  }
}

export class UITarsClient {
  private config: UITarsAdapterConfig;

  constructor(config: UITarsAdapterConfig = resolveUITarsConfig()) {
    this.config = config;
  }

  private authHeaders(): Record<string, string> {
    return { "content-type": "application/json", authorization: `Bearer ${this.config.secret}` };
  }

  private async call<T>(method: string, pathName: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const res = await fetch(new URL(pathName, this.config.adapterUrl), {
        method,
        headers: this.authHeaders(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({ ok: false, error: "invalid_response" }))) as {
        ok?: boolean;
        error?: string;
        data?: T;
      };
      if (!res.ok || data.ok === false) {
        throw new UITarsAdapterError(typeof data.error === "string" ? data.error : "adapter_error");
      }
      return data.data as T;
    } catch (err) {
      if (err instanceof UITarsAdapterError) throw err;
      if (err instanceof Error && err.name === "AbortError") throw new UITarsAdapterError("timeout");
      throw new UITarsAdapterError("unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<AdapterHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.config.requestTimeoutMs, 4000));
    try {
      const res = await fetch(new URL("/health", this.config.adapterUrl), { signal: controller.signal });
      const data = (await res.json()) as Partial<AdapterHealth> & { runtime?: string };
      return {
        status: data.status === "healthy" ? "healthy" : "unavailable",
        runtime: data.runtime === "fake" || data.runtime === "agent-tars" ? data.runtime : null,
        realBrowser: Boolean(data.realBrowser),
        operator: data.operator === "browser" ? "browser" : null,
        ...(Array.isArray(data.operators)
          ? { operators: data.operators.filter((operator): operator is "browser" | "computer" => operator === "browser" || operator === "computer") }
          : {}),
        version: typeof data.version === "string" ? data.version : null,
      };
    } catch {
      return { status: "unavailable", runtime: null, realBrowser: false, operator: null, version: null };
    } finally {
      clearTimeout(timer);
    }
  }

  capabilities(): Promise<AdapterCapabilities> {
    return this.call<AdapterCapabilities>("GET", "/capabilities");
  }

  createRun(params: {
    runId: string;
    ownerUserId: number;
    task: string;
    config: unknown;
    providerApiKey?: string;
  }): Promise<AdapterRunSummary> {
    return this.call<AdapterRunSummary>("POST", "/runs", params);
  }

  getRun(runId: string, userId: number): Promise<AdapterRunSummary> {
    return this.call<AdapterRunSummary>("GET", `/runs/${encodeURIComponent(runId)}?userId=${userId}`);
  }

  eventsSince(runId: string, userId: number, since: number): Promise<AdapterEvent[]> {
    return this.call<AdapterEvent[]>(
      "GET",
      `/runs/${encodeURIComponent(runId)}/events?userId=${userId}&since=${since}`,
    );
  }

  approve(runId: string, userId: number, actionId: string): Promise<void> {
    return this.call<void>("POST", `/runs/${encodeURIComponent(runId)}/approve`, { userId, actionId });
  }

  reject(runId: string, userId: number, actionId: string): Promise<void> {
    return this.call<void>("POST", `/runs/${encodeURIComponent(runId)}/reject`, { userId, actionId });
  }

  abort(runId: string, userId: number): Promise<void> {
    return this.call<void>("POST", `/runs/${encodeURIComponent(runId)}/abort`, { userId });
  }

  restoreScreenshotHistory(runId: string, userId: number): Promise<void> {
    return this.call<void>(
      "POST",
      `/runs/${encodeURIComponent(runId)}/screenshots/restore`,
      { userId },
    );
  }

  /** Fetch a screenshot's PNG bytes (server-side; served to browser via our route). */
  async screenshot(runId: string, userId: number, screenshotId: string): Promise<Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const url = new URL(
        `/runs/${encodeURIComponent(runId)}/screenshots/${encodeURIComponent(screenshotId)}?userId=${userId}`,
        this.config.adapterUrl,
      );
      const res = await fetch(url, { headers: { authorization: `Bearer ${this.config.secret}` }, signal: controller.signal });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

// Typed dashboard client for the loopback GBrain adapter.
//
// Every method carries an AbortSignal-backed timeout and returns a normalized,
// redacted result. Adapter errors are collapsed to stable codes — a raw stack,
// path, or the secret never propagates to the browser or the model.

import { resolveGBrainConfig, type GBrainConfig } from "./config.ts";

export interface AdapterCitation {
  sourceId: string;
  pageId?: string;
  title: string;
  path?: string;
  excerpt?: string;
  score?: number;
}

export interface AdapterSearchResult {
  title: string;
  excerpt: string;
  citation: AdapterCitation;
}

export interface AdapterScope {
  userId: string;
  authorizedSourceIds: string[];
}

export interface AdapterHealth {
  status: "healthy" | "degraded" | "unavailable";
  ready: boolean;
  mode: "hybrid" | "lexical_degraded" | null;
  embeddingsAvailable: boolean;
  sources: number;
  pages: number;
  chunks: number;
}

export class GBrainAdapterError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "GBrainAdapterError";
  }
}

export class GBrainClient {
  private config: GBrainConfig;
  constructor(config: GBrainConfig = resolveGBrainConfig()) {
    this.config = config;
  }

  private async call<T>(pathName: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.queryTimeoutMs);
    if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const res = await fetch(new URL(pathName, this.config.adapterUrl), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.secret}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({ ok: false, error: "invalid_response" }))) as {
        ok?: boolean;
        error?: string;
        data?: T;
      };
      if (!res.ok || data.ok === false) {
        // The adapter already returns sanitized codes; pass them through as-is.
        throw new GBrainAdapterError(typeof data.error === "string" ? data.error : "adapter_error");
      }
      return data.data as T;
    } catch (err) {
      if (err instanceof GBrainAdapterError) throw err;
      if (err instanceof Error && err.name === "AbortError") throw new GBrainAdapterError("timeout");
      // Network failure (adapter down) — collapse to a stable, path-free code.
      throw new GBrainAdapterError("unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  async health(signal?: AbortSignal): Promise<AdapterHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.config.queryTimeoutMs, 5000));
    if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const res = await fetch(new URL("/health", this.config.adapterUrl), { signal: controller.signal });
      const data = (await res.json()) as Partial<AdapterHealth> & { mode?: string };
      return {
        status: data.status === "healthy" ? "healthy" : "degraded",
        ready: Boolean(data.ready),
        mode: data.mode === "hybrid" || data.mode === "lexical_degraded" ? data.mode : null,
        embeddingsAvailable: Boolean(data.embeddingsAvailable),
        sources: Number(data.sources) || 0,
        pages: Number(data.pages) || 0,
        chunks: Number(data.chunks) || 0,
      };
    } catch {
      return {
        status: "unavailable",
        ready: false,
        mode: null,
        embeddingsAvailable: false,
        sources: 0,
        pages: 0,
        chunks: 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  search(
    scope: AdapterScope,
    query: string,
    sourceIds?: string[],
    limit?: number,
    signal?: AbortSignal,
  ): Promise<{ results: AdapterSearchResult[]; mode: string; warnings: string[] }> {
    return this.call("/search", { scope, query, sourceIds, limit }, signal);
  }

  retrieve(
    scope: AdapterScope,
    sourceId: string,
    pageId: string,
    signal?: AbortSignal,
  ): Promise<{
    found: boolean;
    title?: string;
    path?: string;
    content?: string;
    citation?: AdapterCitation;
    warnings: string[];
  }> {
    return this.call("/retrieve", { scope, sourceId, pageId }, signal);
  }

  synthesize(
    scope: AdapterScope,
    query: string,
    sourceIds?: string[],
    limit?: number,
    signal?: AbortSignal,
  ): Promise<{ synthesis: string; citations: AdapterCitation[]; mode: string; warnings: string[] }> {
    return this.call("/synthesize", { scope, query, sourceIds, limit }, signal);
  }

  graph(
    scope: AdapterScope,
    pageId: string,
    sourceId?: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<{
    neighbors: Array<{ sourceId: string; pageId: string; title: string; relation: string }>;
    warnings: string[];
  }> {
    return this.call("/graph", { scope, pageId, sourceId, limit }, signal);
  }

  registerSource(
    sourceId: string,
    label: string,
    pages: Array<{ pageId: string; title: string; path: string; content: string; links?: string[] }>,
    signal?: AbortSignal,
  ): Promise<{
    sourceId: string;
    pagesIndexed: number;
    chunksIndexed: number;
    embedded: boolean;
    mode: string;
    revision: string;
    warnings: string[];
  }> {
    return this.call("/register-source", { sourceId, label, pages }, signal);
  }
}

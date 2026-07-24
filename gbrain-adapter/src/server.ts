// Breadboard GBrain adapter HTTP server (Bun).
//
// Binds ONLY to loopback, authenticates every request with a per-launch secret,
// and exposes only the narrow operations Breadboard needs. There is no admin
// surface, no MCP endpoint, no unrestricted file read. Errors returned to callers
// are sanitized — never a raw stack, path, or the secret.

import crypto from "node:crypto";
import { resolveConfig, assertSecret, type AdapterConfig } from "./config.ts";
import { selectBackend } from "./backends/select.ts";
import type { RetrievalBackend } from "./backends/types.ts";
import type { GBrainScope } from "./types.ts";

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Sanitized error — the message is a stable code, never a stack or a path. */
function errorResponse(code: string, status: number): Response {
  return json({ ok: false, error: code }, status);
}

function isScope(value: unknown): value is GBrainScope {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as GBrainScope).userId === "string" &&
    Array.isArray((value as GBrainScope).authorizedSourceIds)
  );
}

export interface AdapterServer {
  stop(): Promise<void>;
  port: number;
  store: RetrievalBackend;
}

export async function startAdapter(
  overrides: Partial<AdapterConfig> = {},
): Promise<AdapterServer> {
  const config: AdapterConfig = { ...resolveConfig(), ...overrides };
  assertSecret(config);

  // Select the production (vendored GBrain) or the test-only fake backend.
  const { backend: store } = selectBackend(process.env, config.pgDir, config.embeddingProvider);
  await store.init();

  const authorized = (req: Request): boolean => {
    const header = req.headers.get("authorization") ?? "";
    const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    return bearer.length > 0 && timingSafeEqual(bearer, config.secret);
  };

  const withTimeout = async <T>(fn: () => Promise<T>): Promise<T> => {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("query_timeout")), config.queryTimeoutMs),
      ),
    ]);
  };

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    async fetch(req) {
      const url = new URL(req.url);
      const pathName = url.pathname;

      // Health/readiness are unauthenticated liveness probes but leak nothing
      // sensitive (no paths, no secret, no source content).
      if (pathName === "/health" || pathName === "/ready") {
        const stats = await store.stats().catch(() => ({ sources: 0, pages: 0, chunks: 0 }));
        return json({
          status: "healthy",
          ready: true,
          // Truthful backend identity: "gbrain" (real vendored engine) or "fake".
          backend: store.backendName,
          mode: store.mode,
          embeddingProvider: store.providerName,
          embeddingsAvailable: store.embeddingsAvailable,
          sources: stats.sources,
          pages: stats.pages,
          chunks: stats.chunks,
          dataDir: config.pgDir === ":memory:" ? ":memory:" : "configured",
          version: config.version,
        });
      }

      if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
      if (!authorized(req)) return errorResponse("unauthorized", 401);

      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return errorResponse("invalid_json", 400);
      }

      try {
        switch (pathName) {
          case "/register-source": {
            const sourceId = String(body.sourceId ?? "");
            const label = String(body.label ?? "");
            const pages = Array.isArray(body.pages) ? (body.pages as never[]) : [];
            if (!sourceId || !label) return errorResponse("missing_source", 400);
            const result = await withTimeout(() => store.registerSource(sourceId, label, pages));
            return json({ ok: true, data: result });
          }
          case "/search": {
            if (!isScope(body.scope)) return errorResponse("missing_scope", 400);
            const result = await withTimeout(() =>
              store.search(
                body.scope as GBrainScope,
                String(body.query ?? ""),
                Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : undefined,
                Number(body.limit) || 8,
              ),
            );
            return json({ ok: true, data: result });
          }
          case "/retrieve": {
            if (!isScope(body.scope)) return errorResponse("missing_scope", 400);
            const result = await withTimeout(() =>
              store.retrieve(body.scope as GBrainScope, String(body.sourceId ?? ""), String(body.pageId ?? "")),
            );
            return json({ ok: true, data: result });
          }
          case "/synthesize": {
            if (!isScope(body.scope)) return errorResponse("missing_scope", 400);
            const result = await withTimeout(() =>
              store.synthesize(
                body.scope as GBrainScope,
                String(body.query ?? ""),
                Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : undefined,
                Number(body.limit) || 6,
              ),
            );
            return json({ ok: true, data: result });
          }
          case "/graph": {
            if (!isScope(body.scope)) return errorResponse("missing_scope", 400);
            const result = await withTimeout(() =>
              store.graphNeighbors(
                body.scope as GBrainScope,
                String(body.pageId ?? ""),
                typeof body.sourceId === "string" ? body.sourceId : undefined,
                Number(body.limit) || 12,
              ),
            );
            return json({ ok: true, data: result });
          }
          default:
            return errorResponse("not_found", 404);
        }
      } catch (err) {
        const code = err instanceof Error && err.message === "query_timeout" ? "query_timeout" : "internal_error";
        return errorResponse(code, code === "query_timeout" ? 504 : 500);
      }
    },
  });

  return {
    port: server.port,
    store,
    async stop() {
      await server.stop(true);
      await store.close();
    },
  };
}

// Direct execution entrypoint.
if (import.meta.main) {
  startAdapter()
    .then((s) => {
      console.log(`[gbrain-adapter] listening on 127.0.0.1:${s.port}`);
      const shutdown = () => {
        s.stop().finally(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      // Only the stable message, never a stack with paths/secrets.
      console.error(`[gbrain-adapter] failed to start: ${err instanceof Error ? err.message : "unknown"}`);
      process.exit(1);
    });
}

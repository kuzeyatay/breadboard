import crypto from "node:crypto";
import type { AdapterConfig } from "./config.ts";
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

const OPERATION_PATHS = new Set([
  "/register-source",
  "/search",
  "/retrieve",
  "/synthesize",
  "/graph",
  "/embed",
]);

export interface AdapterRequestHandler {
  (request: Request): Promise<Response>;
  /** Stop admitting work before the owning transport begins shutdown. */
  stopAccepting(): void;
  /** Wait without a deadline for the one admitted backend operation to settle. */
  waitForIdle(): Promise<void>;
  /** Bounded idle wait used by transport shutdown. */
  drain(timeoutMs: number): Promise<boolean>;
}

interface OperationAdmission {
  run<T>(operation: () => Promise<T>): Promise<T>;
  /** Release a reservation that failed validation before backend work began. */
  releaseIfUnused(): void;
}

class AdapterOperationError extends Error {
  constructor(
    readonly code: "backend_busy" | "query_timeout" | "shutting_down",
    readonly status: 503 | 504,
  ) {
    super(code);
  }
}

function operationError(error: unknown): { code: string; status: number } {
  if (error instanceof AdapterOperationError) {
    return { code: error.code, status: error.status };
  }
  if (error instanceof Error && error.message === "query_timeout") {
    return { code: "query_timeout", status: 504 };
  }
  return { code: "internal_error", status: 500 };
}

/**
 * Runtime-neutral GBrain HTTP boundary.
 *
 * Bun and Node own only socket transport. Authentication, routing, timeouts,
 * scope checks, and sanitized errors remain one implementation so switching
 * runtimes cannot silently change the adapter's trust boundary.
 */
export function createAdapterRequestHandler(
  store: RetrievalBackend,
  config: AdapterConfig,
): AdapterRequestHandler {
  const authorized = (req: Request): boolean => {
    const header = req.headers.get("authorization") ?? "";
    const bearer = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : "";
    return bearer.length > 0 && timingSafeEqual(bearer, config.secret);
  };

  let accepting = true;
  let activeOperation: Promise<void> | null = null;

  /**
   * Reserve the only operation slot before JSON body materialization. This is
   * deliberately separate from starting backend work: invalid JSON and failed
   * validation release the reservation without touching the store, while a
   * timed-out backend operation retains it until the uncancellable work settles.
   */
  const admitOperation = (): OperationAdmission => {
    if (!accepting) throw new AdapterOperationError("shutting_down", 503);
    if (activeOperation !== null) throw new AdapterOperationError("backend_busy", 503);

    let resolveIdle!: () => void;
    const reservation = new Promise<void>((resolve) => {
      resolveIdle = resolve;
    });
    activeOperation = reservation;
    let started = false;
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      if (activeOperation === reservation) activeOperation = null;
      resolveIdle();
    };

    return {
      async run<T>(fn: () => Promise<T>): Promise<T> {
        if (started) throw new Error("operation_admission_already_used");
        started = true;
        const operation = Promise.resolve().then(fn);
        void operation.then(release, release);

        let timeout: ReturnType<typeof setTimeout> | null = null;
        try {
          return await Promise.race([
            operation,
            new Promise<T>((_, reject) => {
              timeout = setTimeout(
                () => reject(new AdapterOperationError("query_timeout", 504)),
                config.queryTimeoutMs,
              );
            }),
          ]);
        } finally {
          if (timeout !== null) clearTimeout(timeout);
        }
      },
      releaseIfUnused() {
        if (!started) release();
      },
    };
  };

  const runOperation = async <T>(fn: () => Promise<T>): Promise<T> => {
    const admission = admitOperation();
    try {
      return await admission.run(fn);
    } finally {
      admission.releaseIfUnused();
    }
  };

  const statusPayload = (
    stats: { sources: number; pages: number; chunks: number },
    ready: boolean,
    status: "healthy" | "unhealthy",
    error?: string,
  ): Record<string, unknown> => ({
    status,
    ready,
    ...(error ? { error } : {}),
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

  const handler = (async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathName = url.pathname;

    // Health/readiness are unauthenticated liveness probes but leak nothing
    // sensitive (no paths, no secret, no source content).
    if (pathName === "/health" || pathName === "/ready") {
      try {
        const stats = await runOperation(() => store.stats());
        return json(statusPayload(stats, true, "healthy"));
      } catch (error) {
        const failure = operationError(error);
        const unavailable = statusPayload(
          { sources: 0, pages: 0, chunks: 0 },
          false,
          pathName === "/ready" ? "unhealthy" : "healthy",
          failure.code,
        );
        // Liveness remains process-only. Readiness fails closed whenever the
        // store cannot prove it is usable.
        return json(unavailable, pathName === "/ready" ? 503 : 200);
      }
    }

    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    if (!authorized(req)) return errorResponse("unauthorized", 401);
    if (!accepting) return errorResponse("shutting_down", 503);
    if (!OPERATION_PATHS.has(pathName)) {
      return errorResponse("not_found", 404);
    }

    let admission: OperationAdmission;
    try {
      // Reserve before req.json(): rejected concurrent requests never parse or
      // retain their potentially 64 MiB payloads.
      admission = admitOperation();
    } catch (error) {
      const failure = operationError(error);
      return errorResponse(failure.code, failure.status);
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      admission.releaseIfUnused();
      return errorResponse("invalid_json", 400);
    }

    try {
      switch (pathName) {
        case "/embed": {
          const texts = Array.isArray(body.texts) ? body.texts : [];
          if (
            texts.length < 1 ||
            texts.length > 64 ||
            texts.some((text) => typeof text !== "string" || text.length < 1 || Buffer.byteLength(text, "utf8") > 16_000) ||
            texts.reduce((total, text) => total + Buffer.byteLength(String(text), "utf8"), 0) > 256_000
          ) {
            return errorResponse("invalid_embedding_batch", 400);
          }
          if (!store.embeddingsAvailable) return errorResponse("embedding_unavailable", 503);
          const result = await admission.run(() => store.embedTexts(texts as string[]));
          return json({ ok: true, data: result });
        }
        case "/register-source": {
          const sourceId = String(body.sourceId ?? "");
          const label = String(body.label ?? "");
          const pages = Array.isArray(body.pages) ? (body.pages as never[]) : [];
          if (!sourceId || !label) return errorResponse("missing_source", 400);
          const result = await admission.run(() =>
            store.registerSource(sourceId, label, pages),
          );
          return json({ ok: true, data: result });
        }
        case "/search": {
          if (!isScope(body.scope)) return errorResponse("missing_scope", 400);
          const result = await admission.run(() =>
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
          const result = await admission.run(() =>
            store.retrieve(
              body.scope as GBrainScope,
              String(body.sourceId ?? ""),
              String(body.pageId ?? ""),
            ),
          );
          return json({ ok: true, data: result });
        }
        case "/synthesize": {
          if (!isScope(body.scope)) return errorResponse("missing_scope", 400);
          const result = await admission.run(() =>
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
          const result = await admission.run(() =>
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
      const failure = operationError(err);
      return errorResponse(failure.code, failure.status);
    } finally {
      admission.releaseIfUnused();
    }
  }) as AdapterRequestHandler;

  handler.stopAccepting = () => {
    accepting = false;
  };
  handler.waitForIdle = async () => {
    while (activeOperation !== null) {
      await activeOperation;
    }
  };
  handler.drain = async (timeoutMs: number) => {
    if (activeOperation === null) return true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        handler.waitForIdle().then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
        }),
      ]);
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  };
  return handler;
}

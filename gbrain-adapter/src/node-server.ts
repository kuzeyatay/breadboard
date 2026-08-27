// Breadboard GBrain adapter HTTP server (Node 24).
//
// Node owns only the loopback socket bridge. The authenticated request surface
// is shared byte-for-byte with the Bun entrypoint in request-handler.ts.

import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { type AddressInfo } from "node:net";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  resolveConfig,
  assertLoopbackHost,
  assertSecret,
  type AdapterConfig,
} from "./config.ts";
import { selectBackend } from "./backends/select.ts";
import type { RetrievalBackend } from "./backends/types.ts";
import { createAdapterRequestHandler } from "./request-handler.ts";
import type { AdapterServer } from "./server.ts";

export const DEFAULT_NODE_REQUEST_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

export interface NodeAdapterTransportOptions {
  maxRequestBodyBytes?: number;
  shutdownDrainTimeoutMs?: number;
}

class RequestBodyTooLargeError extends Error {}

interface ConvertedWebRequest {
  request: Request;
  bodyLimitExceeded(): boolean;
}

function webHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) result.append(name, entry);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

function webRequest(
  request: IncomingMessage,
  maxRequestBodyBytes: number,
): ConvertedWebRequest {
  const method = request.method?.toUpperCase() || "GET";
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: webHeaders(request.headers),
  };
  let bodyLimitExceeded = false;
  if (method !== "GET" && method !== "HEAD") {
    const declaredLength = request.headers["content-length"];
    if (
      typeof declaredLength === "string" &&
      Number(declaredLength) > maxRequestBodyBytes
    ) {
      throw new RequestBodyTooLargeError();
    }
    let receivedBytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        receivedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        if (receivedBytes > maxRequestBodyBytes) {
          bodyLimitExceeded = true;
          callback(new RequestBodyTooLargeError());
          return;
        }
        callback(null, chunk);
      },
    });
    limiter.once("error", () => {
      request.unpipe(limiter);
      request.resume();
    });
    request.pipe(limiter);
    init.body = Readable.toWeb(limiter) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return {
    request: new Request(url, init),
    bodyLimitExceeded: () => bodyLimitExceeded,
  };
}

function disposeUnreadRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (request.complete) return;
  response.shouldKeepAlive = false;
  if (!response.headersSent) response.setHeader("connection", "close");
  response.once("finish", () => request.socket.destroy());
  request.resume();
}

function sendTransportError(
  response: ServerResponse,
  status: number,
  code: string,
): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body = JSON.stringify({ ok: false, error: code });
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function writeWebResponse(
  source: Response,
  destination: ServerResponse,
): Promise<void> {
  destination.statusCode = source.status;
  source.headers.forEach((value, name) => destination.setHeader(name, value));
  if (!source.body) {
    destination.end();
    return;
  }
  await pipeline(Readable.fromWeb(source.body), destination);
}

/** Close a partially initialized store before surfacing its startup failure. */
export async function initializeNodeAdapterStore(store: RetrievalBackend): Promise<void> {
  try {
    await store.init();
  } catch (error) {
    await store.close().catch(() => {});
    throw error;
  }
}

async function settlesWithin(operation: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

export async function startNodeAdapter(
  overrides: Partial<AdapterConfig> = {},
  transportOptions: NodeAdapterTransportOptions = {},
): Promise<AdapterServer> {
  const config: AdapterConfig = { ...resolveConfig(), ...overrides };
  assertSecret(config);
  assertLoopbackHost(config);

  const maxRequestBodyBytes = positiveInteger(
    transportOptions.maxRequestBodyBytes,
    DEFAULT_NODE_REQUEST_BODY_LIMIT_BYTES,
  );
  const shutdownDrainTimeoutMs = positiveInteger(
    transportOptions.shutdownDrainTimeoutMs,
    Math.max(1_000, Math.min(config.queryTimeoutMs * 2, 30_000)),
  );

  const { backend: store } = selectBackend(
    process.env,
    config.pgDir,
    config.embeddingProvider,
  );
  await initializeNodeAdapterStore(store);
  const handleRequest = createAdapterRequestHandler(store, config);

  const inFlightRequests = new Set<Promise<void>>();
  const server = http.createServer((request, response) => {
    const task = (async () => {
      let converted: ConvertedWebRequest;
      try {
        converted = webRequest(request, maxRequestBodyBytes);
      } catch (error) {
        disposeUnreadRequest(request, response);
        sendTransportError(
          response,
          error instanceof RequestBodyTooLargeError ? 413 : 400,
          error instanceof RequestBodyTooLargeError
            ? "request_too_large"
            : "invalid_request",
        );
        return;
      }

      try {
        const handled = await handleRequest(converted.request);
        if (converted.bodyLimitExceeded()) {
          disposeUnreadRequest(request, response);
          sendTransportError(response, 413, "request_too_large");
          return;
        }
        if (!converted.request.bodyUsed) disposeUnreadRequest(request, response);
        await writeWebResponse(handled, response);
      } catch {
        sendTransportError(response, 500, "internal_error");
      }
    })();
    inFlightRequests.add(task);
    void task.then(
      () => inFlightRequests.delete(task),
      () => inFlightRequests.delete(task),
    );
  });
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(config.port, config.host);
    });
  } catch (error) {
    await store.close().catch(() => {});
    throw error;
  }

  const address = server.address() as AddressInfo;
  let stopPromise: Promise<void> | null = null;
  let cleanupPromise: Promise<void> | null = null;
  return {
    port: address.port,
    store,
    stop() {
      stopPromise ??= (async () => {
        handleRequest.stopAccepting();
        const closed = new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
        server.closeAllConnections();
        await closed;

        cleanupPromise ??= (async () => {
          await Promise.allSettled([...inFlightRequests]);
          await handleRequest.waitForIdle();
          await store.close();
        })();
        if (!(await settlesWithin(cleanupPromise, shutdownDrainTimeoutMs))) {
          // Cleanup remains attached and will close the store if the uncancellable
          // backend operation eventually settles, but stop itself stays bounded.
          void cleanupPromise.catch(() => {});
          throw new Error("gbrain_backend_drain_timeout");
        }
      })();
      return stopPromise;
    },
  };
}

if (import.meta.main) {
  startNodeAdapter()
    .then((server) => {
      console.log(`[gbrain-adapter] listening on 127.0.0.1:${server.port}`);
      let stopping = false;
      const shutdown = () => {
        if (stopping) return;
        stopping = true;
        server.stop().finally(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((error) => {
      console.error(
        `[gbrain-adapter] failed to start: ${error instanceof Error ? error.message : "unknown"}`,
      );
      process.exit(1);
    });
}

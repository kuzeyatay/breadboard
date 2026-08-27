import { Agent, type Dispatcher } from "undici";

export const RUNTIME_JOB_CONTROL_CONNECTIONS = 16;
export const RUNTIME_SERVICE_CONTROL_CONNECTIONS = 8;
export const RUNTIME_CONTROL_KEEP_ALIVE_MS = 1_000;

type DispatcherFactory = (options: {
  connections: number;
  pipelining: number;
  keepAliveTimeout: number;
  keepAliveMaxTimeout: number;
}) => Dispatcher;

type DispatcherFetch = (
  input: RequestInfo | URL,
  init?: RequestInit & { dispatcher?: Dispatcher },
) => Promise<Response>;

interface RuntimeControlTransportOptions {
  dispatcherFactory?: DispatcherFactory;
  fetchImplementation?: DispatcherFetch;
  onTransportError?: (evidence: RuntimeControlTransportErrorEvidence) => void;
}

interface RuntimeControlTransportErrorEvidence {
  readonly pool: "job" | "service";
  readonly realm: string;
  readonly code: string | null;
  readonly bytesWritten: number | null;
  readonly bytesRead: number | null;
}

export interface RuntimeControlTransports {
  job: typeof fetch;
  service: typeof fetch;
}

function boundedFetch(
  pool: RuntimeControlTransportErrorEvidence["pool"],
  realm: string,
  dispatcher: Dispatcher,
  fetchImplementation: DispatcherFetch,
  onTransportError: (evidence: RuntimeControlTransportErrorEvidence) => void,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await fetchImplementation(input, {
        ...(init ?? {}),
        dispatcher,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      let candidate: unknown = error;
      let code: string | null = null;
      let bytesWritten: number | null = null;
      let bytesRead: number | null = null;
      for (let depth = 0; depth < 3 && candidate && typeof candidate === "object"; depth += 1) {
        const record = candidate as {
          cause?: unknown;
          code?: unknown;
          socket?: { bytesWritten?: unknown; bytesRead?: unknown };
        };
        if (
          code === null &&
          typeof record.code === "string" &&
          /^(?:UND_ERR_[A-Z_]+|E[A-Z0-9_]{2,31})$/u.test(record.code)
        ) {
          code = record.code;
        }
        if (record.socket && typeof record.socket === "object") {
          bytesWritten ??= safeByteCount(record.socket.bytesWritten);
          bytesRead ??= safeByteCount(record.socket.bytesRead);
        }
        candidate = record.cause;
      }
      try {
        onTransportError({ pool, realm, code, bytesWritten, bytesRead });
      } catch {
        // Diagnostics must never replace the bounded transport failure.
      }
      throw new Error(
        code
          ? `Runtime control transport failed (${code}).`
          : "Runtime control transport failed.",
      );
    }
  }) as typeof fetch;
}

/**
 * Keep dashboard Runtime traffic below the native handler budget.
 *
 * Job and service requests use separate pools so a manifest-bounded service
 * cold start cannot starve uploads or job status. Their combined ceiling is
 * deliberately below Runtime's hard connection bound, leaving a lifecycle
 * reserve for status and shutdown.
 */
export function createRuntimeControlTransports(
  options: RuntimeControlTransportOptions = {},
): RuntimeControlTransports {
  const dispatcherFactory =
    options.dispatcherFactory ?? ((agentOptions) => new Agent(agentOptions));
  const fetchImplementation =
    options.fetchImplementation ??
    ((input, init) => globalThis.fetch(input, init as RequestInit));
  const realm = `${process.pid}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  const onTransportError =
    options.onTransportError ??
    ((evidence: RuntimeControlTransportErrorEvidence) => {
      console.warn(
        `[runtime-control] transport failed pool=${evidence.pool} realm=${evidence.realm} ` +
          `code=${evidence.code ?? "unknown"} bytesWritten=${evidence.bytesWritten ?? "unknown"} ` +
          `bytesRead=${evidence.bytesRead ?? "unknown"}`,
      );
    });
  const sharedOptions = {
    // Runtime is deliberately a one-request-per-connection server. Undici's
    // documented zero setting disables keep-alive so Hot compilation cannot
    // leave speculative idle sockets consuming native prelude handlers.
    pipelining: 0,
    keepAliveTimeout: RUNTIME_CONTROL_KEEP_ALIVE_MS,
    keepAliveMaxTimeout: RUNTIME_CONTROL_KEEP_ALIVE_MS,
  };
  return {
    job: boundedFetch(
      "job",
      realm,
      dispatcherFactory({
        ...sharedOptions,
        connections: RUNTIME_JOB_CONTROL_CONNECTIONS,
      }),
      fetchImplementation,
      onTransportError,
    ),
    service: boundedFetch(
      "service",
      realm,
      dispatcherFactory({
        ...sharedOptions,
        connections: RUNTIME_SERVICE_CONTROL_CONNECTIONS,
      }),
      fetchImplementation,
      onTransportError,
    ),
  };
}

function safeByteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

const globalTransport = globalThis as typeof globalThis & {
  __breadboardRuntimeControlTransportsV1?: RuntimeControlTransports;
};

export function runtimeControlTransports(): RuntimeControlTransports {
  return (
    globalTransport.__breadboardRuntimeControlTransportsV1 ??=
      createRuntimeControlTransports()
  );
}

// Closed endpoint-only client used by one disposable Agent TARS worker.
// Rust injects exactly the held UI-TARS service endpoint and bearer. This file
// has no service lease, supervisor, process, executable, or provider-env path.

import type { UITarsAgentConfiguration } from "./config.ts";

export interface UITarsAdapterRunSummary {
  readonly runId: string;
  readonly ownerUserId: number;
  readonly status: string;
  readonly task: string;
  readonly operatorType: "browser" | "computer";
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failure?: { readonly code: string; readonly message: string };
  readonly lastSequence: number;
}

export interface UITarsAdapterEvent {
  readonly runId: string;
  readonly sequenceNumber: number;
  readonly type: string;
  readonly at: string;
  readonly payload: Record<string, unknown>;
}

export class UITarsWorkerAdapterError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "UITarsWorkerAdapterError";
  }
}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

function runtimeEndpoint(env: NodeJS.ProcessEnv = process.env): { origin: string; token: string } {
  const raw = env.BREADBOARD_UI_TARS_SERVICE_URL?.trim() ?? "";
  const token = env.BREADBOARD_UI_TARS_SERVICE_TOKEN?.trim() ?? "";
  if (
    Buffer.byteLength(token, "utf8") < 32 ||
    Buffer.byteLength(token, "utf8") > 1_024 ||
    !/^[\x21-\x7e]+$/u.test(token)
  ) {
    throw new Error("The Runtime-injected Agent TARS capability is unavailable.");
  }
  const parsed = new URL(raw);
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("The Runtime-injected Agent TARS endpoint is invalid.");
  }
  return { origin: parsed.origin, token };
}

async function boundedText(response: Response, maximumBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new UITarsWorkerAdapterError("response_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UITarsWorkerAdapterError("response_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8");
}

export class UITarsRuntimeWorkerClient {
  readonly endpoint: { origin: string; token: string };

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.endpoint = runtimeEndpoint(env);
  }

  private async call<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    if (bytes && bytes.byteLength > MAX_REQUEST_BYTES) {
      throw new UITarsWorkerAdapterError("request_too_large");
    }
    const response = await fetch(new URL(pathname, this.endpoint.origin), {
      method,
      headers: {
        authorization: `Bearer ${this.endpoint.token}`,
        accept: "application/json",
        ...(bytes ? { "content-type": "application/json" } : {}),
      },
      ...(bytes ? { body: bytes } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch((error) => {
      if (error instanceof UITarsWorkerAdapterError) throw error;
      throw new UITarsWorkerAdapterError("unavailable");
    });
    const text = await boundedText(
      response,
      response.ok ? MAX_RESPONSE_BYTES : MAX_ERROR_BYTES,
    );
    let envelope: { ok?: boolean; error?: string; data?: T };
    try {
      envelope = text ? JSON.parse(text) : {};
    } catch {
      throw new UITarsWorkerAdapterError("invalid_response");
    }
    if (!response.ok || envelope.ok === false) {
      throw new UITarsWorkerAdapterError(
        typeof envelope.error === "string" && /^[a-z0-9_]{1,80}$/u.test(envelope.error)
          ? envelope.error
          : "adapter_error",
      );
    }
    return envelope.data as T;
  }

  createRun(input: {
    readonly runId: string;
    readonly ownerUserId: number;
    readonly task: string;
    readonly configuration: UITarsAgentConfiguration;
    readonly providerApiKey: string | null;
  }): Promise<UITarsAdapterRunSummary> {
    return this.call("POST", "/runs", {
      runId: input.runId,
      ownerUserId: input.ownerUserId,
      task: input.task,
      config: input.configuration,
      ...(input.providerApiKey ? { providerApiKey: input.providerApiKey } : {}),
    });
  }

  getRun(runId: string, userId: number): Promise<UITarsAdapterRunSummary> {
    return this.call("GET", `/runs/${encodeURIComponent(runId)}?userId=${userId}`);
  }

  eventsSince(runId: string, userId: number, since: number): Promise<UITarsAdapterEvent[]> {
    return this.call(
      "GET",
      `/runs/${encodeURIComponent(runId)}/events?userId=${userId}&since=${since}`,
    );
  }

  abort(runId: string, userId: number): Promise<void> {
    return this.call("POST", `/runs/${encodeURIComponent(runId)}/abort`, { userId });
  }
}

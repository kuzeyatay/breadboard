// Bounded dashboard client for UI-TARS health and explicit control operations.
//
// Finite run creation, replay and cancellation are intentionally absent: one
// disposable Runtime worker owns that lifecycle. Next may only make bounded
// approval decisions and ownership-checked screenshot reads against the
// separately supervised loopback service.

import { resolveUITarsConfig, type UITarsAdapterConfig } from "./adapter-config.ts";
import {
  SupervisorResourceExhaustedError,
  withServiceLease,
} from "@/lib/supervisor-control";

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

export class UITarsAdapterError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "UITarsAdapterError";
  }
}

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;

async function boundedBytes(response: Response, maximumBytes: number): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new UITarsAdapterError("response_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UITarsAdapterError("response_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function boundedJson<T>(response: Response, maximumBytes: number): Promise<T> {
  const text = (await boundedBytes(response, maximumBytes)).toString("utf8");
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new UITarsAdapterError("invalid_response");
  }
}

export class UITarsClient {
  private readonly config: UITarsAdapterConfig;

  constructor(config: UITarsAdapterConfig = resolveUITarsConfig()) {
    this.config = config;
  }

  private authHeaders(): Record<string, string> {
    return {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${this.config.secret}`,
    };
  }

  private async call<T>(
    method: string,
    pathName: string,
    body?: unknown,
    leaseReason?: "browser-screenshot",
  ): Promise<T> {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    if (bytes && bytes.byteLength > MAX_REQUEST_BYTES) {
      throw new UITarsAdapterError("request_too_large");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const request = async (): Promise<T> => {
      const response = await fetch(new URL(pathName, this.config.adapterUrl), {
        method,
        headers: this.authHeaders(),
        ...(bytes ? { body: bytes } : {}),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const envelope = await boundedJson<{ ok?: boolean; error?: string; data?: T }>(
        response,
        response.ok ? MAX_JSON_BYTES : MAX_ERROR_BYTES,
      );
      if (!response.ok || envelope.ok === false) {
        throw new UITarsAdapterError(
          typeof envelope.error === "string" && /^[a-z0-9_]{1,80}$/u.test(envelope.error)
            ? envelope.error
            : "adapter_error",
        );
      }
      return envelope.data as T;
    };
    try {
      return leaseReason
        ? await withServiceLease("ui-tars", leaseReason, request)
        : await request();
    } catch (error) {
      if (error instanceof SupervisorResourceExhaustedError) throw error;
      if (error instanceof UITarsAdapterError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new UITarsAdapterError("timeout");
      }
      throw new UITarsAdapterError("unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<AdapterHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.config.requestTimeoutMs, 4_000));
    try {
      const response = await fetch(new URL("/health", this.config.adapterUrl), {
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("unavailable");
      const data = await boundedJson<Partial<AdapterHealth> & { runtime?: string }>(
        response,
        MAX_JSON_BYTES,
      );
      return {
        status: data.status === "healthy" ? "healthy" : "unavailable",
        runtime: data.runtime === "fake" || data.runtime === "agent-tars" ? data.runtime : null,
        realBrowser: Boolean(data.realBrowser),
        operator: data.operator === "browser" ? "browser" : null,
        ...(Array.isArray(data.operators)
          ? {
              operators: data.operators.filter(
                (operator): operator is "browser" | "computer" =>
                  operator === "browser" || operator === "computer",
              ),
            }
          : {}),
        version: typeof data.version === "string" ? data.version : null,
      };
    } catch {
      return {
        status: "unavailable",
        runtime: null,
        realBrowser: false,
        operator: null,
        version: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  capabilities(): Promise<AdapterCapabilities> {
    return this.call<AdapterCapabilities>("GET", "/capabilities");
  }

  approve(runId: string, userId: number, actionId: string): Promise<void> {
    return this.call<void>("POST", `/runs/${encodeURIComponent(runId)}/approve`, {
      userId,
      actionId,
    });
  }

  reject(runId: string, userId: number, actionId: string): Promise<void> {
    return this.call<void>("POST", `/runs/${encodeURIComponent(runId)}/reject`, {
      userId,
      actionId,
    });
  }

  restoreScreenshotHistory(runId: string, userId: number): Promise<void> {
    return this.call<void>(
      "POST",
      `/runs/${encodeURIComponent(runId)}/screenshots/restore`,
      { userId },
      "browser-screenshot",
    );
  }

  /** Fetch bounded PNG bytes after the authenticated route checked ownership. */
  async screenshot(runId: string, userId: number, screenshotId: string): Promise<Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const read = async () => {
        const response = await fetch(
          new URL(
            `/runs/${encodeURIComponent(runId)}/screenshots/${encodeURIComponent(screenshotId)}?userId=${userId}`,
            this.config.adapterUrl,
          ),
          {
            headers: { authorization: `Bearer ${this.config.secret}` },
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          return null;
        }
        return boundedBytes(response, MAX_SCREENSHOT_BYTES);
      };
      return await withServiceLease("ui-tars", "browser-screenshot", read);
    } catch (error) {
      if (error instanceof SupervisorResourceExhaustedError) throw error;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

// Pure, framework-free request/response helpers shared by the OpenHarness route
// handlers. Kept free of `next/server` so this policy (size limits, structured
// errors, secret-free error translation) is unit-testable in isolation.

import { OpenHarnessError } from "./client.ts";
import { readOpenHarnessConfig } from "./config.ts";
import { readAgentRuntimeConfig } from "../agent-runtime/config.ts";

export const MAX_REQUEST_BYTES = 256 * 1024; // 256 KB per request body

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Throws a 503 ApiError when OpenHarness is disabled — never crash or hang. */
export function requireEnabled(): void {
  const runtime = readAgentRuntimeConfig();
  if (runtime.runtime === "hermes") {
    if (!runtime.hermes.baseUrl || !runtime.hermes.sessionToken) {
      throw new ApiError(
        503,
        "agent_runtime_disabled",
        "The agent runtime is not enabled on this server.",
      );
    }
    return;
  }
  if (!readOpenHarnessConfig().enabled) {
    throw new ApiError(503, "openharness_disabled", "OpenHarness is not enabled on this server.");
  }
}

/** Parse a JSON body with a hard size cap. Rejects oversized/invalid bodies. */
export async function readJsonBody(
  request: Request,
  maxBytes = MAX_REQUEST_BYTES,
): Promise<Record<string, unknown>> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > maxBytes) {
    throw new ApiError(413, "payload_too_large", "Request body exceeds the size limit.");
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new ApiError(413, "payload_too_large", "Request body exceeds the size limit.");
  }
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ApiError(400, "invalid_body", "Request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

export function requireString(value: unknown, field: string, maxLen = 100_000): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "invalid_field", `Field "${field}" is required.`);
  }
  if (value.length > maxLen) {
    throw new ApiError(400, "invalid_field", `Field "${field}" is too long.`);
  }
  return value;
}

/**
 * Pure error → { status, body } mapping. The secret-free translation policy is
 * unit-testable here without pulling in next/server.
 */
export function describeError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ApiError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  if (error instanceof OpenHarnessError) {
    // Map upstream runtime errors to a gateway status without leaking the base
    // URL or internal hostnames. Unreachable/5xx surface as 503, others as 502.
    const status = error.status === 401 ? 502 : error.status >= 500 || error.status === 0 ? 503 : 502;
    return {
      status,
      body: { error: "The agent runtime is unavailable.", code: error.code, recoverable: error.recoverable },
    };
  }
  // Errors that already carry an HTTP status — notably Breadboard's RouteError
  // from requireUserId / cluster authorization (server-auth.ts) — must preserve
  // that status instead of collapsing to 500. Matched defensively (a real Error
  // with a 4xx/5xx numeric status); the messages these throw are user-safe
  // ("Unauthorized", "Cluster not found"), and we cap length as a safeguard.
  if (error instanceof Error) {
    const status = (error as Error & { status?: unknown }).status;
    if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
      return { status, body: { error: error.message.slice(0, 200) } };
    }
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  // Avoid echoing internal paths/URLs in unexpected errors.
  return { status: 500, body: { error: "Internal server error", detail: message.slice(0, 200) } };
}

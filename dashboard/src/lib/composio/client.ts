import "server-only";

import { Composio } from "@composio/core";
import { ApiError } from "../hermes/route-core.ts";

let cachedClient: Composio | null = null;
let cachedKey = "";

export function composioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY?.trim());
}

export function composioUserId(userId: number): string {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new ApiError(401, "invalid_user", "Unauthorized");
  }
  const prefix =
    process.env.COMPOSIO_USER_ID_PREFIX?.trim().replace(/[^a-zA-Z0-9._-]/g, "-") ||
    "breadboard";
  return `${prefix}-user-${userId}`;
}

export function composioClient(): Composio {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new ApiError(
      503,
      "composio_not_configured",
      "App connections are not set up on this Breadboard install.",
    );
  }
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new Composio({ apiKey });
    cachedKey = apiKey;
  }
  return cachedClient;
}

/**
 * Direct REST access for the calls the SDK cannot page or version (the full
 * toolkit catalog, a toolkit's latest tools, executing one of them).
 */
export async function brokerRest<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim() ?? "";
  if (!apiKey) composioClient();
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(`https://backend.composio.dev/api/v3${path}`, {
    method: init.method ?? "GET",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || payload === null) {
    throw new ApiError(502, "app_connection_service_failed", "The app connection service did not answer. Try again in a moment.");
  }
  return payload;
}

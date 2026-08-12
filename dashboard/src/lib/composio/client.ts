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
      "App connections are not configured. Add COMPOSIO_API_KEY to dashboard/.env.local and restart Breadboard.",
    );
  }
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new Composio({ apiKey });
    cachedKey = apiKey;
  }
  return cachedClient;
}

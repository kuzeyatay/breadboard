import crypto from "node:crypto";
import { issueCapabilityToken } from "./capability-token.ts";
import {
  getRuntimeSessionByExternalId,
  getRuntimeSessionByHermesId,
  runtimeExternalSessionId,
} from "./runtime-store.ts";
import { allowedToolsForSurface } from "./tool-scopes.ts";
import { ApiError } from "./route-helpers.ts";
import type { RuntimeKind } from "../agent-runtime/contracts.ts";

function serviceSecret(runtime: RuntimeKind): string {
  if (runtime === "hermes") {
    return (
      process.env.BREADBOARD_HERMES_TOOL_SECRET ||
      process.env.HERMES_TOOL_SECRET ||
      "breadboard-local-dev"
    );
  }
  return (
    process.env.HERMES_TOOL_SECRET ||
    process.env.HERMES_PASSWORD ||
    "breadboard-local-dev"
  );
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Authenticate the Hermes plugin process and mint a fresh narrow
 * capability from the server-owned runtime-session row. This keeps capability
 * files out of a full-filesystem agent's active working directory.
 */
export function capabilityForInternalToolRequest(request: Request): string | null {
  const runtimeHeader = request.headers
    .get("x-agent-runtime")
    ?.trim()
    .toLowerCase();
  const runtime: RuntimeKind =
    runtimeHeader === "hermes" ||
    Boolean(request.headers.get("x-hermes-session-id"))
      ? "hermes"
      : "hermes";
  const sessionId = (
    request.headers.get("x-agent-session-id") ??
    request.headers.get("x-hermes-session-id") ??
    request.headers.get("x-hermes-session-id")
  )?.trim();
  if (!sessionId) return null;
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!bearer || !equalSecret(bearer, serviceSecret(runtime))) {
    throw new ApiError(
      401,
      "invalid_service_auth",
      "Invalid agent tool service credentials.",
    );
  }
  const row =
    getRuntimeSessionByExternalId(runtime, sessionId) ??
    (runtime === "hermes"
      ? getRuntimeSessionByHermesId(sessionId)
      : null);
  const externalSessionId = row ? runtimeExternalSessionId(row) : null;
  if (!row || !externalSessionId) {
    throw new ApiError(
      404,
      "runtime_session_not_found",
      "The agent runtime session was not found.",
    );
  }
  return issueCapabilityToken({
    userId: row.user_id ?? 0,
    conversationId: row.conversation_id ?? undefined,
    surface: row.surface,
    breadboardSessionId: String(row.id),
    // Legacy token field name retained for the stable internal tool contract.
    // Its value is the selected runtime's opaque external session id.
    hermesSessionId: externalSessionId,
    gardenId: row.garden_id ?? undefined,
    allowedGardenIds: parseAllowedGardenIds(row.allowed_garden_ids),
    activeGardenId: row.cluster_id ?? undefined,
    pageSlug: row.page_slug ?? undefined,
    allowedTools: allowedToolsForSurface(row.surface),
  });
}

function parseAllowedGardenIds(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => Number.isInteger(item) && item > 0)
      : [];
  } catch {
    return [];
  }
}

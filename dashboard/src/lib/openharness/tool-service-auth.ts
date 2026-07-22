import crypto from "node:crypto";
import { issueCapabilityToken } from "./capability-token.ts";
import { getRuntimeSessionByOpenHarnessId } from "./runtime-store.ts";
import { allowedToolsForSurface } from "./tool-scopes.ts";
import { ApiError } from "./route-helpers.ts";

function serviceSecret(): string {
  return (
    process.env.OPENHARNESS_TOOL_SECRET ||
    process.env.OPENHARNESS_PASSWORD ||
    "breadboard-local-dev"
  );
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Authenticate the OpenHarness plugin process and mint a fresh narrow
 * capability from the server-owned runtime-session row. This keeps capability
 * files out of a full-filesystem agent's active working directory.
 */
export function capabilityForInternalToolRequest(request: Request): string | null {
  const sessionId = request.headers.get("x-openharness-session-id")?.trim();
  if (!sessionId) return null;
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!bearer || !equalSecret(bearer, serviceSecret())) {
    throw new ApiError(401, "invalid_service_auth", "Invalid OpenHarness tool service credentials.");
  }
  const row = getRuntimeSessionByOpenHarnessId(sessionId);
  if (!row || !row.openharness_session_id) {
    throw new ApiError(404, "runtime_session_not_found", "The OpenHarness runtime session was not found.");
  }
  return issueCapabilityToken({
    userId: row.user_id ?? 0,
    conversationId: row.conversation_id ?? undefined,
    surface: row.surface,
    breadboardSessionId: String(row.id),
    openHarnessSessionId: row.openharness_session_id,
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

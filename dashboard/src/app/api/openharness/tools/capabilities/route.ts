import { NextResponse } from "next/server";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/openharness/route-helpers.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/openharness/capability-token.ts";
import { getRuntimeSessionById, recordAuditEvent } from "@/lib/openharness/runtime-store.ts";
import {
  searchRegistry,
  type CapabilityGap,
  type SkillPermission,
} from "@/lib/openharness/skills.ts";

export const dynamic = "force-dynamic";

const PERMISSIONS = new Set<SkillPermission>([
  "filesystem-read", "filesystem-write", "garden-read", "garden-propose", "network", "shell",
  "repository-read", "repository-write", "external-service",
]);

export async function POST(request: Request) {
  try {
    requireEnabled();
    const raw = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const verified = verifyCapabilityToken(raw);
    if (!verified.ok) throw new ApiError(401, "invalid_capability", "Invalid capability token.");
    const body = await readJsonBody(request);
    const action = body.action === "capability_gap" || body.action === "capability_search" ? body.action : null;
    if (!action || !tokenAllows(verified.token, { tool: action })) {
      throw new ApiError(403, "capability_denied", "This capability is not allowed.");
    }
    const sessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(sessionId);
    if (!session || session.surface !== "dashboard_terminal" || session.openharness_session_id !== verified.token.openHarnessSessionId) {
      throw new ApiError(403, "session_scope_mismatch", "Capability session scope is invalid.");
    }
    const args = body.args && typeof body.args === "object" ? body.args as Record<string, unknown> : {};
    if (action === "capability_search") {
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 200) : "";
      if (!query) throw new ApiError(400, "query_required", "A capability query is required.");
      const candidates = await searchRegistry(query);
      recordAuditEvent({
        eventType: "skill.search",
        runtimeSessionId: session.id,
        userId: session.user_id,
        payload: { query, resultCount: candidates.length, delegatedTo: "breadboard-capability-scout" },
      });
      return NextResponse.json({ candidates });
    }

    const requiredPermissions = Array.isArray(args.requiredPermissions)
      ? args.requiredPermissions.filter((value): value is SkillPermission => typeof value === "string" && PERMISSIONS.has(value as SkillPermission))
      : [];
    const gap: CapabilityGap = {
      taskId: required(args.taskId, "taskId"),
      sessionId: String(session.id),
      requestedCapability: required(args.requestedCapability, "requestedCapability"),
      reason: required(args.reason, "reason"),
      searchQuery: required(args.searchQuery, "searchQuery"),
      requiredPermissions,
      parentAgent: session.agent_name,
    };
    recordAuditEvent({
      eventType: "capability.gap",
      runtimeSessionId: session.id,
      userId: session.user_id,
      payload: gap,
    });
    return NextResponse.json({ gap, resumable: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "invalid_gap", `${field} is required.`);
  return value.trim().slice(0, 500);
}

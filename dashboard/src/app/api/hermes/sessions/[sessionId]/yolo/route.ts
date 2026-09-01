import { NextResponse } from "next/server";
import { getAgentRuntimeByKind } from "@/lib/agent-runtime/runtime.ts";
import {
  apiErrorResponse,
  ApiError,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";
import { authorizeRuntimeReference } from "@/lib/hermes/session-service.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// Keep Hermes's live, session-scoped bypass aligned with the browser switch.
// Identity, ownership and surface isolation remain hard boundaries. Per-turn
// capability classification is only planning: valid actions reach their native
// permission flow, which this bypass answers automatically while YOLO is on.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const session = authorizeRuntimeReference(userId, sessionId);
    const body = await readJsonBody(request);
    if (typeof body.enabled !== "boolean") {
      throw new ApiError(
        400,
        "invalid_yolo_mode",
        "YOLO mode must be enabled or disabled.",
      );
    }

    await getAgentRuntimeByKind(session.runtimeKind).setApprovalBypass({
      externalSessionId: session.externalSessionId,
      liveSessionId: session.liveSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      enabled: body.enabled,
    });
    recordAuditEvent({
      eventType: "session.yolo_mode_changed",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: { enabled: body.enabled },
    });
    return NextResponse.json({ enabled: body.enabled });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

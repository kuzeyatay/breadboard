import crypto from "node:crypto";
import { conversationRequestSurface, conversationRequestContext } from "@/lib/hermes/session-surface.ts";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import {
  getConversationForUser,
} from "@/lib/conversations/store.ts";
import {
  parseConversationBranchHistory,
  resolveConversationBranchHistory,
  runtimeMessagesForBranch,
} from "@/lib/conversations/branch-history.ts";
import {
  resolveConversationRuntime,
} from "@/lib/hermes/session-service.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import { reclaimAbandonedRunForSession } from "@/lib/hermes/run-recovery.ts";
import {
  HERMES_SURFACES,
  type HermesSurface,
} from "@/lib/hermes/config.ts";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const conversation = getConversationForUser(sessionId, userId);
    const body = await readJsonBody(request);
    const requestedSurface = parseSurface(body.surface);
    const surface = conversationRequestSurface(conversation, requestedSurface);
    const references = parseConversationBranchHistory(body.branchHistory);
    if (!references) {
      throw new ApiError(
        400,
        "branch_history_required",
        "Branch history is required before regenerating a response.",
      );
    }
    const history = resolveConversationBranchHistory(
      conversation.id,
      references,
    );
    const context = conversationRequestContext(
      conversation, requestedSurface, parseSurfaceContext(body.surfaceContext),
    );
    const current = await resolveConversationRuntime({
      conversation,
      surface,
      activeGardenSlug: context.activeGardenSlug,
      activePageSlug: context.activePageSlug,
    });
    // Regenerating after a turn whose pump died is the single most likely way
    // to meet this check, so debris is cleared before it can block the retry.
    reclaimAbandonedRunForSession(current.row.id);
    if (getActiveRuntimeRun(current.row.id)) {
      throw new ApiError(
        409,
        "run_already_active",
        "This chat is still working on the previous message. Stop it or wait for it to finish.",
      );
    }

    const branchContextId = crypto.randomUUID();
    await resolveConversationRuntime({
      conversation,
      surface,
      activeGardenSlug: context.activeGardenSlug,
      activePageSlug: context.activePageSlug,
      forceRecreate: true,
      historyOverride: runtimeMessagesForBranch(history),
      branchContextId,
    });

    return NextResponse.json({
      prepared: true,
      branchContextId,
      messageCount: history.length,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function parseSurface(value: unknown): HermesSurface {
  if (
    typeof value === "string" &&
    (HERMES_SURFACES as readonly string[]).includes(value)
  ) {
    return value as HermesSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

function parseSurfaceContext(value: unknown): {
  activeGardenSlug?: string;
  activePageSlug?: string;
} {
  const context =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    activeGardenSlug:
      typeof context.activeGardenSlug === "string"
        ? context.activeGardenSlug
        : undefined,
    activePageSlug:
      typeof context.activePageSlug === "string"
        ? context.activePageSlug
        : undefined,
  };
}

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  findAgencyAgent,
  presentAgencyAgent,
} from "@/lib/hermes/agency-agents.ts";
import {
  getConversationById,
  updateConversation,
} from "@/lib/conversations/store.ts";
import {
  apiErrorResponse,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { authorizeRuntimeReference } from "@/lib/hermes/session-service.ts";
import { ApiError } from "@/lib/hermes/route-core.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

function authorizedConversation(userId: number, reference: string) {
  const session = authorizeRuntimeReference(userId, reference);
  if (!session.row.conversation_id) {
    throw new ApiError(404, "conversation_not_found", "Conversation not found.");
  }
  const conversation = getConversationById(session.row.conversation_id);
  if (!conversation || conversation.user_id !== userId) {
    throw new ApiError(404, "conversation_not_found", "Conversation not found.");
  }
  return conversation;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await context.params;
    let conversation = authorizedConversation(userId, sessionId);
    if (!conversation.active_agency_agent_slug) {
      return NextResponse.json({ ok: true, activeAgent: null, notice: null });
    }
    const agent = findAgencyAgent(conversation.active_agency_agent_slug);
    if (!agent) {
      conversation = updateConversation(conversation, { activeAgencyAgentSlug: null });
      return NextResponse.json({
        ok: true,
        activeAgent: null,
        notice: "The selected Agency Agent is no longer available and was cleared.",
      });
    }
    return NextResponse.json({
      ok: true,
      activeAgent: presentAgencyAgent(agent),
      notice: null,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await context.params;
    const conversation = authorizedConversation(userId, sessionId);
    updateConversation(conversation, { activeAgencyAgentSlug: null });
    return NextResponse.json({ ok: true, activeAgent: null, notice: null });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

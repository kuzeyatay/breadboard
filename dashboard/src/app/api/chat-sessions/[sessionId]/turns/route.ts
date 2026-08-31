import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-options";
import { normalizeChatMessageAttachments } from "@/lib/chat-attachments";
import { normalizeChatTextSelectionReference } from "@/lib/chat-text-selection";
import {
  ensureConversationForLegacyChatSession,
  presentConversationMessage,
  reserveConversationTurn,
} from "@/lib/conversations/store";
import { apiErrorResponse } from "@/lib/hermes/route-helpers";

export const dynamic = "force-dynamic";

function optionalCreatedAt(value: unknown): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : new Date().toISOString();
}

function optionalStrings(value: unknown, maximum: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maximum)
    : [];
}

/**
 * Atomically reserve both halves of a legacy Garden turn before any model,
 * attachment, skill, or runtime preparation begins.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = Number(
      (session?.user as { id?: string } | undefined)?.id,
    );
    if (!Number.isSafeInteger(userId) || userId < 1) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;
    const numericSessionId = Number(sessionId);
    if (!Number.isSafeInteger(numericSessionId) || numericSessionId < 1) {
      return NextResponse.json(
        { error: "Invalid session id" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const clientMessageId =
      typeof body.clientMessageId === "string"
        ? body.clientMessageId.trim()
        : "";
    const content =
      typeof body.content === "string" ? body.content.trim() : "";
    const createdAt = optionalCreatedAt(body.createdAt);
    const attachmentNames = optionalStrings(body.attachmentNames, 12);
    const attachments = normalizeChatMessageAttachments(body.attachments);
    const selectedText =
      typeof body.selectedText === "string"
        ? body.selectedText.trim().slice(0, 4_000)
        : "";
    const inlineSelection =
      body.inlineSelection && typeof body.inlineSelection === "object"
        ? body.inlineSelection
        : undefined;
    const textSelection = normalizeChatTextSelectionReference(
      body.textSelection,
    );

    const conversation = ensureConversationForLegacyChatSession(
      numericSessionId,
      userId,
    );
    const turn = reserveConversationTurn({
      conversation,
      clientMessageId,
      surface: "garden_chat",
      content,
      metadata: {
        gardenPreDispatch: true,
        responseStartedAt: createdAt,
        ...(body.internalAgentContinuation === true
          ? { internalAgentContinuation: true }
          : {}),
        ...(attachmentNames.length ? { attachmentNames } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(selectedText ? { selectedText } : {}),
        ...(inlineSelection ? { inlineSelection } : {}),
        ...(textSelection ? { textSelection } : {}),
      },
    });

    return NextResponse.json({
      conversationId: turn.conversation.public_id,
      userMessage: presentConversationMessage(turn.userMessage),
      assistantMessage: presentConversationMessage(turn.assistantMessage),
      replayed: !turn.isNew,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

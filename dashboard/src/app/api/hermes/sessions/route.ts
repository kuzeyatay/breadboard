import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import {
  createConversation,
  createConversationWithInitialTurn,
  listConversationsForUser,
  presentConversation,
  summarizeConversationMessages,
  type CreateConversationInput,
} from "@/lib/conversations/store.ts";
import {
  authorizeGardenAccess,
  resolveConversationRuntime,
} from "@/lib/hermes/session-service.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";
import { presentHermesSessionSummary } from "@/lib/hermes/session-presentation.ts";
import { parseChatAttachments } from "@/lib/chat-attachments-request.ts";
import { chatMessageAttachments } from "@/lib/chat-attachments.ts";
import { normalizeChatTextSelectionReference } from "@/lib/chat-text-selection.ts";

export const dynamic = "force-dynamic";

const MAX_SESSION_REQUEST_BYTES = 16 * 1024 * 1024;

function parseSurface(value: unknown): HermesSurface {
  if (typeof value === "string" && (HERMES_SURFACES as readonly string[]).includes(value)) {
    return value as HermesSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

function parseInitialTurn(
  value: unknown,
  context: {
    surface: HermesSurface;
    activeGardenSlug: string | null;
    activePageSlug: string | null;
  },
) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_initial_turn", "The initial turn is invalid.");
  }
  const turn = value as Record<string, unknown>;
  const attachments = parseChatAttachments(turn.attachments);
  const textSelection = normalizeChatTextSelectionReference(turn.textSelection);
  if (turn.textSelection !== undefined && !textSelection) {
    throw new ApiError(
      400,
      "invalid_text_selection",
      "The selected-text reference is invalid.",
    );
  }
  const branchGroupId = typeof turn.branchGroupId === "string"
    ? turn.branchGroupId.slice(0, 128)
    : undefined;
  return {
    clientMessageId: requireString(
      turn.clientMessageId,
      "initialTurn.clientMessageId",
      128,
    ),
    surface: context.surface,
    content: requireString(turn.text, "initialTurn.text", 100_000),
    metadata: {
      activeGardenSlug: context.activeGardenSlug,
      activePageSlug: context.activePageSlug,
      attachmentNames: attachments.map((attachment) => attachment.name),
      attachments: chatMessageAttachments(attachments),
      ...(branchGroupId ? { branchGroupId } : {}),
      ...(textSelection ? { textSelection } : {}),
      ...(turn.internalAgentContinuation === true
        ? { internalAgentContinuation: true }
        : {}),
    },
  };
}

// Conversations are bound to the server-created surface. This prevents a
// browser from relabelling a Garden/Quartz conversation as a Terminal session.
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const surface = parseSurface(new URL(request.url).searchParams.get("surface"));
    const conversations = listConversationsForUser(userId)
      .filter((conversation) => conversation.surface === surface);
    const messageSummaries = summarizeConversationMessages(
      conversations.map((conversation) => conversation.id),
    );
    const sessions = conversations.map((conversation) =>
      presentHermesSessionSummary(
        conversation,
        messageSummaries.get(conversation.id),
      ),
    );
    return NextResponse.json({ sessions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// New chats are durable before an Hermes runtime is needed. The returned
// id is opaque and stable, but deliberately scoped to its creation surface.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const body = await readJsonBody(request, MAX_SESSION_REQUEST_BYTES);
    const surface = parseSurface(body.surface ?? "dashboard_terminal");
    const title = typeof body.title === "string" ? body.title.slice(0, 200) : undefined;
    const gardenSlug = typeof body.gardenSlug === "string" && body.gardenSlug.trim()
      ? body.gardenSlug.trim()
      : undefined;
    const garden = gardenSlug ? authorizeGardenAccess(userId, gardenSlug) : null;
    const pageSlug = typeof body.pageSlug === "string"
      ? body.pageSlug.slice(0, 500)
      : null;
    const initialTurn = parseInitialTurn(body.initialTurn, {
      surface,
      activeGardenSlug: garden?.slug ?? null,
      activePageSlug: pageSlug,
    });
    // Temporary is fixed at creation, like the surface: a chat that has already
    // spoken can neither claim the promise retroactively nor lose it. The
    // toggle in the UI therefore always starts a new conversation.
    const conversationInput: CreateConversationInput = {
      userId,
      title,
      surface,
      temporary: body.temporary === true,
      scopeKind: surface === "quartz_ai" && garden
        ? "page"
        : garden
          ? "garden"
          : "global",
      defaultGardenId: garden?.clusterId ?? null,
    };
    const conversation = initialTurn
      ? createConversationWithInitialTurn({
          conversation: conversationInput,
          turn: initialTurn,
        }).conversation
      : createConversation(conversationInput);
    const runtime = await resolveConversationRuntime({
      conversation,
      surface,
      activeGardenSlug: garden?.slug ?? null,
      activePageSlug: pageSlug,
    });
    return NextResponse.json({
      initialTurnReserved: initialTurn !== null,
      session: {
        ...presentConversation(conversation),
        surface,
        agentName: "breadboard-assistant",
        gardenId: garden?.slug ?? null,
        pageSlug,
        activeDirectory: runtime.activeDirectory,
        filesystemMode: "restricted",
        capabilityMode: "knowledge",
        messages: [],
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

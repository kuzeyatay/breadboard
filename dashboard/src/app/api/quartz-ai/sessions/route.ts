import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import {
  apiErrorResponse,
  requireEnabled,
  requireString,
} from "@/lib/hermes/route-helpers.ts";
import { authorizeQuartzRuntimeSession } from "@/lib/hermes/session-service.ts";
import {
  getRuntimeSessionByConversation,
  listRuntimeMessages,
  presentRuntimeMessage,
  runtimeSessionTitle,
  type RuntimeSessionRow,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import {
  listConversationMessages,
  listConversationsForUser,
  presentConversation,
  presentConversationMessage,
} from "@/lib/conversations/store.ts";
import {
  authorizeQuartzAccess,
  corsHeaders,
} from "@/lib/hermes/quartz-support.ts";

export const dynamic = "force-dynamic";

async function optionalUserId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const id = Number((session?.user as { id?: string } | undefined)?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

function presentSession(row: RuntimeSessionRow) {
  const activeRun = getActiveRuntimeRun(row.id);
  return {
    id: row.id,
    title: runtimeSessionTitle(row),
    gardenId: row.garden_id,
    pageSlug: row.page_slug,
    updatedAt: row.updated_at,
    active: activeRun !== null || row.last_runtime_status === "busy",
    responseStartedAt:
      activeRun?.started_at ??
      (row.last_runtime_status === "busy" ? row.updated_at : undefined),
    messages: listRuntimeMessages(row.id).map(presentRuntimeMessage),
  };
}

// GET: list this reader's quartz_ai sessions for a page so the panel can offer
// terminal-style history and restore transcripts after a reload. Signed-in
// readers get every session they own on the page (garden access is re-verified);
// anonymous readers can only restore the single session bound to their opaque
// client token — a guessed numeric id returns nothing.
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    requireEnabled();
    const userId = await optionalUserId();
    const url = new URL(request.url);
    const gardenId = requireString(
      url.searchParams.get("gardenId"),
      "gardenId",
      200,
    );
    const pageSlug = requireString(
      url.searchParams.get("pageSlug"),
      "pageSlug",
      400,
    );
    const { cluster } = authorizeQuartzAccess(gardenId, userId);

    if (userId !== null) {
      // Assistant history is its own page-scoped history. The canonical store
      // also contains Terminal and Garden conversations; returning that whole
      // list here made opening History in Quartz expose unrelated chats.
      const sessions = listConversationsForUser(userId).flatMap(
        (conversation) => {
          if (
            conversation.surface !== "quartz_ai" ||
            conversation.default_garden_id !== cluster.id
          ) {
            return [];
          }
          const runtime = getRuntimeSessionByConversation(conversation.id);
          if (
            !runtime ||
            runtime.surface !== "quartz_ai" ||
            runtime.garden_id !== gardenId ||
            runtime.page_slug !== pageSlug
          ) {
            return [];
          }
          const activeRun = getActiveRuntimeRun(runtime.id);
          return [
            {
              ...presentConversation(conversation),
              gardenId,
              pageSlug,
              active:
                activeRun !== null || runtime.last_runtime_status === "busy",
              responseStartedAt:
                activeRun?.started_at ??
                (runtime.last_runtime_status === "busy"
                  ? runtime.updated_at
                  : undefined),
              messages: listConversationMessages(conversation.id).map(
                presentConversationMessage,
              ),
            },
          ];
        },
      );
      return NextResponse.json({ sessions }, { headers: cors });
    }

    const sessionId = Number(url.searchParams.get("sessionId"));
    const clientToken = url.searchParams.get("clientToken");
    if (!Number.isInteger(sessionId) || sessionId <= 0 || !clientToken) {
      return NextResponse.json({ sessions: [] }, { headers: cors });
    }
    const session = authorizeQuartzRuntimeSession(sessionId, {
      userId: null,
      clientToken,
    });
    if (
      session.row.garden_id !== gardenId ||
      session.row.page_slug !== pageSlug
    ) {
      return NextResponse.json({ sessions: [] }, { headers: cors });
    }
    return NextResponse.json(
      { sessions: [presentSession(session.row)] },
      { headers: cors },
    );
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors))
      response.headers.set(key, value);
    return response;
  }
}

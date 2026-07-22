import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import {
  apiErrorResponse,
  requireEnabled,
  requireString,
} from "@/lib/openharness/route-helpers.ts";
import { authorizeQuartzRuntimeSession } from "@/lib/openharness/session-service.ts";
import {
  listRuntimeMessages,
  presentRuntimeMessage,
  runtimeSessionTitle,
  type RuntimeSessionRow,
} from "@/lib/openharness/runtime-store.ts";
import {
  listConversationMessages,
  listConversationsForUser,
  presentConversation,
  presentConversationMessage,
} from "@/lib/conversations/store.ts";
import {
  authorizeQuartzAccess,
  corsHeaders,
} from "@/lib/openharness/quartz-support.ts";

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
  return {
    id: row.id,
    title: runtimeSessionTitle(row),
    gardenId: row.garden_id,
    pageSlug: row.page_slug,
    updatedAt: row.updated_at,
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
    const gardenId = requireString(url.searchParams.get("gardenId"), "gardenId", 200);
    const pageSlug = requireString(url.searchParams.get("pageSlug"), "pageSlug", 400);
    authorizeQuartzAccess(gardenId, userId);

    if (userId !== null) {
      const sessions = listConversationsForUser(userId).map((conversation) => ({
        ...presentConversation(conversation),
        gardenId,
        pageSlug,
        messages: listConversationMessages(conversation.id).map(presentConversationMessage),
      }));
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
    if (session.row.garden_id !== gardenId || session.row.page_slug !== pageSlug) {
      return NextResponse.json({ sessions: [] }, { headers: cors });
    }
    return NextResponse.json(
      { sessions: [presentSession(session.row)] },
      { headers: cors },
    );
  } catch (error) {
    const response = apiErrorResponse(error);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  }
}

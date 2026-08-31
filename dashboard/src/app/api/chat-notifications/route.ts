import { NextResponse } from "next/server";
import { RouteError, requireUserId } from "@/lib/server-auth";
import db from "@/lib/db";
import {
  chatNotificationMessageId,
  dismissChatNotifications,
  dismissChatNotificationsForTarget,
  listPendingChatNotifications,
} from "@/lib/chat-notifications/store";
import {
  isChatNotificationTarget,
  type ChatNotificationTarget,
} from "@/lib/chat-notification-inbox";

export const dynamic = "force-dynamic";

const MAX_DISMISSALS_PER_REQUEST = 200;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RouteError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: "The notification request could not be completed." },
    { status: 500 },
  );
}

/**
 * The account's live set of undismissed "Response ready" / "Response failed"
 * notices. Every open window polls this and shows exactly this list, so a
 * dismissal made anywhere disappears everywhere on the next poll.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({
      messages: listPendingChatNotifications(db, userId),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

interface DismissRequest {
  /** Notice ids (`msg_<n>`) the person closed. */
  dismiss?: unknown;
  /** A chat the person is looking at: every finished answer in it is seen. */
  seen?: unknown;
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => null)) as DismissRequest | null;
    if (!body || typeof body !== "object") {
      throw new RouteError(400, "A JSON body is required.");
    }

    const messageIds = Array.isArray(body.dismiss)
      ? body.dismiss
          .slice(0, MAX_DISMISSALS_PER_REQUEST)
          .map((id) => (typeof id === "string" ? chatNotificationMessageId(id) : null))
          .filter((id): id is number => id !== null)
      : [];
    const seen: ChatNotificationTarget | null = isChatNotificationTarget(body.seen)
      ? body.seen
      : null;
    if (messageIds.length === 0 && !seen) {
      throw new RouteError(400, "Nothing to dismiss.");
    }

    let dismissed = dismissChatNotifications(db, userId, messageIds);
    if (seen) dismissed += dismissChatNotificationsForTarget(db, userId, seen);
    return NextResponse.json({ ok: true, dismissed });
  } catch (error) {
    return errorResponse(error);
  }
}

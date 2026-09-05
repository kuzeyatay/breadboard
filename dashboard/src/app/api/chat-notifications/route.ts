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
  dismissLearnNotifications,
  dismissLearnNotificationsForGarden,
  listPendingLearnNotifications,
  parseLearnNotificationId,
  type LearnNotificationPhase,
} from "@/lib/chat-notifications/learn";
import {
  isChatNotificationTarget,
  type ChatNotificationRecord,
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

function notificationTime(record: ChatNotificationRecord): number {
  // Chat rows carry SQLite `datetime('now')` text and Learn rows carry ISO
  // timestamps; parse both so the merged inbox is in true time order.
  const parsed = Date.parse(record.updatedAt.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The account's live set of undismissed notices — chat answers and Learn
 * pipeline updates together, oldest first. Every open window polls this and
 * shows exactly this list, so a dismissal made anywhere disappears
 * everywhere on the next poll.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    const messages = [
      ...listPendingChatNotifications(db, userId),
      ...listPendingLearnNotifications(db, userId),
    ].sort((left, right) => notificationTime(left) - notificationTime(right));
    return NextResponse.json({ messages });
  } catch (error) {
    return errorResponse(error);
  }
}

interface DismissRequest {
  /** Notice ids (`msg_<n>` or `learn_<job>:<phase>`) the person closed. */
  dismiss?: unknown;
  /** A chat or a Garden's Learn panel the person is looking at: everything in it is seen. */
  seen?: unknown;
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => null)) as DismissRequest | null;
    if (!body || typeof body !== "object") {
      throw new RouteError(400, "A JSON body is required.");
    }

    const requestedIds = Array.isArray(body.dismiss)
      ? body.dismiss
          .slice(0, MAX_DISMISSALS_PER_REQUEST)
          .filter((id): id is string => typeof id === "string")
      : [];
    const messageIds = requestedIds
      .map(chatNotificationMessageId)
      .filter((id): id is number => id !== null);
    const learnIds = requestedIds
      .map(parseLearnNotificationId)
      .filter((id): id is { jobId: string; phase: LearnNotificationPhase } => id !== null);
    const seen: ChatNotificationTarget | null = isChatNotificationTarget(body.seen)
      ? body.seen
      : null;
    if (messageIds.length === 0 && learnIds.length === 0 && !seen) {
      throw new RouteError(400, "Nothing to dismiss.");
    }

    let dismissed = dismissChatNotifications(db, userId, messageIds);
    dismissed += dismissLearnNotifications(db, userId, learnIds);
    if (seen) {
      dismissed += seen.surface === "garden_learn"
        ? dismissLearnNotificationsForGarden(db, userId, seen.gardenSlug ?? "")
        : dismissChatNotificationsForTarget(db, userId, seen);
    }
    return NextResponse.json({ ok: true, dismissed });
  } catch (error) {
    return errorResponse(error);
  }
}

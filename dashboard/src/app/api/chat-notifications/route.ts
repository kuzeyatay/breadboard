import { NextResponse } from "next/server";
import { RouteError, requireUserId } from "@/lib/server-auth";
import db from "@/lib/db";
import { dismissQuestionNotifications, listPendingQuestionNotifications, questionNotificationId } from "@/lib/chat-notifications/questions";
import {
  chatNotificationMessageId,
  dismissChatNotifications,
  dismissChatNotificationsForTarget,
  listPendingChatNotifications,
  listUnreadChatMessages,
  markUnreadChatMessagesSeen,
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
 * The account's live set of undismissed notices — chat answers, questions and Learn
 * pipeline updates together, oldest first. Every open window polls this and
 * shows exactly this list, so a dismissal made anywhere disappears
 * everywhere on the next poll.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    if (new URL(request.url).searchParams.get("unread") === "1") {
      return NextResponse.json({ unread: listUnreadChatMessages(db, userId) });
    }
    const messages = [
      ...listPendingChatNotifications(db, userId),
      ...listPendingQuestionNotifications(db, userId),
      ...listPendingLearnNotifications(db, userId),
    ].sort((left, right) => notificationTime(left) - notificationTime(right));
    return NextResponse.json({ messages });
  } catch (error) {
    return errorResponse(error);
  }
}

interface DismissRequest {
  /** Exact response ids shown by a chat surface, including surfaces without toasts. */
  read?: unknown;
  /** Notice ids (`msg_<n>`, `question_<n>` or `learn_<job>:<phase>`) the person closed. */
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
    const readIds = Array.isArray(body.read) ? body.read.slice(0, MAX_DISMISSALS_PER_REQUEST)
      .filter((id): id is string => typeof id === "string")
      .map(chatNotificationMessageId).filter((id): id is number => id !== null) : [];
    const messageIds = requestedIds
      .map(chatNotificationMessageId)
      .filter((id): id is number => id !== null);
    const questionIds = requestedIds.map(questionNotificationId)
      .filter((id): id is number => id !== null);
    const learnIds = requestedIds
      .map(parseLearnNotificationId)
      .filter((id): id is { jobId: string; phase: LearnNotificationPhase } => id !== null);
    const seen: ChatNotificationTarget | null = isChatNotificationTarget(body.seen)
      ? body.seen
      : null;
    if (messageIds.length === 0 && questionIds.length === 0 && learnIds.length === 0 && readIds.length === 0 && !seen) {
      throw new RouteError(400, "Nothing to dismiss.");
    }

    let dismissed = dismissChatNotifications(db, userId, messageIds);
    dismissed += dismissQuestionNotifications(db, userId, questionIds, seen);
    dismissed += markUnreadChatMessagesSeen(db, userId, readIds, seen);
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

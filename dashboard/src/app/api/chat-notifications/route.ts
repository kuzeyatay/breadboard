import { NextResponse } from "next/server";
import { RouteError, requireUserId } from "@/lib/server-auth";
import db from "@/lib/db";
import { clearNotificationHistory, initializeNotificationHistory, listNotificationHistory, markNotificationHistoryRead, saveNotificationHistory } from "@/lib/chat-notifications/history";
import { notificationHistoryItem, parseDeliveredNotification } from "@/lib/notification-history";
import { notificationTimestamp } from "@/lib/notification-center";
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
  return notificationTimestamp(record.updatedAt);
}

function pendingNotifications(userId: number): ChatNotificationRecord[] {
  return [...listPendingChatNotifications(db, userId), ...listPendingQuestionNotifications(db, userId),
    ...listPendingLearnNotifications(db, userId)].sort((left, right) => notificationTime(left) - notificationTime(right));
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
    const messages = pendingNotifications(userId);
    const center = new URL(request.url).searchParams.get("center") === "1";
    if (center) initializeNotificationHistory(db, userId, messages);
    saveNotificationHistory(db, userId, messages.map(record => notificationHistoryItem(record)));
    return NextResponse.json({ messages, ...(center ? { history: listNotificationHistory(db, userId) } : {}) });
  } catch (error) {
    return errorResponse(error);
  }
}

interface DismissRequest {
  notice?: unknown;
  clearHistory?: unknown;
  readHistory?: unknown;
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

    if (body.notice !== undefined) {
      const notice = parseDeliveredNotification(body.notice);
      if (!notice) throw new RouteError(400, "Invalid notification.");
      saveNotificationHistory(db, userId, [notice]);
      return NextResponse.json({ ok: true });
    }
    const historyIds = (value: unknown) => Array.isArray(value) ? value.slice(0, MAX_DISMISSALS_PER_REQUEST)
      .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 256) : [];
    const clearHistory = historyIds(body.clearHistory);
    const readHistory = historyIds(body.readHistory);

    const requestedIds = [...(Array.isArray(body.dismiss)
      ? body.dismiss
          .slice(0, MAX_DISMISSALS_PER_REQUEST)
          .filter((id): id is string => typeof id === "string")
      : []), ...[...clearHistory, ...readHistory].filter(id => id.startsWith("chat-notification:")).map(id => id.slice("chat-notification:".length))];
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
    if (messageIds.length === 0 && questionIds.length === 0 && learnIds.length === 0 && readIds.length === 0 && !seen && !clearHistory.length && !readHistory.length) {
      throw new RouteError(400, "Nothing to dismiss.");
    }

    // Capture an answer before a viewing surface consumes its toast receipt.
    const pending = pendingNotifications(userId);
    saveNotificationHistory(db, userId, pending.map(record => notificationHistoryItem(record)));
    markNotificationHistoryRead(db, userId, [...requestedIds.map(id => `chat-notification:${id}`),
      ...readIds.map(id => `chat-notification:msg_${id}`), ...readHistory], seen);
    clearNotificationHistory(db, userId, clearHistory);

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

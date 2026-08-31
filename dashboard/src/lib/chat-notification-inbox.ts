export type ChatNotificationSurface = "dashboard_terminal" | "garden_chat";

export interface ChatNotificationTarget {
  surface: ChatNotificationSurface;
  /** The id understood by the destination UI (canonical for Terminal, legacy for Garden). */
  chatId: string;
  gardenSlug?: string;
}

export interface ChatNotificationRecord {
  id: string;
  title: "Response ready" | "Response failed";
  type: "success" | "error";
  response: string;
  chatTitle: string;
  target: ChatNotificationTarget;
  updatedAt: string;
}

/** A surface began showing a chat: every notice for that chat is now read. */
export const CHAT_NOTIFICATION_OPENED_EVENT =
  "breadboard:chat-notification-opened";

/** A notice asks the page to show a chat without leaving the page. */
export const CHAT_NOTIFICATION_OPEN_REQUEST_EVENT =
  "breadboard:chat-notification-open-request";

const PENDING_REPLY_KEY = "breadboard:chat-notification-pending-reply:v1";
let activelyViewedTarget: ChatNotificationTarget | null = null;

export function isChatNotificationTarget(
  value: unknown,
): value is ChatNotificationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.surface !== "dashboard_terminal" &&
    candidate.surface !== "garden_chat"
  ) {
    return false;
  }
  if (typeof candidate.chatId !== "string" || !candidate.chatId.trim()) {
    return false;
  }
  return candidate.surface !== "garden_chat" ||
    (typeof candidate.gardenSlug === "string" && Boolean(candidate.gardenSlug.trim()));
}

export function isChatNotificationRecord(
  value: unknown,
): value is ChatNotificationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.title === "Response ready" || candidate.title === "Response failed") &&
    (candidate.type === "success" || candidate.type === "error") &&
    typeof candidate.response === "string" &&
    typeof candidate.chatTitle === "string" &&
    typeof candidate.updatedAt === "string" &&
    isChatNotificationTarget(candidate.target)
  );
}

export function chatNotificationTargetKey(
  target: ChatNotificationTarget,
): string {
  return target.surface === "garden_chat"
    ? `garden_chat:${target.gardenSlug}:${target.chatId}`
    : `dashboard_terminal:${target.chatId}`;
}

export function sameChatNotificationTarget(
  left: ChatNotificationTarget,
  right: ChatNotificationTarget,
): boolean {
  return chatNotificationTargetKey(left) === chatNotificationTargetKey(right);
}

export function chatNotificationHref(target: ChatNotificationTarget): string {
  if (target.surface === "garden_chat") {
    return `/gardens/${encodeURIComponent(target.gardenSlug ?? "")}?chat=${encodeURIComponent(target.chatId)}`;
  }
  return `/dashboard?terminalChat=${encodeURIComponent(target.chatId)}`;
}

export function activeChatNotificationTarget(): ChatNotificationTarget | null {
  return activelyViewedTarget;
}

export function setActiveChatNotificationTarget(
  target: ChatNotificationTarget | null,
): void {
  activelyViewedTarget = target;
  if (typeof window === "undefined" || !target) return;
  window.dispatchEvent(
    new CustomEvent<ChatNotificationTarget>(CHAT_NOTIFICATION_OPENED_EVENT, {
      detail: target,
    }),
  );
}

/**
 * Ask whichever surface on this page owns the chat to show it. The Terminal
 * dock listens on the dashboard; a page with no listener leaves the notice to
 * navigate instead.
 */
export function requestChatNotificationOpen(
  target: ChatNotificationTarget,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ChatNotificationTarget>(CHAT_NOTIFICATION_OPEN_REQUEST_EVENT, {
      detail: target,
    }),
  );
}

interface PendingChatNotificationReply {
  target: ChatNotificationTarget;
  message: string;
}

export function queueChatNotificationReply(
  storage: Pick<Storage, "setItem">,
  target: ChatNotificationTarget,
  message: string,
): void {
  storage.setItem(
    PENDING_REPLY_KEY,
    JSON.stringify({ target, message } satisfies PendingChatNotificationReply),
  );
}

export function takeChatNotificationReply(
  storage: Pick<Storage, "getItem" | "removeItem">,
  target: ChatNotificationTarget,
): string | null {
  try {
    const raw = storage.getItem(PENDING_REPLY_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (
      !parsed ||
      !isChatNotificationTarget(parsed.target) ||
      !sameChatNotificationTarget(parsed.target, target) ||
      typeof parsed.message !== "string" ||
      !parsed.message.trim()
    ) {
      return null;
    }
    storage.removeItem(PENDING_REPLY_KEY);
    return parsed.message.trim();
  } catch {
    return null;
  }
}

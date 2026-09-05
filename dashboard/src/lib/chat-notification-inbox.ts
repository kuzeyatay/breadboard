/**
 * `garden_learn` is the Learn pipeline of one Garden: its notices open the
 * Garden with the Learn panel showing, and `chatId` carries the learn job id
 * rather than a chat id.
 */
export type ChatNotificationSurface =
  | "dashboard_terminal"
  | "garden_chat"
  | "garden_learn";

export interface ChatNotificationTarget {
  surface: ChatNotificationSurface;
  /** The id understood by the destination UI (canonical for Terminal, legacy for Garden, job id for Learn). */
  chatId: string;
  gardenSlug?: string;
}

export const CHAT_RESPONSE_NOTIFICATION_TITLES = [
  "Response ready",
  "Response failed",
] as const;

export const LEARN_NOTIFICATION_TITLES = [
  "Learn in progress",
  "Learn paused",
  "Learn awaiting review",
  "Learn complete",
  "Learn failed",
  "Learn cancelled",
] as const;

export type ChatNotificationTitle =
  | (typeof CHAT_RESPONSE_NOTIFICATION_TITLES)[number]
  | (typeof LEARN_NOTIFICATION_TITLES)[number];

export type ChatNotificationKind = "chat_response" | "learn";

export interface ChatNotificationRecord {
  id: string;
  title: ChatNotificationTitle;
  type: "success" | "error";
  /**
   * The assistant's answer for a chat notice. Empty for a Learn notice, which
   * carries its detail in `message` instead and offers no reply box.
   */
  response: string;
  /** The chat's title, or the Garden's name for a Learn notice. */
  chatTitle: string;
  target: ChatNotificationTarget;
  updatedAt: string;
  /** Defaults to `chat_response` when absent so older payloads keep working. */
  kind?: ChatNotificationKind;
  /** One line of status detail for a Learn notice (stage, section, page). */
  message?: string;
  /** 0-100 while a Learn run is in progress; drives the status bar on the card. */
  progressPercent?: number;
}

/** A surface began showing a chat: every notice for that chat is now read. */
export const CHAT_NOTIFICATION_OPENED_EVENT =
  "breadboard:chat-notification-opened";

/** A notice asks the page to show a chat without leaving the page. */
export const CHAT_NOTIFICATION_OPEN_REQUEST_EVENT =
  "breadboard:chat-notification-open-request";

const PENDING_REPLY_KEY = "breadboard:chat-notification-pending-reply:v1";
let activelyViewedTarget: ChatNotificationTarget | null = null;
let activelyViewedLearnGarden: string | null = null;

/** The Learn pipeline of every job in one Garden: used as a `seen` target. */
export const LEARN_NOTIFICATION_ANY_JOB = "*";

export function isChatNotificationTarget(
  value: unknown,
): value is ChatNotificationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.surface !== "dashboard_terminal" &&
    candidate.surface !== "garden_chat" &&
    candidate.surface !== "garden_learn"
  ) {
    return false;
  }
  if (typeof candidate.chatId !== "string" || !candidate.chatId.trim()) {
    return false;
  }
  return candidate.surface === "dashboard_terminal" ||
    (typeof candidate.gardenSlug === "string" && Boolean(candidate.gardenSlug.trim()));
}

export function isChatNotificationRecord(
  value: unknown,
): value is ChatNotificationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const knownTitle = (
    CHAT_RESPONSE_NOTIFICATION_TITLES as readonly string[]
  ).includes(candidate.title as string) ||
    (LEARN_NOTIFICATION_TITLES as readonly string[]).includes(candidate.title as string);
  return (
    typeof candidate.id === "string" &&
    knownTitle &&
    (candidate.type === "success" || candidate.type === "error") &&
    typeof candidate.response === "string" &&
    typeof candidate.chatTitle === "string" &&
    typeof candidate.updatedAt === "string" &&
    (candidate.kind === undefined ||
      candidate.kind === "chat_response" ||
      candidate.kind === "learn") &&
    (candidate.message === undefined || typeof candidate.message === "string") &&
    (candidate.progressPercent === undefined ||
      (typeof candidate.progressPercent === "number" &&
        Number.isFinite(candidate.progressPercent))) &&
    isChatNotificationTarget(candidate.target)
  );
}

export function chatNotificationKind(
  record: Pick<ChatNotificationRecord, "kind">,
): ChatNotificationKind {
  return record.kind ?? "chat_response";
}

export function chatNotificationTargetKey(
  target: ChatNotificationTarget,
): string {
  if (target.surface === "garden_learn") {
    return `garden_learn:${target.gardenSlug}:${target.chatId}`;
  }
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
  if (target.surface === "garden_learn") {
    return `/gardens/${encodeURIComponent(target.gardenSlug ?? "")}?learn=1`;
  }
  if (target.surface === "garden_chat") {
    return `/gardens/${encodeURIComponent(target.gardenSlug ?? "")}?chat=${encodeURIComponent(target.chatId)}`;
  }
  return `/dashboard?terminalChat=${encodeURIComponent(target.chatId)}`;
}

/**
 * Send a follow-up from a notification without changing the page or selecting
 * the originating chat. The server resolves and authorizes the target, then
 * gives the turn to the same detached pump used by other background sends.
 */
export async function sendChatNotificationReply(
  target: ChatNotificationTarget,
  message: string,
): Promise<void> {
  const response = await fetch("/api/chat-notifications/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, message }),
  });
  const body = (await response.json().catch(() => null)) as
    | { accepted?: boolean; error?: string }
    | null;
  if (!response.ok || body?.accepted !== true) {
    throw new Error(body?.error?.trim() || "The reply could not be sent.");
  }
}

export function activeChatNotificationTarget(): ChatNotificationTarget | null {
  return activelyViewedTarget;
}

/** A page is showing this Garden's Learn panel: its Learn notices are read. */
export const LEARN_NOTIFICATION_OPENED_EVENT =
  "breadboard:learn-notification-opened";

export function activeLearnNotificationGarden(): string | null {
  return activelyViewedLearnGarden;
}

/**
 * The Learn panel repeats everything a Learn notice would say, so while it is
 * on screen for a Garden, that Garden's notices are already seen. Mirrors
 * `setActiveChatNotificationTarget` for chats.
 */
export function setActiveLearnNotificationGarden(gardenSlug: string | null): void {
  activelyViewedLearnGarden = gardenSlug;
  if (typeof window === "undefined" || !gardenSlug) return;
  window.dispatchEvent(
    new CustomEvent<ChatNotificationTarget>(LEARN_NOTIFICATION_OPENED_EVENT, {
      detail: {
        surface: "garden_learn",
        gardenSlug,
        chatId: LEARN_NOTIFICATION_ANY_JOB,
      },
    }),
  );
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

export const TASK_COMPLETION_NOTIFICATION_EVENT =
  "breadboard:task-completed";

/**
 * An answer finished in the chat the person was already looking at. No notice
 * is wanted for it, anywhere: the corner inbox uses this to mark the answer
 * seen for every window before its next poll could announce it.
 */
export const CHAT_RESPONSE_SEEN_EVENT = "breadboard:chat-response-seen";

export interface ChatResponseSeenDetail {
  chatId: string;
}

const MAX_TASK_LABEL_LENGTH = 78;

export interface TaskCompletionNotificationDetail {
  title: "Task completed" | "Response ready" | "Response failed";
  message: string;
  type: "success" | "error";
  /** The conversation this notice can take the reader back to. */
  chatId?: string;
  /** Full assistant text. It is intentionally never shortened for display. */
  response?: string;
}

export interface TaskCompletionNotificationOptions {
  chatId?: number | string | null;
  activeChatId?: number | string | null;
  response?: string | null;
}

export function taskCompletionLabel(task: string): string {
  const normalized = task
    .replace(/^\s*\/[a-z0-9:_-]+\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Chat task";
  if (normalized.length <= MAX_TASK_LABEL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TASK_LABEL_LENGTH - 1).trimEnd()}…`;
}

export function taskCompletionNotification(
  task: string,
): TaskCompletionNotificationDetail {
  return {
    title: "Task completed",
    message: `Finished “${taskCompletionLabel(task)}”.`,
    type: "success",
  };
}

export function chatResponseNotification(
  task: string,
  type: "success" | "error" = "success",
): TaskCompletionNotificationDetail {
  const label = taskCompletionLabel(task);
  return type === "success"
    ? {
        title: "Response ready",
        message: `Answered “${label}”.`,
        type,
      }
    : {
        title: "Response failed",
        message: `Couldn’t finish “${label}”.`,
        type,
      };
}

export function isTaskChatActivelyViewed(
  options: TaskCompletionNotificationOptions = {},
): boolean {
  if (typeof document === "undefined") return false;

  // A turn that belongs to the chat on screen announces itself in the
  // transcript, so a toast for it is never wanted -- not even when the window
  // is behind another one. Window focus only decides the case of a run with no
  // chat to be compared against.
  if (options.chatId !== undefined && options.chatId !== null) {
    if (options.activeChatId === undefined || options.activeChatId === null) return false;
    return String(options.chatId) === String(options.activeChatId);
  }
  return document.visibilityState === "visible" && document.hasFocus();
}

export function notifyTaskCompleted(
  task: string,
  options: TaskCompletionNotificationOptions = {},
): void {
  if (typeof window === "undefined") return;
  if (isTaskChatActivelyViewed(options)) return;
  window.dispatchEvent(
    new CustomEvent<TaskCompletionNotificationDetail>(
      TASK_COMPLETION_NOTIFICATION_EVENT,
      {
        detail: {
          ...taskCompletionNotification(task),
          ...(options.chatId !== undefined && options.chatId !== null
            ? { chatId: String(options.chatId) }
            : {}),
        },
      },
    ),
  );
}

function notifyChatResponse(
  task: string,
  type: "success" | "error",
  options: TaskCompletionNotificationOptions,
): void {
  if (typeof window === "undefined") return;
  if (isTaskChatActivelyViewed(options)) {
    if (options.chatId !== undefined && options.chatId !== null) {
      window.dispatchEvent(
        new CustomEvent<ChatResponseSeenDetail>(CHAT_RESPONSE_SEEN_EVENT, {
          detail: { chatId: String(options.chatId) },
        }),
      );
    }
    return;
  }
  window.dispatchEvent(
    new CustomEvent<TaskCompletionNotificationDetail>(
      TASK_COMPLETION_NOTIFICATION_EVENT,
      {
        detail: {
          ...chatResponseNotification(task, type),
          ...(options.chatId !== undefined && options.chatId !== null
            ? { chatId: String(options.chatId) }
            : {}),
          ...(options.response?.trim()
            ? { response: options.response.trim() }
            : {}),
        },
      },
    ),
  );
}

export function notifyChatResponseReady(
  task: string,
  options: TaskCompletionNotificationOptions = {},
): void {
  notifyChatResponse(task, "success", options);
}

export function notifyChatResponseFailed(
  task: string,
  options: TaskCompletionNotificationOptions = {},
): void {
  notifyChatResponse(task, "error", options);
}

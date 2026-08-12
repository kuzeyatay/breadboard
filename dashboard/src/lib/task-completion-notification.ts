export const TASK_COMPLETION_NOTIFICATION_EVENT =
  "breadboard:task-completed";

const MAX_TASK_LABEL_LENGTH = 78;

export interface TaskCompletionNotificationDetail {
  title: "Task completed";
  message: string;
  type: "success";
}

export interface TaskCompletionNotificationOptions {
  chatId?: number | string | null;
  activeChatId?: number | string | null;
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

export function isTaskChatActivelyViewed(
  options: TaskCompletionNotificationOptions = {},
): boolean {
  if (typeof document === "undefined") return false;
  if (document.visibilityState !== "visible" || !document.hasFocus()) return false;

  if (options.chatId === undefined || options.chatId === null) return true;
  if (options.activeChatId === undefined || options.activeChatId === null) return false;
  return String(options.chatId) === String(options.activeChatId);
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
      { detail: taskCompletionNotification(task) },
    ),
  );
}

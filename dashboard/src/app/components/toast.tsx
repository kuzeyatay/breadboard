'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  CHAT_RESPONSE_SEEN_EVENT,
  TASK_COMPLETION_NOTIFICATION_EVENT,
  type ChatResponseSeenDetail,
  type TaskCompletionNotificationDetail,
} from '@/lib/task-completion-notification';
import {
  CHAT_NOTIFICATION_OPENED_EVENT,
  activeChatNotificationTarget,
  chatNotificationHref,
  chatNotificationTargetKey,
  isChatNotificationRecord,
  queueChatNotificationReply,
  sameChatNotificationTarget,
  type ChatNotificationRecord,
  type ChatNotificationTarget,
} from '@/lib/chat-notification-inbox';

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error';
  title?: string;
  chatId?: string;
  response?: string;
  notificationId?: string;
  target?: ChatNotificationTarget;
}

interface ChatNotificationPollResponse {
  messages?: unknown;
}

let nextToastId = 0;
const POLL_INTERVAL_MS = 4_000;
const CHAT_NOTIFICATION_TOAST_PREFIX = 'chat-notification:';
/**
 * How long after a chat was on screen its answers still count as seen. An
 * answer that finished while the chat was open reaches the database a moment
 * later than the page learns of it; this covers the poll that lands in
 * between, without letting a much later answer to that chat go unannounced.
 */
const SEEN_TARGET_GRACE_MS = 20_000;

function notificationToast(record: ChatNotificationRecord): ToastItem {
  return {
    id: `${CHAT_NOTIFICATION_TOAST_PREFIX}${record.id}`,
    notificationId: record.id,
    message: record.chatTitle,
    title: record.title,
    type: record.type,
    chatId: record.target.chatId,
    response: record.response,
    target: record.target,
  };
}

function sameNotificationList(
  left: readonly ChatNotificationRecord[],
  right: readonly ChatNotificationRecord[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((record, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      record.id === other.id &&
      record.updatedAt === other.updatedAt &&
      record.response === other.response &&
      record.chatTitle === other.chatTitle
    );
  });
}

async function postChatNotificationDismissal(body: {
  dismiss?: string[];
  seen?: ChatNotificationTarget;
}): Promise<void> {
  try {
    await fetch('/api/chat-notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // The arrow on a notice navigates away right after dismissing it. The
      // dismissal must still reach the server, or the notice greets the
      // person again on the destination page.
      keepalive: true,
    });
  } catch {
    // The notice stays hidden here; the next poll re-shows it only if the
    // server never learned of the dismissal, which is the truthful outcome.
  }
}

/**
 * Corner notices.
 *
 * Plain notices (`addToast`) are local to this page and vanish when it does.
 * Chat-response notices are a different thing: they are read from the
 * account's server-side inbox, so the same list appears in every window and
 * survives restarts, and dismissing one anywhere dismisses it everywhere.
 * Three rules decide what that inbox shows:
 *
 * 1. Opening the chat a notice belongs to closes the notice.
 * 2. An answer that lands in the chat already on screen is never announced.
 * 3. A dismissed notice never returns.
 */
export function useToast() {
  const [localToasts, setLocalToasts] = useState<ToastItem[]>([]);
  const [notifications, setNotifications] = useState<ChatNotificationRecord[]>([]);
  const notificationsRef = useRef<ChatNotificationRecord[]>([]);
  // Dismissed here, awaiting the server's confirmation on a later poll.
  const hiddenIdsRef = useRef<Set<string>>(new Set());
  // Chats seen on this page recently: target key → the time that stops counting.
  const seenTargetsRef = useRef<Map<string, number>>(new Map());
  const pollInFlightRef = useRef(false);

  const replaceNotifications = useCallback((next: ChatNotificationRecord[]) => {
    if (sameNotificationList(notificationsRef.current, next)) return;
    notificationsRef.current = next;
    setNotifications(next);
  }, []);

  const hideNotifications = useCallback((
    predicate: (record: ChatNotificationRecord) => boolean,
  ): ChatNotificationRecord[] => {
    const hidden: ChatNotificationRecord[] = [];
    const kept: ChatNotificationRecord[] = [];
    for (const record of notificationsRef.current) {
      if (predicate(record)) hidden.push(record);
      else kept.push(record);
    }
    for (const record of hidden) hiddenIdsRef.current.add(record.id);
    if (hidden.length > 0) replaceNotifications(kept);
    return hidden;
  }, [replaceNotifications]);

  const dismissToast = useCallback((id: string) => {
    const notificationId = id.startsWith(CHAT_NOTIFICATION_TOAST_PREFIX)
      ? id.slice(CHAT_NOTIFICATION_TOAST_PREFIX.length)
      : null;
    if (notificationId) {
      hiddenIdsRef.current.add(notificationId);
      hideNotifications((record) => record.id === notificationId);
      void postChatNotificationDismissal({ dismiss: [notificationId] });
      return;
    }
    setLocalToasts((current) => current.filter((toast) => toast.id !== id));
  }, [hideNotifications]);

  /** The person is looking at this chat: every notice for it is read. */
  const dismissChatToasts = useCallback((target: ChatNotificationTarget) => {
    seenTargetsRef.current.set(
      chatNotificationTargetKey(target),
      Date.now() + SEEN_TARGET_GRACE_MS,
    );
    hideNotifications((record) =>
      sameChatNotificationTarget(record.target, target),
    );
    void postChatNotificationDismissal({ seen: target });
  }, [hideNotifications]);

  const addToast = useCallback((
    message: string,
    type: 'success' | 'error' = 'error',
    title?: string,
    chatId?: string,
    response?: string,
  ) => {
    const id = `toast:${++nextToastId}`;
    setLocalToasts((current) => [
      ...current,
      { id, message, type, title, chatId, response },
    ]);
  }, []);

  const pollChatNotifications = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const response = await fetch('/api/chat-notifications', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = (await response.json()) as ChatNotificationPollResponse;
      const incoming = Array.isArray(data.messages)
        ? data.messages.filter(isChatNotificationRecord)
        : [];

      const now = Date.now();
      for (const [key, until] of seenTargetsRef.current) {
        if (until <= now) seenTargetsRef.current.delete(key);
      }
      const activeTarget = activeChatNotificationTarget();
      const visible: ChatNotificationRecord[] = [];
      const readAlready: string[] = [];
      for (const record of incoming) {
        if (hiddenIdsRef.current.has(record.id)) continue;
        const onScreen =
          (activeTarget !== null &&
            sameChatNotificationTarget(record.target, activeTarget)) ||
          seenTargetsRef.current.has(chatNotificationTargetKey(record.target));
        if (onScreen) {
          hiddenIdsRef.current.add(record.id);
          readAlready.push(record.id);
        } else {
          visible.push(record);
        }
      }
      // The server has caught up with every dismissal it no longer returns.
      const returned = new Set(incoming.map((record) => record.id));
      for (const id of hiddenIdsRef.current) {
        if (!returned.has(id)) hiddenIdsRef.current.delete(id);
      }
      replaceNotifications(visible);
      if (readAlready.length > 0) {
        void postChatNotificationDismissal({ dismiss: readAlready });
      }
    } catch {
      // The next interval reads the same server-side inbox again.
    } finally {
      pollInFlightRef.current = false;
    }
  }, [replaceNotifications]);

  useEffect(() => {
    void pollChatNotifications();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void pollChatNotifications();
      }
    }, POLL_INTERVAL_MS);
    const pollWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void pollChatNotifications();
      }
    };
    document.addEventListener('visibilitychange', pollWhenVisible);
    window.addEventListener('focus', pollWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', pollWhenVisible);
      window.removeEventListener('focus', pollWhenVisible);
    };
  }, [pollChatNotifications]);

  useEffect(() => {
    const listener = (raw: Event) => {
      const detail = (raw as CustomEvent<TaskCompletionNotificationDetail>).detail;
      if (!detail?.message) return;
      // Chat responses come from the durable server-side inbox above. Ignoring
      // the process-local completion event prevents a restored monitor from
      // recreating a message the person already dismissed before restarting.
      if (
        detail.chatId &&
        (detail.title === 'Response ready' || detail.title === 'Response failed')
      ) {
        return;
      }
      addToast(
        detail.message,
        detail.type,
        detail.title,
        detail.chatId,
        detail.response,
      );
    };
    window.addEventListener(TASK_COMPLETION_NOTIFICATION_EVENT, listener);
    return () =>
      window.removeEventListener(TASK_COMPLETION_NOTIFICATION_EVENT, listener);
  }, [addToast]);

  useEffect(() => {
    const opened = (raw: Event) => {
      const target = (raw as CustomEvent<ChatNotificationTarget>).detail;
      if (!target?.chatId) return;
      dismissChatToasts(target);
    };
    // An answer finished in the chat on screen. The surface names the chat by
    // id only; the target it maps to is the one this page reported viewing.
    const seen = (raw: Event) => {
      const detail = (raw as CustomEvent<ChatResponseSeenDetail>).detail;
      const activeTarget = activeChatNotificationTarget();
      if (!detail?.chatId || !activeTarget) return;
      if (String(detail.chatId) !== activeTarget.chatId) return;
      dismissChatToasts(activeTarget);
    };
    window.addEventListener(CHAT_NOTIFICATION_OPENED_EVENT, opened);
    window.addEventListener(CHAT_RESPONSE_SEEN_EVENT, seen);
    return () => {
      window.removeEventListener(CHAT_NOTIFICATION_OPENED_EVENT, opened);
      window.removeEventListener(CHAT_RESPONSE_SEEN_EVENT, seen);
    };
  }, [dismissChatToasts]);

  const toasts = useMemo(
    () => [...localToasts, ...notifications.map(notificationToast)],
    [localToasts, notifications],
  );

  return { toasts, addToast, dismissToast, dismissChatToasts };
}

function ToastCard({
  toast,
  onDismiss,
  onOpenChat,
  onReplyToChat,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onOpenChat?: (target: ChatNotificationTarget) => boolean | void;
  onReplyToChat?: (
    target: ChatNotificationTarget,
    message: string,
  ) => boolean | void | Promise<boolean | void>;
}) {
  const [reply, setReply] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const hasAssistantResponse = Boolean(toast.response);
  const canReply = Boolean(hasAssistantResponse && toast.target);

  function openChat() {
    if (!toast.target) return;
    // Dismiss first: the durable dismissal has to be on its way before a
    // navigation unmounts this page.
    onDismiss(toast.id);
    const handled = onOpenChat?.(toast.target) === true;
    if (!handled) window.location.assign(chatNotificationHref(toast.target));
  }

  async function submitReply() {
    const message = reply.trim();
    if (!message || !toast.target || sendingReply) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      const handled = await onReplyToChat?.(toast.target, message);
      onDismiss(toast.id);
      if (handled !== true) {
        queueChatNotificationReply(window.sessionStorage, toast.target, message);
        window.location.assign(chatNotificationHref(toast.target));
      }
    } catch (error) {
      setReplyError(
        error instanceof Error ? error.message : 'The reply could not be sent.',
      );
      setSendingReply(false);
    }
  }

  return (
    <div
      className={`pointer-events-auto flex max-h-[calc(100vh-2rem)] flex-col rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] text-sm text-[var(--ink)] shadow-[0_8px_24px_rgba(54,67,58,0.13)] ${
        hasAssistantResponse
          ? 'w-[min(36rem,calc(100vw-2rem))] p-4'
          : 'w-[min(20rem,calc(100vw-2rem))] px-3 py-2.5'
      }`}
      role={toast.type === 'error' ? 'alert' : 'status'}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
        <span
          className={`mt-1.5 size-2 shrink-0 rounded-full ${
            toast.type === 'error'
              ? 'bg-[var(--danger)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_14%,transparent)]'
              : 'bg-[var(--botanical)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--botanical)_14%,transparent)]'
          }`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          {toast.title ? (
            <span className="block text-xs font-semibold text-[var(--ink-heading)]">
              {toast.title}
            </span>
          ) : null}
          {!hasAssistantResponse ? (
            <span
              className={`block leading-5 ${
                toast.title ? 'mt-0.5 text-xs text-[var(--ink-muted)]' : ''
              }`}
            >
              {toast.message}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {toast.target ? (
            <button
              type="button"
              onClick={openChat}
              className="neu-button-icon flex h-8 w-8 items-center justify-center rounded-md text-base font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)] active:scale-[0.97]"
              aria-label="Open this chat"
              title="Open chat"
            >
              <span aria-hidden>↗</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xl leading-none text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] active:scale-[0.97]"
            aria-label="Dismiss message"
            title="Dismiss"
          >
            <span aria-hidden>×</span>
          </button>
        </span>
      </div>

      {hasAssistantResponse ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-[var(--line)] pt-3">
          <div
            className="max-h-[min(42vh,24rem)] overflow-y-auto overscroll-contain pr-2 [scrollbar-width:thin]"
            tabIndex={0}
            aria-label="AI response"
          >
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink)]">
              {toast.response}
            </p>
          </div>

          {canReply ? (
            <form
              className="mt-3 border-t border-[var(--line)] pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitReply();
              }}
            >
              <label
                className="mb-1.5 block text-[11px] font-medium text-[var(--ink-muted)]"
                htmlFor={`toast-reply-${toast.id}`}
              >
                Reply to this chat
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2">
                <textarea
                  id={`toast-reply-${toast.id}`}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey) return;
                    event.preventDefault();
                    void submitReply();
                  }}
                  rows={2}
                  disabled={sendingReply}
                  placeholder="Write a reply…"
                  className="min-h-16 min-w-0 resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm leading-5 text-[var(--ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--ink-muted)] focus:border-[var(--botanical)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--botanical)_12%,transparent)] disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!reply.trim() || sendingReply}
                  className="min-h-16 self-stretch rounded-lg bg-[var(--botanical)] px-4 text-xs font-semibold text-white transition-[transform,opacity] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {sendingReply ? 'Sending…' : 'Send'}
                </button>
              </div>
              {replyError ? (
                <p className="mt-1.5 text-xs text-[var(--danger)]" role="alert">
                  {replyError}
                </p>
              ) : null}
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Toaster({
  toasts,
  onDismiss,
  onOpenChat,
  onReplyToChat,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onOpenChat?: (target: ChatNotificationTarget) => boolean | void;
  onReplyToChat?: (
    target: ChatNotificationTarget,
    message: string,
  ) => boolean | void | Promise<boolean | void>;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-h-[calc(100vh-2rem)] flex-col items-end gap-2 overflow-y-auto [scrollbar-width:thin]"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          onOpenChat={onOpenChat}
          onReplyToChat={onReplyToChat}
        />
      ))}
    </div>
  );
}

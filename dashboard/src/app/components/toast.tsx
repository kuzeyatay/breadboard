'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  TASK_COMPLETION_NOTIFICATION_EVENT,
  type TaskCompletionNotificationDetail,
} from '@/lib/task-completion-notification';

export interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error';
  title?: string;
  chatId?: string;
  response?: string;
}

let _id = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissChatToasts = useCallback((chatId: number | string) => {
    const key = String(chatId);
    setToasts((prev) => {
      if (!prev.some((toast) => toast.chatId === key)) return prev;
      return prev.filter((toast) => toast.chatId !== key);
    });
  }, []);

  const addToast = useCallback((
    message: string,
    type: 'success' | 'error' = 'error',
    title?: string,
    chatId?: string,
    response?: string,
  ) => {
    const id = ++_id;
    setToasts((prev) => {
      // The rail-transition fallback and the live response stream can observe
      // the same completion. Keep one persistent notice per chat, but let the
      // richer event fill in assistant text if the first event was only a
      // completion signal.
      const existingIndex = chatId
        ? prev.findIndex((toast) => toast.chatId === chatId)
        : -1;
      if (existingIndex >= 0) {
        if (!response || prev[existingIndex]?.response === response) return prev;
        return prev.map((toast, index) =>
          index === existingIndex
            ? { ...toast, message, type, title, response }
            : toast,
        );
      }
      return [...prev, { id, message, type, title, chatId, response }];
    });
  }, []);

  useEffect(() => {
    const listener = (raw: Event) => {
      const detail = (raw as CustomEvent<TaskCompletionNotificationDetail>).detail;
      if (!detail?.message) return;
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

  return { toasts, addToast, dismissToast, dismissChatToasts };
}

function ToastCard({
  toast,
  onDismiss,
  onOpenChat,
  onReplyToChat,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
  onOpenChat?: (chatId: string) => void;
  onReplyToChat?: (chatId: string, message: string) => void | Promise<void>;
}) {
  const [reply, setReply] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const hasAssistantResponse = Boolean(toast.response);
  const canReply = Boolean(
    hasAssistantResponse && toast.chatId && onReplyToChat,
  );

  async function submitReply() {
    const message = reply.trim();
    if (!message || !toast.chatId || !onReplyToChat || sendingReply) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      await onReplyToChat(toast.chatId, message);
      onDismiss(toast.id);
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
          {toast.chatId && onOpenChat ? (
            <button
              type="button"
              onClick={() => {
                onOpenChat(toast.chatId!);
                onDismiss(toast.id);
              }}
              className="neu-button-icon flex h-7 w-7 items-center justify-center rounded-md text-base font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)] active:scale-[0.97]"
              aria-label="Open this chat"
              title="Open chat"
            >
              <span aria-hidden>↗</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] active:scale-[0.97]"
            aria-label="Dismiss message"
            title="Dismiss"
          >
            Dismiss
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
              <div className="flex items-end gap-2">
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
                  className="min-h-16 flex-1 resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm leading-5 text-[var(--ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--ink-muted)] focus:border-[var(--botanical)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--botanical)_12%,transparent)] disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!reply.trim() || sendingReply}
                  className="rounded-lg bg-[var(--botanical)] px-3 py-2 text-xs font-semibold text-white transition-[transform,opacity] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45"
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
  onDismiss: (id: number) => void;
  onOpenChat?: (chatId: string) => void;
  onReplyToChat?: (chatId: string, message: string) => void | Promise<void>;
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

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
}

let _id = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((
    message: string,
    type: 'success' | 'error' = 'error',
    title?: string,
  ) => {
    const id = ++_id;
    setToasts((prev) => [...prev, { id, message, type, title }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    const listener = (raw: Event) => {
      const detail = (raw as CustomEvent<TaskCompletionNotificationDetail>).detail;
      if (!detail?.message) return;
      addToast(detail.message, detail.type, detail.title);
    };
    window.addEventListener(TASK_COMPLETION_NOTIFICATION_EVENT, listener);
    return () =>
      window.removeEventListener(TASK_COMPLETION_NOTIFICATION_EVENT, listener);
  }, [addToast]);

  return { toasts, addToast, dismissToast };
}

export function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss?: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="neu-popover pointer-events-auto flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] px-3.5 py-3 text-sm text-[var(--ink)] shadow-[8px_8px_18px_rgba(54,67,58,0.16),-6px_-6px_16px_rgba(255,255,255,0.76)] animate-in fade-in slide-in-from-bottom-2"
        >
          <span
            className={`neu-inset mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--line)] ${
              t.type === 'error'
                ? 'text-[var(--danger)]'
                : 'text-[var(--botanical)]'
            }`}
            aria-hidden
          >
            {t.type === 'error' ? (
              <span className="text-sm font-semibold">!</span>
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m6.5 12.5 3.25 3.25L17.5 8" />
              </svg>
            )}
          </span>
          <span className="min-w-0 flex-1">
            {t.title ? (
              <span className="block text-xs font-semibold text-[var(--ink-heading)]">
                {t.title}
              </span>
            ) : null}
            <span className={`block leading-5 ${t.title ? 'mt-0.5 text-xs text-[var(--ink-muted)]' : ''}`}>
              {t.message}
            </span>
          </span>
          {onDismiss ? (
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="shrink-0 rounded-full p-1 text-[var(--ink-muted)] opacity-70 transition hover:bg-[var(--paper-strong)] hover:opacity-100"
              aria-label="Dismiss message"
              title="Dismiss"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

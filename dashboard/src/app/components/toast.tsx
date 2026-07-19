'use client';

import { useState, useCallback } from 'react';

export interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error';
}

let _id = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    const id = ++_id;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return { toasts, addToast, dismissToast };
}

export function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss?: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`neu-popover pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border px-4 py-3 text-sm animate-in fade-in slide-in-from-bottom-2 ${
            t.type === 'error'
              ? 'bg-gray-950 border-red-600 text-red-400'
              : 'bg-gray-950 border-green-600 text-green-400'
          }`}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {onDismiss ? (
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-current opacity-60 transition hover:bg-white/10 hover:opacity-100"
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

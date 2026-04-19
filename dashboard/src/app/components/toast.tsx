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

  const addToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    const id = ++_id;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return { toasts, addToast };
}

export function Toaster({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-3 rounded-lg text-sm shadow-xl border animate-in fade-in slide-in-from-bottom-2 ${
            t.type === 'error'
              ? 'bg-gray-950 border-red-900 text-red-400'
              : 'bg-gray-950 border-gray-700 text-green-400'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

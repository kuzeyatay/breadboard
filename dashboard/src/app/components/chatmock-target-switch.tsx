'use client';

import { useState } from 'react';
import {
  CHATMOCK_TARGET_COOKIE,
  normalizeChatmockTarget,
  type ChatmockTarget,
} from '@/lib/chatmock-target';

interface Props {
  initialTarget: ChatmockTarget;
}

const OPTIONS: Array<{
  label: string;
  target: ChatmockTarget;
  title: string;
}> = [
  {
    label: 'Localhost',
    target: 'localhost',
    title: 'Use the ChatMock endpoint configured as localhost for the dashboard server.',
  },
  {
    label: 'Host',
    target: 'host',
    title: 'Use the current dashboard host on the ChatMock host port.',
  },
];

export default function ChatmockTargetSwitch({ initialTarget }: Props) {
  const [target, setTarget] = useState<ChatmockTarget>(initialTarget);
  const [isSaving, setIsSaving] = useState(false);

  function persistTargetCookie(nextTarget: ChatmockTarget) {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CHATMOCK_TARGET_COOKIE}=${encodeURIComponent(nextTarget)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
  }

  async function updateTarget(nextTarget: ChatmockTarget) {
    if (nextTarget === target || isSaving) return;

    const previousTarget = target;
    setTarget(nextTarget);
    setIsSaving(true);
    persistTargetCookie(nextTarget);

    try {
      const response = await fetch('/api/chatmock-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: nextTarget }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string'
            ? body.error
            : 'Could not update ChatMock target',
        );
      }

      setTarget(normalizeChatmockTarget(body.target));
    } catch {
      setTarget(previousTarget);
      persistTargetCookie(previousTarget);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-[11px] uppercase tracking-[0.14em] text-gray-600 sm:inline">
        Chat
      </span>
      <div className="inline-flex items-center rounded-lg border border-gray-800 bg-gray-900/80 p-1">
        {OPTIONS.map((option) => {
          const active = option.target === target;
          return (
            <button
              key={option.target}
              type="button"
              title={option.title}
              aria-pressed={active}
              disabled={isSaving}
              onClick={() => void updateTarget(option.target)}
              className={[
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'bg-white text-gray-950'
                  : 'text-gray-400 hover:text-white',
                isSaving ? 'cursor-wait' : '',
              ].join(' ')}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { normalizePromptSuggestion, promptSuggestionContext, type PromptSuggestionMessage } from '@/lib/chat-prompt-suggestion';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { RECALL_SETTINGS_CHANGED_EVENT } from './recall-autostart-lifecycle';
import { RECOMMENDATION_REFRESH_EVENT } from '@/lib/recommendations/types';

const NO_MESSAGES: readonly PromptSuggestionMessage[] = [];

export function usePromptSuggestion({ messages = NO_MESSAGES, conversationKey, model, value, enabled, onChange, personalize = false, gardenSlug }: {
  messages?: readonly PromptSuggestionMessage[];
  conversationKey: string;
  model: string;
  value: string;
  enabled: boolean;
  onChange: (value: string) => void;
  personalize?: boolean;
  gardenSlug?: string | null;
}) {
  const descriptionId = useId();
  const [revision, setRevision] = useState(0);
  const context = useMemo(() => promptSuggestionContext(messages), [messages]);
  // Content, not array identity, owns a request. Streaming and unrelated
  // parent renders must not start a series of background completions.
  const transcript = JSON.stringify(context);
  const key = JSON.stringify([conversationKey, model, messages.at(-1)?.clientMessageId, transcript, personalize, gardenSlug, revision]);
  const [result, setResult] = useState<{ key: string; text: string } | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    const changed = () => { setResult(null); attempted.current.clear(); setRevision(value => value + 1); };
    for (const event of [AUTH_CHANGED_EVENT, RECALL_SETTINGS_CHANGED_EVENT, RECOMMENDATION_REFRESH_EVENT]) window.addEventListener(event, changed);
    return () => { for (const event of [AUTH_CHANGED_EVENT, RECALL_SETTINGS_CHANGED_EVENT, RECOMMENDATION_REFRESH_EVENT]) window.removeEventListener(event, changed); };
  }, []);
  const hasConversation = context.length > 0;
  const eligible = enabled && value === '' && (hasConversation || (personalize && messages.length === 0)) && Boolean(model) && model !== 'none' && key !== dismissedKey;

  useEffect(() => {
    if (!eligible || attempted.current.has(key)) return;
    const controller = new AbortController();
    let requestTimeout: number | undefined;
    const timer = window.setTimeout(async () => {
      attempted.current.add(key);
      // Keep only a small in-memory history; no transcript is persisted here.
      if (attempted.current.size > 30) attempted.current.delete(attempted.current.values().next().value!);
      requestTimeout = window.setTimeout(() => controller.abort(), 27_000);
      try {
        const now = new Date();
        const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const localTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const response = await fetch(hasConversation ? '/api/chat-prompt-suggestion' : '/api/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: JSON.parse(transcript), model, personalize, gardenSlug, localDate, localTime, timeZone }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json();
        const text = normalizePromptSuggestion(hasConversation ? payload.suggestion : payload.recommendations?.[0]?.prompt);
        if (!controller.signal.aborted && text) setResult({ key, text });
      } catch {
        // Suggestions are optional; leave the ordinary composer available.
      } finally {
        window.clearTimeout(requestTimeout);
      }
    }, 700);
    return () => { window.clearTimeout(timer); window.clearTimeout(requestTimeout); controller.abort(); };
  }, [eligible, key, transcript, model, hasConversation, personalize, gardenSlug]);

  const text = eligible && result?.key === key ? result.text : null;
  const dismiss = () => setDismissedKey(key);
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!text || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (event.key !== 'Tab' && event.key !== 'Escape') return false;
    event.preventDefault();
    dismiss();
    if (event.key === 'Tab') onChange(text);
    return true;
  }
  return { text, descriptionId, dismiss, handleKeyDown };
}

'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PromptSuggestionMessage } from '@/lib/chat-prompt-suggestion';
import { canCompleteSentence, normalizeSentenceCompletion, sentenceCompletionContext } from '@/lib/sentence-completion';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';

const NO_MESSAGES: readonly PromptSuggestionMessage[] = [];

export function useSentenceCompletion({ messages = NO_MESSAGES, conversationKey, value, enabled, onChange }: {
  messages?: readonly PromptSuggestionMessage[];
  conversationKey: string;
  value: string;
  enabled: boolean;
  onChange: (value: string) => void;
}) {
  const descriptionId = useId();
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [cursor, setCursor] = useState({ value: '', atEnd: false });
  const [revision, setRevision] = useState(0);
  const context = useMemo(() => sentenceCompletionContext(messages), [messages]);
  const transcript = JSON.stringify(context);
  const scope = JSON.stringify([conversationKey, transcript, revision]);
  const key = JSON.stringify([scope, value]);
  const [result, setResult] = useState<{ scope: string; draft: string; text: string } | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const eligible = enabled && focused && !composing && cursor.value === value && cursor.atEnd &&
    canCompleteSentence(value) && key !== dismissedKey;
  // Matching keystrokes consume the visible suffix without another model call.
  const text = eligible && result?.scope === scope && value.startsWith(result.draft) &&
    (result.draft + result.text).startsWith(value)
    ? (result.draft + result.text).slice(value.length) || null : null;

  useEffect(() => {
    const changed = () => {
      pending.current?.abort();
      setResult(null);
      setRevision(current => current + 1);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, changed);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, changed);
  }, []);

  useEffect(() => {
    if (!eligible || text) return;
    const controller = new AbortController();
    pending.current = controller;
    let timeout: number | undefined;
    const timer = window.setTimeout(async () => {
      timeout = window.setTimeout(() => controller.abort(), 8_500);
      try {
        const response = await fetch('/api/sentence-completion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft: value, messages: JSON.parse(transcript) }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json();
        const completion = normalizeSentenceCompletion(payload.completion, value);
        if (!controller.signal.aborted && completion) setResult({ scope, draft: value, text: completion });
      } catch {
        // Leave typing, sending and ordinary keyboard navigation available.
      } finally {
        window.clearTimeout(timeout);
      }
    }, 500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
      controller.abort();
      if (pending.current === controller) pending.current = null;
    };
  }, [eligible, key, scope, transcript, value, text]);

  function trackCursor(input: HTMLTextAreaElement) {
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    setCursor(current => current.value === input.value && current.atEnd === atEnd ? current : { value: input.value, atEnd });
    if (!atEnd) {
      pending.current?.abort();
      setResult(null);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (event.key !== 'Tab' && event.key !== 'Escape') return false;
    const input = event.currentTarget;
    if (!eligible || input.value !== value || input.selectionStart !== value.length || input.selectionEnd !== value.length) return false;
    if (event.key === 'Escape') {
      pending.current?.abort();
      setDismissedKey(key);
      setResult(null);
    }
    if (!text) return false;
    event.preventDefault();
    if (event.key === 'Tab') {
      const completed = value + text;
      setDismissedKey(JSON.stringify([scope, completed]));
      setResult(null);
      onChange(completed);
      window.requestAnimationFrame(() => {
        if (document.activeElement === input && input.value === completed) input.setSelectionRange(completed.length, completed.length);
      });
    }
    return true;
  }

  return {
    text, descriptionId, handleKeyDown,
    onInput(input: HTMLTextAreaElement) { pending.current?.abort(); trackCursor(input); },
    onSelect: trackCursor,
    onFocus(input: HTMLTextAreaElement) { setFocused(true); trackCursor(input); },
    onBlur() { pending.current?.abort(); setFocused(false); setResult(null); },
    onCompositionStart() { pending.current?.abort(); setComposing(true); setResult(null); },
    onCompositionEnd(input: HTMLTextAreaElement) { setComposing(false); trackCursor(input); },
  };
}

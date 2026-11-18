"use client";

import { useEffect, useEffectEvent, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

export interface TerminalSuggestion {
  text: string;
  conversationId?: string;
}

export function useTerminalSuggestion({
  sessionId, loading, openSession, setInput, textarea, suggestion, onSuggestionHandled,
}: {
  sessionId: string | null;
  loading: boolean;
  openSession: (id: string) => void;
  setInput: Dispatch<SetStateAction<string>>;
  textarea: RefObject<HTMLTextAreaElement | null>;
  suggestion?: TerminalSuggestion | null;
  onSuggestionHandled?: (card: TerminalSuggestion) => void;
}) {
  const [pending, setPending] = useState<TerminalSuggestion | null>(null);

  function select(text: string, conversationId?: string) {
    if (conversationId && conversationId !== sessionId) openSession(conversationId);
    setPending({ text, conversationId });
  }

  const lastExternal = useRef<TerminalSuggestion | null>(null);
  const selectExternal = useEffectEvent((card: TerminalSuggestion) => {
    select(card.text, card.conversationId);
    onSuggestionHandled?.(card);
  });
  useEffect(() => {
    if (suggestion === lastExternal.current) return;
    lastExternal.current = suggestion ?? null;
    if (suggestion) selectExternal(suggestion);
  }, [suggestion]);

  // The history switch restores the destination's own draft. Paste once that
  // switch commits, and discard the selection if the reader moved on.
  useEffect(() => {
    if (!pending) return;
    if (pending.conversationId && pending.conversationId !== sessionId) {
      setPending(null);
      return;
    }
    if (loading) return;
    const { text, conversationId } = pending;
    setPending(null);
    setInput(draft => {
      if (!conversationId || !draft.trim()) return text;
      if (draft === text || draft.endsWith("\n\n" + text)) return draft;
      return draft + "\n\n" + text;
    });
    window.requestAnimationFrame(() => {
      const composer = textarea.current;
      if (!composer) return;
      composer.focus();
      composer.setSelectionRange(composer.value.length, composer.value.length);
    });
  }, [pending, sessionId, loading, setInput, textarea]);

  return select;
}

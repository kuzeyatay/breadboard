'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { normalizePromptSuggestion, promptSuggestionContext, promptSuggestionSelection, type PromptSuggestionMessage, type PromptSuggestionSelection } from '@/lib/chat-prompt-suggestion';
import { AUTH_CHANGED_EVENT } from '@/lib/auth-events';
import { RECALL_SETTINGS_CHANGED_EVENT } from './recall-autostart-lifecycle';
import { RECOMMENDATION_REFRESH_EVENT } from '@/lib/recommendations/types';
import { suggestionPageBody, type SuggestionPage } from '@/lib/browser-terminal';

const NO_MESSAGES: readonly PromptSuggestionMessage[] = [];

export function handlePromptSuggestionKey(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, text: string | null, accept: (text: string) => void, dismiss: () => void) {
  if (!text || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (event.key !== 'Tab' && event.key !== 'Escape') return false;
  event.preventDefault();
  dismiss();
  if (event.key === 'Tab') accept(text);
  return true;
}

export function usePromptSuggestion({ messages = NO_MESSAGES, selection, conversationKey, model, value, enabled, onChange, personalize = false, gardenSlug, pageTitle, page, conversationId, documentConversationId, temporary = false }: {
  /** The page beside the chat: an empty composer suggests a question about it. */
  page?: SuggestionPage | null;
  messages?: readonly PromptSuggestionMessage[];
  selection?: PromptSuggestionSelection | null;
  conversationKey: string;
  model: string;
  value: string;
  enabled: boolean;
  onChange: (value: string) => void;
  personalize?: boolean;
  gardenSlug?: string | null;
  pageTitle?: string | null;
  conversationId?: string | null;
  documentConversationId?: string;
  temporary?: boolean;
}) {
  const descriptionId = useId();
  const [revision, setRevision] = useState(0);
  const context = useMemo(() => promptSuggestionContext(messages), [messages]);
  // Content, not array identity, owns a request. Streaming and unrelated
  // parent renders must not start a series of background completions.
  const transcript = JSON.stringify(context);
  const excerpt = JSON.stringify(promptSuggestionSelection(selection));
  const hasSelection = excerpt !== 'null';
  const pageKey = page ? JSON.stringify([page.title, page.browser, page.text?.length]) : null;
  const key = JSON.stringify([conversationKey, documentConversationId, model, messages.at(-1)?.clientMessageId, transcript, excerpt, personalize, gardenSlug, pageTitle, pageKey, temporary, revision]);
  const [result, setResult] = useState<{ key: string; text: string; reason: string } | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    const changed = () => { setResult(null); attempted.current.clear(); setRevision(value => value + 1); };
    for (const event of [AUTH_CHANGED_EVENT, RECALL_SETTINGS_CHANGED_EVENT, RECOMMENDATION_REFRESH_EVENT]) window.addEventListener(event, changed);
    return () => { for (const event of [AUTH_CHANGED_EVENT, RECALL_SETTINGS_CHANGED_EVENT, RECOMMENDATION_REFRESH_EVENT]) window.removeEventListener(event, changed); };
  }, []);
  const hasContext = hasSelection || context.length > 0;
  const eligible = enabled && value === '' && (hasContext || ((personalize || pageKey) && messages.length === 0)) && Boolean(model) && model !== 'none' && key !== dismissedKey;

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
        const pageBody = hasSelection ? {} : await suggestionPageBody(page);
        // An empty chat beside a page opens with a question about that page.
        const pageOpener = !hasContext && Object.keys(pageBody).length > 0;
        const response = await fetch(hasContext ? '/api/chat-prompt-suggestion' : pageOpener ? '/api/pdf-suggestions' : '/api/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: JSON.parse(transcript), ...(hasSelection ? { selection: JSON.parse(excerpt),conversationId } : {}), model, personalize, gardenSlug, pageTitle, documentConversationId, temporary, localDate, localTime, timeZone, ...pageBody }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json();
        const card = payload.recommendations?.[0];
        const text = normalizePromptSuggestion(hasContext ? payload.suggestion : pageOpener ? payload.suggestions?.[0] : card?.prompt);
        if (controller.signal.aborted || !text) return;
        let reason = 'This follows up on the recent messages in this chat.';
        if (hasSelection) reason = 'This question is based on the passage you highlighted.';
        else if (pageOpener) reason = `This question is based on the page you have open${page?.title ? ` (“${page.title}”)` : ''}.`;
        else if (!hasContext) reason = card?.sourceLabel
          ? `This prompt draws on your activity in ${card.sourceLabel}.`
          : 'This prompt comes from your personalized recommendations.';
        setResult({ key, text, reason });
      } catch {
        // Suggestions are optional; leave the ordinary composer available.
      } finally {
        window.clearTimeout(requestTimeout);
      }
    }, 700);
    return () => { window.clearTimeout(timer); window.clearTimeout(requestTimeout); controller.abort(); };
  }, [eligible, key, transcript, excerpt, model, hasContext, hasSelection, personalize, gardenSlug, pageTitle, page, conversationId, documentConversationId, temporary]);

  const text = eligible && result?.key === key ? result.text : null;
  const dismiss = () => setDismissedKey(key);
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    return handlePromptSuggestionKey(event, text, onChange, dismiss);
  }
  return { text, reason: result?.reason ?? '', descriptionId, dismiss, handleKeyDown };
}

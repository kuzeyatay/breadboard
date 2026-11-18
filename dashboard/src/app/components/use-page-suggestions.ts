'use client';

import { useEffect, useState } from 'react';
import { suggestionPageBody, type SuggestionPage } from '@/lib/browser-terminal';

/**
 * Up to four questions about the page beside the chat, the web counterpart of
 * the PDF assistant's page cards. Null while there is no page or no answer yet.
 */
export function usePageSuggestions({ page, model, enabled }: {
  page: SuggestionPage | null | undefined;
  model: string | null | undefined;
  enabled: boolean;
}): string[] | null {
  const key = page && model && enabled ? JSON.stringify([page.title, page.browser, page.text?.length, model]) : null;
  const [result, setResult] = useState<{ key: string; items: string[] } | null>(null);
  useEffect(() => {
    if (!key || !page || !model) return;
    const controller = new AbortController();
    // Wait for navigation to settle before reading the page.
    const timer = window.setTimeout(async () => {
      try {
        const body = await suggestionPageBody(page);
        if (!Object.keys(body).length || controller.signal.aborted) return;
        const response = await fetch('/api/pdf-suggestions', {
          method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, ...body }),
        });
        const payload = response.ok ? await response.json() : null;
        if (!controller.signal.aborted && Array.isArray(payload?.suggestions)) {
          setResult({ key, items: payload.suggestions.filter((item: unknown): item is string => typeof item === 'string') });
        }
      } catch {
        // No grounded questions is better than generic ones.
      }
    }, 500);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [key, page, model]);
  return key && result?.key === key ? result.items : null;
}

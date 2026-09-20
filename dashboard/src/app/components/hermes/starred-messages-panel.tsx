"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { starredMessageHref, type StarredMessage } from "@/lib/starred-messages-types";
import { refreshStarredMessages, saveMessageStar, useStarredMessages } from "../use-starred-messages";

export default function StarredMessagesPanel({ gardenSlug, onOpenMessage }: {
  gardenSlug?: string; onOpenMessage: (message: StarredMessage) => void;
}) {
  const { messages, loading, saving, error } = useStarredMessages();
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    void refreshStarredMessages();
    const refresh = () => { void refreshStarredMessages(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const visible = gardenSlug ? messages.filter((message) => message.gardenSlug === gardenSlug) : messages;
  return <section aria-label="Starred messages" className="flex h-full min-h-0 flex-col text-[var(--ink)]">
    <header className="border-b border-[var(--line)] px-5 py-4">
      <h2 className="text-lg font-semibold text-[var(--ink-heading)]">Starred messages</h2>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">Save messages to return to them later.</p>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-busy={loading}>
      {error || saveError ? <div role="alert" className="mb-3 rounded-lg border border-[var(--line)] p-3 text-sm">
        {saveError || error}
        <button type="button" className="ml-2 underline" onClick={() => { setSaveError(null); void refreshStarredMessages(); }}>Retry</button>
      </div> : null}
      {!loading && !error && visible.length === 0 ? <p className="px-2 py-8 text-center text-sm text-[var(--ink-muted)]">No starred messages yet. Use the star below a message to save it here.</p> : null}
      <ul className="space-y-1">
        {visible.map((message) => <li key={message.messageId} className="group flex items-start rounded-xl hover:bg-[var(--paper-strong)]">
          <a href={starredMessageHref(message)} className="min-w-0 flex-1 rounded-xl p-3 focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              if ((message.gardenSlug ?? undefined) !== gardenSlug) return;
              event.preventDefault(); onOpenMessage(message);
            }}>
            <p className="truncate text-sm font-medium text-[var(--ink-heading)]">{message.title || "Untitled chat"}</p>
            <p className="mt-1 line-clamp-3 break-words text-xs leading-5 text-[var(--ink-muted)]">{message.preview || "Message"}</p>
          </a>
          <button type="button" aria-label="Unstar message" title="Unstar message" disabled={saving}
            className="mr-2 mt-3 rounded-md p-1.5 text-[var(--botanical)] hover:bg-[var(--paper-raised)] disabled:opacity-40"
            onClick={async () => {
              setSaveError(null);
              try { await saveMessageStar(message.conversationId, message.messageId, false); }
              catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Could not remove this star."); }
            }}><Star className="h-4 w-4" fill="currentColor" aria-hidden /></button>
        </li>)}
      </ul>
    </div>
  </section>;
}

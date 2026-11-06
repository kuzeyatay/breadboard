"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Star } from "lucide-react";
import { starredMessageHref, starredMessageWorkspace, type StarredMessage } from "@/lib/starred-messages-types";
import { refreshStarredMessages, saveMessageStar, useStarredMessages } from "../use-starred-messages";
import { CONTEXT_MENU_ITEM_CLASS, ContextMenuSurface } from "../link-context-menu";
import StarredMessagePopover from "./starred-message-popover";
import { SideChatContext } from "../side-chat-context";

export default function StarredMessagesPanel({ gardenSlug, onOpenMessage }: {
  gardenSlug?: string; onOpenMessage: (message: StarredMessage) => void;
}) {
  const openSideChat = useContext(SideChatContext);
  const { messages, loading, saving, error } = useStarredMessages();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ message: StarredMessage; anchor: { left: number; bottom: number } } | null>(null);
  const closeMessage = useCallback(() => setOpened(null), []);
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
          <ContextMenuSurface label="Starred message actions" menu={
            <ContextMenu.Item asChild>
              <a href={starredMessageHref(message)} className={CONTEXT_MENU_ITEM_CLASS}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if (message.sideChat && openSideChat && (!gardenSlug || message.gardenSlug === gardenSlug)) {
                    event.preventDefault();
                    closeMessage();
                    openSideChat({ conversationId: message.conversationId, messageId: message.messageId });
                    return;
                  }
                  if (starredMessageWorkspace(message) !== gardenSlug) return;
                  event.preventDefault();
                  closeMessage();
                  onOpenMessage(message);
                }}>Go to chat</a>
            </ContextMenu.Item>
          }>
            <button type="button" aria-haspopup="dialog"
              className="min-w-0 flex-1 rounded-xl p-3 text-left focus-visible:outline-2 focus-visible:outline-[var(--botanical)]"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setOpened({ message, anchor: { left: rect.left, bottom: rect.bottom } });
              }}>
              <p className="truncate text-sm font-medium text-[var(--ink-heading)]">{message.title || "Untitled chat"}</p>
              <p className="mt-1 line-clamp-3 break-words text-xs leading-5 text-[var(--ink-muted)]">{message.preview || "Message"}</p>
            </button>
          </ContextMenuSurface>
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
    {opened ? <StarredMessagePopover key={opened.message.messageId}
      message={opened.message} anchor={opened.anchor} onClose={closeMessage} /> : null}
  </section>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArchiveRestore } from "lucide-react";
import { HERMES_SESSIONS_CHANGED_EVENT, notifyHermesSessionsChanged } from "@/lib/hermes/session-client";
import { formatChatTime } from "./terminal-sidebar";

interface ArchivedChat {
  id: string;
  chatId: string;
  title: string;
  originLabel: string;
  archivedAt: string;
}

export default function ArchivedChatsPanel({ gardenSlug, onOpenChat }: {
  gardenSlug?: string;
  onOpenChat: (chatId: string) => void;
}) {
  const [chats, setChats] = useState<ArchivedChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const mutation = useRef(false);
  const refresh = useCallback(async () => {
    if (mutation.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const query = gardenSlug ? `?${new URLSearchParams({ gardenSlug })}` : "";
      const response = await fetch(`/api/archived-chats${query}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Archived chats could not be loaded.");
      const data = await response.json();
      if (controller.signal.aborted) return;
      setChats(data.chats ?? []);
      setError(null);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Archived chats could not be loaded.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [gardenSlug]);

  useEffect(() => {
    void refresh();
    const onChange = () => { void refresh(); };
    window.addEventListener("focus", onChange);
    window.addEventListener(HERMES_SESSIONS_CHANGED_EVENT, onChange);
    return () => {
      request.current?.abort();
      window.removeEventListener("focus", onChange);
      window.removeEventListener(HERMES_SESSIONS_CHANGED_EVENT, onChange);
    };
  }, [refresh]);

  async function restore(chat: ArchivedChat) {
    if (mutation.current) return;
    mutation.current = true;
    request.current?.abort();
    setLoading(false);
    setRestoring(chat.id);
    setError(null);
    try {
      const response = await fetch(`/api/hermes/sessions/${encodeURIComponent(chat.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      if (!response.ok) throw new Error("This chat could not be restored.");
      setChats((current) => current.filter((item) => item.id !== chat.id));
      notifyHermesSessionsChanged("garden_chat");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This chat could not be restored.");
    } finally {
      mutation.current = false;
      setRestoring(null);
    }
  }

  return <section aria-label="Archived chats" className="flex h-full min-h-0 flex-col text-[var(--ink)]">
    <header className="border-b border-[var(--line)] px-5 py-4">
      <h2 className="text-lg font-semibold text-[var(--ink-heading)]">Archived chats</h2>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">Open an archived chat or restore it to your chat list.</p>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-busy={loading}>
      {error ? <div role="alert" className="mb-3 rounded-lg border border-[var(--line)] p-3 text-sm">
        {error}<button type="button" className="ml-2 underline" onClick={() => void refresh()}>Retry</button>
      </div> : null}
      {!loading && !error && chats.length === 0 ? <p className="px-2 py-8 text-center text-sm text-[var(--ink-muted)]">No archived chats yet. Choose Archive from a chat’s three-dot menu.</p> : null}
      <ul className="space-y-1">
        {chats.map((chat) => <li key={chat.id} className="group flex items-center rounded-xl hover:bg-[var(--paper-strong)]">
          <button type="button" onClick={() => onOpenChat(chat.chatId)} className="min-w-0 flex-1 rounded-xl p-3 text-left focus-visible:outline-2 focus-visible:outline-[var(--botanical)]">
            <p className="truncate text-sm font-medium text-[var(--ink-heading)]">{chat.title || "Untitled chat"}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{chat.originLabel} · {formatChatTime(chat.archivedAt)}</p>
          </button>
          <button type="button" aria-label={`Restore ${chat.title}`} title="Restore chat" disabled={restoring !== null}
            className="mr-2 rounded-md p-2 text-[var(--ink-muted)] hover:bg-[var(--paper-raised)] hover:text-[var(--ink-heading)] disabled:opacity-40"
            onClick={() => void restore(chat)}><ArchiveRestore className="h-4 w-4" strokeWidth={1.7} aria-hidden /></button>
        </li>)}
      </ul>
    </div>
  </section>;
}

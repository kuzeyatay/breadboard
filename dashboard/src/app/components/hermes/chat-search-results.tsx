"use client";

import { ArrowUpRight, MessageSquareText, Pin } from "lucide-react";

import type {
  ChatSearchResource,
  ChatSearchResult,
} from "@/lib/generative-ui/contracts.ts";

function chatHref(resource: ChatSearchResource, chatId: string): string {
  if (resource.data.surface === "garden_chat" && resource.data.gardenSlug) {
    return `/gardens/${encodeURIComponent(resource.data.gardenSlug)}?chat=${encodeURIComponent(chatId)}`;
  }
  return `/dashboard?terminalChat=${encodeURIComponent(chatId)}`;
}

function resultTime(updatedAt: string): string {
  const value = new Date(updatedAt);
  if (!Number.isFinite(value.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(value);
}

function ResultRow({
  resource,
  chat,
  canOpen,
}: {
  resource: ChatSearchResource;
  chat: ChatSearchResult;
  canOpen: boolean;
}) {
  const content = (
    <>
      <MessageSquareText
        className="mt-0.5 size-3.5 shrink-0 text-[var(--ink-muted)] transition-colors group-hover:text-[var(--botanical)]"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--ink-heading)]">
            {chat.title}
          </span>
          {chat.pinned ? (
            <Pin className="size-3 shrink-0 text-[var(--ink-muted)]" aria-label="Pinned" />
          ) : null}
          <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">
            {resultTime(chat.updatedAt)}
          </span>
          {canOpen ? (
            <ArrowUpRight className="size-3.5 shrink-0 text-[var(--ink-muted)] transition-colors group-hover:text-[var(--botanical)]" aria-hidden />
          ) : null}
        </span>
        {chat.snippet ? (
          <span className="mt-0.5 block truncate text-[11px] text-[var(--ink-muted)]">
            {chat.snippet}
          </span>
        ) : null}
      </span>
    </>
  );

  return canOpen ? (
    <a
      href={chatHref(resource, chat.id)}
      className="group flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 transition-colors duration-150 hover:bg-[var(--paper-strong)]"
      aria-label={`Open chat: ${chat.title}`}
    >
      {content}
    </a>
  ) : (
    <div className="flex min-w-0 items-start gap-2 px-2.5 py-2">{content}</div>
  );
}

export default function ChatSearchResults({ resource }: { resource: ChatSearchResource }) {
  const canOpen = resource.actions.includes("open-chat");
  return (
    <section
      className="my-4 overflow-hidden rounded-2xl bg-[var(--paper-raised)] shadow-[0_1px_2px_rgba(41,55,47,0.06),0_0_0_1px_var(--line)]"
      aria-label={resource.title}
      data-generative-ui="chat-search-results"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-3.5 py-2.5">
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold text-[var(--ink-heading)]">
            {resource.title}
          </h3>
          <p className="truncate text-[10px] text-[var(--ink-muted)]">
            {resource.data.query}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--paper-strong)] px-2 py-0.5 text-[10px] text-[var(--ink-muted)]">
          {resource.data.chats.length}
        </span>
      </header>
      <ul className="p-1.5">
        {resource.data.chats.map((chat) => (
          <li key={chat.id}>
            <ResultRow resource={resource} chat={chat} canOpen={canOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

"use client";



import { useEffect, useRef } from "react";

import { X } from "lucide-react";

import { Composer } from "./composer";

import { MessageRow } from "./message-row";

import { useRoom } from "../use-room";

import type { BuzzMessage } from "../types";



export function ThreadPanel({ roomPublicId, rootId, userId, onClose, onChanged }: {

  roomPublicId: string; rootId: number; userId: number;

  onClose: () => void; onChanged: () => void;

}) {

  const thread = useRoom(roomPublicId, userId, rootId);

  const scroller = useRef<HTMLDivElement>(null);

  const pinned = useRef(true);

  const lastCount = useRef(0);

  useEffect(() => {

    if (pinned.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;

    if (thread.messages.length !== lastCount.current) { lastCount.current = thread.messages.length; onChanged(); }

  }, [thread.messages, onChanged]);

  const row = (message: BuzzMessage, grouped = false) => (

    <MessageRow key={message.clientMessageId} message={message}

      member={thread.members.find(member => member.id === message.memberId)} roomMembers={thread.members}

      grouped={grouped} isSelf={message.memberId === thread.selfMemberId}

      canDelete={message.memberId === thread.selfMemberId || thread.detail?.permissions.canManage}

      onReact={emoji => void thread.react(message.id, emoji)} onOpenThread={() => {}}

      onDelete={() => void thread.remove(message.id)} onEdit={body => thread.edit(message.id, body)}

      onRetry={() => void thread.retry(message)}

      runHref={message.metadata?.requestedByMemberId === thread.selfMemberId && typeof message.metadata.conversationPublicId === "string" && message.metadata.externalAgentRun ? `/dashboard?conversation=${encodeURIComponent(message.metadata.conversationPublicId)}` : undefined}
      onApprove={message.metadata?.requestedByMemberId === thread.selfMemberId ? () => void thread.approve(message.id) : undefined}

      onStop={message.metadata?.requestedByMemberId === thread.selfMemberId || thread.detail?.permissions.canManage ? () => void thread.stop(message.id) : undefined}

      onRegenerate={message.authorKind === "agent" && (message.metadata?.requestedByMemberId === thread.selfMemberId || thread.detail?.permissions.canManage) ? () => void thread.regenerate(message.id) : undefined}

    />

  );

  return (

    <aside className="buzz-aux-panel flex w-[360px] shrink-0 flex-col border-l border-border/40" aria-label="Thread">

      <header className="flex h-14 shrink-0 items-center justify-between px-4">

        <h2 className="text-sm font-semibold">Thread</h2>

        <button type="button" onClick={onClose} className="neu-button flex size-8 items-center justify-center rounded-full" aria-label="Close thread"><X className="size-4" /></button>

      </header>

      <div ref={scroller} onScroll={() => { const el = scroller.current; if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }} className="buzz-content-scrollbar min-h-0 flex-1 overflow-y-auto pb-2 pt-5">

        {thread.error ? <p role="alert" className="m-3 text-xs text-destructive">{thread.error} <button onClick={() => void thread.refresh()}>Retry</button></p> : null}

        {thread.detail?.root ? row(thread.detail.root) : null}

        {thread.messages.length ? <p className="px-3 py-3 text-xs text-muted-foreground">{thread.messages.length} {thread.messages.length === 1 ? "reply" : "replies"}</p> : null}

        {thread.messages.map((message, index) => row(message, index > 0 && thread.messages[index - 1].memberId === message.memberId))}

      </div>

      <Composer key={thread.scope} draftKey={thread.scope} members={thread.members} placeholder="Reply in thread…" disabled={!thread.detail?.permissions.canPost} onSend={thread.send} />

    </aside>

  );

}

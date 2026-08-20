"use client";

// A thread, opened beside the room rather than over it.
//
// Threads carry their own poll because they are the one place where a reply
// arrives that the spine will not show: an agent answering inside a thread
// writes into the thread, and the room only learns about it as a reply count.

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import { Composer } from "./composer";
import { MessageRow } from "./message-row";
import { isLive, type BuzzMember, type BuzzMessage } from "../types.ts";

const LIVE_POLL_MS = 900;
const IDLE_POLL_MS = 8000;

export function ThreadPanel({
  roomPublicId,
  rootId,
  members,
  selfMemberId,
  onClose,
  onChanged,
}: {
  roomPublicId: string;
  rootId: number;
  members: BuzzMember[];
  selfMemberId: number | null;
  onClose: () => void;
  /** Lets the room update the reply count under the root message. */
  onChanged: () => void;
}) {
  const [root, setRoot] = useState<BuzzMessage | null>(null);
  const [replies, setReplies] = useState<BuzzMessage[]>([]);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/buzz/rooms/${roomPublicId}/threads/${rootId}`,
      { cache: "no-store" },
    );
    if (!response.ok) return;
    const body = (await response.json()) as { root: BuzzMessage; replies: BuzzMessage[] };
    setRoot(body.root);
    setReplies(body.replies);
  }, [roomPublicId, rootId]);

  // A reply is a message like any other: it reacts, edits and deletes through
  // the same endpoints the spine uses. Passing no-ops here is what made every
  // control inside an open thread inert.
  const patch = async (messageId: number, body: Record<string, unknown>) => {
    await fetch(`/api/buzz/rooms/${roomPublicId}/messages/${messageId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
    onChanged();
  };

  const remove = async (messageId: number) => {
    await fetch(`/api/buzz/rooms/${roomPublicId}/messages/${messageId}`, {
      method: "DELETE",
    });
    await load();
    onChanged();
  };

  // The caller mounts one panel per thread (`key={threadRootId}`), so there is
  // nothing to clear here: a different thread is a different component, with
  // its own empty state and its own poll.
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const busy = replies.some(isLive);
    const tick = async () => {
      if (cancelled) return;
      await load();
      if (!cancelled) timer = setTimeout(tick, busy ? LIVE_POLL_MS : IDLE_POLL_MS);
    };
    timer = setTimeout(tick, busy ? LIVE_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load, replies]);

  const send = async (body: string) => {
    await fetch(`/api/buzz/rooms/${roomPublicId}/threads/${rootId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body,
        clientMessageId: `thread_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      }),
    });
    await load();
    onChanged();
  };

  const memberFor = (message: BuzzMessage) =>
    members.find((member) => member.id === message.memberId);

  return (
    <aside
      className="flex w-[360px] shrink-0 flex-col border-l border-border/40"
      aria-label="Thread"
    >
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <h2 className="text-sm font-semibold">Thread</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close thread"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="buzz-content-scrollbar min-h-0 flex-1 overflow-y-auto pb-2 pt-5">
        {root ? (
          <MessageRow
            message={root}
            member={memberFor(root)}
            roomMembers={members}
            grouped={false}
            isSelf={root.memberId === selfMemberId}
            onReact={(emoji) => void patch(root.id, { emoji })}
            onOpenThread={() => {}}
            onDelete={() => void remove(root.id)}
            onEdit={(body) => void patch(root.id, { body })}
          />
        ) : null}

        {replies.length > 0 ? (
          <p className="px-4 py-2 text-2xs text-muted-foreground">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </p>
        ) : null}

        {replies.map((reply, index) => {
          const previous = replies[index - 1];
          const grouped =
            previous !== undefined &&
            previous.memberId === reply.memberId &&
            previous.authorKind === reply.authorKind;
          return (
            <MessageRow
              key={reply.id}
              message={reply}
              member={memberFor(reply)}
              roomMembers={members}
              grouped={grouped}
              isSelf={reply.memberId === selfMemberId}
              onReact={(emoji) => void patch(reply.id, { emoji })}
              onOpenThread={() => {}}
              onDelete={() => void remove(reply.id)}
              onEdit={(body) => void patch(reply.id, { body })}
            />
          );
        })}
      </div>

      <Composer
        members={members}
        placeholder="Reply in thread…"
        onSend={(body) => void send(body)}
      />
    </aside>
  );
}

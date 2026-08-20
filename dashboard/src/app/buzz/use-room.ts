"use client";

// The data half of a Buzz room: what is in it, and how a message gets in.
//
// Polling rather than a socket, and deliberately so. The room's own writes are
// applied optimistically, so the poll is only ever catching up on other
// people's messages and on agents' answers as they are written. It runs fast
// while something is live and slowly when the room is quiet, which costs a
// request every few seconds for a page that is usually one of many tabs — and
// it needs no connection to survive a laptop sleeping, a server restart, or the
// agent pipeline finishing a turn nobody is watching.

import { useCallback, useEffect, useRef, useState } from "react";

import { isLive, type BuzzMember, type BuzzMessage, type RoomDetail } from "./types.ts";

/** How often to re-read while an agent is mid-answer. */
const LIVE_POLL_MS = 900;
/** How often to re-read an idle room, to pick up other people's messages. */
const IDLE_POLL_MS = 6000;

export interface UseRoomResult {
  detail: RoomDetail | null;
  loading: boolean;
  error: string | null;
  members: BuzzMember[];
  messages: BuzzMessage[];
  selfMemberId: number | null;
  send: (body: string, parentId?: number | null) => Promise<void>;
  refresh: () => Promise<void>;
  react: (messageId: number, emoji: string) => Promise<void>;
  remove: (messageId: number) => Promise<void>;
  edit: (messageId: number, body: string) => Promise<void>;
}

function clientMessageId(): string {
  return `buzz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function useRoom(roomPublicId: string | null): UseRoomResult {
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Identifies the room a response belongs to, so a reply that arrives after
  // the reader has switched rooms is dropped instead of painting the wrong
  // transcript.
  const activeRoom = useRef<string | null>(null);
  activeRoom.current = roomPublicId;

  const load = useCallback(
    async (roomId: string, showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const response = await fetch(`/api/buzz/rooms/${roomId}/messages`, {
          cache: "no-store",
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { message?: string }
            | null;
          throw new Error(body?.message ?? "This room could not be opened.");
        }
        const next = (await response.json()) as RoomDetail;
        if (activeRoom.current !== roomId) return;
        setDetail(next);
        setError(null);
      } catch (cause) {
        if (activeRoom.current !== roomId) return;
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      } finally {
        if (showSpinner && activeRoom.current === roomId) setLoading(false);
      }
    },
    [],
  );

  // Open a room.
  useEffect(() => {
    if (!roomPublicId) {
      setDetail(null);
      return;
    }
    setDetail(null);
    void load(roomPublicId, true);
  }, [roomPublicId, load]);

  // Keep it current. The interval is re-armed after every tick rather than set
  // once, so the cadence can change the moment an answer starts or finishes.
  useEffect(() => {
    if (!roomPublicId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      await load(roomPublicId, false);
      if (cancelled) return;
      const busy = (detail?.messages ?? []).some(isLive);
      timer = setTimeout(tick, busy ? LIVE_POLL_MS : IDLE_POLL_MS);
    };

    const busy = (detail?.messages ?? []).some(isLive);
    timer = setTimeout(tick, busy ? LIVE_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomPublicId, load, detail]);

  const refresh = useCallback(async () => {
    if (roomPublicId) await load(roomPublicId, false);
  }, [roomPublicId, load]);

  const send = useCallback(
    async (body: string, parentId: number | null = null) => {
      const text = body.trim();
      if (!roomPublicId || text === "") return;

      const id = clientMessageId();
      const optimistic: BuzzMessage = {
        id: -Date.now(),
        roomId: -1,
        clientMessageId: id,
        memberId: detail?.selfMemberId ?? null,
        authorKind: "human",
        authorName: "you",
        authorHandle: "",
        personaSlug: null,
        body: text,
        parentId,
        // `pending` would start the fast poll for a message that is not
        // waiting on anything.
        status: "complete",
        runId: null,
        metadata: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // Only the spine is painted optimistically; a thread reply is drawn by
      // the thread panel from its own fetch.
      if (parentId === null) {
        setDetail((current) =>
          current ? { ...current, messages: [...current.messages, optimistic] } : current,
        );
      }

      try {
        const endpoint =
          parentId === null
            ? `/api/buzz/rooms/${roomPublicId}/messages`
            : `/api/buzz/rooms/${roomPublicId}/threads/${parentId}`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: text, clientMessageId: id, parentId }),
        });
        if (!response.ok) {
          const failed = (await response.json().catch(() => null)) as
            | { message?: string }
            | null;
          throw new Error(failed?.message ?? "That message could not be sent.");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That message could not be sent.");
      } finally {
        // Reconciles the optimistic row against what the server stored, and
        // picks up any agent placeholder the send created.
        await refresh();
      }
    },
    [roomPublicId, detail?.selfMemberId, refresh],
  );

  const react = useCallback(
    async (messageId: number, emoji: string) => {
      if (!roomPublicId) return;
      await fetch(`/api/buzz/rooms/${roomPublicId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      await refresh();
    },
    [roomPublicId, refresh],
  );

  const remove = useCallback(
    async (messageId: number) => {
      if (!roomPublicId) return;
      await fetch(`/api/buzz/rooms/${roomPublicId}/messages/${messageId}`, {
        method: "DELETE",
      });
      await refresh();
    },
    [roomPublicId, refresh],
  );

  const edit = useCallback(
    async (messageId: number, body: string) => {
      if (!roomPublicId) return;
      await fetch(`/api/buzz/rooms/${roomPublicId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      await refresh();
    },
    [roomPublicId, refresh],
  );

  return {
    detail,
    loading,
    error,
    members: detail?.members ?? [],
    messages: detail?.messages ?? [],
    selfMemberId: detail?.selfMemberId ?? null,
    send,
    refresh,
    react,
    remove,
    edit,
  };
}

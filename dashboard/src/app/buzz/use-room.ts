"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeMessages, readStored, requestJson, transcriptKey, writeStored } from "./lib/message-state";
import { isLive, type BuzzMessage, type RoomDetail } from "./types.ts";

type Detail = RoomDetail & { root?: BuzzMessage };

/** Room and thread share durable delivery, so a failed send behaves identically. */
export function useRoom(roomPublicId: string | null, userId = 0, parentId: number | null = null) {
  const scope = transcriptKey(userId, roomPublicId ?? "", parentId);
  const endpoint = roomPublicId ? `/api/buzz/rooms/${roomPublicId}/${parentId === null ? "messages" : `threads/${parentId}`}` : null;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [state, setState] = useState<{ scope: string; detail: Detail | null }>({ scope, detail: null });
  const [outgoing, setOutgoing] = useState<{ scope: string; messages: BuzzMessage[] }>({ scope, messages: [] });
  const outbox = useRef(outgoing);
  const inFlight = useRef(new Set<string>());
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const detail = state.scope === scope ? state.detail : null;

  const saveOutbox = useCallback((update: (messages: BuzzMessage[]) => BuzzMessage[]) => {
    const previous = outbox.current.scope === scope ? outbox.current.messages : readStored<BuzzMessage[]>(`${scope}:outbox`, []);
    const next = { scope, messages: update(previous) };
    writeStored(`${scope}:outbox`, next.messages);
    if (currentScope.current === scope) { outbox.current = next; setOutgoing(next); }
  }, [scope]);

  const load = useCallback(async (signal?: AbortSignal): Promise<Detail | null> => {
    if (!endpoint) return null;
    const sequence = ++requestSequence.current;
    try {
      const next = await requestJson<Detail>(endpoint, { signal });
      if (currentScope.current !== scope || signal?.aborted || sequence !== requestSequence.current) return null;
      setState(previous => ({ scope, detail: previous.scope === scope && previous.detail ? {
        ...next, messages: mergeMessages(previous.detail.messages, next.messages),
        hasOlder: previous.detail.hasOlder, nextCursor: previous.detail.nextCursor,
      } : next }));
      const acknowledged = new Set(next.messages.map(message => message.clientMessageId));
      saveOutbox(messages => messages.filter(message => !acknowledged.has(message.clientMessageId)));
      setLoadError(null);
      return next;
    } catch (error) {
      if (currentScope.current === scope && !signal?.aborted) setLoadError(error instanceof Error ? error.message : "Unable to open this room.");
      return null;
    } finally { if (currentScope.current === scope && !signal?.aborted) setLoading(false); }
  }, [endpoint, saveOutbox, scope]);

  useEffect(() => {
    setLoadError(null); setActionError(null); setLoadingOlder(false); setLoading(!!endpoint);
    // Read storage even on the first mount, when the in-memory outbox is empty.
    const restored = readStored<BuzzMessage[]>(`${scope}:outbox`, []);
    outbox.current = { scope, messages: Array.isArray(restored) ? restored : [] };
    saveOutbox(messages => messages.map(message => ({ ...message, delivery: "failed", deliveryError: "Delivery was interrupted. Retry to confirm this message." })));
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [scope, endpoint, load, saveOutbox]);

  const live = detail?.messages.some(isLive) ?? false;
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") await load(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(tick, live ? 900 : 6000);
    };
    const resume = () => { if (document.visibilityState === "visible") void load(controller.signal); };
    timer = setTimeout(tick, live ? 900 : 6000);
    document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [endpoint, live, load]);

  const deliver = useCallback(async (message: BuzzMessage) => {
    if (!endpoint || inFlight.current.has(message.clientMessageId)) return;
    inFlight.current.add(message.clientMessageId);
    saveOutbox(messages => messages.map(row => row.clientMessageId === message.clientMessageId ? { ...row, delivery: "sending", deliveryError: undefined } : row));
    try {
      const result = await requestJson<{ message: BuzzMessage }>(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: message.body, clientMessageId: message.clientMessageId }),
      });
      saveOutbox(messages => messages.filter(row => row.clientMessageId !== message.clientMessageId));
      if (currentScope.current === scope) {
        setState(previous => previous.scope === scope && previous.detail ? { scope, detail: { ...previous.detail, messages: mergeMessages(previous.detail.messages, [result.message]) } } : previous);
        setActionError(null); await load();
      }
    } catch (error) {
      saveOutbox(messages => messages.map(row => row.clientMessageId === message.clientMessageId ? { ...row, delivery: "failed", deliveryError: error instanceof TypeError ? "Not sent. Check your connection and retry." : error instanceof Error ? error.message : "Message not sent. Retry when connected." } : row));
    } finally { inFlight.current.delete(message.clientMessageId); }
  }, [endpoint, load, saveOutbox, scope]);

  const send = useCallback((body: string) => {
    if (!endpoint || !detail || !body.trim() || detail.permissions?.canPost === false) return false;
    const self = detail?.members.find(member => member.id === detail.selfMemberId);
    const message: BuzzMessage = {
      id: -Date.now(), roomId: -1, clientMessageId: `buzz_${crypto.randomUUID()}`,
      memberId: detail?.selfMemberId ?? null, authorKind: "human", authorName: self?.displayName ?? "you",
      authorHandle: self?.handle ?? "", personaSlug: null, body: body.trim(), parentId,
      status: "complete", runId: null, metadata: null, editedAt: null, deletedAt: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), delivery: "sending",
    };
    saveOutbox(messages => [...messages, message]);
    void deliver(message);
    return true;
  }, [detail, deliver, endpoint, parentId, saveOutbox]);

  const mutate = useCallback(async (messageId: number, method: string, body?: unknown) => {
    if (!roomPublicId) return false;
    try {
      const result = await requestJson<{ message?: BuzzMessage }>(`/api/buzz/rooms/${roomPublicId}/messages/${messageId}`, {
        method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (currentScope.current === scope) {
        if (result.message) setState(previous => previous.detail ? { scope, detail: {
          ...previous.detail, ...(parentId !== null && result.message!.id === parentId ? { root: result.message } : { messages: mergeMessages(previous.detail.messages, [result.message!]) }),
        } } : previous);
        setActionError(null); await load();
      }
      return true;
    } catch (error) {
      if (currentScope.current === scope) setActionError(error instanceof Error ? error.message : "That change could not be saved.");
      return false;
    }
  }, [load, parentId, roomPublicId, scope]);

  const loadOlder = async () => {
    if (!endpoint || !detail?.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const next = await requestJson<Detail>(`${endpoint}?before=${detail.nextCursor}`);
      if (currentScope.current === scope) setState(previous => previous.detail ? { scope, detail: { ...previous.detail, messages: mergeMessages(previous.detail.messages, next.messages), hasOlder: next.hasOlder, nextCursor: next.nextCursor } } : previous);
    } catch (error) {
      if (currentScope.current === scope) setActionError(error instanceof Error ? error.message : "Older messages could not be loaded.");
    } finally { if (currentScope.current === scope) setLoadingOlder(false); }
  };

  return {
    detail, loading, error: actionError ?? loadError, scope, loadingOlder, loadOlder,
    members: detail?.members ?? [], selfMemberId: detail?.selfMemberId ?? null,
    messages: [...(detail?.messages ?? []), ...(outgoing.scope === scope ? outgoing.messages : [])],
    send, refresh: async () => { await load(); }, retry: deliver,
    react: (id: number, emoji: string) => mutate(id, "PATCH", { emoji }),
    remove: (id: number) => mutate(id, "DELETE"), edit: (id: number, body: string) => mutate(id, "PATCH", { body }),
    regenerate: (id: number) => mutate(id, "POST", { action: "regenerate" }),
    approve: (id: number) => mutate(id, "POST", { action: "approve" }),
    stop: (id: number) => mutate(id, "POST", { action: "stop" }),
    markRead: async (readThrough: number) => {
      if (!roomPublicId) return false;
      try {
        await requestJson(`/api/buzz/rooms/${roomPublicId}/messages`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ readThrough }),
        });
        return true;
      } catch { return false; }
    },
  };
}

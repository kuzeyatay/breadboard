"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  activeChatNotificationTargets,
  chatNotificationTargetKey,
  isChatNotificationTarget,
  isChatNotificationTargetViewed,
  type ChatNotificationTarget,
} from "../chat-notification-inbox";
import { subscribeNotificationViews } from "../notification-view-presence";
import type { UnreadChatRecord } from "./unread";

const CHANGE_KEY = "breadboard:chat-read-changed:v1";
const EMPTY: readonly UnreadChatRecord[] = [];
let records: readonly UnreadChatRecord[] = EMPTY;
let snapshot = EMPTY;
let revision = 0;
let polling = false;
let pollAgain = false;
let stop: (() => void) | undefined;
const hidden = new Set<string>();
const marking = new Set<string>();
const listeners = new Set<() => void>();

function publish(): void {
  const next = records.filter(record => !hidden.has(record.id) && !isChatNotificationTargetViewed(record.target));
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

async function persist(body: { read?: string[]; seen?: ChatNotificationTarget }): Promise<void> {
  try {
    const response = await fetch("/api/chat-notifications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), keepalive: true,
    });
    if (!response.ok) throw new Error("Reading state was not saved");
    // A GET already in flight may still contain the answers just read.
    revision++;
    try { window.localStorage.setItem(CHANGE_KEY, `${Date.now()}:${Math.random()}`); } catch { /* polling still synchronizes */ }
  } catch {
    // Keep the dot truthful if the write fails; a visible response is retried
    // on the next poll, and leaving the chat must not hide it permanently.
    for (const id of body.read ?? []) hidden.delete(id);
  }
}

function readViewed(): void {
  const ids = records.filter(record => !hidden.has(record.id) && !marking.has(record.id) && isChatNotificationTargetViewed(record.target))
    .map(record => record.id);
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    for (const id of batch) { hidden.add(id); marking.add(id); }
    void persist({ read: batch }).finally(() => {
      for (const id of batch) marking.delete(id);
    });
  }
  publish();
}

async function poll(): Promise<void> {
  if (polling) { pollAgain = true; return; }
  polling = true;
  const startedAt = revision;
  try {
    const response = await fetch("/api/chat-notifications?unread=1", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { unread?: unknown };
    if (startedAt !== revision) { pollAgain = true; return; }
    if (!Array.isArray(data.unread)) return;
    records = data.unread.filter((record): record is UnreadChatRecord =>
      Boolean(record) && typeof record.id === "string" && isChatNotificationTarget(record.target));
    const returned = new Set(records.map(record => record.id));
    for (const id of hidden) if (!returned.has(id) && !marking.has(id)) hidden.delete(id);
    readViewed();
  } catch { /* Preserve the last confirmed inbox until the next refresh. */ }
  finally {
    polling = false;
    if (pollAgain && listeners.size) { pollAgain = false; void poll(); }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stop) {
    let viewedKeys = new Set<string>();
    const onView = () => {
      const targets = activeChatNotificationTargets();
      const nextKeys = new Set(targets.map(chatNotificationTargetKey));
      const opened = targets.filter(target => !viewedKeys.has(chatNotificationTargetKey(target)));
      if (opened.length || [...viewedKeys].some(key => !nextKeys.has(key))) {
        viewedKeys = nextKeys;
        // Also acknowledge answers absent from an old/unloaded rail snapshot.
        revision++;
        for (const target of opened) void persist({ seen: target }).then(() => { if (listeners.size) void poll(); });
      }
      readViewed();
    };
    const unsubscribeViews = subscribeNotificationViews(onView);
    const refresh = () => { if (document.visibilityState === "visible") void poll(); };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CHANGE_KEY && event.key !== null) return;
      revision++;
      void poll();
    };
    const timer = window.setInterval(refresh, 3_000);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    stop = () => {
      unsubscribeViews();
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      stop = undefined;
      records = snapshot = EMPTY;
      hidden.clear();
      revision++;
    };
    onView();
    void poll();
  }
  return () => { listeners.delete(listener); if (!listeners.size) stop?.(); };
}

function chatId(record: UnreadChatRecord, gardenSlug?: string): string | null {
  const target = record.target;
  if (gardenSlug) return target.surface === "garden_chat" && target.gardenSlug === gardenSlug ? target.chatId : null;
  return target.surface === "dashboard_terminal" ? target.chatId : target.conversationId ?? null;
}

/** All lists read one account inbox; Garden legacy ids are aliases of hub ids. */
export function useUnreadChats(gardenSlug?: string) {
  const unread = useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
  const unreadChats = useMemo(() => new Set(unread.map(record => chatId(record, gardenSlug)).filter((id): id is string => id !== null)), [unread, gardenSlug]);
  const forgetUnreadChats = useCallback((ids: Iterable<string>) => {
    const deleted = new Set(ids);
    for (const record of records) if (deleted.has(chatId(record, gardenSlug) ?? "")) hidden.add(record.id);
    publish();
  }, [gardenSlug]);
  return { unreadChats, forgetUnreadChats };
}

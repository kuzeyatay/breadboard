"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { StarredMessage } from "@/lib/starred-messages-types";

const empty = { messages: [] as StarredMessage[], loading: true, saving: false, error: null as string | null };
let state = empty;
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
let revision = 0;
function publish(next: typeof state) {
  state = next;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;
const serverSnapshot = () => empty;

async function readMessages(response: Response): Promise<StarredMessage[]> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || body.error || "Starred messages could not be saved.");
  return body.messages;
}

export function refreshStarredMessages(): Promise<void> {
  if (loading) return loading;
  const version = revision;
  loading = fetch("/api/starred-messages", { cache: "no-store" }).then(readMessages).then((messages) => {
    if (version === revision) publish({ ...state, messages, loading: false, error: null });
  }).catch((error: Error) => {
    if (version === revision) publish({ ...state, loading: false, error: error.message });
  }).finally(() => { loading = null; });
  return loading;
}

export async function saveMessageStar(conversationId: string, messageId: string, starred: boolean) {
  if (state.saving) return;
  revision += 1;
  publish({ ...state, saving: true });
  try {
    const messages = await readMessages(await fetch("/api/starred-messages", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, messageId, starred }),
    }));
    revision += 1;
    publish({ messages, loading: false, saving: false, error: null });
  } catch (error) {
    publish({ ...state, saving: false });
    throw error;
  }
}

export function useStarredMessages() {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    if (state.loading) void refreshStarredMessages();
  }, []);
  return current;
}

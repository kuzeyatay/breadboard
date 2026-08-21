"use client";

// Keeps the composer's unsent text alive across a reload, per chat.
//
// The composer is a controlled input whose value lives in its surface's React
// state, so a refresh — a hot reload, a crashed tab, a mis-hit Ctrl+R halfway
// through a long question — used to erase it. This hook mirrors that state into
// localStorage (see lib/conversations/drafts) and puts it back when the same
// chat is opened again.
//
// It deliberately does not own the state. Every surface already has its own
// `input`/`setInput` pair wired through dozens of call sites; this hook only
// watches that pair, so adding the promise to a surface is one call rather than
// a refactor of its composer.

import { useEffect, useRef } from "react";
import {
  chatDraftKey,
  clearChatDraft,
  draftPersistStep,
  readChatDraft,
  resolveDraftRestore,
  writeChatDraft,
} from "@/lib/conversations/drafts";

export interface UseChatDraftOptions {
  /** The composer this draft belongs to — "dashboard_terminal", "garden_chat". */
  surface: string;
  /** The open chat, or null for one that has not been created yet. */
  sessionId: string | null;
  /**
   * The chat this surface created out of its own unstarted chat, when it has
   * one — the id minted by sending the first message from a blank composer,
   * dropped again as soon as another chat is opened. It is the only thing that
   * distinguishes that move from the two other ways an id turns up under a
   * composer that was blank: the reload restore reopening the newest chat, and
   * the reader picking an existing chat out of the rail. Left unset, text typed
   * into an unstarted chat is never carried anywhere — it stays filed under the
   * unstarted chat it was written in.
   */
  createdSessionId?: string | null;
  /** What is in the box right now. */
  value: string;
  /** Called with the text to put back, when a chat with a draft is opened. */
  onRestore: (text: string) => void;
  /**
   * False for chats that are not to be written down at all — a temporary chat
   * keeps no record, and a draft in localStorage would be exactly that record.
   * Turning it off also removes anything already kept for that chat.
   */
  enabled?: boolean;
}

export function useChatDraft({
  surface,
  sessionId,
  createdSessionId = null,
  value,
  onRestore,
  enabled = true,
}: UseChatDraftOptions): void {
  const key = chatDraftKey(surface, sessionId);
  // Read inside the restore effect without making it re-run on every keystroke.
  // Declared before that effect so it is already this commit's value when the
  // restore runs — effects fire in the order they are written.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const restored = useRef<{ key: string; enabled: boolean } | null>(null);
  // A restore is asked for, but the surface's state has not caught up yet. Until
  // it does, the commits still carrying the outgoing text must not be written to
  // the incoming chat's key — that would overwrite the very draft being put back.
  const pending = useRef<{ text: string; before: string } | null>(null);

  useEffect(() => {
    if (restored.current?.key === key && restored.current.enabled === enabled) return;
    const previousKey = restored.current?.key ?? null;
    restored.current = { key, enabled };

    if (!enabled) {
      clearChatDraft(window.localStorage, key);
      return;
    }

    const newChatKey = chatDraftKey(surface, null);
    const { next, carried } = resolveDraftRestore({
      stored: readChatDraft(window.localStorage, key),
      value: valueRef.current,
      previousKey,
      newChatKey,
      sessionId,
      createdSessionId,
    });
    // The text moved to the chat that was just created, so the unstarted-chat
    // bucket it came from is no longer holding it.
    if (carried) clearChatDraft(window.localStorage, newChatKey);
    if (next === valueRef.current) return;
    pending.current = { text: next, before: valueRef.current };
    onRestore(next);
    // `createdSessionId` is deliberately not a dependency. It is read for the
    // commit that changes the key — the surface sets it alongside the id, so
    // React has both in one commit — and re-running on a later change would
    // find the restore for this key already done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, onRestore, sessionId, surface]);

  useEffect(() => {
    if (!enabled) return;
    // The restore for this key runs first, in the effect above; anything else
    // means this commit belongs to a chat that is on its way out.
    if (restored.current?.key !== key) return;
    const step = draftPersistStep({ value, pending: pending.current });
    pending.current = step.pending;
    if (step.write) writeChatDraft(window.localStorage, key, value);
  }, [enabled, key, value]);
}

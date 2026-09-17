"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { syncDocumentAssistantHistoryClient } from "@/lib/document-assistant-history-client";
import type { DocumentAssistantChatEntry, DocumentAssistantKind } from "@/lib/document-assistant-history-types";
import { useUnreadChats } from "@/lib/conversations/unread-client";
import { registerChatNotificationTarget } from "@/lib/chat-notification-inbox";

/** Sync only settled snapshots back into the editor; never replace a turn in progress. */
export function useDocumentAssistantHistory({ artifactId, kind, chat, setChat, busy, hydrated = true, viewing = true }: {
  artifactId: string;
  kind: DocumentAssistantKind;
  chat: DocumentAssistantChatEntry[];
  setChat: Dispatch<SetStateAction<DocumentAssistantChatEntry[]>>;
  busy: boolean;
  hydrated?: boolean;
  viewing?: boolean;
}) {
  const [error, setError] = useState("");
  const [identity, setIdentity] = useState<{ artifactId: string; conversationId: string | null } | null>(null);
  const conversationId = identity?.artifactId === artifactId ? identity.conversationId : null;
  const { unreadChats } = useUnreadChats();
  useEffect(() => {
    if (!viewing || !hydrated || !conversationId) return;
    return registerChatNotificationTarget({ surface: "dashboard_terminal", chatId: conversationId });
  }, [conversationId, hydrated, viewing]);
  const latest = useRef({ chat, busy });
  latest.current = { chat, busy };
  const refreshRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!hydrated || !artifactId) return;
    let cancelled = false;
    let running = false;
    let queued = false;
    const refresh = async () => {
      if (running) { queued = true; return; }
      running = true;
      const snapshot = latest.current.chat;
      try {
        const history = await syncDocumentAssistantHistoryClient(artifactId, kind, snapshot);
        if (cancelled) return;
        setIdentity(current => current?.artifactId === artifactId && current.conversationId === history.conversationId
          ? current : { artifactId, conversationId: history.conversationId });
        setError("");
        if (!latest.current.busy && latest.current.chat === snapshot) {
          if (JSON.stringify(history.entries) !== JSON.stringify(snapshot)) setChat(history.entries);
        } else {
          // An edit can finish while its earlier snapshot is being saved.
          // Carry the saved revision forward without replacing the new text.
          const revisions = new Map(history.entries.map(entry => [entry.id, entry.revision]));
          setChat(current => {
            let changed = false;
            const next = current.map(entry => {
              const revision = revisions.get(entry.id);
              if (entry.revision || !revision) return entry;
              changed = true;
              return { ...entry, revision };
            });
            return changed ? next : current;
          });
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "This chat could not be saved to Terminal history. It will retry automatically.");
      } finally {
        running = false;
        if (queued && !cancelled) { queued = false; void refresh(); }
      }
    };
    const trigger = () => void refresh();
    refreshRef.current = trigger;
    const timer = window.setInterval(trigger, 10_000);
    trigger();
    return () => { cancelled = true; window.clearInterval(timer); refreshRef.current = null; };
  }, [artifactId, kind, hydrated, setChat]);
  useEffect(() => { refreshRef.current?.(); }, [chat, busy]);
  return { error, unread: conversationId !== null && unreadChats.has(conversationId) };
}

"use client";

import { parseDocumentAssistantEntries, type DocumentAssistantChatEntry, type DocumentAssistantHistory, type DocumentAssistantKind } from "./document-assistant-history-types.ts";

export const DOCUMENT_ASSISTANT_HISTORY_EVENT = "breadboard:document-assistant-history";
const storagePrefixes = { word: "breadboard.genoffice.ai.chat.", markdown: "breadboard.markdown.ai.chat." } as const;

export async function syncDocumentAssistantHistoryClient(
  artifactId: string,
  kind: DocumentAssistantKind,
  entries: DocumentAssistantChatEntry[],
): Promise<DocumentAssistantHistory> {
  const response = await fetch("/api/document-assistant/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artifactId, kind, entries }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(body.entries)) throw new Error(body.error || "This chat could not be saved to Terminal history. It will retry automatically.");
  if (body.changed) {
    window.dispatchEvent(new Event("breadboard:hermes-sessions-changed"));
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(DOCUMENT_ASSISTANT_HISTORY_EVENT);
      channel.postMessage("changed");
      channel.close();
    }
  }
  return body as DocumentAssistantHistory;
}

/** Backfill chats even when their document editor has not been reopened yet. */
export function watchLegacyDocumentAssistantHistory(): () => void {
  let stopped = false;
  let running = false;
  let queued = false;
  const synced = new Map<string, string>();
  const migrate = async () => {
    if (running) { queued = true; return; }
    running = true;
    try {
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => Boolean(key));
      for (const key of keys) {
        if (stopped) break;
        const kind = (Object.keys(storagePrefixes) as DocumentAssistantKind[]).find(candidate => key.startsWith(storagePrefixes[candidate]));
        if (!kind) continue;
        const raw = localStorage.getItem(key) ?? "[]";
        if (synced.get(key) === raw) continue;
        try {
          const entries = parseDocumentAssistantEntries(JSON.parse(raw));
          if (entries.length) await syncDocumentAssistantHistoryClient(key.slice(storagePrefixes[kind].length), kind, entries);
          synced.set(key, raw);
        } catch {
          // Keep the original cache intact; an inaccessible/deleted document
          // must not hide the rest of the user's history.
        }
      }
    } catch {
      // Storage is unavailable in some browser modes.
    } finally {
      running = false;
      if (queued && !stopped) { queued = false; void migrate(); }
    }
  };
  const refresh = () => void migrate();
  const timer = window.setInterval(refresh, 30_000);
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(DOCUMENT_ASSISTANT_HISTORY_EVENT) : null;
  if (channel) channel.onmessage = () => window.dispatchEvent(new Event("breadboard:hermes-sessions-changed"));
  window.addEventListener("storage", refresh);
  void migrate();
  return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("storage", refresh); channel?.close(); };
}

"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChatSelectionMenu } from "@/app/components/chat-text-selection-ui";
import { normalizeChatTextSelectionReference } from "@/lib/chat-text-selection";
import { isChatHighlightColor, normalizeChatHighlightNote } from "@/lib/chat-highlights";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
// Temporarily hide this entry point while the Organization feature is paused.
// Keep the shared component and command handler ready to restore later.
const SHOW_ORGANIZATION_COMMENT_ACTION = false;

export default function BrowserSelectionPopover({ entry: rawEntry }: { entry: unknown }) {
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  const entry = useMemo(() => {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;
    const raw = rawEntry as Record<string, unknown>;
    const selection = normalizeChatTextSelectionReference({ ...raw, mode: "chat", sourceMessageId: "web:selection" });
    return selection ? { ...selection, ...(isChatHighlightColor(raw.color) ? { color: raw.color } : {}), note: normalizeChatHighlightNote(raw.note) } : null;
  }, [rawEntry]);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => { void sendDesktopTabsCommand({ type: "browser-selection-close" }); }, []);
  const resize = useCallback((height: number) => {
    void sendDesktopTabsCommand({ type: "browser-selection-resize", height: Math.min(480, height + 28 + (error ? 40 : 0)) });
  }, [error]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    document.documentElement.dataset.breadboardSelectionPopup = "true";
    document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.padding = "10px";
    if (!entry) close();
  }, [close, entry]);
  async function act(action: "highlight" | "note" | "remove" | "chat" | "inline", value?: string | null) {
    setError(null);
    try {
      if (!await sendDesktopTabsCommand({ type: "browser-selection-action", action, value })) setError("Couldn’t save this selection. Try again.");
    } catch { setError("Couldn’t save this selection. Try again."); }
  }
  return <>
    {hydrated && entry && <ChatSelectionMenu embedded onSizeChange={resize} selection={{ ...entry, anchor: { left: 10, right: 10, top: 60, bottom: 60, width: 0, height: 0 } }}
      highlighted={Boolean(entry.color)} highlightColor={entry.color} note={entry.note}
      onHighlightColor={color => void act("highlight", color)} onRemoveHighlight={() => void act("remove")}
      onSaveNote={note => void act("note", note)} onAskInChat={() => void act("chat")}
      onAskHere={() => void act("inline")}
      onComment={SHOW_ORGANIZATION_COMMENT_ACTION && new URLSearchParams(window.location.search).get("community") === "1" ? () => {
        void sendDesktopTabsCommand({ type: "browser-organization-selection" }).then(ok => { if (!ok) setError("Couldn’t open the discussion. Select the text again."); }).catch(() => setError("Couldn’t open the discussion."));
      } : undefined} onClose={close} />}
    {error && <p role="alert" className="mt-2 text-xs text-[var(--danger-hover)]">{error}</p>}
  </>;
}

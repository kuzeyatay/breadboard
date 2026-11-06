"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { SideChatContext, type SideChatRequest } from "../side-chat-context";
import { useStarredMessages } from "../use-starred-messages";

const SideChatPanel = lazy(() => import("./side-chat-panel"));

/** One side-chat host per workspace, shared by the transcript and saved chats. */
export default function WorkspaceSideChat({ children, gardenSlug, messages = [] }: {
  children: ReactElement;
  gardenSlug?: string;
  messages?: readonly { role: string; content: string }[];
}) {
  const [opened, setOpened] = useState<(SideChatRequest & { key: string }) | null>(null);
  const { saving } = useStarredMessages();
  const returnFocus = useRef<HTMLElement | null>(null);
  const open = useCallback((request?: SideChatRequest) => {
    if (saving) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Snapshot the visible conversation only when the side chat opens. Its
    // later turns must neither modify nor follow changes in the main thread.
    const context = request?.quote || messages.slice(-8)
      .filter(message => message.role === "user" || message.role === "assistant")
      .map(message => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n\n").slice(-12000);
    setOpened({ ...request, quote: request?.conversationId ? undefined : context, key: crypto.randomUUID() });
  }, [saving, messages]);
  const close = useCallback(() => {
    setOpened(null);
    returnFocus.current?.focus();
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const conversationId = query.get("sideChat");
    if (!conversationId) return;
    const frame = window.requestAnimationFrame(() => {
      setOpened({ conversationId, messageId: query.get("message") ?? undefined, key: crypto.randomUUID() });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return <SideChatContext.Provider value={open}>
    {children}
    {opened ? createPortal(
      <SideChatContext.Provider value={null}>
        <Suspense fallback={null}>
        <SideChatPanel key={opened.key} request={opened} gardenSlug={gardenSlug} onClose={close} />
        </Suspense>
      </SideChatContext.Provider>, document.body,
    ) : null}
  </SideChatContext.Provider>;
}

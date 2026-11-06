"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { BotDefinition } from "@/lib/bots/types";
import BotAvatar from "./bot-avatar";

const BotContext = createContext<BotDefinition | null>(null);
export function useConversationBot() { return useContext(BotContext); }

export function BotConversationProvider({ conversationId, children }: { conversationId?: string | number | null; children: ReactNode }) {
  const [result, setResult] = useState<{ id: string; bot: BotDefinition | null } | null>(null);
  useEffect(() => {
    if (typeof conversationId !== "string" || !conversationId.startsWith("conv_")) return;
    let request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      request = new AbortController();
      const signal = request.signal;
      void fetch(`/api/bots?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store", signal })
        .then(async response => { if (!response.ok) throw new Error("Bot unavailable"); return response.json(); })
        .then(body => { if (!signal.aborted) setResult({ id: conversationId, bot: body.bot ?? null }); })
        .catch(() => { if (!signal.aborted) setResult({ id: conversationId, bot: null }); });
    };
    refresh();
    window.addEventListener("breadboard:bots-changed", refresh);
    return () => { request?.abort(); window.removeEventListener("breadboard:bots-changed", refresh); };
  }, [conversationId]);
  return <BotContext.Provider value={result && result.id === conversationId ? result.bot : null}>{children}</BotContext.Provider>;
}

export function BotConversationIdentity() {
  const bot = useConversationBot();
  if (!bot) return null;
  return <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2" data-conversation-bot={bot.id}>
    <BotAvatar avatar={bot.avatar} name={bot.name} size={36} paused />
    <div className="min-w-0"><p className="text-sm font-medium text-[var(--ink-heading)]">{bot.name}</p><p className="truncate text-xs text-[var(--ink-muted)]">{bot.description}</p></div>
    <span className="ml-auto shrink-0 text-[10px] text-[var(--ink-muted)]">{bot.archived ? "Saved bot chat" : "Bot chat"}</span>
  </div>;
}

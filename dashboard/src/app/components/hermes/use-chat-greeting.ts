"use client";

import { useEffect, useMemo, useState } from "react";

import {
  CHAT_GREETING_ROTATION_MS,
  EMPTY_CHAT_GREETING_SIGNALS,
  msUntilNextChatGreeting,
  resolveChatGreeting,
  resolveChatSuggestions,
  type ChatGreeting,
  type ChatGreetingScope,
  type ChatGreetingSignals,
} from "@/lib/hermes/chat-greeting";

interface Options {
  scope: ChatGreetingScope;
  /** Off-the-record chats greet differently and open with different questions. */
  temporary: boolean;
}

export interface ChatGreetingState {
  /** False until the clock has been read on the client and the signals have landed. */
  ready: boolean;
  greeting: ChatGreeting | null;
  suggestions: string[];
}

const NOT_READY: ChatGreetingState = { ready: false, greeting: null, suggestions: [] };

// One fetch per hour serves every terminal in the tab. Opening the dock, closing
// it and opening it again should not cost a round trip, and the answer would be
// the same one anyway until the pools step forward.
let cache: { signals: ChatGreetingSignals; readAt: number } | null = null;

function cachedSignals(): ChatGreetingSignals | null {
  if (!cache) return null;
  if (Date.now() - cache.readAt >= CHAT_GREETING_ROTATION_MS) return null;
  return cache.signals;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * The route is the only caller, but the empty state is chrome: a payload that
 * has gone strange should cost the greeting its detail, never its render.
 */
function normalizeSignals(value: unknown): ChatGreetingSignals {
  if (!value || typeof value !== "object") return EMPTY_CHAT_GREETING_SIGNALS;
  const raw = value as Record<string, unknown>;
  const minutes = raw.minutesSinceLastPrompt;
  return {
    name: text(raw.name),
    gardenCount: count(raw.gardenCount),
    recentGardens: Array.isArray(raw.recentGardens)
      ? raw.recentGardens
          .map((entry) => {
            const garden = entry as Record<string, unknown> | null;
            const name = text(garden?.name);
            const slug = text(garden?.slug);
            return name && slug ? { name, slug } : null;
          })
          .filter((garden): garden is { name: string; slug: string } => garden !== null)
      : [],
    recentChats: Array.isArray(raw.recentChats)
      ? raw.recentChats
          .map((entry) => text(entry))
          .filter((title): title is string => title !== null)
      : [],
    promptsToday: count(raw.promptsToday),
    minutesSinceLastPrompt:
      typeof minutes === "number" && Number.isFinite(minutes) ? Math.max(0, Math.trunc(minutes)) : null,
    daysSinceJoined: count(raw.daysSinceJoined),
  };
}

/**
 * The greeting and the openers for a blank chat.
 *
 * The clock is read after mount rather than during render, so the server and
 * the first client pass agree on "nothing yet" instead of disagreeing about
 * what hour it is. A timer sleeping to the top of the hour then steps the
 * pools forward and re-reads the activity signals behind them.
 */
export function useChatGreeting({ scope, temporary }: Options): ChatGreetingState {
  const [now, setNow] = useState<Date | null>(null);
  const [signals, setSignals] = useState<ChatGreetingSignals | null>(null);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    function step() {
      if (cancelled) return;
      const at = new Date();
      setNow(at);
      setRotation((current) => current + 1);
      // A second past the boundary, so a timer that fires a hair early does not
      // land back inside the hour it was supposed to leave.
      timer = window.setTimeout(step, msUntilNextChatGreeting(at) + 1_000);
    }

    step();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const warm = cachedSignals();
    if (warm) {
      setSignals(warm);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/chat-greeting", { cache: "no-store" });
        if (!response.ok) throw new Error(`Greeting signals returned ${response.status}`);
        const parsed = normalizeSignals(await response.json());
        cache = { signals: parsed, readAt: Date.now() };
        if (!cancelled) setSignals(parsed);
      } catch {
        // A greeting that knows nothing still greets.
        if (!cancelled) setSignals((current) => current ?? EMPTY_CHAT_GREETING_SIGNALS);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rotation]);

  return useMemo(() => {
    if (now === null || signals === null) return NOT_READY;
    const input = { signals, scope, temporary, now };
    return {
      ready: true,
      greeting: resolveChatGreeting(input),
      suggestions: resolveChatSuggestions(input),
    };
  }, [now, scope, signals, temporary]);
}

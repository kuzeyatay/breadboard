"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatAssistantModelChangeName } from "@/lib/ai-models";
import {
  chatModelChangeLabels,
  modelChangeAnchor,
  type ModelChangeMessage,
} from "@/lib/chat-model-changes";

type Boundaries = Record<string, string[]>;

function readBoundaries(key: string): Boundaries {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).map(([anchor, labels]) => [
        anchor,
        chatModelChangeLabels({ modelChangesAfter: labels }),
      ]),
    );
  } catch {
    return {};
  }
}

/** Presentation stays separate from streaming buffers and model context. */
export function useChatModelChanges({
  scope,
  sessionId,
  createdSessionId,
  conversationId,
  messages,
  model,
  onModelChange,
  persist = true,
}: {
  scope: string;
  sessionId: string | number | null;
  createdSessionId?: string | number | null;
  conversationId?: string | null;
  messages: readonly ModelChangeMessage[];
  model: string;
  onModelChange: (model: string) => void;
  persist?: boolean;
}) {
  const key = `breadboard:model-changes:${scope}:${sessionId ?? "draft"}`;
  const [byChat, setByChat] = useState<Record<string, Boundaries>>({});
  const latest = useRef(byChat);
  latest.current = byChat;
  const previous = useRef({ key, sessionId });
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const restored = useMemo(
    () => (persist && sessionId !== null ? readBoundaries(key) : {}),
    [key, persist, sessionId],
  );
  const changes = byChat[key] ?? restored;
  const save = useCallback(
    (targetKey: string, boundaries: Boundaries, durable: boolean) => {
      latest.current = { ...latest.current, [targetKey]: boundaries };
      setByChat(latest.current);
      if (durable) {
        try {
          window.localStorage.setItem(targetKey, JSON.stringify(boundaries));
        } catch {
          /* Keep the current view usable. */
        }
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const old = previous.current;
    if (
      old.key !== key &&
      old.sessionId === null &&
      sessionId !== null &&
      sessionId === createdSessionId
    ) {
      const draft = latest.current[old.key];
      if (draft) save(key, draft, persist);
    }
    previous.current = { key, sessionId };
  }, [key, sessionId, createdSessionId, persist, save]);

  useLayoutEffect(() => {
    if (
      sessionId === null &&
      !messages.length &&
      Object.keys(latest.current[key] ?? {}).length
    )
      save(key, {}, false);
  }, [key, sessionId, messages.length, save]);

  const labelsFor = useCallback(
    (message: ModelChangeMessage, index: number) => {
      if (message.role !== "assistant") return [];
      const stored = chatModelChangeLabels(message);
      const local = changes[modelChangeAnchor(message, index)] ?? [];
      return stored.length >= local.length ? stored : local;
    },
    [changes],
  );

  const changeModel = useCallback(
    (nextModel: string) => {
      if (nextModel === model) return;
      const index = messages.findLastIndex(
        (message) =>
          message.role === "assistant" &&
          !message.modelChange &&
          !message.delegatedAgentRun &&
          !message.inlineSelection &&
          message.textSelection?.mode !== "inline",
      );
      const answer = messages[index];
      if (answer) {
        const current = latest.current[key] ?? changes;
        const anchor = modelChangeAnchor(answer, index);
        const stored = chatModelChangeLabels(answer);
        const local = current[anchor] ?? [];
        const labels = local.length > stored.length ? local : stored;
        save(
          key,
          {
            ...current,
            [anchor]: [
              ...labels,
              formatAssistantModelChangeName(nextModel),
            ].slice(-50),
          },
          persist && sessionId !== null,
        );
        // Canonical chats share the durable boundary with Terminal. Local-only
        // histories retain it with their own browser history, including offline.
        if (conversationId && answer.clientMessageId) {
          writes.current = writes.current
            .catch(() => undefined)
            .then(async () => {
              for (const delay of [0, 100, 250, 500, 1_000, 2_000]) {
                if (delay)
                  await new Promise((resolve) =>
                    window.setTimeout(resolve, delay),
                  );
                const response = await fetch(
                  `/api/hermes/sessions/${encodeURIComponent(conversationId)}/model-change`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      surface: "dashboard_terminal",
                      model: nextModel,
                      afterClientMessageId: answer.clientMessageId,
                    }),
                  },
                );
                if (response.status !== 404) return;
                const body = await response.json().catch(() => ({}));
                if (body.code !== "turn_not_found") return;
              }
            })
            .catch(() => undefined);
        }
      }
      onModelChange(nextModel);
    },
    [
      model,
      messages,
      key,
      changes,
      save,
      persist,
      sessionId,
      conversationId,
      onModelChange,
    ],
  );

  return { changeModel, labelsFor };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useHumanizerMode } from "../use-humanizer-mode";
import { autoHumanizeMessage, type AutoHumanizeOutcome, type AutoHumanizeProgress } from "./auto-humanize";

interface RewriteMessage {
  role: string;
  content: string;
  id?: string;
  clientMessageId?: string;
  createdAt?: string;
  failed?: boolean;
  interrupted?: boolean;
  runtimeError?: string;
  contentVersions?: unknown;
  modelChange?: unknown;
  textSelection?: { mode?: string };
  inlineSelection?: unknown;
}

export interface NaturalRewriteActivity extends AutoHumanizeProgress {
  startedAt: string;
}

export function rewriteMessageId(message: RewriteMessage): string | undefined {
  return message.clientMessageId ?? message.id;
}

/** Apply only to the same wording, keeping newer turns and edits intact. */
export function applyAutoHumanizeOutcome<T extends RewriteMessage>(
  messages: T[], original: T, outcome: AutoHumanizeOutcome,
): T[] {
  return messages.map((message) =>
    message.role === "assistant" && rewriteMessageId(message) === rewriteMessageId(original) && message.content === original.content
      ? {
          ...message,
          content: outcome.content,
          humanizerReview: outcome.review,
          ...(outcome.adopted ? { contentVersions: outcome.versions, verification: undefined } : {}),
        }
      : message,
  );
}

/** Owned by the transcript, so scrolling a virtualized row away cannot cancel it. */
export function useAutoHumanize<T extends RewriteMessage>(input: {
  conversationId?: string | null;
  messages: T[];
  active: boolean;
  blocked?: boolean;
  isEligible?: (message: T) => boolean;
  onComplete: (message: T, outcome: AutoHumanizeOutcome) => void;
}) {
  const [enabled] = useHumanizerMode();
  const [activity, setActivity] = useState<Record<string, NaturalRewriteActivity>>({});
  const latest = useRef(input);
  const sawRunRef = useRef(new Map<string, string>());
  const attemptedRef = useRef(new Set<string>());
  const requests = useRef(new Map<string, AbortController>());
  useEffect(() => { latest.current = input; });
  useEffect(() => () => {
    for (const controller of requests.current.values()) controller.abort();
  }, []);
  useEffect(() => {
    if (enabled) return;
    for (const [key, controller] of requests.current) {
      controller.abort();
      setActivity((current) => current[key] ? {
        ...current,
        [key]: { ...current[key], state: "failed", message: "Natural rewrite cancelled. Original answer kept." },
      } : current);
    }
  }, [enabled]);

  useEffect(() => {
    const { conversationId, messages, active, blocked, isEligible } = input;
    if (!conversationId) return;
    const user = messages.findLast((message) => message.role === "user");
    const turnKey = user && (rewriteMessageId(user) ?? `${user.createdAt}:${user.content}`);
    if (active) {
      if (turnKey) sawRunRef.current.set(conversationId, turnKey);
      return;
    }
    if (!enabled || blocked || !turnKey || sawRunRef.current.get(conversationId) !== turnKey) return;
    const message = messages.findLast((candidate) => candidate.role === "assistant" && !candidate.modelChange);
    if (!message || messages.indexOf(message) < messages.indexOf(user!) ||
      !message.content.trim() || message.failed || message.interrupted || message.runtimeError ||
      message.contentVersions || message.textSelection?.mode === "inline" || message.inlineSelection ||
      isEligible?.(message) === false) return;
    const messageId = rewriteMessageId(message);
    if (!messageId) return;
    const key = `${conversationId}:${messageId}`;
    if (attemptedRef.current.has(key)) return;
    attemptedRef.current.add(key);
    const controller = new AbortController();
    requests.current.set(key, controller);
    const startedAt = new Date().toISOString();
    void autoHumanizeMessage({
      conversationId, messageId, content: message.content, signal: controller.signal,
      onProgress(progress) {
        if (!controller.signal.aborted) {
          setActivity((current) => ({ ...current, [key]: { ...progress, startedAt } }));
        }
      },
    }).then((outcome) => {
      if (outcome && !controller.signal.aborted && latest.current.conversationId === conversationId) {
        latest.current.onComplete(message, outcome);
      }
    }).finally(() => requests.current.delete(key));
    // Transcript ticks must not abort a request already being processed.
  }, [enabled, input]);

  return useCallback((message: T) =>
    activity[`${input.conversationId}:${rewriteMessageId(message)}`],
  [activity, input.conversationId]);
}

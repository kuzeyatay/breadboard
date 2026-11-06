"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatMessageAttachments } from "@/lib/chat-attachments";
import { currentBrowserTerminalAccess } from "@/lib/browser-terminal";
import type { ChatTextSelectionReference } from "@/lib/chat-text-selection";
import { normalizeChatTokenUsage } from "@/lib/chat-token-usage";
import { preserveInlineQuestionMessages } from "@/lib/conversations/garden-inline-question";
import { readGardenResponseData } from "@/lib/hermes/garden-response-stream";
import { loadHermesSessionDetail } from "@/lib/hermes/session-client";
import { isAgentModeEnabled, isSuperAgentEnabled } from "../use-agent-mode";
import { isYoloModeEnabled } from "../use-yolo-mode";
import { isDirectModeEnabled } from "../use-direct-mode";
import { isPersonalizeEnabled } from "../use-personalize";
import { normalizeRestoredMessages, type AgentMessage, type AgentSendOptions } from "./use-agent-session";

interface InlineRun {
  sessionId: string | null;
  clientMessageId: string;
  selection: ChatTextSelectionReference;
  messages: AgentMessage[];
  controller: AbortController;
  dispatched: boolean;
  stopped: boolean;
}

async function stopRequest(run: InlineRun) {
  if (!run.sessionId || !run.dispatched) return;
  const response = await fetch(`/api/hermes/sessions/${run.sessionId}/abort?inlineTurnId=${encodeURIComponent(run.clientMessageId)}`, { method: "POST" });
  if (!response.ok) throw new Error("This answer could not be stopped. Try Stop again.");
}

/** Side questions share saved history, but never own the main run's state. */
export function useInlineAgentQuestions(input: {
  sessionId: string | null;
  messages: AgentMessage[];
  ensureConversation: () => Promise<string>;
  pageSlug?: string;
}) {
  const runs = useRef(new Map<string, InlineRun>());
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  const publish = useCallback(() => { if (mounted.current) setRevision(value => value + 1); }, []);
  useEffect(() => {
    mounted.current = true;
    const currentRuns = runs.current;
    return () => {
      mounted.current = false;
      // Detach viewers and preparation; dispatched work remains server-owned.
      for (const run of currentRuns.values()) run.controller.abort();
    };
  }, []);

  // Observe durable progress for agent mode, reconnects, and restored answers.
  // Main-chat state is deliberately not refreshed or replaced by these polls.
  useEffect(() => {
    if (!input.sessionId) return;
    let restored = false;
    for (const message of input.messages) {
      const selection = message.textSelection;
      if (message.role !== "assistant" || !message.pending || selection?.mode !== "inline" || !message.clientMessageId) continue;
      if (runs.current.has(message.clientMessageId)) continue;
      runs.current.set(message.clientMessageId, {
        sessionId: input.sessionId, clientMessageId: message.clientMessageId, selection,
        messages: input.messages.filter(item => item.clientMessageId === message.clientMessageId),
        controller: new AbortController(), dispatched: true, stopped: false,
      });
      restored = true;
    }
    if (restored) publish();
  }, [input.sessionId, input.messages, publish]);

  const hasPendingDispatchedRun = [...runs.current.values()].some(run =>
    run.sessionId === input.sessionId && run.dispatched && run.messages.at(-1)?.pending);
  useEffect(() => {
    if (!input.sessionId || !hasPendingDispatchedRun) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const saved = normalizeRestoredMessages((await loadHermesSessionDetail("dashboard_terminal", input.sessionId!)).messages);
        if (disposed) return;
        let changed = false;
        for (const run of runs.current.values()) {
          if (run.sessionId !== input.sessionId || !run.messages.at(-1)?.pending || !run.dispatched) continue;
          const pair = saved.filter(message => message.clientMessageId === run.clientMessageId);
          const answer = pair.find(message => message.role === "assistant");
          if (!answer) continue;
          const local = run.messages.at(-1)!;
          run.messages = pair.map(message => message.role === "assistant" && message.pending
            ? { ...local, ...message, content: message.content || local.content, reasoning: message.reasoning || local.reasoning }
            : message);
          if (!answer.pending) run.controller.abort();
          changed = true;
        }
        if (changed) publish();
      } catch { /* A disconnected viewer retries without stopping the server. */ }
      if (!disposed) timer = setTimeout(poll, 1_000);
    };
    timer = setTimeout(poll, 1_000);
    return () => { disposed = true; clearTimeout(timer); };
    // Main-chat tokens and inline stream publishes must not keep resetting the
    // timer: an agent answer still needs durable updates while either streams.
  }, [input.sessionId, hasPendingDispatchedRun, publish]);

  async function send(question: string, selection: ChatTextSelectionReference, options: AgentSendOptions) {
    if (!question.trim() || [...runs.current.values()].some(run => run.selection.id === selection.id && run.messages.at(-1)?.pending)) return;
    const clientMessageId = crypto.randomUUID();
    const started = Date.now();
    const createdAt = new Date(started).toISOString();
    const user: AgentMessage = { id: clientMessageId, clientMessageId, role: "user", content: question.trim(), textSelection: selection, createdAt };
    const answer: AgentMessage = { id: crypto.randomUUID(), clientMessageId, role: "assistant", content: "", textSelection: selection, createdAt, pending: true };
    const run: InlineRun = { sessionId: input.sessionId, clientMessageId, selection, messages: [user, answer], controller: new AbortController(), dispatched: false, stopped: false };
    runs.current.set(clientMessageId, run);
    publish();
    options.onTurnStarted?.();
    const signal = run.controller.signal;
    try {
      run.sessionId = await input.ensureConversation();
      signal.throwIfAborted();
      const attachments = options.prepareAttachments ? await options.prepareAttachments(signal) : options.attachments ?? [];
      signal.throwIfAborted();
      const browserAccess = options.browserAccess !== undefined
        ? options.browserAccess ?? undefined
        : selection.sourceUrl ? await currentBrowserTerminalAccess() : undefined;
      signal.throwIfAborted();
      Object.assign(user, { attachments: chatMessageAttachments(attachments), attachmentNames: attachments.map(item => item.name) });
      const agentMode = isAgentModeEnabled();
      run.dispatched = true;
      publish();
      // Do not abort dispatch mid-reservation. Stop is repeated once it settles.
      const response = await fetch(`/api/hermes/sessions/${run.sessionId}/${agentMode ? "messages" : "direct"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientMessageId, text: question.trim(), surface: "dashboard_terminal",
          surfaceContext: { activePageSlug: input.pageSlug, selectedText: selection.quote },
          responseStartedAt: createdAt, textSelection: selection, attachments, concurrentInline: true,
          model: options.model, reasoningEffort: options.reasoningEffort,
          browserAccess, voice: options.voice,
          branchGroupId: options.branchGroupId, superAgent: isSuperAgentEnabled(),
          yoloMode: isYoloModeEnabled(), adhdMode: isDirectModeEnabled(), personalize: isPersonalizeEnabled(),
        }),
      });
      if (run.stopped) { await stopRequest(run); void response.body?.cancel(); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : body.error?.message ?? "Could not answer this highlight.");
      }
      options.onTurnPersisted?.(run.sessionId);
      if (agentMode) { await response.json(); return; }
      if (!response.body) throw new Error("The answer stream could not be opened.");
      try {
        for await (const payload of readGardenResponseData(response.body, signal)) {
          if (payload === "[DONE]") break;
          const event = JSON.parse(payload);
          if (event.type === "delta") answer.content += event.text;
          else if (event.type === "replace") answer.content = event.text;
          else if (event.type === "thinking") answer.reasoning = (answer.reasoning ?? "") + event.text;
          else if (event.type === "usage") answer.usage = normalizeChatTokenUsage(event.usage) ?? undefined;
          else if (event.type === "error") { answer.failed = true; answer.content ||= event.message ?? event.error ?? "Could not answer this highlight."; }
          // A poll can replace the pair while a direct stream is open.
          if (!run.messages.at(-1)?.pending) return;
          run.messages = [user, { ...answer }];
          publish();
        }
      } catch { return; /* Poll the durable answer if the stream disconnects. */ }
      answer.pending = false;
      answer.responseCompletedAt = new Date().toISOString();
      answer.responseDurationMs = Date.now() - started;
      run.messages = [user, { ...answer }];
    } catch (failure) {
      if (run.stopped || !mounted.current) return;
      Object.assign(answer, { pending: false, failed: true,
        content: failure instanceof Error ? failure.message : "Could not answer this highlight.",
        responseCompletedAt: new Date().toISOString(), responseDurationMs: Date.now() - started });
      run.messages = [user, { ...answer }];
    } finally { publish(); }
  }

  const stop = useCallback(async (selectionId: string) => {
    const run = [...runs.current.values()].findLast(item => item.selection.id === selectionId && item.messages.at(-1)?.pending);
    if (!run) return;
    run.stopped = true;
    run.controller.abort();
    try {
      await stopRequest(run);
      run.messages = run.messages.map(message => message.role === "assistant" ? { ...message,
        pending: false, interrupted: true, content: message.content || "Stopped.", responseCompletedAt: new Date().toISOString() } : message);
    } catch (error) {
      run.stopped = false;
      run.messages = run.messages.map(message => message.role === "assistant" ? { ...message, content: String(error) } : message);
    }
    publish();
  }, [publish]);

  // A draft edit changes neither history nor side turns. Preserve the message
  // array (and Stop callback) so the panel's annotation/markdown caches survive
  // typing. Every change to a local run publishes a new revision.
  const snapshot = useMemo(() => {
    const visible = [...runs.current.values()].filter(run => run.sessionId === input.sessionId || !run.sessionId);
    return {
      busy: visible.some(run => run.messages.at(-1)?.pending),
      messages: visible.length
        ? preserveInlineQuestionMessages(input.messages, visible.flatMap(run => run.messages))
        : input.messages,
    };
    // Local runs mutate between publishes; revision is their cache key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.messages, input.sessionId, revision]);
  return { send, stop, ...snapshot };
}

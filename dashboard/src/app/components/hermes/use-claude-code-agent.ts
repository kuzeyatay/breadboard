"use client";

import { useCallback, useState } from "react";
import {
  CLAUDE_CODE_AGENT_ID,
  CLAUDE_CODE_AGENT_NAME,
  claudeCodeUserMessage,
} from "@/lib/claude-code-agent/identity.ts";
import type { ExternalAgentOutcome, ExternalAgentRun } from "@/lib/conversations/external-agent-runs.ts";
import { chatMessageAttachments, type ChatAttachment, type ChatMessageAttachment } from "@/lib/chat-attachments.ts";

interface SessionLike {
  externalAgentTurnPersistence: (clientMessageId: string) => {
    attachToExistingTurn: boolean;
    delegatedAgentRun: boolean;
    delegatedAgentReason?: string;
  };
  ensureConversation: (clientMessageId?: string) => Promise<string>;
  previewExternalAgentTurn: (input: { clientMessageId: string; userContent: string; attachments?: ChatMessageAttachment[] }) => string;
  appendExternalAgentTurn: (input: {
    clientMessageId: string;
    userContent: string;
    assistantContent?: string;
    run?: ExternalAgentRun;
    outcome?: ExternalAgentOutcome;
    attachments?: ChatMessageAttachment[];
  }) => Promise<void>;
}

/** Claude Code with Breadboard's tools, in the chat it was started from. */
export function useClaudeCodeAgent(
  session: SessionLike,
  model: string,
  gardenSlug: string | null,
  onStatus?: (message: string) => void,
) {
  const [agent, setAgent] = useState<{ id: string; name: string } | null>(null);
  const [launching, setLaunching] = useState(false);

  const select = useCallback(async () => {
    const selected = { id: CLAUDE_CODE_AGENT_ID, name: CLAUDE_CODE_AGENT_NAME };
    setAgent(selected);
    onStatus?.("");
    void fetch("/api/claude-code/health")
      .then((response) => response.json())
      .then((data: { available?: boolean; reason?: string }) => {
        if (data.available !== true) onStatus?.(data.reason ?? "Claude Code is unavailable.");
      })
      .catch(() => onStatus?.("Claude Code is unavailable."));
    return selected;
  }, [onStatus]);

  const clear = useCallback(() => setAgent(null), []);

  const launch = useCallback(async (task: string, attachments: readonly ChatAttachment[] = []) => {
    const trimmed = task.trim();
    if (!trimmed || launching) return;
    setLaunching(true);
    onStatus?.("");
    const userContent = claudeCodeUserMessage(trimmed);
    const persistedAttachments = chatMessageAttachments(attachments);
    const images = attachments.filter((attachment) => attachment.type === "image");
    const clientMessageId = session.previewExternalAgentTurn({ clientMessageId: crypto.randomUUID(), userContent, attachments: persistedAttachments });
    const launchPersistence = session.externalAgentTurnPersistence(clientMessageId);
    let runStarted = false;
    try {
      const conversationId = await session.ensureConversation(clientMessageId);
      const response = await fetch("/api/claude-code/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: trimmed, model, gardenSlug, conversationId, clientMessageId, ...launchPersistence, attachments: images }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string; run?: { runId?: string } };
      if (!response.ok || !data.run?.runId) {
        throw new Error(data.message ?? data.error ?? "The Claude Code task could not start.");
      }
      runStarted = true;
      await session.appendExternalAgentTurn({
        clientMessageId,
        userContent,
        run: { kind: "claude_code", runId: data.run.runId, task: trimmed },
        attachments: persistedAttachments,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The Claude Code task could not start.";
      if (runStarted) {
        onStatus?.(message);
        return;
      }
      try {
        await session.appendExternalAgentTurn({ clientMessageId, userContent, assistantContent: message, outcome: "failed", attachments: persistedAttachments });
      } catch (persistenceError) {
        onStatus?.(persistenceError instanceof Error ? persistenceError.message : "The Claude Code turn could not be saved.");
      }
    } finally {
      setLaunching(false);
    }
  }, [gardenSlug, launching, model, onStatus, session]);

  return { agent, select, clear, launch, launching };
}

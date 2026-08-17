"use client";

import { useCallback, useState } from "react";
import {
  OPENCODE_AGENT_ID,
  OPENCODE_AGENT_NAME,
  openCodeUserMessage,
} from "@/lib/opencode/identity.ts";
import type {
  ExternalAgentOutcome,
  ExternalAgentRun,
} from "@/lib/conversations/external-agent-runs.ts";
import {
  chatMessageAttachments,
  type ChatAttachment,
  type ChatMessageAttachment,
} from "@/lib/chat-attachments.ts";

interface SessionLike {
  ensureConversation: (clientMessageId?: string) => Promise<string>;
  previewExternalAgentTurn: (input: {
    clientMessageId: string;
    userContent: string;
    attachments?: ChatMessageAttachment[];
  }) => string;
  appendExternalAgentTurn: (input: {
    clientMessageId: string;
    userContent: string;
    assistantContent?: string;
    run?: ExternalAgentRun;
    outcome?: ExternalAgentOutcome;
    attachments?: ChatMessageAttachment[];
  }) => Promise<void>;
}

const ERROR_TEXT: Record<string, string> = {
  repository_not_connected:
    "Connect a local Git repository from this Garden's card before using OpenCode.",
  repository_unavailable:
    "The connected repository is no longer available. Reconnect it from the Garden card.",
  garden_required:
    "More than one Garden has a repository. Open the Garden chat you want OpenCode to work in.",
  garden_not_found: "This Garden is no longer available.",
};

function explain(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return ERROR_TEXT[code] ?? code;
}

export function useOpenCodeAgent(
  session: SessionLike,
  model: string,
  reasoningEffort: string,
  gardenSlug: string | null,
  onStatus?: (message: string) => void,
) {
  const [agent, setAgent] = useState<{ id: string; name: string } | null>(null);
  const [launching, setLaunching] = useState(false);

  const select = useCallback(async () => {
    const selected = { id: OPENCODE_AGENT_ID, name: OPENCODE_AGENT_NAME };
    setAgent(selected);
    onStatus?.("");
    void (async () => {
      try {
        const query = gardenSlug
          ? `?gardenSlug=${encodeURIComponent(gardenSlug)}`
          : "";
        const response = await fetch(`/api/opencode/health${query}`);
        const data = (await response.json().catch(() => ({}))) as {
          available?: boolean;
          reason?: string;
          repository?: { name?: string };
        };
        if (!response.ok || data.available !== true) {
          onStatus?.(explain(data.reason, "OpenCode is unavailable."));
        } else if (data.repository?.name) {
          onStatus?.(`OpenCode connected to ${data.repository.name}.`);
        }
      } catch {
        onStatus?.("OpenCode is unavailable.");
      }
    })();
    return selected;
  }, [gardenSlug, onStatus]);

  const clear = useCallback(() => setAgent(null), []);

  const launch = useCallback(
    async (task: string, attachments: readonly ChatAttachment[] = []) => {
      const trimmed = task.trim();
      if (!trimmed || launching) return;
      setLaunching(true);
      onStatus?.("");
      let clientMessageId = crypto.randomUUID();
      const userContent = openCodeUserMessage(trimmed);
      const persistedAttachments = chatMessageAttachments(attachments);
      const imageAttachments = attachments.filter(
        (attachment) => attachment.type === "image",
      );
      clientMessageId = session.previewExternalAgentTurn({
        clientMessageId,
        userContent,
        attachments: persistedAttachments,
      });
      let runStarted = false;
      try {
        // Named so the run can read the chat it was launched from; the turn
        // itself is persisted below, as it always was.
        const conversationId = await session.ensureConversation(clientMessageId);
        const response = await fetch("/api/opencode/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task: trimmed,
            model,
            reasoningEffort,
            gardenSlug,
            conversationId,
            clientMessageId,
            attachments: imageAttachments,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          run?: {
            runId?: string;
            gardenSlug?: string;
            repository?: string;
          };
        };
        if (
          !response.ok ||
          !data.run?.runId ||
          !data.run.gardenSlug ||
          !data.run.repository
        ) {
          throw new Error(
            data.message ??
              explain(data.error, "The OpenCode task could not start."),
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "opencode",
            runId: data.run.runId,
            task: trimmed,
            gardenSlug: data.run.gardenSlug,
            repository: data.run.repository,
          },
          attachments: persistedAttachments,
        });
      } catch (cause) {
        if (runStarted) {
          onStatus?.(
            cause instanceof Error
              ? cause.message
              : "OpenCode started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent =
          cause instanceof Error
            ? cause.message
            : "The OpenCode task could not start.";
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
            attachments: persistedAttachments,
          });
        } catch (persistenceError) {
          onStatus?.(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The OpenCode turn could not be saved.",
          );
        }
      } finally {
        setLaunching(false);
      }
    },
    [
      gardenSlug,
      launching,
      model,
      onStatus,
      reasoningEffort,
      session,
    ],
  );

  return { agent, select, clear, launch, launching };
}

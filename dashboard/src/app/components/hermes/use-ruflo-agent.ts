"use client";

import { useCallback, useState } from "react";
import {
  RUFLO_AGENT_ID,
  RUFLO_AGENT_NAME,
  rufloUserMessage,
} from "@/lib/ruflo/identity.ts";
import type {
  ExternalAgentOutcome,
  ExternalAgentRun,
} from "@/lib/conversations/external-agent-runs.ts";
import type { ChatMessageAttachment } from "@/lib/chat-attachments.ts";

interface SessionLike {
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
    "Connect a local Git repository from this Garden's card before running a Ruflo swarm.",
  repository_unavailable:
    "The connected repository is no longer available. Reconnect it from the Garden card.",
  garden_required:
    "More than one Garden has a repository. Open the Garden chat you want the Ruflo swarm to work in.",
  garden_not_found: "This Garden is no longer available.",
};

function explain(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return ERROR_TEXT[code] ?? code;
}

export function useRufloAgent(
  session: SessionLike,
  gardenSlug: string | null,
  onStatus?: (message: string) => void,
) {
  const [agent, setAgent] = useState<{ id: string; name: string } | null>(null);
  const [launching, setLaunching] = useState(false);

  const select = useCallback(async () => {
    const selected = { id: RUFLO_AGENT_ID, name: RUFLO_AGENT_NAME };
    setAgent(selected);
    onStatus?.("");
    void (async () => {
      try {
        const query = gardenSlug
          ? `?gardenSlug=${encodeURIComponent(gardenSlug)}`
          : "";
        const response = await fetch(`/api/ruflo/health${query}`);
        const data = (await response.json().catch(() => ({}))) as {
          available?: boolean;
          reason?: string;
          version?: string | null;
          repository?: { name?: string };
        };
        if (!response.ok || data.available !== true) {
          onStatus?.(explain(data.reason, "Ruflo is unavailable."));
        } else if (data.repository?.name) {
          onStatus?.(
            `Ruflo ${data.version ?? ""} ready to swarm ${data.repository.name}.`.replace(
              /\s+/g,
              " ",
            ),
          );
        }
      } catch {
        onStatus?.("Ruflo is unavailable.");
      }
    })();
    return selected;
  }, [gardenSlug, onStatus]);

  const clear = useCallback(() => setAgent(null), []);

  const launch = useCallback(
    async (task: string) => {
      const trimmed = task.trim();
      if (!trimmed || launching) return;
      setLaunching(true);
      onStatus?.("");
      let clientMessageId = crypto.randomUUID();
      const userContent = rufloUserMessage(trimmed);
      clientMessageId = session.previewExternalAgentTurn({ clientMessageId, userContent });
      let runStarted = false;
      try {
        const response = await fetch("/api/ruflo/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: trimmed, gardenSlug }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          run?: { runId?: string; gardenSlug?: string; repository?: string };
        };
        if (
          !response.ok ||
          !data.run?.runId ||
          !data.run.gardenSlug ||
          !data.run.repository
        ) {
          throw new Error(
            data.message ?? explain(data.error, "The Ruflo swarm could not start."),
          );
        }
        runStarted = true;
        await session.appendExternalAgentTurn({
          clientMessageId,
          userContent,
          run: {
            kind: "ruflo",
            runId: data.run.runId,
            task: trimmed,
            gardenSlug: data.run.gardenSlug,
            repository: data.run.repository,
          },
        });
      } catch (cause) {
        if (runStarted) {
          onStatus?.(
            cause instanceof Error
              ? cause.message
              : "The Ruflo swarm started, but its chat turn could not be saved.",
          );
          return;
        }
        const assistantContent =
          cause instanceof Error
            ? cause.message
            : "The Ruflo swarm could not start.";
        try {
          await session.appendExternalAgentTurn({
            clientMessageId,
            userContent,
            assistantContent,
            outcome: "failed",
          });
        } catch (persistenceError) {
          onStatus?.(
            persistenceError instanceof Error
              ? persistenceError.message
              : "The Ruflo turn could not be saved.",
          );
        }
      } finally {
        setLaunching(false);
      }
    },
    [gardenSlug, launching, onStatus, session],
  );

  return { agent, select, clear, launch, launching };
}

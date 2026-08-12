"use client";

import { useCallback } from "react";
import type {
  ExternalAgentTurnInput,
  ExternalAgentTurnPreview,
} from "./use-agent-session";
import type { LocalWorkflowSummary, WorkflowRunResponse } from "@/lib/workflows/types";

type WorkflowChatSession = {
  previewExternalAgentTurn: (input: ExternalAgentTurnPreview) => void;
  appendExternalAgentTurn: (input: ExternalAgentTurnInput) => Promise<void>;
};

function workflowUserMessage(workflow: LocalWorkflowSummary, input: string): string {
  const request = input.trim();
  return request
    ? `Run the ${workflow.name} automation\n\n${request}`
    : `Run the ${workflow.name} automation`;
}

export function useWorkflowAutomation(
  session: WorkflowChatSession,
) {
  const previewExternalAgentTurn = session.previewExternalAgentTurn;
  const appendExternalAgentTurn = session.appendExternalAgentTurn;

  return useCallback(async (workflow: LocalWorkflowSummary, input: string) => {
    const clientMessageId = crypto.randomUUID();
    const userContent = workflowUserMessage(workflow, input);
    previewExternalAgentTurn({ clientMessageId, userContent });
    let assistantContent: string;
    try {
      const response = await fetch(`/api/workflows/local/${encodeURIComponent(workflow.id)}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<WorkflowRunResponse> & { error?: string };
      if (!response.ok || typeof payload.assistantContent !== "string") {
        throw new Error(payload.error || `${workflow.name} could not be run.`);
      }
      assistantContent = `${payload.assistantContent}\n\n[Open automation settings](/workflows?workflow=${encodeURIComponent(workflow.id)})`;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `${workflow.name} could not be run.`;
      assistantContent = `**${workflow.name}** could not be run.\n\n${message}\n\n[Open automation settings](/workflows?workflow=${encodeURIComponent(workflow.id)})`;
    }
    await appendExternalAgentTurn({
      clientMessageId,
      userContent,
      assistantContent,
      outcome: "completed",
    });
  }, [appendExternalAgentTurn, previewExternalAgentTurn]);
}

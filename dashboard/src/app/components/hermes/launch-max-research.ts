// Starting a Max Research turn, from either chat surface.
//
// Shared rather than inlined twice. The Terminal keeps its own launcher for
// most agents because each one differs in what it carries, but this one is
// identical on both surfaces — one question, no attachments, no capability
// stacking — and two copies of the failure handling is two places for them to
// drift apart.
//
// The turn is recorded the moment the run starts rather than when it finishes.
// The card is where a person watches five agents work, and a chat that stayed
// empty until the end would hide the only part of an hour-long run they can act
// on while it happens.

import { maxResearchUserMessage } from "@/lib/max-research/identity.ts";
import type { UseAgentSessionResult } from "./use-agent-session";

/**
 * The session, by its own types rather than a structural copy of them.
 *
 * A hand-written shape here would compile until the session changed and then
 * silently stop matching, which is the drift this module exists to avoid.
 */
type LaunchSession = Pick<
  UseAgentSessionResult,
  "previewExternalAgentTurn" | "ensureConversation" | "appendExternalAgentTurn"
>;

export async function launchMaxResearchTurn(input: {
  session: LaunchSession;
  question: string;
  model: string;
  reasoningEffort: string;
  branchGroupId?: string;
  /**
   * The message to record, when it should not be the canonical command.
   *
   * Somebody who typed "…do max research" asked in their own words, and the
   * transcript has to keep them. Rewriting the message into
   * `/agents:max-research …` in front of the person is jarring — it looks like
   * the chat editing what they said — and Deep Research has always passed the
   * original through here for exactly that reason.
   */
  userContent?: string;
  /** Surfaced where the surface shows launch problems. */
  onStatus?: (message: string) => void;
}): Promise<void> {
  const { session, question } = input;
  const userContent = input.userContent?.trim() || maxResearchUserMessage(question);
  const clientMessageId = session.previewExternalAgentTurn({
    clientMessageId: crypto.randomUUID(),
    userContent,
    ...(input.branchGroupId ? { branchGroupId: input.branchGroupId } : {}),
  });

  let runStarted = false;
  try {
    await session.ensureConversation(clientMessageId);
    const response = await fetch("/api/max-research/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      run?: { runId?: unknown };
      error?: unknown;
      message?: unknown;
    };
    if (!response.ok || !data?.run?.runId) {
      throw new Error(
        typeof data?.message === "string"
          ? data.message
          : typeof data?.error === "string"
            ? data.error
            : "The Max Research run could not start.",
      );
    }
    runStarted = true;
    await session.appendExternalAgentTurn({
      clientMessageId,
      userContent,
      run: {
        kind: "max_research",
        runId: String(data.run.runId),
        query: question,
      },
      ...(input.branchGroupId ? { branchGroupId: input.branchGroupId } : {}),
    });
  } catch (cause) {
    // A run that started but whose turn could not be saved is still running:
    // saying it failed would be false, and the person would stop watching a
    // card that is about to produce an answer.
    if (runStarted) {
      input.onStatus?.(
        cause instanceof Error
          ? cause.message
          : "The Max Research run started, but its chat turn could not be saved.",
      );
      return;
    }
    try {
      await session.appendExternalAgentTurn({
        clientMessageId,
        userContent,
        assistantContent: `The Max Research run could not start: ${
          cause instanceof Error ? cause.message : "unknown error"
        }`,
        outcome: "failed",
        ...(input.branchGroupId ? { branchGroupId: input.branchGroupId } : {}),
      });
    } catch (persistenceError) {
      input.onStatus?.(
        persistenceError instanceof Error
          ? persistenceError.message
          : "The Max Research turn could not be saved.",
      );
    }
  }
}

import db from "../db.ts";
import {
  finishExternalAgentTurn,
  reconcileExternalAgentTerminalTiming,
} from "../conversations/external-agent-turns.ts";
import {
  getTerminalResult,
  setRunTerminalHandler,
  type MaxResearchTerminalResult,
} from "./runtime-run-manager.ts";

interface RunningMaxResearchTurn {
  conversationId: number;
  clientMessageId: string;
  runId: string;
  outcome: string;
}

function persistTerminalResult(
  turn: Pick<RunningMaxResearchTurn, "conversationId" | "clientMessageId">,
  result: MaxResearchTerminalResult,
): void {
  finishExternalAgentTurn({
    conversationId: turn.conversationId,
    clientMessageId: turn.clientMessageId,
    outcome: result.outcome,
    content: result.content,
    terminalAtMs: result.terminalAtMs,
  });
}

/** Keep a newly launched run attached to its transcript without a mounted card. */
export function observeMaxResearchConversationTurn(input: {
  userId: number;
  conversationId: number;
  clientMessageId: string;
  runId: string;
}): void {
  setRunTerminalHandler(input.userId, input.runId, async (result) => {
    try {
      persistTerminalResult(input, result);
    } catch {
      // Session reconciliation retries this idempotent write after transient
      // database or process failures.
    }
  });
}

function maxResearchTurns(input: {
  userId: number;
  conversationId?: number;
  runId?: string;
}): RunningMaxResearchTurn[] {
  const filters = [
    "conversation.user_id = ?",
    "message.role = 'assistant'",
    "json_extract(message.metadata, '$.externalAgentRun.kind') = 'max_research'",
  ];
  const values: Array<number | string> = [input.userId];
  if (input.conversationId !== undefined) {
    filters.push("message.conversation_id = ?");
    values.push(input.conversationId);
  }
  if (input.runId !== undefined) {
    filters.push("json_extract(message.metadata, '$.externalAgentRun.runId') = ?");
    values.push(input.runId);
  }
  return db.prepare(`
    SELECT
      message.conversation_id AS conversationId,
      message.client_message_id AS clientMessageId,
      json_extract(message.metadata, '$.externalAgentRun.runId') AS runId,
      json_extract(message.metadata, '$.externalAgentOutcome') AS outcome
    FROM conversation_messages AS message
    JOIN conversations AS conversation ON conversation.id = message.conversation_id
    WHERE ${filters.join(" AND ")}
  `).all(...values) as RunningMaxResearchTurn[];
}

async function reconcileTurns(
  userId: number,
  turns: readonly RunningMaxResearchTurn[],
): Promise<number> {
  let reconciled = 0;
  for (const turn of turns) {
    try {
      const result = await getTerminalResult(userId, turn.runId);
      if (!result) {
        if (turn.outcome === "running") {
          observeMaxResearchConversationTurn({ userId, ...turn });
        }
        continue;
      }
      if (turn.outcome === "running") {
        persistTerminalResult(turn, result);
      } else {
        reconcileExternalAgentTerminalTiming({
          conversationId: turn.conversationId,
          clientMessageId: turn.clientMessageId,
          terminalAtMs: result.terminalAtMs,
        });
      }
      reconciled += 1;
    } catch {
      // Loading a transcript must remain available during a transient runtime
      // control-plane failure. The next poll or load retries it.
    }
  }
  return reconciled;
}

/** Recover terminal work after the web process (and its observer) restarted. */
export async function reconcileMaxResearchConversation(
  userId: number,
  conversationId: number,
): Promise<number> {
  return reconcileTurns(userId, maxResearchTurns({ userId, conversationId }));
}

/**
 * Record that a person stopped the run, ahead of the runtime's own word on it.
 *
 * The runtime reports a cancelled job as `run.aborted` and every observer
 * turns that into the same "Stopped." — which cannot tell a Stop button from a
 * run cancelled underneath the person. The first terminal write on a turn
 * wins, so the abort route writes the reason before it asks the runtime to
 * cancel; the transcript then says who stopped it, and the row that delegated
 * can say "You stopped Max Research" rather than only that it stopped.
 */
export function markMaxResearchRunStoppedByUser(
  userId: number,
  runId: string,
): number {
  let sealed = 0;
  for (const turn of maxResearchTurns({ userId, runId })) {
    if (turn.outcome !== "running") continue;
    try {
      finishExternalAgentTurn({
        conversationId: turn.conversationId,
        clientMessageId: turn.clientMessageId,
        outcome: "aborted",
        content: MAX_RESEARCH_STOPPED_BY_USER,
      });
      sealed += 1;
    } catch {
      // A concurrent terminal event won the race; that result is already the
      // more authoritative one.
    }
  }
  return sealed;
}

/** Shared with the session abort route and the transcript's outcome note. */
export const MAX_RESEARCH_STOPPED_BY_USER = "Stopped by the user.";

/** Settle the transcript before an abort response releases the Stop control. */
export async function reconcileMaxResearchRun(
  userId: number,
  runId: string,
): Promise<MaxResearchTerminalResult | null> {
  const turns = maxResearchTurns({ userId, runId });
  const result = await getTerminalResult(userId, runId);
  if (!result) return null;
  for (const turn of turns) {
    if (turn.outcome === "running") persistTerminalResult(turn, result);
    else {
      reconcileExternalAgentTerminalTiming({
        conversationId: turn.conversationId,
        clientMessageId: turn.clientMessageId,
        terminalAtMs: result.terminalAtMs,
      });
    }
  }
  return result;
}

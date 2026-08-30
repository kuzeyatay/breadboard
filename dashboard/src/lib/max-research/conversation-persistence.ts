import db from "../db.ts";
import { finishExternalAgentTurn } from "../conversations/external-agent-turns.ts";
import {
  getTerminalResult,
  setRunTerminalHandler,
  type MaxResearchTerminalResult,
} from "./runtime-run-manager.ts";

interface RunningMaxResearchTurn {
  conversationId: number;
  clientMessageId: string;
  runId: string;
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

function runningTurns(input: {
  userId: number;
  conversationId?: number;
  runId?: string;
}): RunningMaxResearchTurn[] {
  const filters = [
    "conversation.user_id = ?",
    "message.role = 'assistant'",
    "json_extract(message.metadata, '$.externalAgentRun.kind') = 'max_research'",
    "json_extract(message.metadata, '$.externalAgentOutcome') = 'running'",
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
      json_extract(message.metadata, '$.externalAgentRun.runId') AS runId
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
        observeMaxResearchConversationTurn({ userId, ...turn });
        continue;
      }
      persistTerminalResult(turn, result);
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
  return reconcileTurns(userId, runningTurns({ userId, conversationId }));
}

/** Settle the transcript before an abort response releases the Stop control. */
export async function reconcileMaxResearchRun(
  userId: number,
  runId: string,
): Promise<MaxResearchTerminalResult | null> {
  const turns = runningTurns({ userId, runId });
  const result = await getTerminalResult(userId, runId);
  if (!result) return null;
  for (const turn of turns) persistTerminalResult(turn, result);
  return result;
}

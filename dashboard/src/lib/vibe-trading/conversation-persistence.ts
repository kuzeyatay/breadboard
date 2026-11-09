import type Database from "better-sqlite3";
import db from "../db.ts";
import { finishExternalAgentTurn } from "../conversations/external-agent-turns.ts";
import { observeOuterAgentRun, readOuterAgentRunView, type OuterAgentRunView } from "../runtime-v2/outer-agent-run.ts";

interface Owner { userId: number; conversationId: number }
interface Turn { conversationId: number; clientMessageId: string; runId: string }
const observed = new Set<string>();

function runningTurns(owner: Owner, database: Database.Database = db): Turn[] {
  return database.prepare(`
    SELECT message.conversation_id AS conversationId,
           message.client_message_id AS clientMessageId,
           json_extract(message.metadata, '$.externalAgentRun.runId') AS runId
    FROM conversation_messages AS message
    JOIN conversations AS conversation ON conversation.id = message.conversation_id
    WHERE conversation.user_id = ? AND conversation.id = ?
      AND message.role = 'assistant' AND json_valid(message.metadata)
      AND json_extract(message.metadata, '$.externalAgent') = 1
      AND json_extract(message.metadata, '$.externalAgentRun.kind') = 'vibe_trading'
      AND json_extract(message.metadata, '$.externalAgentOutcome') = 'running'
  `).all(owner.userId, owner.conversationId) as Turn[];
}

function persist(owner: Owner, runId: string, view: OuterAgentRunView): number {
  const outcome = view.status;
  if (!view.terminal || (outcome !== "completed" && outcome !== "failed" && outcome !== "aborted")) return 0;
  const ending = view.events.findLast(event => event.type === `run.${outcome}`);
  if (!ending) return 0;
  const summary = typeof ending.payload.summary === "string" ? ending.payload.summary.trim() : "";
  const error = typeof ending.payload.error === "string" ? ending.payload.error.trim() : "";
  const content = outcome === "completed" ? summary || "Vibe Trading finished without an answer."
    : error || summary || (outcome === "aborted" ? "Vibe Trading stopped." : "Vibe Trading could not complete this request.");
  const terminalAtMs = Date.parse(ending.at);
  let count = 0;
  // Recheck ownership and the attached run after the asynchronous Runtime read.
  // A cancelled turn or a replacement run must retain its own outcome.
  for (const turn of runningTurns(owner).filter(turn => turn.runId === runId)) {
    finishExternalAgentTurn({ conversationId: turn.conversationId, clientMessageId: turn.clientMessageId,
      outcome, content, ...(Number.isFinite(terminalAtMs) ? { terminalAtMs } : {}) });
    count += 1;
  }
  return count;
}

/** Persist the Runtime receipt even after the browser's run card unmounts. */
export function observeVibeTradingConversationTurn(input: Owner & { runId: string }): void {
  if (!runningTurns(input).some(turn => turn.runId === input.runId)) return;
  const key = `${input.userId}:${input.conversationId}:${input.runId}`;
  if (observed.has(key)) return;
  observed.add(key);
  observeOuterAgentRun("vibe-trading", input.userId, input.runId, view => {
    persist(input, input.runId, view);
    observed.delete(key);
  });
}

/** Recover after a dashboard restart using the selected owner's durable jobs. */
export async function reconcileVibeTradingConversation(userId: number, conversationId: number): Promise<number> {
  const owner = { userId, conversationId };
  let reconciled = 0;
  for (const runId of new Set(runningTurns(owner).map(turn => turn.runId))) {
    try {
      const view = await readOuterAgentRunView("vibe-trading", userId, runId, 0);
      reconciled += persist(owner, runId, view);
      if (!view.terminal) observeVibeTradingConversationTurn({ ...owner, runId });
    } catch {
      // Reading a saved chat remains possible while Runtime is unavailable.
      // A later load retries; missing evidence never turns into a success.
    }
  }
  return reconciled;
}

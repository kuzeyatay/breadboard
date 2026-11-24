import db from "../db.ts";
import { finishExternalAgentTurn } from "../conversations/external-agent-turns.ts";
import type { ExternalAgentTerminalOutcome } from "../conversations/external-agent-runs.ts";
import {
  OUTER_AGENT_RUNTIME_ADAPTERS,
  readOuterAgentRunView,
  type OuterAgentEvent,
} from "./outer-agent-run.ts";
import type { OuterAgentKind } from "./outer-agent-run-store.ts";

interface RunningOuterTurn {
  clientMessageId: string;
  kind: string;
  runId: string;
}

const OUTCOMES = new Set(["completed", "failed", "aborted"]);

/** Turn a finished run's events into what its inline card would have sealed. */
export function outerAgentTerminalResult(
  events: readonly OuterAgentEvent[],
  status: string | null,
): { outcome: ExternalAgentTerminalOutcome; content: string } {
  let result: string | null = null;
  let failure: string | null = null;
  let terminal: string | null = null;
  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === "run.result" && typeof payload.result === "string") result = payload.result;
    if (event.type === "run.failed" && typeof payload.message === "string") failure = payload.message;
    const name = event.type.replace(/^run\./, "");
    if (event.type.startsWith("run.") && OUTCOMES.has(name)) terminal = name;
  }
  const outcome = (terminal ?? (status && OUTCOMES.has(status) ? status : "failed")) as ExternalAgentTerminalOutcome;
  const content = outcome === "completed"
    ? result ?? "Completed."
    : failure ?? (outcome === "aborted" ? "The run was stopped." : "The run failed.");
  return { outcome, content };
}

/**
 * Seal delegated outer-agent turns whose job finished while nobody watched.
 *
 * Inline cards and in-memory terminal handlers are the normal sealers; both
 * vanish with a closed tab or a dashboard restart, which left finished runs
 * showing "Delegating to …" for days. The runtime job is the authority, so a
 * chat load reads it and seals what is already over. Idempotent.
 */
export async function reconcileOuterAgentConversation(
  userId: number,
  conversationId: number,
): Promise<number> {
  const turns = db.prepare(`
    SELECT
      client_message_id AS clientMessageId,
      json_extract(metadata, '$.externalAgentRun.kind') AS kind,
      json_extract(metadata, '$.externalAgentRun.runId') AS runId
    FROM conversation_message_reads
    WHERE conversation_id = ? AND role = 'assistant'
      AND json_extract(metadata, '$.externalAgentOutcome') = 'running'
      AND json_extract(metadata, '$.externalAgentRun.runId') LIKE 'job\\_%' ESCAPE '\\'
  `).all(conversationId) as RunningOuterTurn[];
  let sealed = 0;
  for (const turn of turns) {
    const kind = String(turn.kind ?? "").replace(/_/g, "-");
    if (!(kind in OUTER_AGENT_RUNTIME_ADAPTERS)) continue;
    try {
      const view = await readOuterAgentRunView(kind as OuterAgentKind, userId, turn.runId);
      if (!view.terminal) continue;
      finishExternalAgentTurn({
        conversationId,
        clientMessageId: turn.clientMessageId,
        ...outerAgentTerminalResult(view.events, view.status),
      });
      sealed += 1;
    } catch {
      // run_not_found (another owner, a pruned mapping) or a transient
      // runtime failure: leave the turn for its card or the next load.
    }
  }
  return sealed;
}

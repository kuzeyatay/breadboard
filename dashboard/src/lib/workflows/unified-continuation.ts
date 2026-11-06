import db from "../db.ts";
import { agentLaunchContinuationIds } from "../conversations/delegated-agent-provenance.ts";
import { externalAgentDisplayName, parseExternalAgentRun } from "../conversations/external-agent-runs.ts";
import { RUNTIME_AGENT_PROFILES } from "../hermes/capability-combinations.ts";
import { parseUnifiedWorkflowCommand, unifiedWorkflowSelectionAllows, type UnifiedWorkflowContinuation } from "./unified-command.ts";

interface MessageRow { client_message_id: string; role: string; status: string; order_index: number; content: string; metadata: string | null }
function object(value: string | null): Record<string, unknown> {
  try { const parsed = JSON.parse(value ?? "null"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}

/** Restore only a real, completed delegation in the currently authorized
 * workflow. The browser supplies a marker, never a workflow or an allowlist.
 * Durable origin/run/worker rows survive runtime replacement and app restart. */
export function resolveUnifiedWorkflowContinuation(input: {
  userId: number; conversationId: number; clientMessageId: string;
  continuationText: string; internalAgentContinuation?: boolean;
}): UnifiedWorkflowContinuation | null {
  if (!input.internalAgentContinuation) return null;
  const workerIds = agentLaunchContinuationIds(input.continuationText);
  if (!workerIds.length || workerIds.length > 4) return null;
  const current = db.prepare(`SELECT m.order_index FROM conversation_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id = ? AND c.user_id = ? AND m.client_message_id = ? AND m.role = 'user'`)
    .get(input.conversationId, input.userId, input.clientMessageId) as { order_index: number } | undefined;
  if (!current) return null;
  const origin = db.prepare(`SELECT * FROM conversation_messages
    WHERE conversation_id = ? AND role = 'user'
      AND COALESCE(json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.internalAgentContinuation'), 0) <> 1
      AND COALESCE(json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.delegatedAgentRun'), 0) <> 1
    ORDER BY order_index DESC LIMIT 1`).get(input.conversationId) as MessageRow | undefined;
  if (!origin || origin.order_index >= current.order_index) return null;
  let chosen: ReturnType<typeof parseUnifiedWorkflowCommand>;
  try { chosen = parseUnifiedWorkflowCommand(origin.content); } catch { return null; }
  if (!chosen || chosen.explicitAgentId) return null;
  const parent = db.prepare(`SELECT r.dispatch_json, r.status FROM hermes_runs r
    JOIN hermes_runtime_sessions s ON s.id = r.runtime_session_id
    WHERE s.conversation_id = ? AND s.user_id = ?
      AND json_extract(CASE WHEN json_valid(r.dispatch_json) THEN r.dispatch_json END, '$.clientMessageId') = ?
    ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`)
    .get(input.conversationId, input.userId, origin.client_message_id) as { dispatch_json: string; status: string } | undefined;
  if (parent?.status !== "completed") return null;
  const saved = object(parent?.dispatch_json ?? null).workflowSelection as UnifiedWorkflowContinuation["selection"] | undefined;
  if (!saved || saved.workflowId !== chosen.workflowId || saved.modeId !== chosen.modeId) return null;
  const selection = chosen.selection;
  const workers = db.prepare(`SELECT client_message_id, role, status, order_index, content, metadata
    FROM conversation_messages WHERE conversation_id = ? AND order_index > ? AND order_index < ?
      AND json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.delegatedAgentRun') = 1
      AND json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.externalAgent') = 1
    ORDER BY order_index`).all(input.conversationId, origin.order_index, current.order_index) as MessageRow[];
  const terminal = workers.filter((row) => row.role === "assistant" &&
    ["complete", "failed", "aborted"].includes(row.status) &&
    ["completed", "failed", "aborted"].includes(String(object(row.metadata).externalAgentOutcome)));
  if (!workerIds.every((id) => terminal.some((row) => {
    const run = parseExternalAgentRun(object(row.metadata).externalAgentRun);
    return run && (row.client_message_id === id || run.runId === id);
  }))) return null;
  const completedWork = terminal.flatMap((row) => {
    const metadata = object(row.metadata);
    if (row.status !== "complete" || metadata.externalAgentOutcome !== "completed") return [];
    const run = parseExternalAgentRun(metadata.externalAgentRun);
    const agent = run && RUNTIME_AGENT_PROFILES.find((item) => item.name === externalAgentDisplayName(run.kind));
    const brief = workers.find((item) => item.role === "user" && item.client_message_id === row.client_message_id)?.content;
    return agent && brief && unifiedWorkflowSelectionAllows(selection, agent.id) ? [{ agentId: agent.id, brief }] : [];
  });
  return { selection, originClientMessageId: origin.client_message_id, completedWork };
}

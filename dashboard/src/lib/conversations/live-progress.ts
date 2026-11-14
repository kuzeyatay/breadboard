import db from "../db.ts";

/** Keep the Thinking disclosure available to viewers restoring a running turn. */
export function persistAssistantProgress(input: {
  conversationId: number;
  clientMessageId: string;
  reasoning?: string;
  progressNotes?: readonly string[];
}): void {
  const metadata = {
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
    ...(input.progressNotes !== undefined ? { progressNotes: input.progressNotes } : {}),
  };
  // Only the pending assistant owns these updates. Late events must not alter
  // a completed/stopped response, its user message, or another concurrent turn.
  const patch = JSON.stringify(metadata);
  db.transaction(() => {
    const updated = db.prepare(`
      UPDATE conversation_messages
      SET metadata = json_patch(COALESCE((SELECT metadata FROM conversation_message_reads WHERE id=conversation_messages.id), '{}'), ?), updated_at = datetime('now')
      WHERE conversation_id = ? AND client_message_id = ?
        AND role = 'assistant' AND status = 'pending'
      RETURNING id
    `).get(patch, input.conversationId, input.clientMessageId) as { id: number } | undefined;
    if (!updated) return;

    // Garden tabs restore from chat_messages. Keep its progress in step with
    // the canonical row while the run is active, not just at finalization.
    // The shared transaction prevents a late checkpoint racing completion.
    db.prepare(`
      UPDATE chat_messages
      SET tool_calls = json_patch(COALESCE(tool_calls, '{}'), ?)
      WHERE canonical_message_id = ? AND role = 'assistant'
    `).run(patch, updated.id);
  }).immediate();
}


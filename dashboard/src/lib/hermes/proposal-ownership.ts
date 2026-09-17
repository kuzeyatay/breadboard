import type Database from "better-sqlite3";

/** Use the server-owned run's turn identity, never a message id from tool args. */
export function proposalAssistantMessageId(
  database: Database.Database,
  runtimeSessionId: number | null,
  userId: number | null,
): number | null {
  if (runtimeSessionId === null || userId === null) return null;
  const row = database.prepare(`
    SELECT CASE WHEN COUNT(DISTINCT m.id) = 1 THEN MIN(m.id) END AS id
      FROM hermes_runs r
      JOIN hermes_runtime_sessions s ON s.id = r.runtime_session_id
      JOIN conversations c ON c.id = s.conversation_id AND c.user_id = s.user_id
      JOIN conversation_messages m ON m.conversation_id = c.id
        AND m.role = 'assistant'
        AND m.client_message_id = json_extract(
          CASE WHEN json_valid(r.dispatch_json) THEN r.dispatch_json ELSE '{}' END,
          '$.clientMessageId')
     WHERE s.id = ? AND s.user_id = ? AND r.status = 'active'
  `).get(runtimeSessionId, userId) as { id: number | null };
  return row.id;
}

/** Add durable turn ownership and recover old proposals from recorded runs. */
export function ensureProposalOwnershipSchema(database: Database.Database): void {
  const columns = database.prepare("PRAGMA table_info(hermes_proposals)").all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === "assistant_message_id")) {
    database.exec(`ALTER TABLE hermes_proposals ADD COLUMN assistant_message_id
      INTEGER REFERENCES conversation_messages(id) ON DELETE SET NULL`);
  }
  // Proposals have second-precision timestamps; normalize both sides equally.
  // Only a unique recorded turn may own an old proposal. A later reply that
  // happens to mention its number is not evidence of creation.
  database.exec(`
    UPDATE hermes_proposals AS p
       SET assistant_message_id = (
         SELECT CASE WHEN COUNT(DISTINCT m.id) = 1 THEN MIN(m.id) END
           FROM hermes_runs r
           JOIN hermes_runtime_sessions s ON s.id = r.runtime_session_id
           JOIN conversations c ON c.id = s.conversation_id AND c.user_id = s.user_id
           JOIN conversation_messages m ON m.conversation_id = c.id
             AND m.role = 'assistant'
             AND m.client_message_id = json_extract(
               CASE WHEN json_valid(r.dispatch_json) THEN r.dispatch_json ELSE '{}' END,
               '$.clientMessageId')
          WHERE r.runtime_session_id = p.runtime_session_id
            AND s.user_id = p.created_by_user_id
            AND datetime(p.created_at) >= datetime(r.started_at)
            AND (datetime(p.created_at) <= datetime(r.finished_at)
                 OR (r.finished_at IS NULL AND r.status = 'active'))
       )
     WHERE p.assistant_message_id IS NULL;
  `);
}

import type Database from "better-sqlite3";

interface MessageIdentity {
  id?: string;
  clientMessageId?: string;
  externalAgentRun?: { runId: string };
}

/** Refuse a stale renderer's attempt to copy another chat's turns or workers. */
export function chatMessagesBelongToConversation(
  database: Database.Database,
  conversationId: number,
  userId: number,
  messages: readonly MessageIdentity[],
): boolean {
  const ids = messages.flatMap((message) =>
    /^msg_\d+$/.test(message.id ?? "") ? [Number(message.id!.slice(4))] : [],
  );
  const clientIds = messages.flatMap((message) => message.clientMessageId ? [message.clientMessageId] : []);
  const runIds = messages.flatMap((message) => message.externalAgentRun ? [message.externalAgentRun.runId] : []);
  const placeholders = (values: unknown[]) => values.map(() => "?").join(",");
  const identityConditions = [
    ...(ids.length ? [`m.id IN (${placeholders(ids)})`] : []),
    ...(clientIds.length ? [`m.client_message_id IN (${placeholders(clientIds)})`] : []),
  ];
  if (identityConditions.length && database.prepare(`
    SELECT 1 FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND m.conversation_id != ?
      AND (${identityConditions.join(" OR ")}) LIMIT 1
  `).get(userId, conversationId, ...ids, ...clientIds)) return false;
  if (runIds.length && database.prepare(`
    SELECT 1 FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ? AND m.conversation_id != ?
      AND CASE WHEN json_valid(m.metadata) THEN
        COALESCE(json_extract(m.metadata, '$.externalAgentRun.runId'),
                 json_extract(m.metadata, '$.toolCalls.externalAgentRun.runId')) END
          IN (${placeholders(runIds)}) LIMIT 1
  `).get(userId, conversationId, ...runIds)) return false;
  return true;
}

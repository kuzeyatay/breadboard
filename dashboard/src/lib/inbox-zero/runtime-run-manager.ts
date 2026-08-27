import { randomUUID } from "node:crypto";

import db from "../db.ts";
import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";

export type InboxZeroEvent = OuterAgentEvent;

export interface StartInboxZeroRuntimeRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly task: string;
  readonly conversationKey: string;
  readonly preferredEmail?: string;
  readonly allowActions: boolean;
  readonly chatmockBaseUrl: string;
  readonly model: string;
  readonly conversationPublicId?: string;
  readonly conversationContext?: string;
}

let chatSchemaReady = false;

function ensureChatSchema(): void {
  if (chatSchemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_v2_inbox_zero_chats (
      owner_user_id   INTEGER NOT NULL,
      conversation_key TEXT NOT NULL,
      upstream_chat_id TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      PRIMARY KEY (owner_user_id, conversation_key),
      UNIQUE (owner_user_id, upstream_chat_id)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_v2_inbox_zero_chats_updated
      ON runtime_v2_inbox_zero_chats(updated_at);
  `);
  chatSchemaReady = true;
}

function chatIdFor(userId: number, conversationKey: string): string {
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    !conversationKey.trim() ||
    conversationKey !== conversationKey.trim() ||
    Buffer.byteLength(conversationKey, "utf8") > 512 ||
    /[\u0000\r\n]/u.test(conversationKey)
  ) {
    throw new TypeError("Inbox Zero conversation authority is invalid.");
  }
  ensureChatSchema();
  const now = new Date().toISOString();
  const candidate = randomUUID();
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO runtime_v2_inbox_zero_chats
        (owner_user_id, conversation_key, upstream_chat_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_user_id, conversation_key)
      DO UPDATE SET updated_at = excluded.updated_at
    `).run(userId, conversationKey, candidate, now, now);
    const row = db.prepare(`
      SELECT upstream_chat_id
      FROM runtime_v2_inbox_zero_chats
      WHERE owner_user_id = ? AND conversation_key = ?
    `).get(userId, conversationKey) as { upstream_chat_id: string } | undefined;
    if (!row || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(row.upstream_chat_id)) {
      throw new Error("Inbox Zero chat correlation is invalid.");
    }
    db.prepare(`
      DELETE FROM runtime_v2_inbox_zero_chats
      WHERE rowid IN (
        SELECT rowid FROM runtime_v2_inbox_zero_chats
        ORDER BY updated_at DESC, rowid DESC
        LIMIT -1 OFFSET 1024
      )
    `).run();
    return row.upstream_chat_id;
  });
  return transaction.immediate();
}

/** Durable Next facade. The mailbox turn itself exists only in a fresh worker. */
export async function startRun(
  input: StartInboxZeroRuntimeRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  const runtimeChatId = chatIdFor(input.userId, input.conversationKey);
  return startOuterAgentRun({
    kind: "inbox-zero",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      task: input.task,
      conversationKey: input.conversationKey,
      runtimeChatId,
      preferredEmail: input.preferredEmail ?? null,
      allowActions: input.allowActions,
      chatmockBaseUrl: input.chatmockBaseUrl,
      model: input.model,
      conversationPublicId: input.conversationPublicId ?? null,
      conversationContext: input.conversationContext ?? "",
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<InboxZeroEvent[]> {
  return [...(await readOuterAgentRunView("inbox-zero", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("inbox-zero", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("inbox-zero", userId, runId);
}

// Removing one exchange — a message someone sent and the answer it produced —
// from a conversation's durable transcript.
//
// The transcript is append-only and branch-aware. A regenerated or edited turn
// does not replace the turn before it; it *hides* it, and the visible chat is a
// projection over the log (see `projectConversationBranchMessages`). So deleting
// the two rows the reader can see is not enough: whatever they were covering
// would surface in their place, and the exchange the reader asked to remove
// would be replaced by an older version of itself rather than disappearing.
//
// The delete is therefore defined by what the chat must look like afterwards:
// exactly the transcript that was on screen, minus that one exchange. Rows that
// resurface are removed too, repeatedly, until the projection stops changing.

import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  ConversationStoreError,
  type ConversationMessageRow,
  type ConversationRow,
} from "./store.ts";
import { projectConversationBranchMessages } from "./branch-history.ts";

export interface ConversationTurnDeletionPlan {
  /** Every `conversation_messages.id` this delete has to take with it. */
  messageIds: number[];
  /** The transcript that remains visible once those rows are gone. */
  remaining: ConversationMessageRow[];
}

function allConversationMessages(
  conversationId: number,
  database: Database.Database,
): ConversationMessageRow[] {
  return database
    .prepare(
      `SELECT * FROM conversation_messages
       WHERE conversation_id = ?
       ORDER BY order_index ASC`,
    )
    .all(conversationId) as ConversationMessageRow[];
}

/**
 * Work out which rows one turn's removal costs, without touching the database.
 *
 * Split from the delete itself because the caller has work to do in between:
 * an external agent run launched by the turn is a live process that only the
 * row about to be deleted remembers, so it has to be stopped while that row can
 * still be read.
 */
export function planConversationTurnDeletion(
  input: { conversation: ConversationRow; clientMessageId: string },
  database: Database.Database = db,
): ConversationTurnDeletionPlan {
  const rows = allConversationMessages(input.conversation.id, database);
  const visible = projectConversationBranchMessages(rows);
  const visibleIds = new Set(visible.map((row) => row.id));

  // A turn is a user row and the assistant row that answers it, sharing one
  // client message id. Only the visible pair can be named: a hidden variant is
  // not something the reader can point at.
  const target = rows.filter(
    (row) =>
      row.client_message_id === input.clientMessageId && visibleIds.has(row.id),
  );
  if (target.length === 0) {
    throw new ConversationStoreError(
      404,
      "turn_not_found",
      "That message is no longer part of this chat.",
    );
  }
  if (target.some((row) => row.status === "pending")) {
    throw new ConversationStoreError(
      409,
      "turn_active",
      "This chat is still answering that message. Stop the response first.",
    );
  }

  const removed = new Set(target.map((row) => row.id));
  // Each pass re-projects what is left and takes out anything the previous pass
  // un-hid. Bounded by the row count: every pass removes at least one row.
  for (let pass = 0; pass < rows.length; pass += 1) {
    const kept = rows.filter((row) => !removed.has(row.id));
    const resurfaced = projectConversationBranchMessages(kept).filter(
      (row) => !visibleIds.has(row.id),
    );
    if (resurfaced.length === 0) break;
    for (const row of resurfaced) removed.add(row.id);
  }

  const remaining = projectConversationBranchMessages(
    rows.filter((row) => !removed.has(row.id)),
  );
  return { messageIds: [...removed], remaining };
}

/**
 * Commit a plan. The legacy mirror rows are removed here rather than left to
 * the foreign key: it is declared `ON DELETE SET NULL`, so it would clear the
 * pointer and keep the copy, and Garden's legacy transcript would still show
 * the message this delete was asked to erase.
 */
export function deleteConversationMessages(
  messageIds: readonly number[],
  database: Database.Database = db,
): number {
  if (messageIds.length === 0) return 0;
  const placeholders = messageIds.map(() => "?").join(",");
  const remove = database.transaction((ids: readonly number[]) => {
    database
      .prepare(
        `DELETE FROM chat_messages WHERE canonical_message_id IN (${placeholders})`,
      )
      .run(...ids);
    database
      .prepare(
        `DELETE FROM hermes_messages WHERE canonical_message_id IN (${placeholders})`,
      )
      .run(...ids);
    return database
      .prepare(
        `DELETE FROM conversation_messages WHERE id IN (${placeholders})`,
      )
      .run(...ids).changes;
  });
  return remove(messageIds);
}

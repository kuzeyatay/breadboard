import type Database from "better-sqlite3";
import db from "../db.ts";
import type { HermesSurface } from "../hermes/config.ts";
import {
  completeAssistantMessage,
  ConversationStoreError,
  failAssistantMessage,
  getConversationMessageById,
  presentConversationMessage,
  reserveConversationTurn,
  type ConversationMessageRow,
  type ConversationRow,
} from "./store.ts";
import {
  parseExternalAgentActivity,
  parseExternalAgentEdits,
  parseExternalAgentState,
  parseExternalAgentRun,
  parseExternalAgentOutcome,
  parseExternalAgentStartedAt,
  externalAgentResponseDurationMs,
  type ExternalAgentActivityEntry,
  type ExternalAgentEdits,
  type ExternalAgentOutcome,
  type ExternalAgentRun,
  type ExternalAgentTerminalOutcome,
} from "./external-agent-runs.ts";
import type { ChatTokenUsage } from "../chat-token-usage.ts";
import {
  normalizeChatMessageAttachments,
  type ChatMessageAttachment,
} from "../chat-attachments.ts";
import {
  trackAgentRunFinished,
  trackAgentRunStarted,
} from "../plan/agent-tracking.ts";
import { scheduleMemoryProfileSynthesisForConversation } from "./memory-profile.ts";

const EXTERNAL_AGENT_MARKER = true;

export interface ExternalAgentTurn {
  userMessage: ConversationMessageRow;
  assistantMessage: ConversationMessageRow;
}

function metadataFor(
  run: ExternalAgentRun | undefined,
  outcome: ExternalAgentOutcome,
  branchGroupId?: string,
  attachments: readonly ChatMessageAttachment[] = [],
): Record<string, unknown> {
  return {
    externalAgent: EXTERNAL_AGENT_MARKER,
    ...(run ? { externalAgentRun: run } : {}),
    externalAgentOutcome: outcome,
    ...(branchGroupId ? { branchGroupId } : {}),
    ...(attachments.length
      ? {
          attachments,
          attachmentNames: attachments.map((attachment) => attachment.name),
        }
      : {}),
  };
}

function sameRun(left: ExternalAgentRun | null, right: ExternalAgentRun | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right ?? null);
}

/**
 * Store an external agent launch as a normal adjacent user/assistant turn.
 * The assistant slot is immediately terminal in the canonical store so a
 * long-running external job never blocks a regular Hermes turn.
 */
export function recordExternalAgentTurn(input: {
  conversation: ConversationRow;
  clientMessageId: string;
  surface: HermesSurface;
  userContent: string;
  assistantContent?: string;
  run?: ExternalAgentRun;
  outcome?: ExternalAgentOutcome;
  branchGroupId?: string;
  attachments?: ChatMessageAttachment[];
}, database: Database.Database = db): ExternalAgentTurn {
  const outcome = input.outcome ?? (input.run ? "running" : "failed");
  const metadata = metadataFor(
    input.run,
    outcome,
    input.branchGroupId,
    input.attachments,
  );
  const reserved = reserveConversationTurn({
    conversation: input.conversation,
    clientMessageId: input.clientMessageId,
    surface: input.surface,
    content: input.userContent,
    metadata,
  }, database);
  const createdNewTurn = reserved.assistantMessage.status === "pending";

  const storedMetadata = presentConversationMessage(reserved.userMessage).metadata;
  const storedRun = parseExternalAgentRun(storedMetadata.externalAgentRun);
  if (
    storedMetadata.externalAgent !== EXTERNAL_AGENT_MARKER ||
    !sameRun(storedRun, input.run)
  ) {
    throw new ConversationStoreError(
      409,
      "client_message_id_conflict",
      "That clientMessageId was already used for a different external agent turn.",
    );
  }

  let assistantMessage = reserved.assistantMessage;
  if (assistantMessage.status === "pending") {
    if (outcome === "failed" || outcome === "aborted") {
      assistantMessage = failAssistantMessage({
        conversationId: input.conversation.id,
        clientMessageId: input.clientMessageId,
        status: outcome,
        content: input.assistantContent ?? "",
        metadata,
      }, database);
    } else {
      assistantMessage = completeAssistantMessage({
        conversationId: input.conversation.id,
        clientMessageId: input.clientMessageId,
        content: input.assistantContent ?? "",
        metadata,
      }, database);
    }
  }

  // The board learns about the run here rather than in each agent's own
  // launcher: every `/agents:*` kind goes through this function, so one hook
  // covers all of them and a new agent is tracked without being taught to.
  //
  // Only on the real application database. A caller that injected its own
  // handle is a test, and its runs must not land on the developer's own board.
  if (createdNewTurn && input.run && outcome === "running" && database === db) {
    trackAgentRunStarted({
      userId: input.conversation.user_id,
      kind: input.run.kind,
      runId: input.run.runId,
      task: runTaskLabel(input.run) ?? input.userContent,
      conversationTitle: input.conversation.title,
    });
  }

  return { userMessage: reserved.userMessage, assistantMessage };
}

/**
 * Attach a delegated run (or a start failure) to the assistant turn that
 * requested it.
 *
 * This is deliberately different from a user-started external turn: there is
 * no synthetic `/agents:*` user message, because the user did not send one.
 * The existing assistant message becomes the durable owner of the background
 * run, but its visible content remains the Super Agent's own words.
 */
export function attachExternalAgentRun(input: {
  conversation: ConversationRow;
  clientMessageId: string;
  run?: ExternalAgentRun;
  outcome?: ExternalAgentOutcome;
  assistantContent?: string;
}, database: Database.Database = db): ConversationMessageRow {
  const outcome = input.outcome ?? (input.run ? "running" : "failed");
  let attachedNewRun = false;
  const attach = database.transaction(() => {
    const row = database.prepare(`
      SELECT * FROM conversation_messages
      WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
      LIMIT 1
    `).get(
      input.conversation.id,
      input.clientMessageId.trim(),
    ) as ConversationMessageRow | undefined;
    if (!row) {
      throw new ConversationStoreError(
        404,
        "turn_not_found",
        "The assistant turn for this delegated run was not found.",
      );
    }

    const metadata = presentConversationMessage(row).metadata;
    const currentRun = parseExternalAgentRun(metadata.externalAgentRun);
    if (currentRun && input.run && !sameRun(currentRun, input.run)) {
      throw new ConversationStoreError(
        409,
        "external_agent_run_conflict",
        "That assistant turn already owns a different external agent run.",
      );
    }
    const currentOutcome = parseExternalAgentOutcome(metadata.externalAgentOutcome);
    if (
      currentRun &&
      input.run &&
      sameRun(currentRun, input.run) &&
      currentOutcome &&
      currentOutcome !== "running" &&
      outcome === "running"
    ) {
      // The start request was replayed after its terminal callback won the
      // race. Never downgrade the durable result (or its saved card state)
      // back to a zombie running turn.
      return row;
    }
    // The Super Agent remains the visible speaker. The worker descriptor and
    // result live in metadata so attaching or finishing it can never replace
    // the assistant text, including after a transcript refresh.
    const storedDelegatedPreamble =
      typeof metadata.delegatedAgentPreamble === "string" &&
      metadata.delegatedAgentPreamble.trim()
        ? metadata.delegatedAgentPreamble
        : undefined;
    const delegatedAgentPreamble =
      storedDelegatedPreamble ?? (row.content.trim() ? row.content : undefined);
    const externalAgentStartedAt =
      parseExternalAgentStartedAt(metadata.externalAgentStartedAt) ??
      new Date().toISOString();
    const mergedMetadata = {
      ...metadata,
      externalAgent: EXTERNAL_AGENT_MARKER,
      ...(input.run ? { externalAgentRun: input.run } : {}),
      externalAgentOutcome: outcome,
      externalAgentStartedAt,
      delegatedAgentRun: true,
      ...(delegatedAgentPreamble ? { delegatedAgentPreamble } : {}),
      ...(outcome !== "running" && input.assistantContent !== undefined
        ? { externalAgentResult: input.assistantContent }
        : {}),
    };
    const status =
      outcome === "failed" || outcome === "aborted"
        ? outcome
        : row.status;
    database.prepare(`
      UPDATE conversation_messages
      SET content = ?, status = ?, metadata = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      row.content,
      status,
      JSON.stringify(mergedMetadata),
      row.id,
    );
    database.prepare(`
      UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `).run(input.conversation.id);
    const updated = getConversationMessageById(row.id, database)!;
    syncExternalAgentResult(updated, database);
    attachedNewRun = Boolean(input.run && !sameRun(currentRun, input.run));
    return updated;
  });
  const attached = attach.immediate();

  if (attachedNewRun && input.run && outcome === "running" && database === db) {
    trackAgentRunStarted({
      userId: input.conversation.user_id,
      kind: input.run.kind,
      runId: input.run.runId,
      task: runTaskLabel(input.run) ?? input.conversation.title,
      conversationTitle: input.conversation.title,
    });
  }
  return attached;
}

/**
 * The one-line description a run carries. Which field holds it depends on the
 * agent — most call it `task`, deep research calls it `query` — so the ones
 * that exist are tried in turn rather than the union being widened.
 */
function runTaskLabel(run: ExternalAgentRun): string | null {
  const candidate = run as Record<string, unknown>;
  for (const field of ["task", "query", "prompt", "title", "label"]) {
    const value = candidate[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/**
 * The assistant turn an external agent's run was launched from. The run works
 * in the background and produces its artifacts from there, so this is how a
 * blueprint or report finds the message it belongs to instead of landing in the
 * unassigned pile at the end of the transcript.
 */
export function findExternalAgentAssistantMessage(input: {
  conversationId: number;
  runId: string;
}, database: Database.Database = db): ConversationMessageRow | null {
  const runId = input.runId.trim();
  if (!runId) return null;
  const row = database.prepare(`
    SELECT * FROM conversation_messages
    WHERE conversation_id = ?
      AND role = 'assistant'
      AND json_extract(metadata, '$.externalAgentRun.runId') = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(input.conversationId, runId) as ConversationMessageRow | undefined;
  return row ?? null;
}

/**
 * Add a video fetched by an external agent to the user message that launched
 * the run.
 *
 * A pasted YouTube URL starts as text, so its blob id does not exist when the
 * turn is first recorded. Once Video Use has downloaded it, this promotes the
 * file to an ordinary message attachment. The shared message renderer, Uploads
 * panel, retry path and blob lifetime sweep can then treat a linked video
 * exactly like one the person dragged into the composer.
 *
 * The assistant row is used only to resolve the opaque run id back to its user
 * turn. Only the user row is changed: attachments belong to what the person
 * sent, not to the worker's response.
 */
export function attachVideoToExternalAgentUserTurn(input: {
  conversationId: number;
  runId: string;
  attachment: Extract<ChatMessageAttachment, { type: "video" }>;
}, database: Database.Database = db): ConversationMessageRow | null {
  const normalized = normalizeChatMessageAttachments([input.attachment]);
  const attachment = normalized.find(
    (candidate): candidate is Extract<ChatMessageAttachment, { type: "video" }> =>
      candidate.type === "video",
  );
  if (!attachment) return null;

  const update = database.transaction(() => {
    const userMessage = database.prepare(`
      SELECT user_message.*
      FROM conversation_messages AS user_message
      JOIN conversation_messages AS assistant_message
        ON assistant_message.conversation_id = user_message.conversation_id
       AND assistant_message.client_message_id = user_message.client_message_id
       AND assistant_message.role = 'assistant'
      WHERE user_message.conversation_id = ?
        AND user_message.role = 'user'
        AND json_extract(assistant_message.metadata, '$.externalAgentRun.runId') = ?
      LIMIT 1
    `).get(input.conversationId, input.runId.trim()) as ConversationMessageRow | undefined;
    if (!userMessage) return null;

    const metadata = presentConversationMessage(userMessage).metadata;
    const existing = normalizeChatMessageAttachments(metadata.attachments);
    const attachments = existing.some(
      (candidate) => candidate.type === "video" && candidate.blobId === attachment.blobId,
    )
      ? existing
      : [...existing, attachment];
    const mergedMetadata = {
      ...metadata,
      attachments,
      attachmentNames: attachments.map((candidate) => candidate.name),
    };
    const serialized = JSON.stringify(mergedMetadata);
    database.prepare(`
      UPDATE conversation_messages
      SET metadata = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(serialized, userMessage.id);
    database.prepare(`
      UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `).run(input.conversationId);

    // Garden chat keeps a compatibility copy. The Terminal has no legacy row,
    // but keeping this in step makes the primitive correct for either surface.
    database.prepare(`
      UPDATE chat_messages
      SET tool_calls = ?
      WHERE canonical_message_id = ? AND role = 'user'
    `).run(serialized, userMessage.id);
    return getConversationMessageById(userMessage.id, database);
  });
  return update.immediate();
}

/**
 * Finalize only turns created by recordExternalAgentTurn. Replayed terminal
 * events are idempotent, and an expired runtime cannot overwrite a result that
 * was already stored.
 */
export function finishExternalAgentTurn(input: {
  conversationId: number;
  clientMessageId: string;
  outcome: ExternalAgentTerminalOutcome;
  content: string;
  usage?: ChatTokenUsage;
  /** What the agent did, kept with the turn so a reload can still show it. */
  activity?: ExternalAgentActivityEntry[];
  /** Snapshots bracketing the run, so its edits stay reviewable and undoable. */
  edits?: ExternalAgentEdits;
  /** Card presentation state that must survive after the in-memory run expires. */
  state?: Record<string, unknown>;
}, database: Database.Database = db): ConversationMessageRow {
  // Set inside the transaction when this is a replayed terminal event, so the
  // board is not told twice about a run that finished once.
  let replayed = false;
  const finish = database.transaction(() => {
    const row = database.prepare(`
      SELECT * FROM conversation_messages
      WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'
    `).get(
      input.conversationId,
      input.clientMessageId.trim(),
    ) as ConversationMessageRow | undefined;
    if (!row) {
      throw new ConversationStoreError(404, "turn_not_found", "Conversation turn not found.");
    }

    const metadata = presentConversationMessage(row).metadata;
    if (metadata.externalAgent !== EXTERNAL_AGENT_MARKER) {
      throw new ConversationStoreError(
        409,
        "not_external_agent_turn",
        "That conversation turn does not belong to an external agent.",
      );
    }
    const currentOutcome = parseExternalAgentOutcome(metadata.externalAgentOutcome);
    if (currentOutcome && currentOutcome !== "running") {
      syncExternalAgentResult(row, database);
      replayed = true;
      return row;
    }

    const activity = parseExternalAgentActivity(
      input.activity ?? metadata.externalAgentActivity,
    );
    const edits = parseExternalAgentEdits(
      input.edits ?? metadata.externalAgentEdits,
    );
    const state = parseExternalAgentState(
      input.state ?? metadata.externalAgentState,
    );
    const completedAtMs = Date.now();
    const responseDurationMs = externalAgentResponseDurationMs({
      baseDurationMs:
        typeof metadata.responseDurationMs === "number"
          ? metadata.responseDurationMs
          : Number(metadata.responseDurationMs),
      startedAt: parseExternalAgentStartedAt(metadata.externalAgentStartedAt),
      endedAtMs: completedAtMs,
    });
    const mergedMetadata = {
      ...metadata,
      externalAgentOutcome: input.outcome,
      ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
      ...(metadata.delegatedAgentRun === true
        ? { externalAgentResult: input.content }
        : {}),
      ...(activity.length ? { externalAgentActivity: activity } : {}),
      ...(edits ? { externalAgentEdits: edits } : {}),
      ...(state ? { externalAgentState: state } : {}),
    };
    const status = input.outcome === "completed" ? "complete" : input.outcome;
    database.prepare(`
      UPDATE conversation_messages
      SET content = ?, status = ?, metadata = ?, token_usage = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      metadata.delegatedAgentRun === true ? row.content : input.content,
      status,
      JSON.stringify(mergedMetadata),
      input.usage === undefined ? null : JSON.stringify(input.usage),
      row.id,
    );
    database.prepare(`
      UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `).run(input.conversationId);
    const completed = getConversationMessageById(row.id, database)!;
    syncExternalAgentResult(completed, database);
    return completed;
  });
  const finished = finish.immediate();

  if (!replayed && input.outcome === "completed" && database === db) {
    scheduleMemoryProfileSynthesisForConversation({
      conversationId: input.conversationId,
      outcome: "completed",
    });
  }

  // Outside the transaction on purpose: the board is bookkeeping about the run,
  // not part of the record of it, and it must never hold the turn's write open
  // or roll it back.
  if (!replayed && database === db) {
    const run = parseExternalAgentRun(
      presentConversationMessage(finished).metadata.externalAgentRun,
    );
    const owner = database
      .prepare("SELECT user_id FROM conversations WHERE id = ?")
      .get(input.conversationId) as { user_id: number } | undefined;
    if (run && owner) {
      trackAgentRunFinished({
        userId: owner.user_id,
        runId: run.runId,
        outcome: input.outcome,
        // A finished run's answer is already in the transcript; repeating it on
        // the card would be noise. A failure's message is the useful part.
        summary: input.outcome === "completed" ? null : input.content,
      });
    }
  }
  return finished;
}

/** Keep both legacy chat projections current even when no browser is watching. */
function syncExternalAgentResult(
  message: ConversationMessageRow,
  database: Database.Database,
): void {
  database.prepare(`
    UPDATE chat_messages
    SET content = ?, token_usage = ?, tool_calls = ?, runtime_status = ?
    WHERE canonical_message_id = ? AND role = 'assistant'
  `).run(
    message.content,
    message.token_usage,
    message.metadata,
    message.status,
    message.id,
  );
  database.prepare(`
    UPDATE chat_sessions
    SET updated_at = datetime('now')
    WHERE id IN (
      SELECT session_id FROM chat_messages WHERE canonical_message_id = ?
    )
  `).run(message.id);
  database.prepare(`
    UPDATE hermes_messages
    SET content = ?, token_usage = ?, tool_calls = ?, runtime_status = ?
    WHERE canonical_message_id = ? AND role = 'assistant'
  `).run(
    message.content,
    message.token_usage,
    message.metadata,
    message.status,
    message.id,
  );
}

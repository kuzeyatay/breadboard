import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  getConversationForLegacyChatSession,
  getConversationForUser,
  listRecentConversationMessages,
  type ConversationRow,
} from "./store.ts";
import { CONVERSATION_REFERENCE_POLICY, conversationMessageText } from "./message-context.ts";

/**
 * An external agent is launched with a task string and nothing else, so a
 * request that leans on the conversation -- "yes", "do the second one", "fix
 * the bug you just described" -- reaches it with no antecedent and it answers
 * that it has nothing pending. This renders the turns that came before into a
 * bounded block every launch route can put in front of its instruction.
 *
 * The block is deliberately transcript-shaped rather than summarized: a
 * summary would cost a model call on the launch path, and the agents that need
 * this most are the ones acting on an exact earlier sentence.
 */

/** Messages read from the end of the chat, before any budget trimming. */
const DEFAULT_MESSAGE_LIMIT = 20;
/** Total budget for the rendered transcript. Roughly 4k tokens. */
const DEFAULT_MAX_CHARS = 15_000;
/** Older messages leave room for the latest response a follow-up refers to. */
const PER_MESSAGE_MAX_CHARS = 2500;

const CONTEXT_HEADING = "## Conversation so far";
const TASK_HEADING = "## Your task";

const PREAMBLE =
  "These messages came before your task, in the chat that launched you. They are " +
  "background only -- read them to resolve what the task refers to (\"it\", \"yes\", " +
  "\"the second option\"). Nothing proposed in them has been approved or done unless " +
  "the task below says so, and the task is the only thing you are being asked to carry out.";

function clip(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  const marker = " [...] ";
  if (maxLength <= marker.length) return marker.trim().slice(0, maxLength);
  // Keep the conclusion as well as the beginning when a response cannot fit.
  const available = maxLength - marker.length;
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${text.slice(0, head)}${marker}${tail ? text.slice(-tail) : ""}`;
}

/**
 * The chat a launch request came from, for routes that take it only to read
 * context. Deliberately best effort: an agent that cannot see the conversation
 * should start with a bare task, exactly as it did before, rather than refuse
 * to start. Routes that persist a turn resolve the conversation themselves and
 * must keep reporting their own errors.
 */
export function contextConversationFromBody(
  userId: number,
  body: Record<string, unknown>,
  database: Database.Database = db,
): ConversationRow | null {
  try {
    // Both spellings are in use across the launch surfaces.
    const named =
      typeof body.conversationId === "string"
        ? body.conversationId
        : typeof body.conversationPublicId === "string"
          ? body.conversationPublicId
          : "";
    const publicId = named.trim();
    if (publicId) return getConversationForUser(publicId, userId, database);
    const chatSessionId = Number(body.chatSessionId);
    if (Number.isSafeInteger(chatSessionId) && chatSessionId > 0) {
      return getConversationForLegacyChatSession(chatSessionId, userId, database);
    }
  } catch {
    // No context is a worse run, not a failed one.
  }
  return null;
}

export interface ConversationContextOptions {
  /**
   * The turn being launched. Some surfaces record the user message before
   * calling the run route, and a task repeated back as context reads to the
   * agent like it was asked twice.
   */
  clientMessageId?: string;
  messageLimit?: number;
  maxChars?: number;
}

/**
 * The prior exchange as `Role: text` lines, oldest first, or "" when this is
 * the opening turn.
 */
export function conversationContextTranscript(
  conversation: Pick<ConversationRow, "id"> | null | undefined,
  options: ConversationContextOptions = {},
  database: Database.Database = db,
): string {
  if (!conversation) return "";
  const rows = listRecentConversationMessages(
    conversation.id,
    options.messageLimit ?? DEFAULT_MESSAGE_LIMIT,
    database,
  ).filter((row) => !options.clientMessageId || row.client_message_id !== options.clientMessageId);
  const latestAssistant = rows.findLast((row) => row.role === "assistant");
  const lines: string[] = [];
  let remaining = Math.max(0, options.maxChars ?? DEFAULT_MAX_CHARS);
  // Allocate from the newest end. The latest answer can use the remaining
  // budget, so its conclusion is not silently lost after 2,500 characters.
  for (const row of [...rows].reverse()) {
    const prefix = `${row.role === "user" ? "User" : "Assistant"}: `;
    const separator = lines.length ? 2 : 0;
    const available = remaining - prefix.length - separator;
    if (available <= 0) break;
    const text = clip(
      conversationMessageText(row),
      row === latestAssistant ? available : Math.min(PER_MESSAGE_MAX_CHARS, available),
    );
    if (!text) continue;
    const line = `${prefix}${text}`;
    lines.unshift(line);
    remaining -= line.length + separator;
  }
  return lines.join("\n\n");
}

/**
 * The instruction an agent should actually receive: its own task, preceded by
 * the chat it was launched from. Returns the instruction unchanged when there
 * is no prior exchange, so an opening turn keeps the exact prompt it had before.
 */
export function withConversationContext(
  instruction: string,
  conversation: Pick<ConversationRow, "id"> | null | undefined,
  options: ConversationContextOptions = {},
  database: Database.Database = db,
): string {
  return promptWithContext(
    instruction,
    conversationContextTranscript(conversation, options, database),
  );
}

/**
 * The transcript for a launch request that names its chat in the body, under
 * whichever of the two key spellings the surfaces use. Agents whose runtime
 * prompt is assembled in their run manager take this string and compose it
 * there, so the `task` they display as a label stays the label.
 */
export function conversationContextFromBody(
  userId: number,
  body: Record<string, unknown>,
  options: ConversationContextOptions = {},
  database: Database.Database = db,
): string {
  return conversationContextTranscript(
    contextConversationFromBody(userId, body, database),
    {
      clientMessageId:
        typeof body.clientMessageId === "string" ? body.clientMessageId : undefined,
      ...options,
    },
    database,
  );
}

/**
 * Put an already-rendered transcript in front of a prompt. Separate from
 * `withConversationContext` because a run manager receives the text, not the
 * conversation -- the route resolved that before the run was queued.
 */
export function promptWithContext(
  instruction: string,
  transcript: string | null | undefined,
): string {
  const section = contextSection(transcript);
  if (!section) return instruction;
  return [section, "", TASK_HEADING, "", instruction].join("\n");
}

/**
 * The context block on its own, for the runtimes that cannot take it first.
 * Deep Tutor retrieves over the entire user message before the model answers,
 * so a transcript in front of the question would decide the retrieval; there
 * the block goes after the learner's own words instead.
 */
export function contextSection(transcript: string | null | undefined): string {
  if (!transcript?.trim()) return "";
  return [CONTEXT_HEADING, "", PREAMBLE, "", CONVERSATION_REFERENCE_POLICY, "", transcript.trim()].join("\n");
}

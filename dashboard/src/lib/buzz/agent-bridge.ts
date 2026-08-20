// How a room member speaks.
//
// A Buzz room is many-to-many; the agent pipeline is one-to-one. This module is
// the join between them, and it deliberately reimplements none of the pipeline:
// each agent member owns a private conversation, a turn is started on it the
// same way the Terminal starts one, and the answer is mirrored back into the
// room transcript.
//
// Mirroring happens on read (`reconcileLiveMessages`) rather than in a
// background worker. The turn API is fire-and-forget — it returns a run id and
// the answer lands in `conversation_messages` later — so a reconciliation that
// runs whenever the room is fetched is both simpler and self-healing: a server
// restart mid-answer costs nothing, because the next read still finds the
// finished message and copies it across.

import "server-only";

import db from "@/lib/db";
import {
  createConversation,
  listConversationMessages,
  type ConversationRow,
} from "@/lib/conversations/store.ts";
import { startConversationTurn } from "@/lib/conversations/turn-service.ts";
import { loadAgencyAgentsCatalog } from "@/lib/hermes/agency-agents.ts";
import {
  getMember,
  listMembers,
  listSpineMessages,
  listThreadMessages,
  postMessage,
  setMemberConversation,
  updateMessageBody,
} from "./instance.ts";
import type { BuzzMember, BuzzMessage, BuzzRoom } from "./store.ts";

// The room's routing rule lives in `mentions.ts`, which touches neither the
// database nor a model so it can be exercised directly. Re-exported here so
// callers have one import for "post a message and wake whoever it names".
export { mentionedHandles, resolveResponders } from "./mentions.ts";

/** How much of the room a member is shown before it answers. */
const TRANSCRIPT_DEPTH = 40;

/**
 * The private conversation an agent member thinks in for one room, created on
 * first need and reused afterwards so the persona keeps continuity here.
 */
export function ensureMemberConversation(
  room: BuzzRoom,
  member: BuzzMember,
  fallbackUserId: number,
): ConversationRow {
  if (member.conversationId) {
    const existing = db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(member.conversationId) as ConversationRow | undefined;
    if (existing) return existing;
  }

  // The room's creator owns the agent's private conversation, not whoever
  // happened to speak: the member is the room's, and several people share it.
  // Were it owned by the asker, the same agent would keep one memory per
  // colleague and answer each of them from a different history.
  const conversation = createConversation({
    userId: room.createdByUserId ?? fallbackUserId,
    title: `${member.displayName} in #${room.slug}`,
    surface: "dashboard_terminal",
    scopeKind: "global",
  });
  // The marker that keeps this out of the account's chat sidebar. Set here
  // rather than in `createConversation` so the canonical store stays unaware
  // of Buzz.
  db.prepare("UPDATE conversations SET buzz_room_id = ? WHERE id = ?").run(
    room.id,
    conversation.id,
  );
  setMemberConversation(member.id, conversation.id);
  return { ...conversation, buzz_room_id: room.id } as ConversationRow;
}

function personaInstructions(slug: string | null): string {
  if (!slug) return "";
  const catalog = loadAgencyAgentsCatalog();
  const agent = catalog.agents.find((candidate) => candidate.slug === slug);
  return agent?.instructions ?? "";
}

function renderTranscript(messages: readonly BuzzMessage[]): string {
  return messages
    .filter((message) => message.deletedAt === null && message.body.trim() !== "")
    .map((message) => {
      const who =
        message.authorKind === "human"
          ? `${message.authorName} (you are talking to this person)`
          : message.authorName;
      return `${who}: ${message.body}`;
    })
    .join("\n\n");
}

/**
 * The message an agent member is actually sent.
 *
 * A room is not a private chat, so the member is told plainly that others can
 * read what it says, who they are, and how to bring one of them in. Without
 * that it writes as though answering a direct question and the room reads like
 * four parallel one-to-one chats.
 */
export function buildRoomPrompt(input: {
  room: BuzzRoom;
  member: BuzzMember;
  members: readonly BuzzMember[];
  transcript: readonly BuzzMessage[];
  trigger: BuzzMessage;
  inThread: boolean;
}): string {
  const { room, member, members, transcript, trigger, inThread } = input;

  const roster = members
    .filter((candidate) => candidate.id !== member.id)
    .map((candidate) =>
      candidate.kind === "human"
        ? `@${candidate.handle} — ${candidate.displayName}, a person`
        : `@${candidate.handle} — ${candidate.displayName}`,
    )
    .join("\n");

  const instructions = personaInstructions(member.personaSlug);

  return [
    `You are ${member.displayName}, a member of the Buzz room #${room.slug}.`,
    "This room can hold several people as well as several agents.",
    room.topic ? `The room's topic is: ${room.topic}` : "",
    instructions ? `\nYour brief:\n${instructions}` : "",
    roster
      ? `\nAlso in this room:\n${roster}`
      : "\nYou are alone in this room with the person you are talking to.",
    "\nHow this room works:",
    "- Everything you write is posted into the shared transcript. Every member reads it — the other people as well as the other agents.",
    "- More than one person may be talking. Answer the message you were given, and address people by name when it is not obvious who you mean.",
    "- Write one message, as yourself, in your own voice. Do not narrate other members or write their lines.",
    `- To bring in another member, mention them by handle — writing @handle notifies them and they will answer next.`,
    "- Keep it to what a person would actually post in a chat room. No sign-off, no restating the question.",
    inThread
      ? "- You are replying inside a thread, so you can assume the root message as context."
      : "",
    transcript.length > 0
      ? `\nRecent messages in the room:\n\n${renderTranscript(transcript)}`
      : "",
    `\nThe message you are answering, from ${trigger.authorName}:\n\n${trigger.body}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export interface StartMemberReplyResult {
  message: BuzzMessage;
  accepted: boolean;
  reason?: string;
}

/**
 * Post a placeholder for a member's reply and start the turn that fills it.
 *
 * The placeholder exists before the model is called so the room shows the
 * member as answering immediately, and so a reload has a row to re-attach to.
 */
export async function startMemberReply(input: {
  room: BuzzRoom;
  memberId: number;
  trigger: BuzzMessage;
  clientMessageId: string;
  /** Used only if the room has outlived the account that created it. */
  actingUserId: number;
}): Promise<StartMemberReplyResult> {
  const { room, trigger, clientMessageId } = input;
  const member = getMember(input.memberId);
  if (!member || member.roomId !== room.id || member.kind !== "agent") {
    throw new Error("member_not_in_room");
  }

  const members = listMembers(room.id);
  const inThread = trigger.parentId !== null;
  const transcript = inThread
    ? listThreadMessages(room.id, trigger.parentId as number)
    : listSpineMessages(room.id, TRANSCRIPT_DEPTH);

  const conversation = ensureMemberConversation(room, member, input.actingUserId);
  const prompt = buildRoomPrompt({
    room,
    member,
    members,
    // The trigger is rendered separately; showing it twice makes the model
    // answer it twice.
    transcript: transcript.filter((message) => message.id !== trigger.id),
    trigger,
    inThread,
  });

  const placeholder = postMessage(room.id, {
    clientMessageId,
    memberId: member.id,
    authorKind: "agent",
    authorName: member.displayName,
    authorHandle: member.handle,
    personaSlug: member.personaSlug,
    body: "",
    parentId: trigger.parentId ?? null,
    status: "pending",
    metadata: {
      conversationId: conversation.id,
      turnClientMessageId: clientMessageId,
      respondingTo: trigger.id,
    },
  });

  try {
    const result = await startConversationTurn({
      conversation,
      clientMessageId,
      text: prompt,
      surface: "dashboard_terminal",
      // A room member answers with the tools and memory it would have anywhere
      // else; nothing about Buzz narrows that.
      yoloMode: true,
      ...(member.model ? { model: member.model } : {}),
    });

    if (!result.accepted) {
      const reason =
        "blocked" in result
          ? "awaiting_permission"
          : "clarified" in result
            ? "clarified"
            : "replayed";
      updateMessageBody(placeholder.id, "", "pending", {
        conversationId: conversation.id,
        turnClientMessageId: clientMessageId,
        respondingTo: trigger.id,
        turnReason: reason,
      });
      return { message: placeholder, accepted: false, reason };
    }

    updateMessageBody(placeholder.id, "", "streaming", {
      conversationId: conversation.id,
      turnClientMessageId: clientMessageId,
      respondingTo: trigger.id,
      runId: result.run.id,
    });
    return { message: placeholder, accepted: true };
  } catch (error) {
    updateMessageBody(
      placeholder.id,
      error instanceof Error ? error.message : "The turn could not be started.",
      "failed",
    );
    return {
      message: placeholder,
      accepted: false,
      reason: error instanceof Error ? error.message : "turn_failed",
    };
  }
}

/**
 * Copy whatever the agent pipeline has produced into the room transcript.
 *
 * Called on every room read. A message that is still being written gets its
 * text so far; one that finished gets its final text and status. Nothing here
 * writes back into the conversation store — the room is downstream of it.
 */
export function reconcileLiveMessages(roomId: number): void {
  const live = db
    .prepare(
      `SELECT id, metadata FROM buzz_room_messages
       WHERE room_id = ? AND status IN ('pending','streaming')`,
    )
    .all(roomId) as Array<{ id: number; metadata: string | null }>;

  for (const row of live) {
    if (!row.metadata) continue;
    let meta: { conversationId?: number; turnClientMessageId?: string };
    try {
      meta = JSON.parse(row.metadata) as typeof meta;
    } catch {
      continue;
    }
    if (!meta.conversationId || !meta.turnClientMessageId) continue;

    const answer = db
      .prepare(
        `SELECT content, status FROM conversation_messages
         WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`,
      )
      .get(meta.conversationId, meta.turnClientMessageId) as
      | { content: string; status: string }
      | undefined;
    if (!answer) continue;

    const status =
      answer.status === "complete"
        ? "complete"
        : answer.status === "failed"
          ? "failed"
          : answer.status === "aborted"
            ? "aborted"
            : "streaming";

    // A finished-but-empty answer is a failure the room has to show; leaving it
    // `complete` would render a member posting a blank line.
    if (status === "complete" && answer.content.trim() === "") {
      updateMessageBody(row.id, "(no answer)", "failed");
      continue;
    }
    updateMessageBody(row.id, answer.content, status);
  }
}

/**
 * Messages listed with their live state already reconciled. The single entry
 * point the API uses, so no route can forget to reconcile first.
 */
export function readRoomSpine(roomId: number, limit?: number): BuzzMessage[] {
  reconcileLiveMessages(roomId);
  return listSpineMessages(roomId, limit);
}

export function readRoomThread(roomId: number, parentId: number): BuzzMessage[] {
  reconcileLiveMessages(roomId);
  return listThreadMessages(roomId, parentId);
}

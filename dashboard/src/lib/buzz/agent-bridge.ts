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
import { randomUUID } from "node:crypto";
import { roomRuntime } from "./runtime-catalog.ts";
import { startRoomRuntime, roomRuntimeEvents, runtimeOutput } from "./runtime-agents.ts";
import { recordExternalAgentTurn, finishExternalAgentTurn } from "../conversations/external-agent-turns.ts";
import { listRuntimeSessionsForConversation } from "../hermes/runtime-store.ts";
import { cancelRuntimeSessionWork } from "../hermes/session-cancel.ts";
import { cancelRunningExternalAgentRuns, cancelExternalAgentRun } from "../conversations/external-agent-cancel.ts";

import db from "@/lib/db";
import {
  createConversation,
  type ConversationRow,
} from "@/lib/conversations/store.ts";
import { startConversationTurn } from "@/lib/conversations/turn-service.ts";
import { loadAgencyAgentsCatalog } from "@/lib/hermes/agency-agents.ts";
import { BREAD_INSTRUCTIONS, isBreadSlug } from "./bread.ts";
import {
  getMember,
  getMessage,
  getMessageByClientId,
  listMembers,
  listSpineMessages,
  listThreadMessages,
  postMessage,
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
 * Runtime state belongs to the account requesting the work. The shared room
 * supplies context; colleagues never share another account's tools or permissions.
 */
export function ensureMemberConversation(
  room: BuzzRoom,
  member: BuzzMember,
  actingUserId: number,
): ConversationRow {
  const existing = db.prepare(`SELECT c.* FROM buzz_member_conversations b
    JOIN conversations c ON c.id = b.conversation_id
    WHERE b.member_id = ? AND b.user_id = ? AND c.user_id = ?`).get(member.id, actingUserId, actingUserId) as ConversationRow | undefined;
  if (existing) return existing;
  return db.transaction(() => {
    const conversation = createConversation({ userId: actingUserId, title: `${member.displayName} in #${room.slug}`, surface: "dashboard_terminal", scopeKind: "global" });
    db.prepare("UPDATE conversations SET buzz_room_id = ? WHERE id = ?").run(room.id, conversation.id);
    db.prepare("INSERT INTO buzz_member_conversations(member_id, user_id, conversation_id) VALUES (?, ?, ?)").run(member.id, actingUserId, conversation.id);
    return conversation;
  })();
}

function personaInstructions(slug: string | null): string {
  if (!slug) return "";
  // Bread has no catalog file — being the un-narrowed runtime is the whole
  // point of it — so its brief is stated rather than loaded.
  if (isBreadSlug(slug)) return BREAD_INSTRUCTIONS;
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
    `You are ${member.displayName}, a member of the shared Organization room #${room.slug}.`,
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
    `- To bring in another member, mention them by handle — writing @handle addresses them. Only a person can start another agent; do not promise an automatic hand-off.`,
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
  actingUserId: number;
  request?: Request;
  replaceMessageId?: number;
  confirmedPermissionIds?: string[];
}): Promise<StartMemberReplyResult> {
  const { room, trigger } = input;
  const approvingMessage = input.confirmedPermissionIds?.length && input.replaceMessageId ? getMessage(input.replaceMessageId) : null;
  const clientMessageId = approvingMessage ? String(approvingMessage.metadata?.turnClientMessageId) : input.replaceMessageId ? `buzz_regen_${randomUUID()}` : `buzz_reply_${trigger.id}_${input.memberId}`;
  const previous = input.replaceMessageId ? null : getMessageByClientId(room.id, clientMessageId);
  if (previous) return { message: previous, accepted: false, reason: "replayed" };
  const member = getMember(input.memberId);
  if (!member || member.roomId !== room.id || member.kind !== "agent") {
    throw new Error("member_not_in_room");
  }

  const members = listMembers(room.id);
  const inThread = trigger.parentId !== null;
  const transcript = inThread
    ? [getMessage(trigger.parentId as number), ...listThreadMessages(room.id, trigger.parentId as number)].filter((message): message is BuzzMessage => message !== null)
    : listSpineMessages(room.id, TRANSCRIPT_DEPTH);

  const conversation = ensureMemberConversation(room, member, input.actingUserId);
  const builtPrompt = buildRoomPrompt({
    room,
    member,
    members,
    // The trigger is rendered separately; showing it twice makes the model
    // answer it twice.
    transcript: transcript.filter((message) => message.id !== trigger.id),
    trigger,
    inThread,
  });

  const originalPrompt = approvingMessage ? db.prepare("SELECT content FROM conversation_messages WHERE conversation_id = ? AND client_message_id = ? AND role = 'user'").get(conversation.id, clientMessageId) as { content: string } | undefined : undefined;
  const prompt = originalPrompt?.content ?? builtPrompt;
  const claimId = randomUUID();
  const metadata = {
    conversationId: conversation.id, conversationPublicId: conversation.public_id,
    turnClientMessageId: clientMessageId, respondingTo: trigger.id,
    actingUserId: input.actingUserId,
    requestedByMemberId: members.find(candidate => candidate.userId === input.actingUserId)?.id,
    claimId,
  };
  const placeholder = input.replaceMessageId ? getMessage(input.replaceMessageId)! : postMessage(room.id, {
    clientMessageId,
    memberId: member.id,
    authorKind: "agent",
    authorName: member.displayName,
    authorHandle: member.handle,
    personaSlug: member.personaSlug,
    body: "",
    parentId: trigger.parentId ?? null,
    status: "pending",
    metadata,
  });
  if (!input.replaceMessageId && placeholder.metadata?.claimId !== claimId) return { message: placeholder, accepted: false, reason: "replayed" };
  updateMessageBody(placeholder.id, "", "pending", metadata);

  try {
    const native = roomRuntime(member.personaSlug);
    if (native) {
      if (!input.request) throw new Error("The agent needs an authenticated launch request.");
      const task = trigger.body.replace(new RegExp(`(^|\\s)@${member.handle}\\b`, "gi"), "$1").trim();
      if (!task) throw new Error(`Tell ${member.displayName} what you want it to do.`);
      const run = await startRoomRuntime({ agentId: native.id, request: input.request, userId: input.actingUserId, conversation, clientMessageId, task, model: member.model });
      const current = getMessage(placeholder.id);
      if (!current || current.deletedAt || current.status === "aborted" || current.metadata?.claimId !== claimId || !getMember(member.id)) {
        await cancelExternalAgentRun(input.actingUserId, run.kind, run.runId);
        return { message: current ?? placeholder, accepted: false, reason: "cancelled" };
      }
      updateMessageBody(placeholder.id, "", "streaming", { ...metadata, runtimeAgentId: native.id, externalAgentRun: run });
      const saved = db.prepare("SELECT 1 FROM conversation_messages WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'").get(conversation.id, clientMessageId);
      if (!saved) recordExternalAgentTurn({ conversation, clientMessageId, surface: "dashboard_terminal", userContent: prompt, run, outcome: "running" });
      watchRoom(room.id);
      return { message: getMessage(placeholder.id)!, accepted: true };
    }
    const result = await startConversationTurn({
      conversation,
      clientMessageId,
      text: prompt,
      surface: "dashboard_terminal",
      // A room member answers with the tools and memory it would have anywhere
      // else; nothing about Buzz narrows that.
      yoloMode: false,
      personalize: false,
      confirmedPermissionIds: input.confirmedPermissionIds,
      retry: !!input.confirmedPermissionIds?.length,
      ...(member.model ? { model: member.model } : {}),
    });

    const current = getMessage(placeholder.id);
    if (!current || current.deletedAt || current.status === "aborted" || current.metadata?.claimId !== claimId || !getMember(member.id)) {
      await stopRoomWork(room.id, conversation.id);
      return { message: current ?? placeholder, accepted: false, reason: "cancelled" };
    }
    if (!result.accepted) {
      if ("blocked" in result) {
        const pendingPermissions = result.pendingPermissions.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
        updateMessageBody(placeholder.id, result.request || "This response needs permission from the person who requested it.", "failed", { ...metadata, needsPermission: true, pendingPermissions });
      } else if ("clarified" in result) {
        updateMessageBody(placeholder.id, result.message, "complete", metadata);
      } else {
        updateMessageBody(placeholder.id, "", result.status === "complete" ? "streaming" : "pending", metadata);
      }
      return { message: getMessage(placeholder.id)!, accepted: false };
    }
    updateMessageBody(placeholder.id, "", "streaming", { ...metadata, runId: result.run.id });
    watchRoom(room.id);
    return { message: getMessage(placeholder.id)!, accepted: true };
  } catch (error) {
    updateMessageBody(
      placeholder.id,
      error instanceof Error ? error.message : "The turn could not be started.",
      "failed",
    );
    return {
      message: getMessage(placeholder.id) ?? placeholder,
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
const watchers = new Map<number, ReturnType<typeof setTimeout>>();
const reconciliations = new Map<number, Promise<void>>();

function watchRoom(roomId: number) {
  if (watchers.has(roomId)) return;
  const timer = setTimeout(async () => {
    try { if (db.open) await reconcileLiveMessages(roomId); }
    catch { /* The next read/watch retries transient storage or runtime failures. */ }
    finally {
      watchers.delete(roomId);
      if (db.open && db.prepare("SELECT 1 FROM buzz_room_messages WHERE room_id = ? AND status IN ('pending','streaming') LIMIT 1").get(roomId)) watchRoom(roomId);
    }
  }, 1200);
  timer.unref(); watchers.set(roomId, timer);
}

export async function reconcileLiveMessages(roomId: number): Promise<void> {
  const previous = reconciliations.get(roomId);
  if (previous) return previous;
  const work = reconcileRoom(roomId).finally(() => reconciliations.delete(roomId));
  reconciliations.set(roomId, work);
  await work;
}

async function reconcileRoom(roomId: number): Promise<void> {
  const live = db
    .prepare(
      `SELECT id, metadata, body, updated_at FROM buzz_room_messages
       WHERE room_id = ? AND status IN ('pending','streaming')`,
    )
    .all(roomId) as Array<{ id: number; metadata: string | null; body: string; updated_at: string }>;

  for (const row of live) {
    if (!row.metadata) continue;
    const current = getMessage(row.id);
    if (!current || current.deletedAt || !["pending", "streaming"].includes(current.status)) continue;
    let meta: { conversationId?: number; turnClientMessageId?: string; runtimeAgentId?: string; actingUserId?: number; externalAgentRun?: { runId: string }; lastSequence?: number };
    try {
      meta = JSON.parse(row.metadata) as typeof meta;
    } catch {
      continue;
    }
    if (!meta.conversationId || !meta.turnClientMessageId) continue;

    if (meta.runtimeAgentId && meta.actingUserId && meta.externalAgentRun) {
      try {
        const events = await roomRuntimeEvents(meta.runtimeAgentId, meta.actingUserId, meta.externalAgentRun.runId, meta.lastSequence ?? 0);
        const latest = getMessage(row.id);
        if (!latest || latest.deletedAt || !["pending", "streaming"].includes(latest.status) || latest.metadata?.turnClientMessageId !== meta.turnClientMessageId) continue;
        const output = runtimeOutput(events, row.body);
        updateMessageBody(row.id, output.body, output.status, { ...meta, lastSequence: events.at(-1)?.sequenceNumber ?? meta.lastSequence ?? 0 });
        if (output.status !== "streaming") finishExternalAgentTurn({ conversationId: meta.conversationId, clientMessageId: meta.turnClientMessageId, content: output.body, outcome: output.status === "complete" ? "completed" : output.status });
      } catch (error) {
        if (error instanceof Error && /run_not_found|not found|expired/i.test(error.message)) updateMessageBody(row.id, "This agent run is no longer available. Regenerate the response to start again.", "failed");
      }
      continue;
    }
    const answer = db
      .prepare(
        `SELECT content, status FROM conversation_messages
         WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`,
      )
      .get(meta.conversationId, meta.turnClientMessageId) as
      | { content: string; status: string }
      | undefined;
    if (!answer) {
      if (Date.now() - Date.parse(row.updated_at.replace(" ", "T") + "Z") > 300_000) updateMessageBody(row.id, "The response was interrupted before the agent started. Regenerate to try again.", "failed");
      continue;
    }

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
export async function readRoomSpine(roomId: number, limit?: number, beforeId?: number): Promise<BuzzMessage[]> {
  await reconcileLiveMessages(roomId);
  return listSpineMessages(roomId, limit, beforeId);
}

export async function readRoomThread(roomId: number, parentId: number): Promise<BuzzMessage[]> {
  await reconcileLiveMessages(roomId);
  return listThreadMessages(roomId, parentId);
}

/** Cancel before cascade deletion, while run ownership is still available. */
export async function stopRoomWork(roomId: number, conversationId?: number): Promise<void> {
  if (!conversationId) { clearTimeout(watchers.get(roomId)); watchers.delete(roomId); }
  const conversations = db.prepare("SELECT id, user_id FROM conversations WHERE buzz_room_id = ? AND (? IS NULL OR id = ?)").all(roomId, conversationId ?? null, conversationId ?? null) as Array<{ id: number; user_id: number }>;
  for (const conversation of conversations) {
    await cancelRunningExternalAgentRuns(conversation.user_id, conversation.id);
    for (const session of listRuntimeSessionsForConversation(conversation.id)) await cancelRuntimeSessionWork(conversation.user_id, session);
    db.prepare(`UPDATE buzz_room_messages SET status = 'aborted', body = CASE WHEN body = '' THEN 'The agent was stopped.' ELSE body END
      WHERE room_id = ? AND status IN ('pending','streaming') AND json_valid(metadata) AND json_extract(metadata, '$.conversationId') = ?`).run(roomId, conversation.id);
  }
}

// Bread in a meeting.
//
// The AgentCall bot's realtime voice talks to the room by itself. Whenever it
// needs Breadboard (the person's files, calendar, memory, any tool, a chat
// post) it sends `agent.request`; this module answers each one by running an
// ordinary Breadboard turn in the meeting's own chat — the same pipeline the
// Terminal uses, with the same tools and permission rules — and speaks the
// answer back through `inject.natural`. When the call ends, the transcript goes
// to that chat and one more turn writes the notes.
//
// One process holds the sockets (the Next server). A restart drops them; the
// bot stays in the call and keeps talking on its own, and `meeting_leave` /
// `meeting_status` still reach it through the REST API.
// ponytail: no reattach after a server restart; add one from listCalls() if
// meetings outlive restarts in practice.

import "server-only";
import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { createConversation, type ConversationRow } from "@/lib/conversations/store.ts";
import { readUserIdentity } from "@/lib/profile/identity-store.ts";
import {
  AgentCallError,
  callSocketUrl,
  createCall,
  endCall,
  getTranscript,
  listCalls,
  meetingPlatform,
  type TranscriptEntry,
} from "./agentcall.ts";
import { BOT_NAME, meetingContext, notesPrompt, requestPrompt, spokenAnswer, type MeetingLine } from "./meeting-prompts.ts";

export { BOT_NAME };

const TRIGGER_WORDS = ["bread", "bred", "brad", "breadboard"];
const MAX_TRANSCRIPT = 4_000;
/** AgentCall waits about 90 s for an answer; say something before that. */
const STATUS_AFTER_MS = 25_000;
const ANSWER_DEADLINE_MS = 85_000;

interface MeetingSession {
  callId: string;
  userId: number;
  meetUrl: string;
  conversation: ConversationRow;
  status: string;
  startedAt: number;
  transcript: MeetingLine[];
  participants: Set<string>;
  socket: WebSocket | null;
  reconnects: number;
  ended: boolean;
  /** Breadboard turns in flight for the bot, oldest first. */
  answering: Promise<void>;
  screenshots: Map<string, (dataUrl: string | null) => void>;
  endReason?: string;
}

type Sessions = Map<string, MeetingSession>;
const globals = globalThis as typeof globalThis & { breadboardMeetings?: Sessions };
const sessions: Sessions = globals.breadboardMeetings ??= new Map();

export class MeetingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

function ownerName(userId: number): string | null {
  try { return readUserIdentity(userId).displayName; } catch { return null; }
}

function append(session: MeetingSession, line: MeetingLine) {
  if (!line.text.trim()) return;
  session.transcript.push(line);
  if (session.transcript.length > MAX_TRANSCRIPT) session.transcript.splice(0, session.transcript.length - MAX_TRANSCRIPT);
}

function send(session: MeetingSession, payload: Record<string, unknown>): boolean {
  const socket = session.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

/** Read the meeting chat's answer row until it settles. */
async function awaitAnswer(conversationId: number, clientMessageId: string, deadline: number): Promise<string | null> {
  while (Date.now() < deadline) {
    const row = db.prepare(`SELECT content, status FROM conversation_messages
      WHERE conversation_id = ? AND client_message_id = ? AND role = 'assistant'`).get(conversationId, clientMessageId) as
      { content: string; status: string } | undefined;
    if (row && row.status === "complete") return row.content.trim() || null;
    if (row && (row.status === "failed" || row.status === "aborted")) return null;
    await new Promise(resolve => setTimeout(resolve, 900));
  }
  return null;
}

/** true: the answer will appear in the chat; a string: say this instead. */
async function runTurn(session: MeetingSession, text: string, clientMessageId: string): Promise<true | string> {
  // Imported lazily: the turn pipeline pulls in the whole agent runtime.
  const { startConversationTurn } = await import("@/lib/conversations/turn-service.ts");
  const result = await startConversationTurn({
    conversation: session.conversation,
    clientMessageId,
    text,
    surface: "dashboard_terminal",
    yoloMode: false,
    personalize: true,
  });
  if (result.accepted) return true;
  if ("clarified" in result) return result.message;
  if ("blocked" in result) return `I need ${ownerName(session.userId) ?? "my owner"}'s permission in Breadboard before I can do that.`;
  return true;
}

/** One `agent.request`: a Breadboard turn, a status line if it is slow, the answer. */
async function answerRequest(session: MeetingSession, requestId: string, question: string, lines: MeetingLine[]) {
  const clientMessageId = `meeting:${session.callId}:${requestId}`;
  const slow = setTimeout(() => send(session, { type: "inject.natural", request_id: requestId, text: "Still working on it.", final: false }), STATUS_AFTER_MS);
  let answer: string | null = null;
  try {
    const started = await runTurn(session, requestPrompt({ question, lines, ownerName: ownerName(session.userId), meetUrl: session.meetUrl }), clientMessageId);
    answer = started === true ? await awaitAnswer(session.conversation.id, clientMessageId, Date.now() + ANSWER_DEADLINE_MS) : started;
  } catch {
    answer = null;
  } finally {
    clearTimeout(slow);
  }
  if (session.ended) return;
  send(session, {
    type: "inject.natural", request_id: requestId,
    text: answer ? spokenAnswer(answer) : "Sorry, I couldn't get that done just now.",
  });
}

function handleEvent(session: MeetingSession, event: Record<string, unknown>) {
  const kind = String(event.event ?? event.type ?? "");
  switch (kind) {
    case "call.state":
    case "call.bot_joining":
    case "call.bot_joining_meeting":
    case "call.bot_waiting_room":
    case "call.bot_ready":
      session.status = kind === "call.state" ? String(event.status ?? session.status) : kind.slice(5);
      return;
    case "participant.joined":
    case "participant.left": {
      const list = Array.isArray(event.participants) ? event.participants : [];
      session.participants = new Set(list.map(item => String((item as { name?: unknown })?.name ?? "")).filter(Boolean));
      return;
    }
    case "transcript.final": {
      const speaker = (event.speaker as { name?: unknown } | undefined)?.name;
      append(session, { speaker: typeof speaker === "string" && speaker ? speaker : "Someone", text: String(event.text ?? ""), at: String(event.timestamp ?? new Date().toISOString()) });
      return;
    }
    case "voice.text":
      append(session, { speaker: BOT_NAME, text: String(event.text ?? ""), at: new Date().toISOString(), bot: true });
      return;
    case "chat.message":
      append(session, { speaker: `${String(event.sender ?? "Someone")} (chat)`, text: String(event.message ?? ""), at: String(event.timestamp ?? new Date().toISOString()) });
      return;
    case "agent.request": {
      const requestId = String(event.request_id ?? "");
      const question = String(event.question ?? "").slice(0, 4000);
      if (!requestId || !question) return;
      const lines = Array.isArray(event.transcript) ? event.transcript.map(item => {
        const row = item as { speaker?: unknown; text?: unknown; ts?: unknown };
        return { speaker: String(row.speaker ?? "Someone"), text: String(row.text ?? ""), at: String(row.ts ?? "") };
      }) : session.transcript.slice(-30);
      // One chat runs one turn at a time: requests queue behind each other.
      session.answering = session.answering.then(() => answerRequest(session, requestId, question, lines)).catch(() => {});
      return;
    }
    case "agent.leave_request":
      send(session, { type: "meeting.leave" });
      return;
    case "screenshot.result": {
      const id = String(event.request_id ?? "");
      const data = typeof event.data === "string" ? event.data : "";
      session.screenshots.get(id)?.(data ? `data:image/jpeg;base64,${data}` : null);
      session.screenshots.delete(id);
      return;
    }
    case "command.error": {
      const id = String(event.request_id ?? "");
      if (session.screenshots.has(id)) { session.screenshots.get(id)!(null); session.screenshots.delete(id); }
      return;
    }
    case "call.ended":
      session.endReason = typeof event.reason === "string" ? event.reason : undefined;
      void finishSession(session);
      return;
  }
}

function connect(session: MeetingSession) {
  if (session.ended) return;
  let socket: WebSocket;
  try { socket = new WebSocket(callSocketUrl(session.callId)); }
  catch { scheduleReconnect(session); return; }
  session.socket = socket;
  socket.addEventListener("open", () => { session.reconnects = 0; });
  socket.addEventListener("message", message => {
    let event: unknown;
    try { event = JSON.parse(typeof message.data === "string" ? message.data : String(message.data)); } catch { return; }
    if (event && typeof event === "object") handleEvent(session, event as Record<string, unknown>);
  });
  socket.addEventListener("close", () => {
    if (session.socket === socket) session.socket = null;
    scheduleReconnect(session);
  });
  socket.addEventListener("error", () => { /* close follows */ });
}

function scheduleReconnect(session: MeetingSession) {
  if (session.ended) return;
  if (session.reconnects >= 8) { void finishSession(session); return; }
  const delay = Math.min(30_000, 1_000 * 2 ** session.reconnects++);
  setTimeout(() => connect(session), delay).unref?.();
}

async function finishSession(session: MeetingSession) {
  if (session.ended) return;
  session.ended = true;
  session.status = "ended";
  try { session.socket?.close(); } catch {}
  session.socket = null;
  for (const resolve of session.screenshots.values()) resolve(null);
  session.screenshots.clear();
  // AgentCall's own transcript is the complete one when it is still there.
  let lines: MeetingLine[] = session.transcript;
  try {
    const remote: TranscriptEntry[] = await getTranscript(session.callId);
    if (remote.length) lines = remote.map(entry => ({ speaker: entry.speaker, text: entry.text, at: entry.at, bot: entry.speaker === BOT_NAME }));
  } catch { /* keep what was heard live */ }
  await session.answering.catch(() => {});
  try { await runTurn(session, notesPrompt({ lines, meetUrl: session.meetUrl, reason: session.endReason }), `meeting:${session.callId}:notes`); }
  catch { /* the transcript stays readable through meeting_status until the server restarts */ }
  setTimeout(() => sessions.delete(session.callId), 60 * 60_000).unref?.();
}

export interface JoinResult {
  callId: string;
  botName: string;
  conversationId: string;
  status: string;
  note?: string;
}

export async function joinMeeting(input: { userId: number; meetUrl: string; brief?: string; languages?: string[] }): Promise<JoinResult> {
  const meetUrl = input.meetUrl.trim();
  if (!meetingPlatform(meetUrl)) {
    throw new MeetingError(400, "meeting_url_unsupported", "That is not a Google Meet, Zoom or Microsoft Teams link.");
  }
  for (const session of sessions.values()) {
    if (session.userId === input.userId && !session.ended && session.meetUrl === meetUrl) {
      return { callId: session.callId, botName: BOT_NAME, conversationId: session.conversation.public_id, status: session.status, note: "Already in this meeting." };
    }
  }
  const name = ownerName(input.userId);
  const call = await createCall({
    meetUrl,
    botName: BOT_NAME,
    context: meetingContext({ ownerName: name, brief: input.brief }),
    triggerWords: TRIGGER_WORDS,
    languages: input.languages,
    disclosure: `${BOT_NAME} is ${name ? `${name}'s` : "an"} AI assistant and is transcribing this meeting.`,
  });
  const conversation = createConversation({
    userId: input.userId,
    title: `Meeting: ${new URL(meetUrl).hostname.replace(/^www\./, "")} ${new Date().toISOString().slice(0, 10)}`,
    surface: "dashboard_terminal",
    scopeKind: "global",
    originLabel: "Meeting",
  });
  const session: MeetingSession = {
    callId: call.call_id, userId: input.userId, meetUrl, conversation, status: call.status || "bot_joining",
    startedAt: Date.now(), transcript: [], participants: new Set(), socket: null, reconnects: 0, ended: false,
    answering: Promise.resolve(), screenshots: new Map(),
  };
  sessions.set(call.call_id, session);
  connect(session);
  return { callId: call.call_id, botName: call.bot_name || BOT_NAME, conversationId: conversation.public_id, status: session.status, ...(call.bot_name_note ? { note: call.bot_name_note } : {}) };
}

function activeSession(userId: number, callId?: string): MeetingSession | null {
  const mine = [...sessions.values()].filter(session => session.userId === userId && !session.ended);
  if (callId) return mine.find(session => session.callId === callId) ?? null;
  return mine.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}

export interface MeetingStatus {
  inMeeting: boolean;
  callId?: string;
  status?: string;
  meetUrl?: string;
  minutes?: number;
  participants?: string[];
  recent?: MeetingLine[];
  conversationId?: string;
  note?: string;
}

export async function meetingStatus(userId: number, input: { callId?: string; lines?: number } = {}): Promise<MeetingStatus> {
  const session = activeSession(userId, input.callId);
  if (session) {
    return {
      inMeeting: true, callId: session.callId, status: session.status, meetUrl: session.meetUrl,
      minutes: Math.round((Date.now() - session.startedAt) / 60_000),
      participants: [...session.participants], recent: session.transcript.slice(-Math.min(200, Math.max(1, input.lines ?? 40))),
      conversationId: session.conversation.public_id,
    };
  }
  // Not held by this server (for example after a restart): ask AgentCall.
  const remote = (await listCalls().catch(() => [])).filter(call => !input.callId || call.call_id === input.callId);
  if (remote.length) {
    return { inMeeting: true, callId: remote[0].call_id, status: remote[0].status, meetUrl: remote[0].meet_url,
      note: "The bot is in this call, but Breadboard lost its live connection, so it answers on its own and no transcript is kept here." };
  }
  return { inMeeting: false };
}

/** Say something in the meeting now, or post it in the meeting chat. */
export function meetingSay(userId: number, input: { text: string; chat?: boolean; callId?: string }): { sent: boolean } {
  const session = activeSession(userId, input.callId);
  if (!session) throw new MeetingError(409, "meeting_not_joined", "Bread is not in a meeting right now.");
  const text = input.text.trim().slice(0, input.chat ? 4000 : 1000);
  if (!text) throw new MeetingError(400, "meeting_text_required", "There is nothing to say.");
  const sent = send(session, input.chat ? { type: "meeting.send_chat", message: text } : { type: "inject.natural", text });
  if (!sent) throw new MeetingError(503, "meeting_disconnected", "The meeting connection is reconnecting. Try again in a moment.");
  if (input.chat) append(session, { speaker: `${BOT_NAME} (chat)`, text, at: new Date().toISOString(), bot: true });
  return { sent };
}

/** A still of what the meeting shows: the shared screen or the speaker. */
export async function meetingLook(userId: number, callId?: string): Promise<string> {
  const session = activeSession(userId, callId);
  if (!session) throw new MeetingError(409, "meeting_not_joined", "Bread is not in a meeting right now.");
  const requestId = randomUUID();
  const image = new Promise<string | null>(resolve => {
    session.screenshots.set(requestId, resolve);
    setTimeout(() => { if (session.screenshots.delete(requestId)) resolve(null); }, 20_000).unref?.();
  });
  if (!send(session, { type: "screenshot.take", request_id: requestId })) {
    session.screenshots.delete(requestId);
    throw new MeetingError(503, "meeting_disconnected", "The meeting connection is reconnecting. Try again in a moment.");
  }
  const dataUrl = await image;
  if (!dataUrl) throw new MeetingError(504, "meeting_screenshot_failed", "The meeting screenshot did not arrive.");
  return dataUrl;
}

export async function leaveMeeting(userId: number, callId?: string): Promise<{ left: boolean; callId?: string }> {
  const session = activeSession(userId, callId);
  const target = session?.callId ?? callId ?? (await listCalls().catch(() => []))[0]?.call_id;
  if (!target) return { left: false };
  if (session) send(session, { type: "meeting.leave" });
  try { await endCall(target); }
  catch (error) { if (!(error instanceof AgentCallError) || error.status !== 404) throw error; }
  if (session) { session.endReason = "left"; void finishSession(session); }
  return { left: true, callId: target };
}

/** For tests: the live sessions, read-only. */
export function liveMeetingCount(): number {
  return [...sessions.values()].filter(session => !session.ended).length;
}

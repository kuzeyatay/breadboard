import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import db from "@/lib/db";
import type { VerificationSummary } from "@/lib/hermes/evidence";
import {
  normalizeChatMessageAttachments,
  type ChatMessageAttachment,
} from "@/lib/chat-attachments";
import {
  EXTERNAL_AGENT_RUN_FIELD_BY_KIND,
  EXTERNAL_AGENT_RUN_KINDS,
  parseExternalAgentActivity,
  parseExternalAgentEdits,
  parseExternalAgentState,
  parseExternalAgentOutcome,
  parseExternalAgentRun,
  type ExternalAgentActivityEntry,
  type ExternalAgentEdits,
  type ExternalAgentOutcome,
  type ExternalAgentRun,
} from "@/lib/conversations/external-agent-runs";
import { cancelRunningExternalAgentRuns } from "@/lib/conversations/external-agent-cancel";
import {
  deleteConversation,
  ensureConversationForLegacyChatSession,
  getConversationById,
  renameConversation,
  setConversationHighlight,
  setConversationPinned,
} from "@/lib/conversations/store";
import { isChatHighlight } from "@/lib/conversations/highlights";
import { cancelRuntimeSessionWork } from "@/lib/hermes/session-cancel";
import { listRuntimeSessionsForChatSession } from "@/lib/hermes/runtime-store";

export const dynamic = "force-dynamic";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
  internalAgentContinuation?: boolean;
  createdAt?: string;
  sources?: string[];
  attachmentNames?: string[];
  attachments?: ChatMessageAttachment[];
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  verification?: VerificationSummary;
  externalAgentRun?: ExternalAgentRun;
  externalAgentOutcome?: ExternalAgentOutcome;
  externalAgentStartedAt?: string;
  externalAgentActivity?: ExternalAgentActivityEntry[];
  externalAgentEdits?: ExternalAgentEdits;
  externalAgentState?: Record<string, unknown>;
  delegatedAgentRun?: boolean;
  delegatedAgentPreamble?: string;
  externalAgentResult?: string;
  externalAgentName?: string;
}

function normalizeVerification(value: unknown): VerificationSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = (value as { state?: unknown }).state;
  if (
    ![
      "verified",
      "partially_verified",
      "unverified",
      "contradicted",
      "not_applicable",
    ].includes(String(state))
  ) {
    return undefined;
  }
  return value as VerificationSummary;
}

function mergeRuntimeMetadata(
  previous: string | null,
  message: ChatMessage,
): string | null {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = previous ? JSON.parse(previous) : null;
    metadata = Array.isArray(parsed)
      ? { calls: parsed }
      : parsed && typeof parsed === "object"
        ? { ...(parsed as Record<string, unknown>) }
        : {};
  } catch {
    metadata = {};
  }
  if (message.verification) metadata.verification = message.verification;
  if (message.attachmentNames?.length) {
    metadata.attachmentNames = message.attachmentNames;
  }
  if (message.attachments?.length) metadata.attachments = message.attachments;
  if (message.responseDurationMs !== undefined) {
    metadata.responseDurationMs = message.responseDurationMs;
  }
  if (message.internalAgentContinuation === true) {
    metadata.internalAgentContinuation = true;
  }
  if (message.externalAgentRun) {
    metadata.externalAgent = true;
    metadata.externalAgentRun = message.externalAgentRun;
    metadata.externalAgentOutcome =
      message.externalAgentOutcome ?? "running";
  }
  if (
    typeof message.externalAgentStartedAt === "string" &&
    Number.isFinite(Date.parse(message.externalAgentStartedAt))
  ) {
    metadata.externalAgentStartedAt = message.externalAgentStartedAt;
  }
  if (message.delegatedAgentRun === true) {
    metadata.delegatedAgentRun = true;
    if (message.delegatedAgentPreamble?.trim()) {
      metadata.delegatedAgentPreamble = message.delegatedAgentPreamble;
    }
    if (message.externalAgentResult !== undefined) {
      metadata.externalAgentResult = message.externalAgentResult;
    }
  }
  // Keep whatever the run already stored when the browser has nothing newer,
  // so saving a chat never erases the record of what the agent did.
  const activity = message.externalAgentActivity?.length
    ? message.externalAgentActivity
    : parseExternalAgentActivity(metadata.externalAgentActivity);
  if (activity.length) metadata.externalAgentActivity = activity;
  const edits =
    parseExternalAgentEdits(message.externalAgentEdits) ??
    parseExternalAgentEdits(metadata.externalAgentEdits);
  if (edits) metadata.externalAgentEdits = edits;
  const state =
    parseExternalAgentState(message.externalAgentState) ??
    parseExternalAgentState(metadata.externalAgentState);
  if (state) metadata.externalAgentState = state;
  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
}

function normalizeExternalAgent(
  record: Record<string, unknown>,
  role: ChatRole,
): Pick<
  ChatMessage,
  | "externalAgentRun"
  | "externalAgentOutcome"
  | "externalAgentStartedAt"
  | "externalAgentActivity"
  | "externalAgentEdits"
  | "externalAgentState"
  | "delegatedAgentRun"
  | "delegatedAgentPreamble"
  | "externalAgentResult"
  | "externalAgentName"
> {
  if (role !== "assistant") return {};
  // Every kind is read from the shared field table rather than a list kept by
  // hand here. Agent TARS and Parametric CAD were both missing from that list,
  // so a chat that contained one lost its run card on the next reload.
  const candidates = EXTERNAL_AGENT_RUN_KINDS.map((kind) => {
    const value = record[EXTERNAL_AGENT_RUN_FIELD_BY_KIND[kind]];
    return value ? { kind, ...(value as Record<string, unknown>) } : null;
  });
  const externalAgentRun = candidates
    .map((candidate) => parseExternalAgentRun(candidate))
    .find((candidate) => candidate !== null);
  const activity = parseExternalAgentActivity(record.externalAgentActivity);
  const edits = parseExternalAgentEdits(record.externalAgentEdits);
  const state = parseExternalAgentState(record.externalAgentState);
  const externalAgentStartedAt =
    typeof record.externalAgentStartedAt === "string" &&
    Number.isFinite(Date.parse(record.externalAgentStartedAt))
      ? record.externalAgentStartedAt
      : undefined;
  const runRecord = {
    ...(activity.length ? { externalAgentActivity: activity } : {}),
    ...(edits ? { externalAgentEdits: edits } : {}),
    ...(state ? { externalAgentState: state } : {}),
    ...(externalAgentStartedAt ? { externalAgentStartedAt } : {}),
    ...(record.delegatedAgentRun === true ? { delegatedAgentRun: true } : {}),
    ...(typeof record.delegatedAgentPreamble === "string" &&
    record.delegatedAgentPreamble.trim()
      ? { delegatedAgentPreamble: record.delegatedAgentPreamble }
      : {}),
    ...(typeof record.externalAgentResult === "string"
      ? { externalAgentResult: record.externalAgentResult }
      : {}),
    ...(typeof record.externalAgentName === "string" && record.externalAgentName.trim()
      ? { externalAgentName: record.externalAgentName }
      : {}),
  };
  if (!externalAgentRun) return runRecord;
  return {
    externalAgentRun,
    externalAgentOutcome:
      parseExternalAgentOutcome(record.externalAgentOutcome) ?? "running",
    ...runRecord,
  };
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim().replace(/\s+/g, " ").slice(0, 200);
  return title || null;
}

function normalizeMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null;

  const messages: ChatMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const role = record.role;
    const content = record.content;
    if (
      (role !== "user" && role !== "assistant") ||
      typeof content !== "string"
    )
      return null;

    const rawSources = record.sources;
    const sources = Array.isArray(rawSources)
      ? rawSources.filter(
          (source): source is string => typeof source === "string",
        )
      : [];

    const usage = role === "assistant"
      ? normalizeChatTokenUsage(record.usage) ?? undefined
      : undefined;
    const rawDuration = Number(record.responseDurationMs);
    const responseDurationMs =
      role === "assistant" && Number.isFinite(rawDuration) && rawDuration >= 0
        ? Math.trunc(rawDuration)
        : undefined;
    const verification =
      role === "assistant" ? normalizeVerification(record.verification) : undefined;
    const externalAgent = normalizeExternalAgent(record, role);
    const attachmentNames = role === "user" && Array.isArray(record.attachmentNames)
      ? record.attachmentNames
          .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
          .map((name) => name.trim().slice(0, 240))
          .slice(0, 12)
      : [];
    const attachments = role === "user"
      ? normalizeChatMessageAttachments(record.attachments)
      : [];
    const createdAt =
      typeof record.createdAt === "string" &&
      Number.isFinite(Date.parse(record.createdAt))
        ? record.createdAt
        : undefined;
    messages.push({
      role,
      content,
      ...(role === "user" && record.internalAgentContinuation === true
        ? { internalAgentContinuation: true }
        : {}),
      ...(createdAt ? { createdAt } : {}),
      sources,
      ...(attachmentNames.length ? { attachmentNames } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(usage ? { usage } : {}),
      ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
      ...(verification ? { verification } : {}),
      ...externalAgent,
    });
  }

  return messages;
}

async function getUserId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  const id = Number((session?.user as { id?: string } | undefined)?.id);
  return Number.isFinite(id) ? id : null;
}

interface SessionAccess {
  id: number;
  sessionUserId: number;
  clusterOwnerId: number;
}

function getSessionAccess(sessionId: number): SessionAccess | null {
  const row = db
    .prepare(
      `SELECT s.id, s.user_id AS session_user_id, c.user_id AS cluster_owner_id
       FROM chat_sessions s
       JOIN clusters c ON c.id = s.cluster_id
       WHERE s.id = ?`,
    )
    .get(sessionId) as
    | { id: number; session_user_id: number; cluster_owner_id: number }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    sessionUserId: row.session_user_id,
    clusterOwnerId: row.cluster_owner_id,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId } = await params;
  const numericSessionId = Number(sessionId);
  if (!Number.isInteger(numericSessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const sessionAccess = getSessionAccess(numericSessionId);
  if (!sessionAccess || sessionAccess.sessionUserId !== userId) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const body = await request.json();
  const title = body.title === undefined ? undefined : cleanTitle(body.title);
  if (body.title !== undefined && !title) {
    return NextResponse.json(
      { error: "A chat needs a name." },
      { status: 400 },
    );
  }
  const messages =
    body.messages === undefined ? undefined : normalizeMessages(body.messages);
  if (body.messages !== undefined && !messages) {
    return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
  }
  if (body.pinned !== undefined && typeof body.pinned !== "boolean") {
    return NextResponse.json(
      { error: "Pinned must be true or false." },
      { status: 400 },
    );
  }
  // null clears the mark. Anything else has to name a color in the shared
  // palette, so the rail can never be handed a slug it cannot paint.
  if (
    body.highlight !== undefined &&
    body.highlight !== null &&
    !isChatHighlight(body.highlight)
  ) {
    return NextResponse.json(
      { error: "A highlight must be one of the palette colors, or null." },
      { status: 400 },
    );
  }

  // Pinning and highlighting are marks on the canonical conversation, the same
  // row the Terminal rail marks — one chat cannot be pinned in one view and
  // loose in the other.
  const needsConversation =
    Boolean(title) || body.pinned !== undefined || body.highlight !== undefined;
  let conversation = needsConversation
    ? ensureConversationForLegacyChatSession(sessionAccess.id, userId)
    : null;
  const update = db.transaction(() => {
    if (title && conversation) {
      // Garden Chat and Terminal are two views of the same canonical
      // conversation. Use the canonical rename so both stores change together,
      // and so renaming remains a label edit rather than Recent activity.
      renameConversation(conversation, title, db);
    }

    if (messages !== undefined) {
      db.prepare(
        "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?",
      ).run(sessionAccess.id);
    }

    if (messages) {
      const runtimeMetadata = db.prepare(
        `SELECT role, content, canonical_message_id, tool_calls, permission_decisions, runtime_error, runtime_status, created_at
         FROM chat_messages WHERE session_id = ? ORDER BY order_index`,
      ).all(sessionAccess.id) as Array<{
        role: string;
        content: string;
        canonical_message_id: number | null;
        tool_calls: string | null;
        permission_decisions: string | null;
        runtime_error: string | null;
        runtime_status: string | null;
        created_at: string;
      }>;
      const metadataByMessage = new Map<string, typeof runtimeMetadata>();
      for (const metadata of runtimeMetadata) {
        const key = `${metadata.role}\u0000${metadata.content}`;
        metadataByMessage.set(key, [...(metadataByMessage.get(key) ?? []), metadata]);
      }
      db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(
        sessionAccess.id,
      );
      const insert = db.prepare(
        `INSERT INTO chat_messages
           (session_id, role, content, sources, token_usage, tool_calls, permission_decisions, runtime_error, runtime_status, order_index, created_at, canonical_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      messages.forEach((message, index) => {
        const key = `${message.role}\u0000${message.content}`;
        const prior = metadataByMessage.get(key)?.shift();
        insert.run(
          sessionAccess.id,
          message.role,
          message.content,
          message.sources && message.sources.length > 0
            ? JSON.stringify(message.sources)
            : null,
          message.usage ? JSON.stringify(message.usage) : null,
          mergeRuntimeMetadata(prior?.tool_calls ?? null, message),
          prior?.permission_decisions ?? null,
          prior?.runtime_error ?? null,
          prior?.runtime_status ?? null,
          index,
          message.createdAt ?? prior?.created_at ?? new Date().toISOString(),
          prior?.canonical_message_id ?? null,
        );
      });
    }
  });

  update();

  // Outside the transaction above, which owns the transcript rewrite: a mark is
  // not activity and must not be able to fail a message save, or be undone by
  // one.
  if (conversation && body.pinned !== undefined) {
    conversation = setConversationPinned(conversation, body.pinned);
  }
  if (conversation && body.highlight !== undefined) {
    conversation = setConversationHighlight(conversation, body.highlight);
  }

  const saved = db
    .prepare("SELECT id, title, updated_at FROM chat_sessions WHERE id = ?")
    .get(sessionAccess.id) as
    | { id: number; title: string; updated_at: string }
    | undefined;
  return NextResponse.json({
    success: true,
    session: saved
      ? {
          ...saved,
          ...(conversation
            ? {
                pinned: conversation.pinned_at !== null,
                highlight: isChatHighlight(conversation.highlight)
                  ? conversation.highlight
                  : null,
              }
            : {}),
        }
      : saved,
  });
}

/**
 * DELETE: remove one Garden chat.
 *
 * The runtime sessions cascade from the `chat_sessions` row, so whatever this
 * chat still has running has to be stopped first — after the cascade there is
 * no row left that names the turn, the terminal child process or the agent run,
 * and they would keep going with nothing able to reach them. The canonical
 * delete does the same thing for the same reason.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId } = await params;
  const numericSessionId = Number(sessionId);
  if (!Number.isInteger(numericSessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const sessionAccess = getSessionAccess(numericSessionId);
  if (
    !sessionAccess ||
    (sessionAccess.sessionUserId !== userId &&
      sessionAccess.clusterOwnerId !== userId)
  ) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const linked = db
    .prepare("SELECT conversation_id FROM chat_sessions WHERE id = ?")
    .get(sessionAccess.id) as { conversation_id: number | null } | undefined;
  if (linked?.conversation_id) {
    await cancelRunningExternalAgentRuns(userId, linked.conversation_id);
  }
  for (const runtimeSession of listRuntimeSessionsForChatSession(sessionAccess.id)) {
    await cancelRuntimeSessionWork(userId, runtimeSession);
  }

  // The legacy row and the canonical conversation are two halves of one chat.
  // Removing only the legacy half left the conversation behind, and a stranded
  // conversation still shows up wherever Breadboard reads the canonical store —
  // chat search, Uploads, Processes — as a chat nothing can open.
  const conversation = linked?.conversation_id
    ? getConversationById(linked.conversation_id)
    : null;
  db.transaction(() => {
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionAccess.id);
    if (conversation && conversation.user_id === userId) {
      deleteConversation(conversation);
    }
  })();
  return NextResponse.json({ success: true });
}

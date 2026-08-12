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
  delegatedAgentPresentation,
  externalAgentMessageFields,
} from "@/lib/conversations/external-agent-runs";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store";

export const dynamic = "force-dynamic";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id?: string;
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
} & ReturnType<typeof externalAgentMessageFields>;

interface ChatSessionRow {
  id: number;
  user_id: number;
  title: string;
  created_at: string;
  updated_at: string;
  owner_username?: string | null;
}

interface ChatMessageRow {
  session_id: number;
  canonical_message_id: number | null;
  role: ChatRole;
  content: string;
  sources: string | null;
  token_usage: string | null;
  tool_calls: string | null;
  created_at: string;
}

function cleanTitle(value: unknown): string {
  const title =
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return title.slice(0, 80) || "New chat";
}

function parseSources(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseTokenUsage(value: string | null): ChatTokenUsage | undefined {
  if (!value) return undefined;
  try {
    return normalizeChatTokenUsage(JSON.parse(value)) ?? undefined;
  } catch {
    return undefined;
  }
}

function parseVerification(value: string | null): VerificationSummary | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { verification?: unknown };
    const verification = parsed?.verification;
    if (!verification || typeof verification !== "object") return undefined;
    const state = (verification as { state?: unknown }).state;
    if (!["verified", "partially_verified", "unverified", "contradicted", "not_applicable"].includes(String(state))) return undefined;
    return verification as VerificationSummary;
  } catch {
    return undefined;
  }
}

function parseResponseDuration(value: string | null): number | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { responseDurationMs?: unknown };
    const duration = Number(parsed?.responseDurationMs);
    return Number.isFinite(duration) && duration >= 0
      ? Math.trunc(duration)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseInternalAgentContinuation(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as { internalAgentContinuation?: unknown };
    return parsed?.internalAgentContinuation === true;
  } catch {
    return false;
  }
}

function parseExternalAgentFields(
  value: string | null,
  role: ChatRole,
): ReturnType<typeof externalAgentMessageFields> {
  // A launch stores the run descriptor on both halves of the turn so the
  // canonical store can detect a replayed clientMessageId. Only the assistant
  // half may carry it back into a transcript — the writer that finalizes a run
  // matches on the descriptor, and a user message wearing one gets its text
  // replaced by the agent's answer.
  if (!value || role !== "assistant") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? externalAgentMessageFields(parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseAttachmentFields(value: string | null): Pick<
  ChatMessage,
  "attachmentNames" | "attachments"
> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const attachmentNames = Array.isArray(parsed.attachmentNames)
      ? parsed.attachmentNames
          .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
          .map((name) => name.trim().slice(0, 240))
          .slice(0, 12)
      : [];
    const attachments = normalizeChatMessageAttachments(parsed.attachments);
    return {
      ...(attachmentNames.length ? { attachmentNames } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
  } catch {
    return {};
  }
}

function getUserId(): Promise<number | null> {
  return getServerSession(authOptions).then((session) => {
    const id = Number((session?.user as { id?: string } | undefined)?.id);
    return Number.isFinite(id) ? id : null;
  });
}

interface ClusterAccess {
  id: number;
  ownerId: number;
  chatAccessible: boolean;
  visibility: "private" | "public";
}

function getClusterAccess(clusterSlug: string): ClusterAccess | null {
  const row = db
    .prepare(
      "SELECT id, user_id, chat_accessible, visibility FROM clusters WHERE slug = ?",
    )
    .get(clusterSlug) as
    | {
        id: number;
        user_id: number;
        chat_accessible: number;
        visibility: "private" | "public";
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.user_id,
    chatAccessible: Boolean(row.chat_accessible),
    visibility: row.visibility === "public" ? "public" : "private",
  };
}

function readSessions(
  clusterId: number,
  currentUserId: number,
  filterUserId: number | null,
  includeUsername: boolean,
) {
  let rows: ChatSessionRow[];

  if (includeUsername) {
    rows = db
      .prepare(
        `SELECT cs.id, cs.user_id, cs.title, cs.created_at, cs.updated_at, u.username AS owner_username
         FROM chat_sessions cs
         JOIN users u ON u.id = cs.user_id
         WHERE cs.cluster_id = ?
         ORDER BY cs.updated_at DESC, cs.id DESC`,
      )
      .all(clusterId) as ChatSessionRow[];
  } else if (filterUserId !== null) {
    rows = db
      .prepare(
        `SELECT id, user_id, title, created_at, updated_at
         FROM chat_sessions
         WHERE cluster_id = ? AND user_id = ?
         ORDER BY updated_at DESC, id DESC`,
      )
      .all(clusterId, filterUserId) as ChatSessionRow[];
  } else {
    rows = db
      .prepare(
        `SELECT id, user_id, title, created_at, updated_at
         FROM chat_sessions
         WHERE cluster_id = ?
         ORDER BY updated_at DESC, id DESC`,
      )
      .all(clusterId) as ChatSessionRow[];
  }

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const messages = db
    .prepare(
      `SELECT session_id, canonical_message_id, role, content, sources, token_usage, tool_calls, created_at
       FROM chat_messages
       WHERE session_id IN (${placeholders})
       ORDER BY session_id, order_index`,
    )
    .all(...ids) as ChatMessageRow[];

  const bySession = new Map<number, ChatMessage[]>();
  for (const message of messages) {
    const existing = bySession.get(message.session_id) ?? [];
    const usage = parseTokenUsage(message.token_usage);
    const verification = parseVerification(message.tool_calls);
    const responseDurationMs = parseResponseDuration(message.tool_calls);
    const internalAgentContinuation =
      message.role === "user" &&
      parseInternalAgentContinuation(message.tool_calls);
    const externalAgent = parseExternalAgentFields(
      message.tool_calls,
      message.role,
    );
    const attachmentFields = parseAttachmentFields(message.tool_calls);
    existing.push({
      ...(message.canonical_message_id !== null
        ? { id: `msg_${message.canonical_message_id}` }
        : {}),
      role: message.role,
      ...delegatedAgentPresentation(message.content, externalAgent),
      ...(internalAgentContinuation
        ? { internalAgentContinuation: true }
        : {}),
      createdAt: message.created_at,
      sources: parseSources(message.sources),
      ...(usage ? { usage } : {}),
      ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
      ...(verification ? { verification } : {}),
      ...attachmentFields,
    });
    bySession.set(message.session_id, existing);
  }

  return rows.map((row) => ({
    ...row,
    ownerUsername: row.owner_username ?? undefined,
    isOwn: row.user_id === currentUserId,
    messages: bySession.get(row.id) ?? [],
  }));
}

export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const clusterSlug = searchParams.get("clusterSlug")?.trim();
  if (!clusterSlug) {
    return NextResponse.json(
      { error: "clusterSlug is required" },
      { status: 400 },
    );
  }

  const access = getClusterAccess(clusterSlug);
  if (!access)
    return NextResponse.json({ error: "Garden not found" }, { status: 404 });

  const isOwner = access.ownerId === userId;
  const includePublicChats =
    isOwner &&
    searchParams.get("includePublicChats") === "1" &&
    access.visibility === "public" &&
    access.chatAccessible;

  if (!isOwner && !access.chatAccessible) {
    return NextResponse.json({ error: "Garden not found" }, { status: 404 });
  }

  const sessions = readSessions(
    access.id,
    userId,
    includePublicChats ? null : userId,
    includePublicChats,
  );
  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const clusterSlug =
    typeof body.clusterSlug === "string" ? body.clusterSlug.trim() : "";
  if (!clusterSlug) {
    return NextResponse.json(
      { error: "clusterSlug is required" },
      { status: 400 },
    );
  }

  const access = getClusterAccess(clusterSlug);
  if (!access)
    return NextResponse.json({ error: "Garden not found" }, { status: 404 });

  const isOwner = access.ownerId === userId;
  if (!isOwner && !access.chatAccessible) {
    return NextResponse.json({ error: "Garden not found" }, { status: 404 });
  }

  const result = db
    .prepare(
      "INSERT INTO chat_sessions (cluster_id, user_id, title) VALUES (?, ?, ?)",
    )
    .run(access.id, userId, cleanTitle(body.title));

  ensureConversationForLegacyChatSession(
    Number(result.lastInsertRowid),
    userId,
  );
  const session = db
    .prepare(
      "SELECT id, user_id, title, created_at, updated_at, conversation_id FROM chat_sessions WHERE id = ?",
    )
    .get(result.lastInsertRowid) as ChatSessionRow;

  return NextResponse.json({
    session: { ...session, isOwn: true, messages: [] },
  });
}

import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import {
  normalizeChatTokenUsage,
  type ChatTokenUsage,
} from "@/lib/chat-token-usage";
import db from "@/lib/db";
import type { VerificationSummary } from "@/lib/openharness/evidence";

export const dynamic = "force-dynamic";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
  sources?: string[];
  usage?: ChatTokenUsage;
  responseDurationMs?: number;
  verification?: VerificationSummary;
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
  if (message.responseDurationMs !== undefined) {
    metadata.responseDurationMs = message.responseDurationMs;
  }
  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim().replace(/\s+/g, " ").slice(0, 80);
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
    messages.push({
      role,
      content,
      sources,
      ...(usage ? { usage } : {}),
      ...(responseDurationMs !== undefined ? { responseDurationMs } : {}),
      ...(verification ? { verification } : {}),
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
  const title = cleanTitle(body.title);
  const messages =
    body.messages === undefined ? undefined : normalizeMessages(body.messages);
  if (body.messages !== undefined && !messages) {
    return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
  }

  const update = db.transaction(() => {
    if (title) {
      db.prepare(
        "UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(title, sessionAccess.id);
    } else {
      db.prepare(
        "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?",
      ).run(sessionAccess.id);
    }

    if (messages) {
      const runtimeMetadata = db.prepare(
        `SELECT role, content, tool_calls, permission_decisions, runtime_error, runtime_status
         FROM chat_messages WHERE session_id = ? AND (tool_calls IS NOT NULL OR permission_decisions IS NOT NULL OR runtime_status IS NOT NULL) ORDER BY order_index`,
      ).all(sessionAccess.id) as Array<{
        role: string;
        content: string;
        tool_calls: string | null;
        permission_decisions: string | null;
        runtime_error: string | null;
        runtime_status: string | null;
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
           (session_id, role, content, sources, token_usage, tool_calls, permission_decisions, runtime_error, runtime_status, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        );
      });
    }
  });

  update();
  return NextResponse.json({ success: true });
}

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

  db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionAccess.id);
  return NextResponse.json({ success: true });
}

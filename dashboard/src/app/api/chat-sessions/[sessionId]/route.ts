import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth-options";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
  sources?: string[];
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

    messages.push({ role, content, sources });
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
      db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(
        sessionAccess.id,
      );
      const insert = db.prepare(
        `INSERT INTO chat_messages (session_id, role, content, sources, order_index)
         VALUES (?, ?, ?, ?, ?)`,
      );
      messages.forEach((message, index) => {
        insert.run(
          sessionAccess.id,
          message.role,
          message.content,
          message.sources && message.sources.length > 0
            ? JSON.stringify(message.sources)
            : null,
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

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
  role: ChatRole;
  content: string;
  sources: string | null;
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
      `SELECT session_id, role, content, sources
       FROM chat_messages
       WHERE session_id IN (${placeholders})
       ORDER BY session_id, order_index`,
    )
    .all(...ids) as ChatMessageRow[];

  const bySession = new Map<number, ChatMessage[]>();
  for (const message of messages) {
    const existing = bySession.get(message.session_id) ?? [];
    existing.push({
      role: message.role,
      content: message.content,
      sources: parseSources(message.sources),
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
    return NextResponse.json({ error: "Cluster not found" }, { status: 404 });

  const isOwner = access.ownerId === userId;
  const includePublicChats =
    isOwner &&
    searchParams.get("includePublicChats") === "1" &&
    access.visibility === "public" &&
    access.chatAccessible;

  if (!isOwner && !access.chatAccessible) {
    return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
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
    return NextResponse.json({ error: "Cluster not found" }, { status: 404 });

  const isOwner = access.ownerId === userId;
  if (!isOwner && !access.chatAccessible) {
    return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
  }

  const result = db
    .prepare(
      "INSERT INTO chat_sessions (cluster_id, user_id, title) VALUES (?, ?, ?)",
    )
    .run(access.id, userId, cleanTitle(body.title));

  const session = db
    .prepare(
      "SELECT id, user_id, title, created_at, updated_at FROM chat_sessions WHERE id = ?",
    )
    .get(result.lastInsertRowid) as ChatSessionRow;

  return NextResponse.json({
    session: { ...session, isOwn: true, messages: [] },
  });
}

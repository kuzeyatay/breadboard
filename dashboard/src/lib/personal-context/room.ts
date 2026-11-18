import type Database from "better-sqlite3";
import { getRoomForUser } from "../buzz/store.ts";
import { isSensitiveMemoryText, durableMemoryExclusionReason } from "../conversations/memory.ts";
import { rankContext } from "./rank.ts";

// An organization reply is visible to the room. Only human statements
// visible in that room and thread are candidates for its shared conventions.
export function roomLessons(
  database: Database.Database,
  user: number,
  roomId: string,
  threadId: number | null,
  query: string,
) {
  const room = getRoomForUser(database, user, roomId);
  if (!room || room.archivedAt) return [];
  const rows = database
    .prepare(
      `SELECT id,body,author_name,updated_at FROM buzz_room_messages
    WHERE room_id=? AND (parent_id IS NULL OR parent_id=?) AND author_kind='human'
    AND deleted_at IS NULL AND status='complete' ORDER BY id DESC LIMIT 400`,
    )
    .all(room.id, threadId) as { id: number; body: string; author_name: string; updated_at: string }[];
  const slots = new Map<string, { id: string; title: string; summary: string }>();
  for (const row of rows) {
    const text = row.body.trim();
    if (
      !text ||
      text.length > 350 ||
      text.includes("?") ||
      isSensitiveMemoryText(text) ||
      durableMemoryExclusionReason(text)
    )
      continue;
    const rule =
      /^(?:actually[, ]+|from now on[, ]+)?(?:we (?:always |usually )?)?use (.+?) for (.+?)[.!]?$/i.exec(
        text,
      );
    const decision =
      /^(?:we (?:agreed|decided)|our (?:decision|next step)|action item|for .+?, (?:we |always ))\b/i.test(
        text,
      );
    if (!rule && !decision) continue;
    const key = (rule ? rule[2] : text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (!slots.has(key))
      slots.set(key, {
        id: "room-message:" + row.id,
        title: text,
        summary: "Shared by " + row.author_name + " in #" + room.slug,
      });
  }
  const facts = [...slots.values()];
  if (!query.trim()) return facts.slice(0, 3);
  const ranked = rankContext(
    query,
    facts.map((f) => ({ source: "pattern", ref: f.id, title: f.title, detail: f.summary, at: 0 })),
    Date.now(),
    4,
  );
  return ranked.map((hit) => facts.find((f) => f.id === hit.ref)!);
}

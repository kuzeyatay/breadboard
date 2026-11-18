import type Database from "better-sqlite3";
import { looksPrivatePage } from "../browser-annotations.ts";
import { browserVisitFacts } from "../personal-context/browser.ts";
import type { InterestSource } from "./feed-ranking.ts";

/** History is consulted on demand so clearing a visit or deleting a conversation takes effect on the next load. */
export async function feedHistory(db: Database.Database, root: string, user: number): Promise<InterestSource[]> {
  const visits = await browserVisitFacts(root, user, url => !looksPrivatePage(url), 120);
  const chats = db.prepare(`SELECT c.title, unixepoch(c.updated_at)*1000 AS at
    FROM conversations c LEFT JOIN clusters g ON g.id=c.default_garden_id
    WHERE c.user_id=? AND c.temporary=0 AND c.archived_at IS NULL AND c.buzz_room_id IS NULL
    AND (c.default_garden_id IS NULL OR (g.user_id=c.user_id AND g.memory_scope<>'garden_only'))
    ORDER BY c.updated_at DESC LIMIT 48`).all(user) as Array<{ title: string; at: number }>;
  return [
    ...visits.map(visit => ({ title: visit.title, url: visit.ref, at: visit.at, weight: 0.45 * Math.log2(1 + (visit.days ?? 1)) })),
    ...chats.map(chat => ({ ...chat, weight: 0.85 })),
  ];
}

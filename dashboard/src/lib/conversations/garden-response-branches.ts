import type Database from "better-sqlite3";
import type { BranchableMessage, ConversationBranchGroup } from "../../app/components/hermes/conversation-branches.ts";

export function ensureGardenResponseBranches(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS garden_response_branches (
    session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (session_id, group_id)
  )`);
}

export function normalizeGardenResponseBranches<T extends BranchableMessage>(
  value: unknown,
  normalizeMessages: (value: unknown) => T[] | null,
): Record<string, ConversationBranchGroup<T> | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 500) return null;
  const result: Record<string, ConversationBranchGroup<T> | null> = Object.create(null);
  for (const [id, group] of entries) {
    if (!id || id.length > 200) return null;
    if (group === null) { result[id] = null; continue; }
    if (!group || typeof group !== "object" || group.id !== id ||
        !Number.isInteger(group.activeIndex) || !Array.isArray(group.variants) ||
        group.variants.length < 2 || group.variants.length > 500 ||
        group.activeIndex < 0 || group.activeIndex >= group.variants.length) return null;
    const variants: T[][] = [];
    for (const variant of group.variants) {
      const messages = normalizeMessages(variant);
      if (!messages || messages.length === 0) return null;
      variants.push(messages);
    }
    result[id] = { id, activeIndex: group.activeIndex, variants };
  }
  return result;
}

/** Called inside the transcript transaction, after the route checks ownership. */
export function writeGardenResponseBranches<T extends BranchableMessage>(
  db: Database.Database, sessionId: number,
  groups: Record<string, ConversationBranchGroup<T> | null>,
): void {
  const save = db.prepare(`INSERT INTO garden_response_branches(session_id, group_id, value) VALUES (?, ?, ?)
    ON CONFLICT(session_id, group_id) DO UPDATE SET value = excluded.value`);
  const remove = db.prepare("DELETE FROM garden_response_branches WHERE session_id = ? AND group_id = ?");
  for (const [id, group] of Object.entries(groups)) {
    if (group === null) remove.run(sessionId, id);
    else save.run(sessionId, id, JSON.stringify(group));
  }
}

export function readGardenResponseBranches(db: Database.Database, sessionId: number) {
  const rows = db.prepare("SELECT group_id, value FROM garden_response_branches WHERE session_id = ?")
    .all(sessionId) as Array<{ group_id: string; value: string }>;
  return Object.fromEntries(rows.map(row => [row.group_id, JSON.parse(row.value)]));
}

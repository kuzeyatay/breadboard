import type Database from "better-sqlite3";
import type { BranchableMessage, ConversationBranchGroup } from "../../app/components/hermes/conversation-branches.ts";
import { trimVerificationForTransport, type VerificationSummary } from "../hermes/evidence.ts";

type VerifiedMessage = BranchableMessage & { role?: string; content?: string; verification?: VerificationSummary };

/** Every variant repeats the transcript up to its branch point, so one retry
 * copied 28 MB of evidence for a 298-message chat. Browsers get it trimmed. */
export function trimGardenResponseBranchesForTransport<T extends Record<string, unknown>>(groups: T): T {
  return Object.fromEntries(Object.entries(groups).map(([id, group]) => {
    const variants = (group as { variants?: unknown })?.variants;
    if (!Array.isArray(variants)) return [id, group];
    return [id, { ...(group as object), variants: variants.map((variant) => Array.isArray(variant)
      ? variant.map((message: VerifiedMessage) => message?.verification
        ? { ...message, verification: trimVerificationForTransport(message.verification) }
        : message)
      : variant) }];
  })) as T;
}

function verificationKeys(message: VerifiedMessage): string[] {
  const keys: string[] = [];
  if (typeof message.id === "string") keys.push(`id:${message.id}`);
  if (typeof message.clientMessageId === "string") keys.push(`turn:${message.role}:${message.clientMessageId}`);
  if (typeof message.content === "string") keys.push(`text:${message.role}:${message.content}`);
  return keys;
}

/** The full verifications a trimmed browser copy was made from: stored
 * branches first, then the transcript rows (not yet replaced in this save). */
function storedVerifications(db: Database.Database, sessionId: number): Map<string, VerificationSummary> {
  const found = new Map<string, VerificationSummary>();
  const remember = (message: VerifiedMessage) => {
    if (!message?.verification || message.verification.detailsTrimmed) return;
    for (const key of verificationKeys(message)) if (!found.has(key)) found.set(key, message.verification);
  };
  for (const group of Object.values(readGardenResponseBranches(db, sessionId))) {
    for (const variant of (group as { variants?: unknown[] })?.variants ?? []) {
      if (Array.isArray(variant)) variant.forEach(remember);
    }
  }
  const rows = db.prepare("SELECT role, content, canonical_message_id, tool_calls FROM chat_messages WHERE session_id = ?")
    .all(sessionId) as Array<{ role: string; content: string; canonical_message_id: number | null; tool_calls: string | null }>;
  for (const row of rows) {
    let metadata: { verification?: VerificationSummary; clientMessageId?: string } | null = null;
    try { metadata = row.tool_calls ? JSON.parse(row.tool_calls) : null; } catch { metadata = null; }
    if (!metadata?.verification) continue;
    remember({
      role: row.role, content: row.content, verification: metadata.verification,
      ...(row.canonical_message_id !== null ? { id: `msg_${row.canonical_message_id}` } : {}),
      ...(typeof metadata.clientMessageId === "string" ? { clientMessageId: metadata.clientMessageId } : {}),
    } as VerifiedMessage);
  }
  return found;
}

/** A checkpoint appends durably; show its retry in place of the earlier attempt. */
export function projectGardenResponseBranches<T extends BranchableMessage>(messages: readonly T[]): T[] {
  const visible: T[] = [];
  for (const message of messages) {
    if (message.role === "user" && message.branchGroupId) {
      const anchor = visible.findIndex(candidate => candidate.role === "user" && (
        candidate.clientMessageId === message.branchGroupId ||
        candidate.id === message.branchGroupId ||
        candidate.branchGroupId === message.branchGroupId
      ));
      if (anchor >= 0) visible.splice(anchor);
    }
    visible.push(message);
  }
  return visible;
}

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
  // A browser's copy carries trimmed verifications; saving them as they are
  // would replace the stored evidence with its trimmed copy.
  let stored: Map<string, VerificationSummary> | null = null;
  const restore = (message: T): T => {
    const verification = (message as VerifiedMessage).verification;
    if (!verification?.detailsTrimmed) return message;
    stored ??= storedVerifications(db, sessionId);
    const full = verificationKeys(message as VerifiedMessage).map((key) => stored!.get(key)).find(Boolean);
    return full ? { ...message, verification: full } : message;
  };
  for (const [id, group] of Object.entries(groups)) {
    if (group === null) remove.run(sessionId, id);
    else save.run(sessionId, id, JSON.stringify({ ...group, variants: group.variants.map((variant) => variant.map(restore)) }));
  }
}

export function readGardenResponseBranches(db: Database.Database, sessionId: number) {
  const rows = db.prepare("SELECT group_id, value FROM garden_response_branches WHERE session_id = ?")
    .all(sessionId) as Array<{ group_id: string; value: string }>;
  return Object.fromEntries(rows.map(row => [row.group_id, JSON.parse(row.value)]));
}

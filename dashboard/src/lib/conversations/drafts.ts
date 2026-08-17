// What someone typed into a chat and has not sent yet.
//
// A half-written message is real work — a paragraph of context, a pasted stack
// trace, a question being worded carefully — and until now a reload threw it
// away, because the composer's text only ever lived in React state. It is kept
// per chat rather than per window: text typed in one conversation belongs to
// that conversation, so switching chats swaps the draft rather than dragging it
// along, and coming back to a chat brings back what was left in its box.
//
// Like the unread dots next door, this is one browser's state and not a
// property of the conversation, so it lives in localStorage rather than in the
// conversations table. Nothing here is ever sent anywhere: an unsent draft is
// unsent, and the server has no business knowing about it.

const STORAGE_KEY = "breadboard:chat-drafts";
/** A cap, so a long-lived browser cannot grow the entry without bound. */
const MAX_DRAFTS = 40;

/**
 * The bucket a chat that does not exist yet writes to. A conversation is only
 * created when its first message is sent, so everything typed before that has
 * no session id to be filed under — but it is exactly the text most worth
 * keeping, since nothing about it has been written down anywhere else.
 */
export const NEW_CHAT_DRAFT_ID = "new";

interface StoredDraft {
  text: string;
  /** When it was last typed into, so pruning drops the oldest first. */
  at: number;
}

/**
 * Drafts are keyed by surface as well as by chat: the dashboard terminal and a
 * garden's chat are different boxes on screen, and a null session id means
 * "the unstarted chat on this surface" in both of them.
 */
export function chatDraftKey(surface: string, sessionId: string | null): string {
  return `${surface}:${sessionId ?? NEW_CHAT_DRAFT_ID}`;
}

function readAll(storage: Pick<Storage, "getItem">): Map<string, StoredDraft> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const drafts = new Map<string, StoredDraft>();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const { text, at } = value as { text?: unknown; at?: unknown };
      if (typeof text !== "string" || text === "") continue;
      drafts.set(key, { text, at: typeof at === "number" && Number.isFinite(at) ? at : 0 });
    }
    return drafts;
  } catch {
    return new Map();
  }
}

function writeAll(
  storage: Pick<Storage, "setItem">,
  drafts: Map<string, StoredDraft>,
): void {
  const kept = [...drafts.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_DRAFTS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // A full or blocked store costs this one draft across reloads, nothing
    // more — the text is still in the box in front of the person.
  }
}

/** The draft held for a chat, or null when nothing is being kept for it. */
export function readChatDraft(
  storage: Pick<Storage, "getItem">,
  key: string,
): string | null {
  return readAll(storage).get(key)?.text ?? null;
}

/**
 * Keep what is in the box. Empty text is a delete rather than an empty entry,
 * so sending a message — which clears the composer — also clears the draft
 * without anything having to remember to.
 */
export function writeChatDraft(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  text: string,
  now: number = Date.now(),
): void {
  const drafts = readAll(storage);
  if (text === "") {
    if (!drafts.delete(key)) return;
  } else {
    const current = drafts.get(key);
    if (current?.text === text) return;
    drafts.set(key, { text, at: now });
  }
  writeAll(storage, drafts);
}

export function clearChatDraft(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
): void {
  writeChatDraft(storage, key, "");
}

/**
 * What the composer should show when the chat under it changes.
 *
 * A stored draft always wins. Failing that there is one case where the text on
 * screen stays: the chat that had no id has just been given one, because its
 * first message was sent, so anything typed since belongs to it. Every other
 * move between chats empties the box — the outgoing text was already filed
 * under the chat it was written in.
 */
export function resolveDraftRestore({
  stored,
  value,
  previousKey,
  newChatKey,
  sessionId,
}: {
  /** The draft kept for the incoming chat, or null. */
  stored: string | null;
  /** What is in the box right now. */
  value: string;
  /** The key the composer was on before this change, or null on first render. */
  previousKey: string | null;
  /** This surface's unstarted-chat key. */
  newChatKey: string;
  /** The incoming chat, or null when it has not been created yet. */
  sessionId: string | null;
}): { next: string; carried: boolean } {
  if (stored !== null) return { next: stored, carried: false };
  const carried = sessionId !== null && previousKey === newChatKey && value !== "";
  return { next: carried ? value : "", carried };
}

/**
 * Whether a commit should be written to the store, given a restore that has
 * been asked for but may not have reached the composer's state yet.
 *
 * React runs the restore and the write in the same commit, so for one render
 * the key is already the incoming chat's while the value is still the outgoing
 * chat's text. Writing then would overwrite the draft being put back. The value
 * moving off `before` is what says the restore landed — or that the person
 * typed, which resolves it just as well and must not stall the store.
 */
export function draftPersistStep({
  value,
  pending,
}: {
  value: string;
  pending: { text: string; before: string } | null;
}): { write: boolean; pending: { text: string; before: string } | null } {
  if (!pending) return { write: true, pending: null };
  if (value === pending.before) return { write: false, pending };
  return { write: value !== pending.text, pending: null };
}

/**
 * Drop the drafts of chats that no longer exist. A deleted conversation takes
 * its unsent text with it, the same way it takes its unread dot.
 */
export function forgetChatDrafts(
  storage: Pick<Storage, "getItem" | "setItem">,
  surface: string,
  sessionIds: Iterable<string>,
): void {
  const drafts = readAll(storage);
  let removed = false;
  for (const id of sessionIds) {
    if (drafts.delete(chatDraftKey(surface, id))) removed = true;
  }
  if (removed) writeAll(storage, drafts);
}

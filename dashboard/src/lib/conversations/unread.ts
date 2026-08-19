// Chats that answered while the user was looking at something else.
//
// A run keeps going after the user opens another chat, so an answer routinely
// lands in a transcript nobody is on screen for. The rail marks those chats
// with a dot until the transcript is actually opened — in the same spot the
// running spinner sits, so one place on the row carries the whole life of a
// run: spinning, then waiting to be read, then nothing.
//
// This is reading state for one browser, not a property of the conversation,
// so it lives in localStorage rather than in the conversations table: whether
// a chat has been seen is about this window, not about the chat.

const STORAGE_KEY = "breadboard:terminal:unread-chats";
/** A cap, so an abandoned browser cannot grow the entry without bound. */
const MAX_TRACKED = 200;

/**
 * Each rail keeps its own entry.
 *
 * Both stores hold a whole set and prune anything not in the list they were
 * given, so two rails sharing one key would erase each other's dots on every
 * refresh. The Terminal keeps the original unscoped key so nobody loses the
 * dots they already had; a garden's rail is filed under its slug.
 */
function storageKey(scope?: string | null): string {
  return scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY;
}

export interface UnreadChatSnapshot {
  id: string;
  /** Whether the chat had a run in flight when the rail last looked. */
  active: boolean;
}

export function sameChatIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * The unread set after one refresh of the chat list.
 *
 * The mark is made on the edge, never on the state: a chat is unread because
 * it was seen running and is now finished. One that was already finished the
 * first time the rail saw it was never watched, so it cannot have finished
 * behind anyone's back — which is what keeps a reload from marking every chat
 * in the list.
 */
export function nextUnreadChats({
  unread,
  previousActive,
  chats,
  viewingChatId,
}: {
  unread: ReadonlySet<string>;
  /** Activity as of the previous refresh, keyed by chat id. */
  previousActive: ReadonlyMap<string, boolean>;
  chats: readonly UnreadChatSnapshot[];
  /** The chat on screen right now, or null when the dock is closed. */
  viewingChatId: string | null;
}): Set<string> {
  const next = new Set(unread);

  // An empty list is an unloaded one far more often than it is a user with no
  // chats, so nothing is pruned against it. Deletes clear their own ids.
  if (chats.length > 0) {
    const known = new Set(chats.map((chat) => chat.id));
    for (const id of next) if (!known.has(id)) next.delete(id);
  }

  for (const chat of chats) {
    if (previousActive.get(chat.id) === true && !chat.active) next.add(chat.id);
  }

  // Whatever is on screen is read by definition, including the run that just
  // finished in it.
  if (viewingChatId) next.delete(viewingChatId);
  return next;
}

/** Activity to compare the next refresh against. */
export function chatActivityById(
  chats: readonly UnreadChatSnapshot[],
): Map<string, boolean> {
  return new Map(chats.map((chat) => [chat.id, chat.active]));
}

export function readUnreadChats(
  storage: Pick<Storage, "getItem">,
  scope?: string | null,
): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey(scope)) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .filter((id): id is string => typeof id === "string")
        .slice(0, MAX_TRACKED),
    );
  } catch {
    return new Set();
  }
}

export function writeUnreadChats(
  storage: Pick<Storage, "setItem">,
  ids: ReadonlySet<string>,
  scope?: string | null,
): void {
  try {
    storage.setItem(storageKey(scope), JSON.stringify([...ids].slice(0, MAX_TRACKED)));
  } catch {
    // A full or blocked store costs the dot across reloads, nothing more.
  }
}

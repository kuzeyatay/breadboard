const ANNOUNCED_KEY_PREFIX = "breadboard:recall-autostart";

interface RecallSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface RecallAutostartInput {
  session: unknown;
  storage: RecallSessionStorage;
  fetchImpl: (input: string, init: RequestInit) => Promise<unknown>;
}

function authenticatedUserId(session: unknown): number | null {
  if (typeof session !== "object" || session === null || !("user" in session)) return null;

  const user = session.user;
  if (typeof user !== "object" || user === null || !("id" in user)) return null;

  const userId = Number(user.id);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

/**
 * Announces an app opening only after NextAuth has identified its owner.
 * Returns true when this call made the one allowed POST for that user.
 */
export async function announceRecallAutostart({
  session,
  storage,
  fetchImpl,
}: RecallAutostartInput): Promise<boolean> {
  const userId = authenticatedUserId(session);
  if (userId === null) return false;

  const announcedKey = `${ANNOUNCED_KEY_PREFIX}:${userId}`;
  try {
    if (storage.getItem(announcedKey) === "1") return false;
    storage.setItem(announcedKey, "1");
  } catch {
    // If storage is unavailable, the server-side operation remains idempotent.
  }

  try {
    await fetchImpl("/api/recall/autostart", { method: "POST", cache: "no-store" });
  } catch {
    // Recall state and installation errors are explained by Settings → Recall.
  }
  return true;
}

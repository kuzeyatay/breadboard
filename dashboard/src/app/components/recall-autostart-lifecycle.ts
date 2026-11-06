const ANNOUNCED_KEY_PREFIX = "breadboard:recall-autostart:v2";
export const RECALL_SETTINGS_CHANGED_EVENT = "breadboard:recall-settings-changed";

interface RecallSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface RecallAutostartInput {
  session: unknown;
  storage: RecallSessionStorage;
  fetchImpl: (input: string, init: RequestInit) => Promise<Pick<Response, "ok" | "json">>;
  force?: boolean;
}

const pending = new Map<number, Promise<boolean>>();

function authenticatedUserId(session: unknown): number | null {
  if (typeof session !== "object" || session === null || !("user" in session)) return null;

  const user = session.user;
  if (typeof user !== "object" || user === null || !("id" in user)) return null;

  const userId = Number(user.id);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

/**
 * Announces an app opening only after NextAuth has identified its owner.
 * Returns true once startup is settled. Installation and transient failures
 * remain retryable; a failed request must not consume this tab's announcement.
 */
export async function announceRecallAutostart({
  session,
  storage,
  fetchImpl,
  force = false,
}: RecallAutostartInput): Promise<boolean> {
  const userId = authenticatedUserId(session);
  if (userId === null) return false;

  const announcedKey = `${ANNOUNCED_KEY_PREFIX}:${userId}`;
  try {
    if (force) storage.setItem(announcedKey, "0");
    else if (storage.getItem(announcedKey) === "1") return true;
  } catch {
    // If storage is unavailable, the server-side operation remains idempotent.
  }

  const existing = pending.get(userId);
  if (existing) {
    if (!force) return existing;
    // A preference change during an old request must be checked again after
    // that request completes, even if its obsolete result was terminal.
    await existing;
    return announceRecallAutostart({ session, storage, fetchImpl, force: true });
  }
  const request = (async () => {
    try {
      const response = await fetchImpl("/api/recall/autostart", { method: "POST", cache: "no-store" });
      if (!response.ok) return false;
      const payload = await response.json();
      const outcome = payload?.result?.outcome;
      if (typeof outcome !== "string" || outcome === "installing" || outcome === "start_failed") return false;
      try {
        storage.setItem(announcedKey, "1");
      } catch {
        // Server reconciliation is idempotent when session storage is blocked.
      }
      return true;
    } catch {
      return false;
    }
  })();
  pending.set(userId, request);
  try {
    return await request;
  } finally {
    pending.delete(userId);
  }
}

/**
 * A chat launched into Bread inside the Code tab's VS Code.
 *
 * Bread's page runs on the Bread extension's loopback proxy, a different
 * origin from the dashboard, so the launching page cannot reach it through
 * storage or window events. The launch leaves the chat here; Bread takes it
 * the next time it asks, which also covers VS Code still starting up.
 */
const PENDING_MS = 5 * 60_000;

interface PendingBreadChat {
  chatId: string;
  at: number;
}

const globalStore = globalThis as typeof globalThis & {
  __breadboardPendingBreadChats?: Map<number, PendingBreadChat>;
};
const pending = (globalStore.__breadboardPendingBreadChats ??= new Map());

export function setPendingBreadChat(userId: number, chatId: string, now = Date.now()): void {
  pending.set(userId, { chatId, at: now });
}

/** The waiting chat, once: a second ask (or a stale launch) gets nothing. */
export function takePendingBreadChat(userId: number, now = Date.now()): string | null {
  const entry = pending.get(userId);
  if (!entry) return null;
  pending.delete(userId);
  return now - entry.at <= PENDING_MS ? entry.chatId : null;
}

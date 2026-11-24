import type { ChatAttachment } from "./chat-attachments.ts";
import type { ChatTextSelectionReference } from "./chat-text-selection.ts";

export interface QueuedFollowUp {
  id: string;
  text: string;
  attachments: ChatAttachment[];
  textSelection?: ChatTextSelectionReference;
  conversationKey: string | null;
}

const queues = new Map<string, QueuedFollowUp[]>();
const listeners = new Set<() => void>();
export const emptyFollowUps: QueuedFollowUp[] = [];
const storageKey = (key: string) => `breadboard:queued-follow-ups:${key}`;

export function subscribeFollowUps(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function readFollowUps(key: string): QueuedFollowUp[] {
  const cached = queues.get(key);
  if (cached) return cached;
  try {
    const raw = window.sessionStorage.getItem(storageKey(key));
    const items: unknown = raw && JSON.parse(raw);
    if (Array.isArray(items)) {
      const rows = items.filter(item => item?.conversationKey === key && typeof item.id === "string" &&
        typeof item.text === "string" && Array.isArray(item.attachments));
      queues.set(key, rows);
      return rows;
    }
  } catch { /* The in-memory queue also works without browser storage. */ }
  return emptyFollowUps;
}

export function updateFollowUps(key: string, update: (current: QueuedFollowUp[]) => QueuedFollowUp[]) {
  const previous = readFollowUps(key);
  const next = update(previous);
  if (next === previous) return;
  queues.set(key, next);
  try {
    if (next.length && next.every(item => item.conversationKey === key)) {
      window.sessionStorage.setItem(storageKey(key), JSON.stringify(next));
    } else {
      window.sessionStorage.removeItem(storageKey(key));
    }
  } catch { /* Keep large attachments in memory if the tab's quota is full. */ }
  listeners.forEach(notify => notify());
}

export function retainFollowUp(key: string, item: QueuedFollowUp, position: "first" | "last") {
  updateFollowUps(key, queued => {
    if (queued.some(row => row.id === item.id)) return queued;
    return position === "first" ? [item, ...queued] : [...queued, item];
  });
}

import type { ChatNotificationTarget } from './chat-notification-inbox';

// Remember actual visible answers even if the person changes chats before an
// inbox poll. Failed receipts remain queued and retry on the presence heartbeat.
const pending = new Map<string, { target: ChatNotificationTarget; keys: Set<string>; inFlight: boolean; retryAt: number }>();
const confirmed = new Set<string>();

export function acknowledgeVisibleChatMessages(targets: readonly ChatNotificationTarget[]): void {
  for (const target of targets) {
    if (!target.observeMessages || !target.visibleMessageKeys?.length) continue;
    const id = JSON.stringify([target.surface, target.gardenSlug, target.chatId]);
    let receipt = pending.get(id);
    for (const key of target.visibleMessageKeys) {
      if (confirmed.has(`${id}:${key}`)) continue;
      if (!receipt) {
        receipt = { target: { surface: target.surface, chatId: target.chatId, gardenSlug: target.gardenSlug }, keys: new Set(), inFlight: false, retryAt: 0 };
        pending.set(id, receipt);
      }
      receipt.keys.add(key);
    }
  }
  for (const [id, receipt] of pending) {
    if (receipt.inFlight || receipt.retryAt > Date.now()) continue;
    receipt.inFlight = true;
    receipt.retryAt = Date.now() + 4_000;
    const keys = [...receipt.keys].slice(0, 200);
    void fetch('/api/chat-notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ viewed: { target: receipt.target, messageKeys: keys } }),
    }).then(async response => {
      if (!response.ok) return;
      const body = await response.json() as { acknowledged?: unknown };
      if (!Array.isArray(body.acknowledged)) return;
      for (const key of body.acknowledged) if (typeof key === 'string' && keys.includes(key)) {
        receipt.keys.delete(key);
        confirmed.add(`${id}:${key}`);
      }
      // Bound session memory; evicted confirmations are safe to acknowledge again.
      while (confirmed.size > 5_000) confirmed.delete(confirmed.values().next().value!);
      if (!receipt.keys.size) pending.delete(id);
      if (body.acknowledged.length) {
        try { window.localStorage.setItem('breadboard:chat-read-changed:v1', `${Date.now()}:${Math.random()}`); } catch { /* inbox polling still works */ }
      }
    }).catch(() => undefined).finally(() => { receipt.inFlight = false; });
  }
}

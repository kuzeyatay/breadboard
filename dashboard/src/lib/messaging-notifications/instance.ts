import db from "../db.ts";
import { MessagingNotificationStore } from "./store.ts";
import type { NotificationChannel } from "./types.ts";

const globals = globalThis as typeof globalThis & { breadboardMessagingNotificationStore?: MessagingNotificationStore };
const deliveries = new Map<NotificationChannel, { running: boolean; startedAt: number }>();

export function getMessagingNotificationStore(): MessagingNotificationStore {
  return globals.breadboardMessagingNotificationStore ??= new MessagingNotificationStore(db);
}

/** Share the gateway's clock without holding up inbound chats on a slow send. */
export function queueMessagingNotifications(userId: number, channel: NotificationChannel, send: (recipient: string, text: string) => Promise<void>): void {
  const previous = deliveries.get(channel);
  if (previous?.running || (previous && Date.now() - previous.startedAt < 5_000)) return;
  const state = { running: true, startedAt: Date.now() };
  deliveries.set(channel, state);
  void getMessagingNotificationStore().deliver(userId, channel, send)
    .catch(() => undefined)
    .finally(() => { state.running = false; });
}

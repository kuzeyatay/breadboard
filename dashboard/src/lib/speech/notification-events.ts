import { VOICE_ASSISTANT_CHANNEL } from './assistant-preferences.ts';
import type { ChatNotificationRecord } from '../chat-notification-inbox';

export interface NotificationSpeechNotice {
  id?: string;
  message: string;
  type?: 'success' | 'error';
  title?: string;
  chatId?: string;
  response?: string;
  dismissed?: boolean;
  website?: { id: string; origin: string };
  notificationPermission?: { id: string; origin: string };
}

export interface NotificationInboxSnapshot {
  messages: ChatNotificationRecord[];
  requestedAt: number;
}

/** Comparable across renderer realms, including overlapping inbox requests. */
export function notificationRequestTime(): number {
  return performance.timeOrigin + performance.now();
}

function publish(message: unknown): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(VOICE_ASSISTANT_CHANNEL);
  channel.postMessage(message);
  channel.close();
}

/** Give the UI the same complete inbox the voice assistant just received. */
export function publishNotificationInbox(snapshot: NotificationInboxSnapshot): void {
  publish({ type: 'notification-inbox', ...snapshot });
}

/** A voice-delivered notice also belongs in the visible notification list. */
export function publishNotificationDelivery(notice: NotificationSpeechNotice): void {
  publish({ type: 'notification-delivery', notice });
}

export function publishNotificationSpeech(notice: NotificationSpeechNotice): void {
  publish({ type: 'notification', notice });
}

/** The visible card and voice companion must use the same identity. */
export function notificationSpeechId(notice: NotificationSpeechNotice): string | undefined {
  if (notice.notificationPermission) return `website-permission:${notice.notificationPermission.id}`;
  if (notice.website) return `website:${notice.website.id}`;
  return notice.id;
}

/** Reaches both this page's reader and the separate desktop voice window immediately. */
export function dismissNotificationSpeech(ids: readonly string[]): void {
  if (ids.length) publish({ type: 'notification-dismissed', ids });
}


/** A chat title can contain a preview of its response; speak the body once. */
export function notificationSpeechText(notice: NotificationSpeechNotice): string {
  const body = notice.response?.trim() || notice.message.trim();
  return [...new Set([notice.title?.trim(), body].filter(Boolean))].join('. ');
}

/** Database timestamps and chat renames do not make new spoken content. */
export function notificationSpeechKey(notice: NotificationSpeechNotice): string {
  return JSON.stringify([notificationSpeechId(notice), notificationSpeechText(notice)]);
}

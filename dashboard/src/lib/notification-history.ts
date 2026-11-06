import { chatNotificationKind, isChatNotificationTarget, isNotificationClarification, type NotificationClarification, type ChatNotificationRecord, type ChatNotificationTarget } from './chat-notification-inbox.ts';

export interface NotificationHistoryItem {
  id: string;
  message: string;
  type: 'success' | 'error';
  title?: string;
  response?: string;
  notificationId?: string;
  question?: boolean;
  clarification?: NotificationClarification;
  target?: ChatNotificationTarget;
  website?: { id: string; origin: string };
  progressPercent?: number;
  updatedAt: string;
  read: boolean;
}

export function notificationHistoryItem(record: ChatNotificationRecord, read = false): NotificationHistoryItem {
  const learn = chatNotificationKind(record) === 'learn';
  return {
    id: `chat-notification:${record.id}`, notificationId: record.id,
    title: record.title, type: record.type, target: record.target, updatedAt: record.updatedAt, read,
    message: learn && record.message?.trim() ? `${record.chatTitle} · ${record.message.trim()}` : record.chatTitle,
    response: learn ? undefined : record.response,
    question: chatNotificationKind(record) === 'chat_question', progressPercent: record.progressPercent,
    clarification: record.clarification,
  };
}

export function isNotificationHistoryItem(value: unknown): value is NotificationHistoryItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as NotificationHistoryItem;
  return typeof row.id === 'string' && typeof row.message === 'string' &&
    (row.type === 'success' || row.type === 'error') && typeof row.read === 'boolean' &&
    typeof row.updatedAt === 'string' && (row.target === undefined || isChatNotificationTarget(row.target)) &&
    (row.clarification === undefined || isNotificationClarification(row.clarification));
}

/** Only plain delivery notices can be submitted by a renderer. Chat ownership
 * and targets always come from the account's server-side conversation store. */
export function parseDeliveredNotification(value: unknown): NotificationHistoryItem | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !/^(toast|website):.{1,200}$/.test(row.id) ||
      typeof row.message !== 'string' || !row.message.trim() || row.message.length > 16_000 ||
      (row.type !== 'success' && row.type !== 'error')) return null;
  let website: NotificationHistoryItem['website'];
  if (row.website && typeof row.website === 'object') {
    const site = row.website as Record<string, unknown>;
    if (typeof site.id !== 'string' || typeof site.origin !== 'string' || row.id !== `website:${site.id}`) return null;
    try { const url = new URL(site.origin); if (!['http:', 'https:'].includes(url.protocol)) return null; website = { id: site.id, origin: url.origin }; }
    catch { return null; }
  }
  if (row.id.startsWith('website:') && !website) return null;
  return { id: row.id, message: row.message, type: row.type, website,
    title: typeof row.title === 'string' ? row.title.slice(0, 300) : undefined,
    response: typeof row.response === 'string' ? row.response.slice(0, 16_000) : undefined,
    updatedAt: new Date().toISOString(), read: false };
}

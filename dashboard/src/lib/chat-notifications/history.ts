import type Database from 'better-sqlite3';
import { sameChatNotificationTarget, type ChatNotificationRecord, type ChatNotificationTarget } from '../chat-notification-inbox.ts';
import { notificationTimestamp } from '../notification-center.ts';
import { notificationHistoryItem, type NotificationHistoryItem } from '../notification-history.ts';
import { listRecentChatNotifications } from './store.ts';
import { listPendingQuestionNotifications } from './questions.ts';

export function ensureNotificationHistorySchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS notification_center_history (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL, payload TEXT, updated_at TEXT NOT NULL,
    read_at TEXT, cleared_at TEXT, PRIMARY KEY(user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_notification_center_history ON notification_center_history(user_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS notification_center_initialized (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
  );`);
}

export function saveNotificationHistory(db: Database.Database, userId: number, items: readonly NotificationHistoryItem[]): void {
  ensureNotificationHistorySchema(db);
  const save = db.prepare(`INSERT INTO notification_center_history(user_id,id,payload,updated_at,read_at)
    VALUES (@userId,@id,@payload,@updatedAt,@readAt)
    ON CONFLICT(user_id,id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
    WHERE excluded.updated_at >= notification_center_history.updated_at AND notification_center_history.cleared_at IS NULL
      AND (notification_center_history.payload IS NULL OR
        json_remove(notification_center_history.payload,'$.updatedAt','$.read') <> json_remove(excluded.payload,'$.updatedAt','$.read'))`);
  // Every window polls this. When the upsert would leave every row alone (the
  // same condition, read-only), skip the write lock entirely: waiting on it
  // behind a worker's write froze the server ~0.7 s per poll. Otherwise write
  // them all in order, so duplicate ids in one batch behave exactly as before.
  const unchanged = db.prepare(`SELECT 1 FROM notification_center_history
    WHERE user_id=@userId AND id=@id AND NOT (
      @updatedAt >= updated_at AND cleared_at IS NULL
      AND (payload IS NULL OR json_remove(payload,'$.updatedAt','$.read') <> json_remove(@payload,'$.updatedAt','$.read')))`);
  const rows = items.map(item => {
    const updatedAt = new Date(notificationTimestamp(item.updatedAt) || Date.now()).toISOString();
    const payload = JSON.stringify({ ...item, response: item.response?.slice(0, 16_000), updatedAt });
    return { userId, id: item.id, payload, updatedAt, readAt: item.read ? updatedAt : null };
  });
  if (rows.every(row => unchanged.get(row))) return;
  db.transaction(() => {
    for (const row of rows) save.run(row);
  })();
}

/** One bounded migration restores recent read answers without replaying them as banners. */
export function initializeNotificationHistory(db: Database.Database, userId: number, pending: readonly ChatNotificationRecord[]): void {
  ensureNotificationHistorySchema(db);
  if (db.prepare('SELECT 1 FROM notification_center_initialized WHERE user_id=?').get(userId)) return;
  db.transaction(() => {
    const unread = new Set(pending.map(record => record.id));
    saveNotificationHistory(db, userId, listRecentChatNotifications(db, userId)
      .map(record => notificationHistoryItem(record, !unread.has(record.id))));
    db.prepare('INSERT OR IGNORE INTO notification_center_initialized(user_id) VALUES (?)').run(userId);
  })();
}

export function listNotificationHistory(db: Database.Database, userId: number): NotificationHistoryItem[] {
  ensureNotificationHistorySchema(db);
  const rows = db.prepare(`SELECT payload,read_at FROM notification_center_history
    WHERE user_id=? AND cleared_at IS NULL AND payload IS NOT NULL ORDER BY updated_at DESC LIMIT 200`).all(userId) as {payload:string;read_at:string|null}[];
  const items = rows.map(row => ({ ...JSON.parse(row.payload) as NotificationHistoryItem, read: row.read_at !== null }));
  if (!items.some(item => item.question)) return items;
  // Reading or dismissing a banner does not answer its question. History can
  // still answer it, but completed, expired and replaced questions lose controls.
  const pending = new Map(listPendingQuestionNotifications(db, userId, true)
    .map(record => [record.id, record.clarification]));
  return items.map(item => item.question
    ? { ...item, clarification: pending.get(item.notificationId ?? '') } : item);
}

export function markNotificationHistoryRead(db: Database.Database, userId: number, ids: readonly string[], target?: ChatNotificationTarget | null): void {
  ensureNotificationHistorySchema(db);
  const allIds = new Set(ids);
  if (target) for (const item of listNotificationHistory(db,userId)) {
    if (item.target && (target.surface === 'garden_learn'
      ? item.target.surface === 'garden_learn' && item.target.gardenSlug === target.gardenSlug && (target.chatId === '*' || target.chatId === item.target.chatId)
      : sameChatNotificationTarget(target,item.target))) allIds.add(item.id);
  }
  const mark=db.prepare("UPDATE notification_center_history SET read_at=COALESCE(read_at,datetime('now')) WHERE user_id=? AND id=?");
  db.transaction(()=>{for(const id of allIds) mark.run(userId,id);})();
}

export function clearNotificationHistory(db: Database.Database, userId: number, ids: readonly string[]): void {
  ensureNotificationHistorySchema(db);
  // A tombstone also covers a delivery POST that was still in flight when cleared.
  const clear=db.prepare(`INSERT INTO notification_center_history(user_id,id,updated_at,cleared_at)
    VALUES (?,?,'',datetime('now')) ON CONFLICT(user_id,id) DO UPDATE SET cleared_at=excluded.cleared_at`);
  db.transaction(()=>{for(const id of ids) clear.run(userId,id);})();
}

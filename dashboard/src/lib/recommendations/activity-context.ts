import type Database from 'better-sqlite3';

import { cleanRecommendationText as text, type RecommendationEvidence } from './types.ts';

/** How far back a repeated question counts as a habit rather than a coincidence. */
const REPEAT_WINDOW_DAYS = 45;
/** Three separate chats asking the same thing is a routine worth offering to automate. */
const REPEAT_MIN_CHATS = 3;
/** A follow-up worth running after every chat is an instruction, not a one-off question. */
const HOOK_ACTION = /^(?:please\s+)?(?:save|summari[sz]e|turn|make|create|add|send|export|write|draft|extract|log|note|remind|email|share|translate|generate|update|list|tag|file|store|record|post)\b/i;

function safe(read: () => RecommendationEvidence[]): RecommendationEvidence[] {
  try { return read(); } catch { return []; } // Optional store not initialized.
}

/**
 * What Breadboard itself knows about the person's habits: remembered project
 * facts and decisions, scheduled tasks and hooks that went wrong or just ran,
 * and questions they keep asking by hand. Each item is a real row, so a card
 * built from it can only name something that exists.
 */
export function activityRecommendationEvidence(database: Database.Database, userId: number): RecommendationEvidence[] {
  const memories = safe(() => (database.prepare(`SELECT id, content, kind, COALESCE(last_confirmed_at, created_at) AS at
      FROM durable_memories
     WHERE user_id = ? AND scope = 'global' AND kind IN ('project_fact','decision')
       AND (state = 'confirmed' OR (state = 'candidate' AND confidence >= 0.5))
       AND COALESCE(last_confirmed_at, created_at) >= datetime('now','-30 days')
     ORDER BY at DESC LIMIT 3`).all(userId) as Array<{ id: number; content: string; kind: string; at: string }>)
    .map(row => ({ id: `memory:${row.id}`, source: 'memory' as const, title: text(row.content, 140),
      summary: `Remembered ${row.kind === 'decision' ? 'decision' : 'project fact'} from an earlier chat.`, timestamp: row.at })));

  const jobs = safe(() => (database.prepare(`SELECT id, title, prompt, last_status, last_error, last_run_at
      FROM scheduled_chat_jobs
     WHERE user_id = ? AND enabled = 1 AND delivery_mode IS NULL
       AND last_run_at >= datetime('now','-3 days')
     ORDER BY last_run_at DESC LIMIT 3`).all(userId) as Array<{ id: number; title: string; prompt: string; last_status: string | null; last_error: string | null; last_run_at: string }>)
    .map(row => ({ id: `schedule:${row.id}`, source: 'schedule' as const, title: text(row.title || row.prompt, 120),
      summary: row.last_status === 'failed' ? `Scheduled task failed on its last run: ${text(row.last_error, 300) || 'no error recorded'}.`
        : 'Scheduled task ran recently and left a chat with its result.', timestamp: row.last_run_at })));

  // Only command hooks record an outcome; "Exit 0" is a success.
  const hooks = safe(() => (database.prepare(`SELECT id, name, last_result, last_fired_at FROM hooks
     WHERE user_id = ? AND enabled = 1 AND last_result IS NOT NULL AND last_result NOT LIKE 'Exit 0%'
       AND last_fired_at >= datetime('now','-7 days')
     ORDER BY last_fired_at DESC LIMIT 2`).all(userId) as Array<{ id: string; name: string; last_result: string; last_fired_at: string }>)
    .map(row => ({ id: `hook:${row.id}`, source: 'hook' as const, title: text(row.name, 120),
      summary: `Hook failed on its last run: ${text(row.last_result, 300)}.`, timestamp: row.last_fired_at })));

  // The same short message typed in several separate chats. Asked to open a
  // chat, it is a schedule candidate; asked later in a chat, a hook candidate.
  // Anything already scheduled is excluded, which also keeps a schedule's own
  // runs from counting as the habit that suggests scheduling it.
  const repeats = safe(() => {
    const scheduled = new Set((database.prepare('SELECT prompt FROM scheduled_chat_jobs WHERE user_id = ?').all(userId) as Array<{ prompt: string }>)
      .map(row => row.prompt.trim().toLocaleLowerCase()));
    const rows = database.prepare(`SELECT lower(trim(substr(m.content, 1, 161))) AS key, MIN(trim(substr(m.content, 1, 161))) AS sample,
           COUNT(DISTINCT c.id) AS chats,
           MAX(m.order_index = 0) AS opener
      FROM conversations c
      -- CROSS JOIN keeps this user's recent chats as the outer loop, and
      -- octet_length comes from the covering index, so huge message bodies
      -- are never read just to be rejected (7 s → 40 ms on a real history).
      CROSS JOIN conversation_messages m ON m.conversation_id = c.id
     WHERE c.user_id = ? AND c.temporary = 0 AND c.updated_at >= datetime('now', ?) AND m.role = 'user'
       AND m.created_at >= datetime('now', ?) AND octet_length(m.content) BETWEEN 8 AND 480
     GROUP BY key HAVING chats >= ? ORDER BY chats DESC LIMIT 8`)
      .all(userId, `-${REPEAT_WINDOW_DAYS} days`, `-${REPEAT_WINDOW_DAYS} days`, REPEAT_MIN_CHATS) as Array<{ key: string; sample: string; chats: number; opener: number }>;
    return rows.filter(row => !scheduled.has(row.key) && row.sample.length <= 160
      // App-written markers such as "(Started a voice conversation)" are not requests.
      && !/^[([{<]/.test(row.sample) && row.sample.split(/\s+/).length >= 3
      && (row.opener ? true : HOOK_ACTION.test(row.sample))).slice(0, 3).map(row => ({
      id: `${row.opener ? 'repeat-open' : 'repeat-follow'}:${row.key.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60)}`,
      source: (row.opener ? 'schedule' : 'hook') as 'schedule' | 'hook', title: text(row.sample, 160),
      summary: `Asked by hand in ${row.chats} separate chats over the last ${REPEAT_WINDOW_DAYS} days${row.opener ? ', each time to start the chat' : ', after a chat was under way'}. Not automated yet.`,
    }));
  });

  return [...memories, ...jobs, ...hooks, ...repeats];
}

export interface ConnectedAppSummary { slug: string; name: string }

/**
 * Every enabled connection, whatever the app. Breadboard has no reader for
 * most of them, but the chat that a card opens can use the app's own tools,
 * so a connection is evidence that a task in that app is something the
 * assistant can actually do. Apps with a dedicated content reader (mail,
 * calendar) are skipped: their real items already speak for them.
 */
export function connectionRecommendationEvidence(apps: readonly ConnectedAppSummary[], deep: ReadonlySet<string>): RecommendationEvidence[] {
  const seen = new Set<string>();
  return apps.filter(app => !deep.has(app.slug) && !seen.has(app.slug) && seen.add(app.slug)).slice(0, 8).map(app => ({
    id: `connection:${app.slug}`, source: 'connection' as const, title: text(app.name, 60),
    summary: `${text(app.name, 60)} is connected; its tools are available in chat.`,
  }));
}

/** "google-calendar" → "Google Calendar", for apps the catalogs do not name. */
export function connectedAppName(slug: string): string {
  return slug.split(/[-_]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
}

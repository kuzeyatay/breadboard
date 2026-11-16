import type Database from 'better-sqlite3';

import { cleanRecommendationText as text, type RecommendationEvidence } from './types.ts';

function safe(read: () => RecommendationEvidence[]): RecommendationEvidence[] {
  try { return read(); } catch { return []; } // Optional store not initialized.
}

/** Account-owned project facts and failed automation runs. */
export function activityRecommendationEvidence(database: Database.Database, userId: number): RecommendationEvidence[] {
  const memories = safe(() => (database.prepare(`SELECT id, content, kind, COALESCE(last_confirmed_at, created_at) AS at
      FROM durable_memories
     WHERE user_id = ? AND scope = 'global' AND kind IN ('project_fact','decision')
       AND (state = 'confirmed' OR (state = 'candidate' AND confidence >= 0.5))
       AND COALESCE(last_confirmed_at, created_at) >= datetime('now','-30 days')
     ORDER BY at DESC LIMIT 3`).all(userId) as Array<{ id: number; content: string; kind: string; at: string }>)
    .map(row => ({ id: `memory:${row.id}`, source: 'memory' as const, title: text(row.content, 140),
      summary: `Remembered ${row.kind === 'decision' ? 'decision' : 'project fact'} from an earlier chat.`, timestamp: row.at })));

  const jobs = safe(() => (database.prepare(`SELECT id, title, prompt, last_error, last_run_at
      FROM scheduled_chat_jobs
     WHERE user_id = ? AND enabled = 1 AND delivery_mode IS NULL AND last_status = 'failed'
       AND last_run_at >= datetime('now','-3 days')
     ORDER BY last_run_at DESC LIMIT 3`).all(userId) as Array<{ id: number; title: string; prompt: string; last_error: string | null; last_run_at: string }>)
    .map(row => ({ id: `schedule:${row.id}`, source: 'schedule' as const, title: text(row.title || row.prompt, 120),
      summary: `Scheduled task failed on its last run: ${text(row.last_error, 300) || 'no error recorded'}.`, timestamp: row.last_run_at })));

  // Only command hooks record an outcome; "Exit 0" is a success.
  const hooks = safe(() => (database.prepare(`SELECT id, name, last_result, last_fired_at FROM hooks
     WHERE user_id = ? AND enabled = 1 AND last_result IS NOT NULL AND last_result NOT LIKE 'Exit 0%'
       AND last_fired_at >= datetime('now','-7 days')
     ORDER BY last_fired_at DESC LIMIT 2`).all(userId) as Array<{ id: string; name: string; last_result: string; last_fired_at: string }>)
    .map(row => ({ id: `hook:${row.id}`, source: 'hook' as const, title: text(row.name, 120),
      summary: `Hook failed on its last run: ${text(row.last_result, 300)}.`, timestamp: row.last_fired_at })));

  return [...memories, ...jobs, ...hooks];
}

export interface ConnectedAppSummary { slug: string; name: string }

/**
 * Every enabled connection, whatever the app. Breadboard has no reader for
 * most of them, but the chat that a card opens can use the app's own tools
 * for work supported by other evidence. Apps with a dedicated reader (mail,
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

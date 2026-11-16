// One short account per day of what Recall saw, kept after the engine has
// deleted that day.
//
// The engine removes everything older than RECALL_RETENTION_DAYS, text
// included, because its database grows by hundreds of megabytes a day. A day's
// summary (apps, windows, time spent, key text) is a few kilobytes, so those
// are kept here without a limit and answer "what was I doing three weeks ago".
// Like the engine's own history they belong to the machine, not to one
// account; service.ts applies the reader's permissions before handing them on.

import type Database from "better-sqlite3";

import type { RecallClient } from "./client.ts";
import { RECALL_RETENTION_DAYS } from "./engine.ts";

const KEPT_LISTS = ["apps", "windows", "key_texts", "edited_files", "memories"] as const;
const MAX_LIST_ITEMS = 40;

function ensureSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS recall_daily_summaries(
    day TEXT PRIMARY KEY, summary TEXT NOT NULL, created_at INTEGER NOT NULL)`);
}

/** The person's calendar day: "what did I do on Tuesday" means their Tuesday. */
function localDay(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** Keep what describes the day; drop the engine's query guidance and raw snippets. */
function compact(summary: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {
    total_active_minutes: summary.total_active_minutes,
    total_frames: summary.total_frames,
    audio_summary: summary.audio_summary,
  };
  for (const name of KEPT_LISTS) {
    const list = summary[name];
    if (Array.isArray(list) && list.length) kept[name] = list.slice(0, MAX_LIST_ITEMS);
  }
  return kept;
}

/**
 * Store a summary for each finished day the engine still holds and this table
 * does not. Days with nothing captured are not stored, so a day recorded late
 * (the engine was down, then repaired) is picked up on a later pass.
 */
export async function storeRecallDailySummaries(
  db: Database.Database,
  client: Pick<RecallClient, "activitySummary">,
  now: Date = new Date(),
): Promise<number> {
  ensureSchema(db);
  let stored = 0;
  for (let back = 1; back < RECALL_RETENTION_DAYS; back++) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const day = localDay(start);
    if (db.prepare("SELECT 1 FROM recall_daily_summaries WHERE day=?").get(day)) continue;
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + 1);
    const summary = await client.activitySummary({ startTime: start.toISOString(), endTime: end.toISOString() });
    if (!(Number(summary.total_frames) > 0)) continue;
    db.prepare("INSERT OR IGNORE INTO recall_daily_summaries(day,summary,created_at) VALUES(?,?,?)")
      .run(day, JSON.stringify(compact(summary)), now.getTime());
    stored++;
  }
  return stored;
}

/**
 * Stored summaries for the part of a requested range the engine no longer
 * holds. Times the engine words relatively ("3d ago") are understood for whole
 * hours, days and weeks; anything else unparseable yields nothing rather than
 * a guess.
 */
export function recallEarlierDays(
  db: Database.Database,
  startTime: string,
  endTime: string,
  now: Date = new Date(),
): Array<{ day: string; summary: Record<string, unknown> }> {
  const moment = (expression: string): Date | null => {
    const value = expression.trim().toLowerCase();
    if (value === "now" || value === "today") return now;
    if (value === "yesterday") return new Date(now.getTime() - 86_400_000);
    const relative = /^(\d+)\s*([hdw])\s+ago$/u.exec(value);
    if (relative) return new Date(now.getTime() - Number(relative[1]) * { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[relative[2] as "h" | "d" | "w"]);
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00` : expression);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const start = moment(startTime), end = moment(endTime);
  if (!start || !end) return [];
  ensureSchema(db);
  const oldestHeld = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - RECALL_RETENTION_DAYS + 1));
  return (db.prepare("SELECT day, summary FROM recall_daily_summaries WHERE day>=? AND day<=? AND day<? ORDER BY day LIMIT 62")
    .all(localDay(start), localDay(end), oldestHeld) as Array<{ day: string; summary: string }>)
    .map(row => ({ day: row.day, summary: JSON.parse(row.summary) as Record<string, unknown> }));
}

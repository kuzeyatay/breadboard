import type Database from "better-sqlite3";

export const SQLITE_BUSY_TIMEOUT_MS = 30_000;

/**
 * Configure the shared Breadboard database for the multi-process runtime.
 *
 * The dashboard, status worker, and long-running Learn workers all open the
 * same file. WAL lets status readers keep observing a run while a worker
 * commits progress; the busy timeout still bounds genuine writer contention.
 */
export function configureSqliteConcurrency(
  database: Pick<Database.Database, "pragma">,
): void {
  database.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  const currentJournalMode = database.pragma("journal_mode", { simple: true });
  const journalMode =
    String(currentJournalMode).toLowerCase() === "wal"
      ? currentJournalMode
      : database.pragma("journal_mode = WAL", { simple: true });
  if (String(journalMode).toLowerCase() !== "wal") {
    throw new Error(
      `Breadboard requires SQLite WAL mode for concurrent workers; received ${String(journalMode)}.`,
    );
  }
}
